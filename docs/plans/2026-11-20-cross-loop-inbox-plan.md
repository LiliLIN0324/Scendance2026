# 三线合流计划：执行资料 × Bingo 评审 × 消息收件箱（2026-11-20）

> 口径：本轮只做计划与现状核对，未在本计划内改代码、未提交、未部署。
> 关联文档：`2026-11-20-execution-data-agent-mapping.md`（执行资料 × Agent 字段对照）。
> 边界：不另起并行 wire schema；台账与本机条目留本机；跨设备持久化走后端 role B review PR；Agent 只起草不落盘。

## 一、现状基线（fetch origin/main 后实测）

### 1.1 远端 main 已合入（32 提交，本地落后 32、领先 0）

- **云存储收口**：私有归档 → 案例发布 → 目录/查看/另存 → 完整只读分享 + 撤销；`cloud_check_manifest_access` 复核资源权限。本地测试层 E2E 成立；review SQL 仍待人审/部署，线上未验。
- **Agent 自主规划闭环**：监督档位（自动应用 / 等确认）、动作风险守卫、锁定件/身份/楼层/需求/版本守卫；网页与附件资料接入、场地研究、自动范围提案、人数变更识别。
- **人物登记表**统一去重、按岗位性别落地。
- **户外**：B1 可布置域计算、D2 八类活动模板注册、婚礼户外布置起稿 + 一键载入 + 物料 BOM、布局权重证据分级。
- **参赛报告页**：真实截图/资产迭代对比，手动摆放写回 `sourceAssetId`。

### 1.2 远端未触碰（仍是我们的待做项）

- 执行资料面板本体、核对视图、入口收拢。
- Bingo 钉评状态回写、回执上云、创作者审校动作、意见落地通道。
- 协作邀请 RPC、多方案过程态存档。

### 1.3 本地工作树状态（开工前必须甄别）

- 工作树脏：约 60 个 tracked M/D + 大量未跟踪临时产物（`.tmp-*`/`.verify-*`/`.g1-reports/` 等，不可入库）。
- **消息线为另一 agent 未提交 WIP**：`messages-panel.tsx`、`rail-messages-button.tsx`、`official-notices.ts`、`messages-panel.css`/test、`official_notices` 迁移均未跟踪；远端只有私信线程（`team-messages.ts`、`member-chat.tsx`、`workspace-api.ts` 已合入）。对接只留接口与挂载点，不重写、不代提交这份 WIP。
- 本轮本人改动仅：`agent-panel.tsx` / `agent-panel.css` / `agent-panel.react.test.tsx`（收入口）+ 本计划与对照表两份文档。

### 1.4 前置核查结论（2026-11-20 实测，只读）

- **分支位置**：HEAD `81d7824e`，`origin/main` `3730ff7b`，behind 32 / ahead 0；本地无独有提交。
- **重叠面**：本地已改且远端 32 提交也改过的文件 38 个；剔除 `docs/evidence` 探针/快照后，代码重叠约 17 个（户外覆盖层/工作流卡、云面板、素材库、分享菜单/面板、`room-organizer.tsx`、`backend-session.ts`、`package.json`、`api.ts`/`backend.ts`、`fixtures.ts` 等），多为并行批次在途 WIP，不能代提交或丢弃。
- **我这条线的改动已与别人 WIP 同文件混杂**：主树 `agent-panel.tsx` 除我删除的 `.ap-delivery-entry` 按钮块外，还叠着户外工作流卡的 hunk（`beforeLatestQuestion`、`!waitingOutdoorReply && outdoorWorkflowCard`）；3 文件为 staged + 工作树双份改动，无法在主树干净剥离。
- **运行时**：当前 shell Node `v22.23.2`，`.nvmrc` 要求 `24.15.0`，PATH 无 nvm/fnm/volta；主树 `node_modules` 与 `frontend/node_modules` 已装。版本不符是验收风险点，前端单测/typecheck 前需先切到 24.15。
- **核对视图可复用资产（origin/main 版本）**：B1 任务缺口可复用 `lib/event-operations.ts` 的 `operationObjectReview(layout, task)`（物件缺失/歧义）与 `operationReview(...)`；负责人/验收条件/计划时间空值需读字段判定。B2 工单、B3 计划、B4 点验的缺口判定**无现成纯函数**，需从各面板现有校验抽取或新写。

## 二、第一性原理：三条线收进同一个「待回应条目」

剥掉界面后，私信、公告、邀请、Agent 疑问、甲方钉评、方案存档提示，本质都是一条 **需要某人回应或拍板的异步条目**。差异只在来源、动作落点和是否跨设备。

### 2.1 条目契约（前端适配层形状，沿用既有 workspace-api 风格，不另起 wire schema）

```text
InboxItem {
  id: string
  kind: 'team' | 'notice' | 'invite' | 'agent-question' | 'review-pin' | 'saved-draft'
  title: string
  summary: string
  status: 'pending' | 'done' | 'read'
  createdAt: string
  unread: boolean
  source: {
    panel: 'messages' | 'bingo' | 'delivery' | 'plans' | 'account'
    refId?: string
    focus?: { objectId?: string; x?: number; z?: number }   // 回跳画布定位
  }
}
```

- **消息面板**负责：聚合各 source 条目、红点计数、列表展示、点开跳转；不替业务落盘。
- **各业务面板**负责：条目产生、动作落盘、状态回写、失效清理。
- **后端**负责：跨设备持久化与通知；本机自检条目先留本机。
- 红点复用既有监听器模式（`notifyUnreadChanged` / `notifyOfficialChanged`）：状态变化喊一声，左轨红点跟着刷新。

### 2.2 分流原则：什么进收件箱，什么留原地

| 条目 | 进收件箱 | 理由 |
|---|---|---|
| 团队私信 | 是（现状已有） | 跨人异步对话 |
| 官方公告 | 是（现状已有） | 只读通知 |
| 协作邀请 | 是（缺） | 必须本人接受/拒绝，强异步 |
| Agent 待确认疑问（如「先定 40 宾客，名单是否要问用户」） | 是（缺记录器） | 需拍板，结果回写台账 |
| 甲方钉评（Bingo 待处理） | 是（缺接线） | 需逐条审校闭环 |
| 本机台账缺口（无负责人/期限/验收条件） | **否**，留执行资料核对视图 | 本机自检、不跨人、不打扰；由 Agent 在对话里主动报 |
| 方案过程态存档 | **否**，独立「方案历史」台；收件箱只挂一条「已存 N 个过程态」摘要 | 存档是资源列表，不是待回应 |

## 三、分线目标、归属与依赖

### 线 A · 执行资料（沿用对照表 P0–P4）

| 编号 | 目标 | 归属 | 依赖 |
|---|---|---|---|
| A-P0 | 收入口：砍抬头常驻 pill，布置卡保留「导出与交接」触发点 | 前端（已改 3 文件，待验收） | 无 |
| A-P0 | 核对视图 B1–B4：任务/工单/计划/点验缺口一屏只读聚合 | 前端 | 复用既有契约校验，不新增录入 |
| A-P1 | 物件工单草稿（A2） | 丽丽出 runner 草稿，前端接预览/勾选/落盘读回 | 丽丽 |
| A-P2 | 制作计划草稿（A3–A5） | 同上 | 依赖 A1/A2 先行 |
| A-P3 | 点验约定数量草稿（A6） | 同上 | 现场事件仍纯人工 |
| A-P4 | 对话需求回灌台账（对照表第四节） | 丽丽抽取 + 前端回灌，条目标「来自对话，待核对」 | 前三段草稿结构就位 |

### 线 B · Bingo 评审闭环

现状六环断点：发链接（已接云端）→ 甲方匿名读快照（已接，真实环境待验收）→ 钉评写本机 + 上云（已接 append/list）→ **回执只写本机** → **创作者侧无审校动作、钉状态前端未接** → **意见不能转草稿/进 Agent**。

目标态：发链 → 钉评 + 回执上云 → Bingo 看未闭环钉并定位 → 逐条标已处理 / 转草稿 / 带进对话 → Agent 出草稿人确认落盘 → 钉 `resolved`、未闭环归零。

| 编号 | 目标 | 归属 | 现状/依赖 |
|---|---|---|---|
| B-1 | 钉评行加「标已处理」，接 `review_pins_set_status(p_share_key, p_id, p_status)`；未闭环计数驱动红点 | 前端 | RPC 已建（migration `20261118190000`），客户端 `review-pins-cloud.ts` 缺 set_status 封装；本机 `markPinResolved` 纯函数已存在但面板未调用 |
| B-2 | 意见「转任务/工单草稿」「带进 Agent 对话」，条目以 `kind=review-pin` 进收件箱 | 前端入口 + 丽丽定草稿形态与上下文 | 草稿不落盘，人确认后写台账 |
| B-3 | 评审回执上云：回执表 + append/read RPC，跨设备可读 | 后端 role B（review PR） | 前端不私改迁移/契约；`ReviewReturnRepository` 接口形状已预留 |
| B-4 | 分享页真实受控环境走查：钉评 → 回执 → 创作者读回 | 前端 + 真机验收 | 既有 G5 卡点，待真实云端环境 |

### 线 C · 消息 / 邀请 / 方案存档 / 疑问记录器（对应三张截图）

| 编号 | 目标 | 归属 | 现状/依赖 |
|---|---|---|---|
| C-1 | 协作邀请：发邀请 → 对方收消息 → 接受/拒绝加入项目 | 后端建邀请表/RPC（create/accept/reject/list pending）；消息面板加 `kind=invite` 条目与动作 | 后端先行；前端只接契约；未登录不伪造会话 |
| C-2 | 方案过程态存档：同活动 N 个过程态本机槽位（标题/时间/画布快照/备注），独立「方案历史」台可载入/深化 | 前端本机快照 | 云端版本槽位后续走后端；不塞私信 |
| C-3 | 疑问/核验记录器：把 Agent 已有 `acceptedDecisions`、`decision: needed/not_needed/unknown`、`needsClarification` 升级为持久待确认条目（提问、选项、确认/驳回/改写），确认结果回写台账对应字段，条目 `kind=agent-question` 进收件箱 | 丽丽定提问 schema 与起草口径；前端做列表与回写 | 复用既有 brief memory 决策字段，不新造状态 |
| C-4 | 收件箱适配层：注册位聚合 team/notice/invite/agent-question/review-pin/saved-draft；左轨红点汇总；跳转回各自面板 | 前端 | 只在 WIP 消息面板上留挂载点，不重写私信/公告结构 |

## 四、执行顺序与前置门禁

1. **前置（#6）**：先对齐 `origin/main`，逐 hunk 处理与远端重叠文件（已知同改 `agent-panel.tsx/.css/.test.tsx`、`share-menu`、`share-panel`、`backend-session`、`api/backend/domain`）；只 add 明确路径，不捎带并行半成品。
2. **先做不依赖后端的前端**：A 核对视图、B-1 标已处理（RPC 已存在）、C-2 本机快照台。
3. **再接需要契约对齐的**：B-2 / C-3 进 Agent；C-1 邀请等后端 RPC。
4. **验收**：每段本地 `npm --prefix frontend run typecheck` + `test` + `lint` + `build`，真机走查后一次性推 main；不频繁 push、不开 PR。
5. **不做**：不自动合并、不打 tag、不发 release、不部署；不把本机台账混上云端；不改独占五文件与几何基线（确需改动先走 COLLAB 待协商登记）。

## 五、待拍板项

- 方案过程态快照的粒度：整包场景 JSON / 局部布置变体 / 仅标注与方案名——建议先做整包本机快照，变体对比后置。
- 收件箱条目是否跨设备：邀请与甲方钉评需跨设备（走后端），Agent 疑问与本机缺口先留本机。
- B-2 钉评转草稿的条目形态（任务行 / 工单行 / 仅对话素材）：需丽丽与前端对齐接口形状后再落码。
