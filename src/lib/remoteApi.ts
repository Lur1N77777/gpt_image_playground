import type { ApiMode, AppSettings, OutputSlotStatus, TaskOutputSlot, TaskParams, TaskRecord } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { sessionHeaders } from './authApi'
import { normalizeBaseUrl } from './devProxy'

export const REMOTE_IMAGE_PREFIX = 'remote:'

export interface RemoteJob {
  id: string
  userId?: string | null
  username?: string | null
  prompt: string
  params: TaskParams
  model: string
  apiMode?: ApiMode
  codexCli?: boolean
  inputImageKeys: string[]
  maskTargetImageKey?: string | null
  maskImageKey?: string | null
  outputImageKeys: string[]
  outputSlots?: RemoteOutputSlot[]
  actualParams?: Partial<TaskParams>
  status: 'queued' | 'running' | 'done' | 'error'
  error: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
  elapsed: number | null
  isFavorite?: boolean
}

export interface RemoteOutputSlot {
  index: number
  key: string | null
  status: OutputSlotStatus
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  actualParams?: Partial<TaskParams>
  revisedPrompt?: string
}

export function isRemoteImageId(id: string): boolean {
  return id.startsWith(REMOTE_IMAGE_PREFIX)
}

function encodeImageKey(key: string): string {
  return btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeImageKey(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return atob(padded)
}

export function makeRemoteImageId(key: string): string {
  return `${REMOTE_IMAGE_PREFIX}${encodeImageKey(key)}`
}

export function remoteImageIdToKey(id: string): string {
  const value = id.startsWith(REMOTE_IMAGE_PREFIX) ? id.slice(REMOTE_IMAGE_PREFIX.length) : id
  try {
    return decodeImageKey(value)
  } catch {
    return value
  }
}

function buildRemoteApiUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl).replace(/\/+$/, '')
  return `${base}/${path.replace(/^\/+/, '')}`
}

function buildBackendApiUrl(path: string): string {
  return buildRemoteApiUrl(DEFAULT_SETTINGS.baseUrl, path)
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('Content-Type') || ''
  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch {
    throw new Error(`HTTP ${response.status}：无法读取响应体`)
  }

  const trimmed = bodyText.trim()
  const looksLikeJson = contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')

  if (!looksLikeJson) {
    const preview = trimmed.slice(0, 300).replace(/\s+/g, ' ')
    const isHtml = /^<(?:!doctype|html|head|body)/i.test(trimmed)
    const hint = isHtml
      ? '后端返回了 HTML 而非 JSON（很可能是 Cloudflare 错误页或登录页）'
      : '后端返回了非 JSON 响应'
    throw new Error(
      `${hint}。HTTP ${response.status}，Content-Type: ${contentType || '(空)'}，响应预览: ${preview}`,
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(bodyText)
  } catch {
    throw new Error(`JSON 解析失败 (HTTP ${response.status}): ${bodyText.slice(0, 200)}`)
  }

  if (response.ok) return payload as T

  let message = `HTTP ${response.status}`
  const errorPayload = payload as { error?: string | { message?: string }, message?: string } | null
  if (typeof errorPayload?.error === 'string') message = errorPayload.error
  else if (errorPayload?.error && typeof errorPayload.error === 'object' && errorPayload.error.message) message = errorPayload.error.message
  else if (errorPayload?.message) message = errorPayload.message

  throw new Error(message)
}

function hasParams(value: Partial<TaskParams> | undefined): value is Partial<TaskParams> {
  return Boolean(value && Object.keys(value).length > 0)
}

export function remoteJobToTask(job: RemoteJob): TaskRecord {
  const rawOutputSlots: TaskOutputSlot[] = Array.isArray(job.outputSlots) && job.outputSlots.length
    ? job.outputSlots.map((slot, fallbackIndex) => {
      const imageId = slot.key ? makeRemoteImageId(slot.key) : null
      return {
        index: Number.isFinite(slot.index) ? slot.index : fallbackIndex + 1,
        imageId,
        status: slot.status,
        error: slot.error || null,
        startedAt: slot.startedAt ?? null,
        finishedAt: slot.finishedAt ?? null,
        actualParams: hasParams(slot.actualParams) ? slot.actualParams : undefined,
        revisedPrompt: typeof slot.revisedPrompt === 'string' && slot.revisedPrompt.trim() ? slot.revisedPrompt : undefined,
      }
    })
    : job.outputImageKeys.map((key, index) => ({
      index: index + 1,
      imageId: makeRemoteImageId(key),
      status: 'done' as const,
      error: null,
      startedAt: null,
      finishedAt: null,
    }))
  const hasCompletedImages = rawOutputSlots.some((slot) => slot.imageId)
  const shouldHideFailedSlots = job.status !== 'running' && hasCompletedImages
  const outputSlots = shouldHideFailedSlots
    ? rawOutputSlots
      .filter((slot) => slot.imageId)
      .map((slot, index) => ({
        ...slot,
        index: index + 1,
        status: 'done' as const,
        error: null,
      }))
    : rawOutputSlots
  const outputImages = outputSlots.flatMap((slot) => (slot.imageId ? [slot.imageId] : []))
  const actualParamsByImage: Record<string, Partial<TaskParams>> = {}
  const revisedPromptByImage: Record<string, string> = {}

  for (const slot of outputSlots) {
    if (!slot.imageId) continue
    if (hasParams(slot.actualParams)) actualParamsByImage[slot.imageId] = slot.actualParams
    if (slot.revisedPrompt?.trim()) revisedPromptByImage[slot.imageId] = slot.revisedPrompt
  }

  const actualParams = hasParams(job.actualParams)
    ? job.actualParams
    : outputImages.length > 0
      ? { n: outputImages.length }
      : undefined

  return {
    id: job.id,
    userId: job.userId,
    username: job.username,
    prompt: job.prompt,
    params: job.params,
    apiMode: job.apiMode,
    codexCli: Boolean(job.codexCli),
    actualParams,
    actualParamsByImage: Object.keys(actualParamsByImage).length ? actualParamsByImage : undefined,
    revisedPromptByImage: Object.keys(revisedPromptByImage).length ? revisedPromptByImage : undefined,
    inputImageIds: job.inputImageKeys.map(makeRemoteImageId),
    maskTargetImageId: job.maskTargetImageKey ? makeRemoteImageId(job.maskTargetImageKey) : null,
    maskImageId: job.maskImageKey ? makeRemoteImageId(job.maskImageKey) : null,
    outputImages,
    outputSlots,
    status: shouldHideFailedSlots ? 'done' : job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : 'running',
    error: shouldHideFailedSlots ? null : job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    elapsed: job.elapsed,
    remote: true,
    isFavorite: Boolean(job.isFavorite),
  }
}

export async function createRemoteJob(opts: {
  settings: AppSettings
  sessionToken: string
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskTargetImageId?: string | null
  maskDataUrl?: string
}): Promise<TaskRecord> {
  const response = await fetch(buildBackendApiUrl('jobs'), {
    method: 'POST',
    headers: {
      ...sessionHeaders(opts.sessionToken),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      model: opts.settings.model,
      apiMode: opts.settings.apiMode,
      codexCli: opts.settings.codexCli,
      upstream: {
        baseUrl: opts.settings.baseUrl,
        apiKey: opts.settings.apiKey,
        apiPaths: opts.settings.apiPaths,
      },
      prompt: opts.prompt,
      params: opts.params,
      inputImageDataUrls: opts.inputImageDataUrls,
      maskTargetImageId: opts.maskTargetImageId,
      maskDataUrl: opts.maskDataUrl,
    }),
  })

  const payload = await readJsonResponse<{ job: RemoteJob }>(response)
  return remoteJobToTask(payload.job)
}

export async function listRemoteJobs(settings: AppSettings, sessionToken: string): Promise<TaskRecord[]> {
  const response = await fetch(buildBackendApiUrl('jobs'), {
    method: 'GET',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })

  const payload = await readJsonResponse<{ jobs: RemoteJob[] }>(response)
  return payload.jobs.map(remoteJobToTask)
}

export async function updateRemoteJobFavorite(
  settings: AppSettings,
  jobId: string,
  isFavorite: boolean,
  sessionToken: string,
): Promise<TaskRecord> {
  const response = await fetch(buildBackendApiUrl(`jobs/${encodeURIComponent(jobId)}`), {
    method: 'PATCH',
    headers: {
      ...sessionHeaders(sessionToken),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({ isFavorite }),
  })

  const payload = await readJsonResponse<{ job: RemoteJob }>(response)
  return remoteJobToTask(payload.job)
}

export async function deleteRemoteJob(settings: AppSettings, jobId: string, sessionToken: string): Promise<void> {
  const response = await fetch(buildBackendApiUrl(`jobs/${encodeURIComponent(jobId)}`), {
    method: 'DELETE',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })

  await readJsonResponse<{ ok: boolean }>(response)
}

export async function deleteRemoteJobOutputImage(
  settings: AppSettings,
  jobId: string,
  imageId: string,
  sessionToken: string,
): Promise<TaskRecord> {
  const keyToken = imageId.startsWith(REMOTE_IMAGE_PREFIX)
    ? imageId.slice(REMOTE_IMAGE_PREFIX.length)
    : encodeImageKey(imageId)
  const response = await fetch(
    buildBackendApiUrl(`jobs/${encodeURIComponent(jobId)}/images/${encodeURIComponent(keyToken)}`),
    {
      method: 'DELETE',
      headers: sessionHeaders(sessionToken),
      cache: 'no-store',
    },
  )

  const payload = await readJsonResponse<{ job: RemoteJob }>(response)
  return remoteJobToTask(payload.job)
}

export async function fetchRemoteImageAsDataUrl(settings: AppSettings, imageId: string, sessionToken: string): Promise<string> {
  const keyToken = imageId.startsWith(REMOTE_IMAGE_PREFIX)
    ? imageId.slice(REMOTE_IMAGE_PREFIX.length)
    : encodeImageKey(imageId)
  const response = await fetch(buildBackendApiUrl(`images/${encodeURIComponent(keyToken)}`), {
    method: 'GET',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`图片下载失败：HTTP ${response.status}`)
  }

  const blob = await response.blob()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`
}

