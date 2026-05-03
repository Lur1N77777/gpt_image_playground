import {
  buildUpstreamUrl,
  decodeBase64,
  extensionFromMime,
  getJob,
  outputMime,
  parseJsonArray,
  readErrorMessage,
  runScheduledCleanupIfDue,
  selectOpenAIApiKey,
  updateJobStatus,
  type Env,
  type JobMessage,
  type JobRow,
  type OutputSlot,
  type TaskParams,
} from '../functions/_lib/server'

interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

interface ResponsesOutputItem {
  type?: string
  result?: string | {
    b64_json?: string
    image?: string
    data?: string
  }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

interface ResponsesApiResponse {
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

interface GeneratedImage {
  bytes: Uint8Array
  mime: string
  actualParams?: Partial<TaskParams>
  revisedPrompt?: string
}

interface QueueMessage<T> {
  body: T
}

interface MessageBatch<T> {
  messages: QueueMessage<T>[]
}

interface ScheduledController {
  scheduledTime: number
}

const NO_BODY_STATUS = 204
const TRANSIENT_UPSTREAM_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 520, 522, 523, 524])
const PARALLEL_REQUEST_STAGGER_MS = 1000

class UpstreamHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message || `HTTP ${status}`)
    this.name = 'UpstreamHttpError'
  }
}

function getMaxAttempts(env: Env): number {
  const configured = Number(env.IMAGE_MAX_ATTEMPTS || 2)
  if (!Number.isFinite(configured)) return 2
  return Math.max(1, Math.min(5, Math.floor(configured)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientError(error: unknown): boolean {
  return error instanceof UpstreamHttpError && TRANSIENT_UPSTREAM_STATUS.has(error.status)
}

async function buildOpenAIHeaders(env: Env, contentType?: string, explicitApiKey?: string): Promise<Headers> {
  const apiKey = explicitApiKey || await selectOpenAIApiKey(env)
  const headers = new Headers({
    Authorization: `Bearer ${apiKey}`,
    'Cache-Control': 'no-store, no-cache, max-age=0',
    Pragma: 'no-cache',
  })
  if (contentType) headers.set('Content-Type', contentType)
  return headers
}

function normalizeWorkerBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function resolveUpstreamUrl(
  env: Env,
  upstream: JobMessage['upstream'] | undefined,
  pathKey: 'imagesGenerations' | 'imagesEdits' | 'responses',
  fallbackPath: string,
): string {
  const baseUrl = normalizeWorkerBaseUrl(upstream?.baseUrl || env.OPENAI_BASE_URL || 'https://api.openai.com')
  const customPath = upstream?.apiPaths?.[pathKey]
  const path = customPath ? customPath.replace(/^\/+/, '').replace(/\/+$/, '') : fallbackPath
  if (/^https?:\/\//i.test(path)) return path
  if (baseUrl.endsWith(`/${path}`) || baseUrl.endsWith(`/v1/${path}`) || baseUrl.endsWith(`/${fallbackPath}`)) {
    return baseUrl
  }
  return buildUpstreamUrl(baseUrl, path)
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

async function r2ObjectToDataUrl(object: { blob(): Promise<Blob>, httpMetadata?: { contentType?: string } }): Promise<string> {
  const blob = await object.blob()
  const mime = blob.type || object.httpMetadata?.contentType || 'image/png'
  return `data:${mime};base64,${arrayBufferToBase64(await blob.arrayBuffer())}`
}

function createResponsesImageTool(
  params: TaskParams,
  isEdit: boolean,
  codexCli: boolean,
  maskDataUrl?: string,
): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    action: isEdit ? 'edit' : 'generate',
    size: params.size,
    output_format: params.output_format,
  }

  if (!codexCli) {
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

function codexActualParams(codexCli: boolean): Partial<TaskParams> | undefined {
  return codexCli ? { quality: 'auto' } : undefined
}

function createCodexPrompt(prompt: string): string {
  return `Use the following text as the complete prompt. Do not rewrite it:\n${prompt}`
}

function isCodexCliJob(row: JobRow): boolean {
  return Boolean(row.codex_cli)
}

async function readImagesFromImagesResponse(response: Response, fallbackMime: string, codexCli: boolean): Promise<GeneratedImage[]> {
  if (!response.ok) {
    throw new UpstreamHttpError(response.status, await readErrorMessage(response))
  }

  if (response.status === NO_BODY_STATUS) {
    throw new Error('接口未返回图片数据')
  }

  const payload = await response.json() as ImageApiResponse
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error('接口未返回图片数据')
  }

  const payloadParams = pickActualParams(payload)
  const images: GeneratedImage[] = []
  for (const item of payload.data) {
    const actualParams = mergeActualParams(payloadParams, pickActualParams(item), codexActualParams(codexCli))
    const revisedPrompt = typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined
    if (item.b64_json) {
      images.push({ bytes: decodeBase64(item.b64_json), mime: fallbackMime, actualParams, revisedPrompt })
      continue
    }

    if (item.url && /^https?:\/\//i.test(item.url)) {
      const imageResponse = await fetch(item.url, { cache: 'no-store' })
      if (!imageResponse.ok) {
        throw new Error(`图片 URL 下载失败：HTTP ${imageResponse.status}`)
      }
      images.push({
        bytes: new Uint8Array(await imageResponse.arrayBuffer()),
        mime: imageResponse.headers.get('Content-Type') || fallbackMime,
        actualParams,
        revisedPrompt,
      })
    }
  }

  if (images.length === 0) {
    throw new Error('接口未返回可用图片数据')
  }

  return images
}

async function readImagesFromResponsesResponse(response: Response, fallbackMime: string, codexCli: boolean): Promise<GeneratedImage[]> {
  if (!response.ok) {
    throw new UpstreamHttpError(response.status, await readErrorMessage(response))
  }

  if (response.status === NO_BODY_STATUS) {
    throw new Error('接口未返回图片数据')
  }

  const payload = await response.json() as ResponsesApiResponse
  if (!Array.isArray(payload.output) || payload.output.length === 0) {
    throw new Error('接口未返回图片数据')
  }

  const toolParams = mergeActualParams(...(payload.tools || []).map(pickActualParams))
  const images: GeneratedImage[] = []
  for (const item of payload.output) {
    if (item?.type !== 'image_generation_call') continue
    const image = extractResponsesImageResult(item.result)
    if (!image) continue
    images.push({
      bytes: decodeBase64(image.startsWith('data:') ? image.replace(/^data:[^;]+;base64,/, '') : image),
      mime: fallbackMime,
      actualParams: mergeActualParams(toolParams, pickActualParams(item), codexActualParams(codexCli)),
      revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
    })
  }

  if (images.length === 0) {
    throw new Error('接口未返回可用图片数据')
  }

  return images
}

async function loadInputImageDataUrls(env: Env, inputImageKeys: string[]): Promise<string[]> {
  const dataUrls: string[] = []
  for (const key of inputImageKeys) {
    const object = await env.IMAGE_BUCKET.get(key)
    if (!object) throw new Error(`参考图不存在：${key}`)
    dataUrls.push(await r2ObjectToDataUrl(object))
  }
  return dataUrls
}

async function callImagesApiOnce(
  env: Env,
  row: JobRow,
  params: TaskParams,
  inputImageKeys: string[],
  upstream?: JobMessage['upstream'],
): Promise<GeneratedImage[]> {
  const isEdit = inputImageKeys.length > 0
  const fallbackMime = outputMime(params.output_format)
  const codexCli = isCodexCliJob(row)
  const prompt = codexCli ? createCodexPrompt(row.prompt) : row.prompt

  if (isEdit) {
    const formData = new FormData()
    formData.append('model', row.model)
    formData.append('prompt', prompt)
    formData.append('size', params.size)
    if (!codexCli) {
      formData.append('quality', params.quality)
    }
    formData.append('output_format', params.output_format)
    formData.append('moderation', params.moderation)

    if (params.output_format !== 'png' && params.output_compression != null) {
      formData.append('output_compression', String(params.output_compression))
    }

    for (let i = 0; i < inputImageKeys.length; i++) {
      const key = inputImageKeys[i]
      const object = await env.IMAGE_BUCKET.get(key)
      if (!object) throw new Error(`参考图不存在：${key}`)

      const blob = await object.blob()
      const ext = extensionFromMime(blob.type || object.httpMetadata?.contentType || 'image/png')
      formData.append('image[]', blob, `input-${i + 1}.${ext}`)
    }

    if (row.mask_image_key) {
      const object = await env.IMAGE_BUCKET.get(row.mask_image_key)
      if (!object) throw new Error(`遮罩图片不存在：${row.mask_image_key}`)
      const blob = await object.blob()
      formData.append('mask', blob, 'mask.png')
    }

    return readImagesFromImagesResponse(await fetch(resolveUpstreamUrl(env, upstream, 'imagesEdits', 'v1/images/edits'), {
      method: 'POST',
      headers: await buildOpenAIHeaders(env, undefined, upstream?.apiKey),
      body: formData,
    }), fallbackMime, codexCli)
  }

  const body: Record<string, unknown> = {
    model: row.model,
    prompt,
    size: params.size,
    output_format: params.output_format,
    moderation: params.moderation,
  }

  if (!codexCli) {
    body.quality = params.quality
  }

  if (params.output_format !== 'png' && params.output_compression != null) {
    body.output_compression = params.output_compression
  }

  return readImagesFromImagesResponse(await fetch(resolveUpstreamUrl(env, upstream, 'imagesGenerations', 'v1/images/generations'), {
    method: 'POST',
    headers: await buildOpenAIHeaders(env, 'application/json', upstream?.apiKey),
    body: JSON.stringify(body),
  }), fallbackMime, codexCli)
}

async function callResponsesApiOnce(
  env: Env,
  row: JobRow,
  params: TaskParams,
  inputImageKeys: string[],
  upstream?: JobMessage['upstream'],
): Promise<GeneratedImage[]> {
  const fallbackMime = outputMime(params.output_format)
  const codexCli = isCodexCliJob(row)
  const inputImageDataUrls = await loadInputImageDataUrls(env, inputImageKeys)
  let maskDataUrl: string | undefined
  if (row.mask_image_key) {
    const object = await env.IMAGE_BUCKET.get(row.mask_image_key)
    if (!object) throw new Error(`遮罩图片不存在：${row.mask_image_key}`)
    maskDataUrl = await r2ObjectToDataUrl(object)
  }
  const body = {
    model: row.model,
    input: createResponsesInput(row.prompt, inputImageDataUrls),
    tools: [createResponsesImageTool(params, inputImageKeys.length > 0, codexCli, maskDataUrl)],
    tool_choice: 'required',
  }

  return readImagesFromResponsesResponse(await fetch(resolveUpstreamUrl(env, upstream, 'responses', 'v1/responses'), {
    method: 'POST',
    headers: await buildOpenAIHeaders(env, 'application/json', upstream?.apiKey),
    body: JSON.stringify(body),
  }), fallbackMime, codexCli)
}

async function callImageApiOnce(
  env: Env,
  row: JobRow,
  params: TaskParams,
  inputImageKeys: string[],
  upstream?: JobMessage['upstream'],
): Promise<GeneratedImage[]> {
  return row.api_mode === 'responses'
    ? callResponsesApiOnce(env, row, params, inputImageKeys, upstream)
    : callImagesApiOnce(env, row, params, inputImageKeys, upstream)
}

async function processJob(env: Env, jobId: string, upstream?: JobMessage['upstream']): Promise<void> {
  const row = await getJob(env, jobId)
  if (!row || row.status === 'done') return

  const startedAt = Date.now()
  await updateJobStatus(env, jobId, {
    status: 'running',
    error: null,
    startedAt,
    finishedAt: null,
    elapsed: null,
  })

  const params = JSON.parse(row.params_json) as TaskParams
  const inputImageKeys = parseJsonArray(row.input_image_keys_json)
  const targetCount = Math.max(1, Math.min(10, Number(params.n || 1)))
  const maxAttempts = getMaxAttempts(env)
  const outputSlots: OutputSlot[] = Array.from({ length: targetCount }, (_, index) => ({
    index: index + 1,
    key: null,
    status: 'queued',
    error: null,
    startedAt: null,
    finishedAt: null,
  }))

  const snapshotOutputSlots = () => outputSlots.map((slot) => ({ ...slot }))

  const completedOutputSlots = () => outputSlots
    .filter((slot) => Boolean(slot.key))
    .map((slot, index) => ({
      ...slot,
      index: index + 1,
      status: 'done' as const,
      error: null,
    }))

  const setSlot = (slotIndex: number, patch: Partial<OutputSlot>) => {
    outputSlots[slotIndex] = {
      ...outputSlots[slotIndex],
      ...patch,
      index: slotIndex + 1,
    }
  }

  const generateSlot = async (slotIndex: number): Promise<void> => {
    await sleep(slotIndex * PARALLEL_REQUEST_STAGGER_MS)
    setSlot(slotIndex, {
      status: 'running',
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    })
    await updateJobStatus(env, jobId, {
      status: 'running',
      error: null,
      outputImageKeys: snapshotOutputSlots(),
      finishedAt: null,
      elapsed: null,
    })

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const [image] = await callImageApiOnce(env, row, { ...params, n: 1 }, inputImageKeys, upstream)
        if (!image) throw new Error('接口未返回可用图片数据')

        const ext = extensionFromMime(image.mime)
        const key = `jobs/${jobId}/outputs/output-${slotIndex + 1}.${ext}`
        await env.IMAGE_BUCKET.put(key, image.bytes, {
          httpMetadata: { contentType: image.mime },
          customMetadata: { source: 'generated', slot: String(slotIndex + 1) },
        })

        setSlot(slotIndex, {
          key,
          status: 'done',
          error: null,
          finishedAt: Date.now(),
          actualParams: image.actualParams,
          revisedPrompt: image.revisedPrompt,
        })
        await updateJobStatus(env, jobId, {
          status: 'running',
          error: null,
          outputImageKeys: snapshotOutputSlots(),
          finishedAt: null,
          elapsed: null,
        })
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const shouldRetry = attempt < maxAttempts && isTransientError(error)

        if (!shouldRetry) {
          setSlot(slotIndex, {
            status: 'error',
            error: message,
            finishedAt: Date.now(),
          })
          await updateJobStatus(env, jobId, {
            status: 'running',
            error: `第 ${slotIndex + 1} 张生成失败：${message}`,
            outputImageKeys: snapshotOutputSlots(),
            finishedAt: null,
            elapsed: null,
          })
          throw new Error(`第 ${slotIndex + 1} 张生成失败：${message}`)
        }

        setSlot(slotIndex, {
          status: 'running',
          error: message,
        })
        await updateJobStatus(env, jobId, {
          status: 'running',
          error: `第 ${slotIndex + 1} 张生成失败，正在自动重试 ${attempt}/${maxAttempts - 1}：${message}`,
          outputImageKeys: snapshotOutputSlots(),
          finishedAt: null,
          elapsed: null,
        })
        await sleep(3000 * attempt)
      }
    }
  }

  try {
    const results = await Promise.allSettled(
      Array.from({ length: targetCount }, (_, index) => generateSlot(index)),
    )
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
    const completedSlots = completedOutputSlots()
    const hasCompletedImages = completedSlots.length > 0

    const finishedAt = Date.now()
    await updateJobStatus(env, jobId, {
      // 批量任务中只要有图片成功，就把失败 slot 自动清掉，只保留成功图片。
      // 如果全部失败，才把任务标记为 error，方便用户看到真正的失败原因。
      status: hasCompletedImages ? 'done' : 'error',
      error: hasCompletedImages ? null : (errors.length ? errors.join('；') : '接口未返回可用图片数据'),
      outputImageKeys: hasCompletedImages ? completedSlots : snapshotOutputSlots(),
      finishedAt,
      elapsed: finishedAt - row.created_at,
    })
  } catch (error) {
    const finishedAt = Date.now()
    const completedSlots = completedOutputSlots()
    const hasCompletedImages = completedSlots.length > 0
    await updateJobStatus(env, jobId, {
      status: hasCompletedImages ? 'done' : 'error',
      error: hasCompletedImages ? null : (error instanceof Error ? error.message : String(error)),
      outputImageKeys: hasCompletedImages ? completedSlots : snapshotOutputSlots(),
      finishedAt,
      elapsed: finishedAt - row.created_at,
    })
  }
}

export default {
  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await processJob(env, message.body.jobId, message.body.upstream)
    }
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const outcome = await runScheduledCleanupIfDue(env, controller.scheduledTime)
    if (outcome.skipped) {
      console.log(`cleanup skipped: reason=${outcome.reason} auto=${outcome.config.autoEnabled}`)
      return
    }

    const result = outcome.result
    console.log(
      `cleanup complete: matched=${result?.matched ?? 0} deleted=${result?.deleted ?? 0} cutoff=${
        new Date(result?.cutoff ?? controller.scheduledTime).toISOString()
      }`,
    )
  },
}
