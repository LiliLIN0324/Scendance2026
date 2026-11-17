# eventProfile P0 契约草案（v2 · 字段表 + 迁移面 + 只读聚合）

> 配套：`docs/plans/2026-11-17-event-producer-bot-gap-plan.md`（v3，P0-1/P0-5）。
> 目的：先把字段、边界、迁移面与验收对齐，再写代码。形状示意不作为最终代码。
> 口径：沿用 `venue-facts` 的状态/来源/修订模式与 `commercial-dossier` 的金额形状；不新造第二套。
>
> **v2 修订（2026-11-17）**：① 每个事实增加独立修订号与更新留痕（对应原文「一条一事」）；② 新增 `expectedAttendance`（预期到场，用户声明）；③ 新增 §4.2 `eventBrief` 只读聚合契约——状态回答只能来自当前记录 + `asOf`；④ 验收扩到 T1–T18。

## 0. 一句话

`eventProfile` 是**活动级、本地、客户投影安全**的元信息侧车；它只收既有真值里没有的东西，不重复活动名/类型/人数，不覆盖场地几何，不参与商务金额。

## 1. 归属与不归属

| 信息 | 真值位置 | `eventProfile` 是否存 | 理由 |
|---|---|---|---|
| 活动/项目名 | `RoomLayout.name`、`projects.name` | 否 | 再加第三处必然分叉 |
| 活动类型 | `CreativeBrief.event` + `eventConfirmed` | 否 | 简报已有确认标记 |
| 目标人数 | `CreativeBrief.guests` + `guestsConfirmed`（解析走 `user-attendance`） | 否 | 人数只有一个计数点 |
| **预期到场人数** | 无 | **是** | 与目标人数语义不同（目标 vs 预判）；用户声明，不从名册或家具推算 |
| 风格/色系/氛围 | `CreativeBrief.style/palette/atmosphere` | 否 | 创意输入，不是执行元信息 |
| 场地几何/门/容量 | `venue-facts`（sidecar） | 否 | 只放行政地名，不碰尺寸与容量事实 |
| 金额/合同/付款/签署 | `commercialDossier` | 否 | 预算只录用户给的估算与实际，不读档案反推 |
| 任务/负责人/时段 | `eventOperations` | 否 | 流程单挂任务，不在档案里复制 |
| 日期、时间窗、时区 | 无 | **是** | 调度与当天包的读依赖 |
| 城市、场地名（行政） | 无（简报只有 `venueConditions` 自由文本） | **是** | 客户产物与当天包需要 |
| 预算（估算/实际） | 无 | **是** | 复盘对照用；仅内部 |
| 目标结果 | 无（`mustHave` 是布置要求，不是目标） | **是** | 复盘对照用 |
| 分工（角色/负责人） | 无（`ownerName` 在任务、`roleName` 在排班行） | **是** | 自由文本，不建成员表 |

**结论**：7 个字段组。每多一个字段就多一处需要解释"为什么和别处不一样"。

## 2. 类型与标注模型

```ts
type FactStatus = 'confirmed' | 'pending' | 'inferred' | 'unknown';
// preset          = 地区/系统预填，未经用户确认
// imported_file   = 来自导入文件或既有记录
// model_inference = 模型或规则推断
type FactSource = 'user_statement' | 'imported_file' | 'preset' | 'model_inference' | 'unavailable';

interface Fact<T> {
  value: T | null;
  status: FactStatus;
  source: FactSource;
  note: string;          // 来源原文/依据；inferred 必填
  revision: number;      // 该事实最后一次变更时的集合版本号
  updatedBy: string;
  updatedAt: string;
}

interface MoneyFact { amountMinor: number | null; currency: 'CNY' | null; basisNote: string; }

interface EventProfile {
  schemaVersion: 1;
  revision: number;              // 集合级 CAS，任何事实变更 +1
  updatedBy: string; updatedAt: string;
  date: Fact<string>;            // 'YYYY-MM-DD'，年份不得为 0000
  timeWindow: Fact<{ startTime: string; endTime: string; timeZone: string; endsNextDay: boolean }>;
  venue: Fact<{ city: string; venueName: string }>;
  budget: Fact<{ estimate: MoneyFact | null; actual: MoneyFact | null }>;
  expectedAttendance: Fact<number>;   // 整数，0–100000；用户声明
  goal: Fact<string>;
  division: Fact<{ roleName: string; ownerName: string }[]>;
}
```

### 2.1 不变量

1. `status === 'unknown'` ⇒ `value === null`、`source === 'unavailable'`、`note === ''`；`revision === 0` ⇒ `status === 'unknown'`（反向不成立：清空过的事实保留版本号与更新人）
2. `status === 'confirmed'` ⇒ `source ∈ {user_statement, imported_file}`；`preset`/`model_inference` 升 `confirmed` 一律拒绝。
3. `status === 'inferred'` ⇒ `note` 必填、`source === 'model_inference'`。
4. `status === 'pending'` 允许**带值**——"已填、未确认"是最常见状态。
5. 集合 `revision === 0` ⇒ 七个字段全 `unknown`，`updatedBy/updatedAt` 为空。
6. 每个事实的 `revision` 等于它最后一次变更后的集合版本号；集合版本严格 `+1`（改回旧值也不例外），作为 CAS 依据。
7. 写入走 `updateEventProfile(profile, patches, expectedRevision)`：`expectedRevision` 不匹配即拒绝；**一次写入可含多条事实**，但每条事实各自记版本与更新人（原文「一条一事」）。
8. `expectedAttendance` 只接受用户输入：不得由名册、家具、场地容量或 `guests` 推导；与 `guests` 之间**不做**大小校验（预期可高于或低于目标，均属用户判断）。

## 3. 字段表

| 字段 | 内容 | 上限/格式 | 空态 | 备注 |
|---|---|---|---|---|
| `date` | 活动日期 | `YYYY-MM-DD`，`z.iso.date()`，年份 > 0000 | `unknown` | 与 `timeWindow` 分开：日期可确认而时刻待定 |
| `timeWindow.startTime/endTime` | 本地墙上时刻 | `HH:mm`（24h） | `unknown` | **不存 UTC 瞬间**，瞬间在读取时算 |
| `timeWindow.timeZone` | IANA 时区 | 运行时 `Intl.DateTimeFormat` 校验存在 | `unknown` | 非法/不可解析直接拒绝，**不回落系统时区** |
| `timeWindow.endsNextDay` | 是否跨天 | boolean，默认 `false` | — | `endTime <= startTime` 时必须显式 `true`，不默认跨天 |
| `venue.city` / `venue.venueName` | 城市 / 场地名 | 城市 ≤ 60；场地名 ≤ 120 | `unknown` | 纯文本；**不推导**尺寸/容量 |
| `budget.estimate` / `budget.actual` | 预算估算 / 实际 | `amountMinor: int ≥ 0 \| null`；已知金额必须 `'CNY'` 且 `basisNote` 非空 | `unknown` | 形状同 `commercial-dossier-contract.amountObject`；不接报价、不做汇率 |
| `expectedAttendance` | 预期到场人数 | 整数 0–100000 | `unknown` | 用户声明；当天包与体检读它，不读家具 |
| `goal` | 目标结果 | ≤ 500 | `unknown` | 与 `mustHave`（布置要求）区分 |
| `division` | 分工 | ≤ 50 项；`roleName` ≤ 40；`ownerName` ≤ `handoffLimits.ownerName` | `unknown` | 自由文本；不做别名归一，逾期清单显示原文名 |

限额取现有常量：`productionPlanLimits`、`handoffLimits`、`commercialDossierLimits`，不新造数字。

## 4. 派生量（一律不落盘）

### 4.1 时间瞬间

| 派生 | 来源 | 规则 |
|---|---|---|
| `startsAt` / `endsAt` | `date` + `timeWindow` + `timeZone` | 读取时用 `Intl` 计算。夏令时**不存在**或**有歧义**的时刻 ⇒ `null` + 原因，要求用户确认，**不替用户选偏移** |

### 4.2 `eventBrief` 只读聚合（P0-5）

```ts
eventBrief(input: {
  profile: EventProfile | null;
  brief: CreativeBrief;
  tasks: EventOperations['tasks'];
  roster: GuestRoster | null;        // P2 才接，可为 null
  dossier: CommercialDossier | null;
  now: string;                       // ISO，带偏移
}, mode: 'countdown' | 'dayOf' | 'recap') =>
  { asOf: string; quiet: boolean; sections: { id: string; items: string[] }[] }
```

**输入纪律**

- 只接**当前记录**。不接对话历史、AI 摘要、缓存状态、上一次运行结果。原文「这些文件才是记录，聊天记录不是」。
- 输入里没有的东西就是没有：不得用默认值补齐，不得用模型知识补日期/电话/人数。

**输出纪律**

1. 无开场白、无收尾客套；每项一行。
2. 每个数字标注来源类别：`清点` / `估算` / `待回填`；未确认的以"待确认"字样出现，不用确定口吻。
3. `asOf` 必出，值为本次计算所用记录的版本时间戳（取所读对象中最新的 `updatedAt`）。
4. **安静模式**：无到期 **且** 无逾期 **且** 无变化时 `quiet = true` 且 `sections` 为空；三者任一不成立即出内容。**有逾期必出**，即使其他都没变。
5. **缺数据整段省略**：没有 roster 就不出人数段；没有 `needsTravel` 数据就不出接送段。不出只有表头的空段。
6. **无进行中活动**：返回 `quiet = false` 且单条一句话说明，然后停止，不生成其余段落。

**分段（照原文的五段，可整段省略）**

| 模式 | 段落 |
|---|---|
| `countdown` | 距活动天数 / 今天到期或逾期（每行带负责人原文名）/ 两周内未确认 / 报名 vs 预期到场 / 临期缺口（饮食未答复、`plusOnes` 未问、`needsTravel` 未定、7 天内到期的酒店截止——无出行数据则省略该项） |
| `dayOf` | 按时间排的流程（每行负责人 + 电话）/ 供应商到达时间与电话 / 人数（报名 vs 预期到场）与饮食无障碍统计 / 接送（无数据省略）/ 未确认未完成 + 预案 |
| `recap` | 指标对照 / 邀请-报名-出席-到场率 / 花费对照预算（按约定为类别）/ 有效与无效 / 跟进清单（跳过 `optedOut`）/ 三个回填项（实际出席、表外花费、现场感受） |

### 4.3 客户投影

| 派生 | 来源 | 规则 |
|---|---|---|
| `publishView` | `eventProfile` + `CreativeBrief` | 白名单：活动名、日期、时间窗+时区名、城市、场地名、目标人数（仅 confirmed 显示确定值）、目标结果。预算/分工/内部备注/预期到场/供应商状态/任务负责人一律不导出 |

## 5. 存储与解析

- 位置：`RoomLayout.eventProfile?: EventProfile`，与 `productionPlan`/`eventOperations` 同层（`frontend/components/room-organizer/lib/types.ts:435`）。
- 读取：`parseStoredLayout` 用 `eventProfileSchema` 校验；坏档案拒绝整份布局，不静默丢弃；`designBook` 变体带档案即拒绝。
- 分享/发布：`layoutForExport(layout, true)` 一并删除 `eventProfile`，与 `eventOperations`/`productionPlan` 同组处理。
- 版本：`schemaVersion: z.literal(1)` + `strictObject`。
- **`absent` 与"空档案"必须区分**：无该字段 = 从未创建（读取层不合成、不默认、不写回）；显式空档案 = 全 `unknown` 且 `revision === 0`。
- 解析函数单独导出（`parseEventProfile`）：坏数据**不静默重置**，返回错误并保留原文。

## 6. 迁移面清单

| # | 面 | 决策 | 风险 | 验证 |
|---|---|---|---|---|
| M1 | `RoomLayout` 侧车 | 加可选字段，不改现有字段 | 低：旧布局自然 `absent` | 旧布局加载后 `not.toHaveProperty('eventProfile')` |
| M2 | 本地项目备份 | coverage 加键 `eventProfile: true`，版本升 **V5**（完整备份：V4 + 档案）与 **V6**（本机归档：V3 点验 + 档案，不含图片）；V1–V4 读取行为不变 | 中：现有测试要求 coverage 精确相等，混版必须拒绝 | V1–V4 正文带 `eventProfile` ⇒ 拒绝并提示用 V5/V6；V5/V6 缺 `coverage.eventProfile` ⇒ 拒绝；V5 必须有图片字段，V6 必须有点验且不得有图片 |
| M3 | `designBook` 变体 | 变体**禁止**携带 `eventProfile`；发现即拒绝，不静默剥离 | 中：变体内嵌完整 `RoomLayout` | 变体含该键 ⇒ 解析报错；恢复后只有顶层有 |
| M4 | `sitePlanDataSchema` | **不动**。已是 `strictObject` + `literal(1)`，且 `g2-m3-blueprint` 已记录同一个墙 | 高（若误加）：云端场景与分享整套失败 | 守卫测试：发布/分享 payload 键集合不含 `eventProfile` |
| M5 | 客户产物投影 | `publishView` 白名单，逐字段 pick | 中：spread 后 delete 会漏 | 键集合精确相等；预算/分工/内部 `note`/预期到场/供应商状态/任务负责人不得出现 |
| M6 | AI 上下文 | profile 可读，带 `status/source` 标签；不得把 `model_inference` 写成 `confirmed`；写回走"提案预览 → 确认 → 落盘" | 中：模型容易把"看起来合理"的时区/预算填成确认 | `model_inference + confirmed` 被拒；AI 提案落盘前必经确认 |
| M7 | 商务档案 | 不互相同步：profile 预算不写档案，档案金额不写 profile；仅靠 `projectId` 关联 | 低 | 交叉写入测试 |
| M8 | 时间读取 | 调度只消费派生 `startsAt`，不自行拼时区字符串 | 中：手拼是经典错误源 | 两次读取同一瞬间；歧义时刻返回 `null` |
| M9 | 状态回答来源 | 一切状态回答走 `eventBrief`，带 `asOf`；输入类型排除对话/摘要/缓存 | 中：旧摘要冒充现状 | 输入类型级约束 + 同一记录不同调用顺序结果一致 |

## 7. 验收测试（P0 完成定义）

| # | 断言 |
|---|---|
| T1 | 旧布局/旧备份无 `eventProfile`，恢复后是 `absent`，不是全 `unknown` 空壳 |
| T2 | 显式新建空档案后 `revision === 0` 且七组全 `unknown`，界面显示"待确认"而非默认值 |
| T3 | `model_inference` / `preset` 升 `confirmed` 被拒绝，错误可读 |
| T4 | 只有 `date` 确认、`timeWindow` 未知时，日期显示已确认、时刻显示待确认（不得把已确认降级） |
| T5 | 非法/不存在时区被拒绝，且**不回落**系统时区 |
| T6 | `endTime <= startTime` 且 `endsNextDay !== true` 被拒绝 |
| T7 | 夏令时不存在/歧义时刻 ⇒ 派生瞬间为 `null` + 原因 |
| T8 | 已知金额缺 `basisNote` 或缺 `CNY` 被拒绝；未知金额只留原文 |
| T9 | `expectedRevision` 不匹配即拒绝；改回旧值仍 `revision + 1` |
| T10 | `publishView` 键集合精确相等，不含预算/分工/内部备注/预期到场/供应商状态/任务负责人 |
| T11 | 备份混版三种情况全部拒绝且原因可读：V1–V4 正文带 `eventProfile`、V5/V6 缺 `coverage.eventProfile`、V5/V6 变体带 `eventProfile`；V2 候选冒充 V5/V6 亦拒绝 |
| T12 | 发布/分享 payload 与 `SitePlanData` 均不含 `eventProfile` |
| T13 | 每个事实的 `revision` 等于其最后变更时的集合版本；`revision === 0` 的事实必为 `unknown`；被清空回 `unknown` 的事实保留 `revision > 0` 与更新人 |
| T14 | 一次写入改两个字段：两条事实各自更新 `updatedBy/At`，集合只 `+1` |
| T15 | `expectedAttendance` 拒绝负数/小数/超限；无任何路径可由 `guests`、roster、容量推导出该值 |
| T16 | `eventBrief` 三条件同时成立才 `quiet`；有逾期时即使无变化也出内容 |
| T17 | 无 roster 时 `eventBrief('countdown')` 不出人数段；无 `needsTravel` 时不出接送段；无进行中活动只出一条并停止 |
| T18 | `eventBrief` 输出必带 `asOf`；同一记录在 `now` 推进一天后"距活动天数"按 `timeZone` 正确变化；换输入顺序结果不变 |

## 8. 明确不做

- 不建工作室成员表；分工自由文本，不做别名归并，不据此推断"谁没交"。
- 不存第二份人数、活动名、类型；不覆盖 `venue-facts` 的几何/容量事实。
- 不做预算结算、比价、汇率、发票；不接档案金额反推预算。
- 不用对话摘要或 AI 记忆回答状态；`eventBrief` 只读当前记录。
- 不做定时任务本体（P3-1），P0 只保证时区与时间语义可被安全消费。
- 客户产物不出现预算、分工、内部备注、预期到场与供应商状态。

## 9. 落地顺序

1. `lib/event-profile.ts`：类型 + `Fact<T>` 不变量 + 纯函数（`emptyEventProfile`、`updateEventProfile`、`parseEventProfile`）+ 测试 T2–T9、T13–T15。
2. `lib/event-brief.ts`：`eventBrief` 三模式 + 安静/缺段/无活动规则 + 测试 T16–T18（用固定记录与固定 `now`，不依赖系统时钟）。
3. 存储接入 `RoomLayout`（M1）与 `publishView`（M5）+ 测试 T10、T12。
4. 备份 V5 与变体守卫（M2、M3）+ 测试 T1、T11（`frontend/lib/event-profile-storage.test.ts`）。
5. 收尾：AI 上下文只读化（M6）、档案不互相同步（M7）、派生瞬间与歧义规则（M8）、状态回答来源约束（M9）+ 全量 `tsc` + Vitest。

第 1、2 步不碰 UI，可与 P1-0 的材料起草接口设计并行；第 3 步之后才上卡片。

## 10. 实现状态（2026-11-18）

| 面 | 落点 | 证据 |
|---|---|---|
| 契约与纯函数 | `frontend/lib/event-profile.ts`、`frontend/lib/event-brief.ts` | `event-profile.test.ts`（23）、`event-brief.test.ts`（18） |
| M1 侧车 | `RoomLayout.eventProfile`；`parseStoredLayout` 用 `eventProfileSchema` 校验，坏档案整份拒绝；`LAYOUT_KEYS` 白名单保留 | `event-profile-storage.test.ts`（17） |
| M2 备份 V5 | `LOCAL_PROJECT_BACKUP_V5_VERSION` / `_V5_COVERAGE`、`serializeLocalProjectBackupV5`、`parseLocalProjectBackupJson`、`validateLocalProjectRestoreCandidate` | V1–V4 夹带档案拒绝；V5 缺 `coverage.eventProfile` 拒绝；V2 候选冒充 V5 拒绝；V5 往返保留档案 |
| M3 变体守卫 | `isRoomLayout` 与 `parseLayoutEventOperations` 拒绝变体携带档案 | 同上 |
| M4 发布边界 | `layoutForExport(layout, true)` 删除 `eventProfile` | T12 键集合断言 |
| 本机归档 V6 | `createLocalProjectBackupV6` / `serializeLocalProjectBackupV6`；`local-activities` 接受 V3/V6，带档案项目写 V6，旧 V3 快照不得抹掉已归档档案 | `event-profile-storage.test.ts`、`local-activities.test.ts` |
| M6 AI 上下文 | `frontend/lib/event-profile-context.ts`：只读事实视图（状态/来源/依据/版本）+ 固定文本；模型只能产提案，落盘要确认人且 CAS 匹配 | `event-profile-context.test.ts`（14） |
| 恢复与新建 | `prepareLocalRestoreLayout` / `commitLocalLayout` 允许档案通过；活动列表 `previewLayout` 与新活动沿用 `placementForNewActivity` 明确剥离档案 | `local-project-restore.test.ts`、`local-activities.test.ts` |
| P1-1 任务联系人 | `eventOperations` 任务新增可选 `contactName/contactPhone/zoneId`；缺省不补空值，旧任务字节不变 | `event-operation-contacts.test.ts`（5） |
| V5 含图片归档 | `createLocalProjectBackupV5WithDocuments` 同步重建；归档接受 V3/V5/V6，有图片写 V5，旧快照不得抹掉图片或档案 | `local-activities.test.ts`、`local-project-backup.test.ts` |
| P1-0 材料起草 | `draftMaterialTasks` 只按制作需求起草准备任务，不补数量/价格/供应商/时间；`appendMaterialTasks` 幂等追加 | `material-draft.test.ts`（7） |
| 档案卡片 | `components/event-profile/event-profile-card.tsx`：只读事实 + 推断标注 + 内部字段默认隐藏 + 提案预览/确认人门禁 | `event-profile-card.react.test.tsx`（5） |

尚未接入（下一步）：

- 卡片尚未挂载到具体面板（组件与门禁已就绪，需定宿主与保存入口）；P2 供应商六态声明视图仍待做。
- V5（含图片）仍不能直接进本机归档：归档只收 V6，遇到 V5 会明确拒绝，不静默丢图片；需要图片随档保存时另做附件存储。
- 本轮验证：受影响 15 个套件逐一通过（备份与档案、恢复、活动列表、评审分享、后端联调、`parseStoredLayout` 消费方），`npx tsc --noEmit` 无输出；全量 Vitest 因既有慢用例（GLB 取模、后端联调）未在本轮跑完。
