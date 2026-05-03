import { useStore } from '../store'
import Select from './Select'

export default function SearchBar() {
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const currentUser = useStore((s) => s.currentUser)
  const adminUsers = useStore((s) => s.adminUsers)
  const selectedUserFilter = useStore((s) => s.selectedUserFilter)
  const setSelectedUserFilter = useStore((s) => s.setSelectedUserFilter)
  const isAdmin = currentUser?.role === 'admin'

  return (
    <div className="mt-3 mb-3 flex flex-nowrap items-center gap-1.5 sm:mt-6 sm:mb-4 sm:gap-3">
      <button
        type="button"
        onClick={() => setFilterFavorite(!filterFavorite)}
        className={`relative z-20 flex h-[2.125rem] w-[2.125rem] flex-shrink-0 items-center justify-center rounded-xl border transition-all sm:h-[2.625rem] sm:w-[2.625rem] ${
          filterFavorite
            ? 'border-yellow-400 bg-yellow-50 text-yellow-500 dark:bg-yellow-500/10'
            : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50 hover:text-yellow-500 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]'
        }`}
        title={filterFavorite ? '取消只看收藏' : '只看收藏'}
        aria-label={filterFavorite ? '取消只看收藏' : '只看收藏'}
      >
        <svg className="h-4 w-4 sm:h-5 sm:w-5" fill={filterFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>

      <div className="relative z-20 w-[5.65rem] flex-shrink-0 sm:w-32">
        <Select
          value={filterStatus}
          onChange={(val) => setFilterStatus(val as any)}
          options={[
            { label: '全部状态', value: 'all' },
            { label: '已完成', value: 'done' },
            { label: '生成中', value: 'running' },
            { label: '失败', value: 'error' },
          ]}
          className="px-2 py-2 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-white/[0.06] text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
        />
      </div>

      {isAdmin && (
        <div className="relative z-20 w-[5.85rem] flex-shrink-0 sm:w-44">
          <Select
            value={selectedUserFilter}
            onChange={(val) => setSelectedUserFilter(val)}
            options={[
              { label: `全部用户 (${adminUsers.length})`, selectedLabel: '全部用户', value: 'all' },
              ...adminUsers.map((user) => ({
                label: `${user.username}${user.role === 'admin' ? ' · admin' : ''} · ${user.jobCount}`,
                value: user.id,
              })),
            ]}
            className="px-2 py-2 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-white/[0.06] text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
          />
        </div>
      )}

      <div className="relative z-10 min-w-0 flex-1">
        <svg
          className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          placeholder={isAdmin ? '搜索提示词、参数、用户名...' : '搜索提示词、参数...'}
          className="w-full min-w-0 pl-8 pr-3 sm:pl-10 sm:pr-4 py-2 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
        />
      </div>
    </div>
  )
}