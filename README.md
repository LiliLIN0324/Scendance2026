# Scendance · 幕景

面向活动策划团队的三维场景布置与协作网站。主工作台采用 Next.js 静态导出和 Three.js，账号、项目、模型资产与 AI 接口由 Supabase 提供。

- 在线工作台：<https://scendance-scene-planner-ewz.pages.dev/>
- 本地体验入口：<https://scendance-scene-planner-ewz.pages.dev/?local=1>
- 产品介绍：<https://scendance-scene-planner-ewz.pages.dev/introduction>
- 源码仓库：<https://github.com/LiliLIN0324/Scendance2026>

官网整页预览（`preview.jpg`）：

![幕景官网整页预览](preview.jpg)

## 本份代码对应什么版本

本仓库已从最初的专用 Supabase 项目迁移到自有部署：前端由 Cloudflare Pages 通过 GitHub 集成构建，后端由自己的 Supabase 项目承载。旧项目的 URL、密钥与数据不再被本仓库引用，相关历史记录见 [docs/archive/](docs/archive/)。

| 发布面 | 当前配置 |
|---|---|
| GitHub 仓库 | `LiliLIN0324/Scendance2026`，生产分支 `main` |
| Cloudflare Pages | 项目 `scendance-scene-planner`（账户 `f0273e54d22c215389dd6065a802ddae`），地址 `https://scendance-scene-planner-ewz.pages.dev` |
| 构建 | Root directory `/`；`npm ci && npm --prefix frontend ci && npm --prefix frontend run build`；输出 `frontend/out` |
| Supabase 项目 | `wkhfvnzgopjdzxlmycks` |
| Edge Functions | `scene-api`、`generation-worker`、`reconstruction-worker` |
| 数据库迁移 | 19 份，最新为 `20261003210000_preset_scene_access` |

Cloudflare 只构建和发布前端静态产物；数据库迁移与 Edge Functions 需要单独部署。部署步骤、Secrets 与验收检查见 [自有 Supabase 部署](docs/OWN_SUPABASE_TUTORIAL.md)，Pages 连接、构建设置与构建环境变量见 [Cloudflare 与 GitHub 自动部署](docs/CLOUDFLARE_GITHUB_DEPLOYMENT.md)。

本 README 只描述仓库内容与部署配置，不代表云端当前版本：迁移是否已推送、函数版本与生产验收状态以对应平台的实际查询结果为准。

## 当前功能与边界

- **三维编辑**：添加、选择、移动、旋转、调整尺寸、复制、删除、锁定、撤销与重做；场地与布局保存在本地草稿或云项目中。
- **模型资源库**：当前发布记录为 529 项归档资源、528 项可摆放资源；保留中文名称、尺寸和来源信息。
- **Binggo**：右下角小狗 Agent，包含场景策划、3D 生成和场景模板入口。策划调用 DeepSeek，并以工具循环检索受权资源、调用参数化建模工具（见 [DeepSeek 场景 Agent 契约](docs/contracts/DEEPSEEK_AGENT.md)）；腾讯 HY-3D 生成已停用（`HY3_RETIRED=true`，新请求返回 `410`），历史模型、材质与导出仍可使用。
- **场景策划**：读取场景与资源索引，生成添加、替换、移动等候选操作；经过后端校验后按界面选项直接应用或预览。用户要求直接布置时优先使用可用资源并说明默认假设。缺少新造型时可用参数化建模生成六类固定族资产（`table`、`chair`、`counter`、`platform`、`backdrop`、`cabinet`，见 [固定参数化资产](docs/contracts/PARAMETRIC_ASSETS.md)），或导入自己的 GLB。
- **Agent 边界**：Agent 走工具循环（`DEEPSEEK_AGENT_MODE=tools`），后台最多 6 次模型调用、总期限 90 秒，多个候选由用户在界面上选择后应用；旧的单次提案流程作为可回退模式保留。对话内容受现有上下文长度限制，不代表无限或跨项目长期记忆。
- **场景模板**：酒吧、咖啡馆、会议、草坪、集市、博物馆、办公室、工作室、体育馆、快闪，共 10 套。模板沿用本地保存与编辑能力；现有模板场景不支持云保存或 AI 编辑，不要将模板加载成功等同于这些能力已打通。
- **账号与协作**：邮箱登录、注册及验证码、密码找回、工作室与项目管理、编辑权租约、版本校验、私有资产授权与客户只读分享接口。
- **AI 使用额度**：应用内每日与累计额度限制已取消。供应商计费、请求状态、并发保护和运行时限制仍存在；“不限额度”不表示供应商免费。
- **图纸与照片**：仓库包含重建预览及相关接口；具体支持和验证范围见 [图纸说明](docs/floorplan-v2.md)。本轮未重新执行付费识别或生成验收。

## 目录

```text
frontend/              Next.js 工作台、Binggo、账号与业务界面
client/                场景 API 客户端与共享契约
supabase/functions/    Edge Functions 与校验、供应商适配逻辑
supabase/migrations/   19 份数据库迁移
supabase/ops/          运维配置与脚本
assets/                模型、缩略图、资源清单
scene/templates/       完整场景模板及其资源
scripts/               打包、本地联调与检查脚本
tests/                 后端及数据库测试
vendor/                展示页依赖与许可
tools/                 Blender 参数化建模、模型目录与图纸解析脚本
docs/                  接口、发布记录与验收证据
docs/archive/          已作废的历史过程记录，仅用于追溯
frontend/out/          静态构建产物，Git 忽略
.local-dev/            本地联调数据目录，Git 忽略
```

生产工作台来自 `frontend/`（Next.js 静态导出）。官网页面是根目录的 `introduction.html`，构建时由 [scripts/package-pages.mjs](scripts/package-pages.mjs) 连同 `assets/`、`vendor/`、`renderer-webgl.js`、`scene/templates/` 一起打包为 `/introduction` 与 `/showcase/*`。`renderer-webgl.js` 是官网三维演示模块，必须保留。旧的独立静态原型已在 1.0.0 删除（`index.html`、`app.js`、`style.css`、`models.html`、`model-preview.js`、`serve.py`、`preview-webgl-*.jpg`、`VALIDATION.md`、`docs/mockups/`），需要时从 Git 记录找回。

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
NEXT_PUBLIC_SUPABASE_URL=https://wkhfvnzgopjdzxlmycks.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<该项目的 publishable key，形如 sb_publishable_...>
NEXT_PUBLIC_GENERATION_ENABLED=false
```

代码同时接受旧变量名 `NEXT_PUBLIC_SUPABASE_ANON_KEY`；只有 `publishable` 时才写新名字，旧项目只有 anon JWT key 时写旧名字即可。

公开配置在构建时写入前端，修改后需要重启开发服务或重新构建。生成开关按要连接的环境配置；示例保持关闭，不会自行提交生成任务。自定义本地端口只有被目标后端 CORS 和 Auth 跳转设置允许后，才能使用对应云端流程。

服务端配置模板为 [.env.example](.env.example) 与 [Edge 环境模板](supabase/functions/.env.example)。DeepSeek、HY3、service-role 和 worker secret 只能留在服务端。源码克隆不包含这些密钥、登录会话、云数据库业务数据或用户上传的私有模型；这些仍保留在各自云服务中。

完整本地 API/数据库联调见 [INTEGRATION.md](docs/INTEGRATION.md)。为各工作树使用独立端口和数据目录，避免连接到其他任务的测试环境。

## 构建与静态预览

```sh
npm --prefix frontend run build
npx wrangler pages dev frontend/out --ip 127.0.0.1 --port 3158
```

打开 <http://127.0.0.1:3158/?local=1>。`pages dev` 只做本地预览，不发布。`build` 自动将介绍页、资源库和场景模板打包到 `frontend/public/`，最终输出 `frontend/out/`。

`npm --prefix frontend run build` 会替换本地 `frontend/out/`。该目录不提交到 Git，重新 `git clone` 后需要重新构建；Cloudflare Pages 每次推送都会重新构建，不需要提交产物。

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

部分本地集成测试会监听随机回环端口，需要运行环境允许。测试通过不等于完成真实供应商或生产数据验收；云端验收步骤见 [自有 Supabase 部署](docs/OWN_SUPABASE_TUTORIAL.md) 第 9 节。

## 发布与维护

前端、Edge Functions、数据库迁移是三个独立发布面。修改前先查询实际生产版本，再决定发布哪些部分。根目录与 `frontend/` 的 `package.json` 都写着 `1.0.0`，是版本号，不能据此判断目前部署内容。

- 前端：推送到 `main` 由 Cloudflare Pages 自动构建并发布，产物目录固定为 `frontend/out/`。
- Edge Functions：部署到项目 `wkhfvnzgopjdzxlmycks`；仅发布确实变更且通过检查的函数。
- 数据库迁移：本仓库有 19 份，新环境按版本顺序初始化；是否已推送到目标项目用 `npx supabase migration list --project-ref wkhfvnzgopjdzxlmycks` 查询，不要凭本 README 判断云端状态。
- 发布顺序、命令速查与验收见 [自有 Supabase 部署](docs/OWN_SUPABASE_TUTORIAL.md)。
- 历史文档中的旧版本、额度、未部署声明以各自记录日期为准；已作废的过程记录统一放在 [docs/archive/](docs/archive/)。

## 进一步阅读与许可

- [API 契约](docs/API.md)、[业务契约](docs/contracts/SUPABASE_BUSINESS.md)
- [自有 Supabase 部署](docs/OWN_SUPABASE_TUTORIAL.md)、[Cloudflare 与 GitHub 自动部署](docs/CLOUDFLARE_GITHUB_DEPLOYMENT.md)
- [DeepSeek 场景 Agent 契约](docs/contracts/DEEPSEEK_AGENT.md)、[Binggo 场景资源 Agent](docs/BINGGO_SCENE_AGENT.md)
- [模型库整合记录](docs/archive/MODEL_LIBRARY_MERGE.md)、[场景模板发布记录](docs/archive/SCENE_TEMPLATES_RELEASE.md)
- [部署与恢复](docs/DEPLOYMENT.md)、[当前 AI 额度说明](docs/AI_USAGE_LIMITS.md)、[账号邮件验证](docs/AUTH_EMAIL_OTP.md)
- [Blender 参数化建模](tools/blender/README.md)、[场地图纸解析](tools/floorplan/README.md)
- [素材来源](ASSET-SOURCES.md)、[前端上游许可](frontend/UPSTREAM-LICENSE)、[产品规划](PLAN.md)

保留原有上游许可、模型来源和署名。各素材授权以其来源记录为准。
