import {
  authenticateRequest,
  canAccessJob,
  getJob,
  getSingleParam,
  isAuthError,
  jsonResponse,
  optionsResponse,
  parseOutputSlots,
  rowToRemoteJob,
  updateJobStatus,
  type OutputSlot,
  type PagesContext,
  type TaskParams,
} from '../../../../../_lib/server'

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

  if (request.method !== 'DELETE') {
    return jsonResponse({ error: 'Only DELETE requests are supported.' }, 405)
  }

  const id = getSingleParam(params, 'id')
  const key = decodeImageKey(getSingleParam(params, 'key'))
  const row = id ? await getJob(env, id) : null
  if (!row || !canAccessJob(user, row)) return jsonResponse({ error: 'Job not found.' }, 404)

  if (row.status === 'queued' || row.status === 'running') {
    return jsonResponse({ error: '任务仍在生成中，完成后再删除单张图片。' }, 409)
  }

  const jobParams = JSON.parse(row.params_json) as TaskParams
  const outputSlots = parseOutputSlots(row.output_image_keys_json, jobParams.n, row.status, row.error)
  const targetSlot = outputSlots.find((slot) => slot.key === key)
  if (!key || !targetSlot?.key) return jsonResponse({ error: 'Image not found.' }, 404)

  const remainingSlots: OutputSlot[] = outputSlots
    .filter((slot) => slot.key && slot.key !== key)
    .map((slot, index) => ({
      ...slot,
      index: index + 1,
      status: 'done' as const,
      error: null,
    }))

  if (remainingSlots.length === 0) {
    return jsonResponse({ error: '至少需要保留一张输出图；如果要全部删除，请删除整条任务。' }, 400)
  }

  await env.IMAGE_BUCKET.delete(key)
  await updateJobStatus(env, row.id, {
    status: row.status,
    error: row.error,
    outputImageKeys: remainingSlots,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    elapsed: row.elapsed,
  })

  const updated = await getJob(env, row.id)
  return jsonResponse({ ok: true, job: rowToRemoteJob(updated || row) })
}
