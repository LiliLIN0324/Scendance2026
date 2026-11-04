# 幕景 Scendance

面向活动的真实场景 3D 空间设计工作台：从已扫描或生成的真实场地出发，在 2D/3D 里摆物料、改结构，再把同一份方案分享给客户、导出给执行团队。

## 现在能做什么

路径缩写：下文 `lib/`、`hooks/`、`panels/` 均相对 `frontend/components/room-organizer/`，另注明的除外。

**编辑**
- 2D 平面与 3D 场景双视图，同一份布局来回切，状态不丢 — `panels/scendance-workspace.tsx`
- 拖动、旋转、缩放、复制、框选、对齐、锁定；撤销/重做按编辑动作成组记录 — `lib/alignment.ts`、`hooks/use-history.ts`
- 10 套场景模板（bar / cafe / conference / gym / lawn / market / museum / office / popup / studio）与环境切换 — `panels/space-panel.tsx`
- 真实场地：空间面板列出扫描库中已重建的场地，选中即应用并把尺寸同步到画布 — `panels/space-panel.tsx`、`lib/venue-scans.ts`
- Lux3D 文本生成 3D：GLB 归一化后自动落到画布；本地走 3199 代理，线上走云端任务队列 — `lib/material-generate.ts`、`lib/lux3d-import.ts`

**Agent**
- 总控 / Bingo / 空间 / 物料四个 Agent 面板，自然语言下指令
- 提案先预览、人工确认后才写画布；确认、驳回、作废都记入复核台账 — `lib/agent-proposal.ts`、`lib/review-ledger.ts`

**分享与交付**
- 只读分享：`/view#s1=` URL 内嵌快照，无需后端；云项目方案走分享 token（需后端已部署） — `frontend/lib/share-snapshot.ts`、`frontend/app/view/page.tsx`
- 交付导出：机位册图册（4 机位 + 离线 HTML）、物料清单 CSV、DXF 平面、按比例打印/PDF — `lib/plan-export/`、`lib/deliverable-inventory.ts`

## 跑起来

Node.js ≥ 24.15（或 ≥ 26）。

```bash
npm ci
npm --prefix frontend ci
npm --prefix frontend run dev
```

- 工作台：<http://localhost:3000>
- 高德 / Lux3D 本机代理：`127.0.0.1:3199`，随 `dev` 自动拉起，单例复用 — `scripts/dev-with-amap-proxy.mjs`
- 官网 / 新手指引：`/introduction`、`/guide`（构建时由 `scripts/package-pages.mjs` 复制进 `public/`）

环境变量分两处：根 `.env.local` 供脚本与 Edge Functions，`frontend/.env.local` 只放公开配置。键名见根 `.env.example` 与 `frontend/.env.example`：

| 组 | 键名 |
| --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（旧名 `NEXT_PUBLIC_SUPABASE_ANON_KEY`）、`SUPABASE_SERVICE_ROLE_KEY` |
| Lux3D | `LUX3D_API_KEY`、`LUX3D_BASE_URL`、`LUX3D_TERMS_URL`、`LUX3D_TERMS_REVIEWED_AT`、`NEXT_PUBLIC_LUX3D_DIRECT_URL`（可选直连中转） |
| AMap | `NEXT_PUBLIC_AMAP_KEY`、`NEXT_PUBLIC_AMAP_SECURITY_CODE`、`NEXT_PUBLIC_AMAP_STATIC_KEY` |
| 对话模型 | `SILICONFLOW_API_KEY`、`AGENT_CHAT_BASE_URL`、`AGENT_CHAT_KEY`、`AGENT_CHAT_MODEL`、`TOKENDANCE_API_KEY` |

检查与构建：

```bash
npm --prefix frontend run typecheck
npm test                            # 根目录：后端 tests/
npm --prefix frontend run test      # 前端 Vitest
npm --prefix frontend run build     # 静态导出到 frontend/out
```

## 结构

```
frontend/                  Next.js 工作台（静态导出）
  app/view/                只读分享查看器
  components/room-organizer/  编辑器：2D/3D 画布、面板、Agent、导出
  lib/share-snapshot.ts    分享快照编解码
client/scene-client.ts     前后端契约客户端
supabase/functions/        scene-api / generation-worker / reconstruction-worker
supabase/migrations/       25 个数据库迁移
assets/library/            529 个 GLB 物料
scene/templates/           10 套场景模板
scripts/                   打包、dev 代理、配置校验
docs/                      文档，入口见 docs/README.md
introduction.html          官网（构建时复制进 public/）
```

## 文档

唯一入口：[docs/README.md](docs/README.md)。

## 已知边界

- **照片/视频不是点一下就出可编辑几何。** 必须现场按采集导引满足数量、层数、重叠与尺度基准；未达标的素材实测无法重建，现有西湖 24 张素材为 0/32 坐标、覆盖 102.6°，判定不可用 — `docs/01-素材与3D重建.md`
- **3DGS 只提供观感，不提供精确几何。** 不能当量尺或碰撞体用，摆位精度由 GLB / 矢量壳承担 — `docs/01-素材与3D重建.md`
- **云端资产链路需要迁移与函数部署。** 仓库内有 25 个迁移和 3 个 Edge Function 源码，各环境是否已部署需自行确认；未上云的本地资产会阻止云端保存 — `lib/backend-adapter.ts`（`LOCAL_ASSET_NOT_UPLOADED`）
- **本机扫描/生成物默认只登记在当前浏览器。** 跨设备打开依赖云端资产链路 — `lib/aholo-assets.ts`
- **移动端是紧凑版。** ≤ 768px 走窄屏 HUD 与抽屉，部分桌面面板能力受限 — `frontend/app/globals.css`
- **交付导出不支持完整场景预设与建筑入口扩展**，这两类方案会明确拒绝导出而不是降级 — `lib/scene-delivery.ts`
