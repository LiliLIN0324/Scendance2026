# AI 智能建造 / 场地规划智能体 —— 代码落点与迁移地图

- 日期：2026-11-05
- 仓库：`C:/幕景/Scendance2026`（commit `f0402ac`，TypeScript + Supabase Edge Functions + Next.js 前端）
- 性质：**只读分析**，未修改任何代码
- 目的：把谷地工坊（petitmaker）的 10 项做法逐条映射到本仓库的**真实文件 / 函数 / 行号**，并给出最小改动落点
- 相关既有文档：`docs/plans/petitmaker-agent-teardown-2026-11-05.md`（逆向原文）、`docs/plans/batch10-agent-steering-delivery-2026-11-05.md`、`docs/plans/batch11-agent-phase-progress-delivery-2026-11-05.md`、`docs/plans/batch13-agent-phase-persist-delivery-2026-11-05.md`

---

## 0. 一句话结论

幕景**已经有一条完整、可用的建造智能体主链**：HTTP → `executeAgentRun` → 6 轮工具循环 → 候选方案 → 用户确认 → `proposals.apply` 落库。
10 项里 **2 项已完整落地**（运行中改道、阶段化进度）、**1 项架构上已等价解决**（并发脏写）、**6 项部分有**、**1 项完全没有**（`update_plan`）。
最大的结构性缺口是**「计划层」**：没有 `update_plan`，没有确定性 scorecard，也没有把监督档位真正接到执行模式上。

---

## 1. 入口与链路

### 1.1 调用链总表

| # | 环节 | 文件 | 关键函数 / 常量 | 行号 |
|---|---|---|---|---|
| 1 | Edge 入口 | `supabase/functions/scene-api/index.ts` | `Deno.serve(createApi(createBackend(env), …))` | 6 |
| 2 | HTTP 路由工厂 | `supabase/functions/_shared/api.ts` | `createApi()` | 42 |
| 3 | 路径归一 | `supabase/functions/_shared/api.ts` | 去掉 `/functions/v1/scene-api`、`/scene-api` 前缀 | 57 |
| 4 | 鉴权 | `supabase/functions/_shared/api.ts` | `Bearer` → `backend.user(token)` | 76–78 |
| 5 | **建运行** | `supabase/functions/_shared/api.ts` | `POST /projects/:id/agent-runs` | 164–177 |
| 6 | 幂等 + 计费入口 | `supabase/functions/_shared/api.ts` | `backend.agent(actor,'create',{input,fingerprint,baseHash,executionMode})` | 169–171 |
| 7 | 选执行器 | `supabase/functions/_shared/api.ts` | 活动任务 → `executeActivityTaskRun`；否则 → `executeAgentRun` | 173 |
| 8 | `waitUntil` 降级 | `supabase/functions/_shared/api.ts` | 有 `waitUntil` 返回 202 存根，无则同步等完 | 174–176 |
| 9 | **改道入口** | `supabase/functions/_shared/api.ts` | `POST /projects/:id/agent-runs/:id/notes` | 180–184 |
| 10 | 查询 / 取消 | `supabase/functions/_shared/api.ts` | `GET|POST /agent-runs/(by-request/)?:id(/cancel)?` | 185–189 |
| 11 | RPC 绑定 | `supabase/functions/_shared/backend.ts` | `agent: rpc(client,'agent_rpc')` | 37 |
| 12 | SQL 分发器 | `supabase/migrations/20261010010000_activity_task_agent_runs.sql` | `public.agent_rpc` → 活动任务分支 / 场景分支 | 26–55 |
| 13 | SQL 场景分支 | `supabase/migrations/20261105150000_agent_run_phase.sql` | `public.agent_rpc_before_activity_tasks` | 34–135 |
| 14 | **智能体循环** | `supabase/functions/_shared/agent-runner.ts` | `executeAgentRun()` | 93–289 |
| 15 | 认领 | 同上 | `rpc(actor,'start')` → `claim` | 95–96 |
| 16 | 租约/截止检查 | 同上 | `check()` → `call('check')` | 100 |
| 17 | 消息装配 | 同上 | `messages=[system, user(JSON)]` | 150 |
| 18 | 轮循环 | 同上 | `for(turn=1; turn<=6 && !finished; turn++)` | 158–282 |
| 19 | 取改道备注 | 同上 | `call('take_notes')` → 注入 user 消息 | 162–163 |
| 20 | 模型调用 | `supabase/functions/_shared/providers.ts` | `chatRequest()` 三路供应商回退 | 108–123 |
| 21 | 回复解析 | `supabase/functions/_shared/agent-model-reply.ts` | `parseAgentModelReply()` | 149 |
| 22 | 工具分发 | `supabase/functions/_shared/agent-runner.ts` | `name in schemas` → `schemas[name].parse` | 175–181 |
| 23 | 工具幂等回执 | 同上 | `receipts` Map（同 tool_call_id 重放） | 152、182–186 |
| 24 | 工具实现 | 同上 | 11 个 `else if(name===…)` 分支 | 189–269 |
| 25 | 收尾 | 同上 | `call('finish',{evaluation,message})` | 287 |
| 26 | 失败 | 同上 | `call('fail',{errorCode})` | 288 |
| 27 | 候选落库 | `20261105150000_agent_run_phase.sql` | `finish`/`checkpoint` → `scene_rpc('proposals.store')` | 118–130 |
| 28 | 前端发起 | `frontend/components/room-organizer/panels/creative-studio.tsx` | `controller.startAgentRun({…})` | 951 |
| 29 | 前端轮询 | 同上 | `followRun()`（2s 轮询、120s 上限） | 752–811 |
| 30 | 前端改道送达 | 同上 | `deliverSteerNotes()` | 765–778 |
| 31 | 客户端方法 | `frontend/lib/backend-session.ts` | `startAgentRun/getAgentRun/steerAgentRun/cancelAgentRun` | 1081 / 1089 / 1109 / 1119 |
| 32 | **写回场景** | `frontend/.../creative-studio.tsx` | `applyCandidate()` → `controller.applySceneProposal()` | 968–979（调用在 972） |
| 33 | 写回路由 | `supabase/functions/_shared/api.ts` | `POST /projects/:id/proposals/apply` | 262–268 |
| 34 | 写回校验 | `supabase/migrations/20261002060304_scene_core.sql` | `proposals.apply`：`base_revision`+`base_hash`+`lease` 全等才写 | 229–237 |
| 35 | 真正落库 | 同上 | `scene_private.save_scene()`（`revision+1`） | 143–155 |

### 1.2 关键事实（迁移时容易踩空）

1. **智能体在运行期从不写场景**。所有工具都是纯内存试算；候选只在 `proposals.apply` 时落库。因此「并发脏写」的窗口被架构消掉了（见 §6 第 7 项）。
2. **工具读的是「运行创建时的场景快照」**（`input.scene`，`agent-runner.ts:104/150/189`），不是实时库。运行期间别人改了场景，只在 apply 时以 `STALE_PROPOSAL` 拒绝。
3. **`start_lux3d_model` 是按环境变量动态投放的工具**：`generationCapabilities(env).aholoTextToModel` 为假时用 `baseTools`（`agent-runner.ts:48、155、166`），模型看不到它。
4. **两种智能体共用同一个 `agent_rpc`**：场景智能体（6 轮工具循环）与活动任务智能体（1 次只读 JSON 输出，`activity-task-runner.ts:14–45`）。改协议只能改 `agent_rpc_before_activity_tasks`，**不能覆盖分发器**（见迁移文件 32–33 行注释）。

---

## 2. 工具定义清单

### 2.1 注册方式

```ts
// agent-runner.ts:24-34   ——  唯一真源：zod strictObject
const schemas = { get_scene: z.strictObject({}), … };
// :35-37 中文描述（Record<keyof typeof schemas, string>）
// :43-46 阶段归属（Record<keyof typeof schemas, AgentPhase>，漏填编译不过）
// :47    z.toJSONSchema(schema,{io:'input'}) 转 OpenAI function schema
// :48    baseTools = tools 去掉 start_lux3d_model
```

- **schema 定义方式**：zod `strictObject` → `z.toJSONSchema(…, {io:'input'})`。未知字段直接拒绝（`INVALID_TOOL_INPUT`）。
- **新增工具必须同时补 3 张表**：`schemas`、`descriptions`、`phaseOfTool`（`Record<keyof typeof schemas,…>` 会在编译期强制）。
- 运行期参数二次校验：`schemas[name].parse(JSON.parse(tool.function.arguments))`（`agent-runner.ts:180`）。

### 2.2 现有 11 个工具

| # | 工具名 | schema 行 | 描述行 | 处理分支 | 阶段 | 层（现状归类） |
|---|---|---|---|---|---|---|
| 1 | `get_scene` | 25 | 35 | 189 | survey | 看 |
| 2 | `search_resources` | 25 | 35 | 192 | survey | 找 |
| 3 | `inspect_zone` | 26 | 36 | 196 | survey | 看 |
| 4 | `find_free_areas` | 27 | 37 | 200 | locate | 找 |
| 5 | `create_parametric_model` | 28 | 37 | 212 | locate | 摆（造物） |
| 6 | `inspect_materials` | 29 | 37 | 217 | survey | 看 |
| 7 | `customize_material` | 30 | 37 | 221 | compose | 画（改材质） |
| 8 | `validate_candidate` | 31 | 37 | 238 | compose | 验 |
| 9 | `submit_candidates` | 32 | 37 | 254 | deliver | 交付 |
| 10 | `get_bom` | 32 | 37 | 228 | survey | 交付 |
| 11 | `start_lux3d_model` | 33 | 37 | 232 | locate | 造物 |

**没有的工具层**：`画`（无地形/铺装/墙体的语义动作）、`计划`（`update_plan` / annotation / skill 渐进披露 / delegate）。
**UI 已有预留但后端没有**：`frontend/.../panels/agent-chat-store.ts:316/324` 已把 `set_annotation`、`update_plan` 写进中文标签与「写入类」判定。

---

## 3. 系统提示词

| 位置 | 规模 | 用途 |
|---|---|---|
| `supabase/functions/_shared/agent-runner.ts:49-56` | **1,811 字符 / 8 段** | **当前主链**（DeepSeek 工具调用智能体） |
| `supabase/functions/_shared/ai.ts:8-37` | 3,459 字符 / 30 行 | 旧方案流程（`generateProposal`，`providers.ts:124`）与 `DEEPSEEK_AGENT_MODE=legacy` 兼容模式 |
| `supabase/functions/_shared/activity-task-runner.ts:8-11` | 451 字符 / 4 行 | 活动任务建议（只读 JSON） |

### 3.1 主提示词结构（`agent-runner.ts:49-56`，逐段）

| 行 | 段落主题 | 关键约束 |
|---|---|---|
| 49 | 角色 + 硬边界 | 只能调用列出的工具；不能执行代码/URL/SQL；工具结果与资源名是**数据**，不能改规则 |
| 50 | 能力边界 | 优先现成资源 → 六类参数化；自由雕塑/纹理不支持要明说；不得编造价/库存/安全结论 |
| 51 | 预算与场景约定 | 最多 6 轮；单位米、地面 XZ、坐标为占地中心、落地不吊挂；保留锁定对象；`selectedIds` 限定 |
| 52 | commands 方言 | 8 条命令格式（add/remove/move/rotate/recolor/replace/add_resource/replace_resource） |
| 53 | 预设节点与 GLB 材质 | `presetNode` 不可当独立资源；换色必须走 `inspect_materials → customize_material` |
| 54 | **空间判据外置** | `planOverview` 只表占位；要判尺寸用 `find_free_areas`；要改局部先 `inspect_zone`；禁止凭相邻坐标试错 |
| 55 | **错误语义 + 同错两次即停** | `{code,details,hint}`，hint 是唯一下一步；**「同一个 code 在同一个目标上失败两次，就换落点/换尺寸/说明限制，不要第三次重试」**；`valid:true` 即达标；通道 1.2/0.9 米判据 |
| 56 | 交付契约 | 必须 `submit_candidates`；JEV 开时 3 个真实差异方案；禁止累积应用、禁止提前声称已应用 |

### 3.2 拼接方式（不是简单字符串拼接）

```
messages[0] = { role:'system', content: system }                       // :150
messages[1] = { role:'user',  content: JSON.stringify({                // :150
    instruction, context, scene: sceneContext(input.scene),
    planOverview: sceneDigest(input.scene),      // ← 空间摘要只在这里出现一次
    presetObjectLabels, selectedIds, sceneResourceRefs,
    currentResources, jevEnabled, catalog }) }
```

运行期还会插入 3 类临时 user 消息：

| 触发 | 位置 | 内容 |
|---|---|---|
| 改道备注 | 163 | 「用户在本次运行进行中追加了要求…」 |
| 最后一轮 | 165 | 「这是最后一次模型调用，请现在 `submit_candidates`」 |
| 模型没调工具 | 173 | 「请调用 `submit_candidates`；说明性回答也用一个空 commands 候选」 |

**注意**：`planOverview`（`<map_context>` 等价物）**只在第 1 条 user 消息里注入一次**，后续 5 轮不再刷新——这是第 2 项只能算「部分有」的核心原因。

---

## 4. 场景数据模型

### 4.1 类型定义

| 对象 | 文件 | 行 |
|---|---|---|
| `sizeSchema`（width/depth/height，米，上限 200/200/30） | `supabase/functions/_shared/domain.ts` | 20–24 |
| `pointSchema`（`{x,z}`，-200…400） | 同上 | 25 |
| `objectSchema`（物件） | 同上 | 38–55 |
| `venueSchema`（场地） | 同上 | 68–95 |
| `structureSchema`（墙/洞/柱） | 同上 | 107–119 |
| `sceneV1Schema` / `sceneV2Schema` | 同上 | 129–134 / 135–145 |
| `sceneSchema`（判别联合 `schemaVersion`） | 同上 | 146–158 |
| TS 类型导出（`Scene`/`SceneV2`/`SceneObject`/`Point`） | 同上 | 159–166 |
| `corners()`（旋转后四角） | 同上 | 184–190 |
| 前端 DTO 转换 | `frontend/components/room-organizer/lib/backend-adapter.ts` | 全文件 |

### 4.2 表示方式

| 概念 | 表示 |
|---|---|
| **坐标原点** | 场地边界角（矩形即 `(0,0)` 角）；多边形取 `polygon` 顶点坐标 |
| **轴向** | 地面 **XZ 平面**；`y` 只在 `elevation`/`height` 出现；提示词原文「地面XZ，坐标为占地中心，物件落地」 |
| **物件** | `{ id, materialId, position:{x,z}, rotation, size:{width,depth,height}, color, locked, notes, elevation?, assetId?, presetNode?, wallId? }` |
| **旋转** | 绕 Y 轴角度（度），逆时针为正；`-360…360` |
| **footprint** | **不存**；由 `footprint(o)` 实时算 4 个角点（`structural-geometry.ts:8`），旋转后仍是凸四边形 |
| **格子 / 地形** | **不存在地形层**。只有 `renderPlan()` 把米制场景采样成 ASCII 网格（`scene-digest.ts:61`），默认 cell 0.5 m、最多 48×30 格 |
| **结构层** | `SceneV2.structure = { walls[], openings[], columns[] }`；V1 场景无结构层，`structureOf()` 返回空数组（`scene-digest.ts:8`） |
| **单位** | 米（`sizeSchema` 全为米制）；样板见 `units.ts` |

### 4.3 平面渲染与空间摘要

| 能力 | 文件 | 行 |
|---|---|---|
| ASCII 图例（`c t r b d p , x A O # = E .`） | `scene-digest.ts` | 20 |
| 场地多边形（含矩形回退） | 同上 | 25–28 |
| 墙的占地矩形（按厚度向两侧展开） | 同上 | 45–54 |
| `renderPlan()`（按 `cell` 米一格，x 横向、z 向下） | 同上 | 61–100 |
| 最大空方（动态规划） | 同上 | 112–132 |
| `sceneDigest()`（venue / structure / occupancy / footprint / largestEmptySquare / plan / notes） | 同上 | 148–199 |
| `inspectZone()`（矩形局部：ASCII + 墙/洞/柱/物件/出入口） | 同上 | 214–237 |
| 空间工具封装 | `placement-search.ts` | 95–172 |

---

## 5. 已有的校验能力

| 能力 | 文件 | 函数 | 行 | 说明 |
|---|---|---|---|---|
| **结构违规（墙/柱/越界）** | `_shared/structural-geometry.ts` | `structuralViolations()` | 24–32 | `WALL_COLLISION` / `COLUMN_COLLISION` / `OUT_OF_BOUNDS`；含门窗开洞扣除、挂墙合法性 `validMount()`（14–23） |
| **不新增违规（只允许减轻）** | 同上 | `canApplyStructuralChange()` | 33 | apply 时逐项比对穿透深度 |
| **结构警告（给前端）** | 同上 | `structuralWarnings()` | 34 | 转 `{code, ids}` |
| **重叠/越界警告** | `_shared/domain.ts` | `sceneWarnings()` | 191–225 | V1 边界采样 + 分离轴重叠；地毯豁免；按高度分层 |
| **尺寸冲突（确认尺寸 vs 实测）** | `structural-geometry.ts` | `dimensionConflicts()` / `measurement()` | 91–94 / 63–89 | 支持平面图标定反算 |
| **净距（到最近物件/墙/柱/边界）** | `_shared/clearance-report.ts` | `clearanceReport()` | 67–90 | `polygonGap()` 39、`boundaryGap()` 53；只量被命令碰到的物件 |
| **合法落点搜索** | `_shared/placement-search.ts` | `findFreeAreas()` | 95–172 | 米制网格扫描，带 `clearance` 膨胀；返回可直接写入的锚点与最近出入口 |
| **命令级校验** | `_shared/ai.ts` | `buildProposal()` | 60–136 | 逐条应用命令；末尾统一跑结构/尺寸/警告，抛 `OUT_OF_BOUNDS`/`STRUCTURAL_COLLISION` 等 |
| **错误 → 指令** | `_shared/agent-runner.ts` | `errorHints` + `safeError()` | 76–92 | 每个 code 附带中文 `hint` |
| **HTTP 层同样校验** | `_shared/api.ts` | `PUT /scene` | 229–235 | `dimensionConflicts` + `canApplyStructuralChange` |
| **提案应用校验** | `_shared/api.ts` | `POST /proposals/apply` | 262–268 | 同上 + revision/hash/lease |
| **候选去重** | `_shared/agent-runner.ts` | `diversityKey()` | 62–65 | 忽略 id/notes/color，按内容哈希判「是否真的是新方案」 |

---

## 6. 对照 10 项：现状与最小改动落点

> 图例：✅ 已有 · 🟡 部分有 · ❌ 完全没有

| # | 能力 | 状态 | 现状（文件:行） | 差什么 | 最小改动落点 |
|---|---|---|---|---|---|
| 1 | 工具分层（看/找/画/摆/计划/交付） | 🟡 | 11 工具已隐含 4 层；`phaseOfTool` 已有「阶段」映射（`agent-runner.ts:43-46`） | 无显式分层元数据；无「画」「计划」两层工具 | `agent-runner.ts:43` 旁新增 `layerOfTool: Record<keyof typeof schemas, AgentLayer>`；分层只进提示词与文档，不改执行路径。新增工具时同表补齐 |
| 2 | 每轮注入 `<map_context>` | 🟡 | `sceneDigest()` 全量注入（`agent-runner.ts:150`）；`inspect_zone` 可按需局部读（`:196`） | **只在第 1 条消息注入一次**，后续 5 轮不刷新；无 `<map_context>` 包裹；无「本轮净距/占用变化」 | `agent-runner.ts:158` 轮循环开头重建 `sceneDigest(input.scene)`（运行期场景不变，可加 `turn` 与 `lastTool` 摘要）；若支持中途外部改动，改为 `call('refresh')` 拉新快照。渲染成本低（`scene-digest` 纯函数，<5ms） |
| 3 | `update_plan`（注释即图纸，步骤带完成谓词） | ❌ | 只有 `progress` 字符串与自动推断的 `phase`（`agent-progress.ts:58/68`）；UI 已预留标签（`agent-chat-store.ts:316`） | 无 plan 数据模型、无工具、无「完成谓词」、无阶段完成状态 | 新建 `_shared/agent-plan.ts`：`PlanStage{id,title,intent,doneWhen,zone?}`；`agent-runner.ts:32` 加 `update_plan` schema；`:254` 前加分支写 `call('plan',{stages,completedStages})`；迁移新增 `agent_runs.plan jsonb`；`agent-contract.ts:32` 扩 `agentRunSchema` |
| 4 | 三档监督（严格/关键节点/自动） | 🟡 | UI 已有三档（`use-supervision-mode.ts:14/18/51`，`agent-chat.tsx:44/150-176`），落 `localStorage` | **不参与任何请求**；后端只有 `preview/direct` 两态（`agent-contract.ts:16`），且 `direct` 由**中文正则**判定（`agent-runner.ts:59-61`） | ① `agent-contract.ts:13` 加 `supervision: z.enum(['strict','checkpoint','auto'])`；② `creative-studio.tsx:951` 请求体带上 `mode`；③ `agent-runner.ts:59` 用 `supervision` 取代正则，`strict` 逐命令 `validate` 后再提交 |
| 5 | 运行中改道（下一轮生效） | ✅ | 迁移 `20261105150000:68-94`（note / take_notes）；`agent-runner.ts:162-163`；前端 `creative-studio.tsx:765-778` + `agent-run-panel.tsx:148-155`；测试 `tests/agent-steering.test.ts` | — | 无需改动。可选增强：备注带 `zone` 让模型只重算该区 |
| 6 | 阶段化进度（survey→locate→compose→deliver） | ✅ | `agent-progress.ts:15/21/58/68`；`agent-runner.ts:157/164/187`；迁移 `20261105150000:21/81-84/105-111`；前端 `agent-run-panel.tsx:21/30`；测试 `tests/agent-phase.test.ts` | 阶段是**工具自动推断**，不是模型自报 | 与第 3 项合并：`update_plan` 的 `completedStages` 直接驱动 phase，保留 `advancePhase()` 的单向钳制 |
| 7 | `scene_rev` 防并发脏写 | 🟡（架构等价） | 运行期不写库；apply 时 `base_revision`+`base_hash`+`lease` 三重校验（`scene_core.sql:229-237`）；`require_lease` 每次工具前复检（迁移 `:103`） | 无「读工具回执带 rev / 写工具校验 rev」；`direct` 模式下 90 秒内无法感知外部改动 | 不建议加 per-tool rev（与现有快照模型冲突）。最小改动：`validate_candidate` 回执加 `baseHash`，`agent-rpc 'checkpoint'` 前比一次 `projects.revision`，不一致直接 `STALE_SCENE`（迁移 `:118` 分支） |
| 8 | 候选打分 scorecard + `submit_candidates` | 🟡 | `submit_candidates`（`agent-runner.ts:32/254-269`）；去重 `diversityKey`（`:62`）；JEV 概率评价（`jev.ts:41-74`）；repair 仅 1 次（`:267`） | 无**确定性**评分（尺寸/通道/动线/物料数），无排序，不拒绝「未 validate 就提交」 | 新建 `_shared/scorecard.ts`：`scoreCandidate(scene, touched)` 复用 `clearanceReport`+`structuralWarnings`+`sceneDigest.occupancy` 出 0–100 分；在 `agent-runner.ts:260-266` 排序、把 `scores` 放进 `finish` 结果、`agentContract` 增加 `score` 字段；`submit_candidates` 前置「必须至少 validate 过一次」 |
| 9 | 同错两次即停（tripwire） | 🟡 | 仅**提示词**有（`agent-runner.ts:55`）；`frontend/lib/agent-governance.ts:160` 已有 `DampingTable`（同 key ≥2 → `STOP_RETRY`，回滚 ≥4 → `STOP_HARD`） | 提示词不是强制；`DampingTable` **只被测试引用**，未接入生产 | 在 `agent-runner.ts:271`（`catch` 处）加运行内 `Map<code+target, count>`；`>=2` 时把工具结果改成 `{code:'REPEAT_BLOCKED', hint:'这个错已经出现两次，换落点/换尺寸或直接说明限制'}`，不再真正执行；或直接复用 `DampingTable` 搬进 `_shared` |
| 10 | 场景模板 / 配方（RECIPES，按活动类型） | 🟡 | ① `frontend/lib/recipe.ts`（117 行，`Recipe` 五要素 + `recipeHash`）② `recipe-proposal.ts`（148 行，`deriveSeededVariants`）③ `creative-studio.tsx:10` 已接编号显示 ④ 预设场景 10 类（`preset-manifest.json`：gym/popup/bar/cafe/conference/lawn/market/museum/office/studio）⑤ 旧 `layout` 模板只有 salon/networking（`ai.ts:19-20、73-92`） | 配方**只服务前端本地生成**，不进智能体；无「亲子/适老/市集/演出/露营/展览」布局套路；无负向范例 | 新建 `_shared/agent-recipes.ts`：`RECIPES: Record<ActivityKind,{zones:ZoneSpec[],notes:string[],forbidden:string[]}>`；在 `agent-runner.ts:150` 的 user payload 里按 `context.brief` 选 1–2 个配方注入（不是全量，避免提示词膨胀）；`submit_candidates` 前用配方 `zones` 做区域命中率打分（与第 8 项共用 scorecard） |

### 6.1 状态汇总

| 状态 | 条目 |
|---|---|
| ✅ 已有（2） | 5 运行中改道、6 阶段化进度 |
| 🟡 部分有（7） | 1 工具分层、2 map_context、4 三档监督、7 scene_rev、8 scorecard、9 tripwire、10 RECIPES |
| ❌ 完全没有（1） | 3 `update_plan` |

---

## 7. 测试基础设施

### 7.1 命令

| 目的 | 命令 | 说明 |
|---|---|---|
| 边缘函数全量单测 | `npm test` | = `vitest run tests/`（`vitest.config.ts` 只收 `tests/**/*.test.ts`） |
| 单文件 | `npx vitest run tests/agent-phase.test.ts` | 已实测通过（3 tests / 2.9s） |
| 类型检查 | `npm run typecheck` | `tsc --noEmit`（根 tsconfig，含 `supabase/functions`） |
| Edge 类型检查 | `npm run check:edge` | `deno check` 三个入口 |
| 前端单测 | `npm --prefix frontend test` | = `vitest run`（`frontend/vitest.config.ts`，`app|components|lib` 三目录） |
| 前端单文件 | `npm --prefix frontend exec -- vitest run components/room-organizer/panels/creative-studio.react.test.tsx --root frontend` | React 套件按文件 `// @vitest-environment jsdom` |
| 本地智能体联调 | `npm run dev:agent` | `scripts/local-agent-run.ts`：真实 `createApi` + PGlite + **模型桩**（回放 `get_scene → submit_candidates`），无需模型额度 |
| 组合检查 | `npm run check` | typecheck + tests |

### 7.2 智能体相关测试文件（`tests/`，共 17 个 / 2,382 行）

| 文件 | 行 | 覆盖 |
|---|---|---|
| `tests/agent-runs.test.ts` | 333 | 持久化运行、6 轮上限、幂等重放、取消、部分候选保留、legacy 回退 |
| `tests/agent-steering.test.ts` | 77 | 改道注入时机、取走不重复、收尾后拒收、空/超长备注 |
| `tests/agent-phase.test.ts` | 98 | 阶段落库、只进不退、老记录不显示 |
| `tests/agent-progress.test.ts` | 41 | `progressLine` 文案与边界 |
| `tests/agent-space-tools.test.ts` | 158 | `planOverview` 可见、拒绝→下一步、阶段进度、净距回执、`failedCommand` |
| `tests/agent-model-tools.test.ts` | 130 | 材质副本边界、候选真实性、取消后停止造物 |
| `tests/agent-materials.test.ts` | 28 | 材质建议契约 |
| `tests/agent-lux3d.test.ts` | 65 | 工具按环境投放、付费路径 |
| `tests/agent-model-reply.test.ts` | 70 | 模型回复解析、重复 tool id 拒绝 |
| `tests/scene-agent.test.ts` | 120 | 资源引用、锁定对象、尺寸约束、加色冒充纹理 |
| `tests/scene-agent-api.test.ts` | 95 | 端到端授权 → 提案 → 落库 |
| `tests/scene-digest.test.ts` | 86 | ASCII 平面、占用统计、最大空方 |
| `tests/clearance-report.test.ts` | 75 | 净距计算（物件/墙/柱/边界） |
| `tests/placement-search.test.ts` | 117 | 落点搜索、间隙、拒绝统计 |
| `tests/jev-context.test.ts` | 86 | 三方案比较上下文压缩 |
| `tests/activity-task-runs.test.ts` | 378 | 活动任务运行（另一条智能体） |
| `tests/activity-task-client.test.ts` | 328 | 活动任务客户端契约 |

公共夹具：`tests/fixtures.ts`（`database()` 起 PGlite + 迁移；`owner/studio/session/scene/chair`）、`tests/local-server.ts`。

### 7.3 前端 agent 测试

| 文件 | 覆盖 |
|---|---|
| `frontend/.../panels/creative-studio.react.test.tsx` | 发起/预览/应用、JEV、direct 开关、恢复 |
| `frontend/.../panels/agent-run-panel.react.test.tsx` | 运行条、阶段、改道计数 |
| `frontend/.../panels/agent-chat.react.test.tsx` | 四格对话、监督档 UI、运行条改道 |
| `frontend/.../three/agent-preset-flow.test.ts` | `submit_candidates` 与 `tool_choice` 收尾 |
| `frontend/lib/agent-governance.test.ts` | `DampingTable` / `Governor`（**唯一引用者**） |

---

## 8. 最关键的 5 个改动落点（按性价比排序）

| 序 | 落点 | 文件 : 行 | 动作 | 影响 |
|---|---|---|---|---|
| **1** | 计划层 | 新建 `supabase/functions/_shared/agent-plan.ts`；改 `agent-runner.ts:32`（schema）、`:254` 前（分支）、`agent-contract.ts:32`、迁移加 `plan jsonb` | 引入 `PlanStage{title,intent,zone?,doneWhen}` + `update_plan` 工具；`completedStages` 驱动既有 `advancePhase()` | 一次性补齐第 3 项，并把第 6 项从「自动推断」升级为「模型自报 + 单向钳制」 |
| **2** | 每轮空间上下文 | `agent-runner.ts:158`（轮循环头）+ `scene-digest.ts:148` | 每轮重建 `map_context`：ASCII 平面 + 结构统计 + 占用率 + **上一轮工具造成的增量**（净距/占用变化） | 第 2 项转 ✅；直接改善「第 3 轮起凭记忆画图」的漂移 |
| **3** | 强制 tripwire + scorecard | `agent-runner.ts:271`（catch）与 `:254-269`（submit）；新建 `_shared/scorecard.ts` | 运行内 `Map<code+target,count>` ≥2 转 `REPEAT_BLOCKED`；`submit_candidates` 按确定性分数排序并写入 `finish.scores` | 第 9 项转 ✅、第 8 项转 ✅；不依赖模型自觉，成本最低 |
| **4** | 监督档接线 | `use-supervision-mode.ts:51` → `creative-studio.tsx:951` → `agent-contract.ts:13` → `agent-runner.ts:59` | 三档进请求体；`agentExecutionMode()` 用显式档位取代中文正则；`strict` 要求逐命令 `validate_candidate` | 第 4 项转 ✅；消除「正则猜用户意图」这一最脆弱的判定 |
| **5** | 配方库注入 | 新建 `_shared/agent-recipes.ts`；改 `agent-runner.ts:150` | 按 `context.brief` 选 1–2 个活动配方（亲子/适老/市集/演出/露营/展览），注入正向套路 + 负向范例；与 scorecard 共用区域命中率 | 第 10 项转 ✅；提示词只增加约 300–500 字符，不碰执行链 |

> 不建议做：per-tool `scene_rev`（第 7 项）。现有「运行期只读 + apply 三重校验」已经等价，强加 per-tool rev 会与快照模型冲突，且要改 11 个工具回执。若确需，只加 `checkpoint` 前的一次 `projects.revision` 比对即可。

---

## 附录 A：关键符号索引

| 符号 | 文件 : 行 |
|---|---|
| `createApi` | `supabase/functions/_shared/api.ts:42` |
| `executeAgentRun` | `supabase/functions/_shared/agent-runner.ts:93` |
| `schemas` / `descriptions` / `phaseOfTool` / `tools` | 同文件 `24` / `35` / `43` / `47` |
| `system`（主提示词） | 同文件 `49–56` |
| `errorHints` / `safeError` | 同文件 `76` / `88` |
| `agentExecutionMode` | 同文件 `59` |
| `diversityKey` / `sceneContext` | 同文件 `62` / `67` |
| `agentRunRequestSchema` / `agentRunSchema` | `_shared/agent-contract.ts:13` / `32` |
| `AGENT_PHASES` / `advancePhase` / `progressLine` | `_shared/agent-progress.ts:15` / `58` / `68` |
| `parseAgentModelReply` | `_shared/agent-model-reply.ts:149` |
| `chatRequest` / `generateProposal` | `_shared/providers.ts:108` / `124` |
| `SYSTEM_PROMPT`（旧） / `buildProposal` / `commandsSchema` | `_shared/ai.ts:8` / `60` / `42` |
| `sceneDigest` / `inspectZone` / `renderPlan` | `_shared/scene-digest.ts:148` / `214` / `61` |
| `structuralViolations` / `canApplyStructuralChange` / `dimensionConflicts` | `_shared/structural-geometry.ts:24` / `33` / `91` |
| `clearanceReport` | `_shared/clearance-report.ts:67` |
| `findFreeAreas` | `_shared/placement-search.ts:95` |
| `evaluateCandidates` | `_shared/jev.ts:41` |
| `sceneWarnings` / `objectSchema` / `sceneSchema` | `_shared/domain.ts:191` / `38` / `146` |
| `DampingTable` / `Governor` | `frontend/lib/agent-governance.ts:160` / `228` |
| `useSupervisionMode` | `frontend/.../hooks/use-supervision-mode.ts:51` |
| `startAgentRun`（客户端） / `steerAgentRun` / `applySceneProposal` | `frontend/lib/backend-session.ts:1081` / `1109` / `1186` |
| `followRun` / `applyCandidate` | `frontend/.../panels/creative-studio.tsx:752` / `968` |

## 附录 B：需要注意的「已写但未接线」代码

| 位置 | 现状 | 迁移时怎么用 |
|---|---|---|
| `frontend/lib/agent-governance.ts`（289 行） | `ToolSpec` / `DampingTable` / `Governor` 全部实现，**只被 `agent-governance.test.ts` 引用** | 第 9 项直接搬到 `_shared/`，或在 `agent-runner.ts` 内联等价计数 |
| `frontend/.../agent-chat-store.ts:316/324` | 已把 `update_plan`/`set_annotation` 列为「规划类」「写入类」 | 第 3 项落地后无需改 UI 标签 |
| `frontend/lib/recipe.ts` + `recipe-proposal.ts` | 配方与 seed 已可用，但只服务本地生成（`creative-studio.tsx:10`） | 第 10 项的配方常量可从这里派生，避免两套活动类型枚举 |
| `frontend/lib/agent-governance.ts` 的 `Governor`（40 轮 / 3 轮无写入 nudge） | 与后端 6 轮上限不一致 | 若接入，请把 `maxTurns` 改为由 `agent_rpc` 的 `call_count` 上限派生，不要写死两份数字 |
| `DEEPSEEK_AGENT_MODE=legacy`（`agent-runner.ts:107-114`） | 保留旧单次生成路径 | 迁移新工具时记得这条分支不会经过工具循环 |
