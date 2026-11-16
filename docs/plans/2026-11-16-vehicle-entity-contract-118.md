# 车辆实体落盘契约（#118）

2026-11-16 · Scendance2026 · `feat/people06-labor` · HEAD `46ec7e80`（= origin/main）· 只出方案，不改 schema/代码

**结论**：主方案 **B —— 顶层 `vehicles` 独立集合**（车有自己的 id/type/count/routeIds/modelSlug），回退 **C —— 路线级 `vehicleType`**；**不采用 A（塞进 `planWorkerSchema`）**，因为 `count` 语义会与六处人数统计冲突，3D 会把一辆大巴渲染成 6 个人。

标注约定：**【已核实】**＝读过代码；**【推断】**＝结构推演、未跑测试。行号取本任务读取时的磁盘状态；3D 文件行号已用 `git show 46ec7e80:` 复核（工作树含 #102/#117 未提交改动）。

## 1. 现状

### 1.1 契约是三层 `strictObject`

| 位置 | 事实 |
| --- | --- |
| `_shared/site-plan.ts:294` | `sitePlanDataSchema` 为 `strictObject`；`boundary/zones/facilities/routes/nodes/workers` 必填（`:315` routes ≤200、`:317` workers ≤500），`measurements/annotations/buildings/designScope/levels` 可选 |
| `:334` 起 | `superRefine`：跨集合 ID 唯一、`levelId` 指向 `levels`、`zoneId` 存在、`route.start/endNodeId` 存在、几何去重 |
| `:216` 起 | `planWorkerSchema`：`id/role/count(1–9999)/position` + 可选 `routeIds/activityZoneIds/zoneId/color/levelId/assetId/notes` |
| `:430` | `sitePlanSnapshotSchema` 同为 `strictObject`（信封 + `data`） |
| `:192` | `routeCarrier()`：显式 `carrier` → `vehicle`→`vehicle`、`service`→`mixed`、其余 `walk`；注释写明「布点、冲突判定、图例三处一律经此函数」 |

### 1.2 九种车已有清单，但没有落盘路径

`lib/vehicle-types.ts`：`:36` `VEHICLE_TYPES` 九条（`coach/business/daily/taxi/bus/bike/cleaning/garbage/truck`），`kind`（人行/车辆/后勤）与 `carrier`（一律 `vehicle`）**两轴**；`:22` `VehicleType` 无尺寸字段；`:43 / :75 / :83 / :91 / :99` 五条 `modelSlugs: []`（服务大巴、公交、自行车、保洁车、垃圾车），注释写明「留空＝待补，照常能画这条车的流线，但不假装有模型」。

**没有任何集合引用 `VEHICLE_TYPES`**【已核实】：全仓只命中本文件与未提交的 `vehicle-types.test.ts`。尺寸在物料库里：`assets/library/merged.json` 的 `models[].width/depth/height`——`saloon 2×4.822×1.403`、`city-car 1.828×3.592×1.533`、`box-truck 2.652×7.542×3.484`；有模型的四条全键 `car-park-and-road-vehicle-fleet-*`（未提交改动已把旧的 `road-vehicle-fleet-*` 校准为全键）。

### 1.3 `plan.workers` 消费面：72 文件（38 生产 + 34 测试）

`git grep -l -E '\bworkers\b' -- '*.ts' '*.tsx'`（仅跟踪文件，不含 node_modules / 备份工作树）命中 **72 文件 / 222 处**（38 生产 + 34 测试）；最重的是 `outdoor-plan-canvas.tsx`（28）、`outdoor-agent-planning.ts`（14）、`outdoor-plan-3d.tsx`（10）、`site-plan-routes.ts`（6）。

**人数语义硬编码在六处**（A 方案的核心障碍）：`site-plan-routes.ts:736 / :758` 按区/按岗汇总 `total += worker.count`；`site-plan-measure.ts:201-202` `workerTotalCount = Σcount`；`site-plan-legend.ts:206` 起「人员」组 `bucket.people += worker.count`；`site-plan-inventory.ts:159` 起行文本 `'${count} 人'`；`site-plan-pdf.ts:46` 封面 `人员：${workerTotalCount} 人`；`plan-footprint-geometry.ts:421` 画布标签 `${role} · ${count} 人`（测试 `:131` 断言 `'引导 · 6 人'`）。3D 侧更硬：`plan-crowd-placement.ts:17` `MAX_CROWD_INSTANCES_PER_WORKER = 24`、`:131` 起按 `count` 散布**人**模型——`count` 直接决定渲染人数。

### 1.4 2D / 3D 现状：车只有「线」，没有「对象」

- 2D：`outdoor-plan-canvas.tsx:3078` `createFlowWalkers()`；`flow-sim.ts:46` `walkerCountFor` 按 `routeCarrier` 分档（walk 12 / trolley 8 / mixed 10 / vehicle 6），`:29` `SPEED_RANGE`、`:37` `speedRangeForCarrier`（**后两处为未提交改动**，#102）；线色与图例也已按载体（`route-carrier-color.ts:19`、`site-plan-legend.ts:168`）。
- 3D：`outdoor-plan-3d.tsx` HEAD `:768` 起「人群层随 plan.workers 刷新」，`:787` 把 `workers/boundary/metrics/routes(kind,points)` 拼成 `crowdSignature`，`:801` 注释原文**「车流/后勤流本批不接动态对象」**；`plan-crowd-routes.ts:18` 只取 `kind==='pedestrian'`，即便某线 `carrier='vehicle'` 也不会挂动态对象。
- 车档数值口径已收敛：未提交的 `lib/vehicle-follower-profile.ts:1`（标注「任务 #117」）`:70` `speedRange: speedRangeForCarrier(carrier)`，`:40` 起 `BODY_PROFILE`（trolley 1.2×0.7、vehicle 4.8×1.9、mixed 速度按人占位按车），文件头写明「不碰 three、不读 plan、不写 schema」。

> **3D follower 的输入键已经是 `PlanRouteCarrier`，不是车实体**。任何方案都要喂 `carrier`，但只有实体方案能回答「这条线跑的是大巴还是货车、几台」。

### 1.5 M4 的原文要求

`docs/plans/2026-11-16-outdoor-agent-upgrade.md:105` 起（§M4）：「路线区分目的与当前通行属性。预览的设施使用**真实物料 ID 和尺寸**」「复用现有 2D/3D 同源方案数据。人群、岗位和流线预览可用来做现场走查，**动画回放不代表容量或合规核算**」。配合 §0 第 4/6/7 条（会做设计 / 一次做完 / 可回看取证），车辆的落盘形态必须能被选中编辑、被 3D 读同一份、被导出与回看。

## 2. 三个方案

### 2.1 A —— 扩展 `planWorkerSchema`

加可选 `vehicleType: z.enum(planVehicleTypes)` + 可选 `carrier`，车与岗位同构。

- ✅ 零新增集合：`PLAN_ENTITY_KEYS`、`filterPlanByLevel`、`canReanchorOutdoorPlan`、`carryNewEntities`、候选装配、快照哈希全部自动覆盖。
- ❌ `count` 二义且无类型区分手段（`z.infer` 只给 `number`）。默认路径**不是少功能，是数字错**：图例写「大巴 6 人」、PDF 把 6 台车算进人数、3D 在点位旁摆 6 个人，`MAX 24` 还会把 20 台车截成 24 个「人」。
- ❌ 修正需给六处 + 3D 散布逐个加分支；漏一处是**静默错数**（fail-open），而 B 的漏判只是**暂时看不见**（fail-closed）。`role` 必填还会逼出「大巴车/大巴车」这种把类型名再抄一遍的字段。

### 2.2 B —— 顶层 `vehicles` 数组（推荐）

- ✅ `count` 只有一种含义：**车数（台）**；不进任何人数统计。
- ✅ `modelSlug` 是物料库主键，正是 M4 要的「真实物料 ID」；尺寸按主键现算不落库（与 `site-plan.ts:9`「派生量一律从几何现算、不落盘」同口径）。
- ✅ 一车多线 / 一线多车（`routeIds` 数组）都能表达。
- ⚠️ 新增集合＝新增「集合枚举」：凡手写列举集合处都要补一行，否则丢数据或串层（§3.3）；写入方向仍被 `strictObject` 拒（§3.1）。

### 2.3 C —— 路线级承载（回退）

只给 `planRouteSchema:160` 加可选 `vehicleType`，车＝路线属性。

- ✅ 改动最小：不动任何集合枚举，图层/保护/候选全不用碰，旧数据零风险；与已落地的 `carrier`、`vehicle-follower-profile` 天然对齐。
- ❌ 表达不了数量（「这条线 2 台大巴」）与多车型混跑；一车跑多段（入口→落客→停车场）会退化成三条互不相关的属性。没有槽位放「真实物料 ID」：路线加 `modelSlug` 等于让几何携带资产，换车变成改几何记录。

### 2.4 D（提一句，不推荐）

用 `planFacilitySchema`（`site-plan.ts:86` 起）+ `templateId='coach'` + `modelOverride`：`size/rotationDeg` 必填、无 `routeIds`、会进设施图例/清单/占地与 `route-facility-collision`、占 2000 上限。**停放**能表达，**行走**不能。

### 2.5 六维对照

| 维度 | A 扩展 worker | B 顶层 vehicles | C 路线级 |
| --- | --- | --- | --- |
| 旧数据读取 | 安全（optional） | 安全（optional 集合） | 安全（optional 字段） |
| 旧解析器读新数据 | 拒（未知键） | 拒（未知键） | 拒（未知键） |
| `count` 语义 | 二义（人/车） | 单一（车数） | 无 count |
| 人数统计污染 | **六处必须加分支** | 无 | 无 |
| 真实物料 ID | 借 `assetId`（人物代号语义冲突） | `modelSlug` 直给 | 无处可放 |
| 2D/3D 同源 | 能（3D 会当人画） | 能（一份实体两处读） | 只能同源到「档」 |

## 3. 六个必答判断

### 3.1 旧草稿兼容

**读取方向安全【已核实】**：`strictObject` 只拒**多余**键，不拒**缺失**键。先例齐全——`levels`（`:41` 注释「旧数据不带 levels 照常解析」）、`measurements/annotations/buildings`、`planRoute.carrier`（`:163`「存量数据不带该字段照常解析」）、`facility.modelOverride`（`:130`）；`tests/site-plan.test.ts:271` 的 `keeps measurements optional and round-trips` 就是同款测试模式。

**写入/传输不安全——唯一真实风险【已核实】**：`site-plan-store.ts:73` `sitePlanSnapshotSchema.safeParse` 失败抛 `INVALID_SNAPSHOT`（保存被拒）；`site-plan-migrate.ts:219` `sitePlanDataSchema.parse` throw；`agent-contract.ts:49` `agentPlanObservationSchema` = `strictObject({ plan: sitePlanDataSchema, ... })` ⇒ **已部署的旧 edge function 收到带 `vehicles` 的 plan 会整包 400**；`plan-candidate.ts:347` 的 candidate added 结构同样 strict。

⇒ **部署顺序硬约束：服务端契约先上、前端后上**。`agent-contract.ts:46-48` 的注释（「Optional end-to-end so older clients and legacy workers ignore the field entirely」）只在旧端**不严格解析**时成立，本仓严格解析，顺序不能反。

**缺省值语义（不虚构字段）**：`vehicles` 缺省＝没有车，读取层**不得**合成空数组落盘（与 `levels` 的「合成默认层」不同：那是为了归层，这里是真没有数据）；`modelSlug` 缺省＝物料库无此车型 GLB，只能画线 + 占位盒并标「待补」，**不得**回落到近似车型；`routeIds` 缺省＝停放/待命点，不挂动态对象。

### 3.2 `count` 的语义

A 里必然二义，没有任何类型层手段区分。B 里唯一含义＝**车数（台）**，`1–99`（上限取小是为了让误填暴露在 parse 层）。它**不参与** `workerZoneSummary`、`workerRoleSummary`、`workerTotalCount`、图例人员组、PDF 人员行、清单 `metric`、`plan-crowd-placement` 散布。车辆自己的口径：图例新增「车辆」组（label＝车型名、`count`＝台数、detail＝`N 个点位`），清单 `metric = '${count} 台'`，CSV/GeoJSON 独立 `kind: 'vehicle'`。

### 3.3 改动面三档（B）

**必改（6 文件，不改＝丢数据/串层/误判）**

| 文件 | 原因 |
| --- | --- |
| `use-outdoor-agent-workflow.ts:162` `PLAN_ENTITY_KEYS` + `:214` `carryList` | 提案合并用**手写键表**比对「基座是否原样」；不加 `vehicles` → 基座后新画的车被提案覆盖，`baseStillIntact` 还会误判 |
| `plan-levels.ts:48 / :115` | `{...plan, 各类 filter}` 结构：不 filter 就**跨层出现在每个图层视图** |
| `outdoor-plan-protection.ts:5` | 手写 populated 清单；只有车的平面被判「空」，允许改锚点 ⇒ 全部车整体位移 |
| `site-plan.ts:334` `superRefine` | 跨集合 ID 唯一、`levelId`/`zoneId`/`routeIds` 引用 |
| `outdoor-plan-canvas.tsx:3861 / :5756 / :8107` | 切层合并 / 新建 / 选中——不加就画不出、选不中 |
| `outdoor-plan-3d.tsx:787`（HEAD） | `crowdSignature` 不含 `vehicles` ⇒ 挪车后 3D 不重建 |

**可延后（13 文件，只是这些出口暂时看不到车）**：`site-plan-legend.ts:206` · `site-plan-inventory.ts:159` · `site-plan-csv.ts:101` · `site-plan-geojson.ts:138` · `site-plan-png.ts:45`（导出外接框）· `site-plan-pdf.ts:46/57` · `site-plan-guide.ts:119` · `oneplan-stickers.ts:261` · `plan-footprint-geometry.ts:421` · `outdoor-interactables.ts:100` · `plan-candidate-preview.ts:35/48` · `plan-candidate-apply.ts:121/165` + `plan-candidate.ts:347` + `agent-runner.ts:108`（AI 产车）· `outdoor-plan-handoff.ts:5`（整体 `structuredClone(plan)`，**无需改**即可随导出手递）。

**明确不用改**：`site-plan-routes.ts:688/736/758`（人员专用）· `site-plan-measure.ts:201-202` · `plan-crowd-placement.ts:131`（车不走人群散布）· `flow-sim.ts:46`（路线级密度，与车实体无关）· `site-plan-conflicts.ts:243`（只看 carrier）· `plan-crowd-routes.ts:18`（只取 pedestrian）· `site-plan-store.ts`（信封不变）· `sitePlanHash`（`data` 整份哈希自动含 vehicles）· 34 个测试文件中除 §7 列出的以外全部不动。

### 3.4 2D / 3D 同源

- **同一份记录两处读**：2D 画 marker（`position` + 车型图标），3D 建实例，读的都是 `plan.vehicles[i]`。
- **速度**：`vehicleFollowerProfileFor(carrier)`（`vehicle-follower-profile.ts:70`），`carrier` 由 `type → VEHICLE_TYPES[].carrier` 派生。**不要**把 `carrier` 存进 vehicles——会出现两个真相，绕过 `routeCarrier()`（`:192`）这个单一决策点。
- **2D 布点 / 3D 实例数**：`walkerCountFor`（`flow-sim.ts:46`）是**路线级**密度，不能直接复用；需要纯函数 `vehicleFleetPlacements(routes, vehicles)` 按 `routeIds` 沿弧长铺开、速度取 `profile.speedRange`（本批不做也不影响落盘）。3D 每车实例数 `min(count, 24)`，与 `MAX_CROWD_INSTANCES_PER_WORKER` 同口径，避免 99 台卡死场景。
- **候选应用不能原样复用**：`plan-candidate-apply.ts:121` 是 `buildWorker` 分支、`:157` 的 `expected` 只拼五类 id；候选带 `added.vehicleIds` 会被**静默丢弃**（既不装配也不报 `missing-entity`）。需新增 `buildVehicle` + `planVehicleInputSchema` + `added.vehicleIds`；在此之前服务端不产车。
- **手递原样可用**：`outdoor-plan-handoff.ts:5` 把整份 `plan` `structuredClone` 进草稿 JSON，`limitations` 已写明「规划草案，未提供安全、消防或场地授权认证」。唯一副作用：导出的 JSON 含 `vehicles`，旧解析器读会被 strict 拒（同 §3.1）。

### 3.5 与 M4 对齐

- **ID**：`modelSlug` 取全键 `car-park-and-road-vehicle-fleet-*`；schema 只放 `z.string().min(1).max(160)` **不枚举**——物料库 976 条（`merged.json` `count=976`），枚举会漂。
- **尺寸**：不落库，渲染时按 slug 查 `merged.json` 的 `width/depth/height`（理由同为「派生量现算」；尺寸落库会在物料库换模型后出现库里库外两份数）。3D 占位盒只在**无 slug** 时用 `profile.bodyLengthM × bodyWidthM`（4.8×1.9）并标「尺寸为预览占位」。
- **缺模型的 5 种**（`coach/bus/bike/cleaning/garbage`）：`modelSlug` 缺省 → 2D 图标 + 线、3D 占位盒、图例/清单/PDF 显示「待补模型」。**禁止**拿 `box-truck`（2.652×7.542）充当大巴——真实大巴 12 m 级，用 7.5 m 箱货会把落客区与转弯半径都算小。【推断，由 `merged.json` 实测尺寸支撑】

### 3.6 冲突 / 容量口径

- **车流不新增交叉规则**。`site-plan-conflicts.ts:243` `isPedestrianVehiclePair` 已按「载体不同才算一对」，`:292-297` 只在交点落在设施占地上才报冲突，`:373-376` 只在 `carrier !== 'walk'` 且缺 `widthM` 时报「未评估」。车的通行属性仍写在它跑的**路线**上（`carrier` + `widthM`）——这正是 C 能当回退的接缝。
- **一致性校验（建议做）**：`superRefine` 校验 `vehicle.routeIds` 指向的路线 `routeCarrier(route) === 'vehicle'`。否则会出现「大巴挂在一条 `carrier='walk'` 的线上」：冲突层按载体判，**不会报任何问题**，图上却有车在人群里走。这是 B 唯一的新增风险，值得在 parse 层挡住。
- **容量**：`capacity-unverified` 只作用于观众区面积（`:50` 常量 `PLAN_AUDIENCE_AREA_PER_PERSON_M2`）。车不进容量；**不新增** `seats/pax` 之类载客量字段（那是无来源的业务假设）。
- **schema 注释建议原文**（随字段一起落）：「车辆实体仅用于 2D/3D 预览与现场走查；车数、车型与行进节奏**不代表**载客容量、通行能力、限速或合规核算。尺寸按物料库现算，缺模型的车型只画线与占位盒。」——与 `AGENT_PLAN_OBSERVATION_NOTICE`（`site-plan.ts:460`）和 M4「动画回放不代表容量或合规核算」逐字同源。

## 4. 结论：主 B，回退 C

车是「有型号、有台数、跑在某条线上」的实体，只有实体能同时满足 M4 的两条：真实物料 ID + 2D/3D 同源。A 的复用优势在「数字会错」面前不成立。

**回退 C 的触发条件（任一成立即降级，不混用）**：① 本批必须在一个切片内出可看结果，而 B 的 6 个必改文件（尤其 `outdoor-plan-canvas.tsx` 三处入口）排不进同一批；② 服务端不能在窗口内部署（B 依赖 `site-plan.ts` + `plan-candidate.ts` 先上）；③ 存在长混版本窗口（旧客户端/旧 edge 无法短期收敛）——C 只动一个文件、不动任何集合枚举。

**降级代价**：C 之后仍然「不知道这条线跑什么车、几台」，`modelSlug` 无处安放，M4 的「真实物料 ID」对车不成立。C 只能当过渡，不能当终态。

## 5. 字段级 zod 草图（评审用，未落任何文件）

```ts
// 位置：supabase/functions/_shared/site-plan.ts，紧跟 planWorkerSchema（现 :216 起）之后

export const planVehicleTypes = [
  'coach', 'business', 'daily', 'taxi', 'bus', 'bike', 'cleaning', 'garbage', 'truck',
] as const;                          // 与 vehicle-types.ts:36 的 VEHICLE_TYPES.id 逐条对齐，测试断言
export type PlanVehicleType = (typeof planVehicleTypes)[number];

/** 车型 → 走哪类动线。与 VEHICLE_TYPES[].kind 同值；不参与 carrier 判定。 */
export const planVehicleRouteKinds: Record<PlanVehicleType, 'vehicle' | 'service'> = {
  coach: 'vehicle', business: 'vehicle', daily: 'vehicle', taxi: 'vehicle', bus: 'vehicle',
  bike: 'vehicle', cleaning: 'service', garbage: 'service', truck: 'service',
};

/**
 * 车辆实体（2026-11-16 用户「把车从人群和基础设施里摘出来」；#118 契约）。
 * 与 planWorkerSchema 并列的独立集合，**不是**人员点位：count 是**车数（台）**不是人数；
 * routeIds 指向它跑的动线（可空 = 停放/待命点）；modelSlug 是物料库主键，缺省 = 库内无该车型
 * GLB（只画线 + 占位盒，**不得借用近似车型**）；尺寸按 modelSlug 从 merged.json 现算、不落库。
 * 仅用于 2D/3D 预览与现场走查；不代表载客容量、通行能力、限速或合规核算。
 * 可选集合：旧快照不带 vehicles 照常解析（缺省 = 没有车，读取层不合成、不落盘）。
 */
export const planVehicleSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(planVehicleTypes),
  count: z.number().int().min(1).max(99),
  position: planPointSchema,
  routeIds: z.array(z.uuid()).max(20).optional(),
  modelSlug: z.string().min(1).max(160).optional(),
  zoneId: z.uuid().optional(),
  levelId: z.uuid().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(s => s.toLowerCase()).optional(),
  notes: z.string().max(500).default(''),
});
export type PlanVehicle = z.infer<typeof planVehicleSchema>;
```

```ts
// sitePlanDataSchema（:294 起）内，workers 之后加一行
  /** 车辆集合（可选，2026-11-16 #118）：旧数据不带照常解析；缺省 = 没有车。 */
  vehicles: z.array(planVehicleSchema).max(200).optional(),

// superRefine（:334 起）三处增补
['vehicles', '车辆'],        // (1) ID 唯一：抄进 collections 表
...(plan.vehicles ?? []).map(item => [`车辆 ${item.type}`, item.levelId] as [string, string | undefined]),  // (2) 图层引用
for (const vehicle of plan.vehicles ?? []) {  // (3) 分区与动线引用
  if (vehicle.zoneId && !zoneIds.has(vehicle.zoneId.toLowerCase())) {
    ctx.addIssue({ code: 'custom', message: `车辆 ${vehicle.type} 的归属分区不存在` });
  }
  for (const routeId of vehicle.routeIds ?? []) {
    const route = plan.routes.find(r => r.id === routeId);
    if (!route) ctx.addIssue({ code: 'custom', message: `车辆 ${vehicle.type} 引用的动线不存在` });
    // 车必须挂在车行线上，否则冲突层按载体判会漏报「车在人群里走」。
    else if (routeCarrier(route) !== 'vehicle') {
      ctx.addIssue({ code: 'custom', message: `车辆 ${vehicle.type} 只能挂在车行动线上` });
    }
  }
}
```

```ts
// A（不采用，留档对比）：vehicleType: z.enum(planVehicleTypes).optional()  // count 仍是人数口径
// C（回退，留档对比）：同一行加在 planRouteSchema:160            // 无 count、无 modelSlug 槽位
```

## 6. 迁移顺序

1. **schema（服务端先合先部署）**：`planVehicleSchema` + `sitePlanDataSchema.vehicles` + 三条 `superRefine` 校验；`plan-candidate.ts` 加 `planVehicleInputSchema` 与空的 `added.vehicleIds`（本轮不接 AI 工具）。**部署完成前，前端不得写 vehicles。**
2. **前端读取层**：新建 `lib/vehicle-entities.ts`（`resolveVehicleCarrier(type)`、`vehicleModelSlugOf(vehicle)`、`vehicleSizeM(slug)` 查 `merged.json`）；补 `PLAN_ENTITY_KEYS`（`use-outdoor-agent-workflow.ts:162`）、`filterPlanByLevel`（`plan-levels.ts:48/115`）、`canReanchorOutdoorPlan`（`outdoor-plan-protection.ts:5`）、canvas 增删改三处（`:3861/5756/8107`）。做完这步：车能存、能选、能删，还没画出来。
3. **2D**：marker + 图例「车辆」组 + 清单/CSV/GeoJSON/PNG 外接框/PDF 分组；`vehicleFleetPlacements` 接画布流线预览。
4. **3D 接线**：`crowdSignature` 加 `vehicles`（HEAD `:787`）；每车按 `min(count,24)` 建实例，`modelSlug` → `crowdGlbUrl(slug)`，缺 slug 用 `profile.bodyLengthM × bodyWidthM` 占位盒，沿 `routeIds` 弧长前进，转向限速取 `turnRateRadPerSec`。
5. **（延后）候选与 AI**：`prepare_plan_vehicles` + `applyPlanCandidate` 分支 + 预览计数 + provider schema。

## 7. 兼容性测试清单

| 测试文件 | 断言意图 |
| --- | --- |
| `tests/site-plan.test.ts`（改） | ① 旧快照无 `vehicles` → parse 成功且 `plan.vehicles === undefined`（不合成空数组）；② 带 `vehicles` 往返不丢字段；③ 车辆 id 与 worker id 重复 →「实体 ID 与其他实体重复」；④ `routeIds` 指向 `carrier='walk'` 的线 → 报错；⑤ `count: 0` / `count: 100` → 拒 |
| `tests/agent-plan-candidate.test.ts`（改） | 候选 `added.vehicleIds` 指向不存在的实体 → `missing-entity` 阻断，**不允许**静默丢弃 |
| `lib/vehicle-types.test.ts`（已存在，未提交） | `planVehicleTypes` 与 `VEHICLE_TYPES.map(v=>v.id)` 顺序与取值逐条相等；五种空 `modelSlugs` 仍为空 |
| `lib/vehicle-entities.test.ts`（新建） | 九型 `carrier` 全为 `'vehicle'`；缺 slug 返回 `null` 而**不是**回落最近车型；`vehicleSizeM('…box-truck…')` = 2.652×7.542×3.484 |
| `lib/plan-levels.test.ts` + `lib/outdoor-plan-canvas.test.ts`（改；protection 无测试则新建 `outdoor-plan-protection.test.ts`） | 只返回本层 `vehicles`、不跨层泄漏；只有车的平面视为 populated，`canReanchorOutdoorPlan` 返回 `false` |
| `lib/outdoor-agent-planning.test.ts`（改） | 基座后新画的车经 `carryNewEntities` 仍在；只删车时 `baseStillIntact` 返回 `false` |
| `lib/site-plan-legend.test.ts`（改） | 出现独立「车辆」组（count＝台数）；「人员」组 `people` 合计**不含**车 |
| `lib/site-plan-inventory.test.ts` / `site-plan-csv.test.ts` / `site-plan-geojson.test.ts`（改） | worker 行数与 `metric` 不变；vehicle 行 `metric === '2 台'`、`kind === 'vehicle'` |
| `lib/site-plan-measure.test.ts`（改） | `workerTotalCount` / `workerPostCount` 不受 `vehicles` 影响 |
| `lib/vehicle-follower-profile.test.ts`（已存在，未提交） | 车辆实例由 `type→carrier` 取 profile；四档 `speedRange` 仍与 `speedRangeForCarrier` 恒等（不另立数字） |
| `lib/plan-candidate-apply.test.ts`（第 5 步再改） | 含 `vehicleIds` 的候选装配后 `plan.vehicles` +1，`applied` 含该 id |
| `lib/flow-sim.test.ts`（不改，作回归护栏） | `walkerCountFor` 仍按 carrier 分档，证明车实体没改变路线级布点 |

## 8. 仍需拍板（5 条，各带默认建议）

1. **`schemaVersion` 升不升 2？** 默认：**不升**，仍 `z.literal(1)`——可选集合向后兼容，升版本会让全部存量快照走一次迁移。只有决定「旧客户端必须被硬拒」时才升。
2. **车辆是否进人数统计与导出分组？** 默认：**不进**；图例/清单/CSV/PDF 独立「车辆」组，人数口径一个字不动。
3. **本批是否允许 AI 提案产车？** 默认：**不允许**；先手画（落点 + 挂线），`prepare_plan_vehicles` 与 `added.vehicleIds` 排下一步，避免 §3.4 的静默丢弃。
4. **五种缺模型的车是否允许借用近似 GLB？** 默认：**不允许**，占位盒 + 「待补模型」标签。借用会让 12 m 级大巴按 7.5 m 箱货显示，直接影响落客区与转弯判断。
5. **停放点算不算设施？`routeIds` 指向非车行线是否阻断保存？** 默认：**不算设施**（不进 `route-facility-collision`、不占 2000 设施上限）；**阻断保存**（`superRefine` 报错），否则出现「车在人群里走而冲突层不报」。
