import {
  authenticateRequest,
  buildUpstreamUrl,
  CORS_HEADERS,
  isAuthError,
  jsonResponse,
  optionsResponse,
  selectOpenAIApiKey,
  type PagesContext,
} from '../../_lib/server'

const ALLOWED_IMAGE_PATHS = new Set([
  'v1/images/generations',
  'v1/images/edits',
  'v1/responses',
])

const ALLOWED_GET_PATHS = new Set([
  'v1/models',
  'models',
])

function getPath(params: PagesContext['params']): string {
  const rawPath = params.path
  const path = Array.isArray(rawPath) ? rawPath.join('/') : rawPath ?? ''
  return path.replace(/^\/+/, '').replace(/\/+$/, '')
}

function buildForwardHeaders(request: Request, apiKey: string): Headers {
  const headers = new Headers()
  const contentType = request.headers.get('Content-Type')
  const accept = request.headers.get('Accept')

  if (contentType) headers.set('Content-Type', contentType)
  if (accept) headers.set('Accept', accept)

  headers.set('Authorization', `Bearer ${apiKey}`)
  headers.set('Cache-Control', 'no-store, no-cache, max-age=0')
  headers.set('Pragma', 'no-cache')

  return headers
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env, params } = context

  if (request.method === 'OPTIONS') return optionsResponse()

  if (request.method !== 'POST' && request.method !== 'GET') {
    return jsonResponse({ error: 'Only GET and POST requests are supported.' }, 405)
  }

  const user = await authenticateRequest(request, env)
  if (isAuthError(user)) return user

  if (request.method === 'POST' && (user.role !== 'admin' || user.generationMode !== 'local')) {
    return jsonResponse({ error: '只有开启本地生图模式的 admin 可以使用本地代理生图。' }, 403)
  }

  const path = getPath(params)
  const allowed = request.method === 'GET' ? ALLOWED_GET_PATHS : ALLOWED_IMAGE_PATHS
  if (!allowed.has(path)) {
    return jsonResponse({ error: 'Route is not allowed.' }, 404)
  }

  let apiKey: string
  try {
    apiKey = await selectOpenAIApiKey(env)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }

  const upstreamUrl = buildUpstreamUrl(env.OPENAI_BASE_URL || 'https://api.openai.com', path)
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: buildForwardHeaders(request, apiKey),
    body: request.method === 'GET' ? undefined : request.body,
  })

  const responseHeaders = new Headers(upstreamResponse.headers)
  responseHeaders.set('Cache-Control', 'no-store')
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(key, value)
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}
