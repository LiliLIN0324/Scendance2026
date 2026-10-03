# Scendance · 幕景

当前开发分支版本：**0.6.0 · 图纸／照片重建预览**。本分支未合并部署；[运行说明](docs/floorplan-v2.md) 与 [已验证范围](docs/floorplan-verification.md) 单独记录，真实识别及云环境仍待验收。

**面向小型活动策划执行工作室的三维场景协作 Web 应用。**
用 AI 和内置物料快速形成活动方案，让团队共同完善布置，并向客户交付可自由查看的三维场景。

在线体验 <https://scendance.charlestech.org/> · 产品官网 <https://scendance.charlestech.org/introduction> · 产品规划见 [PLAN.md](PLAN.md)

## 我们想解决的问题

一场活动从「客户脑中的效果」到「执行人员理解的布置」，中间隔着一层信息差：客户说不清、设计师画不准、执行方理解不一样。

幕景把这三方的共同语言换成同一份**三维场景**：

- 策划方在电脑浏览器里搭场景，改的是同一份数据，不来回传文件；
- 客户用手机打开只读链接，就能旋转、缩放、切换预设视角；
- 物料表跟着场景自动汇总，不需要有人再数一遍。

核心价值假设是**减少信息差**。成本与成交率是否真的改善，要通过真实工作室的任务去验证，这里不预先宣称。

## 核心流程

创建项目与场地 → 描述活动需求 → AI 生成可编辑初稿 → 人工调整 → 补充生成物件 → 团队交接编辑 → 核对物料表 → 发布客户只读版本

## 主要能力

| 能力 | 说明 |
|---|---|
| 场地设置 | 输入平面图与长、宽、高，设置主要出入口，米制统一 |
| AI 初稿 | 理解主题、人数、场地分区与色系，组合内置物料；生成结果均可继续编辑 |
| AI 修改 | 增删、移动、旋转、换色、替换物件；先出提案，人工确认后应用 |
| 三维编辑 | 添加、选择、拖动、旋转、改尺寸、换色、复制、删除、锁定、撤销/重做 |
| 内置物料 | 椅子、桌子、签到台、背景板、展架、隔断、地毯、装饰道具 |
| 三维物件生成 | 提交描述 → 异步任务 → 预览结果 → 设定整体尺寸 → 加入场景 |
| 轮流编辑 | 同一项目同一时刻一人持有编辑权，默认租约 90 秒、每 30 秒续期 |
| 自动物料表 | 按物料与规格汇总数量、尺寸和备注，与当前场景快照一致 |
| 客户查看 | 无需登录的只读链接，手机可旋转缩放；项目负责人可撤销 |

## 首版边界（不夸大）

产品边界写在 [PLAN.md](PLAN.md)，这里只列容易被误解的几条：

- 首批客户是**小型活动策划执行工作室**，主要案例是小型黑客松 / 工作坊 / 竞赛。
- 场地和物料**基本尺寸准确**，首版只支持矩形单层场地；吊挂、复杂叠放、多层场地不在演示范围。
- 场地边界和重叠提示**不是**消防、承重或完整施工校验。
- 生成物件在物料表中标记「概念道具，实物待确认」，不编造供应商、库存或价格。
- 体育馆原型采用**示意比例**，照片仅作形态参考，未做测绘或自动三维重建；时间轴与动线用于讲解流程，不是人流仿真。

## 技术栈

| 层 | 选择 |
|---|---|
| 前端 | Next.js 静态导出 + React + TypeScript |
| 三维 | 原生 Three.js + GLTFLoader |
| 状态与校验 | Zustand + Zod |
| 账号与数据库 | Supabase Auth + Postgres |
| 文件存储 | Supabase 私有 Storage |
| 后端 | Supabase Edge Functions |
| 文本 AI | DeepSeek `deepseek-flash` |
| 三维生成 | 腾讯混元 HY-3D-3.0（优先 LowPoly） |
| 静态托管 | Cloudflare Pages |

## 本地开发

使用 Node.js 24.15+，先在根目录执行 `npm ci`，再执行 `cd frontend && npm ci && npm run dev`，打开 `http://localhost:3000`。生产构建输出为 `frontend/out/`，构建脚本自动打包工作台、登录页、`/introduction` 介绍页与展示资源。

当前状态与文档索引见 [项目交接](docs/PROJECT_STATUS.md)，首次上线记录见 [上线记录](docs/FIRST_LAUNCH.md)，历史版本见 [更新记录](CHANGELOG.md)。

## 开发入口

| 负责方向 | 入口 |
|---|---|
| 产品规划与 PRD | [PLAN.md](PLAN.md) |
| A：前端工作台 | [启动与接口配置](frontend/README.md)、[前端修改边界](frontend/AGENTS.md) |
| B：Supabase 后端 | [后端说明](BACKEND.md)、[部署说明](docs/DEPLOYMENT.md) |
| A01：交接与验证 | [编辑器首版报告](docs/team/reports/A/A01.md) |
| 前后端本地联调 | [运行步骤、修复及测试结果](docs/INTEGRATION.md) |
| 官网静态首页 | 根目录 `introduction.html`；运行与打包见下文 |

## 官网静态首页（根目录 introduction.html）

`introduction.html` 是官网本体：单文件、样式与动效内联，页面里内嵌了十场景三维库。打包后由 `/introduction` 提供。原先的体育馆展示原型 `index.html` 已删除，旧版留档见 `docs/mockups/legacy-venue-index.html`。

### 运行

在本目录执行 `python3 -m http.server 8766 --bind 127.0.0.1`，打开 http://127.0.0.1:8766/introduction.html 。

页面用 import map 解析裸模块名 `three`，并按相对路径请求 `vendor/three` 与 `scene/templates/*.glb`；必须通过 HTTP 服务打开，不支持双击 `introduction.html`。浏览器需支持 WebGL 2 与 import maps。

### 打包

在本目录执行 `node scripts/package-pages.mjs`，把 `introduction.html`、`showcase/`（`assets`、`vendor`、`renderer-webgl.js`）以及场景库页面与十套 GLB 镜像到 `frontend/public/`，随 `frontend/` 的 Next 构建一起发布。

### 素材

会议桌、活动座椅、笔记本电脑、宽叶盆栽和舞台音箱五款源模型来自 3DAssets.dev 官方 API，按用途缓存到 `assets/models/`；素材清单在 `assets/catalogue.json`，来源、授权与文件哈希记录在 `ASSET-SOURCES.md`。Three.js 官方 npm 包版本固定为 0.186.1，仅保存运行需要的文件到 `vendor/three/`，MIT 授权随文件保留，`renderer-webgl.js` 是页面里的三维渲染器。十场景库的模型来源与授权见各模板目录下的 `ASSET-SOURCES.md`。`models.html` 提供五款模型的独立旋转预览与下载。

### 模型边界

Three.js 对真实三维网格进行渲染，道具使用 GLTFLoader 加载 GLB；场馆、看台、展墙、人物与动线由程序搭建。照片仅作为形态参考，未进行测绘或自动三维重建。场馆采用示意比例，不代表实测尺寸、核定容量或人流仿真；入口、电力、网络、夜间开放与休息安排均需现场确认。

## 目录入口

### 产品

- [`frontend/`](frontend/README.md)：工作台与官网（Next.js），生产构建输出 `frontend/out/`
- [`PLAN.md`](PLAN.md)：产品规划与 PRD
- [`docs/`](docs/PROJECT_STATUS.md)：状态、部署、接口与验证文档
- `supabase/`：数据库迁移、Edge Functions 与运维脚本

### 展示原型

- `introduction.html`：官网静态首页（内嵌十场景三维库）
- `models.html`：五款模型的独立旋转预览与下载
- `assets/`：模型、缩略图与素材清单

### 记录

- `ASSET-SOURCES.md`：素材来源及授权记录
- `VALIDATION.md`：已完成的检查
- `CHANGELOG.md`：更新记录

## 后端开发

本仓库包含 Supabase 后端，详见 [后端开发入口](BACKEND.md)。支持权限、项目保存、编辑租约、AI 提案、三维生成任务、资产归档和客户分享。新前端已接入登录/注册、项目、租约、场景保存、私有资产授权及 AI 提案预览与确认应用。登录回调、刷新恢复、工作室隔离与真实 DeepSeek 请求已有上线验证；公开注册邮件仍需独立 SMTP。三维生成与客户发布不能视为已完成前端端到端验收。接口、部署步骤和验证边界见后端文档。
