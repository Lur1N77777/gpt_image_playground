import {
  DEFAULT_API_PROFILE,
  DEFAULT_API_PROFILE_ID,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  type ApiMode,
  type ApiEndpointPaths,
  type ApiProfile,
  type AppSettings,
} from '../types'
import { isRelativeApiBaseUrl, normalizeBaseUrl } from './api'

export function newApiProfileId(): string {
  return `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function getDefaultModelForMode(apiMode: ApiMode): string {
  return apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL
}

export function createApiProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    ...DEFAULT_API_PROFILE,
    id: overrides.id || newApiProfileId(),
    name: overrides.name || '新配置',
    ...overrides,
    apiPaths: normalizeApiPaths(overrides.apiPaths),
  }
}

export function normalizeApiPath(path: unknown, fallback: string): string {
  if (typeof path !== 'string') return fallback
  const trimmed = path.trim()
  return trimmed ? trimmed.replace(/^\/+/, '').replace(/\/+$/, '') : fallback
}

export function normalizeApiPaths(input: unknown): ApiEndpointPaths {
  const record = input && typeof input === 'object' ? input as Partial<ApiEndpointPaths> : {}
  return {
    imagesGenerations: normalizeApiPath(record.imagesGenerations, DEFAULT_API_PROFILE.apiPaths.imagesGenerations),
    imagesEdits: normalizeApiPath(record.imagesEdits, DEFAULT_API_PROFILE.apiPaths.imagesEdits),
    responses: normalizeApiPath(record.responses, DEFAULT_API_PROFILE.apiPaths.responses),
    models: normalizeApiPath(record.models, DEFAULT_API_PROFILE.apiPaths.models),
  }
}

export function normalizeApiProfile(input: unknown, fallback: Partial<ApiProfile> = {}): ApiProfile {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const apiMode: ApiMode = record.apiMode === 'responses' ? 'responses' : 'images'
  const baseUrl = typeof record.baseUrl === 'string' ? normalizeBaseUrl(record.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl) : (fallback.baseUrl || DEFAULT_SETTINGS.baseUrl)
  const apiKey = isRelativeApiBaseUrl(baseUrl)
    ? ''
    : typeof record.apiKey === 'string'
      ? record.apiKey
      : fallback.apiKey || ''

  return {
    ...DEFAULT_API_PROFILE,
    ...fallback,
    id: typeof record.id === 'string' && record.id.trim() ? record.id : fallback.id || newApiProfileId(),
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallback.name || '新配置',
    baseUrl,
    apiKey,
    apiPaths: normalizeApiPaths(record.apiPaths ?? fallback.apiPaths),
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : fallback.model || getDefaultModelForMode(apiMode),
    timeout: typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : fallback.timeout || DEFAULT_SETTINGS.timeout,
    apiMode,
    codexCli: typeof record.codexCli === 'boolean' ? record.codexCli : Boolean(fallback.codexCli),
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : Boolean(fallback.apiProxy),
  }
}

export function getActiveApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const normalized = normalizeSettings(settings)
  return normalized.profiles.find((profile) => profile.id === normalized.activeProfileId) ?? normalized.profiles[0] ?? DEFAULT_API_PROFILE
}

export function normalizeSettings(input: Partial<AppSettings> | unknown): AppSettings {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const legacyApiMode: ApiMode = record.apiMode === 'responses' ? 'responses' : 'images'
  const legacyBaseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : DEFAULT_SETTINGS.baseUrl
  const legacyProfile = normalizeApiProfile({
    id: DEFAULT_API_PROFILE_ID,
    name: '默认后台代理',
    baseUrl: legacyBaseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    model: typeof record.model === 'string' ? record.model : getDefaultModelForMode(legacyApiMode),
    apiPaths: record.apiPaths,
    timeout: typeof record.timeout === 'number' ? record.timeout : DEFAULT_SETTINGS.timeout,
    apiMode: legacyApiMode,
    codexCli: typeof record.codexCli === 'boolean' ? record.codexCli : false,
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : false,
  })

  const rawProfiles = Array.isArray(record.profiles) && record.profiles.length ? record.profiles : [legacyProfile]
  const usedIds = new Set<string>()
  const profiles = rawProfiles.map((profile, index) => {
    const normalized = normalizeApiProfile(profile, index === 0 ? legacyProfile : {})
    let id = normalized.id || newApiProfileId()
    while (usedIds.has(id)) id = newApiProfileId()
    usedIds.add(id)
    return { ...normalized, id }
  })

  const activeProfileId = typeof record.activeProfileId === 'string' && profiles.some((profile) => profile.id === record.activeProfileId)
    ? record.activeProfileId
    : profiles[0].id
  const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]

  return {
    ...DEFAULT_SETTINGS,
    ...record,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
    apiPaths: active.apiPaths,
    timeout: active.timeout,
    apiMode: active.apiMode,
    codexCli: active.codexCli,
    apiProxy: active.apiProxy,
    imageCacheEnabled: typeof record.imageCacheEnabled === 'boolean' ? record.imageCacheEnabled : DEFAULT_SETTINGS.imageCacheEnabled,
    profiles,
    activeProfileId,
  }
}

export function applyActiveProfilePatch(settings: AppSettings, patch: Partial<ApiProfile>): AppSettings {
  const normalized = normalizeSettings(settings)
  const profiles = normalized.profiles.map((profile) =>
    profile.id === normalized.activeProfileId ? normalizeApiProfile({ ...profile, ...patch }, profile) : profile,
  )
  return normalizeSettings({ ...normalized, profiles })
}

export function switchActiveApiProfile(settings: AppSettings, id: string): AppSettings {
  return normalizeSettings({ ...settings, activeProfileId: id })
}
