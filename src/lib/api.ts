import type { AppSettings, ImageApiResponse, ResponsesApiResponse, TaskParams } from '../types'
import { dataUrlToBlob, imageDataUrlToPngBlob, maskDataUrlToPngBlob } from './canvasImage'
import { buildApiUrl, isApiProxyAvailable, isRelativeApiBaseUrl, readClientDevProxyConfig } from './devProxy'

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

const PARALLEL_REQUEST_STAGGER_MS = 1000
const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024

export { isRelativeApiBaseUrl, normalizeBaseUrl } from './devProxy'

function getEndpointPath(settings: AppSettings, key: keyof AppSettings['apiPaths']): string {
  return settings.apiPaths?.[key] || {
    imagesGenerations: 'images/generations',
    imagesEdits: 'images/edits',
    responses: 'responses',
    models: 'models',
  }[key]
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function normalizeBase64Image(value: string, fallbackMime: string): string {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function getDataUrlEncodedByteSize(dataUrl: string): number {
  return dataUrl.length
}

function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload).length

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }

  return `data:${blob.type || fallbackMime};base64,${btoa(binary)}`
}

async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  }

  return blobToDataUrl(await response.blob(), fallbackMime)
}

async function getApiErrorMessage(response: Response): Promise<string> {
  let errorMsg = `HTTP ${response.status}`
  try {
    const errJson = await response.json()
    if (errJson.error?.message) errorMsg = errJson.error.message
    else if (errJson.message) errorMsg = errJson.message
  } catch {
    try {
      errorMsg = await response.text()
    } catch {
      /* ignore */
    }
  }
  return errorMsg
}

function createRequestHeaders(settings: AppSettings, sessionToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store, no-cache, max-age=0',
    Pragma: 'no-cache',
  }

  if (isRelativeApiBaseUrl(settings.baseUrl)) {
    if (sessionToken) headers['X-Session-Token'] = sessionToken
    else if (settings.apiKey) headers['X-App-Token'] = settings.apiKey
  } else if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`
  }

  return headers
}

function createResponsesImageTool(
  params: TaskParams,
  isEdit: boolean,
  settings: AppSettings,
  maskDataUrl?: string,
): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    action: isEdit ? 'edit' : 'generate',
    size: params.size,
    output_format: params.output_format,
  }

  if (!settings.codexCli) {
    tool.quality = params.quality
  }

  if (params.output_format !== 'png' && params.output_compression != null) {
    tool.output_compression = params.output_compression
  }

  if (maskDataUrl) {
    tool.input_image_mask = {
      image_url: maskDataUrl,
    }
  }

  return tool
}

export interface ApiModelInfo {
  id: string
  ownedBy?: string
}

export async function listApiModels(settings: AppSettings, sessionToken?: string): Promise<ApiModelInfo[]> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = settings.apiProxy && isApiProxyAvailable(proxyConfig)
  const response = await fetch(buildApiUrl(settings.baseUrl, getEndpointPath(settings, 'models'), proxyConfig, useApiProxy), {
    method: 'GET',
    headers: createRequestHeaders(settings, sessionToken),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response))
  }

  const payload = await response.json() as {
    data?: Array<{ id?: unknown; owned_by?: unknown; ownedBy?: unknown }>
    models?: Array<{ id?: unknown; name?: unknown; owned_by?: unknown; ownedBy?: unknown }>
  }
  const rawModels: Array<{ id?: unknown; name?: unknown; owned_by?: unknown; ownedBy?: unknown }> =
    Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []
  return rawModels
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '',
      ownedBy: typeof item.owned_by === 'string' ? item.owned_by : typeof item.ownedBy === 'string' ? item.ownedBy : undefined,
    }))
    .filter((model) => model.id)
}

function createResponsesInput(prompt: string, inputImageDataUrls: string[]): unknown {
  const text = `Use the following text as the complete prompt. Do not rewrite it:\n${prompt}`
  if (!inputImageDataUrls.length) return text

  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text },
        ...inputImageDataUrls.map((dataUrl) => ({
          type: 'input_image',
          image_url: dataUrl,
        })),
      ],
    },
  ]
}

export interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  /** 可选遮罩，配合第一张输入图进行局部编辑 */
  maskDataUrl?: string
  /** 登录态代理模式下，本地生图需要用 Session 调用 Cloudflare OpenAI 代理 */
  sessionToken?: string
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
}

function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = record.size
  if (record.quality === 'auto' || record.quality === 'low' || record.quality === 'medium' || record.quality === 'high') {
    actualParams.quality = record.quality
  }
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp') {
    actualParams.output_format = record.output_format
  }
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n

  return actualParams
}

function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>): Partial<TaskParams> | undefined {
  const merged = Object.assign({}, ...sources.filter((source): source is Partial<TaskParams> => Boolean(source && Object.keys(source).length)))
  return Object.keys(merged).length ? merged : undefined
}

function extractResponsesImageResult(result: unknown): string | undefined {
  if (typeof result === 'string' && result.trim()) return result
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  for (const key of ['b64_json', 'image', 'data']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function parseResponsesImageResults(payload: ResponsesApiResponse, fallbackMime: string): Array<{
  image: string
  actualParams?: Partial<TaskParams>
  revisedPrompt?: string
}> {
  const output = payload.output
  if (!Array.isArray(output) || !output.length) {
    throw new Error('接口未返回图片数据')
  }

  const toolParams = mergeActualParams(...(payload.tools || []).map(pickActualParams))
  const results: Array<{ image: string; actualParams?: Partial<TaskParams>; revisedPrompt?: string }> = []

  for (const item of output) {
    if (item?.type !== 'image_generation_call') continue

    const image = extractResponsesImageResult(item.result)
    if (image) {
      results.push({
        image: normalizeBase64Image(image, fallbackMime),
        actualParams: mergeActualParams(toolParams, pickActualParams(item)),
        revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
      })
    }
  }

  if (!results.length) {
    throw new Error('接口未返回可用图片数据')
  }

  return results
}

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  return opts.settings.apiMode === 'responses'
    ? callResponsesImageApi(opts)
    : callImagesApi(opts)
}

function codexActualParams(settings: AppSettings): Partial<TaskParams> | undefined {
  void settings
  return undefined
}

function createCodexPrompt(prompt: string): string {
  return `Use the following text as the complete prompt. Do not rewrite it:\n${prompt}`
}

async function callImagesApi(opts: CallApiOptions): Promise<CallApiResult> {
  const n = opts.params.n > 0 ? opts.params.n : 1
  if (n > 1) {
    return callImagesApiConcurrent(opts, n)
  }

  return callImagesApiSingle(opts)
}

async function callImagesApiConcurrent(opts: CallApiOptions, n: number): Promise<CallApiResult> {
  const singleOpts = {
    ...opts,
    params: {
      ...opts.params,
      n: 1,
      quality: opts.settings.codexCli ? 'auto' as const : opts.params.quality,
    },
  }
  const results = await Promise.allSettled(
    Array.from({ length: n }).map(async (_, index) => {
      if (index > 0) await sleep(index * PARALLEL_REQUEST_STAGGER_MS)
      return callImagesApiSingle(singleOpts)
    }),
  )

  const successfulResults = results
    .filter((result): result is PromiseFulfilledResult<CallApiResult> => result.status === 'fulfilled')
    .map((result) => result.value)

  if (successfulResults.length === 0) {
    const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (firstError) throw firstError.reason
    throw new Error('所有并发请求均失败')
  }

  const images = successfulResults.flatMap((result) => result.images)
  const actualParamsList = successfulResults.flatMap((result) =>
    result.actualParamsList?.length ? result.actualParamsList : result.images.map(() => result.actualParams),
  )
  const revisedPrompts = successfulResults.flatMap((result) =>
    result.revisedPrompts?.length ? result.revisedPrompts : result.images.map(() => undefined),
  )
  const actualParams = mergeActualParams(
    successfulResults[0]?.actualParams,
    codexActualParams(opts.settings),
    { n: images.length },
  )

  return { images, actualParams, actualParamsList, revisedPrompts }
}

async function callImagesApiSingle(opts: CallApiOptions): Promise<CallApiResult> {
  const { settings, prompt: originalPrompt, params, inputImageDataUrls } = opts
  const prompt = settings.codexCli ? createCodexPrompt(originalPrompt) : originalPrompt
  const isEdit = inputImageDataUrls.length > 0
  const mime = MIME_MAP[params.output_format] || 'image/png'
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = settings.apiProxy && isApiProxyAvailable(proxyConfig)
  const requestHeaders = createRequestHeaders(settings, opts.sessionToken)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), settings.timeout * 1000)

  try {
    let response: Response

    if (isEdit) {
      const formData = new FormData()
      formData.append('model', settings.model)
      formData.append('prompt', prompt)
      formData.append('size', params.size)
      formData.append('output_format', params.output_format)
      formData.append('moderation', params.moderation)

      if (!settings.codexCli) {
        formData.append('quality', params.quality)
      }

      if (params.n > 1) {
        formData.append('n', String(params.n))
      }

      if (params.output_format !== 'png' && params.output_compression != null) {
        formData.append('output_compression', String(params.output_compression))
      }

      const imageBlobs: Blob[] = []
      for (let i = 0; i < inputImageDataUrls.length; i++) {
        const dataUrl = inputImageDataUrls[i]
        const blob = opts.maskDataUrl && i === 0
          ? await imageDataUrlToPngBlob(dataUrl)
          : await dataUrlToBlob(dataUrl)
        imageBlobs.push(blob)
      }

      const maskBlob = opts.maskDataUrl ? await maskDataUrlToPngBlob(opts.maskDataUrl) : null
      if (opts.maskDataUrl) {
        assertMaskEditFileSize('遮罩主图文件', imageBlobs[0]?.size ?? 0)
        assertMaskEditFileSize('遮罩文件', maskBlob?.size ?? 0)
      }
      assertImageInputPayloadSize(
        imageBlobs.reduce((sum, blob) => sum + blob.size, 0) + (maskBlob?.size ?? 0),
      )

      for (let i = 0; i < imageBlobs.length; i++) {
        const blob = imageBlobs[i]
        const ext = blob.type.split('/')[1] || 'png'
        formData.append('image[]', blob, `input-${i + 1}.${ext}`)
      }

      if (maskBlob) {
        formData.append('mask', maskBlob, 'mask.png')
      }

      response = await fetch(buildApiUrl(settings.baseUrl, getEndpointPath(settings, 'imagesEdits'), proxyConfig, useApiProxy), {
        method: 'POST',
        headers: requestHeaders,
        cache: 'no-store',
        body: formData,
        signal: controller.signal,
      })
    } else {
      const body: Record<string, unknown> = {
        model: settings.model,
        prompt,
        size: params.size,
        output_format: params.output_format,
        moderation: params.moderation,
      }

      if (!settings.codexCli) {
        body.quality = params.quality
      }

      if (params.output_format !== 'png' && params.output_compression != null) {
        body.output_compression = params.output_compression
      }
      if (params.n > 1) {
        body.n = params.n
      }

      response = await fetch(buildApiUrl(settings.baseUrl, getEndpointPath(settings, 'imagesGenerations'), proxyConfig, useApiProxy), {
        method: 'POST',
        headers: {
          ...requestHeaders,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    }

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response))
    }

    const payload = await response.json() as ImageApiResponse
    const data = payload.data
    if (!Array.isArray(data) || !data.length) {
      throw new Error('接口未返回图片数据')
    }

    const payloadParams = pickActualParams(payload)
    const images: string[] = []
    const actualParamsList: Array<Partial<TaskParams> | undefined> = []
    const revisedPrompts: Array<string | undefined> = []
    for (const item of data) {
      const itemParams = mergeActualParams(payloadParams, pickActualParams(item), codexActualParams(settings))
      const revisedPrompt = typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined
      const b64 = item.b64_json
      if (b64) {
        images.push(normalizeBase64Image(b64, mime))
        actualParamsList.push(itemParams)
        revisedPrompts.push(revisedPrompt)
        continue
      }

      if (isHttpUrl(item.url)) {
        images.push(await fetchImageUrlAsDataUrl(item.url, mime, controller.signal))
        actualParamsList.push(itemParams)
        revisedPrompts.push(revisedPrompt)
      }
    }

    if (!images.length) {
      throw new Error('接口未返回可用图片数据')
    }

    const actualParams = mergeActualParams(payloadParams, codexActualParams(settings))
    return {
      images,
      actualParams,
      actualParamsList,
      revisedPrompts,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function callResponsesImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const n = opts.params.n > 0 ? opts.params.n : 1
  if (n === 1) {
    return callResponsesImageApiSingle(opts)
  }

  const promises = Array.from({ length: n }).map(async (_, index) => {
    if (index > 0) await sleep(index * PARALLEL_REQUEST_STAGGER_MS)
    return callResponsesImageApiSingle({ ...opts, params: { ...opts.params, n: 1 } })
  })
  const results = await Promise.allSettled(promises)

  const successfulResults = results
    .filter((result): result is PromiseFulfilledResult<CallApiResult> => result.status === 'fulfilled')
    .map((result) => result.value)

  if (successfulResults.length === 0) {
    const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (firstError) throw firstError.reason
    throw new Error('所有并发请求均失败')
  }

  const images = successfulResults.flatMap((result) => result.images)
  const actualParamsList = successfulResults.flatMap((result) =>
    result.actualParamsList?.length ? result.actualParamsList : result.images.map(() => result.actualParams),
  )
  const revisedPrompts = successfulResults.flatMap((result) =>
    result.revisedPrompts?.length ? result.revisedPrompts : result.images.map(() => undefined),
  )
  const actualParams = mergeActualParams(
    successfulResults[0]?.actualParams,
    codexActualParams(opts.settings),
    { n: images.length },
  )

  return { images, actualParams, actualParamsList, revisedPrompts }
}

async function callResponsesImageApiSingle(opts: CallApiOptions): Promise<CallApiResult> {
  const { settings, prompt, params, inputImageDataUrls } = opts
  const mime = MIME_MAP[params.output_format] || 'image/png'
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = settings.apiProxy && isApiProxyAvailable(proxyConfig)
  const requestHeaders = createRequestHeaders(settings, opts.sessionToken)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), settings.timeout * 1000)

  try {
    if (opts.maskDataUrl) {
      assertMaskEditFileSize('遮罩主图文件', getDataUrlDecodedByteSize(inputImageDataUrls[0] ?? ''))
      assertMaskEditFileSize('遮罩文件', getDataUrlDecodedByteSize(opts.maskDataUrl))
    }
    assertImageInputPayloadSize(
      inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0) +
        (opts.maskDataUrl ? getDataUrlEncodedByteSize(opts.maskDataUrl) : 0),
    )

    const body = {
      model: settings.model,
      input: createResponsesInput(prompt, inputImageDataUrls),
      tools: [createResponsesImageTool(params, inputImageDataUrls.length > 0, settings, opts.maskDataUrl)],
      tool_choice: 'required',
    }

    const response = await fetch(buildApiUrl(settings.baseUrl, getEndpointPath(settings, 'responses'), proxyConfig, useApiProxy), {
      method: 'POST',
      headers: {
        ...requestHeaders,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response))
    }

    const payload = await response.json() as ResponsesApiResponse
    const imageResults = parseResponsesImageResults(payload, mime)
    const actualParams = mergeActualParams(
      imageResults[0]?.actualParams,
      codexActualParams(settings),
    )
    return {
      images: imageResults.map((result) => result.image),
      actualParams,
      actualParamsList: imageResults.map((result) => mergeActualParams(result.actualParams, codexActualParams(settings))),
      revisedPrompts: imageResults.map((result) => result.revisedPrompt),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
