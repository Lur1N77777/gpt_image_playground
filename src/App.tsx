import { useEffect, useState } from 'react'
import { initStore, refreshRemoteTasks } from './store'
import { useStore } from './store'
import { isRelativeApiBaseUrl, normalizeBaseUrl } from './lib/api'
import { getCurrentUser } from './lib/authApi'
import type { ApiMode } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import LoginScreen from './components/LoginScreen'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import MaskEditorModal from './components/MaskEditorModal'

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const settings = useStore((s) => s.settings)
  const currentUser = useStore((s) => s.currentUser)
  const sessionToken = useStore((s) => s.sessionToken)
  const setAuth = useStore((s) => s.setAuth)
  const clearAuth = useStore((s) => s.clearAuth)
  const setTasks = useStore((s) => s.setTasks)
  const showToast = useStore((s) => s.showToast)
  const [booting, setBooting] = useState(true)

  const useLocalGeneration = (user: typeof currentUser) =>
    user?.role === 'admin' && user.generationMode === 'local'

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      const searchParams = new URLSearchParams(window.location.search)
      const nextSettings: { baseUrl?: string; apiKey?: string; apiMode?: ApiMode; codexCli?: boolean } = {}

      const apiUrlParam = searchParams.get('apiUrl')
      if (apiUrlParam !== null) {
        nextSettings.baseUrl = normalizeBaseUrl(apiUrlParam.trim())
      }

      const apiKeyParam = searchParams.get('apiKey')
      if (apiKeyParam !== null) {
        nextSettings.apiKey = apiKeyParam.trim()
      }

      const apiModeParam = searchParams.get('apiMode')
      if (apiModeParam === 'images' || apiModeParam === 'responses') {
        nextSettings.apiMode = apiModeParam
      }

      const codexCliParam = searchParams.get('codexCli')
      if (codexCliParam !== null) {
        nextSettings.codexCli = codexCliParam.trim().toLowerCase() === 'true'
      }

      if (Object.keys(nextSettings).length > 0) {
        setSettings(nextSettings)

        searchParams.delete('apiUrl')
        searchParams.delete('apiKey')
        searchParams.delete('apiMode')
        searchParams.delete('codexCli')

        const nextSearch = searchParams.toString()
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
        window.history.replaceState(null, '', nextUrl)
      }

      setSettings(useStore.getState().settings)

      const state = useStore.getState()
      const isServerProxy = isRelativeApiBaseUrl(state.settings.baseUrl)
      if (!isServerProxy) {
        await initStore()
      } else {
        setTasks([])
        if (state.sessionToken) {
          try {
            const user = await getCurrentUser(state.settings.baseUrl, state.sessionToken)
            if (cancelled) return
            setAuth(user, state.sessionToken)
            if (useLocalGeneration(user)) {
              await initStore()
            } else {
              await refreshRemoteTasks(true)
            }
          } catch (error) {
            if (cancelled) return
            console.error(error)
            clearAuth()
            showToast('登录已过期，请重新登录', 'error')
          }
        }
      }

      if (!cancelled) setBooting(false)
    }

    boot()
    return () => {
      cancelled = true
    }
  }, [clearAuth, setAuth, setSettings, setTasks, showToast])

  useEffect(() => {
    if (!sessionToken || useLocalGeneration(currentUser)) return

    refreshRemoteTasks()
    const intervalId = window.setInterval(() => refreshRemoteTasks(), 5000)
    return () => window.clearInterval(intervalId)
  }, [sessionToken, settings.baseUrl, currentUser])

  const requiresLogin = isRelativeApiBaseUrl(settings.baseUrl)

  if (booting) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-white text-sm text-gray-400 dark:bg-gray-950 dark:text-gray-500">
          正在加载...
        </div>
        <Toast />
      </>
    )
  }

  if (requiresLogin && (!sessionToken || !currentUser)) {
    return (
      <>
        <LoginScreen />
        <Toast />
      </>
    )
  }

  return (
    <>
      <Header />
      <main data-drag-select-surface className="max-w-7xl mx-auto px-4 pb-48">
        <SearchBar />
        <TaskGrid />
      </main>
      <InputBar />
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <MaskEditorModal />
      <ConfirmDialog />
      <Toast />
      <ImageContextMenu />
    </>
  )
}
