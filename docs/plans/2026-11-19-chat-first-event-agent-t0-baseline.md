# T0 现状与范围（2026-11-19 14:18）

计划正本：`docs/plans/2026-11-19-chat-first-event-agent-execution.md`
性质：只记录**当前代码实测**，不抄旧文档结论。未核实用「未核实」标注，不写成已确认。

## 0. 结论摘要

1. **目标站点跑的就是本地 HEAD**：Cloudflare Pages Production 最新部署 `Source = 76f6fed`（16 分钟前），与本地 `main` `76f6fed7` 完全一致；站点 HTTP 200。→ 「线上是旧版本」不是本任务阻塞项。
2. **主链路卡片只有一个渲染源头**：`outdoor-workflow-card.tsx`（1089 行）承载 place/scope/zones/main-routes/objects/sub-routes/people/refine-3d 八个阶段；确认类卡片在 `agent-confirm-cards.tsx`（Venue/Zone/Route 三张）。`agent-panel.tsx` 只是挂载点。
3. **重复状态有实测证据**（第 3 节 4 条），不是主观判断。
4. **两个硬缺口没有代码**：服务端网页检索 0 处、附件正文解析 0 处（`_shared/*.ts` 全文计数均为 0）。这两项必须新建能力，不能靠改提示词。
5. **没有个人级名册模块**：只有桌位/人数级（`table-seat-plan.ts`、`local-seating-draft.ts`、`_shared/agent-seating-layout.ts`）。T5 需要新真源，不能复用「工作人员岗位」冒充具名宾客。

## 1. 基线与目标站点

| 项 | 实测值 | 证据 |
| --- | --- | --- |
| 本地 HEAD | `76f6fed7`（2026-11-19 13:53:39 +0800） | `git log -1` |
| 分支 / 远端 | `main`，`origin/main = 76f6fed7`（0/0 同步） | `git ls-remote origin refs/heads/main` |
| 他人未提交改动 | `M docs/INDEX.md`、`M scripts/check-oneplan-artifacts.mjs`、`?? docs/plans/…` | `git status --porcelain` |
| 站点可达 | HTTP 200，`Server: cloudflare`，`Cache-Control: public, max-age=0, must-revalidate` | `curl -sSI https://scendance-scene-planner-ewz.pages.dev` |
| 线上版本 | Production 部署 `4a3a05eb…`，`Source 76f6fed`，16 分钟前 | `wrangler pages deployment list --project-name scendance-scene-planner`（清空代理变量后） |
| 登录态 | **未核实**：本轮无浏览器能力，未登录查看 | — |
| 部署历史 | 最近 1 小时内还有 `003c8f4`/`0cb6afe`/`291ef7e`/`54e1842` 四次 Production | 同上 |

推论（保守）：目标站点版本与本地一致，所以「改完看不到效果」只可能是缓存/预览域/登录态问题，不是部署落后。仍未做的是**登录后的真实点检**。

## 2. 卡片渲染入口盘点

### 2.1 `agent-panel.tsx` 里的挂载点（行号=当前 HEAD）

| 行 | 组件 | 条件 | 作用 |
| --- | --- | --- | --- |
| 4024 | `AgentTaskExamples` | 无气泡时 | 开场示例 |
| 4562 | `outdoorWorkflowCard`（局部变量） | `!bingo && outdoorBridgeReady && (!venuePick \|\| waitingOutdoorReply \|\| pendingPlan)` | 主工作流卡，**同一实例两处挂载** |
| 4693 | `Bubbles … beforeLatestQuestion={waitingOutdoorReply ? outdoorWorkflowCard : undefined}` | 等回复时 | 卡在气泡上方 |
| 4707 | `{!waitingOutdoorReply && outdoorWorkflowCard}` | 非等待时 | 卡在底部 |
| 4708 | `OutdoorThoughtRecord` | 无卡且有 venuePick | 思考记录（卡内也有同组件） |
| 4710 / 4728 | `RouteConfirmCard` | 无 venuePick + 有 routeProposal / 或 bridge 未就绪 | 流线确认（同一卡两种触发） |
| 4718 | `OutdoorTaskCard` | `outdoorTask && (!bridgeReady \|\| venuePick)` | 任务进度卡 |
| 4721 | `VenueConfirmCard` | 有 venuePick | 场地候选确认 |
| 4737 | `ZoneConfirmCard` | 无 venuePick/route + 有 zoneProposal | 分区确认 |
| 4745 | `ToolCallTrace` | layout 模式 | 过程/步骤行 |
| 4824 | `ProposalCard` | `proposed` | 方案提案 |
| 2128 | `CandidateInventoryPanel` | 物料候选工作区 | 物料候选 |

### 2.2 `outdoor-workflow-card.tsx` 内部结构

| 行 | 内容 | 说明 |
| --- | --- | --- |
| 13 | `STAGE_CAPTIONS`（8 阶段文案） | place/scope/zones/main-routes/objects/sub-routes/people/refine-3d |
| 61 | `StageThumb`（自绘 SVG 缩略） | 注释自述「不声称是真实轮廓」 |
| 340 | `pendingPlan` 分支：「待批准计划」+「批准并执行」 | 即「每个动作都要批准计划」的落点 |
| 414 | `<StageThumb …/>` | 阶段缩略出现在卡内 |
| 604/640/650/770/780/850 | 「搜索地点」「在地图上手画活动范围」「在地图上手画分区」按钮 | 即常驻闯关入口 |
| 913 | 手画时逐分区出小卡 | 分区清单 |

## 3. 重复状态：4 条实测证据

1. **同一张主卡在两个位置跳**：`agent-panel.tsx:4693` 与 `:4707` 挂的是同一个 `outdoorWorkflowCard`，靠 `waitingOutdoorReply` 互斥切换——用户在等待/非等待之间看到卡从底部跳到气泡上方。
2. **同一阶段四份描述同屏**：阶段缩略 + caption（卡内 414）＋ `OutdoorTaskCard`（4718，intent/steps）＋ `ToolCallTrace`（4745，processText/stepLog）＋ 气泡文本（4693），都在讲同一轮进度。
3. **占位插画**：`StageThumb`（61）是固定示意 SVG（注释=不声称真实轮廓），在 414 渲染；计划 §3「无实际成果的地图插画/占位图」指的就是它。
4. **失败卡确证存在**：`agent-confirm-cards.tsx:31`「没搜到候选场地。换个说法再说一句，或点右栏「地图选址」手动圈。」、`:62`「都不是，换个说法」——只给「换句话」、不给失败环节与可行下一步。

## 4. 计划 §3 清单 → 代码落点

| 计划项 | 现状 | 落点 |
| --- | --- | --- |
| 常驻闯关卡 | 存在 | `outdoor-workflow-card.tsx:604/640/650/770/780/850`，改为对话触发、工具留高级入口 |
| 无成果插画 | 存在 | `StageThumb` 61 → 用真实候选/预览替换（414） |
| 同阶段重复 | 存在（第 3 节） | `agent-panel.tsx:4693/4707` + 4718 + 4745 合并成一个当前状态 |
| 每动作都要批准 | 存在 | `outdoor-workflow-card.tsx:340-354` + `ProposalCard`(agent-panel 4824) |
| 「换个说法」错误卡 | 存在 | `agent-confirm-cards.tsx:31,62` |
| 固定推荐按钮 | 未核实 | 待 T1 在 `agent-confirm-cards.tsx` 候选渲染与 `venue-picker.tsx:344` 复核 |
| 场地推荐卡 | 有雏形 | `VenueConfirmCard`（agent-panel 4721） |
| 资料理解卡 | **无** | 新建；依赖 §5 G2 附件解析 |
| 场地范围卡 | 有雏形 | workflow card scope 阶段（574/633） |
| 方案预览卡 | 有 | `ProposalCard`（4824）+ `ZoneConfirmCard` |
| 人员与座次卡 | 只有人数/桌位 | `table-seat-plan.ts`、`local-seating-draft.ts`；个人级见 G3 |
| 物料清单卡 | 有候选面板 | `CandidateInventoryPanel`（2128）；按区分类/数量/来源未核实 |
| 待解决事项卡 | 未核实 | 待 T1 复核 `outdoor-task-card.tsx` blocked 分支 |
| 成果与过程记录卡 | 未核实 | 待 T6 复核导出与版本入口 |

## 5. 能力缺口 → 具体代码入口

| 编号 | 缺口 | 现状证据（实测） | 落点 | 批次 |
| --- | --- | --- | --- | --- |
| G1 | 产品内网页检索 | `_shared/*.ts` 全文 `web_search\|serper\|tavily\|customsearch` 命中 **0** | 新建 Edge Function + `_shared/` 契约；现有 `agent-place-search.ts`、`lib/place-search.ts` 只做地图地点 | T2 |
| G2 | 附件正文/图像解析 | `_shared/*.ts` 里 `mammoth\|pdfjs\|pdf-parse\|xlsx` 命中 **0**；`lib/` 无 `*attach*` 模块 | 新建上传→提取管线；`_shared/brief-extract-contract.ts`(33KB) 可复用契约风格 | T2 |
| G3 | 个人级名册 | 无 `roster.ts`/`guest*`；只有 `_shared/user-attendance.ts`(2.9KB)、`seating-allocation.ts`(4.4KB)、`lib/local-seating-draft.ts`、`table-seat-plan.ts` | 新建名册真源（稳定人员编号/关系/状态），不塞进 brief 长文本 | T5 |
| G4 | 卡片重复与位置跳 | 第 3 节 1/2 条 | `agent-panel.tsx:4693/4707`、4718、4745 | T1 |
| G5 | 占位插画 | 第 3 节 3 条 | `outdoor-workflow-card.tsx:61,414` | T1 |
| G6 | 闯关卡常驻 | 第 3 节 4 条前半 | 上述 6 处按钮 | T1 |
| G7 | 审批过密 | `outdoor-workflow-card.tsx:340`「批准并执行」 | 同上 + `ProposalCard` | T1 |
| G8 | 失败卡无出路 | `agent-confirm-cards.tsx:31,62` | 同上 | T1 |
| G9 | 场地事实有来源但无「资料引用」层 | `venue-facts-storage.ts:5-6` 每事实带 `source/status/uncertainty/sourceRef/revision`，**但只覆盖 6 个尺寸类事实**，无文件页码/表格行 | `lib/venue-facts.ts`(108) 扩展或新项目级资料引用表 | T1 |

## 6. 数据归属图（现有真源）

| 事实类别 | 真源模块 | 持久化 | 备注 |
| --- | --- | --- | --- |
| 活动简报 | `frontend/lib/event-brief.ts`(388) + `_shared/turn-brief.ts`、`brief-extract-contract.ts` | 本机 `scendance.assistant-brief-memory.v1` | 长文本型，非结构化事实表 |
| 场地事实（尺寸类） | `lib/venue-facts.ts`(108) + `venue-facts-storage.ts`(71) | `scendance:venue-facts:v1:<encodeURIComponent(scope)>` | 6 键 + revision + status + sourceRef；面板挂载已于 2026-11-17 摘除（组件休眠） |
| 空间方案 | `_shared/site-plan.ts`(32KB) schema | `scendance-outdoor-plan-v1:<projectId>`；指针 `scendance-outdoor-last-v1`；迁移标记 `scendance-outdoor-plan-activity-adopted-v1` | 按活动隔离，2026-11-17 起 |
| 名册 / 座位 | `_shared/seating-allocation.ts`→`lib/seating-allocation.ts`(再导出)、`table-seat-plan.ts`、`local-seating-draft.ts`、`_shared/agent-seating-layout.ts` | 并入方案对象，无独立 key | 仅桌位/人数，无具名个人 |
| 流程/岗位 | `lib/event-operations.ts`(125) + `_shared/event-operations-contract.ts` | 未核实 | 岗位级 |
| 物料 | `lib/material-candidates.ts`、`assets/library/*.glb`、`_shared/material-checkin-contract.ts`、`material-variants.ts` | `scendance:facility-generated-models` | GLB 库为真实物料源 |
| 商业资料 | `_shared/commercial-dossier-contract.ts`(26KB)、`delivery-contract.ts` | 未核实 | — |
| 附件 | **无** | — | G2 新建 |

## 7. T0 退出条件自查

- 每个缺口是否都有具体代码入口？**是**（第 5 节 G1–G9 均给出文件/行）。
- 是否有「复制旧文档当现状」？**无**：第 1、2、3、5、6 节数值均来自本轮命令输出。
- 保留项：目标站点**登录态未核实**；§4 有 3 行标「未核实」（固定推荐按钮、待解决事项卡、成果记录卡）。这三项不影响 T1 开工，列入 T1 首轮复核。

## 8. 本轮未做（如实）

- 未登录目标站点、未截图（无浏览器能力，按纪律不用相邻工具伪造）。
- 未跑任何测试（T0 是只读盘点，无非等价验证需求）。
- 未改任何产品代码；只新增本文档与台账条目。
