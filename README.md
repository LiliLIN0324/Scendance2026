# Scendance · 幕景

面向活动策划团队的三维场景布置与协作网站。主工作台采用 Next.js 静态导出和 Three.js，账号、项目、模型资产与 AI 接口由 Supabase 提供。

- 在线工作台：<https://scendance.charlestech.org/>
- 本地体验入口：<https://scendance.charlestech.org/?local=1>
- 产品介绍：<https://scendance.charlestech.org/introduction>
- 源码仓库：<https://github.com/LiliLIN0324/scendance>

官网整页预览（`preview.jpg`）：

![幕景官网整页预览](preview.jpg)

## 本份代码对应什么版本

这是 **2026-10-03 核验的线上版本快照**，专用分支为 `codex/website-latest`，本地交付目录为 `WEBSITE-LATEST/`。根目录即仓库根目录，不需要再进入一层 `scendance/`。

线上前端与后端独立发布，因此不存在一个同时代表全部线上服务的原始提交。本分支以实际前端部署提交为基线，补入已经上线的后端变更与原始迁移，并完善交接说明；不是将仓库默认分支直接视为线上版本。

| 发布面 | 核验基线 |
|---|---|
| Cloudflare Pages 项目 | `scendance-scene-planner` |
| 前端源提交 | `b554910af8a818c08fd440c7787f8eadebc315e8` |
| Pages 生产部署 | `8153b386-93b5-45b8-9904-b6caf94472df` |
| Supabase 项目 | `hrsrrduwbqxnqddkexoy` |
| `scene-api` | ACTIVE v15 |
| `generation-worker` | ACTIVE v6 |
| `reconstruction-worker` | ACTIVE v2 |
| 数据库迁移 | 16 份，最新为 `20261003180000_unlimited_ai_usage` |

前端源文件、模型与模板保持上述生产提交内容。后端同步已上线的 `f77aa2a`（取消应用每日及累计 AI 额度）和 `548c48d`（Agent 行动优先）。另从线上迁移历史恢复 `20261003133000` 与 `20261003140000` 两份 SQL，避免新环境漏掉工作室项目可见性与删除逻辑。

详细版本、哈希和本次检查见 [线上快照记录](docs/WEBSITE_LATEST.md) 与 [机器可读清单](docs/evidence/website-latest.json)。本次整理不重新部署网站、不修改云数据库，也不合并到 `main`。

## 当前功能与边界

- **三维编辑**：添加、选择、移动、旋转、调整尺寸、复制、删除、锁定、撤销与重做；场地与布局保存在本地草稿或云项目中。
- **模型资源库**：当前发布记录为 529 项归档资源、528 项可摆放资源；保留中文名称、尺寸和来源信息。
- **Binggo**：右下角小狗 Agent，包含场景策划、3D 生成和场景模板入口。策划调用 DeepSeek；三维生成调用腾讯 HY-3D。生成任务的真实结果仍需在任务状态与资产归档中确认。
- **场景策划**：读取场景与资源索引，生成添加、替换、移动等候选操作；经过后端校验后按界面选项直接应用或预览。用户要求直接布置时优先使用可用资源并说明默认假设。缺少新造型时可转到 HY3 填写生成描述。
- **Agent 边界**：当前仍为一次 JSON 生成加最多一次修复，并未接入 DeepSeek Harness。对话内容受现有上下文长度限制，不代表无限或跨项目长期记忆。
- **场景模板**：酒吧、咖啡馆、会议、草坪、集市、博物馆、办公室、工作室、体育馆、快闪，共 10 套。模板沿用本地保存与编辑能力；现有模板场景不支持云保存或 AI 编辑，不要将模板加载成功等同于这些能力已打通。
- **账号与协作**：邮箱登录、注册及验证码、密码找回、工作室与项目管理、编辑权租约、版本校验、私有资产授权与客户只读分享接口。
- **AI 使用额度**：应用内每日与累计额度限制已取消。供应商计费、请求状态、并发保护和运行时限制仍存在；“不限额度”不表示供应商免费。
- **图纸与照片**：仓库包含重建预览及相关接口；具体支持和验证范围见 [图纸说明](docs/floorplan-v2.md)。本次快照未重新执行付费识别或生成验收。

## 目录

```text
frontend/              Next.js 工作台、Binggo、账号与业务界面
client/                场景 API 客户端与共享契约
supabase/functions/    Edge Functions 与校验、供应商适配逻辑
supabase/migrations/   16 份数据库迁移
supabase/ops/          运维配置与脚本
assets/                模型、缩略图、资源清单
scene/templates/       完整场景模板及其资源
scripts/               打包、本地联调与检查脚本
tests/                 后端及数据库测试
vendor/                展示页依赖与许可
docs/                  接口、历史发布记录和本次快照证据
frontend/out/          静态构建产物，Git 忽略
production-snapshot/   本地保存的已下载的线上函数源码及版本记录，Git 忽略
```

根目录的 `index.html` 是早期独立展示原型。生产工作台来自 `frontend/`；不能只发布根目录 HTML 来替代在线网站。

## 本地开发

需要 Node.js 24.15+（Node 24 系列）或符合 `frontend/package.json` 的更新版本，以及 npm。根目录与前端各有独立锁文件，两处都需要安装。

```sh
npm ci
npm --prefix frontend ci
npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3157
```

打开 <http://127.0.0.1:3157/?local=1> 使用本地体验。端口 3157 仅为隔离开发示例；如已占用，换用其他空闲端口。首次安装依赖需要网络。

### 连接云端功能

```sh
cp frontend/.env.example frontend/.env.local
```

在本机填写公开客户端配置：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://hrsrrduwbqxnqddkexoy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<该项目的公开 anon 或 publishable key>
NEXT_PUBLIC_GENERATION_ENABLED=false
```

公开配置在构建时写入前端，修改后需要重启开发服务或重新构建。生成开关按要连接的环境配置；示例保持关闭，不会自行提交生成任务。自定义本地端口只有被目标后端 CORS 和 Auth 跳转设置允许后，才能使用对应云端流程。

服务端配置模板为 [.env.example](.env.example) 与 [Edge 环境模板](supabase/functions/.env.example)。DeepSeek、HY3、service-role 和 worker secret 只能留在服务端。源码克隆不包含这些密钥、登录会话、云数据库业务数据或用户上传的私有模型；这些仍保留在各自云服务中。

完整本地 API/数据库联调见 [INTEGRATION.md](docs/INTEGRATION.md)。为各工作树使用独立端口和数据目录，避免连接到其他任务的测试环境。

## 构建与静态预览

```sh
npm --prefix frontend run build
npx wrangler pages dev frontend/out --ip 127.0.0.1 --port 3158
```

打开 <http://127.0.0.1:3158/?local=1>。`pages dev` 只做本地预览，不发布。`build` 自动将介绍页、资源库和场景模板打包到 `frontend/public/`，最终输出 `frontend/out/`。

本次本地交付额外保留经过线上抽查核验的原发布构建到 `frontend/out/`，以及已下载的函数源码与版本记录到 `production-snapshot/edge/`。它们不提交到 Git；以后重新 `git clone` 时需要重新构建。运行 `build` 会替换本地 `out/`，需要保留原发布产物时先另行备份。

## 检查

```sh
# 后端类型与数据库/接口测试；测试使用隔离的 PGlite
npm run check

# 前端类型、交互测试与生产构建
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build

# Edge 类型检查（需要 Deno）
npm run check:edge
```

部分本地集成测试会监听随机回环端口，需要运行环境允许。测试通过不等于完成真实供应商或生产数据验收；本次执行范围见 [快照检查记录](docs/WEBSITE_LATEST.md)。

## 发布与维护

前端、Edge Functions、数据库迁移是三个独立发布面。修改前先查询实际生产版本，再决定发布哪些部分。`package.json` 中仍保留 `0.6.0`，不能据此判断目前部署内容。

- 前端部署目录固定为 `frontend/out/`，项目为 `scendance-scene-planner`。
- Edge Functions 使用项目 `hrsrrduwbqxnqddkexoy`；仅发布本次确实变更且通过检查的函数。
- 此快照中的 16 份迁移已经在线上存在，不要作为新迁移再次执行；新环境按版本顺序初始化。
- 三个函数发布时点不同，其部署包包含的共享依赖版本可能不同；本次交付保留各函数已下载的源码与平台部署标识，不能把整个当前共享源码重新发布视为无变化备份。
- 历史文档中的旧版本、额度、未部署声明以各自记录日期为准；本次快照基线以本 README 及对应证据文件为准。

## 进一步阅读与许可

- [API 契约](docs/API.md)、[业务契约](docs/contracts/SUPABASE_BUSINESS.md)
- [Binggo 场景资源 Agent](docs/BINGGO_SCENE_AGENT.md)、[材质和模型升级](docs/BINGGO_ASSET_UPGRADE.md)
- [场景模板发布记录](docs/SCENE_TEMPLATES_RELEASE.md)、[当前 AI 额度说明](docs/AI_USAGE_LIMITS.md)
- [部署与恢复](docs/DEPLOYMENT.md)、[账号邮件验证](docs/AUTH_EMAIL_OTP.md)
- [素材来源](ASSET-SOURCES.md)、[前端上游许可](frontend/UPSTREAM-LICENSE)、[产品规划](PLAN.md)

保留原有上游许可、模型来源和署名。各素材授权以其来源记录为准。
