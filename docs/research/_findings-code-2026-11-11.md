# 代码静态猎手发现清单（2026-11-11 · 车道 4）

- 审计对象：`C:\mujing\Scendance2026`（main，HEAD 469b0b6e；仅 `frontend/tsconfig.json` 一处本地未提交改动，`.next/` 未跟踪，均非本轮修改对象）
- 范围：只读代码核查，未改业务代码、未提交、未推送、未开 PR
- 方法：Read/Grep/Glob 阅读 + `npm --prefix frontend run typecheck`（exit 0，无类型级契约断裂）；未跑 vitest（已知约 411 例 jsdom/WebGL 环境性失败，不计回归）
- 另：另一棵树 `C:\幕景\Scendance2026`（旧分叉）未纳入审计，本报告不引用其文件
- 与浏览器三车道报告 `_findings-browser-2026-11-11.md` 互为佐证，重复条目标注历史/浏览器编号

---

## 一、历史待办逐项状态（A 清单）

| # | 待办 | 代码层状态 | 证据 |
|---|---|---|---|
| A1 | 工具流水人话化（工具名→人话动词 i18n 映射，对照 PetitMaker OpRow 语系） | **已接线**（有小残留，见 P3-3） | 云工具 14 个在 `supabase/functions/_shared/agent-runner.ts:81-114` 有中文 description 与 progressLabels；前端三份标签表：`frontend/components/room-organizer/lib/tool-trace.ts:26-59`、`panels/agent-run-panel.tsx:54-59`、`panels/agent-chat-store.ts:451-458` |
| A2 | 状态头五态（思考/施工/完成/停止 + 计时） | **部分接线** | 头部状态机在 `panels/agent-panel.tsx:3074-3092` bingoHeaderStatus：空闲/生成中/先停着/没出成/发现问题/等你确认/已出方案；但运行面板头部 `panels/agent-run-panel.tsx:202` 仍是 `isRunning` 二分（「正在处理」/「本次运行已结束」），未区分 思考 / 施工 / 全部完成 / 已停止 / 就绪；计时（elapsed）已接，但仅运行中显示，停止后清零（`agent-run-panel.tsx:174,204,210`） |
| A3 | 相对位移指令（「往左一点」→ 步进 + 碰撞避让） | **部分接线**（线上仍失败，见 P1-1） | 模糊位移解析 `lib/workbench-agent.ts:395-399`（0.3m 步进）；冲突备选落点 `lib/agent-proposal.ts:1071-1077` nearbySpot；目标解析与别名缺口见 P1-1 |
| A4 | 费用计量接线（按量计费/额度提示接到调用链） | **未接线**（对话/方案链）；仅重建链路有扣次 | `_shared/http.ts:10-14` reserveCost 只读 env 上限是否配置，不查余额、不扣减；`_shared/provider-cost-bound.ts` 是管理员策略校验（不记账本）；真实扣次只在 `supabase/functions/pay-api/index.ts`（scan_consume/release RPC），服务于重建/扫描任务；LLM agent-runner 链无按用户额度/计费提示。产品口径待拍板（见待拍板 2） |

## 二、历史 P1/P2 残留核对（B 清单）

| # | 历史问题 | 代码层结论 | 证据 |
|---|---|---|---|
| B1 | 导出交接/清单导出不出文件（freezeDialogueForExport 判定链） | **已接线** | `panels/agent-panel.tsx:710-719` freezeDialogueForExport（reviewDialogueHistory 同判定链）；`panels/scene-delivery-panel.tsx:313-408` 各 kind 均走 downloadSceneDelivery/downloadTextFile；CSV 转义完备 `lib/scene-delivery.ts:152-223`（双引号翻倍、BOM、CRLF） |
| B2 | 「打开资料」错弹账户面板（openMaterialsFromShare 绑定） | **已接线** | `room-organizer.tsx:638-642`：`setWorkbenchMode('layout'); showAgent('material')`，注释明确不再进账户中心 |
| B3 | 件数口径 25/26 不一致（门洞计数口径） | **部分残留**，见 P3-4 | 两侧共用 `isStructuralMarker`（`lib/structural-layout.ts:247-252`）；但评审页 `review-share-page.tsx:354` placedCount 多一层 `item.position` 判空，工作台 `structural-layout.ts:252` materialCount 与 `agent-panel.tsx:1830` 均不判空 |
| B4 | 评审反馈 -0.00 与 Bingo 计数不同步 | **-0.00 已修；计数同步部分残留**，见 P2-1 | -0.00 归零：`panels/bingo-audit-card.tsx:263-266`（近零取整到厘米再消负零）；计数缺口：见 P2-1 |
| B5 | 咨询句被误路由成重排 | **已接线（本地规则侧）**，统一对话侧观察项见 P3-7 | `lib/general-activity-question.ts:12` 意见/风险类排除重排词；`lib/workbench-agent.ts:153` 非布局意图 classifyLocalLayout 返回 null；路由门 `agent-panel.tsx:2571` |
| B6 | 场地高斯样例与自选场地冲突 | **已接线** | `room-organizer.tsx:2179` 有地图场地时摘样例；`2186-2191` map venue 停挂；`2209-2220` 尺寸变化只摘 DEMO_WORLD_SCENE_ID、保留用户自选；刷新时 venueScaleRef 为 null 提前返回，不误摘 |

---

## 三、新发现（C 清单）

### P0

无。未发现崩溃、数据损坏、越权或安全类确定性问题。

### P1

#### P1-1 相对位移目标解析三处缺口：「课桌」无别名、量词未剥离、批量位移不支持（代码层佐证浏览器 P1-1）
- 严重级：**P1**
- 所属车道：代码静态
- 线上是否可复现：可推断在线上复现（浏览器车道 `_findings-browser-2026-11-11.md` P1-1 已实测：「把课桌整体往左挪一点」「把所有桌子往左挪30厘米」均回「场地里没有这件」）
- 触发条件：在已落盘的课桌式方案上，用「课桌/桌子 + 所有/整体 + 方向位移」句式要求批量或类名位移。
- 实际行为 vs 期望行为：
  - 实际：本地规则把句子解析成单目标 op，目标角色匹配失败 → 报「场地里没有这件」；多件同角色无方位词时判歧义，不做批量位移。
  - 期望：类名（课桌/桌子/椅）能匹配到对应 type；量词「所有/整体/全部」剥离后按类批量位移；匹配不到时追问「想挪哪一张」，而不是硬说场地里没有。
- 证据：
  1. 角色别名表缺「课桌」：`lib/agent-proposal.ts:760-763` —— `桌子: ['table','desk','dining-table','桌子']`、`桌: ['table','desk','桌']`、`椅子/椅`，无 `课桌` 条目；`matchesRole`（767-781）别名查不到时回退 `[key]`，字段（type/name/materialId/assetId/notes）均不含「课桌」→ 不命中。线上课桌件 type/materialId 为 `desk`、name 为英文「Desk · n」（浏览器 P2-5），中文「课桌」匹配不上。
  2. 量词未剥离：`lib/workbench-agent.ts:340-342` cleanRole 只剥句首敬语与句尾助词，不剥「所有/整体/全部」；`parseTarget`（345-357）返回 role 形如「所有桌子」，`matchesRole` 精确/包含匹配均失败。
  3. 批量不支持：`lib/agent-proposal.ts:786-788` 多件命中且无 side → `{ item: null, ambiguous: true }`；修订 op 循环（1025-1031）按单件解析，无批量 move 分支。
  4. 裸宾语不支持：`lib/workbench-agent.ts:390,395` vague 正则目标组 `(.+?)` 要求至少一个字符，「往左挪一点」（无宾语）不匹配。
- 相关历史：A3 相对位移指令；浏览器 P1-1。

### P2

#### P2-1 Bingo 评审钉计数读 V1 存储，v2 分享方案钉写 V2，徽章计数可能漏计
- 严重级：**P2**
- 所属车道：代码静态
- 线上是否可复现：待线上复核（代码层高度嫌疑）
- 触发条件：打开 `/review/#layout=` 链接方案落钉 → 回工作台看 Bingo/评审反馈徽章计数。
- 实际行为 vs 期望行为：
  - 实际：链接方案的 planKey 为 `review-v2:<hash>`，评审页读写 V2 键；Bingo 反馈读取走 V1 键，V1 文件里没有该 planKey → 徽章钉数为 0（或不含本次钉）。
  - 期望：Bingo 计数与评审页钉列表同源同键。
- 证据：
  - 写 V2：`review-share-page/review-share-page.tsx:94`（readExactReviewSharePins）、`:202`；`review-share-page/share-pins.ts:81-101`（planKey 以 `review-v2:` 开头写 V2 键）。
  - 读 V1：`lib/bingo-feedback.ts:61-63` 循环 `readReviewSharePins(key, storage)`；`share-pins.ts:45-51` readReviewSharePins 只读 `REVIEW_SHARE_PIN_STORAGE_KEY`（v1，:16）；V2 读取函数 readExactReviewSharePins（:54-63）未被 Bingo 侧调用。
  - planKey 来源：`lib/review-share.ts:245` `reviewPlanKey = review-v2:${...}`。
- 备注：未发现 V2→V1 迁移或双写；若线上 Bingo 徽章仍有数，可能另有云同步兜底，需线上复核确认。
- 相关历史：B4 / 历史 #9。

#### P2-2 对话与方案生成链无用户额度/按量计费提示（历史待办 A4 未接线）
- 严重级：**P2**（现状可能是产品有意下线付费入口，定级为待拍板观察项，不是缺陷回归）
- 所属车道：代码静态
- 线上是否可复现：代码层可推断
- 触发条件：登录用户在对话链连续发起理解/方案/候选轮次。
- 实际行为 vs 期望行为：
  - 实际：agent-runner 与 brief/conversation 链不查用户余额/次数，不返回剩余额度，界面无额度提示；`reserveCost` 仅校验 env 上限是否配置，未配置抛 BILLING_NOT_CONFIGURED。
  - 期望（若产品要按量）：调用前校验剩余额度、超限给人话提示；调用后回写用量。当前重建链路（pay-api scan_consume/release）已有扣次与返还，对话链没有对应接线。
- 证据：`_shared/http.ts:10-14`；`_shared/agent-runner.ts:450-453`（aholoReady 的 reserveCost 存在性判断）、`:746`（reserveCents 随 job 记录）；`_shared/provider-cost-bound.ts:1-5` 注释明确「不预留资金、不认证价目表、不计数 token、不强制共享预算」；付费卡片 `components/pay/price-card.tsx:151-153` 仅展示订单剩余次数。
- 相关历史：A4；HANDOFF 宏观计划「物料无价、价格两套账、免费额度代码为零、付费入口暂下线」。

### P3

#### P3-1 导出竞态 `stillCurrent()` 失败时静默返回，无任何提示
- 严重级：**P3**
- 所属车道：代码静态
- 线上是否可复现：代码层嫌疑（竞态窗口内触发）
- 触发条件：导出过程中活动/楼层/会话/检查点发生变化，`stillCurrent()` 返回 false。
- 实际行为 vs 期望行为：多处分支 `if (!stillCurrent()) return;` 直接退出，不抛错、不写 notice；用户点了导出按钮，既无文件也无提示。
- 证据：`panels/scene-delivery-panel.tsx:344, 354, 362, 364, 370, 372, 381, 386, 391, 402`；对照同文件 :317/:319/:326/:329/:333/:358 等路径是抛 Error 进 catch 出人话提示（:365/:373/:387/:398 为成功路径的下载调用）。
- 期望：竞态退出也给一句「方案已变化，未导出，请重新核对」。

#### P3-2 Agent 事件流未做形状校验，异常响应可推入 undefined 字段
- 严重级：**P3**
- 所属车道：代码静态
- 线上是否可复现：待线上复核（旧服务/异常响应时）
- 触发条件：`getAgentRunEvents` 返回的 events 数组含缺字段条目。
- 实际行为 vs 期望行为：`appendAgentRunEvents` 直接读 `event.seq/tool/stage/outcome` 并入库；seq 缺失时 `event.seq<=last` 为 false，会推入 seq=undefined 的条目。调用方 catch 只置 `eventUnavailable`，不做逐条形状校验。
- 证据：`panels/agent-chat-store.ts:350-357`；调用点 `panels/creative-studio.tsx:1496-1503`。
- 期望：逐条 zod/形状校验，坏条目跳过并计数，不污染事件日志。

#### P3-3 工具名→人话标签表分散三处，未知工具兜底行为不一致
- 严重级：**P3**
- 所属车道：代码静态
- 线上是否可复现：代码层嫌疑
- 实际行为 vs 期望行为：云工具事件行未知工具兜底「处理任务」（`agent-run-panel.tsx:249`）；本地步骤行未知工具回退原始 toolName（`agent-chat-store.ts:457` chineseToolLabel 原样返回）；另有 `tool-trace.ts:26-59` 第三份表。新增工具时三处都要补，漏一处就出现英文/标识符裸奔。
- 证据：`lib/tool-trace.ts:26-59`；`panels/agent-run-panel.tsx:54-59`；`panels/agent-chat-store.ts:451-458`。
- 期望：收敛为单一映射表，未知工具统一兜底人话（或统一原始名策略）。

#### P3-4 件数口径：评审页多一层 position 判空，工作台不判空，null-position 件两侧计数会差 1
- 严重级：**P3**
- 所属车道：代码静态
- 线上是否可复现：待线上复核（仅当存在 position 为 null 的非结构件时出现）
- 实际行为 vs 期望行为：评审页 placedCount 过滤 `item.position && !isStructuralMarker`；工作台 materialCount 与候选卡只过滤结构标记。存在未落位（null position）物料时，两侧件数不一致。
- 证据：`review-share-page.tsx:352-355`；`lib/structural-layout.ts:247-252`；`agent-panel.tsx:1830`。
- 相关历史：B3 / 历史 #7、#8。浏览器本轮实测 36 件两侧一致（浏览器报告 #8 ✅），故仅为口径残留嫌疑。

#### P3-5 相对位移模糊步进 0.3m，与设计口径 0.5m 不符；裸宾语句式不解析
- 严重级：**P3**
- 所属车道：代码静态
- 线上是否可复现：代码层可推断
- 实际行为 vs 期望行为：vague 分支固定 `vec * 0.3`（米）；任务背景记录的设计步进为 0.5m。「往左挪一点」这类无宾语句式正则不匹配。
- 证据：`lib/workbench-agent.ts:395-399`（0.3）；`:390` 目标组 `.+?`。
- 备注：步进取值需产品拍板；避让策略为冲突时给 nearbySpot 备选落点，不自动改落位（`agent-proposal.ts:1071-1077`）。

#### P3-6 AI 占比分子只取 provenance.source='ai'，本地规则生成件落 procedural，工作单可能显示「AI 占 0%」
- 严重级：**P3**（佐证浏览器 P2-6）
- 所属车道：代码静态
- 线上是否可复现：浏览器车道已实测 36 件全 Agent 落盘却显示 AI 0%（浏览器 P2-6）
- 实际行为 vs 期望行为：本地规则/提案落盘件打 `procedural`（`agent-panel.tsx:402-405`），provenanceBreakdown 的 aiPct 分子只计 `ai`，procedural 单列；若界面文案写「AI 占布置件」，procedural 件不计入 → 0%。
- 证据：`lib/deliverable-inventory.ts:208-233`（bucketProvenance、aiPct = ai/deployable）；`agent-panel.tsx:405`；`room-organizer.tsx:2997-2998`（云端候选才打 ai）。
- 期望：明确口径——要么 aiPct 纳入 procedural（文案改「系统生成占比」），要么工作单文案区分 AI / 程序生成。

#### P3-7 咨询句只读守卫在统一对话（BRIEF_CONVERSATION_ENABLED=1）开启时不经过本地规则
- 严重级：**P3**
- 所属车道：代码静态
- 线上是否可复现：待线上复核
- 触发条件：`NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED==='1'`（生产统一对话）时发送意见/风险类咨询句。
- 实际行为 vs 期望行为：`agent-panel.tsx:2571` 的 `isGeneralActivityQuestion` 分支条件为 `!unifiedConversation && CONVERSATIONAL_CHAT_ENABLED==='1'`；统一对话开启时该本地只读守卫被跳过，是否只读完全依赖模型侧与 conversation-api 契约，本地规则不再兜底拦截误重排。
- 证据：`agent-panel.tsx:2569-2571`；`general-activity-question.ts:6-20`；`workbench-agent.ts:153`。
- 期望：统一对话链也复用同一套咨询句判定作为只读兜底，或在契约里显式标注该路径由模型保证。

#### P3-8 事件轮询旧服务无 events 字段时静默降级，无可见说明
- 严重级：**P3**
- 所属车道：代码静态
- 线上是否可复现：待线上复核
- 实际行为：`creative-studio.tsx:1492` 注释「An old service may not expose events; failure never prevents the task」；catch 后置 `eventUnavailable=true` 直接返回，界面步骤流空白但无「进度暂不可用」类提示。
- 证据：`panels/creative-studio.tsx:1490-1505`。
- 期望：事件不可用时在运行条给一句人话降级说明。

---

## 四、工程旁证

- `npm --prefix frontend run typecheck`：exit 0（tsc --noEmit 无报错），前后端类型契约在编译期未发现断裂。
- 未跑 vitest；已知 `agent-panel.react` 等约 411 例 jsdom/WebGL 环境性失败，按口径不计回归。

## 五、各档发现数（代码静态车道）

- P0：0
- P1：1（P1-1 相对位移目标解析缺口）
- P2：2（P2-1 Bingo 钉计数 V1/V2 缺口；P2-2 对话链计费/额度未接线）
- P3：8（P3-1 至 P3-8）

## 六、未复现 / 待线上复核

- 历史 #2 堵门无警告、#12 多会话编辑锁竞争：本轮纯静态未触达运行时，未下结论。
- P2-1、P3-2、P3-4、P3-7、P3-8 标注「待线上复核」，代码层嫌疑未在浏览器实测闭环。
- B1/B2/B6 代码层判定已接线；线上复验以浏览器车道报告为准（#5/#6 ✅、#4 未测）。

## 七、需要用户拍板

1. **P1-1 相对位移**：本地规则是否要补「课桌/桌子/椅子」类名别名 + 量词（所有/整体/全部）剥离 + 同批类名批量位移；还是由模型工具层在系统提示/目录里把 AI 生成件显式标成中文类名？（与浏览器待拍板 1 同项）
2. **P2-2 计费口径**：对话/方案链当前确实无按量计费与额度提示——是维持「付费仅重建」的现状，还是要把额度校验接到 brief/agent 调用链？
3. **P3-5 位移步进**：模糊位移步进定为 0.3m（现状）还是设计稿的 0.5m？
4. **P3-6 占比口径**：工作单「AI 占布置件」是否应把 procedural（本地规则生成）计入系统生成占比，或改文案区分两类？
