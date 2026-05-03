import {
  authenticateRequest,
  deleteEmptyUsers,
  deleteUserAndData,
  isAuthError,
  jsonResponse,
  listUsers,
  optionsResponse,
  requireAdmin,
  type PagesContext,
} from '../../_lib/server'

interface DeleteUsersRequest {
  userId?: unknown
  deleteJobs?: unknown
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context

  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    return jsonResponse({ error: 'Only GET and DELETE requests are supported.' }, 405)
  }

  const user = await authenticateRequest(request, env)
  if (isAuthError(user)) return user

  const adminError = requireAdmin(user)
  if (adminError) return adminError

  if (request.method === 'GET') {
    return jsonResponse({ users: await listUsers(env) })
  }

  const url = new URL(request.url)
  const emptyOnly = url.searchParams.get('emptyOnly') === '1' || url.searchParams.get('emptyOnly') === 'true'

  if (emptyOnly) {
    const result = await deleteEmptyUsers(env)
    return jsonResponse({ ok: true, ...result, users: await listUsers(env) })
  }

  let body: DeleteUsersRequest
  try {
    body = await request.json() as DeleteUsersRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400)
  }

  const userId = typeof body.userId === 'string' ? body.userId : ''
  if (!userId) return jsonResponse({ error: '缺少 userId。' }, 400)
  if (userId === user.id) return jsonResponse({ error: '不能删除当前登录的 admin 用户。' }, 400)

  try {
    const result = await deleteUserAndData(env, userId, { deleteJobs: body.deleteJobs === true })
    if (!result) return jsonResponse({ error: 'User not found.' }, 404)
    return jsonResponse({ ok: true, ...result, users: await listUsers(env) })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
}
