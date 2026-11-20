# Supabase 出网清单（只读审计，2026-11-20）

**结论：** 用户上传与 AI 产物的模型/封面/预览图全在私有桶 `scene-assets`，由 Edge Function 现场 `createSignedUrl` 签发（默认 300s，预览 3600s），前端拿地址直连 Supabase。每次签发换 token，浏览器/边缘缓存都不命中，同一模型反复出网。内置道具库与 R2 人物/扫描不在此列。

| 位置（文件:行） | URL 形态 | 缓存头 | 每会话重签 | 类别 |
|---|---|---|---|---|
| supabase/functions/_shared/backend.ts:67 签名单点 | 签名 `?token=` | 代码未设，未确认 | 每次调用 | 三类共用 |
| supabase/functions/_shared/api.ts:209 `/share/read` | 签名 300s | 响应 no-store；对象侧未确认 | 是，每次打开分享页 | 用户上传+AI |
| supabase/functions/_shared/api.ts:830 生成产物 / :79 资产预览 | 签名 300s / 3600s | 未确认 | 是 | AI 产物、用户上传 |
| supabase/functions/_shared/cloud-storage.ts:128 发布依赖 / :265 资产 URL / :375 案例封面 | 签名 300s | 未确认 | 是 | 用户上传 |
| frontend/components/room-organizer/panels/cloud-panel.tsx:571 打开云项目 | 批量重签 | 无 | 是，打开项目全量重签 | 用户上传+AI |
| frontend/components/room-organizer/three/glb-assets.ts:207 下载 GLB | 直接用签名 URL | 无 cache 指令 | URL 变即重下 | 用户上传+AI |
| frontend/.../panels/cloud-case-catalog.tsx:115、components/business/assets-panel.tsx:264、app/view/page.tsx:112 | 签名 URL 进 img / 3D 预览 | 仅 lazy | 是 | 用户上传+AI |
| frontend/.../panels/online-model-library.tsx:474 内置道具库 | 同源 `/showcase/…glb` | 仅缩略图 immutable（public/_headers:7） | 否，不走 Supabase | 内置道具库 |
| frontend/components/room-organizer/lib/cloud-assets.ts:8 人物/扫描副本 | 公开 R2 `pub-….r2.dev` | R2 侧未确认 | 否 | AI 产物（已迁） |

**迁 R2/CDN 影响面与顺序**

1. 顺序：先切只读出口（全部签名调用点），再切上传/归档写路径，最后关 Supabase 出网监控。
2. 必须改后端：`backend.ts:67` 签名、`backend.ts:77` 上传签名、`worker.ts:133` 归档，以及上表 `api.ts` / `cloud-storage.ts` 全部签名点。
3. 只改前端：`frontend/lib/public-asset-recovery.ts:29` 硬编码 sign 前缀、`frontend/lib/share-snapshot.ts:142` 分享策略；R2 CORS 白名单需同步（`frontend/next.config.mjs:117`）。
4. 前端无需改：`glb-assets.ts:207` 加载逻辑对域名无假设，后端换域即生效。

未验证项：Supabase 对象默认 `cache-control`、R2 现有缓存头、实际出网构成（仅按代码路径推断，未取监控数据）。
