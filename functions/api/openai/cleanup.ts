import {
  authenticateRequest,
  cleanupExpiredJobs,
  findExpiredJobs,
  getCleanupConfig,
  isAuthError,
  jsonResponse,
  optionsResponse,
  requireAdmin,
  saveCleanupConfig,
  setCleanupLastRunAt,
  type PagesContext,
} from '../../_lib/server'

interface CleanupRequest {
  action?: unknown
  dryRun?: unknown
  limit?: unknown
  retentionHours?: unknown
  intervalHours?: unknown
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context

  if (request.method === 'OPTIONS') return optionsResponse()

  const user = await authenticateRequest(request, env)
  if (isAuthError(user)) return user

  const adminError = requireAdmin(user)
  if (adminError) return adminError

  if (request.method === 'GET') {
    const config = await getCleanupConfig(env)
    const jobs = await findExpiredJobs(env, Date.now(), 1000, config.retentionHours)
    return jsonResponse({
      dryRun: true,
      config,
      matched: jobs.length,
      jobIds: jobs.map((job) => job.id),
    })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Only GET and POST requests are supported.' }, 405)
  }

  let body: CleanupRequest = {}
  try {
    body = await request.json() as CleanupRequest
  } catch {
    body = {}
  }

  const action = typeof body.action === 'string' ? body.action : ''
  let config = await getCleanupConfig(env)
  const hasConfigPatch = body.retentionHours != null || body.intervalHours != null
  if (hasConfigPatch) {
    config = await saveCleanupConfig(env, {
      retentionHours: body.retentionHours,
      intervalHours: body.intervalHours,
    })
  }

  if (action === 'saveConfig') {
    return jsonResponse({ ok: true, config })
  }

  const dryRun = body.dryRun !== false
  const limit = Number(body.limit || 1000)
  const result = await cleanupExpiredJobs(env, {
    dryRun,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 1000,
    retentionHours: config.retentionHours,
  })

  if (!dryRun) {
    await setCleanupLastRunAt(env)
    config = await getCleanupConfig(env)
  }

  return jsonResponse({ dryRun, config, ...result })
}
