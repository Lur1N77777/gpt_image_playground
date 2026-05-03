import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useStore, getCachedImage, ensureImageCached, reuseConfig, editOutputs, removeTask, removeOutputImage, toggleTaskFavorite, showCodexCliPrompt, getCodexCliPromptKey, retryTask } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { formatImageRatio } from '../lib/size'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { ActualValueBadge, DetailParamValue } from '../lib/paramDisplay'
import { copyBlobToClipboard, copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'

export default function DetailModal() {
  const tasks = useStore((s) => s.tasks)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const currentUser = useStore((s) => s.currentUser)
  const imageCacheRevision = useStore((s) => s.imageCacheRevision)
  const settings = useStore((s) => s.settings)
  const dismissedCodexCliPrompts = useStore((s) => s.dismissedCodexCliPrompts)

  const [imageIndex, setImageIndex] = useState(0)
  const [imageSrcs, setImageSrcs] = useState<Record<string, string>>({})
  const [maskPreviewSrc, setMaskPreviewSrc] = useState('')
  const [imageRatios, setImageRatios] = useState<Record<string, string>>({})
  const [imageSizes, setImageSizes] = useState<Record<string, string>>({})
  const imagePanelRef = useRef<HTMLDivElement>(null)
  const swipeSurfaceRef = useRef<HTMLDivElement>(null)
  const mainImageRef = useRef<HTMLImageElement>(null)
  const swipeFrameRef = useRef<number | null>(null)
  const lastImageCacheRevisionRef = useRef(imageCacheRevision)
  const swipeStateRef = useRef({ startX: 0, startY: 0, active: false, moved: false })
  const suppressImageClickRef = useRef(false)
  const [imageLabelLeft, setImageLabelLeft] = useState(8)
  const [isSwipeDragging, setIsSwipeDragging] = useState(false)

  const task = useMemo(
    () => tasks.find((t) => t.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  )

  useCloseOnEscape(Boolean(task), () => setDetailTaskId(null))

  // Reset index when task changes
  useEffect(() => {
    setImageIndex(0)
  }, [detailTaskId])

  // 加载所有相关图片
  useEffect(() => {
    if (!task) return
    const ids = [...(task.outputImages || []), ...(task.inputImageIds || []), ...(task.maskImageId ? [task.maskImageId] : [])]
    const shouldReloadImages = lastImageCacheRevisionRef.current !== imageCacheRevision
    lastImageCacheRevisionRef.current = imageCacheRevision
    if (shouldReloadImages) {
      setImageSrcs((prev) => {
        const next = { ...prev }
        for (const id of ids) delete next[id]
        return next
      })
    }
    for (const id of ids) {
      const cached = getCachedImage(id)
      if (cached) {
        setImageSrcs((prev) => ({ ...prev, [id]: cached }))
      } else {
        ensureImageCached(id).then((url) => {
          if (url) setImageSrcs((prev) => ({ ...prev, [id]: url }))
        })
      }
    }
  }, [task, imageCacheRevision])

  const outputSlots = useMemo(() => {
    if (!task) return []

    const slotByIndex = new Map((task.outputSlots || []).map((slot) => [slot.index, slot]))
    const visibleOutputCount = Math.max(task.outputImages?.length || 0, task.outputSlots?.length || 0)
    const targetCount = task.status !== 'running' && visibleOutputCount > 0
      ? visibleOutputCount
      : Math.max(
        1,
        task.params?.n || 1,
        task.outputImages?.length || 0,
        task.outputSlots?.length || 0,
      )

    return Array.from({ length: targetCount }, (_, index) => {
      const oneBasedIndex = index + 1
      const savedSlot = slotByIndex.get(oneBasedIndex) || task.outputSlots?.[index]
      if (savedSlot) {
        return {
          ...savedSlot,
          index: oneBasedIndex,
          imageId: savedSlot.imageId || task.outputImages?.[index] || null,
        }
      }

      const imageId = task.outputImages?.[index] || null
      return {
        index: oneBasedIndex,
        imageId,
        status: imageId
          ? 'done' as const
          : task.status === 'error'
            ? 'error' as const
            : task.status === 'running' && index === (task.outputImages?.length || 0)
              ? 'running' as const
              : 'queued' as const,
        error: task.status === 'error' ? task.error : null,
        startedAt: null,
        finishedAt: null,
      }
    })
  }, [task])

  const targetOutputCount = outputSlots.length || 1
  const outputLen = outputSlots.filter((slot) => slot.imageId).length
  const currentOutputSlot = outputSlots[imageIndex]
  const currentOutputImageId = currentOutputSlot?.imageId || ''
  const currentOutputImageSrc = currentOutputImageId ? imageSrcs[currentOutputImageId] || '' : ''
  const outputImageIds = outputSlots.flatMap((slot) => (slot.imageId ? [slot.imageId] : []))

  useEffect(() => {
    if (!task) return
    const nextCount = Math.max(1, outputSlots.length)
    if (imageIndex >= nextCount) setImageIndex(Math.max(0, nextCount - 1))
  }, [imageIndex, task, outputSlots.length])

  useEffect(() => {
    if (!currentOutputImageId || !currentOutputImageSrc) return

    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setImageRatios((prev) => ({
          ...prev,
          [currentOutputImageId]: formatImageRatio(image.naturalWidth, image.naturalHeight),
        }))
        setImageSizes((prev) => ({
          ...prev,
          [currentOutputImageId]: `${image.naturalWidth}×${image.naturalHeight}`,
        }))
      }
    }
    image.src = currentOutputImageSrc
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      setImageRatios((prev) => ({
        ...prev,
        [currentOutputImageId]: formatImageRatio(image.naturalWidth, image.naturalHeight),
      }))
      setImageSizes((prev) => ({
        ...prev,
        [currentOutputImageId]: `${image.naturalWidth}×${image.naturalHeight}`,
      }))
    }

    return () => {
      cancelled = true
    }
  }, [currentOutputImageId, currentOutputImageSrc])

  useEffect(() => {
    let cancelled = false
    const maskTargetImageId = task?.maskTargetImageId ?? (task?.maskImageId ? task.inputImageIds?.[0] : null)
    const sourceSrc = maskTargetImageId ? imageSrcs[maskTargetImageId] : ''
    const maskSrc = task?.maskImageId ? imageSrcs[task.maskImageId] : ''

    if (!sourceSrc || !maskSrc) {
      setMaskPreviewSrc('')
      return
    }

    createMaskPreviewDataUrl(sourceSrc, maskSrc)
      .then((preview) => {
        if (!cancelled) setMaskPreviewSrc(preview)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewSrc('')
      })

    return () => {
      cancelled = true
    }
  }, [task, imageSrcs])

  useEffect(() => {
    const updateImageLabelLeft = () => {
      const panel = imagePanelRef.current
      const image = mainImageRef.current
      if (!panel || !image) return

      const panelRect = panel.getBoundingClientRect()
      const imageRect = image.getBoundingClientRect()
      setImageLabelLeft(Math.max(8, imageRect.left - panelRect.left))
    }

    updateImageLabelLeft()
    window.addEventListener('resize', updateImageLabelLeft)
    return () => window.removeEventListener('resize', updateImageLabelLeft)
  }, [currentOutputImageSrc])

  const goToImage = useCallback((nextIndex: number) => {
    setImageIndex(((nextIndex % targetOutputCount) + targetOutputCount) % targetOutputCount)
  }, [targetOutputCount])

  const setSwipeOffset = useCallback((offset: number) => {
    if (swipeFrameRef.current !== null) window.cancelAnimationFrame(swipeFrameRef.current)
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null
      swipeSurfaceRef.current?.style.setProperty('--detail-swipe-x', `${offset}px`)
    })
  }, [])

  const resetSwipeOffset = useCallback(() => {
    if (swipeFrameRef.current !== null) {
      window.cancelAnimationFrame(swipeFrameRef.current)
      swipeFrameRef.current = null
    }
    swipeSurfaceRef.current?.style.setProperty('--detail-swipe-x', '0px')
  }, [])

  useEffect(() => () => {
    if (swipeFrameRef.current !== null) window.cancelAnimationFrame(swipeFrameRef.current)
  }, [])

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || targetOutputCount <= 1) return
    swipeStateRef.current = {
      startX: event.touches[0].clientX,
      startY: event.touches[0].clientY,
      active: true,
      moved: false,
    }
    setIsSwipeDragging(true)
  }

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const state = swipeStateRef.current
    if (!state.active || event.touches.length !== 1) return
    const dx = event.touches[0].clientX - state.startX
    const dy = event.touches[0].clientY - state.startY
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.15) return
    event.preventDefault()
    state.moved = true
    suppressImageClickRef.current = true
    setSwipeOffset(Math.max(-90, Math.min(90, dx)))
  }

  const handleTouchEnd = () => {
    const state = swipeStateRef.current
    if (!state.active) return
    const surfaceStyle = swipeSurfaceRef.current?.style.getPropertyValue('--detail-swipe-x') || '0px'
    const dx = Number(surfaceStyle.replace('px', '')) || 0
    if (state.moved && Math.abs(dx) > 42) {
      goToImage(imageIndex + (dx < 0 ? 1 : -1))
    }
    swipeStateRef.current.active = false
    setIsSwipeDragging(false)
    resetSwipeOffset()
    window.setTimeout(() => {
      suppressImageClickRef.current = false
    }, 120)
  }

  const getSlotStatus = (index: number) => {
    const slot = outputSlots[index]
    if (slot?.status) return slot.status
    if (task?.outputImages?.[index]) return 'done'
    if (task?.status === 'error') return 'error'
    if (task?.status === 'running') return index === outputLen ? 'running' : 'queued'
    return 'queued'
  }

  if (!task) return null

  const currentImageRatio = currentOutputImageId ? imageRatios[currentOutputImageId] : ''
  const currentImageSize = currentOutputImageId ? imageSizes[currentOutputImageId] : ''
  const currentSlotError = currentOutputSlot?.error || task.error || ''
  const currentActualParams = currentOutputImageId
    ? task.actualParamsByImage?.[currentOutputImageId] ?? currentOutputSlot?.actualParams
    : undefined
  const currentRevisedPrompt = currentOutputImageId
    ? (task.revisedPromptByImage?.[currentOutputImageId] ?? currentOutputSlot?.revisedPrompt ?? '').trim()
    : ''
  const showRevisedPrompt = Boolean(currentRevisedPrompt && currentRevisedPrompt !== task.prompt.trim())
  const codexCliPromptKey = getCodexCliPromptKey(settings)
  const hasHandledPromptWarning = settings.codexCli || dismissedCodexCliPrompts.includes(codexCliPromptKey)
  const showPromptWarning = Boolean(currentOutputImageId && (!currentRevisedPrompt || showRevisedPrompt) && !hasHandledPromptWarning)
  const aggregateActualParams = outputLen > 0 ? { ...task.actualParams, n: outputLen } : task.actualParams
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds?.[0] : null)

  const formatTime = (ts: number | null) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString('zh-CN')
  }

  const formatDuration = () => {
    if (task.elapsed == null) return null
    const seconds = Math.max(0, Math.floor(task.elapsed / 1000))
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const handleReuse = () => {
    reuseConfig(task)
    setDetailTaskId(null)
  }

  const handleEdit = () => {
    editOutputs(task)
    setDetailTaskId(null)
  }

  const handleMaskEditCurrentOutput = () => {
    if (!currentOutputImageId) return
    setMaskEditorImageId(currentOutputImageId)
    setDetailTaskId(null)
  }

  const handleDelete = () => {
    setDetailTaskId(null)
    setConfirmDialog({
      title: '删除记录',
      message: '确定要删除这条记录吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  const handleDeleteCurrentImage = () => {
    if (!currentOutputImageId || outputLen <= 1) return
    setConfirmDialog({
      title: '删除当前图片',
      message: `只删除当前任务里的第 ${imageIndex + 1} 张输出图，其他图片和任务记录会保留。确定继续吗？`,
      action: () => removeOutputImage(task, currentOutputImageId),
    })
  }

  const handleCopyError = async () => {
    const errorText = currentSlotError || task.error || '生成失败'
    try {
      await copyTextToClipboard(errorText)
      showToast('完整报错已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制报错失败', err), 'error')
    }
  }

  const handleCopyPrompt = async () => {
    if (!task.prompt) return
    try {
      await copyTextToClipboard(task.prompt)
      showToast('提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制提示词失败', err), 'error')
    }
  }

  const handleShowPromptWarning = () => {
    showCodexCliPrompt(
      true,
      currentRevisedPrompt ? '接口返回的提示词已被改写' : '接口没有返回官方 API 会返回的部分信息',
    )
  }

  const handleCopyInputImage = async () => {
    const imgId = task.inputImageIds?.[0]
    const src = imgId ? imageSrcs[imgId] : ''
    if (!src) return
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      await copyBlobToClipboard(blob)
      showToast('参考图已复制', 'success')
    } catch (err) {
      console.error(err)
      showToast(getClipboardFailureMessage('复制参考图失败', err), 'error')
    }
  }

  const handleRetry = () => {
    retryTask(task)
    setDetailTaskId(null)
  }

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => setDetailTaskId(null)}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row z-10 ring-1 ring-black/5 dark:ring-white/10 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-14 items-center justify-end px-4 md:hidden">
          <button
            onClick={() => setDetailTaskId(null)}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400"
            aria-label="关闭"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 左侧：图片 */}
        <div
          ref={imagePanelRef}
          className="md:w-1/2 w-full h-64 md:h-auto bg-gray-100 dark:bg-black/20 relative flex items-center justify-center flex-shrink-0 min-h-[16rem] overflow-hidden touch-pan-y"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <div ref={swipeSurfaceRef} className={`detail-swipe-surface ${isSwipeDragging ? 'dragging' : ''}`}>
            {currentOutputImageId && currentOutputImageSrc ? (
              <img
                ref={mainImageRef}
                src={currentOutputImageSrc}
                className="saveable-image max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] object-contain cursor-pointer"
                decoding="async"
                onLoad={() => {
                  const panel = imagePanelRef.current
                  const image = mainImageRef.current
                  if (!panel || !image) return

                  const panelRect = panel.getBoundingClientRect()
                  const imageRect = image.getBoundingClientRect()
                  setImageLabelLeft(Math.max(8, imageRect.left - panelRect.left))
                }}
                onClick={() => {
                  if (suppressImageClickRef.current) return
                  setLightboxImageId(currentOutputImageId, outputImageIds)
                }}
                alt=""
              />
            ) : currentOutputImageId ? (
              <div className="flex flex-col items-center gap-2 text-gray-400 dark:text-gray-500">
                <svg className="w-9 h-9 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs">正在加载第 {imageIndex + 1} 张...</span>
              </div>
            ) : getSlotStatus(imageIndex) === 'error' ? (
              <div className="w-full max-w-md px-4 text-center">
                <svg className="w-10 h-10 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm leading-6 text-red-500 break-all">
                  第 {imageIndex + 1} 张生成失败{currentSlotError ? `：${currentSlotError}` : ''}
                </p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  {currentSlotError && (
                    <button
                      type="button"
                      onClick={handleCopyError}
                      className="inline-flex items-center justify-center rounded-full border border-red-200/80 bg-white/80 px-3 py-1.5 text-red-500 transition hover:bg-red-50 dark:border-red-400/20 dark:bg-white/[0.04] dark:hover:bg-red-500/10"
                      aria-label="复制完整报错"
                      title="复制完整报错"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="inline-flex items-center justify-center rounded-full border border-blue-200/80 bg-white/80 px-3 py-1.5 text-blue-500 transition hover:bg-blue-50 dark:border-blue-400/20 dark:bg-white/[0.04] dark:hover:bg-blue-500/10"
                    aria-label="重试任务"
                    title="重试任务"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-400 dark:text-gray-500">
                {getSlotStatus(imageIndex) === 'running' ? (
                  <svg className="w-10 h-10 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-10 h-10 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <span className="text-xs">
                  {getSlotStatus(imageIndex) === 'running'
                    ? `第 ${imageIndex + 1} 张生成中...`
                    : `第 ${imageIndex + 1} 张等待生成`}
                </span>
              </div>
            )}
          </div>

          {currentOutputImageId && currentOutputImageSrc && (
            <div className="absolute top-[15px] flex items-center gap-1.5" style={{ left: imageLabelLeft }}>
              {currentImageRatio && currentImageSize ? (
                <>
                  <span className="bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
                    {currentImageRatio}
                  </span>
                  <span className="bg-black/50 text-white/90 text-xs px-2 py-0.5 rounded backdrop-blur-sm font-medium">
                    {currentImageSize}
                  </span>
                </>
              ) : (
                formatDuration() && (
                  <span className="flex items-center gap-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {formatDuration()}
                  </span>
                )
              )}
            </div>
          )}

          {targetOutputCount > 1 && (
            <>
              <button
                onClick={() => goToImage(imageIndex - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                aria-label="上一张"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={() => goToImage(imageIndex + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                aria-label="下一张"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 backdrop-blur-sm">
                {Array.from({ length: targetOutputCount }, (_, index) => {
                  const status = getSlotStatus(index)
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => goToImage(index)}
                      className={`h-2.5 rounded-full transition-all ${index === imageIndex ? 'w-5' : 'w-2.5'} ${
                        status === 'done'
                          ? 'bg-green-400'
                          : status === 'running'
                            ? 'bg-blue-400 animate-pulse'
                            : status === 'error'
                              ? 'bg-red-400'
                              : 'bg-white/45'
                      }`}
                      aria-label={`第 ${index + 1} 张：${status}`}
                    />
                  )
                })}
                <span className="ml-1 text-[10px] text-white/90">{imageIndex + 1}/{targetOutputCount}</span>
              </div>
            </>
          )}
        </div>
        {/* 右侧：信息 */}
        <div className="md:w-1/2 w-full p-5 overflow-y-auto flex flex-col">
          <button
            onClick={() => setDetailTaskId(null)}
            className="absolute top-3 right-3 hidden p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400 z-10 md:block"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div data-selectable-text className="flex-1">
            <div className="flex items-center gap-1.5 mb-2">
              <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                输入内容
              </h3>
              {task.prompt && (
                <button
                  onClick={handleCopyPrompt}
                  className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/[0.06] transition"
                  title="复制提示词"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              )}
              {showPromptWarning && (
                <button
                  type="button"
                  onClick={handleShowPromptWarning}
                  className="p-1 rounded text-amber-500 hover:bg-amber-50 dark:text-yellow-300 dark:hover:bg-yellow-500/10 transition"
                  title={currentRevisedPrompt ? '提示词已被接口改写' : '接口未返回官方提示词信息'}
                  aria-label={currentRevisedPrompt ? '提示词已被接口改写' : '接口未返回官方提示词信息'}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </button>
              )}
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap mb-4">
              {task.prompt || '(无提示词)'}
            </p>

            {showRevisedPrompt && (
              <div className="mb-4">
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  API 改写提示词
                </div>
                <ActualValueBadge
                  value={currentRevisedPrompt}
                  className="max-w-full rounded px-2 py-1 text-left text-xs leading-relaxed whitespace-pre-wrap"
                />
              </div>
            )}

            {currentUser?.role === 'admin' && task.username && (
              <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
                <span className="text-gray-400 dark:text-gray-500">归属用户</span>
                <br />
                <span className="font-medium text-gray-700 dark:text-gray-300">{task.username}</span>
              </div>
            )}

            <div className="mb-4 rounded-xl bg-gray-50 px-3 py-2.5 text-xs dark:bg-white/[0.03]">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-gray-500 dark:text-gray-400">输出进度</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 dark:text-gray-500">{outputLen}/{targetOutputCount}</span>
                  {currentOutputImageId && outputLen > 1 && (
                    <button
                      type="button"
                      onClick={handleDeleteCurrentImage}
                      className="rounded-full bg-red-50 px-2 py-1 font-medium text-red-500 transition hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
                      title="删除当前图片"
                    >
                      删除当前图
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: targetOutputCount }, (_, index) => {
                  const status = getSlotStatus(index)
                  const label = status === 'done' ? '已完成' : status === 'running' ? '生成中' : status === 'error' ? '失败' : '等待'
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => goToImage(index)}
                      className={`rounded-full px-2 py-1 transition ${
                        index === imageIndex
                          ? 'ring-2 ring-blue-400/40'
                          : ''
                      } ${
                        status === 'done'
                          ? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-300'
                          : status === 'running'
                            ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
                            : status === 'error'
                              ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-300'
                              : 'bg-white text-gray-500 dark:bg-white/[0.04] dark:text-gray-400'
                      }`}
                    >
                      图 {index + 1} · {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 参考图 */}
            {task.inputImageIds?.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    参考图
                  </h3>
                  <button
                    onClick={handleCopyInputImage}
                    className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/[0.06] transition"
                    title="复制参考图"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {task.inputImageIds.map((imgId) => {
                    const isMaskTarget = imgId === maskTargetImageId
                    const src = isMaskTarget && maskPreviewSrc ? maskPreviewSrc : imageSrcs[imgId] || ''
                    return (
                      <button
                        key={imgId}
                        type="button"
                        className={`relative h-16 w-16 overflow-hidden rounded-lg border transition hover:opacity-80 ${
                          isMaskTarget
                            ? 'border-blue-400 ring-2 ring-blue-400/20'
                            : 'border-gray-200 dark:border-white/[0.08]'
                        }`}
                        onClick={() => setLightboxImageId(imgId, task.inputImageIds)}
                      >
                        <img
                          src={src}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                          alt=""
                        />
                        {isMaskTarget && (
                          <span className="absolute bottom-1 left-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                            MASK
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 参数 */}
            <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              参数配置
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs mb-4">
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                <span className="text-gray-400 dark:text-gray-500">尺寸</span>
                <br />
                <DetailParamValue task={task} paramKey="size" className="font-medium" actualParams={currentActualParams} />
              </div>
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                <span className="text-gray-400 dark:text-gray-500">质量</span>
                <br />
                <DetailParamValue task={task} paramKey="quality" className="font-medium" actualParams={currentActualParams} />
              </div>
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                <span className="text-gray-400 dark:text-gray-500">格式</span>
                <br />
                <DetailParamValue task={task} paramKey="output_format" className="font-medium" actualParams={currentActualParams} />
              </div>
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                <span className="text-gray-400 dark:text-gray-500">审核</span>
                <br />
                <DetailParamValue task={task} paramKey="moderation" className="font-medium" actualParams={currentActualParams} />
              </div>
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                <span className="text-gray-400 dark:text-gray-500">数量</span>
                <br />
                <DetailParamValue task={task} paramKey="n" className="font-medium" actualParams={aggregateActualParams} />
              </div>
              {task.params.output_compression != null && (
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                  <span className="text-gray-400 dark:text-gray-500">压缩率</span>
                  <br />
                  <DetailParamValue task={task} paramKey="output_compression" className="font-medium" actualParams={currentActualParams} />
                </div>
              )}
            </div>

            {/* 时间 */}
            <div className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              <span>创建于 {formatTime(task.createdAt)}</span>
              {formatDuration() && <span> · 耗时 {formatDuration()}</span>}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-3 border-t border-gray-100 dark:border-white/[0.08]">
            <button
              onClick={handleReuse}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition text-xs sm:text-sm font-medium whitespace-nowrap"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              复用配置
            </button>
            <button
              onClick={handleEdit}
              disabled={!outputLen}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition text-xs sm:text-sm font-medium whitespace-nowrap"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              编辑输出
            </button>
            <button
              onClick={handleMaskEditCurrentOutput}
              disabled={!currentOutputImageId}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition text-xs sm:text-sm font-medium whitespace-nowrap"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20h4.5L19.5 9a2.5 2.5 0 00-3.536-3.536L5 16.5V20zM15 5l4 4" />
              </svg>
              遮罩编辑
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition text-xs sm:text-sm font-medium whitespace-nowrap"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              删除记录
            </button>
            <button
              onClick={() => toggleTaskFavorite(task)}
              className={`flex flex-shrink-0 items-center justify-center rounded-lg px-3 py-2 transition ${
                task.isFavorite
                  ? 'bg-yellow-50 text-yellow-500 hover:bg-yellow-100 dark:bg-yellow-500/10 dark:hover:bg-yellow-500/20'
                  : 'bg-gray-50 text-gray-400 hover:bg-yellow-50 hover:text-yellow-500 dark:bg-white/[0.04] dark:hover:bg-yellow-500/10'
              }`}
              title={task.isFavorite ? '取消收藏' : '收藏记录'}
            >
              <svg className="w-5 h-5" fill={task.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
