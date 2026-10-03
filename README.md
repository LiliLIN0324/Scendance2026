# 幕景 Scendance

> 为相聚，留一方空间。

面向小型活动策划执行工作室的**三维场景布置与协作**网站：把一张场地照片变成能一起改的三维空间，让场地方、搭建方和客户看同一份东西。

- 在线工作台：<https://scendance.charlestech.org/>
- 产品介绍（官网）：<https://scendance.charlestech.org/introduction>
- 本地体验入口：<https://scendance.charlestech.org/?local=1>
- 源码仓库：<https://github.com/LiliLIN0324/scendance>

官网整页预览（`preview.jpg`）：

![幕景官网整页预览](preview.jpg)

## 它解决什么问题

一场活动落地前，场地方、搭建方和客户要在方案上反复确认，但三方看到的往往不是同一个东西：一方看现场照片，一方看手绘草图，一方听口头描述。桌椅往哪摆、通道留没留、尺寸对不对，常常等到布置当天才发现。

幕景把这件事搬进浏览器：**照片进来，一个能转动、能继续改的三维场景出去**。客户不用装软件，打开链接就能看懂布置，改动落在图上，而不是落在聊天记录里。

产品里的流程就四步：先看现场再谈方案 → 核对结构再生成方案 → 一起改而不是来回传 → 带走能落地的方案（导出 Markdown 方案与布置说明）。

## 产品内容

### 官网 · `introduction.html`

单文件静态首页：首屏是十场景背景轮播加一张跟随场景的浮动方案卡，往下依次是**内嵌的十场景三维交互库**（可拖动旋转、切换分区视角、调时段与人数）、客户评价、流程、技术说明，最后是关于我们与联系方式。

### 工作台 · `frontend/`（登录后）

| 模块 | 能力 |
|---|---|
| 三维编辑 | 添加、选择、移动、旋转、调整尺寸、复制、删除、锁定、撤销与重做；场地与布局保存在本地草稿或云项目中 |
| 模型资源库 | 当前发布记录为 529 项归档资源、528 项可摆放资源，保留中文名称、尺寸和来源信息 |
| 场景模板 | 酒吧、咖啡馆、会议、草坪、集市、博物馆、办公室、工作室、体育馆、快闪，共 10 套 |
| Binggo Agent | 右下角小狗助手，包含场景策划、3D 生成和场景模板三个入口 |
| 场景策划 | 读取场景与资源索引，生成添加 / 替换 / 移动等候选操作，经后端校验后按界面选项直接应用或预览；缺少新造型时可转到 3D 生成填写描述 |
| 图纸与照片 | 结合图纸、照片和用户提供的实测尺寸建立空间候选，补充不可见结构（见[图纸说明](docs/floorplan-v2.md)） |
| 账号与协作 | 邮箱登录、注册及验证码、密码找回、工作室与项目管理、编辑权租约、版本校验、私有资产授权与客户只读分享接口 |

## 技术栈

| 层 | 用了什么 |
|---|---|
| 官网 | 单文件 HTML + 内联 CSS/JS，没有构建步骤；Three.js 通过 import map 引入 |
| 工作台 | Next.js 15（`output: export` 静态导出）+ React 18 + TypeScript 5 |
| 三维渲染 | Three.js 0.186：GLTFLoader 加载 GLB、OrbitControls 控制视角、RoomEnvironment 提供环境光 |
| UI | Tailwind CSS 3 + Radix UI + lucide-react + class-variance-authority |
| 状态与契约 | zustand 5 管状态；zod 4 定义前后端共享契约（放在 `client/`） |
| 后端 | Supabase：Postgres 数据库 + Auth 账号 + Storage 资产 + Deno Edge Functions |
| 服务端函数 | `scene-api` 业务读写与校验、`generation-worker` AI 生成任务、`reconstruction-worker` 图纸 / 照片重建 |
| AI 供应商 | DeepSeek 做场景策划、腾讯 HY-3D 做三维生成；密钥只留在服务端 |
| 模型处理 | `@gltf-transform/core` + `gltf-validator`，资源入库时校验与转换 |
| 测试与检查 | Vitest + Testing Library；PGlite 在本地跑一份隔离 Postgres 做数据库与接口测试；tsc、ESLint |
| 部署 | Cloudflare Pages 发布前端静态产物，Supabase 托管数据库与函数 |

一次改动的路径大致是：浏览器（工作台或官网）→ `scene-api` 鉴权与契约校验 → Postgres；需要 AI 或重建时交给对应的 worker 去调供应商，结果写回项目资产。

## 目录

```text
introduction.html      官网静态首页（单文件，样式与动效内联）
frontend/              Next.js 工作台、Binggo、账号与业务界面
client/                场景 API 客户端与前后端共享契约
supabase/functions/    Edge Functions 与校验、供应商适配逻辑
supabase/migrations/   16 份数据库迁移
supabase/ops/          运维配置与脚本
assets/                模型、缩略图、资源清单
scene/templates/       十套完整场景模板及其资源
scripts/               打包、本地联调与检查脚本
tests/                 后端及数据库测试
vendor/                官网依赖（Three.js）与许可
docs/                  接口、历史发布记录与快照证据
frontend/out/          静态构建产物，Git 忽略
production-snapshot/   本地保存的已下载线上函数源码及版本记录，Git 忽略
```

生产站点同时发布根目录的官网首页和 `frontend/` 的工作台：不能只用根目录 HTML 替代在线工作台，也不能只部署 `frontend/out/` 而漏掉介绍页。

## 本地运行

需要 Node.js 24.15+（Node 24 系列）或符合 `frontend/package.json` 的更新版本，以及 npm。根目录与前端各有独立锁文件，两处都要装。

```sh
npm ci
npm --prefix frontend ci
npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3157
```

打开 <http://127.0.0.1:3157/?local=1> 使用本地体验。端口 3157 只是隔离开发的示例，被占用就换一个；首次安装依赖需要网络。

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

公开配置在构建时写进前端，改完要重启开发服务或重新构建。生成开关按要连接的环境配置，示例保持关闭，不会自行提交生成任务。自定义本地端口只有被目标后端 CORS 与 Auth 跳转允许后才能走云端流程。

服务端配置模板见 [.env.example](.env.example) 与 [Edge 环境模板](supabase/functions/.env.example)。DeepSeek、HY3、service-role 和 worker secret 只能留在服务端；源码克隆不包含这些密钥、登录会话、云数据库业务数据或用户上传的私有模型。完整本地 API/数据库联调见 [INTEGRATION.md](docs/INTEGRATION.md)。

### 单独预览官网

官网不依赖 Next 构建，起一个静态服务即可：

```sh
python3 -m http.server 8766 --bind 127.0.0.1
# 打开 http://127.0.0.1:8766/introduction.html
```

页面用 import map 解析裸模块名 `three`，并按相对路径请求 `vendor/three` 与 `scene/templates/*.glb`，所以必须通过 HTTP 服务打开，不支持双击文件；浏览器需支持 WebGL 2 与 import maps。

## 构建与静态预览

```sh
npm --prefix frontend run build
npx wrangler pages dev frontend/out --ip 127.0.0.1 --port 3158
```

打开 <http://127.0.0.1:3158/?local=1>。`pages dev` 只做本地预览，不发布。

`build`（以及 `dev`）会先跑 `node scripts/package-pages.mjs`，把 `introduction.html`、`showcase/`（`assets`、`vendor`、`renderer-webgl.js`）、场景库页面与十套 GLB 镜像到 `frontend/public/`，最终输出 `frontend/out/`。

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

部分本地集成测试会监听随机回环端口，需要运行环境允许。测试通过不等于完成真实供应商或生产数据验收。

## 部署与发布面

前端、Edge Functions、数据库迁移是三个独立发布面，改之前先查实际生产版本，再决定发哪一部分。

- 前端部署目录固定为 `frontend/out/`，Cloudflare Pages 项目为 `scendance-scene-planner`。
- Edge Functions 属于 Supabase 项目 `hrsrrduwbqxnqddkexoy`；只发布本次确实变更且通过检查的函数。
- 仓库里的 16 份迁移已经在线上执行过，不要当作新迁移再跑一次；新环境按版本顺序初始化。
- 三个函数发布时点不同，各自部署包里的共享依赖版本可能不同，不能把「重新发布当前共享源码」当成无变化备份。

## 版本与线上快照

仓库代码与线上发布不是同一条时间线。当前核验基线（2026-10-03）：

| 发布面 | 核验基线 |
|---|---|
| Cloudflare Pages 项目 | `scendance-scene-planner` |
| 前端源提交 | `b554910af8a818c08fd440c7787f8eadebc315e8` |
| Supabase 项目 | `hrsrrduwbqxnqddkexoy` |
| `scene-api` / `generation-worker` / `reconstruction-worker` | ACTIVE v15 / v6 / v2 |
| 数据库迁移 | 16 份，最新为 `20261003180000_unlimited_ai_usage` |

详细版本、哈希与检查记录见[线上快照记录](docs/WEBSITE_LATEST.md)与[机器可读清单](docs/evidence/website-latest.json)。`package.json` 里的 `0.6.0` 是历史版本号，不能据此判断当前部署内容；官网改版之后的发布标签从 `v0.7.0`、`v0.7.1` 开始。

## 已知边界

以下几件事容易被误读，写在这里：

- **AI 生成**：生成任务的真实结果仍要在任务状态与资产归档中确认。Agent 目前是一次 JSON 生成加最多一次修复，并未接入 DeepSeek Harness；对话内容受上下文长度限制，不代表无限或跨项目长期记忆。
- **AI 使用额度**：应用内每日与累计额度限制已取消，但供应商计费、请求状态、并发保护和运行时限制仍在；「不限额度」不表示供应商免费。
- **场景模板**：模板沿用本地保存与编辑能力，现有模板场景不支持云保存或 AI 编辑；模板能加载不等于这些能力已经打通。
- **三维比例**：场馆采用示意比例，不代表实测尺寸、核定容量或人流仿真；照片只作形态参考，未做测绘或自动三维重建。入口、电力、网络、夜间开放与休息安排都要现场确认。

## 进一步阅读与许可

- [API 契约](docs/API.md)、[业务契约](docs/contracts/SUPABASE_BUSINESS.md)
- [Binggo 场景资源 Agent](docs/BINGGO_SCENE_AGENT.md)、[材质和模型升级](docs/BINGGO_ASSET_UPGRADE.md)
- [场景模板发布记录](docs/SCENE_TEMPLATES_RELEASE.md)、[当前 AI 额度说明](docs/AI_USAGE_LIMITS.md)
- [部署与恢复](docs/DEPLOYMENT.md)、[账号邮件验证](docs/AUTH_EMAIL_OTP.md)
- [素材来源](ASSET-SOURCES.md)、[前端上游许可](frontend/UPSTREAM-LICENSE)、[产品规划](PLAN.md)

会议桌、活动座椅、笔记本电脑、宽叶盆栽和舞台音箱五款源模型来自 3DAssets.dev 官方 API，按用途缓存到 `assets/models/`；素材清单在 `assets/catalogue.json`，来源、授权与文件哈希记录在 [ASSET-SOURCES.md](ASSET-SOURCES.md)。Three.js 官方 npm 包版本固定为 0.186.1，只保存运行需要的文件到 `vendor/three/`，MIT 授权随文件保留。十场景库的模型来源与授权见各模板目录下的 `ASSET-SOURCES.md`。工作台基于 MIT 许可的 threejs-sims-house-builder 改造，上游许可见 [frontend/UPSTREAM-LICENSE](frontend/UPSTREAM-LICENSE)。

保留原有上游许可、模型来源和署名。各素材授权以其来源记录为准。
