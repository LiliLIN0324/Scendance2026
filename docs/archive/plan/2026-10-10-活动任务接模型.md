# 活动任务建议接真实模型：现码调查与待审接线契约

2026-10-10。本文保存已完成的只读调查，供后续指定 owner 实施；不是已上线接口或已完成的 Agent 流程。本轮只新增本文，没有修改 API、共享 schema、数据库迁移、前端或已冻结的活动建议 helper，也没有运行模型、Git、服务或旧测试套件。

## 结论与第一切片

复用现有 Agent run 的请求身份、领取、期限、取消、原任务查询和模型传输。**当前 Scene 输入、工具及候选输出不能原样承载活动任务建议**，也不能把 summary 串进 brief 充当白名单隔离。最小方案是在同一 Agent run endpoint 增加明确的 `activity_tasks` 请求/结果分支，单次只读模型调用，独立结果与 complete 原子保存；任务仍在本机由人工选择、保存读回后闭合。

第一切片限定已经登录、已有明确服务项目绑定及有效编辑租约的活动。URL 使用远端服务 projectId，任务来源保持本机 activityId；不为了生成建议自动新建远端项目、上传整场景或改变本机活动编号。无服务绑定的本机活动如何获得请求身份，仍需单独审定，不能用假空 Scene 或公共 `local` 编号绕过现有契约。

目前没有授权实现这些契约扩展。冻结的 [本地基础模块](C:/幕景/Scendance2026/frontend/lib/activity-task-suggestions.ts:112)继续负责只读上下文、一次 prepare 的稳定草稿 ID 和仅追加的接纳规则；它不负责模型请求、持久保存或观察调用期间的 UI 新编辑。

## 现有路径及具体限制

| 位置 | 当前行为 | 对任务建议的限制 |
| --- | --- | --- |
| [agentContextSchema / agentRunRequestSchema](C:/幕景/Scendance2026/supabase/functions/_shared/agent-contract.ts:6) | context 严格限 brief、acceptedDecisions、recentMessages、lastProposalExplanation；请求强制 Scene、租约、localRevision、最多 50 个 UUID selectedIds | 没有 typed 活动白名单。selectedIds 是修改范围，不能解释为披露范围，也不能直接容纳合法旧本机 opaque 物件编号。 |
| [POST Agent run](C:/幕景/Scendance2026/supabase/functions/_shared/api.ts:100) | 解析上述请求，校验 selectedIds 属于 Scene，计算完整输入 fingerprint 和 Scene hash，创建 run；首次创建才执行 worker | 身份和幂等可复用；活动分支需要自己的严格输入校验，不能复用必填 Scene 或 sceneHash。 |
| [executeAgentRun](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:54) | 先读取 Scene 资源；[首轮模型消息](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:98)带全 Scene、预设物件标签、资源引用、当前资源及 catalog | 即使 selectedIds 非空，模型仍读取全场景。塞入活动 summary 不会隔离未选内容；新任务分支必须在资源读取前分流。 |
| [Scene tools / system](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:18) | 八个工具处理 Scene、资源、参数化建模、材质、BOM 与候选，最终要求 submit_candidates | 不允许模型借任务建议使用 Scene/资产写工具。任务只请求四字段结果，不需要这套工具循环。 |
| [submit_candidates](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:153) | buildProposal 后写 checkpoint；[SQL finish/checkpoint](C:/幕景/Scendance2026/supabase/migrations/20261003200000_agent_runs.sql:96)调用 proposals.store 并建立 agent_proposals 链接 | title/phase/acceptance/objectIds 不是 Scene proposal，不能放进 explanation 或 candidates 冒充场景结果。 |
| [agentRunSchema](C:/幕景/Scendance2026/supabase/functions/_shared/agent-contract.ts:28)与[agent_view](C:/幕景/Scendance2026/supabase/migrations/20261003200000_agent_runs.sql:22) | 只返回 Scene candidates/evaluation；期限、fail 根据 candidates 是否非空保留成果；cancel 隐藏 candidates | 必须增加 typed 活动结果，并同步审 view、finish、fail、期限和取消；不能只在前端解释一个任意 JSON 字段。 |

迁移检索中，agent_rpc/agent_view 只在 `20261003200000_agent_runs.sql` 定义，没有发现后续替换。现行 [require_lease](C:/幕景/Scendance2026/supabase/migrations/20261003120000_project_deletion.sql:4)核成员、项目删除状态、用户/session/generation/租约期限与 expectedRevision；它不依赖 Scene 内容，可供已有服务绑定的第一切片复用。

## 可复用的运行、传输和恢复

- [API 创建](C:/幕景/Scendance2026/supabase/functions/_shared/api.ts:105)对完整规范输入做 fingerprint；[SQL create](C:/幕景/Scendance2026/supabase/migrations/20261003200000_agent_runs.sql:38)按 actor/project/requestKey 重放，输入不同则冲突。旧 Scene 请求保持默认语义，不因增加任务分支重新执行已存请求。
- [start](C:/幕景/Scendance2026/supabase/migrations/20261003200000_agent_runs.sql:67)只领取 queued，生成 claim；后续动作要求 running 和同 claim，再核租约/修订。沿用现有 90 秒任务期限、调用上限和 usage 记录；任务分支实际只发起一次模型请求。
- [GET/by-request/cancel](C:/幕景/Scendance2026/supabase/functions/_shared/api.ts:112)沿原 actor/project 读取。[fetchJson](C:/幕景/Scendance2026/supabase/functions/_shared/http.ts:33)单次 fetch，有限响应和 timeout，没有 HTTP 自动重试。[parseAgentModelReply](C:/幕景/Scendance2026/supabase/functions/_shared/agent-model-reply.ts:31)可继续验证供应商 envelope，业务结果另行严格解析。
- runner 的 [Map 回执](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:100)只在当前进程工具往返中复用，不是 AIHOT 的持久 received 原答。可恢复的是已经保存到 agent_runs 的状态和结果；供应商已返回但进程/数据库未保存的原答，现体系没有跨进程复用保证。
- [generateProposal](C:/幕景/Scendance2026/supabase/functions/_shared/providers.ts:54)固定附 Scene，调用 buildProposal，并可能进行第二次付费校验修复。任务建议可以沿用同一模型端点/凭据和 JSON 请求形式，不能直接调用这个 Scene 函数或照搬其修复循环。

POST 不确定后只按原 requestId/runId 查询；GET 404、超时、终态失败或 worker 过期不触发新的付费 POST。再生成必须是用户基于当前资料明确发起的新操作。取消的现有围栏保证后续结果不应用，不证明供应商已经停止计算或退费。

## 待审输入与输出

以下是建议契约，不是当前可以成功提交的 payload。命名及共享类型由导演核对后交唯一 owner 实施。

同一 `POST /projects/{serviceProjectId}/agent-runs` 使用判别分支；旧请求缺少 kind 时按 Scene 处理。

| 请求分支 | 拟采用字段 | 处理 |
| --- | --- | --- |
| Scene 默认分支 | 现有字段 | 保留现有工具、候选、JEV、预览/直接应用与重放兼容。 |
| activity_tasks | `kind: 'activity_tasks'`、requestId、当前服务 sessionId/generation/expectedRevision、instruction、`activityContext: context.summary` | 仅已有服务绑定；严格拒绝 Scene/JEV/direct、对话缓存、制作/点验原记录等不属于该分支的字段。始终等待人工选择，不调用 Scene apply。 |

`activityContext`完全来自 `buildActivityTaskContext(input).summary`，先由用户预览并明确确认披露。它包含本机 projectId、资料性质、选定需求文字、选定任务白名单/有效状态及选定物件白名单；物件坐标同时带原 floorId/floorName，不能将不同楼层的相同 x/z 当作邻近物件。

`context.source.fingerprint`、完整原任务、operationBasis、负责人/承接团队、制作/点验原件、合同、内部费用、证据地址、图纸照片和私有资产 URL 留在本机。服务端权限按 URL 对应服务项目成员与租约判断；本机 projectId 或变更 hash 都不是鉴权凭证。选定自由文本、任务标题/条件和楼层名称仍可能含个人信息；白名单不等于自动脱敏，必须展示实际将发送的内容。

模型结果只允许：

```ts
{
  suggestions: Array<{
    title: string;
    phase: 'preparation' | 'setup' | 'event' | 'teardown';
    acceptance: string;
    objectIds?: string[];
  }>;
}
```

title/phase/acceptance/objectIds 沿现有 EventOperations limits/字段 shape；完成条件非空。物件引用只能对应本次 summary.objects，合法 UUID 用比较键处理大小写别名，opaque 编号精确比较并保原拼写；不按名称猜物件。拒绝未知字段、重复建议/引用、失联引用、越限与截断，整批通过后才完成。模型不能分配业务任务 ID，不能写 owner、status、计划/实际时间、evidence、金额或人员承诺；人工确认后再沿原任务界面补充真实安排。

运行响应应有明确的 kind 及专属 `activityResult: { suggestions: [...] }`，另有现有请求/运行身份与状态。可回显本机 activityId 和服务端从白名单算出的 contextHash，供恢复时核对来源；它们不替代本机相关输入 fingerprint，也不代表事实核验。响应不提供“已保存活动任务”的状态。

## 最小服务端实现位置（尚待批准）

1. 扩展共享请求/结果契约为判别分支，复用现有 EventOperations 字段定义。服务端必须校验白名单和四字段响应，不能只依赖已冻结的前端 prepare。Scene 默认契约兼容单独回归。
2. 在现 API/executeAgentRun 早期分流任务 kind，跳过 readSceneResources、Scene/candidate 工具、legacy Scene provider 和 JEV。用当前服务端 DeepSeek 凭据、chat/completions、fetchJson 及既有期限/字节/输出上限；只做一次 `response_format: {type: 'json_object'}` 调用。模型消息只含约束 system、本次 instruction 和 activityContext，不含 lease、Scene、catalog 或本机内部 hash。
3. system 要求仅依据披露资料，未知人员、时间、数量、费用与现场事实不猜；完成条件写成可人工核对的建议，不能声称已施工或验收。沿项目已审 runbook 方法，不新增安全/法规/成本阈值。
4. 通用 envelope 通过后要求正常结束、无 toolCalls，再解析 JSON 并校验完整四字段结果；异常安全失败，不自动付费重试、repair 或使用 Scene 工具。现有 API 请求体上限为 [256,000 字节](C:/幕景/Scendance2026/supabase/functions/_shared/api.ts:40)，runner 模型体也有上限；不得为适配长上下文偷偷截断用户选定内容。
5. 新增一个明确的活动结果 JSON 槽或等价专属存储字段，不另建运行表/队列。input JSON 已可保存 kind。以新迁移更新同一 agent_rpc/view：活动 create 跳过资产校验与 sceneHash，base_hash 可使用白名单 hash；保原成员、租约、claim 规则；有效活动结果和 complete 在同一事务提交，不调用 proposals.store。同步处理 fail、期限、cancel 和 GET 结果隐藏/失效。

共享契约、SQL 结果槽和迁移均是需要审定的扩展；本轮没有实现。不能把四字段塞进 explanation/candidates，或通过伪造空 commands 回避结果存储设计。

## 前端接线与仍缺的保存桥

1. **选择与预览。** 调用 build，只展示/发送 summary。保存本机来源和显式 selection；每次 await 后核活动、layout ref、selection、checkins 及 scope epoch 未变。来源 fingerprint 留本机。
2. **双重身份。** [geometryProjectId](C:/幕景/Scendance2026/frontend/lib/geometry-workbench.ts:16)解析服务项目，BackendSession 校验本机活动/用户/API/远端绑定。恢复可用 [resumeGeometryWorkbench](C:/幕景/Scendance2026/frontend/lib/backend-session.ts:628)，不新建项目或重发生成。建议和任务始终归本机活动 ID。
3. **先记录请求，再 POST。** [rememberRun](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx:696)已有记录成功后派发的模式。活动建议需要独立标记种类/键，绑定 API、用户、本机活动、服务项目、requestId、选定输入和来源基线；不能挤入仅含 Scene/brief 的现 RunMarker。记录失败则尚不提交。
4. **只查询原请求。** [BackendSession 的 run 方法](C:/幕景/Scendance2026/frontend/lib/backend-session.ts:1032)当前解析 Scene AgentRun，需活动分支的薄 typed 消费方法。[recoverRun](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx:751)的 GET 原身份模式可借鉴；输入变化时只展示原运行状态，不开放旧建议确认，不自动 POST。
5. **prepare 一次并保稳定 ID。** [prepareActivityTaskSuggestions](C:/幕景/Scendance2026/frontend/lib/activity-task-suggestions.ts:164)每次都会创建新的 proposal/task UUID。一个成功 run 只 prepare 一次，将完整 prepared proposal 与 requestId 关联保存；重复 GET、界面重开、保存重试复用同一份，不重新分配 ID。可用现有 [source-storage forms](C:/幕景/Scendance2026/frontend/lib/source-storage.ts:131)作为本机底层，补严格读取/身份校验，不新建存储引擎。prepared proposal 未能持久保留时，不开放接纳。
6. **人工选择与迟到守卫。** [accept](C:/幕景/Scendance2026/frontend/lib/activity-task-suggestions.ts:190)只检查传入快照。返回后、写入前再次核 controller/API/用户、活动 scope/epoch、immutable layout/ref、选定输入和 checkins 基线，参考现有 [beginBackupOperation](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.tsx:276)的守卫方式。`accepted`表示拟写，不表示已保存。
7. **保存读回后才闭合。** [现有任务更新回调](C:/幕景/Scendance2026/frontend/components/room-organizer/room-organizer.tsx:1239)同步更新，随后 [layout autosave](C:/幕景/Scendance2026/frontend/components/room-organizer/hooks/use-layout-persistence.ts:252)保存。[flushSourceScope](C:/幕景/Scendance2026/frontend/lib/source-storage.ts:20)不替布局执行 autosave，[saveLayout](C:/幕景/Scendance2026/frontend/components/room-organizer/lib/persistence.ts:268)没有读回确认。目前仍缺可等待的任务提交桥：阻住未保存编辑并核基线 → 更新 → 保存 → 读回同活动、原记录和新增 ID → 确认 receipt、关闭整批。可参考 [local-project-restore 的读回](C:/幕景/Scendance2026/frontend/lib/local-project-restore.ts:37)，不要直接套整份导入恢复流程。

保存失败或结果不确定时保原记录、同一 proposal 和稳定 ID，继续核对原保存结果，不再次模型请求或 prepare。真实保存核实之后才闭合极小 receipt；重复已确认 receipt 保当前人工修改/删除，不复活任务。部分接纳关闭整批，剩余建议按新输入重新准备，不构造无限分批重基。

## 相称验证位置

本轮只读既有测试，没有重新运行。下面是新增接线的验证要求，不将旧通过数量冒充新接口验收。

| 输入/故障 | 应证明的结果 | 现有位置与可扩展点 |
| --- | --- | --- |
| 正常 task kind，选定有限任务/物件 | 捕获模型 body 只有白名单及本次 instruction；无 Scene、资源、私有依据，单次调用；运行 metadata 保在传输/存储层 | [agent-runs body/replay fixture](C:/幕景/Scendance2026/tests/agent-runs.test.ts:55)；旧 Scene 默认兼容另测。 |
| 未知字段、owner/status/evidence/金额、非法工具、重复/失联引用或截断 | 整批失败，无资产、Scene proposal 或活动保存副作用；终态重放不增加 provider 次数 | [无副作用/回复边界集成](C:/幕景/Scendance2026/tests/agent-runs.test.ts:98)。通用 [agent-model-reply](C:/幕景/Scendance2026/tests/agent-model-reply.test.ts:27)继续只负责 envelope，不塞入业务 schema。 |
| finish 提交前失败/提交后响应丢失 | 独立活动结果与 complete 同事务；GET 原请求恢复已存结果；未存结果不自动购买新调用 | [checkpoint 故障 fixture](C:/幕景/Scendance2026/tests/agent-runs.test.ts:179)，改用活动 finish/result 路径，不能继续依赖 Scene candidates。 |
| POST 网络未知、重复同 request、GET 404、deadline 后 start | 仅查询原身份、不自动重新 POST；终态/过期不可领取 | [后台重放/过期](C:/幕景/Scendance2026/tests/agent-runs.test.ts:239)、[客户端身份及 GET](C:/幕景/Scendance2026/frontend/lib/backend-session.test.ts:873)。 |
| 取消或旧响应迟到，期间切活动/用户/服务绑定/选定资料 | 不 prepare 或保存旧结果；无新的付费调用 | [服务端取消](C:/幕景/Scendance2026/tests/agent-runs.test.ts:94)、[前端未知派发/取消](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.react.test.tsx:2776)、[迟到响应](C:/幕景/Scendance2026/frontend/components/room-organizer/panels/creative-studio.react.test.tsx:2831)。 |
| 重复 GET、prepared proposal 保存失败、重开 | 一个 run 只 prepare 一次；重试/重开仍使用同一 proposal 和任务 ID，未确认不写活动 | 新活动 UI 集成验证；现 Scene marker 没有这项能力。冻结 helper 的纯函数通过不代替持久化验收。 |
| 接纳 await 期间新编辑、layout 写入/读回失败、保存成功重开 | 写前守最新基线；失败保原记录/提案，保存核实后才闭合；同新增 todo 能重开并由原执行时间表导出 | 新任务提交桥与真实本机演练。helper、API 替身、真实模型、真实保存分别报告。 |

现场完成、数量、合同、收付与验收证据不因模型或这些测试而成立。模型返回效果另行验收；没有实际调用时如实报告本地/替身验证。

## 依据与阅读快照

沿用已实际读取的 [AIHOT 采用记录](C:/幕景/Scendance2026/docs/plans/aihot-code-adoption-20261010.md)和 [专业 Skill 来源](C:/幕景/Scendance2026/docs/plans/professional-skill-basis.md)：当前输入围栏、人工更正优先、业务结果与完成状态同事务；runbook 方法只用于建议可核对的动作/完成条件，不推导现场安全或费用阈值。本轮没有重复联网调研或声称上游运行性能/供应商成本已验证。

下列是本次实际读取的现码原始 SHA256，不把检查点上传说成完整任务流程已经接通。

| 文件 | SHA256 |
| --- | --- |
| supabase/functions/_shared/agent-contract.ts | `82d79a1eae7398ab5f84784fe64962addc5714e51ba526058147f6a6472c6ec0` |
| supabase/functions/_shared/agent-runner.ts | `25fd6a7cf80e768886229e390fbbf5b1364c6f0317708198297b1124d7ffbb69` |
| supabase/migrations/20261003200000_agent_runs.sql | `a604238f6dfc9b4e4aba9994e7306c67c71cd5d1a20521b6119fb7ff8a3041a2` |

本文保存后冻结，后续由导演审定共享契约、结果槽/迁移、未绑定请求身份和前端保存桥，再分配唯一 owner。当前 UI 优先工作不因本记录自动改变；不为等待 UI 循环检查或提前实现模型接线。
