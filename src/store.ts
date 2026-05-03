import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
  ExportData,
  AuthUser,
  AdminUserSummary,
} from './types'
import { DEFAULT_SETTINGS, DEFAULT_PARAMS } from './types'
import { applyActiveProfilePatch, normalizeSettings } from './lib/apiProfiles'
import {
  getAllTasks,
  putTask,
  deleteTask as dbDeleteTask,
  clearTasks as dbClearTasks,
  getImage,
  getAllImages,
  putImage,
  deleteImage,
  clearImages,
  storeImage,
  hashDataUrl,
} from './lib/db'
import { callImageApi, isRelativeApiBaseUrl } from './lib/api'
import { validateMaskMatchesImage } from './lib/canvasImage'
import { orderInputImagesForMask } from './lib/mask'
import {
  createRemoteJob,
  deleteRemoteJob,
  deleteRemoteJobOutputImage,
  fetchRemoteImageAsDataUrl,
  updateRemoteJobFavorite,
  isRemoteImageId,
  listRemoteJobs,
} from './lib/remoteApi'
import { normalizeImageSize } from './lib/size'
import { listAdminUsers } from './lib/adminApi'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

// ===== Image cache =====
// 内存缓存，id → dataUrl，避免每次从 IndexedDB 读取

const imageCache = new Map<string, string>()

export interface LocalImageCacheStats {
  count: number
  bytes: number
}

function isLocalImageCacheEnabled(): boolean {
  return useStore.getState().settings.imageCacheEnabled ?? DEFAULT_SETTINGS.imageCacheEnabled
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  const payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
  if (!payload) return 0
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

export function getCachedImage(id: string): string | undefined {
  if (isRemoteImageId(id) && !isLocalImageCacheEnabled()) return undefined
  return imageCache.get(id)
}

export async function ensureImageCached(id: string): Promise<string | undefined> {
  if (isRemoteImageId(id)) {
    const { settings, sessionToken } = useStore.getState()
    if (!sessionToken) return undefined

    if (settings.imageCacheEnabled ?? DEFAULT_SETTINGS.imageCacheEnabled) {
      if (imageCache.has(id)) return imageCache.get(id)

      const rec = await getImage(id)
      if (rec) {
        imageCache.set(id, rec.dataUrl)
        return rec.dataUrl
      }
    }

    const dataUrl = await fetchRemoteImageAsDataUrl(settings, id, sessionToken)
    if (settings.imageCacheEnabled ?? DEFAULT_SETTINGS.imageCacheEnabled) {
      imageCache.set(id, dataUrl)
      await putImage({ id, dataUrl, createdAt: Date.now(), source: 'remote-cache' })
    }
    return dataUrl
  }

  if (imageCache.has(id)) return imageCache.get(id)

  const rec = await getImage(id)
  if (rec) {
    imageCache.set(id, rec.dataUrl)
    return rec.dataUrl
  }
  return undefined
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

function orderImageIdsWithMaskFirst(ids: string[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return ids
  const maskIdx = ids.indexOf(maskTargetImageId)
  if (maskIdx <= 0) return ids
  const next = [...ids]
  const [maskImageId] = next.splice(maskIdx, 1)
  next.unshift(maskImageId)
  return next
}

// ===== 任务筛选 =====

export type TaskFilterStatus = 'all' | 'running' | 'done' | 'error'

export interface TaskFilterOptions {
  searchQuery: string
  filterStatus: TaskFilterStatus
  currentUser: AuthUser | null
  selectedUserFilter: string
  filterFavorite: boolean
}

export function getFilteredTasks(tasks: TaskRecord[], options: TaskFilterOptions): TaskRecord[] {
  const q = options.searchQuery.trim().toLowerCase()
  return [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((task) => {
      if (options.filterStatus !== 'all' && task.status !== options.filterStatus) return false
      if (options.filterFavorite && !task.isFavorite) return false

      if (
        options.currentUser?.role === 'admin' &&
        options.selectedUserFilter !== 'all' &&
        task.userId !== options.selectedUserFilter
      ) {
        return false
      }

      if (!q) return true
      const prompt = (task.prompt || '').toLowerCase()
      const username = (task.username || '').toLowerCase()
      const paramStr = JSON.stringify(task.params).toLowerCase()
      return prompt.includes(q) || username.includes(q) || paramStr.includes(q)
    })
}

// ===== Store 类型 =====

interface AppState {
  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void
  clearDismissedCodexCliPrompt: (key: string) => void
  imageCacheRevision: number
  bumpImageCacheRevision: () => void

  // 登录
  currentUser: AuthUser | null
  sessionToken: string
  setAuth: (user: AuthUser, sessionToken: string) => void
  clearAuth: () => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[]) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void
  isSubmitting: boolean
  setIsSubmitting: (value: boolean) => void

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: TaskFilterStatus
  setFilterStatus: (status: AppState['filterStatus']) => void
  adminUsers: AdminUserSummary[]
  setAdminUsers: (users: AdminUserSummary[]) => void
  selectedUserFilter: string
  setSelectedUserFilter: (userId: string) => void
  filterFavorite: boolean
  setFilterFavorite: (value: boolean) => void

  // UI
  selectionMode: boolean
  selectedTaskIds: string[]
  setSelectionMode: (value: boolean) => void
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleSelectedTask: (id: string) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void

  // Toast
  toast: { message: string; type: 'info' | 'success' | 'error' } | null
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    confirmText?: string
    messageAlign?: 'left' | 'center'
    tone?: 'default' | 'danger' | 'warning'
    action: () => void
    cancelAction?: () => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Settings
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (s) => set((st) => {
        const prevCacheEnabled = st.settings.imageCacheEnabled ?? DEFAULT_SETTINGS.imageCacheEnabled
        const mergedSettings = { ...st.settings, ...s }
        let nextSettings = normalizeSettings(mergedSettings)
        const patchActiveProfile = ['baseUrl', 'apiKey', 'model', 'timeout', 'apiMode', 'codexCli', 'apiProxy']
          .some((key) => Object.prototype.hasOwnProperty.call(s, key))
        if (patchActiveProfile) {
          nextSettings = applyActiveProfilePatch(nextSettings, {
            baseUrl: s.baseUrl,
            apiKey: s.apiKey,
            model: s.model,
            timeout: s.timeout,
            apiMode: s.apiMode,
            codexCli: s.codexCli,
            apiProxy: s.apiProxy,
          })
        }
        const nextCacheEnabled = nextSettings.imageCacheEnabled ?? DEFAULT_SETTINGS.imageCacheEnabled
        return {
          settings: nextSettings,
          imageCacheRevision: prevCacheEnabled !== nextCacheEnabled
            ? st.imageCacheRevision + 1
            : st.imageCacheRevision,
        }
      }),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
          ? st.dismissedCodexCliPrompts
          : [...st.dismissedCodexCliPrompts, key],
      })),
      clearDismissedCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.filter((item) => item !== key),
      })),
      imageCacheRevision: 0,
      bumpImageCacheRevision: () => set((st) => ({ imageCacheRevision: st.imageCacheRevision + 1 })),

      // Auth
      currentUser: null,
      sessionToken: '',
      setAuth: (currentUser, sessionToken) => set({ currentUser, sessionToken }),
      clearAuth: () =>
        set({
          currentUser: null,
          sessionToken: '',
          tasks: [],
          adminUsers: [],
          selectedUserFilter: 'all',
          selectionMode: false,
          selectedTaskIds: [],
          detailTaskId: null,
          lightboxImageId: null,
          lightboxImageList: [],
          maskDraft: null,
          maskEditorImageId: null,
        }),

      // Input
      prompt: '',
      setPrompt: (prompt) => set({ prompt }),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return { inputImages: [...s.inputImages, img] }
        }),
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return {
            inputImages: s.inputImages.filter((_, i) => i !== idx),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) imageCache.delete(img.id)
          return { inputImages: [], maskDraft: null, maskEditorImageId: null }
        }),
      setInputImages: (imgs) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return {
            inputImages,
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return { inputImages: images }
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => ({
          maskDraft,
          inputImages: orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId),
        })),
      clearMaskDraft: () => set({ maskDraft: null }),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => set({ maskEditorImageId }),

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set({ tasks }),
      isSubmitting: false,
      setIsSubmitting: (isSubmitting) => set({ isSubmitting }),

      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      adminUsers: [],
      setAdminUsers: (adminUsers) => set({ adminUsers }),
      selectedUserFilter: 'all',
      setSelectedUserFilter: (selectedUserFilter) => set({ selectedUserFilter }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set({ filterFavorite }),

      // UI
      selectionMode: false,
      selectedTaskIds: [],
      setSelectionMode: (selectionMode) =>
        set((s) => ({
          selectionMode,
          selectedTaskIds: selectionMode ? s.selectedTaskIds : [],
        })),
      setSelectedTaskIds: (idsOrUpdater) => set((s) => {
        const selectedTaskIds = typeof idsOrUpdater === 'function'
          ? idsOrUpdater(s.selectedTaskIds)
          : idsOrUpdater
        const deduped = Array.from(new Set(selectedTaskIds))
        return {
          selectedTaskIds: deduped,
          selectionMode: deduped.length > 0,
        }
      }),
      toggleSelectedTask: (id) =>
        set((s) => {
          const selected = new Set(s.selectedTaskIds)
          if (selected.has(id)) selected.delete(id)
          else selected.add(id)
          const selectedTaskIds = Array.from(selected)
          return { selectedTaskIds, selectionMode: selectedTaskIds.length > 0 }
        }),
      toggleTaskSelection: (id, force) =>
        set((s) => {
          const selected = new Set(s.selectedTaskIds)
          const isSelected = selected.has(id)
          const shouldSelect = force !== undefined ? force : !isSelected
          if (shouldSelect) selected.add(id)
          else selected.delete(id)
          const selectedTaskIds = Array.from(selected)
          return { selectedTaskIds, selectionMode: selectedTaskIds.length > 0 }
        }),
      clearSelection: () => set({ selectionMode: false, selectedTaskIds: [] }),
      detailTaskId: null,
      setDetailTaskId: (detailTaskId) => set({ detailTaskId }),
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) =>
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) }),
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        set({ toast: { message, type } })
        setTimeout(() => {
          set((s) => (s.toast?.message === message ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
    }),
    {
      name: 'gpt-image-playground',
      partialize: (state) => ({
        settings: state.settings,
        params: state.params,
        currentUser: state.currentUser,
        sessionToken: state.sessionToken,
        dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<AppState> | undefined
        return {
          ...current,
          ...state,
          settings: normalizeSettings(state?.settings ?? current.settings),
        }
      },
    },
  ),
)

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  return `${settings.baseUrl}\n${settings.apiKey}`
}

export function showCodexCliPrompt(force = false, reason = '接口返回的提示词已被改写') {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return

  state.setConfirmDialog({
    title: '检测到 Codex CLI API',
    message: `${reason}，当前 API 来源可能更适合使用 Codex CLI 兼容模式。\n\n是否开启？开启后会禁用在此处无效的质量参数，并且不会向上游发送 quality 字段；Images API 多图生成会继续按单图并发执行；提示词文本开头会加入简短的不改写要求，尽量避免上游改写原意。`,
    confirmText: '开启',
    action: () => {
      const nextState = useStore.getState()
      nextState.clearDismissedCodexCliPrompt(promptKey)
      nextState.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

export async function getLocalImageCacheStats(): Promise<LocalImageCacheStats> {
  const images = await getAllImages()
  const cachedRemoteImages = images.filter((img) => isRemoteImageId(img.id) || img.source === 'remote-cache')
  return {
    count: cachedRemoteImages.length,
    bytes: cachedRemoteImages.reduce((sum, img) => sum + estimateDataUrlBytes(img.dataUrl), 0),
  }
}

export async function clearLocalImageCache(): Promise<LocalImageCacheStats> {
  const images = await getAllImages()
  const cachedRemoteImages = images.filter((img) => isRemoteImageId(img.id) || img.source === 'remote-cache')

  for (const img of cachedRemoteImages) {
    await deleteImage(img.id)
    imageCache.delete(img.id)
  }

  for (const id of Array.from(imageCache.keys())) {
    if (isRemoteImageId(id)) imageCache.delete(id)
  }

  const cleared = {
    count: cachedRemoteImages.length,
    bytes: cachedRemoteImages.reduce((sum, img) => sum + estimateDataUrlBytes(img.dataUrl), 0),
  }
  useStore.getState().bumpImageCacheRevision()
  return cleared
}

function normalizeParamsForSettings(params: TaskParams, settings: AppSettings): TaskParams {
  return {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    quality: settings.codexCli ? DEFAULT_PARAMS.quality : params.quality,
  }
}

let remoteRefreshSeq = 0

function cancelInFlightRemoteRefreshes() {
  remoteRefreshSeq++
}

function isLocalGenerationUser(user: AuthUser | null | undefined): boolean {
  return user?.role === 'admin' && user.generationMode === 'local'
}

/** 初始化：从 IndexedDB 加载任务和图片缓存，清理孤立图片 */
export async function initStore() {
  const tasks = await getAllTasks()
  useStore.getState().setTasks(tasks)

  // 收集所有任务引用的图片 id
  const referencedIds = new Set<string>()
  for (const t of tasks) {
    for (const id of t.inputImageIds || []) referencedIds.add(id)
    if (t.maskImageId) referencedIds.add(t.maskImageId)
    for (const id of t.outputImages || []) referencedIds.add(id)
  }

  // 预加载所有图片到缓存，同时清理孤立图片
  const images = await getAllImages()
  for (const img of images) {
    if (referencedIds.has(img.id)) {
      imageCache.set(img.id, img.dataUrl)
    } else {
      await deleteImage(img.id)
    }
  }
}

export async function refreshRemoteTasks(showErrors = false) {
  const {
    settings,
    sessionToken,
    currentUser,
    selectedUserFilter,
    setTasks,
    setAdminUsers,
    setSelectedUserFilter,
    showToast,
  } = useStore.getState()
  if (!sessionToken) return

  const seq = ++remoteRefreshSeq

  try {
    const remoteTasks = await listRemoteJobs(settings, sessionToken)
    if (seq !== remoteRefreshSeq) return
    if (!isLocalGenerationUser(currentUser)) {
      setTasks(remoteTasks)
    }
    if (currentUser?.role === 'admin') {
      const users = await listAdminUsers(settings, sessionToken)
      if (seq !== remoteRefreshSeq) return
      setAdminUsers(users)
      if (selectedUserFilter !== 'all' && !users.some((user) => user.id === selectedUserFilter)) {
        setSelectedUserFilter('all')
      }
    } else {
      setAdminUsers([])
      if (selectedUserFilter !== 'all') setSelectedUserFilter('all')
    }
  } catch (err) {
    console.error(err)
    if (showErrors) {
      showToast(`同步后台任务失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
}

/** 提交新任务 */
export async function submitTask(options: { allowFullMask?: boolean } = {}) {
  const {
    settings,
    sessionToken,
    currentUser,
    prompt,
    inputImages,
    maskDraft,
    params,
    tasks,
    setTasks,
    showToast,
    isSubmitting,
    setIsSubmitting,
    setConfirmDialog,
  } = useStore.getState()
  const isServerProxy = isRelativeApiBaseUrl(settings.baseUrl)
  const shouldUseCloudJob = Boolean(sessionToken) && !isLocalGenerationUser(currentUser)

  if (isSubmitting) return

  if (isServerProxy && !sessionToken) {
    showToast('请先登录后再生成图片', 'error')
    return
  }

  if (!isServerProxy && !settings.apiKey && !shouldUseCloudJob) {
    showToast('请先在设置中配置 API Key', 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  const submittedPrompt = prompt.trim()

  if (!submittedPrompt && !inputImages.length) {
    showToast('请输入提示词或添加参考图', 'error')
    return
  }

  let orderedInputImages = inputImages
  let maskDataUrl: string | undefined
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: () => {
            void submitTask({ allowFullMask: true })
          },
        })
        return
      }
      maskDataUrl = maskDraft.maskDataUrl
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      imageCache.set(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  setIsSubmitting(true)
  useStore.getState().setPrompt('')

  try {
    // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
    for (const img of orderedInputImages) {
      await storeImage(img.dataUrl)
    }

    const normalizedParams = normalizeParamsForSettings(params, settings)
    if (normalizedParams.size !== params.size || normalizedParams.quality !== params.quality) {
      useStore.getState().setParams({ size: normalizedParams.size, quality: normalizedParams.quality })
    }

    if (shouldUseCloudJob) {
      cancelInFlightRemoteRefreshes()
      const pendingTaskId = `pending:${genId()}`
      const pendingTask: TaskRecord = {
        id: pendingTaskId,
        userId: useStore.getState().currentUser?.id,
        username: useStore.getState().currentUser?.username,
        prompt: submittedPrompt,
        params: normalizedParams,
        apiMode: settings.apiMode,
        codexCli: settings.codexCli,
        inputImageIds: orderedInputImages.map((i) => i.id),
        maskTargetImageId,
        maskImageId,
        outputImages: [],
        outputSlots: Array.from({ length: Math.max(1, normalizedParams.n || 1) }, (_, index) => ({
          index: index + 1,
          imageId: null,
          status: index === 0 ? 'running' : 'queued',
          error: null,
          startedAt: Date.now(),
          finishedAt: null,
        })),
        status: 'running',
        error: null,
        createdAt: Date.now(),
        finishedAt: null,
        elapsed: null,
        remote: true,
      }
      setTasks([pendingTask, ...tasks])

      const task = await createRemoteJob({
        settings,
        sessionToken,
        prompt: submittedPrompt,
        params: normalizedParams,
        inputImageDataUrls: orderedInputImages.map((i) => i.dataUrl),
        maskTargetImageId,
        maskDataUrl,
      })
      cancelInFlightRemoteRefreshes()
      setTasks([task, ...useStore.getState().tasks.filter((t) => t.id !== task.id && t.id !== pendingTaskId)])
      showToast('任务已提交到后台，关闭浏览器后也会继续生成', 'success')
      refreshRemoteTasks()
      return
    }

    const taskId = genId()
    const task: TaskRecord = {
      id: taskId,
      prompt: submittedPrompt,
      params: normalizedParams,
      apiMode: settings.apiMode,
      codexCli: settings.codexCli,
      inputImageIds: orderedInputImages.map((i) => i.id),
      maskTargetImageId,
      maskImageId,
      outputImages: [],
      outputSlots: Array.from({ length: Math.max(1, normalizedParams.n || 1) }, (_, index) => ({
        index: index + 1,
        imageId: null,
        status: index === 0 ? 'running' : 'queued',
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      })),
      status: 'running',
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
      elapsed: null,
    }

    const newTasks = [task, ...tasks]
    setTasks(newTasks)
    await putTask(task)

    // 异步调用 API
    executeTask(taskId)
  } catch (err) {
    setTasks(useStore.getState().tasks.map((task) => (
      task.id.startsWith('pending:')
        ? {
            ...task,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
            finishedAt: Date.now(),
            elapsed: Date.now() - task.createdAt,
          }
        : task
    )))
    showToast(`提交任务失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    setIsSubmitting(false)
  }
}

async function executeTask(taskId: string) {
  const { settings, sessionToken } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return

  try {
    // 获取输入图片 data URLs
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error('遮罩图片已不存在')
    }

    const result = await callImageApi({
      settings,
      sessionToken,
      prompt: task.prompt,
      params: task.params,
      inputImageDataUrls: inputDataUrls,
      maskDataUrl,
    })

    // 存储输出图片
    const outputIds: string[] = []
    for (const dataUrl of result.images) {
      const imgId = await storeImage(dataUrl, 'generated')
      imageCache.set(imgId, dataUrl)
      outputIds.push(imgId)
    }

    const actualParamsByImage = result.actualParamsList?.reduce<Record<string, Partial<TaskParams>>>((acc, actualParams, index) => {
      const imgId = outputIds[index]
      if (imgId && actualParams && Object.keys(actualParams).length > 0) acc[imgId] = actualParams
      return acc
    }, {})
    const revisedPromptByImage = result.revisedPrompts?.reduce<Record<string, string>>((acc, revisedPrompt, index) => {
      const imgId = outputIds[index]
      if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
      return acc
    }, {})
    const promptWasRevised = result.revisedPrompts?.some(
      (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== task.prompt.trim(),
    )
    const hasRevisedPromptValue = result.revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim())
    if (!settings.codexCli) {
      if (promptWasRevised) {
        showCodexCliPrompt()
      } else if (!hasRevisedPromptValue) {
        showCodexCliPrompt(false, '接口没有返回官方 API 会返回的部分信息')
      }
    }

    // 更新任务
    updateTaskInStore(taskId, {
      outputImages: outputIds,
      outputSlots: Array.from({ length: Math.max(1, task.params.n || outputIds.length || 1) }, (_, index) => ({
        index: index + 1,
        imageId: outputIds[index] || null,
        status: outputIds[index] ? 'done' : 'error',
        error: outputIds[index] ? null : '接口未返回该序号图片',
        startedAt: task.createdAt,
        finishedAt: Date.now(),
        actualParams: result.actualParamsList?.[index],
        revisedPrompt: result.revisedPrompts?.[index],
      })),
      actualParams: { ...(result.actualParams || {}), n: outputIds.length },
      actualParamsByImage: actualParamsByImage && Object.keys(actualParamsByImage).length > 0 ? actualParamsByImage : undefined,
      revisedPromptByImage: revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
      status: 'done',
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })

    useStore.getState().showToast(`生成完成，共 ${outputIds.length} 张图片`, 'success')
    const currentMask = useStore.getState().maskDraft
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl
    ) {
      useStore.getState().clearMaskDraft()
    }
  } catch (err) {
    updateTaskInStore(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      outputSlots: task.outputSlots?.map((slot) => (
        slot.imageId
          ? slot
          : {
            ...slot,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
            finishedAt: Date.now(),
          }
      )),
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    useStore.getState().setDetailTaskId(taskId)
  }

  // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
  for (const imgId of task.inputImageIds) {
    imageCache.delete(imgId)
  }
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch } : t,
  )
  setTasks(updated)
  const task = updated.find((t) => t.id === taskId)
  if (task) putTask(task)
}

/** 重试失败任务：按当前设置创建一个全新的任务，仅复用提示词、参考图、遮罩和可用请求参数 */
export async function retryTask(task: TaskRecord) {
  const state = useStore.getState()
  const { settings, sessionToken, currentUser, setTasks, showToast } = state
  const isServerProxy = isRelativeApiBaseUrl(settings.baseUrl)
  const shouldUseCloudJob = Boolean(sessionToken) && !isLocalGenerationUser(currentUser)

  if (isServerProxy && !sessionToken) {
    showToast('请先登录后再重试任务', 'error')
    return
  }

  if (!isServerProxy && !settings.apiKey && !shouldUseCloudJob) {
    showToast('请先在设置中配置 API Key', 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  const normalizedParams = normalizeParamsForSettings(task.params, settings)
  const inputIds = orderImageIdsWithMaskFirst(
    [...(task.inputImageIds || [])],
    task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds?.[0] : null),
  )
  const inputImageDataUrls: string[] = []
  let retryPendingTaskId: string | null = null

  try {
    for (const imgId of inputIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')
      inputImageDataUrls.push(dataUrl)
    }

    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error('遮罩图片已不存在')
    }

    const maskTargetImageId = maskDataUrl
      ? task.maskTargetImageId && inputIds.includes(task.maskTargetImageId)
        ? task.maskTargetImageId
        : inputIds[0] ?? null
      : null

    if (shouldUseCloudJob) {
      cancelInFlightRemoteRefreshes()
      const pendingTaskId = `pending:${genId()}`
      retryPendingTaskId = pendingTaskId
      const pendingTask: TaskRecord = {
        id: pendingTaskId,
        userId: useStore.getState().currentUser?.id,
        username: useStore.getState().currentUser?.username,
        prompt: task.prompt,
        params: normalizedParams,
        apiMode: settings.apiMode,
        codexCli: settings.codexCli,
        inputImageIds: inputIds,
        maskTargetImageId,
        maskImageId: task.maskImageId ?? null,
        outputImages: [],
        outputSlots: Array.from({ length: Math.max(1, normalizedParams.n || 1) }, (_, index) => ({
          index: index + 1,
          imageId: null,
          status: index === 0 ? 'running' : 'queued',
          error: null,
          startedAt: Date.now(),
          finishedAt: null,
        })),
        status: 'running',
        error: null,
        createdAt: Date.now(),
        finishedAt: null,
        elapsed: null,
        remote: true,
      }
      setTasks([pendingTask, ...useStore.getState().tasks])

      const newTask = await createRemoteJob({
        settings,
        sessionToken,
        prompt: task.prompt,
        params: normalizedParams,
        inputImageDataUrls,
        maskTargetImageId,
        maskDataUrl,
      })

      cancelInFlightRemoteRefreshes()
      setTasks([newTask, ...useStore.getState().tasks.filter((t) => t.id !== newTask.id && t.id !== pendingTaskId)])
      showToast('已按当前设置重新提交任务', 'success')
      refreshRemoteTasks()
      return
    }

    const taskId = genId()
    const newTask: TaskRecord = {
      id: taskId,
      prompt: task.prompt,
      params: normalizedParams,
      apiMode: settings.apiMode,
      codexCli: settings.codexCli,
      inputImageIds: inputIds,
      maskTargetImageId,
      maskImageId: task.maskImageId ?? null,
      outputImages: [],
      outputSlots: Array.from({ length: Math.max(1, normalizedParams.n || 1) }, (_, index) => ({
        index: index + 1,
        imageId: null,
        status: index === 0 ? 'running' : 'queued',
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      })),
      status: 'running',
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
      elapsed: null,
    }

    setTasks([newTask, ...useStore.getState().tasks])
    await putTask(newTask)
    executeTask(taskId)
    showToast('已按当前设置重新提交任务', 'success')
  } catch (err) {
    setTasks(useStore.getState().tasks.map((item) => (
      retryPendingTaskId && item.id === retryPendingTaskId
        ? {
            ...item,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
            finishedAt: Date.now(),
            elapsed: Date.now() - item.createdAt,
          }
        : item
    )))
    showToast(`重试失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

function removeImageFromTaskRecord(task: TaskRecord, imageId: string): TaskRecord {
  const outputImages = (task.outputImages || []).filter((id) => id !== imageId)
  const outputSlots = task.outputSlots
    ?.filter((slot) => slot.imageId !== imageId)
    .map((slot, index) => ({ ...slot, index: index + 1 }))
  const actualParamsByImage = task.actualParamsByImage ? { ...task.actualParamsByImage } : undefined
  const revisedPromptByImage = task.revisedPromptByImage ? { ...task.revisedPromptByImage } : undefined
  if (actualParamsByImage) delete actualParamsByImage[imageId]
  if (revisedPromptByImage) delete revisedPromptByImage[imageId]

  return {
    ...task,
    outputImages,
    outputSlots,
    actualParams: { ...(task.actualParams || {}), n: outputImages.length },
    actualParamsByImage: actualParamsByImage && Object.keys(actualParamsByImage).length ? actualParamsByImage : undefined,
    revisedPromptByImage: revisedPromptByImage && Object.keys(revisedPromptByImage).length ? revisedPromptByImage : undefined,
  }
}

async function deleteLocalImageIfUnused(imageId: string, remainingTasks: TaskRecord[], inputImages: InputImage[]) {
  const stillUsed = new Set<string>()
  for (const t of remainingTasks) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  if (!stillUsed.has(imageId)) {
    await deleteImage(imageId)
    imageCache.delete(imageId)
  }
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const { setPrompt, setParams, setInputImages, setMaskDraft, clearMaskDraft, showToast } = useStore.getState()
  setPrompt(task.prompt)
  setParams(task.params)

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }
  setInputImages(imgs)
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    const maskDataUrl = await ensureImageCached(task.maskImageId)
    if (maskDataUrl) {
      setMaskDraft({
        targetImageId: maskTargetImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
    } else {
      clearMaskDraft()
    }
  } else {
    clearMaskDraft()
  }
  showToast('已复用配置到输入框', 'success')
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 删除多图任务中的单张输出图 */
export async function removeOutputImage(task: TaskRecord, imageId: string) {
  const { inputImages, showToast } = useStore.getState()
  if (!imageId || !(task.outputImages || []).includes(imageId)) return
  if ((task.outputImages || []).length <= 1) {
    showToast('至少需要保留一张输出图；如果要全部删除，请删除整条任务。', 'error')
    return
  }

  if (task.remote) {
    try {
      const { settings, sessionToken, tasks, setTasks } = useStore.getState()
      if (!sessionToken) throw new Error('请先登录。')
      const updatedRemoteTask = await deleteRemoteJobOutputImage(settings, task.id, imageId, sessionToken)
      setTasks(tasks.map((t) => (t.id === task.id ? updatedRemoteTask : t)))
      imageCache.delete(imageId)
      await deleteImage(imageId).catch(() => undefined)
      showToast('已删除当前图片', 'success')
      refreshRemoteTasks()
    } catch (err) {
      showToast(`删除图片失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
    return
  }

  const { tasks, setTasks } = useStore.getState()
  const updatedTask = removeImageFromTaskRecord(task, imageId)
  const updatedTasks = tasks.map((t) => (t.id === task.id ? updatedTask : t))
  setTasks(updatedTasks)
  await putTask(updatedTask)
  await deleteLocalImageIfUnused(imageId, updatedTasks, inputImages)
  showToast('已删除当前图片', 'success')
}

/** 收藏/取消收藏单条任务 */
export async function setTaskFavorite(task: TaskRecord, isFavorite: boolean) {
  const { tasks, setTasks, showToast } = useStore.getState()
  const optimisticTask = { ...task, isFavorite }
  setTasks(tasks.map((item) => (item.id === task.id ? optimisticTask : item)))

  if (task.remote) {
    try {
      const { settings, sessionToken } = useStore.getState()
      if (!sessionToken) throw new Error('请先登录。')
      const updatedRemoteTask = await updateRemoteJobFavorite(settings, task.id, isFavorite, sessionToken)
      setTasks(useStore.getState().tasks.map((item) => (item.id === task.id ? updatedRemoteTask : item)))
      showToast(isFavorite ? '已收藏任务' : '已取消收藏', 'success')
      refreshRemoteTasks()
    } catch (err) {
      setTasks(useStore.getState().tasks.map((item) => (item.id === task.id ? task : item)))
      showToast(`更新收藏失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
    return
  }

  await putTask(optimisticTask)
  showToast(isFavorite ? '已收藏任务' : '已取消收藏', 'success')
}

export async function toggleTaskFavorite(task: TaskRecord) {
  await setTaskFavorite(task, !task.isFavorite)
}

/** 批量收藏/取消收藏任务 */
export async function setTasksFavorite(tasksToUpdate: TaskRecord[], isFavorite: boolean) {
  const targets = Array.from(new Map(tasksToUpdate.map((task) => [task.id, task])).values())
  if (!targets.length) return

  const { tasks, setTasks, showToast } = useStore.getState()
  const targetIds = new Set(targets.map((task) => task.id))
  setTasks(tasks.map((task) => (targetIds.has(task.id) ? { ...task, isFavorite } : task)))

  try {
    for (const task of targets) {
      if (task.remote) {
        const { settings, sessionToken } = useStore.getState()
        if (!sessionToken) throw new Error('请先登录。')
        const updatedRemoteTask = await updateRemoteJobFavorite(settings, task.id, isFavorite, sessionToken)
        setTasks(useStore.getState().tasks.map((item) => (item.id === task.id ? updatedRemoteTask : item)))
      } else {
        await putTask({ ...task, isFavorite })
      }
    }
    showToast(isFavorite ? `已收藏 ${targets.length} 条任务` : `已取消收藏 ${targets.length} 条任务`, 'success')
    if (targets.some((task) => task.remote)) refreshRemoteTasks()
  } catch (err) {
    setTasks(useStore.getState().tasks.map((task) => {
      const original = targets.find((item) => item.id === task.id)
      return original ? { ...task, isFavorite: original.isFavorite } : task
    }))
    showToast(`批量更新收藏失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, inputImages, showToast } = useStore.getState()

  if (task.remote) {
    try {
      const { settings, sessionToken } = useStore.getState()
      if (!sessionToken) throw new Error('请先登录。')
      await deleteRemoteJob(settings, task.id, sessionToken)
      setTasks(tasks.filter((t) => t.id !== task.id))
      showToast('后台任务已删除', 'success')
      refreshRemoteTasks()
    } catch (err) {
      showToast(`删除后台任务失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
    return
  }

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
  ])

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== task.id)
  setTasks(remaining)
  await dbDeleteTask(task.id)

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
    }
  }

  showToast('记录已删除', 'success')
}

/** 批量删除任务 */
export async function removeTasks(tasksToRemove: TaskRecord[]) {
  const targets = Array.from(new Map(tasksToRemove.map((task) => [task.id, task])).values())
  if (!targets.length) return

  const { showToast } = useStore.getState()
  const remoteTasks = targets.filter((task) => task.remote)
  const localTasks = targets.filter((task) => !task.remote)

  let deleted = 0

  if (remoteTasks.length) {
    try {
      const { settings, sessionToken } = useStore.getState()
      if (!sessionToken) throw new Error('请先登录。')
      for (const task of remoteTasks) {
        await deleteRemoteJob(settings, task.id, sessionToken)
        deleted++
      }
    } catch (err) {
      showToast(`批量删除后台任务失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      refreshRemoteTasks()
      return
    }
  }

  if (localTasks.length) {
    const { tasks, setTasks, inputImages } = useStore.getState()
    const deleteIds = new Set(localTasks.map((task) => task.id))
    const remaining = tasks.filter((task) => !deleteIds.has(task.id))

    const taskImageIds = new Set<string>()
    for (const task of localTasks) {
      for (const id of task.inputImageIds || []) taskImageIds.add(id)
      if (task.maskImageId) taskImageIds.add(task.maskImageId)
      for (const id of task.outputImages || []) taskImageIds.add(id)
    }

    setTasks(remaining)
    for (const task of localTasks) {
      await dbDeleteTask(task.id)
      deleted++
    }

    const stillUsed = new Set<string>()
    for (const task of remaining) {
      for (const id of task.inputImageIds || []) stillUsed.add(id)
      if (task.maskImageId) stillUsed.add(task.maskImageId)
      for (const id of task.outputImages || []) stillUsed.add(id)
    }
    for (const img of inputImages) stillUsed.add(img.id)

    for (const imgId of taskImageIds) {
      if (!stillUsed.has(imgId)) {
        await deleteImage(imgId)
        imageCache.delete(imgId)
      }
    }
  }

  if (remoteTasks.length) {
    const { tasks, setTasks } = useStore.getState()
    const deleteIds = new Set(remoteTasks.map((task) => task.id))
    setTasks(tasks.filter((task) => !deleteIds.has(task.id)))
    refreshRemoteTasks()
  }

  showToast(`已删除 ${deleted} 条任务`, 'success')
}

/** 清空所有数据（含配置重置） */
export async function clearAllData() {
  await dbClearTasks()
  await clearImages()
  imageCache.clear()
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, showToast } = useStore.getState()
  setTasks([])
  clearInputImages()
  useStore.setState({ dismissedCodexCliPrompts: [] })
  clearMaskDraft()
  setSettings({ ...DEFAULT_SETTINGS })
  setParams({ ...DEFAULT_PARAMS })
  showToast('所有数据已清空', 'success')
}

/** 从 dataUrl 解析出 MIME 扩展名和二进制数据 */
function dataUrlToBytes(dataUrl: string): { ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,/)
  const ext = match?.[1] ?? 'png'
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { ext, bytes }
}

/** 将二进制数据还原为 dataUrl */
function bytesToDataUrl(bytes: Uint8Array, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  const mime = mimeMap[ext] ?? 'image/png'
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

function getReferencedImageIds(task: TaskRecord): string[] {
  return [
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
  ]
}

async function exportTasksToZip(tasksToExport: TaskRecord[], filePrefix: string) {
  if (!tasksToExport.length) throw new Error('没有可导出的任务')

  const { settings, showToast } = useStore.getState()
  const exportedAt = Date.now()
  const imageCreatedAtFallback = new Map<string, number>()
  const referencedIds = new Set<string>()

  for (const task of tasksToExport) {
    for (const id of getReferencedImageIds(task)) {
      referencedIds.add(id)
      const prev = imageCreatedAtFallback.get(id)
      if (prev == null || task.createdAt < prev) {
        imageCreatedAtFallback.set(id, task.createdAt)
      }
    }
  }

  const imageFiles: ExportData['imageFiles'] = {}
  const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}
  const missingImages: string[] = []

  for (const id of referencedIds) {
    const rec = await getImage(id).catch(() => undefined)
    let dataUrl = rec?.dataUrl || imageCache.get(id)
    if (!dataUrl) dataUrl = await ensureImageCached(id)
    if (!dataUrl) {
      missingImages.push(id)
      continue
    }

    const { ext, bytes } = dataUrlToBytes(dataUrl)
    const path = `images/${encodeURIComponent(id)}.${ext}`
    const createdAt = rec?.createdAt ?? imageCreatedAtFallback.get(id) ?? exportedAt
    imageFiles[id] = {
      path,
      createdAt,
      source: rec?.source ?? (isRemoteImageId(id) ? 'remote-cache' : undefined),
    }
    zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
  }

  const manifest: ExportData = {
    version: 2,
    exportedAt: new Date(exportedAt).toISOString(),
    settings,
    tasks: tasksToExport,
    imageFiles,
  }

  zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

  const zipped = zipSync(zipFiles, { level: 6 })
  const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filePrefix}-${Date.now()}.zip`
  a.click()
  URL.revokeObjectURL(url)

  if (missingImages.length) {
    showToast(`已导出 ${tasksToExport.length} 条任务，但有 ${missingImages.length} 张图片未能打包`, 'error')
  } else {
    showToast(`已导出 ${tasksToExport.length} 条任务`, 'success')
  }
}

/** 导出选中的任务为 ZIP */
export async function exportTasks(taskIds: string[]) {
  try {
    const idSet = new Set(taskIds)
    const tasksToExport = useStore.getState().tasks.filter((task) => idSet.has(task.id))
    await exportTasksToZip(tasksToExport, 'linmh-image-playground-selected')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 导出数据为 ZIP */
export async function exportData() {
  try {
    const state = useStore.getState()
    const tasks = isRelativeApiBaseUrl(state.settings.baseUrl)
      ? state.tasks
      : await getAllTasks()
    await exportTasksToZip(tasks, 'gpt-image-playground')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}
/** 导入 ZIP 数据 */
export async function importData(file: File) {
  try {
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    if (!data.tasks || !data.imageFiles) throw new Error('无效的数据格式')

    // 还原图片
    for (const [id, info] of Object.entries(data.imageFiles)) {
      const bytes = unzipped[info.path]
      if (!bytes) continue
      const dataUrl = bytesToDataUrl(bytes, info.path)
      await putImage({ id, dataUrl, createdAt: info.createdAt, source: info.source })
      imageCache.set(id, dataUrl)
    }

    for (const task of data.tasks) {
      await putTask(task)
    }

    if (data.settings) {
      useStore.getState().setSettings(data.settings)
    }

    const tasks = await getAllTasks()
    useStore.getState().setTasks(tasks)
    useStore
      .getState()
      .showToast(`已导入 ${data.tasks.length} 条记录`, 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导入失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 添加图片到输入（文件上传）—— 仅放入内存缓存，不写 IndexedDB */
export async function addImageFromFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return
  const dataUrl = await fileToDataUrl(file)
  const id = await hashDataUrl(dataUrl)
  imageCache.set(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
  const dataUrl = await blobToDataUrl(blob)
  const id = await hashDataUrl(dataUrl)
  imageCache.set(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}


