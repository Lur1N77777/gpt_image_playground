import type { AppSettings } from '../types'
import { sessionHeaders } from './authApi'
import { normalizeBaseUrl } from './devProxy'

export interface CleanupConfig {
  retentionHours: number
  intervalHours: number
  autoEnabled: boolean
  lastCleanupAt: number | null
  nextCleanupAt: number | null
}

export interface CleanupSummary {
  dryRun: boolean
  config: CleanupConfig
  cutoff?: number
  retentionMs?: number
  matched: number
  deleted?: number
  jobIds: string[]
}

function buildCleanupUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl).replace(/\/+$/, '')}/cleanup`
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>

  let message = `HTTP ${response.status}`
  try {
    const payload = await response.json() as { error?: string | { message?: string }, message?: string }
    if (typeof payload.error === 'string') message = payload.error
    else if (payload.error?.message) message = payload.error.message
    else if (payload.message) message = payload.message
  } catch {
    /* ignore */
  }

  throw new Error(message)
}

export async function getCleanupSummary(settings: AppSettings, sessionToken: string): Promise<CleanupSummary> {
  const response = await fetch(buildCleanupUrl(settings.baseUrl), {
    method: 'GET',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })
  return readJsonResponse<CleanupSummary>(response)
}

export async function saveCleanupSettings(
  settings: AppSettings,
  sessionToken: string,
  config: { retentionHours: number, intervalHours: number },
): Promise<CleanupConfig> {
  const response = await fetch(buildCleanupUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      ...sessionHeaders(sessionToken),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({ action: 'saveConfig', ...config }),
  })
  const payload = await readJsonResponse<{ ok: boolean, config: CleanupConfig }>(response)
  return payload.config
}

export async function runCleanup(
  settings: AppSettings,
  sessionToken: string,
  config: { dryRun: boolean, retentionHours?: number, intervalHours?: number },
): Promise<CleanupSummary> {
  const response = await fetch(buildCleanupUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      ...sessionHeaders(sessionToken),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(config),
  })
  return readJsonResponse<CleanupSummary>(response)
}
