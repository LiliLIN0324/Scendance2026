# 幕景 Scendance · 产品架构设计

> 版本：v1.0（2026-11-22）
> 状态：架构基线说明。**描述当前仓库已实现的系统，不把规划写成现状。**
> 依据：仓库代码（`frontend/`、`supabase/functions/`、`supabase/migrations/`、`client/`）、[README](../README.md)、[BACKEND](../BACKEND.md)、[01 素材与3D重建](01-素材与3D重建.md)、[02 交付与Agent能力](02-交付与Agent能力.md)、[13 HTTP API](13-HTTP-API与前端接入.md)、[14 后端设计](14-后端设计.md)、[21 双端入口](21-双端入口与统一任务表.md)、[64 部署与发布手册](64-部署与发布手册.md)。
> 冲突处理：本文与代码冲突时以代码为准；与 01–04 的现状结论冲突时以 01–04 为准。本文只做结构说明，不新增产品结论。

## 变更记录

| 变更人 | 状态 | 变更理由 | 变更日期 |
| --- | --- | --- | --- |
| — | 初始化 | 参考 Riffle 架构设计模板，按幕景当前实现建立首版架构说明 | 2026-11-22 |

---

# 一、引言（Introduction）

## 1.1 项目背景（Background）

幕景面向活动工作室与独立策划师：客户给出场地、人数、风格与预算，策划师需要在**真实场地**上完成分区、流线、物料与交付，而不是从一张空白平面图开始想象。

产品链路是：

```text
真实场地 → 可编辑空间 → 可执行方案
```

具体拆成七个业务环节：

| # | 业务环节 | 谁在做 | 产出 |
| --- | --- | --- | --- |
| 1 | 选场地 | Agent（`place`） | 按人数、风格、能否 3D 预览给候选 |
| 2 | 地图圈选 | Agent（`scope`） | 锚点 + 边界，成为后续所有尺寸的坐标系 |
| 3 | 现场采集 | 手机端导引（独立仓） | 数量、层数、重叠、尺度基准达标的素材 |
| 4 | 场景重建 | Aholo Reality | 3DGS 场景 `.spz`，提供真实地面与天光底 |
| 5 | 空间布置 | 幕景画布 | 七分区、三流线的 2D/3D 同源方案 |
| 6 | 定制物料 | Lux3D / 腾讯混元 | GLB 归一化后进物料库，原位替换体块 |
| 7 | 交付 | 幕景导出 | 机位图册、物料清单 CSV、DXF 平面、只读分享链接 |

产品卖的是**活动场景方案与交付**，不是「我们会训世界模型 / 自研 3DGS」。重建是成本项与能力底座，不是对外主卖点。这条定位决定了架构取舍：**重建可以外包、可以换供应商；方案数据、尺度、确认记录与交付物必须留在自己手里。**

## 1.2 设计目标（Design Goals）

架构要守住的不是「功能多」，而是下面六条质量门槛：

| # | 目标 | 可观察的验收口径 | 当前证据 |
| --- | --- | --- | --- |
| G1 | 量得准 | 米制尺度唯一真源；3° 斜场贴地残差 0.0 mm；69 件布置 0/69 超差 | `docs/evidence/measure-2026-11-05/`；`AGENTS.md` §六 |
| G2 | 摆得下 | 2D/3D 同一份场景状态；边界、碰撞、锁定在提交前校验 | `_shared/domain.ts` 场景 Schema；`lib/plan-*`、`lib/collision.ts` |
| G3 | 人确认才落画布 | Agent 只出提案；确认后一次事务应用，可整体撤销 | `agent_runs` / `agent_proposals`；`lib/agent-proposal.ts` |
| G4 | 失败不伪装 | 供应商未知就保留未知；不伪造生成结果、进度或保存成功 | `submit_unknown` 状态；`docs/14` §生成任务 |
| G5 | 交付可复核 | 图册 / CSV / DXF / 只读链接来自同一版快照，带内容指纹 | `lib/delivery-package.ts`、`lib/delivery-version.ts` |
| G6 | 单机能演示、云端可协作 | 本地草稿可离线打开；云端项目有租约、版本与发布 | `lib/persistence.ts`、`docs/13` §前端最小接法 |

已经实测过的量级（用于防止架构退化，不是营销指标）：

- 导出成图固定 **1920×1080**，实测 **2,722,871 B**；与「无点云」对照组逐像素 diff **69.24%**（`AGENTS.md` §六）。
- 3DGS 社区场景 **953 万点**，L0/L1/L2 三档 **402.5 / 100.7 / 50.7 MB**，首屏先挂最粗档（`README.md`）。
- 采集评分闸：**180 张 / 3 层 / 330° / 1.20 m** 得 **100 分、6/6 项通过**；西湖历史素材 **24 张 / 102°** 只得 **49 分**，低于 50 分重采线（`docs/README.md` §五）。

**不设「10 万 CCU」这类无依据的 KPI。** 当前是单区域、工作室级 SaaS，规模目标见 §6.1；没有压测数据就不写数字。

## 1.3 范围（Scope）

**包含：**

- Web 工作台：项目管理、2D/3D 编辑、Agent 对话、物料库、导出、分享、评审。
- 现场采集端的**接口与契约**（采集器代码已独立成仓 `LiliLIN0324/scendance-capture`）。
- 后端：Supabase Auth / Postgres / Storage、5 个 Edge Function、定时任务与供应商适配。
- 数据：场景契约 v1/v2、项目/发布/分享/资产/提案/生成任务/重建任务/计费。
- 部署：Cloudflare Pages 静态站点与 Pages Functions、Supabase 托管后端、可选 R2 对象存储。

**不包含（明确不做或不在本仓）：**

- 自研 3DGS / NeRF 训练产线与模型权重；重建走 Aholo 等外部供应商。
- 实时多人同时编辑（当前是「租约 + 单编辑者」，不是 CRDT / OT）。
- 直播带货、外部应用嵌入、开放平台生态。
- 自动采购、自动结算、供应商账单对账自动化。
- 原生 iOS / Android 编辑器；移动端是 Web 紧凑版，采集端是小程序。
- Kubernetes / 微服务 / gRPC 服务网格（见 ADR-01）。

---

# 二、系统概览（System Overview）

## 2.1 高层架构（High-Level Architecture）

### 2.1.1 业务架构（Business Architecture）

```text
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  场地与采集   │   │   场景重建    │   │   空间设计    │   │  物料与生成   │   │   交付与分享  │
│ place/scope  │──▶│ 3DGS / 矢量壳 │──▶│  2D/3D 画布   │──▶│ GLB / 材质    │──▶│ 图册/CSV/DXF  │
│ capture      │   │              │   │ 分区/流线/人物 │   │ 库件/定制     │   │ 只读链接/评审 │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
        │                  │                  │                  │                  │
        └──────────────────┴──────────────────┴──────────────────┴──────────────────┘
                          账号 / 工作室 / 权限 / 计费 / 观测 / 数据留存
```

七个业务模块：

1. **场地与采集**：地图选点、边界圈画、场地事实（尺寸、入口、标高）、现场采集导引与评分。地图是**场景地面层的锚定**，不是独立模块。
2. **场景重建**：两条链路——Aholo 3DGS 观感底；平面图/照片 → V2 矢量壳（墙、门窗、柱、尺寸证据）。
3. **空间设计工作台**：2D 平面与 3D 场景同源编辑；分区、主流线、物件、支流线、人员；撤销/重做、锁定、对齐、框选。
4. **Agent 设计助手**：理解需求 → 读场地与资源 → 出候选方案 → 提案预览 → 人确认 → 应用；不直接写画布。
5. **物料与生成**：内置物料、公共模型库、个人/工作室资产、Lux3D/混元生成、材质变体、GLB 归一化与校验。
6. **交付与分享**：机位图册、物料清单、DXF、打印/PDF、离线快照链接、云端分享 token、客户评审链接。
7. **平台支撑**：账号、工作室成员、编辑租约、通知、私信、计费扣次、用量与审计。

### 2.1.2 技术架构（Technology Architecture）

```text
┌─────────────────────────────────────────────────────────────────────┐
│ 浏览器：Next.js 15 静态导出（Cloudflare Pages）                        │
│  /editor  /view  /review  /projects  /cases  /pricing  /auth ...     │
│  Three.js + Spark（3DGS）· 2D Canvas · Zustand · Zod                  │
│  本地草稿 / 恢复点：localStorage（受保护读写）                          │
└───────────────┬─────────────────────────────────────────────────────┘
                │ HTTPS · Authorization: Bearer <Supabase access_token>
┌───────────────▼─────────────────────────────────────────────────────┐
│ Cloudflare Pages                                                    │
│  静态产物 frontend/out；/api/* 同源 Pages Functions（地图/瓦片代理）    │
└───────────────┬─────────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────────┐
│ Supabase Edge Functions（Deno，5 个）                                │
│  scene-api          业务主 API（项目/资产/Agent/分享/通知/任务查询）    │
│  conversation-api   对话与 brief 抽取（独立部署、可独立关闭）           │
│  pay-api            支付宝建单/回调/查单/扣次                          │
│  generation-worker  生成任务提交、轮询、归档（定时触发）                │
│  reconstruction-worker 图纸/照片重建任务（定时触发）                    │
└───────────────┬─────────────────────────────────────────────────────┘
                │ service_role RPC · worker secret（仅服务端）
┌───────────────▼─────────────────────────────────────────────────────┐
│ PostgreSQL（Supabase 托管）                                          │
│  scene_private：业务表 + RLS + 撤销 anon/authenticated 权限            │
│  public：仅暴露 SECURITY INVOKER RPC（scene_rpc / studio_rpc /        │
│  agent_rpc / cloud_storage_rpc / job_rpc / reconstruction_rpc ...）    │
│  pg_cron + Vault：定时任务与 worker 密钥                              │
└───────────────┬─────────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────────┐
│ 对象存储：Supabase Storage（默认）或 Cloudflare R2（可选驱动）          │
│  不可变内容寻址路径；签名 URL 默认 5 分钟                              │
└───────────────┬─────────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────────┐
│ 外部能力：Aholo Reality（3DGS）· Lux3D（3D 生成）· 腾讯混元（3D）        │
│ 对话模型（DeepSeek / SiliconFlow / Tokendance / MiniMax，按槽位配置）   │
│ 高德（选点/地理编码）· Carto / OpenFreeMap / 天地图（底图与瓦片）        │
└─────────────────────────────────────────────────────────────────────┘
```

两条不变量：

- **浏览器不直连业务表。** 所有写操作经 Edge Function 验证 Auth token 后，以 `service_role` 调 RPC；`scene_private` 不暴露给 Data API。
- **前端不持有供应商密钥。** Lux3D / Aholo / 对话模型 / 高德安全码只在服务端或同源 Pages Function 中使用。

### 2.1.3 应用架构（Application Architecture）

参考文档把后端分成 APIs / services / repositories / infrastructure 四层；幕景的对应关系如下（不是照搬，是按 Deno + Postgres 的实际情况落地）：

| 参考分层 | 幕景对应 | 说明 |
| --- | --- | --- |
| APIs 表现层 | `supabase/functions/*/index.ts` + `_shared/api.ts` | 路由、CORS、Origin 校验、Auth 验证、请求体上限、Zod 校验、错误映射 |
| services 业务层 | `_shared/agent-runner.ts`、`worker-handler.ts`、`reconstruction-handler.ts`、`assistant-chat.ts`、`generation-*` | 业务编排、工具循环、状态机、供应商调用；不直接拼 SQL |
| repositories 数据层 | `scene_rpc` / `studio_rpc` / `agent_rpc` / `job_rpc` / `reconstruction_rpc` / `cloud_storage_rpc` | 事务、行锁、成员谓词、版本检查都在数据库函数内完成 |
| infrastructure 基础层 | `backend.ts`、`r2-storage.ts`、`realtime-signal.ts`、`providers.ts`、`http.ts` | 存储、签名、Realtime 信号、供应商 HTTP、日志 |

前端分五层：

```text
app/                       路由与页面（editor / view / review / projects / cases / pricing）
components/room-organizer/ 编辑器主体
  panels/                  对话、场地、物料、交付、设置等面板
  canvas-2d/               平面画布与命中测试
  three/                   3D 场景、3DGS 预览、家具构建器、尺度换算
  hooks/                   布局 store、历史、导入导出、扫描预览
  lib/                     领域逻辑、适配器、校验、持久化、导出（纯函数优先）
frontend/lib/              分享快照、页面级共享逻辑
client/scene-client.ts     前后端契约客户端（浏览器与服务端共用类型）
```

**契约边界：**

- 场景 wire schema 唯一真源：`supabase/functions/_shared/domain.ts`。
- 浏览器客户端：`client/scene-client.ts`；不得另起一套并行 schema。
- 编辑器内部模型 `RoomLayout` 与 wire `Scene` 是两套模型，由适配层换算；不得静默丢字段。
- 几何基线（`three/scan-placement.ts`、`three/furniture-builders.ts`）是只读区；需要新行为时在 `lib/` 侧加换算或选择器。

## 2.2 核心业务流程（Core Business Processes）

### 2.2.1 场地建档与重建

**A. 3DGS 实景链路（Aholo Reality）**

```text
选点/圈画 → 现场采集 → 上传素材 → 建重建任务 → 轮询 → 下载 .spz/.ply
   → 归一化（Y-up、贴地、居中）→ 生成 LOD → 登记资产 → 画布挂载
```

- 采集不达标就重建不出来：数量、层数、重叠、尺度基准由 `frontend/lib/capture-guide/` 的评分闸判定；低于 50 分要求重采。
- 3DGS **只提供观感，不提供精确几何**。量尺、碰撞、贴地由 GLB / 矢量壳承担；这条边界写进产品与架构，避免把「看起来对」当「量得准」。
- LOD 约定：`frontend/public/scans/<文件名主干>/` 下放 `L0`、`lod-1.spz`、`lod-2.spz`、`lod-meta.json`；首屏先挂最粗档，按相机距离换档。
- 上传/登记失败不伪造成功：本机扫描默认只登记在当前浏览器；跨设备依赖云端资产链路。未上云的本地资产会阻止云端保存（`LOCAL_ASSET_NOT_UPLOADED`）。

**B. 平面图/照片 → V2 矢量壳（`reconstruction_jobs`）**

```text
queued → recognizing → planning → validating → ready
              ↘ needs_review ↗        ↘ failed
```

- worker 认领带 token 与 8 分钟租约；旧 worker 不能覆盖新 worker。
- `needs_review` 时人可以改候选壳；应用时校验 `baseHash`、`expectedRevision`、`sources`，过期返回 `STALE_RECONSTRUCTION_REVIEW`。
- 供应商结果未知时标 `failed`（`PROVIDER_RESULT_UNKNOWN`），不猜一个壳出来。

**C. 双端（网页 + 小程序）**

- 采集端独立成仓；两端共用账号与任务表，任务号在两端 URL 中都带 `jobId`。
- 一次重建任务 = 一次计费单位，不是一张照片。
- 上传中的任务只有发起端能续传（文件在本机）；另一端只读进度，不接管文件。
- 提交带幂等键；一端提交后另一端再点只返回既有 `worldId`。

### 2.2.2 编辑会话与保存（租约 + 版本）

```text
进入编辑 → acquire lease（90s）→ 每 30s 续期
   → 本地编辑（localRevision++）
   → PUT /projects/:id/scene（sessionId, generation, expectedRevision）
        ├─ 成功：revision = 返回值；不靠前端自增
        └─ 409：保留本地草稿，停止自动保存；重新获取租约后载入最新场景、清空旧撤销历史
```

规则：

- 项目行是编辑事务的**唯一锁定点**；获取、续期、交接、保存、发布、提案应用都锁同一行，避免「先检查后写入」竞态。
- 一个浏览器标签页一个 `sessionId`；不能跨标签页复用。
- 租约过期或交接后 `generation` 递增，旧请求不能复活。
- 释放租约不会自动保存。
- 当前**没有实时多人编辑**；多人协作靠租约串行，不是 CRDT。

### 2.2.3 Agent 设计循环（提案制）

```text
用户一句话
  → 服务端组装上下文（场景摘要、场地事实、物料目录、可用资源、证据）
  → 模型工具循环（最多 6 轮；阶段：看现状 → 定落点 → 出方案 → 交付）
  → 候选方案 + 校验（Zod strict、边界、碰撞、锁定、结构）
  → 持久化提案（绑定 revision / 场景哈希 / 租约代次；10 分钟过期）
  → 前端预览差异
  → 人确认
  → 一次事务应用：写入场景 + 返回 previousScene / undoGroup
```

关键约束：

- **Agent 不直接写画布。** 提案与应用分离；未确认的候选不产生保存，也不产生撤销记录。
- 过期或基线变化的提案返回 `STALE_PROPOSAL`，不「尽力应用」。
- 模型输出不合法最多修复一次；第二次仍不合法就失败（`AI_INVALID_PROPOSAL`），不把解释文本当成功。
- 阶段只前进不后退；同一轮可以既读场地又定落点，但界面不出现进度倒流。
- 监督按动作后果分级：低风险可自动应用，高风险必须确认（`lib/agent-action-risk.ts`、`lib/agent-supervision.ts`）。
- 运行过程写入 `agent_run_events`；事件是观测，不是业务真值。

### 2.2.4 物料生成（异步任务）

```text
queued → submitting → submitted → processing → archiving → ready → added
             └→ submit_unknown
                          └→ failed / rejected
```

- 一次用户意图一个 `requestId`；网络重试复用同一个键，不重复创建付费任务。
- `submitting` 先由数据库认领再请求供应商；超时、响应无法解析、提交后崩溃都保留 `submit_unknown`，绝不自动创建第二个付费任务。
- 轮询认领带 token 与 4 分钟有效期；旧 worker 不能覆盖新 worker。
- 任务与供应商 ID 都落库；关页面不影响恢复。
- 归档期间崩溃可重新查询供应商并写入同一内容哈希路径；原文件不覆盖。
- `ready` 后用户确认尺寸、加入场地，再标 `added`；预览/复制/删除实例不删除共享文件。
- 预算按最保守预留；`committed_cents` 包含未完成/未知/失败任务的预留；预留不等于实际扣费。

### 2.2.5 交付与分享（双轨）

**轨道 A：离线快照（无需后端）**

```text
layout → 内容指纹 → snapshotId → 压缩编码进 URL hash（#s1=...）
      → /view 只读查看器解码 → 三视角截图 / 下载
```

- 链接长度上限 20,000 字符；hash 上限 64 KB；解码后 JSON 上限 1 MB；超出明确报错，不静默截断。
- 适合「发微信就能打开」的演示与客户确认；不依赖登录、不依赖数据库。

**轨道 B：云端发布（需后端）**

```text
保存 revision → POST /projects/:id/publish → 不可变 publication + share token
  → 客户 /view#token → POST /share/read（匿名）→ 校验哈希与撤销 → 发布快照 + 5 分钟资源 URL
```

- `shares` 只存 token 的 SHA-256，不存明文；丢失只能重新发布。
- 撤销分享不会收回已下载内容，也不会让已签发 URL 立刻失效；这是明确边界。
- 客户只读场景不含内部 `notes`、私人平面图、内部备注。
- 评审链接 `/r/:code` 另有一套版本、pin 与撤销（`review_share_links`、`review_share_pins`）。

**交付包**：机位图册（4 机位 + 离线 HTML）、物料清单 CSV、DXF 平面、按比例打印/PDF；所有产物来自同一版快照，带 `contentFingerprint` 与 `snapshotId`，对不上就拒绝打包。

### 2.2.6 计费与扣次

```text
选 SKU（服务端定价）→ 建单 → 支付宝支付 → 异步通知验签 → 订单幂等落库
   → 预扣一次（owner + jobId + attempt）→ 成功确认 / 失败返还 / 超时返还
```

- 金额以后端 SKU 表为准，**绝不信任前端传的金额**。
- 支付宝异步通知只认纯文本 `success`；验签 + 金额/订单号校验 + 幂等。
- 未配置凭据时降级 mock，并在响应里明确 `mode=mock`；前端必须显示标识。
- `scan_consumptions` 用幂等键防重复扣次；失败/超时返还走独立动作。

---

# 三、架构原则与技术选型（Architecture Principles & Tech Stack）

## 3.1 设计原则

| # | 原则 | 具体做法 | 反面案例 |
| --- | --- | --- | --- |
| P1 | **一份契约** | `_shared/domain.ts` 是 wire schema 唯一真源；`scene-client.ts` 只做传输 | 前后端各写一套 Scene 类型，字段悄悄漂移 |
| P2 | **服务端集中鉴权** | 业务表在 `scene_private`；浏览器无写策略；Edge 验证 token 后以 `service_role` 调 RPC | 浏览器直连表 + RLS，权限散落在客户端 |
| P3 | **提案制** | Agent 只出候选；人确认后一次事务应用；可整体撤销 | 模型直接改场景，出错无法回滚 |
| P4 | **事实与推断分离** | 尺寸/墙体带 `detected / inferred / confirmed`；进度只放供应商真实值 | 把推测尺寸写成实测；假进度条 |
| P5 | **失败显式、未知保留** | `submit_unknown`、`PROVIDER_RESULT_UNKNOWN`、409 保留草稿 | 失败自动重试付费任务；把 99% 当成功 |
| P6 | **静态优先、边缘轻量** | 前端静态导出 + CDN；Edge Function 无状态；Postgres 当队列 | 为小团队上 K8s / 微服务 / 服务网格 |
| P7 | **单一真源** | 米制尺度、贴地、朝向只在几何基线；单位换算只在适配层 | 在多个面板各写一套换算 |
| P8 | **可恢复** | 幂等键、租约代次、不可变发布、内容寻址存储 | 重试生成新订单；覆盖历史发布 |
| P9 | **交付即证据** | 快照指纹、版本号、导出清单、核对回执 | 导出物与当前画布不是同一版 |
| P10 | **界面只说事实** | 文案按位置断言；钱、提交、外发、删除、丢失、限制必须保留最短事实句 | 用免责声明和副标题填满界面 |

## 3.2 契约与数据边界

参考文档花了很大篇幅讲 DTO；幕景的等价规则是「严格 wire schema + 明确命名 + 不泄露内部标识」：

1. **严格对象**：所有请求/场景用 Zod `strictObject`；多余字段拒绝，不静默丢弃。
2. **命名分层**：数据库实体 `snake_case`；HTTP 请求/响应 `camelCase`；场景 JSON 内部保持既有字段名，不为了好看重命名。
3. **不泄露内部信息**：不返回存储路径、service role key、worker token、供应商密钥、明文分享 token；无权限与不存在统一 404，避免枚举。
4. **不暴露数据库主键**：对外只给随机 UUID 或不透明 ID；`shares` 只存哈希。
5. **单位固定**：全部米制；地面 XZ，Y 竖直；原点为场地包围矩形左下角；rotation 绕 Y 轴，范围 -360–360。
6. **版本显式**：`schemaVersion: 1 | 2` 判别联合；v1 不含结构层，v2 才含墙/门窗/柱/尺寸证据；不用「猜字段」兼容。
7. **输入验证在边界**：格式、长度、ID 唯一性、边界、门窗归属在 Schema 层；业务规则（成员、租约、预算）在 RPC/服务层。
8. **不可变**：发布快照、资产内容路径、账单事件不就地覆盖；修正产生新版本。

场景 v2 的核心形状（节选，完整定义见 `domain.ts`）：

```json
{
  "schemaVersion": 2,
  "venue": { "shape": "rectangle", "width": 12, "depth": 10, "height": 3, "entrances": [] },
  "structure": {
    "walls": [{ "id": "…", "start": {"x":0,"z":0}, "end": {"x":12,"z":0}, "thickness": 0.2, "height": 3, "kind": "exterior", "status": "confirmed" }],
    "openings": [{ "id": "…", "wallId": "…", "kind": "door", "offset": 2, "width": 1.2, "height": 2.2, "sillHeight": 0, "status": "confirmed" }],
    "columns": []
  },
  "sources": [{ "assetId": "…", "kind": "floorplan", "name": "场地平面", "width": 2048, "height": 1536 }],
  "dimensions": [{ "id": "…", "kind": "width", "valueMeters": 12, "status": "confirmed", "label": "场地宽" }],
  "objects": [],
  "zones": [],
  "camera": "overview",
  "lighting": "neutral"
}
```

## 3.3 技术栈清单（Technology Stack）

| 层 | 选型 | 为什么 | 刻意不用 |
| --- | --- | --- | --- |
| 前端框架 | Next.js 15 + React 18 + TypeScript 5.9，`output: 'export'` | 静态产物可直接上 CDN；工作台是重客户端，不需要 SSR | Next 服务端渲染 / 自建 Node 服务 |
| 样式 | Tailwind CSS 3 + 设计规范 | 与 `docs/05` 的色板、圆角、控件规格对齐 | 组件库全家桶 |
| 状态 | Zustand 5 | 编辑器状态集中、可测试；避免 Context 深层重渲染 | Redux（样板过多） |
| 3D | three.js 0.186 + `@sparkjsdev/spark` 2.4 | GLB + 3DGS 同一渲染管线；Spark 负责 splat | 自研渲染器 / Unity WebGL |
| 2D | 原生 Canvas + 领域纯函数 | 平面图命中、吸附、标注可控；易单测 | 重型图形框架 |
| 校验 | Zod 4 | 前后端共用；严格对象；错误可读 | 手写 if 校验 |
| 后端运行时 | Supabase Edge Functions（Deno） | 与 Auth/Storage/Postgres 同平台；无服务器运维 | 自建 Go/Java 微服务 |
| 数据库 | PostgreSQL（Supabase 托管） | 事务、行锁、JSONB、RLS、RPC 足够；场景是文档型但需要强一致 | Cassandra / HBase（无此规模） |
| 搜索 | Postgres 索引 + 内存目录 | 物料目录是有限集合；不需要全文集群 | Elasticsearch |
| 缓存 | 无独立缓存；浏览器本地 + Postgres | 读多写少的个人项目；避免 Redis 失效与双写 | Redis（当前无必要） |
| 队列 | Postgres 任务表 + `pg_cron` | 事务内认领、`SKIP LOCKED`、可审计；规模匹配 | RabbitMQ / Kafka |
| 对象存储 | Supabase Storage 默认；R2 可选 | 私有资产 + 5 分钟签名；R2 便于大文件与出网 | 自建 MinIO 集群 |
| 实时 | Supabase Realtime 信号 | 只做「有新消息/新通知」提示，不传业务真值 | WebSocket 自建长连接 |
| 3DGS | Aholo Reality | 不自研训练产线；按次外包，可替换 | 自建 3DGS 训练集群 |
| 3D 生成 | Lux3D + 腾讯混元 | 定制物料生成；GLB 归一化后入库 | 自研生成模型 |
| 对话模型 | 按槽位配置（DeepSeek / SiliconFlow / Tokendance / MiniMax） | 可切换、可限流、可单独关闭 conversation-api | 把模型密钥放浏览器 |
| 地图 | 高德（选点/地理编码）+ Carto / OpenFreeMap / 天地图（瓦片） | 国内选点准确；底图可切换；同源代理隐藏 key | 浏览器直连带密钥的瓦片 |
| 测试 | Vitest（根 + 前端）、PGlite、Deno check | 数据库用真实 PostgreSQL 引擎跑迁移与 RPC；前端 jsdom | 只 mock 不跑 SQL |
| 部署 | Cloudflare Pages + Supabase | 静态 CDN + 托管后端；小团队可维护 | K8s / Helm / 服务网格 |

---

# 四、详细系统设计（Detailed System Design）

## 4.1 模块划分（Module Breakdown）

| 模块 | 职责 | 关键实现 |
| --- | --- | --- |
| 认证与账号 | 邮箱登录/注册/找回；会话；账号偏好 | Supabase Auth；`app/auth/*`；`lib/account-preferences.ts` |
| 工作室与成员 | 工作室、负责人/编辑、邀请、移除、私信、通知 | `scene_private.studios/members/member_messages`；`studio_rpc` |
| 项目管理 | 列表、创建、重命名、删除/回收站、可见性、版本 | `projects`；`scene_rpc`；`lib/outdoor-project-store.ts` |
| 场景编辑 | 2D/3D 同源；物件、分区、流线、人员、结构、材质 | `components/room-organizer/*`；`hooks/use-layout-store.ts` |
| 编辑租约 | 获取/续期/释放/交接；代次；过期 | `projects` 行锁；`scene_rpc` round 逻辑 |
| 场地与地图 | 选点、圈画、场地事实、底图、比例尺、锚点 | `lib/place-*`、`lib/site-*`、`lib/scene-anchor.ts`；Pages Functions 代理 |
| 采集导引 | 张数/层数/重叠/曝光/尺度评分 | `frontend/lib/capture-guide/`（两端共用阈值真源） |
| 3DGS 资产 | 上传、登记、LOD、签名 URL、画布挂载 | `lib/aholo-assets.ts`、`lib/scan-upload.ts`、`three/splat-preview.ts` |
| 矢量壳重建 | 图纸/照片识别、候选、校核、应用 | `reconstruction-worker`；`reconstruction_rpc`；`lib/plan-*` |
| Agent | 上下文、工具循环、阶段、候选、提案、事件、监督 | `_shared/agent-runner.ts`、`agent-*.ts`；`lib/agent-proposal.ts` |
| 对话 | brief 抽取、助手对话、流式响应、会话留痕 | `conversation-api`；`assistant-chat.ts`；`conversation_turns` |
| 物料库 | 内置物料、公共库、个人/工作室资产、分类、尺寸 | `assets/library/`；`library_assets`；`lib/material-*` |
| 生成 | 文本/图片/纹理/3D 任务；提交、轮询、归档、加入 | `generation-worker`；`job_rpc`；`lib/model-generation.ts` |
| 材质变体 | 读取 GLB 材质槽、改色/粗糙度、生成新版本 | `_shared/material-variants.ts`；`material_customizations` |
| 导出 | 图册、CSV、DXF、打印/PDF、交付包 | `lib/plan-export/*`、`lib/delivery-package.ts` |
| 分享与评审 | 离线快照、云端 token、撤销、评审 pin | `frontend/lib/share-snapshot.ts`、`lib/share.ts`、`review_*` |
| 计费 | SKU、订单、回调、扣次/返还 | `pay-api`；`public.pay_*`、`scan_consumptions` |
| 观测与审计 | 运行事件、生成台账、对话留痕、健康检查 | `agent_run_events`、`generation_jobs.usage`、`/health` |

## 4.2 接口设计规范（API Design）

### 4.2.1 入口与认证

| 函数 | 路径前缀 | 认证 | 说明 |
| --- | --- | --- | --- |
| scene-api | `/functions/v1/scene-api` | 除 `/health`、`/share/read` 外均 Bearer | 业务主 API |
| conversation-api | `/functions/v1/conversation-api` | Bearer | 仅 `/brief/extract`、`/assistant/chat`、`/assistant/chat/stream`、`/conversation/turns` |
| pay-api | `/functions/v1/pay-api` | 按路由（回调匿名但验签） | 建单/回调/查单/扣次 |
| generation-worker | `/functions/v1/generation-worker` | worker secret | 定时触发，不面向浏览器 |
| reconstruction-worker | `/functions/v1/reconstruction-worker` | worker secret | 定时触发，不面向浏览器 |

通用规则：

- `Content-Type: application/json`，正文最多 256 KB；返回 `Cache-Control: no-store`。
- 仅允许配置的 CORS origins；不使用 Cookie 会话。
- 前端每次请求带 Supabase access token；服务端独立 `getUser` 验证，不信任正文里的用户 ID。
- 匿名只允许 `/health` 与 `/share/read`；`verify_jwt=false` 不代表业务接口免认证。

### 4.2.2 路由族

| 族 | 代表路由 | 作用 |
| --- | --- | --- |
| 健康 | `GET /health` | `{ok:true,schemaVersion:1}` |
| 工作室 | `GET/POST /studios`、`PATCH/DELETE /studios/:id`、`/members`、`/messages`、`/settings` | 成员、私信、设置 |
| 项目 | `GET/POST /projects`、`GET/PATCH/DELETE /projects/:id`、`/lease/*`、`/scene`、`/materials` | 项目与编辑 |
| 提案 | `POST /projects/:id/proposals`、`/proposals/apply`、`/material-variants` | Agent 提案与应用 |
| Agent 运行 | `/agent-runs/:id`、`/events`、`/events/stream`、`/cancel`、`/notes` | 运行状态、事件、取消 |
| 资产 | `GET /assets`、`/assets/:id/url`、`/materials`、`/customize`、`/publish`、`/team` | 资产访问、材质、团队库 |
| 场地 | `/sources/:id`、`/reconstructions/:id`、`/reconstructions/:id/raw-model-notes` | 图纸/重建 |
| 生成 | `GET /generation/capabilities`、`POST/GET /jobs`、`GET /jobs/:id`、`POST /jobs/:id/added` | 生成任务 |
| 分享 | `POST /projects/:id/publish`、`GET /projects/:id/shares`、`DELETE /shares/:id`、匿名 `POST /share/read` | 发布与客户读取 |
| 通知 | `GET /notices`、`/notices/unread`、`/notices/read` | 官方通知 |
| 户外方案 | `POST/GET /outdoor-plans/:id` | 户外方案持久化 |
| 支付 | `POST /pay/create`、`POST /pay/notify`、`GET /pay/order/:id`、`POST /scan/consume`、`/release`、`/expire` | 订单与扣次 |

### 4.2.3 统一错误语义

```json
{ "error": { "code": "REVISION_CONFLICT", "details": { "expectedRevision": 7, "actualRevision": 8 } } }
```

| 状态 | 典型 code | 客户端行为 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` / `INVALID_JSON` | 展示字段问题，不自动提交 |
| 401 | `UNAUTHENTICATED` | 重新登录，保留草稿 |
| 403 | `FORBIDDEN` / `ORIGIN_FORBIDDEN` | 不允许该操作 |
| 404 | `PROJECT_NOT_FOUND` / `ASSET_NOT_FOUND` / `SHARE_NOT_FOUND` | 无权限与不存在同码，避免枚举 |
| 409 | `LEASE_LOST` / `REVISION_CONFLICT` / `STALE_PROPOSAL` / `IDEMPOTENCY_CONFLICT` | 保留草稿、停止自动保存、重新取租约/提案 |
| 413 | `FILE_TOO_LARGE` / `AI_INPUT_TOO_LARGE` | 换文件或缩小输入 |
| 422 | `AI_INVALID_PROPOSAL` / `OUT_OF_BOUNDS` / `MODEL_TOO_COMPLEX` | 显示具体问题，不当作成功 |
| 429 | `GENERATION_BUSY` / `AI_BUSY` / `RECONSTRUCTION_BUSY` | 等任务结束；不换幂等键重试付费提交 |
| 502/503 | `PROVIDER_HTTP_ERROR` / `SERVICE_NOT_CONFIGURED` / `BILLING_NOT_CONFIGURED` | 保留现有场景，报告服务不可用 |

错误正文不返回数据库/供应商堆栈；日志不记录 prompt 与请求体（`GENERATION_BUSY` 只记 actor/action/时间）。

### 4.2.4 幂等与重试

- 创建工作室、生成任务、重建提交、支付扣次、发布等写操作都带 `requestId` / `Idempotency-Key`。
- 同一用户意图内复用同一个键；网络重试不得生成新 UUID。
- 幂等键冲突返回 409 `IDEMPOTENCY_CONFLICT`，不静默覆盖。
- 未知结果不自动重试；先查供应商记录或任务状态，人工核对后解除。

## 4.3 异步任务与调度（Message Queue Design）

**没有 RabbitMQ / Kafka。** 用 Postgres 任务表 + `pg_cron`，原因见 ADR-02。

```text
pg_cron（每分钟）
  → 调 Edge Function（带 worker secret）
  → RPC 认领：FOR UPDATE SKIP LOCKED + worker_token + 租约
  → 服务端请求供应商（事务外）
  → RPC 回写状态/结果
  → 租约过期：补偿扫描，标 failed 或重新入队
```

| 任务 | 表 | 认领租约 | 关键状态 |
| --- | --- | --- | --- |
| 生成 | `generation_jobs` | 4 分钟 | `queued/submitting/submitted/processing/archiving/ready/added/failed/rejected/submit_unknown` |
| 矢量壳重建 | `reconstruction_jobs` | 8 分钟 | `queued/recognizing/needs_review/planning/validating/ready/failed` |

失败模式与处理：

| 场景 | 处理 |
| --- | --- |
| worker 崩溃在 `processing` | 租约到期后补偿：标 `failed` 或按规则重试；不无限 `PROCESSING` |
| 供应商结果未知 | 保留 `submit_unknown` / `PROVIDER_RESULT_UNKNOWN`；占并发位，人工核对后解除 |
| 供应商 5xx/超时 | 任务失败并记录错误；不伪造成功 |
| 数据库写入成功、触发失败 | 任务仍在表里，定时器会再次认领；用户看到的是持久状态 |
| 重复提交 | 幂等键 + 唯一约束；不产生第二个付费任务 |

**背压**：同一 owner 的活跃生成任务受数据库闸门限制；超出返回 429，而不是排队到无限。

## 4.4 Agent 子系统

| 层 | 实现 | 说明 |
| --- | --- | --- |
| 运行 | `agent_runs` | 一次请求一行；`request_key` 幂等；`state`、`progress`、`deadline`、`claim` |
| 契约 | `agent-contract.ts` / `outdoor-agent-response-contract.ts` | 严格解析模型输出；候选、命令、解释分离 |
| 循环 | `agent-runner.ts` | 工具调用最多 6 轮；阶段 `survey/locate/compose/deliver` 只前进 |
| 上下文 | `context-refresh.ts`、`scene-digest.ts`、`scene-resources.ts` | 场景摘要、场地事实、物料目录、可用资源；不把存储路径/密钥给模型 |
| 几何 | `placement-search.ts`、`plan-geometry.ts`、`seating-allocation.ts`、`clearance-report.ts` | 落点、边界、坐席、通行净空；代码算，不让模型猜 |
| 校验 | `agent-candidate-review.ts`、`agent-annotation-check.ts`、`jev.ts` | 候选审查、标注检查、结构化评价 |
| 事件 | `agent_run_events` | 阶段、工具、耗时、错误；用于观测与回放，不是业务真值 |
| 监督 | `agent-action-risk.ts`、`agent-supervision.ts` | 按后果分级：低风险自动、高风险确认 |
| 对话 | `assistant-chat.ts` + `conversation-api` | 普通对话与设计任务分流；可独立关闭 |

**上下文不包含**：下载地址、存储路径、service role key、其他用户资产、未授权项目内容。模型只看到资源索引与尺寸/许可摘要。

**工具边界**：Agent 能读场地、查资源、算落点、生成候选、改材质；不能直接写数据库、不能发布、不能删除项目、不能提交付费生成。需要这些动作时返回建议，由前端走既有入口。

## 4.5 资产与存储链路

```text
上传 → 格式/大小/结构校验 → 内容哈希 → 不可变路径 → 资产行 → 项目授权
  → 签名 URL（5 分钟）→ 前端加载 → 归一化（Y-up/贴地/居中）→ 实例
```

- GLB 归档门槛：10 MB、10 万三角面、200 个绘制 primitive、500 节点、64 材质、32 张纹理；纹理仅 PNG/JPEG 且不超过 2048 像素。
- 骨骼、动画、必需扩展/压缩超出首版加载能力时明确拒绝，不做「先收下再说」。
- Khronos validator 检查结构与索引；glTF Transform 读包围盒；这不能替代浏览器/手机实际渲染验收。
- 原始纹理与 GLB 保留；返回 `sourceSize` 与 `groundOffset`；前端在内层组施加偏移，外层按目标尺寸逐轴缩放。
- 实例复制共享 `assetId`，不发起 Storage 删除；删除资产前先看引用。
- 公共模型只从固定提供商域名下载；禁止重定向、任意 URL、外部 GLB 资源。
- 个人素材列表只返回本人资产；项目成员只可访问自己或项目曾引用的资源；客户只收到发布清单中的 GLB。

## 4.6 交付与分享

| 形态 | 编码 | 依赖 | 适用 |
| --- | --- | --- | --- |
| 离线快照 | `/view#s1=<压缩 JSON>` | 无后端 | 微信转发、演示、客户快速看 |
| 云端分享 | `/view#<token>` → `POST /share/read` | 后端 + 发布 | 正式客户交付、可撤销 |
| 评审链接 | `/r/:code` | 后端 + 评审版本 | 客户逐条评审、pin |
| 交付包 | ZIP / 文件夹 | 浏览器生成 | 执行团队落地 |

交付包内容：机位图册 HTML + 4 张机位图、物料清单 CSV、DXF、打印/PDF、分享链接、README。所有产物带同一 `snapshotId`；指纹不一致直接失败，不打包。

---

# 五、数据架构设计（Data Architecture）

## 5.1 数据模型（Data Models）

当前迁移共 **61 个 SQL 文件**（不含 `rollback/`）；`scene_private` 下 **37 张表**，另有 `public.pay_*` 等 4 张支付表。按域分组：

| 域 | 表 | 说明 |
| --- | --- | --- |
| 账号/工作室 | `studios`、`members`、`member_messages`、`studio_settings`、`studio_assets`、`user_preferences`、`official_notifications`、`official_notification_reads` | 工作室、成员、私信、设置、团队资产、偏好、通知 |
| 项目/发布 | `projects`、`publications`、`shares`、`project_assets`、`published_assets`、`original_scene_reviews`、`outdoor_plans`、`outdoor_card_history` | 当前场景、不可变发布、分享、资产授权、原始场景评审、户外方案 |
| 物料/资产 | `assets`、`materials`、`library_assets`、`parametric_assets`、`material_customizations`、`material_variant_proposals`、`source_images` | 资产、内置物料、公共库、参数化、材质变体、图纸来源 |
| Agent/提案 | `agent_runs`、`agent_proposals`、`agent_run_events`、`proposals`、`proposals` 关联 | 运行、候选、事件、旧提案 |
| 生成/重建 | `generation_jobs`、`reconstruction_jobs`、`reconstruction_calls`、`requests`、`budgets`、`text_daily_budgets`、`text_provider_calls` | 任务、调用、幂等请求、预算 |
| 对话 | `conversation_turns` | 对话留痕；不可用不影响主流程 |
| 活动/场地 | `brief_request_actors`、`brief_request_fences` | brief 请求闸门与参与者 |
| 计费（public） | `pay_skus`、`pay_orders`、`pay_events`、`scan_consumptions` | SKU、订单、支付事件、扣次 |

核心关系：

```text
studios 1─N members
studios 1─N projects
projects 1─N publications 1─N shares
projects 1─N project_assets N─1 assets
projects 1─N agent_runs 1─N agent_proposals
projects 1─N generation_jobs N─1 assets
projects 1─N reconstruction_jobs N─1 source_images
projects 1─N outdoor_plans
```

关键字段语义：

- `projects.scene`：当前保存的完整场景 JSON；`revision` 单调递增；`editor_session/generation/lease_expires_at` 组成编辑租约。
- `publications`：不可变场景 + 物料表 + 资产 ID 清单 + 标题 + 发布时间；发布不改旧版本。
- `shares.token_hash`：只存 SHA-256；`revoked_at` 撤销；不存明文。
- `project_assets`：项目对资产的引用授权；发布后保留，保证旧发布还能打开。
- `agent_runs`：`input`、`base_hash`、`state`、`claim`、`candidates`、`evaluation`、`deadline`；一次请求一行。
- `generation_jobs`：`provider_job_id`、`state`、`worker_token`、`asset_id`、`error_code`、`usage`。
- `reconstruction_jobs`：`input`、`base_hash`、`state`、`candidate`、`issues`、`proposal_id`、`worker_token/worker_until`。
- `scan_consumptions`：`owner_key`、`job_id`、`idempotency_key`、`status`、`released_at`。

**没有 Neo4j / Cassandra / Elasticsearch**：社交关系是工作室成员表；Feed 是项目列表；搜索是有限物料目录。用 Postgres 的 JOIN、索引与 JSONB 足够，避免多存储一致性成本。

## 5.2 存储策略（Storage Strategy）

| 层 | 存什么 | 位置 | 生命周期 |
| --- | --- | --- | --- |
| L0 本机 | 当前草稿、恢复点、偏好、未上传扫描 | `localStorage`（受保护读写） | 浏览器清理即失；关键内容必须上云 |
| L1 热数据 | 项目当前场景、租约、任务状态、提案 | Postgres `projects` / `agent_runs` / `*_jobs` | 持续 |
| L2 温数据 | 发布快照、分享、资产元数据、事件、对话 | Postgres | 长期；删除用软删除/保留证据 |
| L3 冷数据 | GLB、SPZ/PLY、原始图片、纹理、导出中间物 | Supabase Storage / R2 | 内容寻址、不可变；按引用清理 |
| L4 交付物 | 图册、CSV、DXF、ZIP、PDF | 浏览器生成并下载 | 不长期托管；客户拿到即交付 |

**冷热分离**不是「Redis + DB」，而是：

- 浏览器内存/Zustand 是编辑热态；
- Postgres 是唯一真值；
- 对象存储只放大文件，数据库只存元数据与引用；
- 没有独立缓存层，因此没有缓存失效与双写问题；代价是每次读都打 Postgres（见 §6.1）。

**资产路径**：内容哈希 + 不可覆盖；同一内容重复上传复用路径；归档崩溃可重写同一路径；实例删除不删共享文件。

**签名 URL**：默认 5 分钟；刷新时重新请求 `share/read` / `assets/:id/url`，服务端重新检查撤销与授权。

## 5.3 数据一致性（Consistency）

| 场景 | 机制 | 失败表现 |
| --- | --- | --- |
| 项目保存 | 行锁 + `expectedRevision` + `sessionId` + `generation` | 409，保留草稿 |
| 租约交接 | 同一项目行锁；代次递增 | 旧代次请求 409 `LEASE_LOST` |
| Agent 应用 | 提案绑定 `base_hash` + revision + 租约代次；一次事务 | `STALE_PROPOSAL`，不应用 |
| 发布 | 只接受已保存 revision；新发布不改旧版本 | 409 / 404 |
| 分享撤销 | 更新 `revoked_at`；读取时检查 | 已下载内容不回收（明确边界） |
| 生成任务 | 幂等键 + 数据库认领 + worker token + 预算预留 | 429 / `submit_unknown` |
| 扣次 | `scan_consumptions` 幂等键 + 状态机 | 重复扣次被拒；失败返还 |
| 多端 | 任务表 + `updated_at` 轮询；Realtime 只做提示 | 最终一致；不承诺实时同步 |

**没有分布式事务。** 跨服务（Postgres ↔ 对象存储 ↔ 供应商）靠「先落库、后外部调用、失败保留未知、补偿扫描」保证可恢复，而不是两阶段提交。

---

# 六、非功能性需求设计（NFR）

## 6.1 可扩展性（Scalability）

- **前端**：静态导出 + CDN，水平扩展由 Cloudflare 承担；没有 Node 服务常驻。
- **Edge Function**：无状态，按请求扩缩；重活（3D 生成/重建）异步化，不在请求里等模型。
- **数据库**：项目行锁把并发限制在单项目；跨项目天然并行。当前读多写少，单主库足够。
- **已知上限**：`GET /projects`、`GET /assets` 固定最近 100 项，无游标分页；团队/资产规模扩大前必须补分页。
- **未来扩展点**：只读副本、`agent_run_events` 分区/归档、对象存储 CDN、按工作室分库（未实施）。
- **不承诺**：10 万 CCU、跨区域多活、实时协同。没有压测与容量模型，不写进 SLA。

## 6.2 安全性（Security）

| 面 | 措施 |
| --- | --- |
| 身份 | Supabase Auth；邮箱登录/回调/找回；服务端 `getUser` 验证；不用 Cookie |
| 授权 | 业务表在 `scene_private`，RLS + 撤销 `anon/authenticated`；只有 `service_role` 可执行 RPC；没有 `SECURITY DEFINER` 提权函数 |
| 成员隔离 | 成员谓词在 RPC 内；非成员读项目返回 404，不泄露存在性 |
| 匿名分享 | token 只存 SHA-256；读取时校验撤销；资源 URL 5 分钟；不把 token 放 query/日志/分析 |
| 密钥 | service role、worker secret、供应商 key 只在服务端；前端只有 publishable key；仓库不提交 `.env.local` |
| 输入 | Zod 严格校验；正文 256 KB；图片 5 MB / 4096 像素；GLB 结构与大小门槛；禁止任意 URL/重定向 |
| 内容安全 | 敏感输入检查、未验证断言检查、brief 闸门；提示词注入不能改变工具权限 |
| 支付 | RSA2 验签；金额以服务端 SKU 为准；回调幂等；mock 模式显式标识 |
| 日志 | 不记录 prompt、请求体、密钥、明文 token；`GENERATION_BUSY` 只记 actor/action/时间 |
| 前端 | 上传名称按文本节点渲染，不注入 HTML；CSP/Origin 由部署层配置 |

## 6.3 性能优化（Performance）

- **3DGS**：L0/L1/L2 三档，首屏最粗档，按相机距离换档；实测 953 万点场景 402.5/100.7/50.7 MB。
- **GLB**：预览前先做体积/面数预检；懒加载；实例共享资产；不重复下载。
- **渲染**：导出固定 1920×1080；改 `camera.aspect` / `pixelRatio` 后还原；这条链路无单测覆盖，改动前先补测试。
- **地图**：瓦片经同源 Pages Function 代理并缓存；浏览器不直连带 key 的瓦片服务。
- **导出**：机位图、CSV、DXF 在浏览器生成，不占服务端 CPU；大包用 ZIP 流式组装。
- **数据库**：项目/资产/任务按 owner 与时间索引；任务认领用 `SKIP LOCKED`，避免锁等待。
- **不做**：前端假进度、服务端预渲染大图、在请求内同步等 3D 生成。

## 6.4 可观测性（Observability）

| 信号 | 位置 | 用途 |
| --- | --- | --- |
| Agent 运行事件 | `agent_run_events` | 阶段、工具、耗时、错误、回放 |
| 生成台账 | `generation_jobs.usage`、`text_provider_calls`、`reconstruction_calls` | 供应商调用、token/积分、成本核对 |
| 对话留痕 | `conversation_turns` | 会话恢复与审计；不可用不影响主流程 |
| 业务日志 | Edge Function 结构化日志 | `generation_busy`、供应商错误、状态转换 |
| 健康检查 | `GET /health` | 版本与 schemaVersion |
| 前端诊断 | `lib/diagnostics.ts`、`lib/turn-trace*.ts` | 轮次失败、工具轨迹、导出诊断 |
| 发布证据 | `snapshotId` / `contentFingerprint` | 交付物与画布是否同一版 |

**缺口（明确）**：没有 Prometheus/Grafana 指标、没有分布式 Tracing、没有统一告警面板。当前靠数据库事件表 + 平台日志 + 发版门禁；规模上来后需要补指标与告警。

## 6.5 可用性与降级（Availability & Degradation）

- **静态页/离线快照**：后端不可用时仍能打开已下载的 `/view#s1=` 快照；这是最重要的演示降级路径。
- **供应商不可用**：返回 503/502 并保留场景；不生成假资产、不伪造进度。
- **数据库不可用**：编辑与保存不可用；前端保留草稿，明确提示「未存盘」，不显示已保存。
- **对象存储不可用**：已缓存/本地资产仍可看；云端资产加载失败明确报错，不静默空白。
- **单点**：Postgres 是单区域单主；没有跨区多活。灾备见 §7.3。
- **不承诺**：99.99% SLA、跨区域故障自动切换。

---

# 七、部署与运维（Deployment & DevOps）

## 7.1 基础设施（Infrastructure）

```text
GitHub（main）
  ├─ Cloudflare Pages：构建 frontend/out → 静态托管 + 自定义域名
  │    └─ Pages Functions：/api/amap-*、/api/tdt-*、/api/carto-*、/api/place-*、/api/site-context ...
  ├─ Supabase：Postgres + Auth + Storage + Edge Functions
  │    ├─ 5 个 Function：scene-api / conversation-api / pay-api / generation-worker / reconstruction-worker
  │    ├─ pg_cron + Vault：定时任务与 worker secret
  │    └─ 61 个迁移（按序应用；rollback/ 备用）
  └─ Cloudflare R2（可选）：SCENE_STORAGE_DRIVER=r2 时整体替换存储方法
```

- **不用 Docker / K8s / Helm**：前端是静态产物，后端是托管函数与托管 Postgres；团队规模不需要容器编排。
- 环境变量分两处：根 `.env.local` 给脚本与 Edge Functions；`frontend/.env.local` 只放公开配置。密钥不入前端构建。
- Cloudflare 构建必须从仓库根目录执行，因为前端会 import 根目录的 `supabase/functions/_shared/*`；根依赖必须安装。
- 公开配置（Supabase publishable key、高德 key）可内联进构建；service role、供应商 key、worker secret 绝不内联。

## 7.2 CI/CD 流程

| 阶段 | 动作 | 门禁 |
| --- | --- | --- |
| 提交 | Conventional Commits；按明确路径 `git add` | `git status` / `git diff --stat` 自查 |
| 类型 | `npm run typecheck`；`npm --prefix frontend run typecheck` | 0 错 |
| 单测 | `npm test`（根，PGlite 跑迁移/RPC）；`npm --prefix frontend run test` | 全绿或明确记录已知红条 |
| 静态检查 | `npm --prefix frontend run lint` | 0 错 |
| Edge | `npm run check:edge`（deno check 5 个函数） | 0 错 |
| 构建 | `npm --prefix frontend run build` | 产出 `frontend/out` |
| 发版 | `npm run gate`；CHANGELOG 校验；按 [64](64-部署与发布手册.md) 顺序推迁移/函数/前端 | 失败不发布 |

- 推 `main` 触发 Pages 生产构建；其他分支触发预览构建。
- 数据库迁移、Edge Function、Secrets、Auth 目前是**手动/脚本化部署**，不是全自动流水线；上线顺序以 64 为准。
- 回滚：迁移目录有 `rollback/`；前端回滚用 Pages 历史版本；存储驱动切回 `supabase` 即可回滚 R2。

## 7.3 灾备方案（Disaster Recovery）

| 资产 | 备份/恢复 | 现状 |
| --- | --- | --- |
| Postgres | Supabase 平台备份/时间点恢复（按套餐） | 依赖平台；仓库无自建备份脚本 |
| 对象存储 | 内容寻址 + 不覆盖；R2/Supabase 各自持久化 | 仓库无跨桶复制脚本 |
| 发布/分享 | 不可变 publication + token 哈希 | 可重建链接，但旧 token 不可恢复 |
| 前端 | Git + Pages 构建产物 | 可从任意提交重建 |
| 迁移 | 正向 SQL + `rollback/` | 需按序执行，未做自动回滚演练 |

**未验证项**：没有做过跨区域故障切换演练；没有 RPO/RTO 承诺。对外不宣称「异地多活」。

---

# 八、架构决策记录（ADR）

> 只记录「为什么选 A 不选 B」。后续开发者先读这里，减少重复争论。

## ADR-01：静态前端 + 托管 Postgres/Edge Functions，不上 K8s/微服务

- **背景**：团队小、单区域、工作室级 SaaS；核心是重客户端编辑器与强一致的项目保存。
- **决策**：Next.js 静态导出 + Cloudflare Pages；Supabase Postgres/Auth/Storage/Edge Functions；不拆微服务、不用 gRPC、不上 K8s。
- **后果**：运维面小、部署快、成本低；代价是受平台限制（函数时长/内存、单主库），大规模多区域需要重做。

## ADR-02：Postgres 当队列 + `pg_cron`，不引入 RabbitMQ/Redis

- **背景**：生成/重建任务是低频、长耗时、必须可恢复；任务量远小于消息中间件场景。
- **决策**：任务表 + `FOR UPDATE SKIP LOCKED` + worker token/租约 + `pg_cron`；状态与业务数据同库同事务。
- **后果**：少两个中间件、无跨存储一致性；代价是轮询有延迟（分钟级）、数据库承担队列压力；任务量上来再评估专用队列。

## ADR-03：Agent 提案制，不直接写画布

- **背景**：模型输出不确定；活动方案改错代价高；需要可撤销、可复核。
- **决策**：Agent 只产出候选与提案；绑定 revision/场景哈希/租约代次；人确认后一次事务应用；过期不应用。
- **后果**：多一步确认、交互稍慢；换来可回滚、可审计、不会静默破坏用户方案。

## ADR-04：3DGS 只提供观感，几何由 GLB/矢量壳承担

- **背景**：3DGS 观感好但不可量、不可碰撞；活动执行需要真实尺寸。
- **决策**：`.spz/.ply` 只做背景与天光；量尺、贴地、碰撞、净空由 GLB、V2 结构层与几何基线承担。
- **后果**：不把「看起来对」卖成「量得准」；代价是两套资产要同时维护与对齐。

## ADR-05：单一场景契约 v1/v2，严格校验，不做多套 wire schema

- **背景**：前端内部模型、后端存储、Agent 候选、分享快照都涉及场景；多套 schema 必然漂移。
- **决策**：`domain.ts` 唯一真源；`schemaVersion` 判别联合；`strictObject` 拒绝多余字段；适配层负责 `RoomLayout` ↔ `Scene`。
- **后果**：升级要显式迁移；换来跨端一致、错误早暴露。

## ADR-06：服务端集中鉴权，不做浏览器直连 RLS

- **背景**：浏览器直连表 + RLS 容易把权限散落到客户端；分享需要匿名读取；worker 需要独立身份。
- **决策**：业务表放 `scene_private`，撤销 `anon/authenticated`；只有 `service_role` 调 RPC；Edge 验证 token 后传 actor；匿名只开 `/share/read`。
- **后果**：所有访问走 Edge，函数是必经之路；换来权限集中、可审计、无浏览器旁路。

## ADR-07：分享双轨——离线快照 + 云端 token

- **背景**：客户常在微信里打开；演示不能依赖登录；正式交付需要撤销与权限。
- **决策**：离线 `#s1=` 快照（无后端、体积上限明确）+ 云端发布 token（哈希存储、5 分钟资源 URL、可撤销）；两者不合并成一套协议。
- **后果**：两套实现与两套测试；换来「随时能看」与「可控交付」并存。

## ADR-08：失败显式，未知保留，不伪造生成结果

- **背景**：付费生成/重建一旦自动重试可能重复扣费；假成功会污染方案与账单。
- **决策**：`submit_unknown` / `PROVIDER_RESULT_UNKNOWN`；未知占并发位；人工核对后解除；前端显示未知，不显示成功。
- **后果**：需要人工运维窗口；换来不重复付费、不把错误数据写进方案。

## ADR-09：几何基线只读，换算放 `lib/`

- **背景**：米制尺度、贴地、朝向是历史方案的隐性契约；就地改基线会让所有旧方案悄悄漂移。
- **决策**：`three/scan-placement.ts`、`three/furniture-builders.ts` 禁改；新行为在 `lib/` 加换算/选择器；导出链路 5 个文件为独占区。
- **后果**：改动不如「直接改基线」快；换来历史方案稳定、回归可定位。

## ADR-10：两个入口、一张任务表，小程序不做编辑器

- **背景**：现场采集需要手机相机与微信分享；编辑需要大屏与精确操作。
- **决策**：小程序只做采集/上传/查看/提交；编辑在 Web；两端共用账号与任务表；任务号在两端 URL 透传。
- **后果**：两端要同步契约；换来现场体验与编辑能力各自最优，不用在一个端里塞全部能力。

---

# 附录 A：当前边界与未验证项

| 边界 | 说明 |
| --- | --- |
| 端到端状态 | Golden Path 仍以「待复测」口径管理；未在 staging 跑完一整条前，不对外说「能演示」。以 [04](04-Golden-Path-规格与实测.md) 为准。 |
| 发版基线 | 以 [03](03-测试与构建健康度.md) 与 `npm run gate` 的当日结果为准；本文不把历史红条当当前结论。 |
| 3DGS | 只提供观感；不能当量尺或碰撞体。 |
| 采集 | 不达标就重建不出来；西湖历史素材 0/32 坐标、覆盖 102.6°，判定不可用。 |
| 云端资产 | 仓库有迁移与函数源码，各环境是否已部署需确认；未上云本地资产阻止云端保存（`LOCAL_ASSET_NOT_UPLOADED`）。 |
| 移动端 | ≤768px 是紧凑版，部分桌面面板能力受限。 |
| 导出 | 不支持完整场景预设与建筑入口扩展；这两类明确拒绝，不做降级。 |
| 协作 | 租约串行，不是实时多人；没有 CRDT/OT。 |
| 列表 | 项目/资产固定最近 100 项，无分页 UI。 |
| 支付 | 未配置凭据时 mock；前端必须显示 `mode=mock`。 |
| 观测 | 无 Prometheus/Tracing/告警面板；靠事件表与平台日志。 |
| 灾备 | 无跨区演练、无 RPO/RTO 承诺。 |

# 附录 B：关键文件索引

| 位置 | 作用 |
| --- | --- |
| `supabase/functions/_shared/domain.ts` | 场景/请求/错误契约唯一真源 |
| `client/scene-client.ts` | 前后端契约客户端 |
| `supabase/functions/_shared/api.ts` | 路由、认证、CORS、错误映射 |
| `supabase/functions/_shared/agent-runner.ts` | Agent 工具循环 |
| `supabase/functions/_shared/agent-progress.ts` | 四阶段定义（`survey/locate/compose/deliver`） |
| `supabase/functions/_shared/worker-handler.ts` | 生成任务 worker |
| `supabase/functions/_shared/reconstruction-handler.ts` | 矢量壳重建 worker |
| `supabase/functions/_shared/backend.ts` | RPC/存储/Realtime 基础设施 |
| `frontend/components/room-organizer/hooks/use-layout-store.ts` | 编辑器状态 |
| `frontend/components/room-organizer/lib/plan-export/` | 图册/CSV/DXF/打印 |
| `frontend/lib/share-snapshot.ts` | 离线分享快照编解码 |
| `frontend/components/room-organizer/three/scan-placement.ts` | 几何基线（只读） |
| `supabase/migrations/` | 61 个迁移；`rollback/` 备用 |
| `docs/64-部署与发布手册.md` | 迁移/函数/Secrets/Auth 上线顺序 |

# 附录 C：术语

| 术语 | 含义 |
| --- | --- |
| 3DGS / Splat | 3D Gaussian Splatting；观感层实景，不提供精确几何 |
| 矢量壳 | 墙、门窗、柱、尺寸构成的 V2 结构层；承担量尺与碰撞 |
| 租约 / generation | 编辑权与代次；防止旧请求复活 |
| 提案 / proposal | Agent 候选方案；确认后才应用 |
| 快照 / snapshot | 某一版场景的不可变编码；带内容指纹 |
| 发布 / publication | 云端不可变版本；分享基于它 |
| `submit_unknown` | 供应商提交结果未知；不自动重试付费任务 |
| LOD | 3DGS 多档细节；首屏粗档、按距离换档 |
| GLB 归一化 | Y-up、贴地、水平居中、按目标尺寸缩放 |
| JEV | 方案评价/校验的结构化结果（候选审查用） |

---

> 维护口径：架构变化先改本文对应章节，再改代码；如果本文与 01–04 的现状结论冲突，以 01–04 为准，并回来修正本文。本文不替代部署手册（64）、API 契约（13）与后端设计（14），只提供全局视图与决策理由。
