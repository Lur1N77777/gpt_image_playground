import type { AppSettings } from '../types'
import { sessionHeaders } from './authApi'
import { normalizeBaseUrl } from './devProxy'

export interface UsageSummary {
  generatedAt: string
  freeTier: {
    r2StorageBytes: number
    r2ClassAOperationsPerMonth: number
    r2ClassBOperationsPerMonth: number
    queueOperationsPerDay: number
    workerRequestsPerDay: number
  }
  usage: {
    jobsTotal: number
    jobsToday: number
    jobsThisMonth: number
    jobsByStatus: Record<string, number>
    generatedImagesToday: number
    generatedImagesThisMonth: number
    storedObjects: number
    storedBytes: number
    outputObjects: number
    averageStoredObjectBytes: number
    averageOutputBytes: number
    estimatedQueueOpsToday: number
    estimatedQueueJobsRemainingToday: number
    estimatedWorkersRequestsToday: number
    estimatedWorkerRequestsRemainingToday: number
    estimatedImagesRemainingByAverageSize: number
  }
  notes: string[]
}

function buildUsageUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl).replace(/\/+$/, '')}/usage`
}

export async function getUsageSummary(settings: AppSettings, sessionToken: string): Promise<UsageSummary> {
  const response = await fetch(buildUsageUrl(settings.baseUrl), {
    method: 'GET',
    headers: sessionHeaders(sessionToken),
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const payload = await response.json() as { error?: string }
      if (payload.error) message = payload.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  return response.json() as Promise<UsageSummary>
}
