# Cloudflare Pages + Functions 部署

本分支默认使用 `/api/openai` 作为前端 API URL，并通过 Cloudflare Pages Function
代理 OpenAI Images API。浏览器端使用用户名/密码登录，真正的
`OPENAI_API_KEY` / `OPENAI_API_KEYS` 仅保存在 Cloudflare Secret 中。

新版还支持后台任务：

- 前端提交到 `/api/openai/jobs` 后立即返回任务 ID。
- Pages Function 将任务写入 D1，并发送到 Cloudflare Queue。
- Worker 消费队列并调用图片接口。
- 参考图和生成结果保存到 R2。
- 重新打开网页后通过 D1/R2 恢复任务和图片。
- 后台 Worker 每天 UTC 20:00（北京时间 04:00）自动清理创建超过 24 小时的任务和关联图片。

## 本地构建

```powershell
npm install
npm run build
```

## Cloudflare Pages 部署

先创建后台资源：

```powershell
npx wrangler d1 create gpt-image-playground-db
npx wrangler r2 bucket create gpt-image-playground-images
npx wrangler queues create gpt-image-playground-jobs
```

把 D1 命令输出的 `database_id` 写入：

- `wrangler.toml`
- `wrangler.image-worker.toml`

然后应用 D1 schema：

```powershell
npx wrangler d1 migrations apply gpt-image-playground-db --remote
```

部署队列消费者 Worker，并写入上游密钥。单 key 用 `OPENAI_API_KEY`；多 key 轮询用
`OPENAI_API_KEYS`，内容可用英文逗号或换行分隔：

```powershell
npx wrangler secret put OPENAI_API_KEY --config wrangler.image-worker.toml
# 或者：
npx wrangler secret put OPENAI_API_KEYS --config wrangler.image-worker.toml
npx wrangler secret put OPENAI_BASE_URL --config wrangler.image-worker.toml
npx wrangler deploy --config wrangler.image-worker.toml
```

最后部署 Pages：

```powershell
npx wrangler login
npx wrangler pages project create gpt-image-playground --production-branch main
npx wrangler pages secret put APP_ACCESS_TOKEN --project-name gpt-image-playground
npx wrangler pages secret put OPENAI_API_KEYS --project-name gpt-image-playground
npx wrangler pages deploy dist --project-name gpt-image-playground --branch main
```

如果项目名已被占用，使用：

```powershell
npx wrangler pages project create gpt-image-playground-20260425 --production-branch main
npx wrangler pages secret put OPENAI_API_KEY --project-name gpt-image-playground-20260425
npx wrangler pages secret put APP_ACCESS_TOKEN --project-name gpt-image-playground-20260425
npx wrangler pages deploy dist --project-name gpt-image-playground-20260425 --branch main
```

## 可选环境变量

- `OPENAI_API_KEY`：单 key 模式，服务端调用 OpenAI 的 API Key。
- `OPENAI_API_KEYS`：多 key 轮询模式，英文逗号 / 分号 / 换行分隔。配置后优先于 `OPENAI_API_KEY`。
- `APP_ACCESS_TOKEN`：必填，网页设置页中填写的访问口令。
- `OPENAI_BASE_URL`：可选，上游 API 根地址；默认 `https://api.openai.com`。

多 key 轮询规则：每一次真实上游图片请求都会从 D1 中原子领取下一个 key；2 个 key 就 1/2
交替，3 个 key 就 1/2/3 轮换，4 个 key 就 1/2/3/4 轮换。批量并发生成时，每张图的请求也会领取不同的下一个 key。

`OPENAI_BASE_URL` 通常不要带 `/v1`，但 Function 会兼容末尾包含 `/v1` 的配置。

## 验证

1. 打开 Cloudflare Pages 提供的 `*.pages.dev` 地址。
2. 设置页中保持 API URL 为 `/api/openai`。
3. 在“访问口令”中填写 `APP_ACCESS_TOKEN`。
4. 使用单张、低成本参数先生成测试图。

可用只读 dry-run 检查清理候选，不会删除数据：

```powershell
Invoke-WebRequest -Uri "https://你的域名/api/openai/cleanup" -Headers @{ "X-App-Token" = "你的访问口令" }
```
