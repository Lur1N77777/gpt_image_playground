import {
  authenticateRequest,
  isAuthError,
  jsonResponse,
  listAllImageObjects,
  listAllJobs,
  optionsResponse,
  requireAdmin,
  type PagesContext,
} from '../../_lib/server'

const R2_FREE_STORAGE_BYTES = 10 * 1024 * 1024 * 1024
const R2_FREE_CLASS_A_MONTH = 1_000_000
const R2_FREE_CLASS_B_MONTH = 10_000_000
const QUEUE_FREE_OPS_DAY = 10_000
const WORKERS_FREE_REQUESTS_DAY = 100_000
const DEFAULT_IMAGE_BYTES = 3.2 * 1024 * 1024

function startOfUtcDay(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

function startOfUtcMonth(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
}

function safeImageCount(keys: string[]): number {
  return Array.isArray(keys) ? keys.length : 0
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context

  if (request.method === 'OPTIONS') return optionsResponse()

  const user = await authenticateRequest(request, env)
  if (isAuthError(user)) return user

  const adminError = requireAdmin(user)
  if (adminError) return adminError

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Only GET requests are supported.' }, 405)
  }

  const jobs = await listAllJobs(env)
  const objects = await listAllImageObjects(env)
  const now = new Date()
  const dayStart = startOfUtcDay(now)
  const monthStart = startOfUtcMonth(now)

  const storedBytes = objects.reduce((sum, object) => sum + object.size, 0)
  const outputObjects = objects.filter((object) => object.key.includes('/outputs/'))
  const outputBytes = outputObjects.reduce((sum, object) => sum + object.size, 0)
  const averageStoredObjectBytes = objects.length > 0 ? storedBytes / objects.length : DEFAULT_IMAGE_BYTES
  const avgOutputBytes = outputObjects.length > 0 ? outputBytes / outputObjects.length : averageStoredObjectBytes

  const jobsToday = jobs.filter((job) => job.createdAt >= dayStart)
  const jobsThisMonth = jobs.filter((job) => job.createdAt >= monthStart)
  const generatedImagesToday = jobsToday.reduce((sum, job) => sum + safeImageCount(job.outputImageKeys), 0)
  const generatedImagesThisMonth = jobsThisMonth.reduce((sum, job) => sum + safeImageCount(job.outputImageKeys), 0)

  // Queue billing is roughly write + read + delete per message for small messages.
  const estimatedQueueOpsToday = jobsToday.length * 3
  const estimatedQueueJobsRemainingToday = Math.max(0, Math.floor((QUEUE_FREE_OPS_DAY - estimatedQueueOpsToday) / 3))
  const estimatedWorkersRequestsToday = jobsToday.length + Math.max(1, Math.ceil(jobsToday.length / 10))

  const remainingStorageBytes = Math.max(0, R2_FREE_STORAGE_BYTES - storedBytes)
  const estimatedImagesRemainingByAverageSize = Math.floor(
    remainingStorageBytes / Math.max(1, averageStoredObjectBytes),
  )

  const byStatus = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1
    return acc
  }, {})

  return jsonResponse({
    generatedAt: now.toISOString(),
    freeTier: {
      r2StorageBytes: R2_FREE_STORAGE_BYTES,
      r2ClassAOperationsPerMonth: R2_FREE_CLASS_A_MONTH,
      r2ClassBOperationsPerMonth: R2_FREE_CLASS_B_MONTH,
      queueOperationsPerDay: QUEUE_FREE_OPS_DAY,
      workerRequestsPerDay: WORKERS_FREE_REQUESTS_DAY,
    },
    usage: {
      jobsTotal: jobs.length,
      jobsToday: jobsToday.length,
      jobsThisMonth: jobsThisMonth.length,
      jobsByStatus: byStatus,
      generatedImagesToday,
      generatedImagesThisMonth,
      storedObjects: objects.length,
      storedBytes,
      outputObjects: outputObjects.length,
      averageStoredObjectBytes: Math.round(averageStoredObjectBytes),
      averageOutputBytes: Math.round(avgOutputBytes),
      estimatedQueueOpsToday,
      estimatedQueueJobsRemainingToday,
      estimatedWorkersRequestsToday,
      estimatedWorkerRequestsRemainingToday: Math.max(0, WORKERS_FREE_REQUESTS_DAY - estimatedWorkersRequestsToday),
      estimatedImagesRemainingByAverageSize,
    },
    notes: [
      'R2 剩余可存图片数按“当前 R2 占用空间 / 当前图片对象数”的平均大小估算；对象大小变化会影响结果。',
      'R2 存储为当前对象占用量；R2 账单按 GB-month 计算，手动或自动清理会降低实际月度占用。',
      'Queue/Workers 为基于本应用任务数的估算，不等同于 Cloudflare 账号全局账单用量。',
      '上游图片 API 未提供余额查询接口时，本应用无法准确读取上游剩余额度。',
    ],
  })
}
