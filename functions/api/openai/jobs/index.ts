import {
  type ApiMode,
  authenticateRequest,
  decodeDataUrl,
  extensionFromMime,
  getJob,
  insertJob,
  isAuthError,
  jsonResponse,
  listJobs,
  optionsResponse,
  rowToRemoteJob,
  type PagesContext,
  type TaskParams,
} from '../../../_lib/server'

interface CreateJobRequest {
  model?: unknown
  apiMode?: unknown
  codexCli?: unknown
  upstream?: unknown
  prompt?: unknown
  params?: Partial<TaskParams>
  inputImageDataUrls?: unknown
  maskTargetImageId?: unknown
  maskDataUrl?: unknown
}

function sanitizePath(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed || fallback
}

function sanitizeUpstream(value: unknown): {
  baseUrl?: string
  apiKey?: string
  apiPaths?: {
    imagesGenerations?: string
    imagesEdits?: string
    responses?: string
  }
} | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  const apiPathsRecord = record.apiPaths && typeof record.apiPaths === 'object'
    ? record.apiPaths as Record<string, unknown>
    : {}
  const apiPaths = {
    imagesGenerations: sanitizePath(apiPathsRecord.imagesGenerations, 'images/generations'),
    imagesEdits: sanitizePath(apiPathsRecord.imagesEdits, 'images/edits'),
    responses: sanitizePath(apiPathsRecord.responses, 'responses'),
  }

  if (!baseUrl && !apiKey) return undefined
  if (baseUrl.startsWith('/')) return undefined
  return {
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    apiPaths,
  }
}

const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_RESPONSES_MODEL = 'gpt-5.5'
const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

function normalizeApiMode(value: unknown): ApiMode {
  return value === 'responses' ? 'responses' : 'images'
}

function normalizeParams(input: Partial<TaskParams> | undefined, codexCli = false): TaskParams {
  return {
    ...DEFAULT_PARAMS,
    ...(input || {}),
    quality: codexCli ? DEFAULT_PARAMS.quality : input?.quality ?? DEFAULT_PARAMS.quality,
    n: Math.max(1, Math.min(10, Number(input?.n || DEFAULT_PARAMS.n))),
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context

  if (request.method === 'OPTIONS') return optionsResponse()

  let step = 'authenticate'
  try {
    const user = await authenticateRequest(request, env)
    if (isAuthError(user)) return user

    if (request.method === 'GET') {
      step = 'list-jobs'
      return jsonResponse({ jobs: await listJobs(env, user) })
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Only GET and POST requests are supported.' }, 405)
    }

    if (!env.IMAGE_QUEUE) {
      return jsonResponse({ error: 'IMAGE_QUEUE is not configured.' }, 500)
    }
    if (!env.IMAGE_BUCKET) {
      return jsonResponse({ error: 'IMAGE_BUCKET (R2) is not configured. 请在 Pages 项目的 Settings → Functions → R2 bucket bindings 中添加 IMAGE_BUCKET 绑定。' }, 500)
    }
    if (!env.IMAGE_DB) {
      return jsonResponse({ error: 'IMAGE_DB (D1) is not configured.' }, 500)
    }

    step = 'parse-body'
    let body: CreateJobRequest
    try {
      body = await request.json() as CreateJobRequest
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body.' }, 400)
    }

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const inputImageDataUrls = Array.isArray(body.inputImageDataUrls)
      ? body.inputImageDataUrls.filter((value): value is string => typeof value === 'string')
      : []
    const maskDataUrl = typeof body.maskDataUrl === 'string' && body.maskDataUrl.trim()
      ? body.maskDataUrl
      : undefined

    if (!prompt && inputImageDataUrls.length === 0) {
      return jsonResponse({ error: '请输入提示词或添加参考图。' }, 400)
    }

    if (maskDataUrl && inputImageDataUrls.length === 0) {
      return jsonResponse({ error: '遮罩编辑需要至少一张参考图。' }, 400)
    }

    if (inputImageDataUrls.length > 16) {
      return jsonResponse({ error: '最多支持 16 张参考图。' }, 400)
    }

    const now = Date.now()
    const jobId = crypto.randomUUID()
    const inputImageKeys: string[] = []

    for (let i = 0; i < inputImageDataUrls.length; i++) {
      step = `decode-input-image-${i + 1}`
      let bytes: Uint8Array
      let mime: string
      try {
        ;({ bytes, mime } = decodeDataUrl(inputImageDataUrls[i]))
      } catch (err) {
        return jsonResponse({ error: `参考图 #${i + 1} 解码失败：${err instanceof Error ? err.message : String(err)}` }, 400)
      }
      const ext = extensionFromMime(mime)
      const key = `jobs/${jobId}/inputs/input-${i + 1}.${ext}`
      step = `r2-put-input-${i + 1} (size=${bytes.byteLength})`
      try {
        await env.IMAGE_BUCKET.put(key, bytes, {
          httpMetadata: { contentType: mime },
          customMetadata: { source: 'upload' },
        })
      } catch (err) {
        return jsonResponse({
          error: `R2 上传参考图 #${i + 1} 失败 (key=${key}, size=${bytes.byteLength} bytes): ${err instanceof Error ? err.message : String(err)}`,
        }, 500)
      }
      inputImageKeys.push(key)
    }

    let maskImageKey: string | null = null
    const maskTargetImageKey = maskDataUrl ? inputImageKeys[0] ?? null : null
    if (maskDataUrl) {
      step = 'decode-mask'
      let bytes: Uint8Array
      let mime: string
      try {
        ;({ bytes, mime } = decodeDataUrl(maskDataUrl))
      } catch (err) {
        return jsonResponse({ error: `遮罩解码失败：${err instanceof Error ? err.message : String(err)}` }, 400)
      }
      const ext = extensionFromMime(mime)
      maskImageKey = `jobs/${jobId}/mask/mask.${ext}`
      step = `r2-put-mask (size=${bytes.byteLength})`
      try {
        await env.IMAGE_BUCKET.put(maskImageKey, bytes, {
          httpMetadata: { contentType: mime },
          customMetadata: { source: 'mask' },
        })
      } catch (err) {
        return jsonResponse({
          error: `R2 上传遮罩失败 (key=${maskImageKey}, size=${bytes.byteLength} bytes): ${err instanceof Error ? err.message : String(err)}`,
        }, 500)
      }
    }

    const codexCli = body.codexCli === true
    const params = normalizeParams(body.params, codexCli)
    const apiMode = normalizeApiMode(body.apiMode)
    const model = typeof body.model === 'string' && body.model.trim()
      ? body.model.trim()
      : apiMode === 'responses'
        ? DEFAULT_RESPONSES_MODEL
        : DEFAULT_MODEL

    step = 'd1-insert-job'
    try {
      await insertJob(env, {
        id: jobId,
        userId: user.id,
        prompt,
        params,
        model,
        apiMode,
        codexCli,
        inputImageKeys,
        maskTargetImageKey,
        maskImageKey,
        now,
      })
    } catch (err) {
      return jsonResponse({ error: `D1 写入任务失败：${err instanceof Error ? err.message : String(err)}` }, 500)
    }

    step = 'queue-send'
    try {
      await env.IMAGE_QUEUE.send({ jobId, upstream: sanitizeUpstream(body.upstream) })
    } catch (err) {
      return jsonResponse({ error: `Queue 发送失败：${err instanceof Error ? err.message : String(err)}` }, 500)
    }

    step = 'd1-get-job'
    const row = await getJob(env, jobId)
    return jsonResponse({ job: row ? rowToRemoteJob(row) : null }, 202)
  } catch (err) {
    return jsonResponse({
      error: `任务处理失败 [step=${step}]：${err instanceof Error ? err.message : String(err)}`,
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
    }, 500)
  }
}
