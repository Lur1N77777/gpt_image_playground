// ===== 设置 =====

export type ApiMode = 'images' | 'responses'
export type GenerationMode = 'cloud' | 'local'

export interface ApiProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  apiPaths: ApiEndpointPaths
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
}

export interface ApiEndpointPaths {
  imagesGenerations: string
  imagesEdits: string
  responses: string
  models: string
}

export interface AppSettings {
  /** 旧版单配置字段：保留用于兼容导入/查询参数；实际请求会同步到当前 active profile */
  baseUrl: string
  apiKey: string
  model: string
  apiPaths: ApiEndpointPaths
  timeout: number
  apiMode: ApiMode
  /** Codex CLI API 兼容模式：不发送 quality，并对提示词加不改写前缀 */
  codexCli: boolean
  /** Docker/Nginx 同源 API 代理开关；Cloudflare 部署默认使用自身 /api/openai 后台代理 */
  apiProxy: boolean
  imageCacheEnabled: boolean
  profiles: ApiProfile[]
  activeProfileId: string
}

const DEFAULT_BASE_URL = import.meta.env.VITE_DEFAULT_API_URL?.trim() || '/api/openai'
export const DEFAULT_IMAGES_MODEL = 'gpt-image-2'
export const DEFAULT_RESPONSES_MODEL = 'gpt-5.5'
export const DEFAULT_API_PROFILE_ID = 'default-openai'

export const DEFAULT_API_PROFILE: ApiProfile = {
  id: DEFAULT_API_PROFILE_ID,
  name: '默认后台代理',
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  apiPaths: {
    imagesGenerations: 'images/generations',
    imagesEdits: 'images/edits',
    responses: 'responses',
    models: 'models',
  },
  model: DEFAULT_IMAGES_MODEL,
  timeout: 300,
  apiMode: 'images',
  codexCli: false,
  apiProxy: false,
}

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: DEFAULT_API_PROFILE.baseUrl,
  apiKey: DEFAULT_API_PROFILE.apiKey,
  model: DEFAULT_API_PROFILE.model,
  apiPaths: { ...DEFAULT_API_PROFILE.apiPaths },
  timeout: DEFAULT_API_PROFILE.timeout,
  apiMode: 'images',
  codexCli: false,
  apiProxy: false,
  imageCacheEnabled: true,
  profiles: [{ ...DEFAULT_API_PROFILE }],
  activeProfileId: DEFAULT_API_PROFILE_ID,
}

// ===== 登录用户 =====

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'user'
  generationMode: GenerationMode
}

export interface AdminUserSummary {
  id: string
  username: string
  role: 'admin' | 'user'
  createdAt: number
  jobCount: number
  doneCount: number
  runningCount: number
  errorCount: number
  lastJobAt: number | null
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
}

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface MaskDraft {
  /** 作为局部编辑目标的输入图片 id */
  targetImageId: string
  /** 透明区域表示需要保留，不透明区域表示需要编辑 */
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

export type OutputSlotStatus = 'queued' | 'running' | 'done' | 'error'

export interface TaskOutputSlot {
  index: number
  imageId: string | null
  status: OutputSlotStatus
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  /** 单张输出图 API 实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 单张输出图 API 改写后的提示词 */
  revisedPrompt?: string
}

export interface TaskRecord {
  id: string
  /** 后台任务归属用户 ID；用于 admin 筛选 */
  userId?: string | null
  /** 后台任务归属用户；admin 视图会显示 */
  username?: string | null
  prompt: string
  params: TaskParams
  /** 任务使用的 API 模式 */
  apiMode?: ApiMode
  /** 是否使用 Codex CLI API 兼容模式 */
  codexCli?: boolean
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  /** 局部编辑目标图 id */
  maskTargetImageId?: string | null
  /** 遮罩图 image store id */
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 后台多图任务的每张图状态，用于详情页左右滑动查看 */
  outputSlots?: TaskOutputSlot[]
  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否为 Cloudflare 后台任务 */
  remote?: boolean
  /** 是否收藏 */
  isFavorite?: boolean
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 后台远程缓存 */
  source?: 'upload' | 'generated' | 'remote-cache' | 'mask'
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  type?: string
  result?: string | {
    b64_json?: string
    image?: string
    data?: string
  }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  settings: AppSettings
  tasks: TaskRecord[]
  /** imageId → 图片信息 */
  imageFiles: Record<string, {
    path: string
    createdAt?: number
    source?: StoredImage['source']
  }>
}
