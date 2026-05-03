import {
  authenticateRequest,
  canAccessJob,
  deleteJob,
  getJob,
  getSingleParam,
  isAuthError,
  jsonResponse,
  optionsResponse,
  rowToRemoteJob,
  updateJobFavorite,
  type PagesContext,
} from '../../../_lib/server'

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env, params } = context

  if (request.method === 'OPTIONS') return optionsResponse()

  const user = await authenticateRequest(request, env)
  if (isAuthError(user)) return user

  const id = getSingleParam(params, 'id')
  const row = id ? await getJob(env, id) : null
  if (!row) return jsonResponse({ error: 'Job not found.' }, 404)
  if (!canAccessJob(user, row)) return jsonResponse({ error: 'Job not found.' }, 404)

  if (request.method === 'GET') {
    return jsonResponse({ job: rowToRemoteJob(row) })
  }

  if (request.method === 'DELETE') {
    await deleteJob(env, row)
    return jsonResponse({ ok: true })
  }

  if (request.method === 'PATCH') {
    let body: { isFavorite?: unknown }
    try {
      body = await request.json() as { isFavorite?: unknown }
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body.' }, 400)
    }

    await updateJobFavorite(env, row.id, Boolean(body.isFavorite))
    const updated = await getJob(env, row.id)
    return jsonResponse({ job: rowToRemoteJob(updated || row) })
  }

  return jsonResponse({ error: 'Only GET, PATCH and DELETE requests are supported.' }, 405)
}
