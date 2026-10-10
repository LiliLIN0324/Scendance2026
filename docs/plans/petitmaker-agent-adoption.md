# PetitMaker Agent 源码学习与幕景后端采用

2026-10-10。完成指定版本的完整 Agent 链路调查，并实施两个后端增量：checkpoint 持久化异常停止后续模型/工具；共享 buildProposal 校验修改命令的选中范围，覆盖兼容 provider/caller。SQL、API schema、依赖、共享前端及活动任务建议 helper 均未改动；真实模型、云端部署及浏览器联调仍单独验收。

## 固定来源、运行位置与许可

- [Stry233/PetitMaker](https://github.com/Stry233/PetitMaker/tree/4e120e50c844198649454eec6069ac65a062a732)，固定 `4e120e50c844198649454eec6069ac65a062a732`。实际参考目录 [C:/幕景/upstream-references/PetitMaker](C:/幕景/upstream-references/PetitMaker) 的 `.git/HEAD` 文本与此值一致；本轮没有执行 Git 命令。package.json 记录版本 `1.5.557`。
- 实际读取 ARCHITECTURE、入口、core loop、provider、工具/执行桥、审批、history、session、上下文与对应测试源码。沿已读 agent-reach 的一手源码核对方法使用已有 checkout，没有安装上游依赖、启动它、调用模型或运行上游测试。测试文件被读到不等于本轮执行通过。
- 代码为 [Apache-2.0](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/LICENSE)，[NOTICE](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/NOTICE)列出项目贡献者与第三方来源。品牌、图标、美术、部分 model3d 规格及其他材料有[独立条款](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/docs/ASSET_LICENSES.md)。本轮借鉴机制，没有复制素材或实质代码；不从游戏规则推导幕景活动安全、费用或商务标准。
- **这条 Agent 是浏览器 runner 直连 provider。** [架构 Agent 段](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/docs/ARCHITECTURE.md#L1357)明确 in-browser BYOK；[OpenAI adapter](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/providers/openai.ts#L199)创建允许浏览器使用的 SDK，关闭 SDK 自动重试；[Anthropic adapter](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/providers/anthropic.ts#L106)同样如此。[EditorAPI](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/api/editor-api.ts#L27)接受内存 state/executor getter，不是 HTTP 模型服务器。文档中 backend/engine 是引擎参考的称呼，不能据此把它说成幕景式服务器后端。

## 完整链路与幕景对应

| 链路 | PetitMaker 的实际入口/机制 | 幕景对应与取舍 |
| --- | --- | --- |
| 用户入口与启动 | [Composer.submit](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/agent/Composer.tsx#L297) → [PanelColumn.send](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/agent/PanelColumn.tsx#L179) → [createRunner](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/exec/runner.ts#L135)的 send/launch → runJob；活跃任务收到后续输入时转 steering，避免并行启动 | 幕景 API 创建/claim、同 owner 活跃运行围栏、requestId 与 GET 恢复已有，不另起运行平台。当前 fixed provider 是服务端配置，不照搬浏览器存钥。 |
| 模型请求与上下文 | [runJob](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/core/loop.ts#L549)调用 adapter；[AdapterRequest](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/providers/types.ts#L11)包含 system/messages/tools/model；[project-messages](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/core/project-messages.ts#L1)从同一事件日志投影 wire，compaction 按完整调用/结果组保留 | 幕景当前完整 JSON 回复、批次 ID 校验、输入/输出字节与期限上限已有。没有 SSE，暂不移植 stream assembler/idle timer、摘要付费调用或整套多 provider roster。 |
| 工具目录与规则事实 | [tools](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/tools/tools.ts)、独立 director/terraform/search 工具经执行桥；system 从真实规则/目录组装 | 幕景已有八个 typed 域工具、共享 catalog/资源真源与 buildProposal；不复制游戏 catalog、技能内容或规则。本轮补齐共享检查入口漏项，见候选 2。 |
| 规划与审批 | [handleUpdatePlan](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/core/loop.ts#L235)批准后 append plan；[shouldGate/answerGate/awaitGate](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/core/gates.ts#L9)控制 strict/checkpoint/yolo、拒绝旧/重复回答并支持 abort。计划批准不免除后续 wide tool 审批 | 幕景已有候选预览、明确普通指令直接应用、JEV 人工选择和 lease/revision 围栏。没有足够证据要求再建通用规划/审批引擎；其 yolo 与 wide 分类不自动成为幕景权限政策。 |
| 手动/AI 统一校验与批量动作 | [CommandExecutor.execute](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/core/commands/command-executor.ts#L193) → [RuleRegistry](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/rules/registry.ts#L45)；手动 [object actions](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/tools/objects/actions.ts#L29)与 Agent [runStroke](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/tools/tools-common.ts#L410)调用同一 executor。拒绝原因、规则 ID、保留成功数量作为结果返回 | 幕景 typed commands、候选 clone、共享结构检查、保存/应用前复检已有。Petit batch 允许保留有效前缀，幕景整份候选拒绝/确认语义不同，不把它换成部分场景自动落地。 |
| 执行事务与回退 | [decorateZoneHandler](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/tools/tools-director.ts#L57)经 runStrokeBody 的本地 transactionAsync 成组校验；崩溃和区域越界退整次调用，普通 post-stroke 规则可只退非法尾部 | 它能读取/回退已知内存状态。幕景远端 RPC 响应丢失不能假定没提交，也不能照搬 undo 去删除资产或撤销商务事实。checkpoint 异常应结束当前运行并核原结果，见已实施候选 1。 |
| history 与阶段水位 | [syncStageCheckpoints](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/core/loop.ts#L164)在主循环顶部保存当前 undo depth；[undoToCheckpoint](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/agent/PanelColumn.tsx#L78)连续 undo 到水位 | 不是每个工具的严格事务边界，且会撤掉后续用户/其他 job 编辑。幕景已有 previousScene/undoGroup、候选 checkpoint 与版本应用，继续保护人工活动/合同资料，不新增“任意阶段一键撤销”承诺。 |
| 取消、暂停与恢复 | runJob 每工具前、审批后、写等待后再查取消/暂停；runner 的 stop/pause/resume 在 [344](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/exec/runner.ts#L344)起。[loadLog](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/session/persist.ts#L134)把恢复中的活跃任务补成 paused，再由 resume 重入 loop | 幕景 before/after model、每工具、结束写回的 cancel/lease/deadline 检查和原请求 GET 恢复已有。暂停继续完整模型对话是独立能力；不把本机 log resume 等同远端副作用 exactly-once。 |
| 进度、错误与回执投影 | [log](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/core/log.ts#L3)记录 order/assistant/toolResult/checkpoint/incident/jobEnd；[project-view](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/core/project-view.ts#L214)区分运行、截断、拒绝、回退和审批。[governor repeatedFailure](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/core/governor.ts#L106)在地图未变时阻止完全相同失败动作反复执行 | 幕景有 progress/usage、同 tool ID 回执及错误终态；有效候选加错误的普通模式提示已由前端采用，不能再包装为本轮新功能。当前无需另建事件账本或全量 UI 投影。 |
| 权限与隐私 | [trust prompt](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/prompts/08-trust.md)把地图/工具/总结当数据；工具沙箱不提供 DOM、任意存储/网络；[redactSecrets](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/agent/security/redact.ts#L25)按实际 key 值和形状清理文本 | 幕景服务端成员/租约、工具白名单和固定安全错误已有；密钥留服务端。活动白名单真实模型接线仍按已冻结的独立方案审定，不把“工具没网络”误说成 provider 请求不发送资料。 |

## 上游限制：不预设它更可靠

1. stage 更新只 append completedStages；checkpoint 在下一主循环边界采当前历史深度。如果同一回复在 stage 更新后还有 write，水位会晚于那个 write。初始 plan 没有自动 stage 0，完成 stageCount 不记新水位。不能把它写成逐阶段即时封边的事务保证。
2. pause 等当前工具完成后才停；取消不自动撤销已完成编辑。公开 resume 只恢复 paused；普通 Stop 已终结的任务不是任意可继续的 job。
3. [autosave](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/autosave.ts#L19)保 60 个 history steps；[history-codec](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/history-codec.ts#L22)截尾，[restoreHistory](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/core/commands/command-executor.ts#L546)重建深度，而 session 原 undoIndex 没有重基准。历史耗尽/存储不足时没有快照重建，日志可恢复不等于任意旧水位可恢复。
4. [rollback cost](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/agent/rollback.ts#L24)包含水位后的用户手动操作和后续 job；一次 undo 也可能为恢复合法状态消费多条。地图/history 与 agent log 分别保存，不是一个远端提交事务；saveLog 容量失败剪枝重试一次后可能返回 lost。
5. provider SDK 关闭自动重试，不代表整个 harness 永不重复请求；loop/retry 与 compaction 另有策略。浏览器 key vault 的本地保护和 fallback 不等于隔离第三方脚本。幕景不因此改成浏览器保存/直连模型 key，也不引入未知结果自动付费重发。

这些限制来自实际代码，不作为本轮 PetitMaker 修复任务。其相关静态测试包括 [loop 审批/pause/stage](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/agent/core/loop.test.ts#L232)、[director 一个 undo step](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/agent/tools/tools-director.test.ts#L22)、[persist 恢复 paused](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/agent/session/persist.test.ts#L148)及 [rollback 后续手动工作](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/ui/agent/rollback.test.ts#L20)。本轮仅阅读这些用例。

## 候选 1：checkpoint 异常停止模型修复（已实施）

### 原行为与可靠性边界

借鉴的是“拒绝/可修错误/运行事故分别处理、已有结果单独保留”的机制，不是复制其本地 rollback。可修候选 schema/几何错误可以让模型修改参数；**checkpoint 持久化或响应失败无法由模型确认远端是否已经提交**。

原 [runner checkpoint](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:162)抛错会落入普通工具 catch，变成 safeError 并缓存同 ID 回执，然后继续下一模型轮。内存候选只有 checkpoint 确认后才提升，因此未确认时仍为空；即使数据库已保存候选，模型往返仍可达到六次，最后才沿 fail 回读保留有效成果。

旧 [checkpoint before/after fixture](C:/幕景/Scendance2026/tests/agent-runs.test.ts:208)明确把提交前失败与提交后响应丢失都模拟成 DATABASE_ERROR。导演提供的固定前端演练观察也为 modelCalls=6、checkpointCalls=1、committed=1、injectedError=1、fail=1、activeRuns=0、externalProviderCalls=0。它与源码路径一致，**不是实际供应商收费记录，也不是服务器失活证据**；本聊天没有重测、修改或重启该前端 fixture。

### 最小实现

首项只修改 [agent-runner.ts](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:113)和 [agent-runs.test.ts](C:/幕景/Scendance2026/tests/agent-runs.test.ts:208)。每个工具局部 checkpointFailed 默认 false，仅 checkpoint RPC reject 时设置；沿原 safeError 与同 tool_call_id Map 保存失败回执后，立即抛回原错误到现有 run 外层 fail。它发生在下一模型轮、同回复尾随工具、JEV、finish 之前，没有新运行引擎或错误包装协议。

原 APIError.code 保留；checkpoint 确认后才提升内存候选的顺序不变。SQL [fail](C:/幕景/Scendance2026/supabase/migrations/20261003200000_agent_runs.sql:73)继续按已经保存的候选决定 complete/failed，保留 errorCode；恢复继续查询原 requestId。真正未写得到 failed/空候选，提交后响应丢失得到保留候选的 complete/DATABASE_ERROR，均不自动重新生成或提交。

普通候选 schema/多样性/几何校验仍在原候选错误收集与一次 repair 路径；其它工具错误、同 ID 重放/参数冲突、权限、取消与期限规则没有扩大或改写。没有把一次失败推断为“供应商未计费”，也没有删除未确认副作用作为清理。

### 红绿证据与验证范围

- 改动前先调整/增加四个故障回归：before/after checkpoint 各一个；同条模型回复在 submission 后尾随 create_parametric_model 的 before/after 各一个。旧代码定向运行 **4 failed / 35 skipped**，均为旧 callCount=6 对新期望 1 失败。
- 修复后 Agent runs 整套 **40 项通过**；最终与 agent-model-reply、agent-model-tools、scene-agent-api 四套共 **67 项通过**。故障分支现在只调用一次固定模型替身、checkpoint 一次，尾随资源创建不执行；原场景不变。
- 用真实 handler/RPC 隔离 fixture 的 HTTP GET by-request 和同请求重复 POST 核同一终态、候选及 errorCode，不增加模型替身次数。既有正常 repair/JEV、取消/lease 与同 ID 回执用例保持通过。
- 根类型检查通过；scene-api、reconstruction-worker、generation-worker 三个 Edge 入口 cached-only 本地检查通过。独立只读审确认旗标不命中正常修复或其它工具回执。
- Auth/Storage/provider 为既有隔离替身，数据库为本地测试环境；没有真实模型/供应商/生产调用、迁移、部署、Git 提交/推送或共享前端改动。前端负责人后续将新源码纳入自己的固定联调副本，不能用旧 fixture 的六次计数冒充新源码未通过。

首项实际命令（仓库根工作目录；红回归在旧 runner 上运行，其余在本节冻结验证版上运行）：

```powershell
npm exec -- vitest run tests/agent-runs.test.ts --maxWorkers=1 -t "checkpoint|trailing"
npm --offline exec -- vitest run tests/agent-runs.test.ts tests/agent-model-reply.test.ts tests/agent-model-tools.test.ts tests/scene-agent-api.test.ts --maxWorkers=1
npm run typecheck
$env:DENO_NO_UPDATE_CHECK='1'
.\node_modules\.bin\deno.cmd check --cached-only --config supabase/functions/deno.json supabase/functions/scene-api/index.ts supabase/functions/reconstruction-worker/index.ts supabase/functions/generation-worker/index.ts
```

首项经导演独立读 diff、命令回执及源码 SHA 验收；它的 67 项结果不作为下面第二项的新验证证据。

## 候选 2：把选中范围检查下沉共享 buildProposal（已实施）

### 源码与只读复现

PetitMaker 值得学的是手动/AI/程序入口共用动作检查，不是重新创建 registry。幕景已有 [commandsSchema](C:/幕景/Scendance2026/supabase/functions/_shared/ai.ts:42)、克隆候选、结构校验与 [整体候选复检](C:/幕景/Scendance2026/supabase/functions/_shared/ai.ts:128)；手动 reducer 与保存/应用也使用已有共享结构规则。

修复前选中目标守卫只在普通 [runner build](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:81)检查 `id in command` 且 id 属于 selectedIds。[legacy 分支](C:/幕景/Scendance2026/supabase/functions/_shared/agent-runner.ts:66)直接调用 generateProposal，[providers.ts](C:/幕景/Scendance2026/supabase/functions/_shared/providers.ts:74)再调用 buildProposal；共享构建函数没有同样的通用选中检查。旧 `/proposals` 也走这个共享路径。

独立子审用两把合法椅 A/B，只在内存直接调用真实 buildProposal：selectedIds=[A]，命令移动 B，结果仍接受，B 从 (8,8) 变为 (9,8)；原 Scene 未改、fetch=0。普通默认 runner 已有拒绝规则，所以不把它说成默认模式越界；也没有证据证明生产正在启用 legacy。旧 endpoint 目前没有查到当前 UI 生成调用，但兼容 Agent 分支仍是明确支持的入口，共享构建缺口不能只靠 prompt 或 caller 自律补足。

### 最小 scope 与相称验收

实际实现只在 [buildProposal modify 分支](C:/幕景/Scendance2026/supabase/functions/_shared/ai.ts:98)新增一条现有规则：selectedIds 非空时，整批所有带 id 的命令必须属于选中集合，否则 INVALID_SELECTION/422；在处理任何命令前拒绝。覆盖 remove/move/rotate/recolor/replace/replace_resource。空选择、选中对象修改、add/add_resource、锁定、资源尺寸/授权、材质建议及结构规则保持原语义，不扩 ID 比较、图层或组策略。

实际测试修改为 scene-agent.test.ts、providers.test.ts 与 agent-runs.test.ts。旧 proposals 的既有 scene-agent-api.test.ts 作为调用链兼容验证参与最终运行，没有新增其越选 HTTP 回归；新增越选 handler 回归走的是 legacy Agent run。不能将共享 provider 覆盖说成对所有 HTTP 入口逐一新增了同样的负例。

layout 仍只允许空 Scene，内置模板只新增对象，不为它发明已有对象选择或部分布局规则。空 Scene 携非空 selectedIds 的非法请求仍由现有 API 输入检查拒绝。普通 runner 的早检查经导演确认保留，以保持资源/材质准备前的原拒绝顺序；共享构建检查负责覆盖兼容 provider/caller。因此 runner 的首项冻结 SHA 完全不变。

### 第二项独立红绿与验证命令

- 旧 ai.ts 上过滤新增共享/provider 13 项：**9 失败、4 通过**。六种未选中命令和混合 batch 未拒绝，恒 moveB 的 provider 直接成功、B→A 修复案例仅调用一次；选中 A、空选择和 add/add_resource 正例本来通过。
- 旧 legacy handler 回归另外 **1 失败**：返回 complete/移动 B 候选；ordinary handler 的第一次越选后修复 A 正例本来通过，不冒称默认模式也存在该旧缺口。
- 新共享守卫后，scene-agent/providers 两套 **42 项通过**，新 13 项全通过；agent-runs **42 项通过**，首项原 40 项断言没有放宽。
- legacy/provider 不改原一次 JSON 修复契约：第一次共享 INVALID_SELECTION 进入原 repair；第二次仍越选时 wire 保持 AI_INVALID_PROPOSAL，validation/repair.code 为 INVALID_SELECTION，不为匹配测试更改错误协议。B→A 成功仍只两次固定模型调用，原 Scene 不变；同 request POST 重放/GET 不再调用模型。
- 最终第二项独立验证为 **8 套 127 项通过**，根类型检查及三个 cached-only Edge 入口通过。覆盖共享命令、真实 provider 请求/解析、普通/legacy handler、资源/材质及原锁定/layout 规则。没有借用首项 67 数量冒充第二项。

```powershell
# 旧 ai.ts 的 legacy/ordinary 定向红证据
npm exec -- vitest run tests/agent-runs.test.ts --maxWorkers=1 -t "legacy handler|ordinary handler"
# 第二项最终冻结行为验证
npm --offline exec -- vitest run tests/scene-agent.test.ts tests/providers.test.ts tests/agent-runs.test.ts tests/scene-agent-api.test.ts tests/agent-model-reply.test.ts tests/agent-model-tools.test.ts tests/agent-materials.test.ts tests/domain.test.ts --maxWorkers=1
npm run typecheck
$env:DENO_NO_UPDATE_CHECK='1'
.\node_modules\.bin\deno.cmd check --cached-only --config supabase/functions/deno.json supabase/functions/scene-api/index.ts supabase/functions/reconstruction-worker/index.ts supabase/functions/generation-worker/index.ts
```

这是生成共享构建边界的修复，不是 service-role 直连数据库的新约束；没有清理历史已保存提案、改变 schema 或迁移。验证仍为本地替身/隔离数据库与入口编译，真实模型、部署与前端固定副本联调单列。

## 已有等价能力与明确不做

- 已采用的 DeepSeek Harness 批次回复 ID/schema 边界、AIHOT run 内工具回执、checkpoint 确认后候选提升、BOM 颜色/UUID 一致性，不重新包装为 PetitMaker 新成果；依据见 [原 Agent 接入记录](C:/幕景/Scendance2026/docs/plans/agent-reference-study.md)。官方 Harness Runtime 仍未安装。
- 普通模式有效候选加错误的中断提示已由前端做；这次修的是后端何时停止继续往返，不再修改那份共享 UI。
- 不把 Petit occurrence 的 callId+assistantSeq 替换幕景裸 tool.id：幕景当前协议明确把跨轮同 ID 当重放，换 key 会破坏已验证的幂等语义。
- 不移植 append-only 全量事件日志、SSE、浏览器 key vault、通用阶段回退/审批平台或游戏部分执行规则。幕景候选/lease/版本/本地活动资料保护继续作为真源。
- 活动白名单真实模型接线、独立结果槽、稳定提案及保存读回桥仍按已冻结 [activity-task-agent-integration.md](C:/幕景/Scendance2026/docs/plans/activity-task-agent-integration.md)审定；本轮不重复其引用检查或 helper 关闭回归。
- 活动和商务专业内容仍依 [专业 Skill 来源](C:/幕景/Scendance2026/docs/plans/professional-skill-basis.md)，尤其 runbook/变更方法；游戏规则不是现场安全、验收、报价或签署标准。

## 本轮源码与交接摘要

| 路径 | SHA256 | 状态 |
| --- | --- | --- |
| supabase/functions/_shared/agent-runner.ts | `3231ff62463c849bb8e79f938b3257e07cd6f1b94632877a3d4fffd3418caa1d` | 首项实施/67项相关与类型/Edge验证版；原阅读基线为25fd6a7cf80e768886229e390fbbf5b1364c6f0317708198297b1124d7ffbb69 |
| tests/agent-runs.test.ts | `93bca157e6899d92ceb7bcf98932b0b8bb03ae0c17818eed83c66a6b9bcb5220` | A+B共42项；A验收历史SHA仍为648e02d85df8e6d8914b8d57ddf2287877a2917d61db822acbceb40957a6071b |
| supabase/functions/_shared/ai.ts | `3c84f1c5a30c3b3e876d68a58e971c65685b928d21f3f621c26d9e3ebc6fa801` | B共享选中守卫；原阅读/红基线2ecbe2e4571147407b7cb2125c1938ec4bac0d0632a2ff0abaf7eff0c85d8ba8 |
| tests/scene-agent.test.ts | `cd2b7d3c51a641f916c546cc563451e8803e35f9ae826f6c09af497fbd0e6340` | B共享命令/空选择/新增回归 |
| tests/providers.test.ts | `cd969f0ee7a162ec16b7a3d80d925516a6d1f4e4454daf097d258442f144ec66` | B真实解析/一次修复契约回归 |
| supabase/functions/_shared/providers.ts | `ec911197a2aadfedf96fefa274a827296ed819613edcd24ff2c6684b4c5a1672` | caller差异只读版本，未改 |

本报告及两项合并后的后端验证版交导演核对并冻结，共两实现模块、三测试文件和本文；providers.ts仅阅读未修改。当前 PetitMaker 素材栏/整体减繁由各自 UI owner 执行，本聊天不回退或接管他们的代码；后续源码纳入前端固定联调副本仍由导演安排。
