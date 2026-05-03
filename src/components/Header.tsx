import { useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import HelpModal from './HelpModal'

export default function Header() {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const currentUser = useStore((s) => s.currentUser)
  const { hasUpdate, latestRelease, dismiss } = useVersionCheck()
  const [showHelp, setShowHelp] = useState(false)

  return (
    <header className="safe-area-top sticky top-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08]">
      <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between">
        <h1 className="min-w-0 text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100 tracking-tight flex items-center gap-2">
          <img src="/logo.png" alt="Linmh Image Playground" className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg object-cover shadow-sm flex-shrink-0" />
          <span className="truncate">Linmh Image Playground</span>
        </h1>
        <div className="flex flex-shrink-0 items-center gap-1">
          {currentUser && (
            <button
              onClick={() => setShowSettings(true)}
              className="hidden rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] sm:inline-flex"
              title="当前登录用户"
            >
              {currentUser.username}
              {currentUser.role === 'admin' && <span className="ml-1 text-blue-500">admin</span>}
            </button>
          )}
          {/* 新版本提示 */}
          {hasUpdate && latestRelease && (
            <a
              href={latestRelease.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors animate-fade-in"
              title={`新版本 ${latestRelease.tag}`}
            >
              New
            </a>
          )}
          <button
            onClick={() => setShowHelp(true)}
            className="p-2.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors touch-manipulation"
            title="操作指南"
            aria-label="操作指南"
          >
            <svg
              className="w-5 h-5 text-gray-600 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors touch-manipulation"
            title="设置"
          >
            <svg
              className="w-5 h-5 text-gray-600 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </header>
  )
}
