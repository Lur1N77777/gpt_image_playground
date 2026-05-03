import {
  jsonResponse,
  optionsResponse,
  sessionTokenHash,
  type PagesContext,
} from '../../../_lib/server'

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Only POST requests are supported.' }, 405)
  }

  const token = request.headers.get('X-Session-Token') || ''
  if (token) {
    await env.IMAGE_DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sessionTokenHash(token))
      .run()
  }

  return jsonResponse({ ok: true })
}
