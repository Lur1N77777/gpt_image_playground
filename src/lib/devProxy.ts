export interface DevProxyConfig {
  enabled: boolean
  prefix: string
  target: string
  changeOrigin: boolean
  secure: boolean
}

const DEFAULT_PROXY_PREFIX = '/api-proxy'

export function isRelativeApiBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim()
  return trimmed.startsWith('/') && !trimmed.startsWith('//')
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''
  if (isRelativeApiBaseUrl(trimmed)) return trimmed.replace(/\/+$/, '')

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathname = url.pathname.replace(/\/+$/, '')
    return `${url.origin}${pathname === '/' ? '' : pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeDevProxyConfig(input: unknown): DevProxyConfig | null {
  if (!input || typeof input !== 'object') return null

  const record = input as Record<string, unknown>
  const target = normalizeBaseUrl(typeof record.target === 'string' ? record.target : '')
  if (!target) return null

  const rawPrefix = typeof record.prefix === 'string' ? record.prefix : DEFAULT_PROXY_PREFIX
  const trimmedPrefix = rawPrefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const prefix = trimmedPrefix ? `/${trimmedPrefix}` : DEFAULT_PROXY_PREFIX

  return {
    enabled: Boolean(record.enabled),
    prefix,
    target,
    changeOrigin: record.changeOrigin !== false,
    secure: Boolean(record.secure),
  }
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  proxyConfig?: DevProxyConfig | null,
  useApiProxy = false,
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const endpointPath = path.replace(/^\/+/, '')
  const normalizedPath = normalizedBaseUrl.replace(/\/+$/, '')
  if (/^https?:\/\//i.test(endpointPath) || isRelativeApiBaseUrl(endpointPath)) {
    return endpointPath
  }

  if (
    normalizedPath.endsWith(`/${endpointPath}`) ||
    normalizedPath.endsWith(`/v1/${endpointPath}`)
  ) {
    return normalizedPath
  }

  const apiPath = normalizedBaseUrl.endsWith('/v1')
    ? endpointPath
    : ['v1', endpointPath].join('/')

  if (useApiProxy) {
    return `${proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX}/${apiPath}`
  }

  return normalizedBaseUrl ? `${normalizedBaseUrl}/${apiPath}` : `/${apiPath}`
}

export function resolveDevProxyConfig(input: unknown, isDev: boolean): DevProxyConfig | null {
  if (!isDev) return null
  return normalizeDevProxyConfig(input)
}

export function readClientDevProxyConfig(): DevProxyConfig | null {
  return resolveDevProxyConfig(
    typeof __DEV_PROXY_CONFIG__ === 'undefined' ? null : __DEV_PROXY_CONFIG__,
    import.meta.env.DEV,
  )
}

export function isApiProxyAvailable(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return import.meta.env.VITE_API_PROXY_AVAILABLE === 'true' || Boolean(proxyConfig?.enabled)
}
