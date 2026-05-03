import type { AuthUser } from '../types'
import { normalizeBaseUrl } from './devProxy'

export interface LoginResult {
  user: AuthUser
  token: string
  expiresAt: number
}

function buildAuthUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl).replace(/\/+$/, '')}/auth/${path.replace(/^\/+/, '')}`
}

export function sessionHeaders(sessionToken: string): Record<string, string> {
  return {
    'X-Session-Token': sessionToken,
    'Cache-Control': 'no-store, no-cache, max-age=0',
    Pragma: 'no-cache',
  }
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
    try {
      message = await response.text()
    } catch {
      /* ignore */
    }
  }

  throw new Error(message)
}

export async function loginWithPassword(baseUrl: string, username: string, password: string): Promise<LoginResult> {
  const response = await fetch(buildAuthUrl(baseUrl, 'login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, max-age=0',
      Pragma: 'no-cache',
    },
    cache: 'no-store',
    body: JSON.stringify({ username, password }),
  })

  return readJsonResponse<LoginResult>(response)
}

export async function getCurrentUser(baseUrl: string, sessionToken: string): Promise<AuthUser> {
  const response = await fetch(buildAuthUrl(baseUrl, 'me'), {
    method: 'GET',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })

  const payload = await readJsonResponse<{ user: AuthUser }>(response)
  return payload.user
}

export async function updateCurrentUserGenerationMode(
  baseUrl: string,
  sessionToken: string,
  generationMode: AuthUser['generationMode'],
): Promise<AuthUser> {
  const response = await fetch(buildAuthUrl(baseUrl, 'me'), {
    method: 'PATCH',
    headers: {
      ...sessionHeaders(sessionToken),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({ generationMode }),
  })

  const payload = await readJsonResponse<{ user: AuthUser }>(response)
  return payload.user
}

export async function logoutSession(baseUrl: string, sessionToken: string): Promise<void> {
  if (!sessionToken) return
  const response = await fetch(buildAuthUrl(baseUrl, 'logout'), {
    method: 'POST',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })

  await readJsonResponse<{ ok: boolean }>(response)
}
