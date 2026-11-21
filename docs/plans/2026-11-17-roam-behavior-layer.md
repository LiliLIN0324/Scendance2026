# 漫游人物行为层（流线 → 分区 → 落座）设计方案

> 2026-11-17 · 用户口径：「有流线就固定在流线里走；从外面进到一个分区，就在这个分区里自由活动；看到椅子就坐下。」
> 本文只给设计与施工顺序，**不改任何生产代码**。文中「已实现 / 缺失」均为本日读码核对结果，逐条附文件与函数。
> 性质：3D 预览行为，**不是**人群仿真、通行能力或安全疏散结论。第一版不写 `plan`、不落库、不改云端契约。

---

## 一、现状对表

### 1.1 已经有的（可直接复用）

| 能力 | 位置 | 关键事实 |
| --- | --- | --- |
| 沿路线行走 | `lib/person-route.ts` `stepRouteFollower()` | 闭环 / 折返 / 单向、路点停留、平滑转向（9 rad/s）、受阻 1.2 s 掉头、里程与圈数、边界夹取；半径 0.28 m |
| 行走表现 | `three/people-anim.ts` `advancePeopleAnimations()` | 每帧按 `moving` 切 `walk` / `idle`；`Walk_Loop` 是原位 clip，位移全由引擎给，无双位移 |
| 人接流线 | `lib/plan-crowd-routes.ts` `assignCrowdWalkRoutes()` | 后勤类接 `service` 线、其余接 `pedestrian` 线；`walkablePedestrianRoutes` 只收载体 walk/mixed；按 `startDistance` 错开 1.2 m |
| 碰撞与围栏 | `lib/walk-collision.ts` `buildWalkColliders()` / `resolveWalkerStep()`；`personWalkBounds()` | 行走上下文由 `hooks/use-scene-effects.ts` 注入 `setPersonWalkContext({colliders, bounds})`，且只在该层存在带 `walkRoute` 的人物时才注入。**仅室内**：户外 `rebuildCrowd()` 从未调用它，所以户外的人是「无碰撞、无围栏，只沿折线」 |
| 座位识别 | `lib/walk-seat.ts` `findSeat()`（室内）、`lib/seat-placement.ts` `seatFacilityTargets()`（户外） | 可坐类型：椅 / 餐椅 / 扶手椅 / 长凳 / 沙发 / 户外长椅；坐面高 0.28–0.45 m |
| 坐姿表现 | `three/people-anim.ts` `setSeated()` + `alignSeatedGroup()` | 播 `Sit_Idle_Loop`，按髋关节高度反算抬升量对齐椅面；上游**没有**坐下/起身过渡，只能交叉淡入 |
| 2D 流线分流 | `lib/flow-sim.ts` `stepFlowWalkers()` | 线尾落在另一条同 `kind` 线上时拐过去；纯预览、不改 plan |
| 分区归属 | `lib/site-plan-routes.ts` `inferZoneIdAt()`；`PlanWorker.zoneId` | 单点落区判定，人员 / 设施 / 出入口共用同一口径 |

### 1.2 缺失的（本文要补的）

1. **分区参与行走**：全仓没有任何行走逻辑读 `plan.zones[].polygon`。行走只有「路线 + 矩形/点云围栏 + 碰撞盒」三类约束。
2. **模式切换**：没有「在线走 ⇄ 在区内走」的状态，也没有「进区点 / 出区点」的概念。
3. **自主落座**：`setSeated(true)` 的唯一调用点是玩家接管的那个 avatar（`components/outdoor-plan-3d.tsx` 的 `useOutdoorWalk.onWalkFrame` → `control.setSeated(frame.seated, frame.seatHeight)`）。**没有任何 NPC 自己坐下**。
4. **座椅占用**：无互斥。多人同时选到同一把椅子会叠在一起。
5. **决策层**：没有感知、目标选择、避让 steering。`docs/plans/2026-11-14-outdoor-walk-roadmap.md` 把 steering + NavMesh（yuka / recast-navigation）列为后续方案，未落地。

### 1.3 结论

用户描述的行为是**一条三段式**：`沿流线` → `进区自由活动` → `见椅落座`。零件大多齐了，缺的是一层把零件串起来的**决策 + 换线**逻辑。

---

## 二、为什么先做状态机，不做行为树

用户问的「行为树」在本仓不存在，也不建议现在引入：

- 现有引擎本来就是状态机（`RouteFollowerState`：`segment / dir / remainingPause / blockedFor / laps`）。加一层行为树等于在状态机外再包一套黑板 + selector，收益是「未来好加行为」，成本是每帧两次遍历 + 一套新概念，而现在只有 4 个状态。
- 行为树的强项是「多目标竞争 + 频繁中断」。这里唯一的中断源是「座位被占 / 分区被删 / 路线变了」，用守卫条件就够。
- 真要多行为竞争时，接 `yuka`（MIT，steering + 有限状态机 + 黑板）比自建树便宜。

**结论：第一版做「单层状态机 + 纯函数规划」，接口留成能换 yuka 的形状（`stepPersonBehavior(state, ctx, dt) → actions`）。**

---

## 三、核心模型：一切皆「当前路线 + 当前坐姿」

不新增第二个 mover，避免两套位移打架。人物任何时刻只有两种表现：

1. **走**：由一条 `WalkRoute` 驱动，仍然走 `stepRouteFollower()`——碰撞、转向、卡死掉头全部免费继承。
2. **坐**：`entry.seated = true` + `seatHeight`，位置钉在座位锚点，播坐姿 clip。

于是「进区自由活动」不是新引擎，而是**临时给这个人换一条在区内生成的小折线**（3–6 点）；「走到椅子前」是换一条两点折线；「回到流线」是换一条接到流线接入点的折线。行为层只负责**决定何时换哪条线**。

这条选择带来三个硬性要求，施工时必须守住：

- **换线不能重注册**。`registerPersonAnim()` 只在 `routeSignature` 相同时保留 `follower`；换线会让签名变化，进度被重置、人物瞬移回线头。→ 行为层必须通过新 API 换「活动路线」，`routeSig` 只认基准流线。
- **不能借用 `takePersonControl()`**。它是单占的玩家接管通道，`release()` 会把人复位到接管前的原位与朝向，正好和「出区回线」打架。→ NPC 自主态另开一条通道。
- **所有决策确定性**。用 `personId + laps` 哈希播种，不许每帧 `Math.random()`——否则重建一次布局，人就换了座位，也没法写单测。

---

## 四、状态与转移

```ts
type RoamPhase =
  | { kind: 'route';    routeId: string }                                  // 沿流线（现状）
  | { kind: 'toZone';   zoneId: string; entry: Vec2 }                      // 从流线拐进区
  | { kind: 'zoneFree'; zoneId: string; plan: Vec2[]; next: number; dwell: number }
  | { kind: 'toSeat';   zoneId: string; seatId: string; approach: Vec2 }
  | { kind: 'seated';   zoneId: string; seatId: string; dwell: number }
  | { kind: 'rejoin';   routeId: string; merge: Vec2 };                    // 出区回到流线
```

### 4.1 转移表

| 从 | 到 | 条件（全部为纯函数可判） | 备注 |
| --- | --- | --- | --- |
| `route` | `toZone` | 沿当前方向前方 `LOOKAHEAD_M`（建议 2.5 m）内存在「线穿过分区边界、由外向内」的采样点；且该人未处于进区冷却；且本次 `laps` 的哈希落在进区概率内 | 采样步长 0.5 m；只认**走向区内**的穿越，反向穿越不算（单向流线尤其要判方向） |
| `toZone` | `zoneFree` | 到达 `entry` 点（人已过边界向内 `ZONE_INSET_M` ≈ 0.8 m） | 到达即生成区内折线（见 5.2） |
| `zoneFree` | `toSeat` | 区内存在可坐座位且未被占用；与上一个座位/座椅停留的冷却已过；`dwell` 未耗尽 | 座位按「离当前位置最近 + 直线可通」排序，取第一个 |
| `zoneFree` | `rejoin` | `dwell` 耗尽；或区内折线走满一轮；或该人所属岗位已不在本区（`zoneId` 变了） | 出区点 = 区内折线末端到流线最近投影点 |
| `toSeat` | `seated` | 到达座位锚点（见 5.4） | 到达即 `seated = true` + `seatHeight` |
| `seated` | `zoneFree` | 座位 `dwell`（建议 25–70 s，按角色分档）耗尽 | 起身：清 `seated`，位置推到座前 `SEAT_STANDOFF_M` ≈ 0.45 m |
| `rejoin` | `route` | 到达流线上的接入点 | 接回时**沿用原 `startDistance` 附近**的分段，不重置 `laps` / `travelled` |
| 任意 | `route` | 降级：分区被删 / 座位被删或被移走 / 流线被改 / 该人不再有基准流线 | 降级必须回基准线，不许停在半空 |

### 4.2 冷却与预算（防抖）

- 进区冷却：同一个人两次进区之间至少 1 圈（闭环）或 1 个往返（折返）。
- 座椅冷却：同一个人坐完 1 把椅子，至少隔 60 s 才坐下一把。
- 单人停留上限：在单个分区内累计不超过 120 s，避免一个人把整场占住。
- 全局预算：行为层只作用于**已挂到流线上的实例**（现状本来就只有这些人会动）；建议再加一道总量闸，参与决策的实例 ≤ 120，超出按 `personId` 哈希降级为「只走线、不进区」——`MAX_CROWD_INSTANCES_PER_WORKER = 24` 只是单个岗位的上限，岗位数没有全局上限。

---

## 五、纯函数 API 草案（建议新文件 `lib/person-behavior.ts`）

模块边界：**不 import three、不读 plan、不写 plan**，只吃几何与配置，吐「下一条线 / 下一个坐姿」。这样单测不需要 WebGL。

```ts
export interface BehaviorConfig {
  lookaheadM: number;        // 2.5
  zoneInsetM: number;        // 0.8
  enterZoneChance: number;   // 0.55，按 laps 哈希判定
  zoneDwellSec: readonly [number, number];   // [20, 45]
  seatDwellSec: readonly [number, number];   // [25, 70]
  seatCooldownSec: number;   // 60
  maxPeopleInDecision: number; // 120
}

export interface BehaviorContext {
  zones: readonly { id: string; polygon: readonly Vec2[] }[];   // 已换算到路线局部坐标
  colliders: readonly WalkCollider[];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  seats: readonly SeatAnchor[];                                  // 已换算到路线局部坐标
  legBounds: ...;                                                // 场地轮廓（多边形），用于区外判定
}
```

### 5.1 `zoneCrossingsAlong(route, zones) → ZoneCrossing[]`

沿折线 0.5 m 采样，用与 `inferZoneIdAt` **同一个 ring 判定**（`planPointInRing`，不要另写一套）找出「所属分区 id 发生变化」的采样段，返回 `{ at, fromZoneId, toZoneId, point }`。只保留 `toZoneId` 非空且 `fromZoneId` 为空的方向——这就是「从外面进入分区」。

### 5.2 `planZoneWalk(zone, ctx, seed) → Vec2[]`

在 `zone.polygon` 与场地轮廓的交集内做网格采样（间距沿用 `crowd-route.ts` 的 `chooseSpacing` 口径：`max(0.6, 长边/36)`），逐点过 `resolveWalkerStep` 的「原地推挤位移 < 0.05 m」判空，再按 4 邻接做连通分量（`segmentClear` 同口径），取该人所在连通分量里一条 3–6 点的短折线。

> `crowd-route.ts` 里的 `inside / distanceToOutline / freeCells / segmentClear / bfs / tour` **目前全部是模块私有**。两条路：① 导出这几个纯函数；② 抽 `lib/polygon.ts` 共用。建议 ①（改动最小，`crowd-route.test.ts` 已有覆盖可复用）。

### 5.3 `pickSeat(zone, ctx, from, taken, seed) → SeatAnchor | null`

候选来自 `seatFacilityTargets()`（户外）或 `findSeat()`（室内），过滤 `taken`，按「直线可通 + 距离最近」排序，距离上限建议 12 m（超过就别为了坐椅子横穿全场）。

### 5.4 `seatApproachPose(seat) → { x, z, facing }`

直接复用户外已有的锚点算法：朝向 `π − deg2rad(rotationDeg)`，沿朝向后退 `SEAT_HIP_BACK_M = 0.12 m` 让髂部落座面偏后（见 `outdoor-plan-3d.tsx` 的 `toggleSeatEntry`）。室内要另取一件 `FurnitureItem`：`findSeat()` 只回 `x / z / seatHeight`，**不回朝向**，`item.rotation` 得自己取；坐面高用 `seatSurfaceHeight()`。

### 5.5 `stepPersonBehavior(state, ctx, dt, seed) → BehaviorAction[]`

只产出声明式动作：

```ts
type BehaviorAction =
  | { type: 'setActiveRoute'; points: Vec2[]; loop: boolean; pauseMs: number }
  | { type: 'resumeBaseRoute' }
  | { type: 'sit'; seatId: string; seatHeight: number; x: number; z: number; facing: number }
  | { type: 'stand' };
```

three 层负责解释执行。这样即使以后换成 yuka，这层接口也不用动。

---

## 六、运行时接线

### 6.1 `three/people-anim.ts`（改动最小集）

1. `PersonAnimEntry` 增 `baseRoute: WalkRoute | null` 与 `activeRoute: WalkRoute | null`，`advancePeopleAnimations()` 的路线分支只读 `activeRoute`；`routeSig` 仍按 `baseRoute` 算，换线不重置进度。
2. 新增 `setPersonBehavior(id, action)`：处理 `setActiveRoute / resumeBaseRoute`；`resumeBaseRoute` 时把 group 位置直接落到基准线最近点（**一次瞬移**是可接受的，因为出区点就在接入点上）。
3. 新增 `setNpcSeatState(id, { seatId, seatHeight } | null)`：与玩家接管的 `setSeated` 共用 `seated / seatHeight / sitLift` 三个字段，但**不走 `takePersonControl` 的单占与复位**。`alignSeatedGroup()` 的调用条件从「`manualMoving !== null`」放宽到「`seated === true`」。
4. 扩展 dev 探针 `personWalkStates()`，加 `phase / zoneId / seatId`，便于真机走查。

### 6.2 `components/room-organizer/components/outdoor-plan-3d.tsx`

`rebuildCrowd()` 已经算出了 `crowdPlacements` 与 `walkRouteMap`，行为上下文在此一次性构建并注入（与 `setPersonWalkContext` 同款时序）：

```ts
setPersonBehaviorContext({
  zones: nextPlan.zones.map(z => ({ id: z.id, polygon: z.polygon.map(toLocal) })),
  colliders: buildWalkColliders(...),   // 户外暂无室内家具，先传空数组
  bounds: ringFrame 内缩后的矩形,
  seats: seatFacilityTargets(nextPlan.facilities).map(toLocalSeat),
});
```

`crowdSignature` 目前已经把 `workers / boundary / metrics / routes(kind,points,carrier,oneWay)` 纳入；**必须把 `zones` 与座位来源（facilities 的 id/position/rotationDeg/height）也加进签名**，否则只改分区或只挪椅子时人群不会重建，行为层拿着旧上下文跑。

### 6.3 `hooks/use-scene-effects.ts`

室内那条行走上下文 effect 现在只判 `item.walkRoute`。若室内也要进区：室内分区是 `activeFloor.zones: RoomZone[]`，**轴对齐矩形** `x / z / w / d`（房间中心为原点，见 `lib/types.ts` 与 `lib/zones.ts`），不是多边形——注入前要先转成 4 点环，并在 effect 依赖里加 `activeFloor.zones`。室内与户外分区是两套类型，别混用同一个 `PlanZone` 判定。

---

## 七、坐标：三套并存，别串（最容易踩的坑）

| 场景 | 坐标 | 出处 |
| --- | --- | --- |
| 2D 画布 / plan 契约 | ENU：x 东、y 北，米 | `site-plan.ts` 的 `PlanPoint` |
| 户外 3D 主场景（设施、可交互物） | 世界：x、z，`z = -y` | `outdoor-interactables.ts` `position: { x, z: -y }` |
| 人群行走（`item.walkRoute` 与 follower） | 「路线局部」：壳体坐标再减半个场地 | `plan-crowd-routes.ts` 的 `toLocal` / `outdoor-plan-3d.tsx` 的 `shell.x - width/2` |

**规则：行为层只承认第三套。** 分区多边形、座位点、流线点进入行为层前一律走同一条换算（`planShellFrame(boundary, metrics).toShell()` 再减 `width/2, depth/2`）。`assignCrowdWalkRoutes` 里的 `toLocal` 现在是闭包私有函数，建议提出来变成 `planPointToRouteFrame(point, boundary, metrics)` 并给单测——否则「分区偏移半个场地」这种 bug 只能靠肉眼在 3D 里发现。

---

## 八、数据与契约

- **零迁移、零契约改动**：`PlanWorker` 已有 `zoneId / routeIds / activityZoneIds`，`PlanZone` 已有 `polygon / semantic`，够第一版用。
- **不写 plan**：行为状态是渲染态，刷新即重来——与 `flow-sim.ts` 同一口径（预览，不参与统计、不进交付）。
- 若以后要「按区配驻留时长 / 进区概率」，按本仓惯例加 **optional** 字段（旧快照不带照常解析），不写 `default`。

---

## 九、分批落地（按「多久能看见效果」排）

### B1 · 只做「沿流线 + 见椅坐下」（0.5–1 天，肉眼可见）

**状态：已落地（2026-11-17）** — `lib/person-behavior.ts`、`lib/plan-walk-context.ts`、`people-anim.ts` 的 `activeRoute`/座位运行时、`poseSit()`。相较本节的设想有两处收敛：座位候选限定沿**当前**路线 8 m 内，`stepSeatBehavior` 直接收 `arrived` 布尔而不是自己算距离。

范围：不做分区。座位从**流线沿途**取（沿线 8 m 内、直线可通），到达后坐 25–70 s，起身继续走线。

改动：
- 先在 `outdoor-plan-3d.tsx` 的 `rebuildCrowd()` 里补上 `setPersonWalkContext()`（现状缺失，见 §十二-3）——没有这一步，后面全是在无碰撞世界里走。
- 新增 `lib/person-behavior.ts` 的 `routeSeatPlan()` + `stepSeatBehavior()`（先不做 zone）。
- `people-anim.ts` 加 `activeRoute` 与 `setNpcSeatState`（6.1 的 1、3 两条）。
- `outdoor-plan-3d.tsx` 在 `rebuildCrowd()` 后注入座位上下文，签名加座位来源。

验收：一条人行流线 + 区内 2 把椅子 → 有人沿线走、走到椅子旁坐下、坐完起身接着走；同一把椅子不会被两人同时坐。

> 这一批就能回答用户那句「看到了椅子就坐下」，而且不碰分区、不碰契约，风险最低。

### B2 · 分区与模式切换（1.5–2 天）

**状态：已落地（2026-11-17）**

实做与本节的差异：

- 几何集中在新文件 `lib/zone-walk.ts`（`pointInPolygon` / `zoneCrossingsAlong` / `zoneEntryPoint` / `planZoneWalk` / `projectOnPolyline`），没有另开 `lib/polygon.ts`，也没有导出 `crowd-route.ts` 的私有函数——那批函数是给 2D 流场用的，参数口径不同，硬抽反而要加适配层。
- `stepPersonBehavior` 这个统一接口没有落地：落座继续用 B1 已绿的 `stepSeatBehavior`，分区段是 `people-anim.ts` 里的 `advanceZonePhase()`。相位互斥（`seatPhase`）比套一层总调度更不容易把已测好的落座路径改坏；两者仍共用同一套「换 activeRoute」的位移机制，也就是本文 §六-6.1 的口径。
- 分区→漫游环的换算放在 `plan-walk-context.ts` 的 `planZoneRings()`：只收 ≥ 3 点、面积 ≥ 4 m² 的分区；再小的分区进去也只能原地转身。
- 进区判定是**确定性**的：`shouldEnterZone(id, laps)` 用 FNV-1a + 尾部混淆（不能用 `h*31+c`：末位差 1 的种子取模后连成一段，会退化成「连续几十圈同一个答案」）。命中后还有一道「出区后至少再走一圈」的冷却 `zoneCooldownLaps`，否则折返路线会在同一个口反复进出。
- 进区路线是「入口 → 区内网格最远点 → 原路折回」，`planZoneWalk` 里做 4 邻接连通与 `resolveWalkerStep` 可达性判定，拿不到可走格就直接回线，不硬走。
- 回线用 `rebaseRouteFollower(follower, route, along)`：只改「现在在哪、下一个目标点」，`travelled` / `laps` 原样保留，方向统一置顺行。

未做：分区上下文与座位上下文一样是**全局单实例**，同一时刻只应有一套户外预览在注入（室内链路不注入，行为与 B1 逐字段一致）。

范围：B1 + 进区判定 + 区内折线 + 出区回线。

改动：
- `lib/polygon.ts`（或导出 `crowd-route.ts` 的私有几何函数）提供 `insideness / distanceToOutline / freeCells / segmentClear`。
- `zoneCrossingsAlong()`、`planZoneWalk()`、`rejoinPoint()`。
- `rebuildCrowd()` 注入 zones；`stepPersonBehavior` 接入每帧 tick。

验收：流线穿过一个分区 → 有人拐进去走一小圈、坐下、起身、出区、接回原线；`laps` 与 `travelled` 不清零。

验证：`npx tsc --noEmit` 0；`npx eslint` 改动文件 0 error；`vitest` 9 个文件 / 101 用例通过（新增 `zone-walk.test.ts` 16 例、`people-anim.test.ts` 分区流程 3 例、`person-route.test.ts` 重定位 3 例、`plan-walk-context.test.ts` 分区换算 2 例）。

### B3 · 多人秩序与 2D 联动（1 天）

**状态：2D 联动已落地（2026-11-17）；同区人数上限按用户指示不做。**

- ~~座椅占用表~~ 已在 B1 落地：`createSeatRegistry()` 单椅单人，抢座失败退回 `roaming` 下一帧换一把。
- ~~分区密度上限（同区 ≤ 8）~~ **用户 2026-11-17 明确「不用人数上限」**，不做。
- 2D 联动已落地：`people-anim.ts` 导出 `personRoamState(id)` / `workerRoamState(workerId, count)` /
  `subscribePersonRoam(listener)`；`lib/outdoor-plan-canvas.ts` 的 `drawWorkerLayer` 在人员标记外圈加
  **状态环**（进区青 `#1f9d8f` / 落座琥珀 `#d0872a`），`components/outdoor-plan-canvas.tsx` 订阅
  跳档事件并用 rAF 合并重绘（与流场模拟同一款）。
  - 环画在最外圈，且在选中白圈与越界红圈之外，三环不互遮；`walking` 与「没有 3D 实例」都不画环。
  - 只在状态真跳档时回调（`roamTag` = 相位 + 分区 + 坐姿），不每帧发。
  - **保活隐藏（2D 地图态）也推进人物**：`lib/idle-crowd-pacer.ts` 按每一帧的真实耗时累计，
    每 0.25 s 交一段 dt 给 `advancePeopleAnimations`（约 4 Hz，单步上限 0.5 s）。不推进的话
    色环停在切走那一刻；按帧推又只有 1/6 速度（隐藏态每 6 帧才跑一次循环体）。切回 3D
    时清空未用的累计，不补一大步。
  - 2D 只读注册表，不反向驱动 3D；室内 `canvas-2d/render.ts` 那条链路没有漫游态可传，不动。
  - **行走上下文已按 owner 分开**（本节末的遗留已补）：`advancePeopleAnimations(dt, scene, owner)`
    取 `walkContexts.get(owner)` 那套，没注入过就用空上下文（不借别处的围栏）。户外传 `'outdoor'`、
    主舞台传 `'local'`；`setPersonWalkContext(ctx, owner)` 只管存，不再维护「当前活动上下文」。
  - 仍为全局的：座位上下文（`setPersonSeatContext`）与分区上下文（`setPersonZoneContext`）。
    两者只由户外链路注入，室内不注入即不生效；若以后室内也要落座/进区，得同样按 owner 拆。
- 单向流线 + 出口：`rejoin` 仍走 `projectOnPolyline` 投影，单向线不会把远端当出口（未新增旁路）。

验证：`npx tsc --noEmit` 0；`npx eslint` 改动文件 0 error；`vitest` 7 个文件 / 133 用例通过
（新增 `people-anim.test.ts` 漫游态 2 例 + owner 隔离 2 例、`outdoor-plan-canvas.test.ts` 状态环 1 例、
`idle-crowd-pacer.test.ts` 节拍器 5 例）。

---

## 十、验收

**单测（`lib/person-behavior.test.ts`，纯函数，不需要 WebGL）**

1. `zoneCrossingsAlong` 只报「外 → 内」的穿越；反向与沿线内部不算。
2. 进区点落在分区内、且在流线上（误差 ≤ 0.7 m）。
3. 区内折线所有点过 `resolveWalkerStep` 原地推挤 < 0.05 m，且都在 `zone.polygon` 内、在 `bounds` 内。
4. 换线不重置 `follower`：`travelled / laps` 跨换线单调不减。
5. 座位互斥：两人同帧抢同一把椅子，只有一人 `sit`，另一人重新 `pickSeat`。
6. 座位被删 / 分区被删 → 下一帧降级为 `resumeBaseRoute`，不残留 `seated`。
7. 无分区、无座位时行为与现状逐字段一致（回归闸）。
8. 确定性：同一 `plan + seed` 跑 60 s 两次，最终位姿逐点相等。

**回归**：`person-route.test.ts`、`people-anim.test.ts`、`plan-crowd-routes.test.ts`、`crowd-route.test.ts`、`flow-sim.test.ts`、`plan-scene-placement.test.ts` 全绿；`npm --prefix frontend run typecheck` 0 错。

**真机（dev）**：一条流线穿过一个分区 + 区内 2 椅。观察顺序：沿线 → 拐进区 → 区内一小圈 → 坐下 → 起身 → 出区 → 接回原线；改分区或挪椅子后人群不瞬移、不重叠；控制台 0 error。

---

## 十一、明确不做

- 不做 steering / NavMesh / 视线与注意力感知；不引 `yuka` / `recast-navigation`（等 B3 之后再评估）。
- 不做行为树框架，不建黑板。
- 不做 NPC 对话（P4c 另排），不做多人真人在线。
- 不做「人群随人流密度自动增减」，不做安全疏散 / 通行能力结论。
- 不改 `takePersonControl()` 的玩家接管语义（单占 + 复位），NPC 自主走路另开通道。
- 不写 `plan`、不改 Edge Function 契约、不加数据库迁移。
- 不动室内 `use-walkthrough` 的 F 键坐姿与户外 E 键交互——那两条是**玩家**的通道，本文只补 NPC 的自主通道。

---

## 十二、已知坑（施工时逐条对）

1. **坐标串台**：分区多边形是 ENU，follower 要的是路线局部坐标。少减半个场地 = 人往场地外拐（见 §七）。
2. **换线触发重注册**：只要走 `registerPersonAnim` 换 `route`，签名一变进度就回零、人物瞬移。必须走 `setActiveRoute`（§6.1-1）。
3. **户外目前根本没有碰撞上下文**：`setPersonWalkContext()` 全仓只有 `hooks/use-scene-effects.ts`（室内）在调；户外人群的 follower 拿到的是空上下文——没有围栏、没有碰撞盒，只保证「沿折线走」。行为层要在 `rebuildCrowd()` 里先把这份上下文补上，否则「区内自由活动」等于让人在没有碰撞的世界里乱走。这也是 B1 的隐藏前置项。
4. **`crowdSignature` 不全**：不把 zones / seats 纳入签名，改分区或挪椅子后行为层拿旧数据跑，表现是「人往已经不存在的地方走」。
5. **坐姿对齐的双闸**：`alignSeatedGroup` 头几帧坐姿权重没到 0.9 之前不量髋高，否则算出负抬升、人陷进地里（`people-anim.ts` 已有注释，别绕过）。
6. **座位高度来源**：户外 `seatSurfaceHeight` 用 `min(0.45, height*0.55)` 收边；模型高度异常时人会悬空或陷座——`alignSeatedGroup` 的 `-1.2 < hipsRelY < 0.45` 是最后一道闸，别放宽。
7. **单向流线**：`rejoin` 只能接在出方向上；把单向线当双向会让「只出不能入」的区看起来连通（与 `assignCrowdWalkRoutes` 对 `oneWay` 的口径、CHANGELOG 中「补出来的线只挂在已确认出入口上」一致，别新开旁路）。
