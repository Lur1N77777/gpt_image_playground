import {
  authenticateRequest,
  canAccessJob,
  CORS_HEADERS,
  getJob,
  getJobIdFromImageKey,
  getSingleParam,
  isAuthError,
  jsonResponse,
  optionsResponse,
  type PagesContext,
} from '../../../_lib/server'

function decodeImageKey(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  try {
    return atob(padded)
  } catch {
    return decodeURIComponent(value)
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env, params } = context

  if (request.method === 'OPTIONS') return optionsResponse()

  const user = await authenticateRequest(request, env)
  if (isAuthError(user)) return user

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Only GET requests are supported.' }, 405)
  }

  const key = decodeImageKey(getSingleParam(params, 'key'))
  const jobId = getJobIdFromImageKey(key)
  const row = jobId ? await getJob(env, jobId) : null
  if (!row || !canAccessJob(user, row)) return jsonResponse({ error: 'Image not found.' }, 404)

  const object = key ? await env.IMAGE_BUCKET.get(key) : null
  if (!object) return jsonResponse({ error: 'Image not found.' }, 404)

  return new Response(object.body, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': object.httpMetadata?.contentType || 'image/png',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
