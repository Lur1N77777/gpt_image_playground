import { useEffect, useRef, useState, useCallback } from 'react'
import { isRelativeApiBaseUrl } from '../lib/api'
import { listApiModels, type ApiModelInfo } from '../lib/api'
import { logoutSession, updateCurrentUserGenerationMode } from '../lib/authApi'
import { getUsageSummary, type UsageSummary } from '../lib/usageApi'
import { deleteAdminUser, deleteEmptyAdminUsers } from '../lib/adminApi'
import {
  getCleanupSummary,
  runCleanup,
  saveCleanupSettings,
  type CleanupSummary,
} from '../lib/cleanupApi'
import {
  applyActiveProfilePatch,
  createApiProfile,
  getActiveApiProfile,
  getDefaultModelForMode,
  normalizeSettings,
  switchActiveApiProfile,
} from '../lib/apiProfiles'
import {
  useStore,
  exportData,
  importData,
  clearAllData,
  initStore,
  refreshRemoteTasks,
  clearLocalImageCache,
  getLocalImageCacheStats,
  type LocalImageCacheStats,
} from '../store'
import { DEFAULT_IMAGES_MODEL, DEFAULT_RESPONSES_MODEL, DEFAULT_SETTINGS, type ApiProfile, type AdminUserSummary, type AppSettings, type GenerationMode } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import Select from './Select'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value || 0)
}

function formatTime(value: number | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '未设置'
}

function parseHourInput(value: string, fallback: number, min: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.round(parsed * 100) / 100)
}

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const currentUser = useStore((s) => s.currentUser)
  const setAuth = useStore((s) => s.setAuth)
  const adminUsers = useStore((s) => s.adminUsers)
  const sessionToken = useStore((s) => s.sessionToken)
  const clearAuth = useStore((s) => s.clearAuth)
  const showToast = useStore((s) => s.showToast)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<AppSettings>(normalizeSettings(settings))
  const activeProfile = getActiveApiProfile(draft)
  const [timeoutInput, setTimeoutInput] = useState(String(activeProfile.timeout))
  const [showApiKey, setShowApiKey] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [modelOptions, setModelOptions] = useState<ApiModelInfo[]>([])
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [cleanup, setCleanup] = useState<CleanupSummary | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupAction, setCleanupAction] = useState<'save' | 'preview' | 'run' | null>(null)
  const [cleanupError, setCleanupError] = useState<string | null>(null)
  const [cleanupRetentionInput, setCleanupRetentionInput] = useState('24')
  const [cleanupIntervalInput, setCleanupIntervalInput] = useState('0')
  const [cacheStats, setCacheStats] = useState<LocalImageCacheStats | null>(null)
  const [cacheStatsLoading, setCacheStatsLoading] = useState(false)
  const [cacheActionLoading, setCacheActionLoading] = useState(false)
  const [userActionLoading, setUserActionLoading] = useState<string | null>(null)
  const isServerProxy = isRelativeApiBaseUrl(activeProfile.baseUrl)
  const credentialLabel = isServerProxy ? '访问口令' : 'API Key'
  const credentialPlaceholder = isServerProxy ? '部署时设置的 APP_ACCESS_TOKEN' : 'sk-...'
  const isAdmin = currentUser?.role === 'admin'
  const generationMode = currentUser?.role === 'admin' && currentUser.generationMode === 'local' ? 'local' : 'cloud'
  const emptyUsers = adminUsers.filter((user) => user.role === 'user' && user.jobCount === 0)
  const imageCacheEnabled = draft.imageCacheEnabled ?? DEFAULT_SETTINGS.imageCacheEnabled
  useEffect(() => {
    if (showSettings) {
      const nextDraft = normalizeSettings(settings)
      setDraft(nextDraft)
      setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    }
  }, [showSettings, settings])

  const commitSettings = (nextDraft: AppSettings) => {
    const normalizedDraft = normalizeSettings(nextDraft)
    setDraft(normalizedDraft)
    setSettings(normalizedDraft)
  }

  const updateActiveProfile = (patch: Partial<ApiProfile>, commit = false) => {
    const nextDraft = applyActiveProfilePatch(draft, patch)
    setDraft(nextDraft)
    if (commit) commitSettings(nextDraft)
  }

  const commitActiveProfilePatch = (patch: Partial<ApiProfile>) => {
    commitSettings(applyActiveProfilePatch(draft, patch))
  }

  const createNewProfile = () => {
    const profile = createApiProfile({ name: `配置 ${draft.profiles.length + 1}` })
    commitSettings(normalizeSettings({
      ...draft,
      profiles: [...draft.profiles, profile],
      activeProfileId: profile.id,
    }))
    setShowProfileMenu(false)
  }

  const switchProfile = (id: string) => {
    const nextDraft = switchActiveApiProfile(draft, id)
    setDraft(nextDraft)
    setSettings(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    setShowProfileMenu(false)
  }

  const deleteProfile = (id: string) => {
    if (draft.profiles.length <= 1) return
    const profiles = draft.profiles.filter((profile) => profile.id !== id)
    const nextDraft = normalizeSettings({
      ...draft,
      profiles,
      activeProfileId: draft.activeProfileId === id ? profiles[0].id : draft.activeProfileId,
    })
    commitSettings(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
  }

  const handleDetectModels = async () => {
    setModelLoading(true)
    setModelError(null)
    try {
      const models = await listApiModels(draft, sessionToken || undefined)
      setModelOptions(models)
      if (models.length === 0) {
        setModelError('接口已连通，但没有返回可选择模型。')
      } else {
        showToast(`检测到 ${models.length} 个模型`, 'success')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setModelError(message)
      showToast(`检测模型失败：${message}`, 'error')
    } finally {
      setModelLoading(false)
    }
  }

  const handleClose = () => {
    const nextTimeout = Number(timeoutInput)
    commitSettings(applyActiveProfilePatch(draft, {
      timeout: timeoutInput.trim() === '' || Number.isNaN(nextTimeout) ? DEFAULT_SETTINGS.timeout : nextTimeout,
    }))
    setShowSettings(false)
  }

  const commitTimeout = useCallback(() => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' ? DEFAULT_SETTINGS.timeout : Number.isNaN(nextTimeout) ? activeProfile.timeout : nextTimeout
    setTimeoutInput(String(normalizedTimeout))
    updateActiveProfile({ timeout: normalizedTimeout }, true)
  }, [activeProfile.timeout, draft, timeoutInput])

  useCloseOnEscape(showSettings, handleClose)

  const loadUsage = useCallback(async () => {
    if (!isAdmin || !sessionToken || !isRelativeApiBaseUrl(draft.baseUrl)) {
      setUsage(null)
      setUsageError(null)
      return
    }

    setUsageLoading(true)
    setUsageError(null)
    try {
      setUsage(await getUsageSummary(draft, sessionToken))
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : String(error))
    } finally {
      setUsageLoading(false)
    }
  }, [draft, isAdmin, sessionToken])

  const loadCleanup = useCallback(async () => {
    if (!isAdmin || !sessionToken || !isRelativeApiBaseUrl(draft.baseUrl)) {
      setCleanup(null)
      setCleanupError(null)
      return
    }

    setCleanupLoading(true)
    setCleanupError(null)
    try {
      const summary = await getCleanupSummary(draft, sessionToken)
      setCleanup(summary)
      setCleanupRetentionInput(String(summary.config.retentionHours))
      setCleanupIntervalInput(String(summary.config.intervalHours))
    } catch (error) {
      setCleanupError(error instanceof Error ? error.message : String(error))
    } finally {
      setCleanupLoading(false)
    }
  }, [draft, isAdmin, sessionToken])

  const loadCacheStats = useCallback(async () => {
    setCacheStatsLoading(true)
    try {
      setCacheStats(await getLocalImageCacheStats())
    } finally {
      setCacheStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!showSettings) return
    loadUsage()
    loadCleanup()
    loadCacheStats()
    if (isAdmin && sessionToken && isRelativeApiBaseUrl(draft.baseUrl)) {
      refreshRemoteTasks()
    }
  }, [showSettings, loadUsage, loadCleanup, loadCacheStats, isAdmin, sessionToken, draft.baseUrl])

  if (!showSettings) return null

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) importData(file)
    e.target.value = ''
  }

  const handleLogout = async () => {
    const token = sessionToken
    const baseUrl = settings.baseUrl
    clearAuth()
    setShowSettings(false)
    try {
      await logoutSession(baseUrl, token)
    } catch (error) {
      console.error(error)
    }
    showToast('已退出登录', 'success')
  }

  const handleGenerationModeChange = async (nextMode: GenerationMode) => {
    if (!isAdmin || !sessionToken || !currentUser) return

    try {
      const user = await updateCurrentUserGenerationMode(settings.baseUrl, sessionToken, nextMode)
      setAuth(user, sessionToken)
      if (nextMode === 'local') {
        await initStore()
        showToast('已切换为本地生图：任务会在当前浏览器执行，关闭浏览器后不会继续生成', 'success')
      } else {
        await refreshRemoteTasks(true)
        showToast('已切换为云端后台生图：提交后可关闭浏览器', 'success')
      }
    } catch (error) {
      showToast(`切换生图模式失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const getCleanupDraft = () => ({
    retentionHours: parseHourInput(cleanupRetentionInput, cleanup?.config.retentionHours ?? 24, 1),
    intervalHours: parseHourInput(cleanupIntervalInput, cleanup?.config.intervalHours ?? 0, 0),
  })

  const handleSaveCleanup = async () => {
    if (!sessionToken) return
    const nextConfig = getCleanupDraft()
    setCleanupAction('save')
    setCleanupError(null)
    try {
      const config = await saveCleanupSettings(settings, sessionToken, nextConfig)
      setCleanup((prev) => prev ? { ...prev, config } : prev)
      setCleanupRetentionInput(String(config.retentionHours))
      setCleanupIntervalInput(String(config.intervalHours))
      showToast(config.autoEnabled ? '清理设置已保存，自动清理已启用' : '清理设置已保存，自动清理已关闭', 'success')
      await loadCleanup()
    } catch (error) {
      setCleanupError(error instanceof Error ? error.message : String(error))
    } finally {
      setCleanupAction(null)
    }
  }

  const handlePreviewCleanup = async () => {
    if (!sessionToken) return
    setCleanupAction('preview')
    setCleanupError(null)
    try {
      const summary = await runCleanup(settings, sessionToken, {
        ...getCleanupDraft(),
        dryRun: true,
      })
      setCleanup(summary)
      showToast(`预览完成：当前可清理 ${summary.matched} 个后台任务`, 'info')
    } catch (error) {
      setCleanupError(error instanceof Error ? error.message : String(error))
    } finally {
      setCleanupAction(null)
    }
  }

  const executeCleanupNow = async () => {
    if (!sessionToken) return
    setCleanupAction('run')
    setCleanupError(null)
    try {
      const summary = await runCleanup(settings, sessionToken, {
        ...getCleanupDraft(),
        dryRun: false,
      })
      setCleanup(summary)
      showToast(`已清理 ${summary.deleted ?? 0} 个后台任务和关联图片`, 'success')
      await Promise.all([loadUsage(), loadCleanup(), refreshRemoteTasks()])
    } catch (error) {
      setCleanupError(error instanceof Error ? error.message : String(error))
    } finally {
      setCleanupAction(null)
    }
  }

  const handleRunCleanup = () => {
    const nextConfig = getCleanupDraft()
    setConfirmDialog({
      title: '清理后台图片',
      message: `确定要删除超过 ${nextConfig.retentionHours} 小时的后台任务和关联图片吗？此操作会同时删除数据库记录和 R2 图片对象。`,
      action: () => {
        void executeCleanupNow()
      },
    })
  }

  const handleToggleImageCache = () => {
    const nextDraft = {
      ...draft,
      imageCacheEnabled: !imageCacheEnabled,
    }
    commitSettings(nextDraft)
    showToast(nextDraft.imageCacheEnabled ? '本地图片缓存已开启' : '本地图片缓存已关闭', 'success')
  }

  const executeClearImageCache = async () => {
    setCacheActionLoading(true)
    try {
      const cleared = await clearLocalImageCache()
      await loadCacheStats()
      showToast(`已清理 ${cleared.count} 张本地缓存图片（${formatBytes(cleared.bytes)}）`, 'success')
    } catch (error) {
      showToast(`清理本地缓存失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setCacheActionLoading(false)
    }
  }

  const handleClearImageCache = () => {
    setConfirmDialog({
      title: '清理本地图片缓存',
      message: '确定要清理本浏览器里已经缓存的后台图片吗？这不会删除云端数据库或 R2 图片；开启缓存时，下次打开图片会重新从服务器读取并再次缓存。',
      action: () => {
        void executeClearImageCache()
      },
    })
  }

  const refreshAdminAfterUserChange = async () => {
    await Promise.all([
      refreshRemoteTasks(true),
      loadUsage(),
      loadCleanup(),
    ])
  }

  const executeDeleteEmptyUsers = async () => {
    if (!sessionToken) return
    setUserActionLoading('empty')
    try {
      const result = await deleteEmptyAdminUsers(settings, sessionToken)
      showToast(`已删除 ${result.deletedUsers} 个空用户`, 'success')
      await refreshAdminAfterUserChange()
    } catch (error) {
      showToast(`删除空用户失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setUserActionLoading(null)
    }
  }

  const handleDeleteEmptyUsers = () => {
    if (emptyUsers.length === 0) {
      showToast('当前没有可删除的空用户', 'info')
      return
    }

    setConfirmDialog({
      title: '删除空用户',
      message: `确定要删除 ${emptyUsers.length} 个没有任何任务的普通用户吗？此操作会让这些用户名对应的登录会话失效，但不会影响已有图片任务。`,
      confirmText: '删除空用户',
      action: () => {
        void executeDeleteEmptyUsers()
      },
    })
  }

  const executeDeleteUser = async (user: AdminUserSummary, deleteJobs: boolean) => {
    if (!sessionToken) return
    setUserActionLoading(user.id)
    try {
      const result = await deleteAdminUser(settings, sessionToken, user.id, { deleteJobs })
      showToast(
        deleteJobs
          ? `已删除用户 ${user.username} 及 ${result.deletedJobs} 个任务`
          : `已删除用户 ${user.username}`,
        'success',
      )
      await refreshAdminAfterUserChange()
    } catch (error) {
      showToast(`删除用户失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setUserActionLoading(null)
    }
  }

  const handleDeleteUser = (user: AdminUserSummary) => {
    if (user.role === 'admin') {
      showToast('不能删除 admin 用户', 'error')
      return
    }
    if (user.id === currentUser?.id) {
      showToast('不能删除当前登录用户', 'error')
      return
    }

    const deleteJobs = user.jobCount > 0
    setConfirmDialog({
      title: deleteJobs ? '删除用户及其任务' : '删除用户',
      message: deleteJobs
        ? `确定要删除用户「${user.username}」吗？该用户还有 ${user.jobCount} 个任务，确认后会同时删除这些任务记录和对应 R2 图片。`
        : `确定要删除空用户「${user.username}」吗？`,
      confirmText: deleteJobs ? '删除用户和任务' : '删除用户',
      action: () => {
        void executeDeleteUser(user, deleteJobs)
      },
    })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleClose}
      />
      <div
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 overflow-y-auto max-h-[85vh] custom-scrollbar"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono select-none">v{__APP_VERSION__}</span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {isServerProxy && currentUser && (
            <section>
              <h4 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-200">
                <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A8.966 8.966 0 0112 15c2.21 0 4.236.797 5.879 2.121M15 11a3 3 0 11-6 0 3 3 0 016 0zm6 1a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                当前登录
              </h4>
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-3 py-3 dark:bg-white/[0.03]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                    {currentUser.username}
                    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                      {currentUser.role}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                    {isAdmin ? 'admin 可查看和删除所有用户任务。' : '普通用户只能查看和删除自己的任务。'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex-shrink-0 rounded-xl border border-gray-200/80 bg-white px-3 py-2 text-xs text-gray-600 transition hover:bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
                >
                  退出
                </button>
              </div>
              {isAdmin ? (
                <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-3 dark:border-blue-500/10 dark:bg-blue-500/10">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-200">生成执行模式</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-blue-500/80 dark:text-blue-300/80">
                        云端模式可关闭浏览器继续生成；本地模式只在当前浏览器执行，但偏好会跟随 admin 账号。
                      </p>
                    </div>
                    <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-medium text-blue-600 dark:bg-white/[0.08] dark:text-blue-200">
                      {generationMode === 'local' ? '本地' : '云端'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => void handleGenerationModeChange('cloud')}
                      disabled={generationMode === 'cloud'}
                      className={`rounded-xl px-3 py-2 font-medium transition ${
                        generationMode === 'cloud'
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'bg-white/80 text-blue-600 hover:bg-white dark:bg-white/[0.05] dark:text-blue-200 dark:hover:bg-white/[0.08]'
                      }`}
                    >
                      云端后台生图
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerationModeChange('local')}
                      disabled={generationMode === 'local'}
                      className={`rounded-xl px-3 py-2 font-medium transition ${
                        generationMode === 'local'
                          ? 'bg-purple-500 text-white shadow-sm'
                          : 'bg-white/80 text-purple-600 hover:bg-white dark:bg-white/[0.05] dark:text-purple-200 dark:hover:bg-white/[0.08]'
                      }`}
                    >
                      本地生图
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 rounded-2xl bg-gray-50 px-3 py-2 text-[11px] leading-4 text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                  普通用户固定使用云端后台生图，提交后可以关闭浏览器。
                </p>
              )}
            </section>
          )}

          {isServerProxy && isAdmin && (
            <section className="pt-6 border-t border-gray-100 dark:border-white/[0.08]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-200">
                  <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m0-4a4 4 0 100-8 4 4 0 000 8zm8 0a4 4 0 100-8 4 4 0 000 8z" />
                  </svg>
                  用户管理
                </h4>
                <button
                  type="button"
                  onClick={() => refreshRemoteTasks(true)}
                  disabled={userActionLoading != null}
                  className="rounded-full px-3 py-1 text-xs text-blue-500 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-blue-500/10"
                >
                  刷新
                </button>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span className="text-gray-400 dark:text-gray-500">用户总数</span>
                    <br />
                    <span className="font-medium text-gray-700 dark:text-gray-200">{formatNumber(adminUsers.length)}</span>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span className="text-gray-400 dark:text-gray-500">空用户</span>
                    <br />
                    <span className="font-medium text-gray-700 dark:text-gray-200">{formatNumber(emptyUsers.length)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDeleteEmptyUsers}
                    disabled={emptyUsers.length === 0 || userActionLoading != null}
                    className="rounded-xl bg-orange-50 px-3 py-2 text-xs font-medium text-orange-600 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-orange-500/10 dark:text-orange-300 dark:hover:bg-orange-500/20"
                  >
                    {userActionLoading === 'empty' ? '删除中...' : '删空用户'}
                  </button>
                </div>

                <div className="max-h-64 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                  {adminUsers.map((user) => {
                    const protectedUser = user.role === 'admin' || user.id === currentUser?.id
                    const running = userActionLoading === user.id
                    return (
                      <div
                        key={user.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                              {user.username}
                            </span>
                            {user.role === 'admin' && (
                              <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                                admin
                              </span>
                            )}
                            {user.jobCount === 0 && user.role === 'user' && (
                              <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-600 dark:bg-orange-500/10 dark:text-orange-300">
                                空
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                            任务 {formatNumber(user.jobCount)} · 完成 {formatNumber(user.doneCount)} · 失败 {formatNumber(user.errorCount)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user)}
                          disabled={protectedUser || userActionLoading != null}
                          className={`flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs transition ${
                            user.jobCount > 0
                              ? 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
                          } disabled:cursor-not-allowed disabled:opacity-40`}
                          title={protectedUser ? '受保护用户不能删除' : user.jobCount > 0 ? '删除用户及其全部任务和图片' : '删除空用户'}
                        >
                          {running ? '删除中' : user.jobCount > 0 ? '删用户+任务' : '删除'}
                        </button>
                      </div>
                    )
                  })}
                  {adminUsers.length === 0 && (
                    <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                      暂无用户数据，点击刷新重试。
                    </p>
                  )}
                </div>

                <p className="text-[10px] leading-4 text-gray-400 dark:text-gray-500">
                  建议优先用“删空用户”。如果用户已有任务，单独删除会同时清理该用户所有任务和 R2 图片，避免留下孤立数据。
                </p>
              </div>
            </section>
          )}

          <section>
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              API 配置
            </h4>
            <div className="space-y-4">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-500/10 dark:bg-blue-500/10">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-200">API 预设配置</p>
                    <p className="mt-0.5 text-[10px] text-blue-500/80 dark:text-blue-300/80">
                      可保存多套 Base URL + Key，切换后会作为当前生图配置。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={createNewProfile}
                    className="shrink-0 rounded-xl bg-white/80 px-2.5 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-white dark:bg-white/[0.06] dark:text-blue-200 dark:hover:bg-white/[0.1]"
                  >
                    新增
                  </button>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowProfileMenu((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-blue-100 bg-white/80 px-3 py-2 text-sm text-blue-700 dark:border-blue-500/10 dark:bg-white/[0.06] dark:text-blue-100"
                    title={activeProfile.name}
                  >
                    <span className="min-w-0 truncate">{activeProfile.name}</span>
                    <span className="shrink-0 text-[10px] text-blue-400">{isServerProxy ? '后台代理' : '自定义直连'}</span>
                  </button>

                  {showProfileMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                      <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-gray-200/80 bg-white/95 py-1 shadow-xl backdrop-blur dark:border-white/[0.08] dark:bg-gray-900/95">
                        {draft.profiles.map((profile) => (
                          <div
                            key={profile.id}
                            className={`flex items-center gap-2 px-2 py-1.5 text-xs ${
                              profile.id === activeProfile.id
                                ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
                                : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => switchProfile(profile.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className="block truncate font-medium">{profile.name}</span>
                              <span className="block truncate text-[10px] opacity-60">{profile.baseUrl}</span>
                            </button>
                            {draft.profiles.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmDialog({
                                    title: '删除 API 配置',
                                    message: `确定删除「${profile.name}」吗？`,
                                    tone: 'danger',
                                    action: () => deleteProfile(profile.id),
                                  })
                                }}
                                className="rounded-lg px-2 py-1 text-red-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                              >
                                删除
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">配置名称</span>
                <input
                  value={activeProfile.name}
                  onChange={(e) => updateActiveProfile({ name: e.target.value })}
                  onBlur={(e) => commitActiveProfilePatch({ name: e.target.value })}
                  type="text"
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>

              <label className="block">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="block text-xs text-gray-500 dark:text-gray-400">API URL</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      updateActiveProfile({ codexCli: !activeProfile.codexCli }, true)
                    }}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full px-1 py-0.5 transition hover:bg-gray-100 dark:hover:bg-white/[0.06]"
                    role="switch"
                    aria-checked={activeProfile.codexCli}
                    title="Codex CLI API 兼容模式"
                  >
                    <span className={`text-[10px] transition-colors ${activeProfile.codexCli ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>Codex CLI</span>
                    <span className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${activeProfile.codexCli ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform ${activeProfile.codexCli ? 'translate-x-[11px]' : 'translate-x-[2px]'}`} />
                    </span>
                  </button>
                </div>
                <input
                  value={activeProfile.baseUrl}
                  onChange={(e) => updateActiveProfile({ baseUrl: e.target.value })}
                  onBlur={(e) => commitActiveProfilePatch({ baseUrl: e.target.value })}
                  type="text"
                  placeholder={DEFAULT_SETTINGS.baseUrl}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
                <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                  默认服务端代理：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">/api/openai</code>；也支持
                  通过查询参数覆盖：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiUrl=</code>，<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">codexCli=true</code>
                </div>
              </label>

              {!isServerProxy && (
                <div className="block">
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{credentialLabel}</span>
                  <div className="relative">
                    <input
                      value={activeProfile.apiKey}
                      onChange={(e) => updateActiveProfile({ apiKey: e.target.value })}
                      onBlur={(e) => commitActiveProfilePatch({ apiKey: e.target.value })}
                      type={showApiKey ? 'text' : 'password'}
                      placeholder={credentialPlaceholder}
                      className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                      tabIndex={-1}
                    >
                      {showApiKey ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                    直连模式下此处填写 OpenAI API Key。支持通过查询参数覆盖：
                    <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiKey=</code>
                  </div>
                </div>
              )}

              {isServerProxy && (
                <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  后台代理模式使用用户名/密码登录，不再需要填写访问口令；OpenAI Key 只保存在 Cloudflare Secret。
                </p>
              )}

              <details className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-300">
                  自定义接口路径 / 完整 URL 后缀
                </summary>
                <div className="mt-3 grid gap-2 text-xs">
                  {([
                    ['imagesGenerations', '生图接口', 'images/generations'],
                    ['imagesEdits', '编辑接口', 'images/edits'],
                    ['responses', 'Responses 接口', 'responses'],
                    ['models', '模型列表接口', 'models'],
                  ] as const).map(([key, label, placeholder]) => (
                    <label key={key} className="block">
                      <span className="mb-1 block text-[10px] text-gray-400 dark:text-gray-500">{label}</span>
                      <input
                        value={activeProfile.apiPaths?.[key] || ''}
                        onChange={(e) => updateActiveProfile({ apiPaths: { ...activeProfile.apiPaths, [key]: e.target.value } })}
                        onBlur={(e) => commitActiveProfilePatch({ apiPaths: { ...activeProfile.apiPaths, [key]: e.target.value } })}
                        placeholder={placeholder}
                        className="w-full rounded-lg border border-gray-200/70 bg-white/70 px-2.5 py-1.5 text-xs text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200"
                      />
                    </label>
                  ))}
                  <p className="text-[10px] leading-4 text-gray-400 dark:text-gray-500">
                    Base URL 可填根地址或完整接口地址；如果 Base URL 已经以对应后缀结尾，将直接使用它。这里也可填写完整 URL 覆盖单个接口。
                  </p>
                </div>
              </details>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API 接口</span>
                <Select
                  value={activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode}
                  onChange={(value) => {
                    const apiMode = value as AppSettings['apiMode']
                    const nextModel =
                      activeProfile.model === DEFAULT_IMAGES_MODEL || activeProfile.model === DEFAULT_RESPONSES_MODEL
                        ? getDefaultModelForMode(apiMode)
                        : activeProfile.model
                    updateActiveProfile({ apiMode, model: nextModel }, true)
                  }}
                  options={[
                    { label: 'Images API (/v1/images)', value: 'images' },
                    { label: 'Responses API (/v1/responses)', value: 'responses' },
                  ]}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
                <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                  支持通过查询参数覆盖：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">apiMode=images</code> 或 <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">apiMode=responses</code>。
                </div>
              </label>

              <label className="block">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="block text-xs text-gray-500 dark:text-gray-400">模型 ID</span>
                  <button
                    type="button"
                    onClick={handleDetectModels}
                    disabled={modelLoading}
                    className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] text-gray-600 transition hover:bg-gray-200 disabled:opacity-50 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                  >
                    {modelLoading ? '检测中...' : '检测模型'}
                  </button>
                </div>
                <input
                  value={activeProfile.model}
                  onChange={(e) => updateActiveProfile({ model: e.target.value })}
                  onBlur={(e) => commitActiveProfilePatch({ model: e.target.value })}
                  type="text"
                  placeholder={getDefaultModelForMode(activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode)}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
                {modelOptions.length > 0 && (
                  <Select
                    value={modelOptions.some((model) => model.id === activeProfile.model) ? activeProfile.model : ''}
                    onChange={(value) => updateActiveProfile({ model: value }, true)}
                    options={[
                      { label: '选择检测到的模型', value: '' },
                      ...modelOptions.map((model) => ({
                        label: model.ownedBy ? `${model.id} · ${model.ownedBy}` : model.id,
                        value: model.id,
                      })),
                    ]}
                    className="mt-2 w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                )}
                {modelError && (
                  <p className="mt-1 text-[10px] leading-4 text-red-500 dark:text-red-300">{modelError}</p>
                )}
                <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                  {(activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode) === 'responses'
                    ? <>Responses API 使用支持 <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">image_generation</code> 工具的文本模型，例如 <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">{DEFAULT_RESPONSES_MODEL}</code>。</>
                    : <>Images API 使用图片模型，例如 <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">{DEFAULT_IMAGES_MODEL}</code>。</>}
                </div>
              </label>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">请求超时 (秒)</span>
                <input
                  value={timeoutInput}
                  onChange={(e) => setTimeoutInput(e.target.value)}
                  onBlur={commitTimeout}
                  type="number"
                  min={10}
                  max={600}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>
            </div>
          </section>

          <section className="pt-6 border-t border-gray-100 dark:border-white/[0.08]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3v18m7-13v13M4 13v8m0-8a2 2 0 100-4 2 2 0 000 4zm7-6a2 2 0 100-4 2 2 0 000 4zm7 4a2 2 0 100-4 2 2 0 000 4z" />
                </svg>
                额度使用
              </h4>
              <button
                type="button"
                onClick={loadUsage}
                disabled={usageLoading || !isServerProxy || !isAdmin || !sessionToken}
                className="rounded-full px-3 py-1 text-xs text-blue-500 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-blue-500/10"
              >
                {usageLoading ? '刷新中...' : '刷新'}
              </button>
            </div>

            {!isServerProxy ? (
              <p className="rounded-xl bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300">
                额度面板只支持后台代理模式，请将 API URL 设为 <code>/api/openai</code>。
              </p>
            ) : !sessionToken ? (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                请先登录后查看后台用量。
              </p>
            ) : !isAdmin ? (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                只有 admin 用户可以查看后台额度使用情况。
              </p>
            ) : usageError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500 dark:bg-red-500/10 dark:text-red-300">
                读取额度失败：{usageError}
              </p>
            ) : usage ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span className="text-gray-400 dark:text-gray-500">R2 当前存储</span>
                    <br />
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {formatBytes(usage.usage.storedBytes)} / {formatBytes(usage.freeTier.r2StorageBytes)}
                    </span>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span className="text-gray-400 dark:text-gray-500">按当前平均还能存</span>
                    <br />
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {formatNumber(usage.usage.estimatedImagesRemainingByAverageSize)} 张
                    </span>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span className="text-gray-400 dark:text-gray-500">今日任务</span>
                    <br />
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {formatNumber(usage.usage.jobsToday)} 个 / 图 {formatNumber(usage.usage.generatedImagesToday)} 张
                    </span>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span className="text-gray-400 dark:text-gray-500">今日 Queue 估算剩余</span>
                    <br />
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {formatNumber(usage.usage.estimatedQueueJobsRemainingToday)} 个任务
                    </span>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span className="text-gray-400 dark:text-gray-500">后台任务总数</span>
                    <br />
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {formatNumber(usage.usage.jobsTotal)} 个
                    </span>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span className="text-gray-400 dark:text-gray-500">对象 / 平均大小</span>
                    <br />
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {formatNumber(usage.usage.storedObjects)} 个 / {formatBytes(usage.usage.averageStoredObjectBytes)}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] leading-4 text-gray-400 dark:text-gray-500">
                  说明：剩余张数按当前 R2 总占用 ÷ 当前图片对象数的平均大小估算；上游图片 API 如果没有余额接口，无法准确读取上游剩余额度。
                  更新时间：{new Date(usage.generatedAt).toLocaleString('zh-CN')}
                </p>
              </div>
            ) : (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                正在读取额度...
              </p>
            )}
          </section>

          {isServerProxy && isAdmin && (
            <section className="pt-6 border-t border-gray-100 dark:border-white/[0.08]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  后台清理
                </h4>
                <button
                  type="button"
                  onClick={loadCleanup}
                  disabled={cleanupLoading || cleanupAction != null}
                  className="rounded-full px-3 py-1 text-xs text-blue-500 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-blue-500/10"
                >
                  {cleanupLoading ? '读取中...' : '刷新'}
                </button>
              </div>

              {cleanupError && (
                <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500 dark:bg-red-500/10 dark:text-red-300">
                  清理设置读取失败：{cleanupError}
                </p>
              )}

              <div className="space-y-3">
                <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                  当前自动清理：
                  <span className={cleanup?.config.autoEnabled ? 'text-green-600 dark:text-green-300' : 'text-orange-500 dark:text-orange-300'}>
                    {cleanup?.config.autoEnabled ? `已启用，每 ${cleanup.config.intervalHours} 小时检查一次` : '已关闭'}
                  </span>
                  <br />
                  保留时间：{cleanup?.config.retentionHours ?? 24} 小时；匹配可清理任务：{formatNumber(cleanup?.matched ?? 0)} 个
                  <br />
                  上次清理：{formatTime(cleanup?.config.lastCleanupAt)}；下次自动清理：{formatTime(cleanup?.config.nextCleanupAt)}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">保留时长（小时）</span>
                    <input
                      value={cleanupRetentionInput}
                      onChange={(e) => setCleanupRetentionInput(e.target.value)}
                      type="number"
                      min={1}
                      step={1}
                      className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">自动间隔（小时）</span>
                    <input
                      value={cleanupIntervalInput}
                      onChange={(e) => setCleanupIntervalInput(e.target.value)}
                      type="number"
                      min={0}
                      step={1}
                      placeholder="0 = 关闭"
                      className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                    />
                  </label>
                </div>

                <p className="text-[10px] leading-4 text-gray-400 dark:text-gray-500">
                  自动间隔填 0 就是完全关闭自动后台清理；手动清理会删除超过保留时长的任务记录、输入图和生成图。
                </p>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={handleSaveCleanup}
                    disabled={cleanupAction != null}
                    className="rounded-xl bg-gray-100/80 px-3 py-2.5 text-xs text-gray-600 transition hover:bg-gray-200 disabled:opacity-50 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                  >
                    {cleanupAction === 'save' ? '保存中...' : '保存设置'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePreviewCleanup}
                    disabled={cleanupAction != null}
                    className="rounded-xl bg-blue-50 px-3 py-2.5 text-xs text-blue-600 transition hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20"
                  >
                    {cleanupAction === 'preview' ? '预览中...' : '预览'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRunCleanup}
                    disabled={cleanupAction != null}
                    className="rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-500 transition hover:bg-red-100 disabled:opacity-50 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
                  >
                    {cleanupAction === 'run' ? '清理中...' : '立即清理'}
                  </button>
                </div>
              </div>
            </section>
          )}

          <section className="pt-6 border-t border-gray-100 dark:border-white/[0.08]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3zm0 0v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7m-16 5v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
                </svg>
                本地图片缓存
              </h4>
              <button
                type="button"
                onClick={loadCacheStats}
                disabled={cacheStatsLoading || cacheActionLoading}
                className="rounded-full px-3 py-1 text-xs text-blue-500 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-blue-500/10"
              >
                {cacheStatsLoading ? '读取中...' : '刷新'}
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                当前状态：
                <span className={imageCacheEnabled ? 'text-green-600 dark:text-green-300' : 'text-orange-500 dark:text-orange-300'}>
                  {imageCacheEnabled ? '已开启' : '已关闭'}
                </span>
                <br />
                本地已缓存：{cacheStatsLoading ? '读取中...' : `${formatNumber(cacheStats?.count ?? 0)} 张 / ${formatBytes(cacheStats?.bytes ?? 0)}`}
              </div>

              <p className="text-[10px] leading-4 text-gray-400 dark:text-gray-500">
                开启后，已加载过的后台图片会保存在本浏览器 IndexedDB，下次进入会优先读取本地缓存，减少服务器图片读取压力并提升打开速度。
                关闭后不会写入本地图片缓存，每次重新进入都会从服务器重新读取。清理缓存不会删除云端图片。
              </p>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleToggleImageCache}
                  className={`rounded-xl px-4 py-2.5 text-sm transition ${
                    imageCacheEnabled
                      ? 'bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-300 dark:hover:bg-orange-500/20'
                      : 'bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-500/10 dark:text-green-300 dark:hover:bg-green-500/20'
                  }`}
                >
                  {imageCacheEnabled ? '关闭缓存' : '开启缓存'}
                </button>
                <button
                  type="button"
                  onClick={handleClearImageCache}
                  disabled={cacheActionLoading}
                  className="rounded-xl border border-red-200/80 bg-red-50/50 px-4 py-2.5 text-sm text-red-500 transition hover:bg-red-100/80 disabled:opacity-50 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                >
                  {cacheActionLoading ? '清理中...' : '清理缓存'}
                </button>
              </div>
            </div>
          </section>

          <section className="pt-6 border-t border-gray-100 dark:border-white/[0.08]">
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              数据管理
            </h4>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => exportData()}
                  className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  导出
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  导入
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleImport}
                />
              </div>
              <button
                onClick={() =>
                  setConfirmDialog({
                    title: '清空所有数据',
                    message: '确定要清空所有任务记录和图片数据吗？此操作不可恢复。',
                    action: () => clearAllData(),
                  })
                }
                className="w-full rounded-xl border border-red-200/80 bg-red-50/50 px-4 py-2.5 text-sm text-red-500 transition hover:bg-red-100/80 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
              >
                清空所有数据
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
