import {
  authenticateRequest,
  isAuthError,
  jsonResponse,
  optionsResponse,
  setUserGenerationMode,
  type PagesContext,
} from '../../../_lib/server'

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'GET' && request.method !== 'PATCH') {
    return jsonResponse({ error: 'Only GET and PATCH requests are supported.' }, 405)
  }

  const user = await authenticateRequest(request, env)
  if (isAuthError(user)) return user

  if (request.method === 'PATCH') {
    let body: { generationMode?: unknown }
    try {
      body = await request.json() as { generationMode?: unknown }
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body.' }, 400)
    }

    try {
      return jsonResponse({ user: await setUserGenerationMode(env, user, body.generationMode) })
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 403)
    }
  }

  return jsonResponse({ user })
}
