# AIHOT 源码学习与幕景采用范围

2026-10-10。研究与首项实施范围已确认；本记录不代表产品改进已经完成。第一项由现有前端 owner 实施，后端状态和应用契约保持原语义。第二项为后续候选，尚未授权接入模型或发送本机执行资料。

## 目标与固定来源

本阶段目标是从真实源码中采用一项幕景尚未具备的机制，经过旧行为复现、相关回归和可使用的界面路径验收。首项确定为：**有效候选已保留、后续处理却中断时，普通 Agent 模式也能清楚告知用户。** 克隆或完成本记录不算这个目标完成。

- 仓库：[KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT/tree/8ef28ebcd167b311ffab8c0308181e2912262ae2)。实际克隆到 [参考副本](C:/幕景/upstream-references/AIHOT)，detached HEAD 为 `8ef28ebcd167b311ffab8c0308181e2912262ae2`，提交时间 `2026-10-09T18:29:56+08:00`，标题“补齐公开分类的接入说明和一致性验证”。核查时工作树为空。
- 许可：[固定版本 LICENSE](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/LICENSE)，MIT，Copyright (c) 2026 数字生命卡兹克。若复制实质代码，保留版权及许可；不采用 AIHOT 品牌与运营数据。
- 之前的 c547 基线及已采用机制见 [Agent 接入记录](C:/幕景/Scendance2026/docs/plans/agent-reference-study.md)。导演另行核过 c547 到本提交的差异；本轮负责完整业务链路及幕景适用性，不重复差异审计。
- 本轮使用 agent-reach 的 GitHub CLI，实际读取源码、测试、README、AGENTS 和架构说明。未安装上游依赖、运行安装脚本、启动服务、执行迁移或调用模型。上游测试只读，没有运行；不将其 README 的性能数字作为本轮验证结果。

## 实际业务链路及可采用原则

AIHOT 是行业资讯处理与发布框架。它通过 worker 处理业务，多个出口读取已保存结果；读网页不会触发模型。这里采用它的软件机制，活动策划及现场验收仍依据 [专业 Skill 来源记录](C:/幕景/Scendance2026/docs/plans/professional-skill-basis.md)，不从资讯评分或运行参数推导施工标准。

| 链路 | 实际函数与固定源码 | 对幕景的判断 |
| --- | --- | --- |
| 路由与领取 | [queueProcessing / processArticle](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/jobs/content.ts#L68)，[worker 注册](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/apps/worker/src/main.ts#L21) | 幕景已有 queued/running、单次领取、期限与取消；没有证据要求移植 pg-boss 或另建编排器。 |
| 模型响应与业务消费 | [paidRequest](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/providers/receipts.ts#L122)先把原始响应存为 received；[analyzeArticle](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/editorial/analyze.ts#L507)在写 analyses 的同一事务完成回执 | 原始响应持久复用与 run 内工具回执是两层机制。幕景当前不保证整条模型对话跨进程续跑，不能把已有回执说成完整实现，也没有本轮需要新增整套 receipt 的现行流程证据。 |
| 当前输入围栏 | [analyzeArticle](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/editorial/analyze.ts#L508)锁当前 revision，旧分析留历史但不推进新输入；[digest 写回](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/events/digest.ts#L76)再次比版本及证据 hash | 幕景 Scene 候选已有基线、编辑租约与失效保护；新活动任务建议应延续同一规则，见候选 2。 |
| 人工更正 | [overrideFields](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/admin/content.ts#L231)核版本，人工字段优先进入[发布投影](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/publication/publish.ts#L289)；[manualDecision](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/events/group.ts#L143)保护人工归属 | 不把所有派生文字都泛称“永不重写”；digest 的 origin=manual 明确保护的是标题。幕景现有人工活动资料与评审冻结已有对应保护。 |
| 读取与故障观察 | publication 共用读取层，[story-text](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/publication/story-text.ts#L44)核证据后隐藏失效综述；[runsOverview](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/admin/runs.ts#L16)和[运行界面](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/apps/web/app/routes/admin/runs.tsx#L125)分别保留状态、错误和需核对的结果 | 有成果与有错误可以同时成立。幕景后端已经表达这个事实，普通模式终态展示还未接完整，见首项。 |

付费恢复政策须按当前源码理解：[请求层](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/providers/receipts.ts#L160)阻止 unknown 立即重发，但 [recover](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/operations/recover.ts#L41)会在 30 分钟后自动放行一次，第二次未知等待管理员。不能沿用“该上游永不自动重发”的旧概括；幕景本轮不采用这项付费重试政策。

相关上游测试依据是 [analyze-consistency](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/tests/analyze-consistency.test.ts#L62) 的业务提交失败/回执保留，[receipts](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/tests/receipts.test.ts#L253) 的一次自动放行，以及 [content-publication](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/tests/content-publication.test.ts#L408) 的人工改版与证据变化。这些是源码中的用例，本轮没有重新执行。

## 候选 1：普通模式保留候选时仍显示处理中断（确定实施）

### 当前可证明的缺口

后端已有有意保留成果的终态：[agent_rpc fail](C:/幕景/Scendance2026/supabase/migrations/20261003200000_agent_runs.sql:73)在存在 checkpoint 候选、且错误不属于权限或版本失效时，返回 `state=complete`、非空 candidates、errorCode，以及“执行中断，原场景与有效方案已保留”的 progress。期限结束也可能保留候选。[checkpoint 提交后响应丢失用例](C:/幕景/Scendance2026/tests/agent-runs.test.ts:179)明确期望 complete + DATABASE_ERROR + 1 candidate，并断言 progress 不是“方案已准备好”。

前端 [consumeRun](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx:700)只在无候选分支使用 errorCode。有候选时准备预览，随后显示普通方案说明，没有呈现中断原因。[处理中 progress](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx:1308)随 busy 结束消失；[evaluation.message](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx:1310)只在 JEV 候选区显示。默认关闭 JEV 的用户因此能看到候选，却不知道后续步骤中断。

这不是“候选没保存”或“没有查询恢复”：保存、原 requestId 查询和后端错误字段已经存在。源码路径和既有故障 fixture 足以证明展示缺口；本轮未再跑该 fixture，也尚未做新的前端红绿回归。

### 最小实施与用户可见结果

唯一实现 owner 为当前前端 owner。预计只涉及 [creative-studio.tsx](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx) 与 [其 React 回归](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.react.test.tsx)。复用当前 run.errorCode、候选和 notice/消息展示，不增加 API 字段、数据库表、迁移、依赖或运行后台。

终态有候选且带 errorCode 时，界面持续说明“后续处理已中断，当前候选已保留”，并让用户继续核对已有候选；如果显示错误原因，采用固定友好文案或受控错误类别，不回显供应商正文或参数。当前直接应用、预览确认、JEV、过期与租约校验保持原策略，提示在直接应用后也可见；不能因为加入提示自动取消有效成果或重新生成。

### 验收及可试路径

在同一明确的演练活动里，场景策划关闭 JEV，通过本地测试响应或故障注入返回已保存候选及 DATABASE_ERROR，再从正常发送和“查询原任务”两条入口完成读取。故障演练不修改用户现场资料，不在真实供应商或生产数据库制造失败。

1. 默认预览：complete + errorCode + 1 candidate，显示中断提示，候选仍可预览；原场景未改变。
2. 明确指令直接应用：沿原策略完成应用，中断提示仍可读，普通“已应用”消息不遮掉它；不改变应用次数。
3. 原任务恢复：GET 返回上述终态，提示与候选仍可见，POST 次数不增加，终态不继续阻塞发送。
4. JEV partial 保留既有说明、不编概率；无候选失败、取消、正常完成保持原行为。
5. 结果读取期间改场景/需求或切活动，原有旧候选保护继续成立，提示不能挂到另一活动的新任务上。

实施验收须含至少一个旧实现失败、新实现通过的前端回归、相关类型与检查；构建使用导演安排的固定基线副本，不触碰主 .next。实际演练应看见终态提示和候选/应用结果，分别记录本地替身验证与真实模型边界。报告及整版提交由导演统一安排。本记录作者没有修改这两份前端文件。

## 候选 2：只读活动上下文与人工接纳任务草稿（后续）

当前 [agentContextSchema](C:/幕景/Scendance2026/supabase/functions/_shared/agent-contract.ts:6)和 [buildAgentContext](C:/幕景/Scendance2026/frontend/lib/assistant-context.ts:69)只承载 brief、已确认物料决定、对话和最近提案说明；工具仍处理 Scene。活动任务入口是[人工 add 与演练模板](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/event-operations-panel.tsx:230)。因此“根据已保存活动安排提出待办草稿，并逐项确认加入”尚未实现。这是新业务能力；本机执行资料目前不发送属于既有隐私边界。

可借鉴上游“结果绑定当前输入、人工更正优先”的机制。建议先在本机用合成建议验证契约：选定活动的只读白名单摘要 + 输入指纹 + 来源标签 → 待确认建议 → 人工选择后仅追加新任务草稿。摘要仍从当前 RoomLayout/EventOperations/点验真源读，复用 [operationReview](C:/幕景/Scendance2026/frontend/components/room-organizer/lib/event-operations.ts:91) 的有效状态判断，不另建一份活动任务数据。

最小后续试验可由新纯函数及其测试负责建议校验、过期判断和追加；界面接入由前端 owner 负责，在现有任务入口复用 [createOperation](C:/幕景/Scendance2026/frontend/components/room-organizer/lib/event-operations.ts:105) 及原更新/保存链路。先不改冻结的 EventOperations 共享 schema。模型输入披露范围、建议允许字段与 provenance 结构由导演确认后再设计；纯函数演练不代表 Agent 或真实模型已接通。

验收应覆盖：发送前展示选定摘要；未确认不写任务；人工改资料或切活动后旧建议失效；确认仅追加 todo 草稿，原任务和原 ID 不变；不自动填实际时间、验收状态、现场证据或点验数量；保存失败保留建议与原资料，重试不重复添加；保存重开和原时间表导出读取同一新增任务。场景建议继续调用 [preserveCurrentActivity](C:/幕景/Scendance2026/frontend/lib/production-plan.ts:56)，保留人工活动资料。联系人、合同、签收证据与私人照片不因本候选进入模型。

## 明确排除与验证边界

- 已采用的回复批次 ID 校验、run 内工具回执、checkpoint 确认、BOM 颜色和 UUID 一致性，不重新列为本轮成果。
- [原任务恢复与取消](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx:739)、[候选基线/期限检查](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx:703)已有；不为学习上游再建任务中心。
- [重建 ready](C:/幕景/Scendance2026/supabase/migrations/20261003090000_scene_v2_reconstruction.sql:194)已在一次 RPC 事务保存 proposal 与 job/proposal_id；过期 claim 标为 PROVIDER_RESULT_UNKNOWN，不自动重新购买。排除重复“补原子完成”建议。
- [评审冻结及 source 失效](C:/幕景/Scendance2026/frontend/lib/project-review.ts:233)和人工活动资料保留已有，评审库也有独立 owner；不复制 publication 系统。
- 旧 [POST /proposals](C:/幕景/Scendance2026/supabase/functions/_shared/api.ts:178)存在 proposals.store / requests.finish 两次 RPC 窗口，但本次在 room-organizer/client 的现行 UI 中未找到发起生成调用，只有 BackendSession 方法和测试。记录为旧接口边界，不将它报成默认 Agent 的用户流程缺陷，不凑第三候选。
- 自装模型、供应商配置、官方 Harness Runtime、新闻采集/分类/榜单及 Cron 不纳入本阶段。没有新增自动化、Git 提交/推送、部署或真实模型验收。

## 现码阅读快照

这些是 2026-10-10 本轮读取的原始文件 SHA256，用于核对并行改动后的适用性，不能替代后续实施版验收。前端仍有其他 owner 工作，实施前应重新确认对应逻辑。

| 幕景路径 | SHA256 |
| --- | --- |
| supabase/functions/_shared/agent-contract.ts | `82d79a1eae7398ab5f84784fe64962addc5714e51ba526058147f6a6472c6ec0` |
| supabase/functions/_shared/agent-runner.ts | `25fd6a7cf80e768886229e390fbbf5b1364c6f0317708198297b1124d7ffbb69` |
| supabase/migrations/20261003200000_agent_runs.sql | `a604238f6dfc9b4e4aba9994e7306c67c71cd5d1a20521b6119fb7ff8a3041a2` |
| frontend/lib/assistant-context.ts | `5ccbf0d59b68cc2bb3b069cacc0e2110b86c923da59972322599d4db6ffee2b5` |
| frontend/components/room-organizer/panels/creative-studio.tsx | `e417e7a5132c98a19c30cc600daf7a5633877f47f5d12bebff653c37f4817a46` |
| frontend/components/room-organizer/panels/event-operations-panel.tsx | `377058040be1c7081ba1e31521337bd48509f3537da24ddbbc1f418d41821771` |
| frontend/lib/production-plan.ts | `0b53c643d1fcfbcf954a8efe28f885d99effab3bbafc15cc492e122dbc575d83` |
