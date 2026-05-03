export interface D1Result<T> {
  results: T[]
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run(): Promise<unknown>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

export interface R2ObjectBody {
  body: ReadableStream
  httpMetadata?: {
    contentType?: string
  }
  customMetadata?: Record<string, string>
  blob(): Promise<Blob>
}

export interface R2ListedObject {
  key: string
  size: number
  uploaded: Date
}

export interface R2ListResult {
  objects: R2ListedObject[]
  truncated: boolean
  cursor?: string
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  list(options?: { prefix?: string, cursor?: string, limit?: number }): Promise<R2ListResult>
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
}

export interface QueueBinding<T> {
  send(message: T): Promise<void>
}

export type ApiMode = 'images' | 'responses'
export type GenerationMode = 'cloud' | 'local'

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
}

export interface JobMessage {
  jobId: string
  upstream?: {
    baseUrl?: string
    apiKey?: string
    apiPaths?: {
      imagesGenerations?: string
      imagesEdits?: string
      responses?: string
    }
  }
}

export interface Env {
  IMAGE_DB: D1Database
  IMAGE_BUCKET: R2Bucket
  IMAGE_QUEUE?: QueueBinding<JobMessage>
  OPENAI_API_KEY?: string
  OPENAI_API_KEYS?: string
  APP_ACCESS_TOKEN?: string
  OPENAI_BASE_URL?: string
  CLEANUP_RETENTION_DAYS?: string
  IMAGE_MAX_ATTEMPTS?: string
  ADMIN_PASSWORD?: string
  AUTH_PEPPER?: string
}

export interface PagesContext {
  request: Request
  env: Env
  params: Record<string, string | string[] | undefined>
}

export interface JobRow {
  id: string
  user_id: string | null
  username?: string | null
  prompt: string
  params_json: string
  model: string
  api_mode?: ApiMode | null
  codex_cli?: number | null
  input_image_keys_json: string
  mask_target_image_key?: string | null
  mask_image_key?: string | null
  output_image_keys_json: string
  status: 'queued' | 'running' | 'done' | 'error'
  error: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
  elapsed: number | null
  is_favorite?: number | null
}

export interface RemoteJob {
  id: string
  userId?: string | null
  username?: string | null
  prompt: string
  params: TaskParams
  model: string
  apiMode: ApiMode
  codexCli: boolean
  inputImageKeys: string[]
  maskTargetImageKey?: string | null
  maskImageKey?: string | null
  outputImageKeys: string[]
  outputSlots: OutputSlot[]
  status: JobRow['status']
  error: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
  elapsed: number | null
  isFavorite: boolean
  actualParams?: Partial<TaskParams>
}

export type OutputSlotStatus = 'queued' | 'running' | 'done' | 'error'

export interface OutputSlot {
  index: number
  key: string | null
  status: OutputSlotStatus
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  actualParams?: Partial<TaskParams>
  revisedPrompt?: string
}

export interface UserRow {
  id: string
  username: string
  password_hash: string
  role: 'admin' | 'user'
  created_at: number
}

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'user'
  generationMode: GenerationMode
}

export interface AdminUserSummary {
  id: string
  username: string
  role: UserRow['role']
  createdAt: number
  jobCount: number
  doneCount: number
  runningCount: number
  errorCount: number
  lastJobAt: number | null
}

export interface DeleteUsersResult {
  deletedUsers: number
  deletedJobs: number
  userIds: string[]
  usernames: string[]
}

export interface CleanupConfig {
  retentionHours: number
  intervalHours: number
  autoEnabled: boolean
  lastCleanupAt: number | null
  nextCleanupAt: number | null
}

interface AppSettingRow {
  key: string
  value: string
  updated_at: number
}

interface UserSummaryRow {
  id: string
  username: string
  role: UserRow['role']
  created_at: number
  job_count: number
  done_count: number
  running_count: number
  error_count: number
  last_job_at: number | null
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Token, X-Session-Token, Authorization',
  'Access-Control-Max-Age': '86400',
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export function requireAppToken(request: Request, env: Env): Response | null {
  if (!env.APP_ACCESS_TOKEN) {
    return jsonResponse({ error: 'APP_ACCESS_TOKEN is not configured.' }, 500)
  }

  const appToken = request.headers.get('X-App-Token') ?? ''
  if (appToken !== env.APP_ACCESS_TOKEN) {
    return jsonResponse({ error: 'Invalid app access token.' }, 401)
  }

  return null
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

export function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function validateUsername(username: string): string | null {
  if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
    return '用户名只能包含小写字母、数字、下划线和横线，长度 2-32 位。'
  }
  return null
}

export async function passwordHash(env: Env, username: string, password: string): Promise<string> {
  const pepper = env.AUTH_PEPPER || env.APP_ACCESS_TOKEN || ''
  return sha256Hex(`${pepper}:${username}:${password}`)
}

export async function sessionTokenHash(token: string): Promise<string> {
  return sha256Hex(token)
}

export function createSessionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `${crypto.randomUUID()}.${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

export async function getUserByUsername(env: Env, username: string): Promise<UserRow | null> {
  return env.IMAGE_DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first<UserRow>()
}

export async function getUserById(env: Env, id: string): Promise<UserRow | null> {
  return env.IMAGE_DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<UserRow>()
}

function normalizeGenerationMode(value: unknown, role: UserRow['role'] | AuthUser['role']): GenerationMode {
  return role === 'admin' && value === 'local' ? 'local' : 'cloud'
}

function userGenerationModeKey(userId: string): string {
  return `user_generation_mode:${userId}`
}

export async function getUserGenerationMode(env: Env, user: Pick<UserRow | AuthUser, 'id' | 'role'>): Promise<GenerationMode> {
  if (user.role !== 'admin') return 'cloud'

  const row = await env.IMAGE_DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(userGenerationModeKey(user.id))
    .first<{ value: string }>()

  return normalizeGenerationMode(row?.value, user.role)
}

export async function toAuthUser(env: Env, user: Pick<UserRow | AuthUser, 'id' | 'username' | 'role'>): Promise<AuthUser> {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    generationMode: await getUserGenerationMode(env, user),
  }
}

export async function createUser(env: Env, username: string, password: string, role: UserRow['role']): Promise<UserRow> {
  const now = Date.now()
  const user: UserRow = {
    id: crypto.randomUUID(),
    username,
    password_hash: await passwordHash(env, username, password),
    role,
    created_at: now,
  }

  await env.IMAGE_DB.prepare(
    'INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(user.id, user.username, user.password_hash, user.role, user.created_at)
    .run()

  return user
}

export async function createSession(env: Env, user: AuthUser): Promise<{ token: string, expiresAt: number }> {
  const token = createSessionToken()
  const tokenHash = await sessionTokenHash(token)
  const now = Date.now()
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000

  await env.IMAGE_DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), user.id, tokenHash, now, expiresAt)
    .run()

  return { token, expiresAt }
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthUser | Response> {
  const authHeader = request.headers.get('Authorization') || ''
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]
  const token = request.headers.get('X-Session-Token') || bearer || ''

  if (!token) {
    return jsonResponse({ error: '请先登录。' }, 401)
  }

  const tokenHash = await sessionTokenHash(token)
  const row = await env.IMAGE_DB.prepare(
    `SELECT
       users.id,
       users.username,
       users.role,
       CASE
         WHEN users.role = 'admin' AND app_settings.value = 'local' THEN 'local'
         ELSE 'cloud'
       END AS generationMode
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     LEFT JOIN app_settings ON app_settings.key = ('user_generation_mode:' || users.id)
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  )
    .bind(tokenHash, Date.now())
    .first<AuthUser>()

  if (!row) {
    return jsonResponse({ error: '登录已过期，请重新登录。' }, 401)
  }

  return row
}

export function isAuthError(value: AuthUser | Response): value is Response {
  return value instanceof Response
}

export function requireAdmin(user: AuthUser): Response | null {
  return user.role === 'admin' ? null : jsonResponse({ error: '需要 admin 权限。' }, 403)
}

export function canAccessJob(user: AuthUser, row: JobRow): boolean {
  return user.role === 'admin' || row.user_id === user.id
}

export function getJobIdFromImageKey(key: string): string {
  const match = key.match(/^jobs\/([^/]+)\//)
  return match?.[1] || ''
}

export function getSingleParam(params: PagesContext['params'], key: string): string {
  const value = params[key]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): string[] => {
      if (typeof item === 'string') return [item]
      if (item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string') {
        return [(item as { key: string }).key]
      }
      return []
    })
  } catch {
    return []
  }
}

function normalizeOutputSlotStatus(value: unknown, key: string | null): OutputSlotStatus {
  if (value === 'queued' || value === 'running' || value === 'done' || value === 'error') return value
  return key ? 'done' : 'queued'
}

function makeOutputSlot(index: number, patch: Partial<OutputSlot> = {}): OutputSlot {
  const key = typeof patch.key === 'string' && patch.key ? patch.key : null
  const actualParams = patch.actualParams && Object.keys(patch.actualParams).length > 0 ? patch.actualParams : undefined
  return {
    index,
    key,
    status: normalizeOutputSlotStatus(patch.status, key),
    error: typeof patch.error === 'string' && patch.error ? patch.error : null,
    startedAt: typeof patch.startedAt === 'number' ? patch.startedAt : null,
    finishedAt: typeof patch.finishedAt === 'number' ? patch.finishedAt : null,
    actualParams,
    revisedPrompt: typeof patch.revisedPrompt === 'string' && patch.revisedPrompt.trim() ? patch.revisedPrompt : undefined,
  }
}

export function parseOutputSlots(
  value: string,
  targetCount: number,
  jobStatus?: JobRow['status'],
  jobError?: string | null,
): OutputSlot[] {
  const normalizedTargetCount = Math.max(1, Math.min(10, Number(targetCount || 1)))

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      const maxIndex = parsed.reduce((max, item, fallbackIndex) => {
        if (item && typeof item === 'object' && typeof (item as { index?: unknown }).index === 'number') {
          return Math.max(max, Math.floor((item as { index: number }).index))
        }
        return Math.max(max, fallbackIndex + 1)
      }, normalizedTargetCount)

      const slots = Array.from({ length: Math.max(normalizedTargetCount, maxIndex) }, (_, index) => makeOutputSlot(index + 1))

      parsed.forEach((item, fallbackIndex) => {
        if (typeof item === 'string') {
          slots[fallbackIndex] = makeOutputSlot(fallbackIndex + 1, {
            key: item,
            status: 'done',
          })
          return
        }

        if (!item || typeof item !== 'object') return
        const rawSlot = item as {
          index?: unknown
          key?: unknown
          status?: unknown
          error?: unknown
          startedAt?: unknown
          finishedAt?: unknown
          actualParams?: unknown
          revisedPrompt?: unknown
        }
        const index = typeof rawSlot.index === 'number' && Number.isFinite(rawSlot.index)
          ? Math.max(1, Math.floor(rawSlot.index))
          : fallbackIndex + 1
        const key = typeof rawSlot.key === 'string' && rawSlot.key ? rawSlot.key : null
        slots[index - 1] = makeOutputSlot(index, {
          key,
          status: normalizeOutputSlotStatus(rawSlot.status, key),
          error: typeof rawSlot.error === 'string' ? rawSlot.error : null,
          startedAt: typeof rawSlot.startedAt === 'number' ? rawSlot.startedAt : null,
          finishedAt: typeof rawSlot.finishedAt === 'number' ? rawSlot.finishedAt : null,
          actualParams: rawSlot.actualParams && typeof rawSlot.actualParams === 'object'
            ? rawSlot.actualParams as Partial<TaskParams>
            : undefined,
          revisedPrompt: typeof rawSlot.revisedPrompt === 'string' ? rawSlot.revisedPrompt : undefined,
        })
      })

      return slots
    }
  } catch {
    // Fall through to legacy reconstruction.
  }

  const keys = parseJsonArray(value)
  const slots = Array.from({ length: Math.max(normalizedTargetCount, keys.length) }, (_, index) => {
    const key = keys[index] || null
    if (key) return makeOutputSlot(index + 1, { key, status: 'done' })
    if (jobStatus === 'running' && index === keys.length) return makeOutputSlot(index + 1, { status: 'running' })
    if (jobStatus === 'error') return makeOutputSlot(index + 1, { status: 'error', error: jobError || null })
    return makeOutputSlot(index + 1)
  })
  return slots
}

export function rowToRemoteJob(row: JobRow): RemoteJob {
  const params = JSON.parse(row.params_json) as TaskParams
  const outputSlots = parseOutputSlots(row.output_image_keys_json, params.n, row.status, row.error)
  const completedCount = outputSlots.filter((slot) => slot.key).length
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    prompt: row.prompt,
    params,
    model: row.model,
    apiMode: row.api_mode === 'responses' ? 'responses' : 'images',
    codexCli: Boolean(row.codex_cli),
    inputImageKeys: parseJsonArray(row.input_image_keys_json),
    maskTargetImageKey: row.mask_target_image_key ?? null,
    maskImageKey: row.mask_image_key ?? null,
    outputImageKeys: outputSlots.flatMap((slot) => (slot.key ? [slot.key] : [])),
    outputSlots,
    actualParams: completedCount > 0 ? { n: completedCount } : undefined,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    elapsed: row.elapsed,
    isFavorite: Boolean(row.is_favorite),
  }
}

export async function listUsers(env: Env): Promise<AdminUserSummary[]> {
  const { results } = await env.IMAGE_DB.prepare(
    `SELECT
       users.id,
       users.username,
       users.role,
       users.created_at,
       COUNT(jobs.id) AS job_count,
       SUM(CASE WHEN jobs.status = 'done' THEN 1 ELSE 0 END) AS done_count,
       SUM(CASE WHEN jobs.status IN ('queued', 'running') THEN 1 ELSE 0 END) AS running_count,
       SUM(CASE WHEN jobs.status = 'error' THEN 1 ELSE 0 END) AS error_count,
       MAX(jobs.created_at) AS last_job_at
     FROM users
     LEFT JOIN jobs ON jobs.user_id = users.id
     GROUP BY users.id
     ORDER BY users.role = 'admin' DESC, job_count DESC, users.username ASC`,
  ).all<UserSummaryRow>()

  return results.map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
    jobCount: Number(row.job_count || 0),
    doneCount: Number(row.done_count || 0),
    runningCount: Number(row.running_count || 0),
    errorCount: Number(row.error_count || 0),
    lastJobAt: row.last_job_at,
  }))
}

export async function deleteUserAndData(
  env: Env,
  userId: string,
  opts: { deleteJobs?: boolean } = {},
): Promise<DeleteUsersResult | null> {
  const target = await getUserById(env, userId)
  if (!target) return null
  if (target.role === 'admin') {
    throw new Error('不能删除 admin 用户。')
  }

  const { results: jobs } = await env.IMAGE_DB.prepare('SELECT * FROM jobs WHERE user_id = ?')
    .bind(target.id)
    .all<JobRow>()

  if (jobs.length > 0 && !opts.deleteJobs) {
    throw new Error(`该用户还有 ${jobs.length} 个任务，请先删除任务，或确认删除用户及其全部任务。`)
  }

  await env.IMAGE_DB.prepare('DELETE FROM sessions WHERE user_id = ?')
    .bind(target.id)
    .run()

  for (const job of jobs) {
    await deleteJob(env, job)
  }

  await env.IMAGE_DB.prepare('DELETE FROM users WHERE id = ?')
    .bind(target.id)
    .run()

  return {
    deletedUsers: 1,
    deletedJobs: jobs.length,
    userIds: [target.id],
    usernames: [target.username],
  }
}

export async function deleteEmptyUsers(env: Env): Promise<DeleteUsersResult> {
  const { results: users } = await env.IMAGE_DB.prepare(
    `SELECT users.*
     FROM users
     LEFT JOIN jobs ON jobs.user_id = users.id
     WHERE users.role = 'user'
     GROUP BY users.id
     HAVING COUNT(jobs.id) = 0
     ORDER BY users.created_at ASC`,
  ).all<UserRow>()

  let deletedUsers = 0
  const userIds: string[] = []
  const usernames: string[] = []

  for (const user of users) {
    await env.IMAGE_DB.prepare('DELETE FROM sessions WHERE user_id = ?')
      .bind(user.id)
      .run()
    await env.IMAGE_DB.prepare('DELETE FROM users WHERE id = ?')
      .bind(user.id)
      .run()
    deletedUsers++
    userIds.push(user.id)
    usernames.push(user.username)
  }

  return {
    deletedUsers,
    deletedJobs: 0,
    userIds,
    usernames,
  }
}

function safeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function parseOpenAIApiKeys(env: Env): string[] {
  const rawMultiKey = env.OPENAI_API_KEYS?.trim()
  const rawKeys = rawMultiKey
    ? rawMultiKey.split(/[\n,;]+/g)
    : env.OPENAI_API_KEY
      ? [env.OPENAI_API_KEY]
      : []

  const seen = new Set<string>()
  const keys: string[] = []
  for (const rawKey of rawKeys) {
    const key = rawKey.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

async function claimOpenAIApiKeyIndex(env: Env, keyCount: number): Promise<number> {
  const now = Date.now()
  await env.IMAGE_DB.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value, updated_at)
     VALUES ('openai_api_key_rotation_next', '0', ?)`,
  )
    .bind(now)
    .run()

  const row = await env.IMAGE_DB.prepare(
    `UPDATE app_settings
     SET value = CAST(((CAST(value AS INTEGER) + 1) % ?) AS TEXT), updated_at = ?
     WHERE key = 'openai_api_key_rotation_next'
     RETURNING CAST(value AS INTEGER) AS next_index`,
  )
    .bind(keyCount, now)
    .first<{ next_index: number }>()

  const nextIndex = Number(row?.next_index ?? 0)
  if (!Number.isFinite(nextIndex)) return 0
  return (Math.floor(nextIndex) - 1 + keyCount) % keyCount
}

export async function selectOpenAIApiKey(env: Env): Promise<string> {
  const keys = parseOpenAIApiKeys(env)
  if (keys.length === 0) {
    throw new Error('OPENAI_API_KEYS or OPENAI_API_KEY is not configured.')
  }
  if (keys.length === 1) return keys[0]

  const index = await claimOpenAIApiKeyIndex(env, keys.length)
  return keys[index] || keys[0]
}

async function setAppSetting(env: Env, key: string, value: string, now = Date.now()): Promise<void> {
  await env.IMAGE_DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, now)
    .run()
}

export async function setUserGenerationMode(
  env: Env,
  user: AuthUser,
  mode: unknown,
): Promise<AuthUser> {
  if (user.role !== 'admin') {
    throw new Error('只有 admin 可以切换本地生图模式。')
  }

  const generationMode = mode === 'local' ? 'local' : 'cloud'
  await setAppSetting(env, userGenerationModeKey(user.id), generationMode)
  return {
    ...user,
    generationMode,
  }
}

export async function getCleanupConfig(env: Env, now = Date.now()): Promise<CleanupConfig> {
  const { results } = await env.IMAGE_DB.prepare(
    `SELECT key, value, updated_at
     FROM app_settings
     WHERE key IN ('cleanup_retention_hours', 'cleanup_interval_hours', 'cleanup_last_run_at')`,
  ).all<AppSettingRow>()

  const settings = new Map(results.map((row) => [row.key, row.value]))
  const fallbackRetentionHours = safeNumber(env.CLEANUP_RETENTION_DAYS, 1, 1, 3650) * 24
  const retentionHours = safeNumber(settings.get('cleanup_retention_hours'), fallbackRetentionHours, 1, 24 * 365)
  const intervalHours = safeNumber(settings.get('cleanup_interval_hours'), 0, 0, 24 * 365)
  const rawLastRunAt = safeNumber(settings.get('cleanup_last_run_at'), 0, 0, Number.MAX_SAFE_INTEGER)
  const lastCleanupAt = rawLastRunAt > 0 ? rawLastRunAt : null
  const nextCleanupAt = intervalHours > 0
    ? (lastCleanupAt ? lastCleanupAt + intervalHours * 60 * 60 * 1000 : now)
    : null

  return {
    retentionHours,
    intervalHours,
    autoEnabled: intervalHours > 0,
    lastCleanupAt,
    nextCleanupAt,
  }
}

export async function saveCleanupConfig(env: Env, config: {
  retentionHours?: unknown
  intervalHours?: unknown
}): Promise<CleanupConfig> {
  const current = await getCleanupConfig(env)
  const retentionHours = safeNumber(config.retentionHours, current.retentionHours, 1, 24 * 365)
  const intervalHours = safeNumber(config.intervalHours, current.intervalHours, 0, 24 * 365)
  const now = Date.now()

  await setAppSetting(env, 'cleanup_retention_hours', String(retentionHours), now)
  await setAppSetting(env, 'cleanup_interval_hours', String(intervalHours), now)

  return getCleanupConfig(env, now)
}

export async function setCleanupLastRunAt(env: Env, lastRunAt = Date.now()): Promise<void> {
  await setAppSetting(env, 'cleanup_last_run_at', String(lastRunAt), Date.now())
}

export async function getJob(env: Env, jobId: string): Promise<JobRow | null> {
  return env.IMAGE_DB.prepare(
    `SELECT jobs.*, users.username AS username
     FROM jobs
     LEFT JOIN users ON users.id = jobs.user_id
     WHERE jobs.id = ?`,
  )
    .bind(jobId)
    .first<JobRow>()
}

export async function listJobs(env: Env, user?: AuthUser): Promise<RemoteJob[]> {
  const isAdmin = user?.role === 'admin'
  const query = isAdmin
    ? `SELECT jobs.*, users.username AS username
       FROM jobs
       LEFT JOIN users ON users.id = jobs.user_id
       ORDER BY created_at DESC`
    : `SELECT jobs.*, users.username AS username
       FROM jobs
       LEFT JOIN users ON users.id = jobs.user_id
       WHERE jobs.user_id = ?
       ORDER BY created_at DESC`

  const statement = env.IMAGE_DB.prepare(query)
  const { results } = isAdmin
    ? await statement.all<JobRow>()
    : await statement.bind(user?.id || '').all<JobRow>()

  return results.map(rowToRemoteJob)
}

export async function listAllJobs(env: Env): Promise<RemoteJob[]> {
  const { results } = await env.IMAGE_DB.prepare(
    `SELECT jobs.*, users.username AS username
     FROM jobs
     LEFT JOIN users ON users.id = jobs.user_id
     ORDER BY created_at DESC`,
  ).all<JobRow>()
  return results.map(rowToRemoteJob)
}

export async function listAllImageObjects(env: Env): Promise<R2ListedObject[]> {
  const objects: R2ListedObject[] = []
  let cursor: string | undefined

  do {
    const page = await env.IMAGE_BUCKET.list({
      prefix: 'jobs/',
      cursor,
      limit: 1000,
    })
    objects.push(...page.objects)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return objects
}

export async function insertJob(env: Env, job: {
  id: string
  userId: string
  prompt: string
  params: TaskParams
  model: string
  apiMode: ApiMode
  codexCli: boolean
  inputImageKeys: string[]
  maskTargetImageKey?: string | null
  maskImageKey?: string | null
  now: number
}): Promise<void> {
  await env.IMAGE_DB.prepare(
    `INSERT INTO jobs (
      id, user_id, prompt, params_json, model, api_mode, codex_cli, input_image_keys_json, mask_target_image_key, mask_image_key, output_image_keys_json,
      status, error, created_at, updated_at, started_at, finished_at, elapsed, is_favorite
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      job.id,
      job.userId,
      job.prompt,
      JSON.stringify(job.params),
      job.model,
      job.apiMode === 'responses' ? 'responses' : 'images',
      job.codexCli ? 1 : 0,
      JSON.stringify(job.inputImageKeys),
      job.maskTargetImageKey ?? null,
      job.maskImageKey ?? null,
      JSON.stringify([]),
      'queued',
      null,
      job.now,
      job.now,
      null,
      null,
      null,
      0,
    )
    .run()
}

export async function updateJobFavorite(env: Env, jobId: string, isFavorite: boolean): Promise<void> {
  await env.IMAGE_DB.prepare(
    `UPDATE jobs SET is_favorite = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(isFavorite ? 1 : 0, Date.now(), jobId)
    .run()
}

export async function updateJobStatus(env: Env, jobId: string, patch: {
  status: JobRow['status']
  error?: string | null
  outputImageKeys?: Array<string | OutputSlot>
  startedAt?: number | null
  finishedAt?: number | null
  elapsed?: number | null
}): Promise<void> {
  const now = Date.now()
  await env.IMAGE_DB.prepare(
    `UPDATE jobs
     SET status = ?, error = ?, output_image_keys_json = COALESCE(?, output_image_keys_json),
         updated_at = ?, started_at = COALESCE(?, started_at), finished_at = ?, elapsed = ?
     WHERE id = ?`,
  )
    .bind(
      patch.status,
      patch.error ?? null,
      patch.outputImageKeys ? JSON.stringify(patch.outputImageKeys) : null,
      now,
      patch.startedAt ?? null,
      patch.finishedAt ?? null,
      patch.elapsed ?? null,
      jobId,
    )
    .run()
}

export async function deleteJob(env: Env, row: JobRow): Promise<void> {
  const keys = [
    ...parseJsonArray(row.input_image_keys_json),
    ...(row.mask_image_key ? [row.mask_image_key] : []),
    ...parseJsonArray(row.output_image_keys_json),
  ]
  if (keys.length > 0) {
    await env.IMAGE_BUCKET.delete(keys)
  }
  await env.IMAGE_DB.prepare('DELETE FROM jobs WHERE id = ?').bind(row.id).run()
}

export function getCleanupRetentionMs(env: Env, retentionHours?: number): number {
  if (Number.isFinite(retentionHours) && retentionHours && retentionHours > 0) {
    return retentionHours * 60 * 60 * 1000
  }
  const days = Number(env.CLEANUP_RETENTION_DAYS || 1)
  const safeDays = Number.isFinite(days) && days > 0 ? days : 1
  return safeDays * 24 * 60 * 60 * 1000
}

export async function findExpiredJobs(env: Env, now = Date.now(), limit = 1000, retentionHours?: number): Promise<JobRow[]> {
  const cutoff = now - getCleanupRetentionMs(env, retentionHours)
  const { results } = await env.IMAGE_DB.prepare(
    `SELECT * FROM jobs
     WHERE created_at < ?
     ORDER BY created_at ASC
     LIMIT ?`,
  )
    .bind(cutoff, limit)
    .all<JobRow>()

  return results
}

export async function cleanupExpiredJobs(
  env: Env,
  opts: { now?: number, limit?: number, dryRun?: boolean, retentionHours?: number } = {},
): Promise<{ cutoff: number, retentionMs: number, matched: number, deleted: number, jobIds: string[] }> {
  const now = opts.now ?? Date.now()
  const retentionMs = getCleanupRetentionMs(env, opts.retentionHours)
  const cutoff = now - retentionMs
  const jobs = await findExpiredJobs(env, now, opts.limit ?? 1000, opts.retentionHours)

  if (!opts.dryRun) {
    for (const job of jobs) {
      await deleteJob(env, job)
    }
  }

  return {
    cutoff,
    retentionMs,
    matched: jobs.length,
    deleted: opts.dryRun ? 0 : jobs.length,
    jobIds: jobs.map((job) => job.id),
  }
}

export async function runScheduledCleanupIfDue(
  env: Env,
  now = Date.now(),
): Promise<{ skipped: boolean, reason?: string, config: CleanupConfig, result?: Awaited<ReturnType<typeof cleanupExpiredJobs>> }> {
  const config = await getCleanupConfig(env, now)
  if (!config.autoEnabled || config.intervalHours <= 0) {
    return { skipped: true, reason: 'disabled', config }
  }

  const intervalMs = config.intervalHours * 60 * 60 * 1000
  if (config.lastCleanupAt && now - config.lastCleanupAt < intervalMs) {
    return { skipped: true, reason: 'not_due', config }
  }

  const result = await cleanupExpiredJobs(env, {
    now,
    retentionHours: config.retentionHours,
  })
  await setCleanupLastRunAt(env, now)

  return {
    skipped: false,
    config: await getCleanupConfig(env, now),
    result,
  }
}

export function normalizeUpstreamBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function buildUpstreamUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = normalizeUpstreamBaseUrl(baseUrl)
  const normalizedPath =
    normalizedBaseUrl.endsWith('/v1') && path.startsWith('v1/')
      ? path.slice(3)
      : path

  return `${normalizedBaseUrl}/${normalizedPath}`
}

export function outputMime(format: TaskParams['output_format']): string {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

export function extensionFromMime(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array, mime: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) throw new Error('Invalid image data URL.')

  const mime = match[1] || 'image/png'
  const isBase64 = Boolean(match[2])
  const payload = match[3] || ''

  if (!isBase64) {
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) }
  }

  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return { mime, bytes }
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } | string, message?: string }
    if (typeof payload.error === 'string') return payload.error
    if (payload.error?.message) return payload.error.message
    if (payload.message) return payload.message
  } catch {
    try {
      return await response.text()
    } catch {
      /* ignore */
    }
  }
  return `HTTP ${response.status}`
}
