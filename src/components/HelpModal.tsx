import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

interface HelpModalProps {
  onClose: () => void
}

export default function HelpModal({ onClose }: HelpModalProps) {
  useCloseOnEscape(true, onClose)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 custom-scrollbar"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">操作指南</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
          <section className="rounded-2xl bg-gray-50 p-4 dark:bg-white/[0.03]">
            <h4 className="mb-2 font-medium text-gray-800 dark:text-gray-100">生成与后台任务</h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>填写提示词后点击“生成图像”，任务会提交到 Cloudflare 后台；手机或电脑关闭浏览器后仍会继续生成。</li>
              <li>选择多张数量时，后台会并行生成，并且每张请求间隔约 1 秒，降低偶发失败概率。</li>
              <li>任务详情页可以左右滑动查看多张图片的完成状态；点开大图后也可以左右滑动切换。</li>
            </ul>
          </section>

          <section className="rounded-2xl bg-gray-50 p-4 dark:bg-white/[0.03]">
            <h4 className="mb-2 font-medium text-gray-800 dark:text-gray-100">筛选、收藏与批量管理</h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>搜索框右侧的星标用于“只看收藏”。卡片或详情页里的星标可以收藏/取消收藏任务。</li>
              <li>桌面端可拖拽框选任务，也可以按住 Ctrl/⌘ 后点击卡片进行多选。</li>
              <li>手机端在历史卡片上左右滑动即可选择/取消选择；选中后底部会出现批量操作栏。</li>
              <li>批量操作栏支持全选当前可见内容、导出、收藏、取消收藏或删除选中任务。</li>
              <li>admin 用户可以在顶部筛选不同用户，并管理所有用户的图片任务。</li>
            </ul>
          </section>

          <section className="rounded-2xl bg-gray-50 p-4 dark:bg-white/[0.03]">
            <h4 className="mb-2 font-medium text-gray-800 dark:text-gray-100">实际参数追踪</h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>接口返回的实际尺寸、质量、格式、数量等会记录到任务里。</li>
              <li>如果实际值和请求值不同，卡片和详情页会用黄色标签提示。</li>
              <li>如果接口返回了改写后的提示词，详情页会单独显示，方便判断上游是否改写了输入。</li>
            </ul>
          </section>

          <section className="rounded-2xl bg-gray-50 p-4 dark:bg-white/[0.03]">
            <h4 className="mb-2 font-medium text-gray-800 dark:text-gray-100">API 模式</h4>
            <p>
              设置里可以在 Images API 和 Responses API 之间切换。默认保持 Images API；如果你的上游接口要求
              <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-white/[0.06]">/v1/responses</code>
              和 <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-white/[0.06]">image_generation</code>
              工具，就切到 Responses API。
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
