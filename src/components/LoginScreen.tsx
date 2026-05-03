import { useState, type FormEvent } from 'react'
import { loginWithPassword } from '../lib/authApi'
import { normalizeBaseUrl } from '../lib/api'
import { refreshRemoteTasks, useStore } from '../store'
import { DEFAULT_SETTINGS } from '../types'

export default function LoginScreen() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setAuth = useStore((s) => s.setAuth)
  const setTasks = useStore((s) => s.setTasks)
  const showToast = useStore((s) => s.showToast)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return

    const apiBaseUrl = normalizeBaseUrl(settings.baseUrl || DEFAULT_SETTINGS.baseUrl)
    setLoading(true)
    setError(null)
    try {
      const result = await loginWithPassword(apiBaseUrl, username, password)
      setSettings({ baseUrl: apiBaseUrl, apiKey: '' })
      setAuth(result.user, result.token)
      setTasks([])
      await refreshRemoteTasks(true)
      showToast(`已登录：${result.user.username}`, 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 px-4 py-10 dark:from-gray-950 dark:via-gray-950 dark:to-blue-950/30">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center justify-center">
        <form
          onSubmit={handleSubmit}
          className="w-full rounded-3xl border border-white/70 bg-white/90 p-6 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/90 dark:ring-white/10"
        >
          <div className="mb-6 text-center">
            <img
              src="/logo.png"
              alt="Linmh Image Playground"
              className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover shadow-lg shadow-blue-500/20"
            />
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Linmh Image Playground</h1>
            <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
              输入用户名和密码进入。普通用户只能看到自己的生成记录；admin 可管理全部记录。
            </p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">用户名</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="例如 user1 或 admin"
                className="w-full rounded-xl border border-gray-200/80 bg-white/80 px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:border-blue-500/60"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">密码</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="首次普通用户会自动创建"
                className="w-full rounded-xl border border-gray-200/80 bg-white/80 px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:border-blue-500/60"
              />
            </label>

            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="flex w-full items-center justify-center rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none dark:disabled:bg-white/[0.06]"
            >
              {loading ? '登录中...' : '登录 / 创建用户'}
            </button>
          </div>

          <p className="mt-5 text-center text-[11px] leading-5 text-gray-400 dark:text-gray-500">
            会话会保存在当前浏览器；换浏览器时输入相同用户名和密码即可看到自己的云端图片。
          </p>
        </form>
      </div>
    </div>
  )
}
