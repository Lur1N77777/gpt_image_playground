import type { AdminUserSummary, AppSettings } from '../types'
import { sessionHeaders } from './authApi'
import { normalizeBaseUrl } from './devProxy'

function buildAdminUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
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

export async function listAdminUsers(settings: AppSettings, sessionToken: string): Promise<AdminUserSummary[]> {
  const response = await fetch(buildAdminUrl(settings.baseUrl, 'users'), {
    method: 'GET',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })

  const payload = await readJsonResponse<{ users: AdminUserSummary[] }>(response)
  return payload.users
}

export interface DeleteUsersResult {
  deletedUsers: number
  deletedJobs: number
  userIds: string[]
  usernames: string[]
  users: AdminUserSummary[]
}

export async function deleteEmptyAdminUsers(settings: AppSettings, sessionToken: string): Promise<DeleteUsersResult> {
  const response = await fetch(buildAdminUrl(settings.baseUrl, 'users?emptyOnly=1'), {
    method: 'DELETE',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })

  return readJsonResponse<DeleteUsersResult>(response)
}

export async function deleteAdminUser(
  settings: AppSettings,
  sessionToken: string,
  userId: string,
  opts: { deleteJobs?: boolean } = {},
): Promise<DeleteUsersResult> {
  const response = await fetch(buildAdminUrl(settings.baseUrl, 'users'), {
    method: 'DELETE',
    headers: {
      ...sessionHeaders(sessionToken),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      userId,
      deleteJobs: opts.deleteJobs === true,
    }),
  })

  return readJsonResponse<DeleteUsersResult>(response)
}
