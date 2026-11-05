# 场景脚本 → 编译器 → 候选方案：对抗式代码评审

- 评审人：code-reviewer（只读评审；只写本文件）
- 评审时间：2026-11-01 02:0x–02:2x（Asia/Shanghai）
- 评审对象快照（**本报告所有行号、实测数字都以这 8 个文件为准**；评审期间这些文件在改，早期快照的结论已作废重测）：

| 文件 | 字节 | mtime | SHA256 前 10 |
| --- | --- | --- | --- |
| `supabase/functions/_shared/scene-script-contract.ts` | 5973 | 11-01 02:14:11 | `65893239BE` |
| `frontend/components/room-organizer/lib/scene-script.ts` | 10732 | 11-01 02:01:12 | `6509851EC8` |
| `frontend/components/room-organizer/lib/scene-script-compiler.ts` | 24247（574 行） | 11-01 02:15:45 | `F81901E617` |
| `frontend/components/room-organizer/lib/local-plan.ts` | 4401（110 行） | 11-01 02:13:03 | `838E593B59` |
| `frontend/components/room-organizer/lib/scene-script.test.ts` | 6581 | 11-01 02:03:22 | `2242B7CCED` |
| `frontend/components/room-organizer/lib/scene-script-compiler.test.ts` | 8039 | 11-01 02:13:31 | `926FF3241C` |
| `frontend/components/room-organizer/lib/local-plan.test.ts` | 3927 | 11-01 02:13:31 | `97A4AFA8AB` |
| `frontend/components/room-organizer/panels/agent-panel.tsx` | 116611 | 11-01 02:10:26 | `701214CF08` |

- 落地验证：
  - `npx vitest run lib/scene-script.test.ts lib/scene-script-compiler.test.ts lib/local-plan.test.ts lib/agent-proposal.test.ts` → **4 passed / 58 tests passed**（比交接单说的"20 个新测试"多，评审期间 Lead 补过测试）。
  - `npx tsc --noEmit`（= `npm run typecheck`）→ **7 条 error，本次 4 个新文件 0 条**；`agent-panel.tsx` 的 2 条（1292 未使用 `jumpToQingguang`、1611 ref 类型）落在本次 diff hunk 之外，属既有问题，不记本次。
  - `npm run build` 未跑（只读评审 + 耗时），见「存疑」。
- 环境说明：Node 26 + jsdom 下部分 react 套件因 `localStorage` 挂掉，是已知环境问题，**不记缺陷**；本报告的实测全部走 lib 层纯函数，不经 jsdom。

## 复现方法（所有条目共用这一段）

只读探测，不写任何文件。全部实测脚本都用这一套；PowerShell 会剥掉双引号，所以 JS 里**只用单引号**。

```powershell
cd C:\mujing\Scendance2026\frontend
$code = @'
require('sucrase/register');
const { compileSceneScript } = require('./components/room-organizer/lib/scene-script-compiler.ts');
const { localPlan } = require('./components/room-organizer/lib/local-plan.ts');
const { sceneScriptFromBrief } = require('./components/room-organizer/lib/scene-script.ts');
const { makeFloor, makeLayout, makeItem } = require('./components/room-organizer/lib/__testfixtures__/fixtures.ts');
const mk = (w = 12, d = 9, items = []) => makeLayout({ width: w, height: d, floors: [makeFloor({ items })] });
const ids = () => { let n = 0; return () => 'id-' + (++n); };
const last = (r) => r.layouts[r.layouts.length - 1];
// ...本报告各条给出的片段粘在这里
'@
node -e $code
```

文中的 `script(**)` 指这个最小夹具：

```js
const script = (over = {}) => ({ version: 1, seed: 3, layoutMode: 'dining',
  zones: [{ role: 'seating', rect: { x: -5.3, z: -3.8, w: 10.6, d: 7.6 } }],
  constraints: { aisleMinM: 1.2, wallGapM: 0.35 }, ...over });
```

---

# 一、缺陷清单

## P0 · 会坏（主路径必出的错误产物）

### P0-1　旋转版式把每件家具的朝向拧了 180°（位置对、朝向反）

- **现象**：只要编译器选中"转 90° 那版"（12 × 9 发布会 4 组桌椅全走这版；课室模式 20 组课桌全走这版），生成的桌椅**整体朝向差 180°**：每把椅子背对桌子、每张课椅背对课桌。位置、包围盒、碰撞、账目全部正确，所以 58 个测试和 `overlapCount = 0` 都抓不到；只有 3D/2D 正视时才看得出来。
- **证据**：`scene-script-compiler.ts:408-420`。注释写的映射是 `(x, z) → (cx - dz, cz + dx)`，这是绕中心 **−90°**（φ = −π/2）；而 `:417` 却 `rotation: (item.rotation ?? 0) + Math.PI / 2`（+90°）。刚体旋转必须"位置转 φ、朝向也转 φ"，差了 π。
  - 数学核对：绕中心 φ 的位置映射是 `(dx·cosφ + dz·sinφ, −dx·sinφ + dz·cosφ)`。令其等于 `(−dz, +dx)` ⇒ `cosφ = 0, sinφ = −1` ⇒ φ = −π/2。位置与朝向必须同号。
  - **AABB 骗过了测试**：π 的偏差对 `rotatedHalfExtents`（用 `|cos|`、`|sin|`）完全不可见，所以 `halfX/halfZ`、网格间距、`hasCollisions`、`intrudesKeepOut` 全部照旧正确——这正是它能逃过全部断言的原因。
- **复现**：

```js
// 3 × 8.5 的座位区：转 90° 那版胜出
const r = compileSceneScript(script({ zones: [{ role: 'seating', rect: { x: -1.5, z: -4.5, w: 3, d: 8.5 } }] }), { base: mk(), floorIndex: 0, makeId: ids() });
const items = last(r).floors[0].items;
const t = items.find(i => i.type === 'dining-table');
for (const c of items.filter(i => i.type === 'dining-chair').slice(0, 4)) {
  const dx = t.position.x - c.position.x, dz = t.position.z - c.position.z, len = Math.hypot(dx, dz);
  const facing = [Math.sin(c.rotation), Math.cos(c.rotation)];   // 朝向 = 本地 +Z
  console.log('chair rot(π)', (c.rotation / Math.PI).toFixed(2), '朝向·指向桌子', ((dx * facing[0] + dz * facing[1]) / len).toFixed(2));
}
// 实测：朝向·指向桌子 = -1.00,-1.00,-1.00,-1.00（背对）；对照组（不旋转版式）全为 +1.00
// 实测表 rotation = 0.50π（应为 -0.50π），椅子 = 1.00/0.00/0.50/1.50（应为 0.00/-1.00/-0.50/0.50）
```

  规范主路径（`12 × 9 / 24 人 / 有舞台有签到`，`localPlan`）实测：4 张餐桌 `rotation` 全为 `0.50π`（即全部走旋转版式），**16 把椅子 16 把背对桌子**；`40 人`同一结论。课室模式同理。

  课室模式同样中招（`layoutMode: 'desk-chair'`，12 × 9、40 人，20 对课桌全部"椅子背对课桌"——因为宽场地里旋转版式格数更多，20 > 18，必选旋转版）。

- **最小修复**（改一个符号）：

```ts
// scene-script-compiler.ts:417
rotation: (item.rotation ?? 0) - Math.PI / 2,
```
  或者保持 `+π/2`，把 `:416` 的位置映射改成 `{ x: center.x + dz, z: center.z - dx }`（φ = +π/2）。两者只能改一处，改两处等于没改。
- **建议补的断言**（现有 32 个测试一条都没有断言 rotation）：

```ts
// 每个椅子都应朝向自己那张桌子
const dot = (dx * Math.sin(c.rotation) + dz * Math.cos(c.rotation)) / Math.hypot(dx, dz);
expect(dot).toBeGreaterThan(0);
```

> 严重度说明：它不崩、不挡落盘，但**主路径 100% 复现地交付一个椅子全部背对桌子的房间**，且 32 个新测试全绿也发现不了。按"会坏"记 P0。

---

## P1 · 会算错

### P1-1　"一组都放不进场地"时容量与丢弃件数彻底失真（2 m 宽场地说"最多 26 座""52 件放不下"）

- **现象**：场地窄到一组桌椅都摆不下时，编译器仍然报出一个假容量，并把每个假格子的失败次数算成"放不下的件数"。用户在对话里会读到 `52 件放不下，没采纳`（`agent-panel.tsx:131`），把一块 3 × 9 的走廊说成 52 件家具挤掉了。
- **证据**：
  - `scene-script-compiler.ts:423-437` `measureSet`：`buildFurnitureSet` 在房间太窄时返回 `[]` ⇒ `halfX = halfZ = 0, count = 0`（`:425-435`）。
  - `:334` `seatsPerSet = Math.max(1, measured.count - 1)` ⇒ count = 0 时退化成 **1**（掩盖了"这套家具根本装不进这个房间"）。
  - `:335` `capacitySeats = slots.length * seatsPerSet`；`:464-470` 网格在 `halfX/halfZ = 0` 时格子只有 `SET_GAP_M = 0.5 m` ⇒ 格子数量爆炸。
  - `:371` `deps.ledger('seating').refused += failed.length` 每轮都加 ⇒ `dropped = sum(ops.refused)`（`:285`）跟着爆炸。
- **复现**：

```js
for (const [w, d] of [[2, 9], [2.5, 9], [3, 9]]) {
  const s = sceneScriptFromBrief({ widthM: w, depthM: d, guests: 20, stage: false, checkin: false, seed: 1 });
  const r = compileSceneScript(s, { base: mk(w, d), floorIndex: 0, makeId: ids() });
  console.log(`${w}x${d}`, 'seats', r.seats, 'capacity', r.capacity, 'dropped', r.dropped, 'msgs', JSON.stringify(r.issues.map(i => i.code)));
}
// 实测：2x9 seats 0 capacity 26 dropped 26；2.5x9 → 0/39/39；3x9 → 0/52/52
// 且 W_CAPACITY 文案："脚本要 20 个座位，这块座位区最多 26 座，这一版摆出 0 个。"（物理上不可能）
```

- **最小修复**：`measureSet` 返回 `{ halfX: 0, count: 0 }` 时直接当成"装不下"处理，不要走网格：

```ts
if (measured.count === 0 || measured.halfX === 0) { /* 与 !slots.length 同一条 E_ROLE_UNFIT 出口，capacity 0 */ }
```
  并且 `seatsPerSet` 不要用 `Math.max(1, count - 1)` 兜底（见 P3-5）。

### P1-2　`dropped` 按"重试次数"累加、单位还混着"组/件"，正常场景也虚报

- **现象**：明明座位数已经满足（16 人 16 座），对话仍然说 `1 件放不下，没采纳`；而 `ops` 里 `placed` 对桌椅记的是"组"、对其他区记的是"件"，`sum(ops.placed) = 9` 却 `added = 25`，账目对不上。设计意图是"任何放不下的件数都要记账"，现在记的是两套单位、还带重试重复计数。
- **证据**：
  - `:371` 每轮 `refused += failed.length`；`:372-384` 下一轮重排后同一位置可能成功——**失败过的格子已经被计进 dropped，不会再减回来**。
  - 单位混用：`:203`（舞台 1 件）、`:223`（签到 1 件）、`:368`（座位 1 **组** = 5 件）、`:374`；`added` 是件数（`:282` `placedItems.length`），`dropped` 是 `sum(ops.refused)`（`:285`）。
  - UI 文案假设"件"：`agent-panel.tsx:131` `` `${view.dropped} 件放不下，没采纳` ``。
- **复现**：

```js
// (a) 正常 12x9 / 24 人：added 25，但 sum(ops.placed) 只有 9
const a = compileSceneScript(sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: 24, stage: true, checkin: true, seed: 3 }), { base: mk(), floorIndex: 0, makeId: ids() });
console.log('added', a.added, 'sumPlaced', a.ops.reduce((s, o) => s + o.placed, 0), 'dropped', a.dropped);
// 实测：added 25，sumPlaced 9（stage1+checkin1+seating4组+plant3），dropped 0，seats 16，capacity 16

// (b) 一格被锁定衣柜占掉：座位一个没少，却报 1 件放不下
const probe = compileSceneScript(script({ guests: 8 }), { base: mk(), floorIndex: 0, makeId: ids() });
const blocker = { ...last(probe).floors[0].items.find(i => i.type === 'dining-table'), id: 'b', type: 'wardrobe', name: 'Blocker', width: 1.4, depth: 0.6, height: 2, locked: true };
const b = compileSceneScript(script({ guests: 16 }), { base: mk(12, 9, [blocker]), floorIndex: 0, makeId: ids() });
console.log('seats', b.seats, 'dropped', b.dropped, 'settled', JSON.stringify(b.settled), 'ops', JSON.stringify(b.ops));
// 实测：seats 16 = 目标 16（一件没缺），dropped 1，settled {passes:2, converged:true}，ops [{seating, placed:4, refused:1}]
```

- **最小修复**：把账本改成"件"，且只在**最终**结算时记账：
  - `acceptBatch` 返回被判的件数（`items.length`），seating 用 `deps.ledger('seating').refused += failed.length * measured.count`；
  - 重试时**先减后加**（或在 `setCurrent(deps.start)` 那步回滚本轮 `failed.length * count`），只保留最后一轮的净缺口；
  - 或者更简单：`dropped` 由 `wanted - placed`（按座位/件换算）反算，`ops` 只作为诊断数据。
  - 另外给 `SceneScriptOp` 加单位字段（`unit: 'piece' | 'set'`），不然这个字段永远说不清。

### P1-3　"加座，再排一版"在主路径完全无效（seatPriority 分支不可达）

- **现象**：场地只坐得下一半，气泡提示"可以换更大的场地，或按站立留空"（`agent-panel.tsx:139-140`，因为 `seatPriority` 为真时文案不同）；用户点"加座"重排，**拿到的方案逐件相同**，座位数一个都没多。旧路径里 `addExtraSeats` 是有效的（8 × 6 / 20 人：8 → 20 座）。
- **证据**：`local-plan.ts:63` 的前提是 `scriptPlan && !scriptPlan.blocked` 且 `scriptPlan.seats !== undefined`；但 `:46` 在 `!scriptPlan.blocked` 时**已经无条件 return**（`:57`），能走到 `:63` 的只剩 `blocked` 的脚本，而 `refused()`（`scene-script-compiler.ts:85-102`）返回的对象里**没有 `seats` 字段** ⇒ `scriptPlan.seats !== undefined` 永远为假 ⇒ 分支是死代码。旧路径的 `addExtraSeats` 只在 `via = 'fallback'` 时还能被调到。
- **复现**：

```js
const sig = (r) => JSON.stringify(last(r).floors[0].items.map(i => [i.type, +i.position.x.toFixed(4), +i.position.z.toFixed(4), i.rotation]));
for (const guests of [24, 60, 200]) {
  const plain = localPlan({ base: mk(12, 9), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests, stage: false, checkin: false });
  const prio  = localPlan({ base: mk(12, 9), floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests, stage: false, checkin: false, seatPriority: true });
  console.log(guests, plain.via, prio.via, 'seats', plain.seats, prio.seats, '逐件相同', sig(plain) === sig(prio));
}
// 实测：24/60/200 全部 script/script，seats 24/24、32/32、32/32，逐件相同 true
// 对照（fallback 路径，8x6）：20 人 8 → 20 座，逐件相同 false
```

- **最小修复**：把座位优先判断提到 `:46` 的早返回之前：

```ts
if (scriptPlan && !scriptPlan.blocked && input.seatPriority && input.guests) {
  const fill = scriptAttempt({ ...input, guests: null });   // 按整块座位区重编
  if (fill && !fill.blocked && (fill.seats ?? 0) > (scriptPlan.seats ?? 0)) return { ...fill, via: 'script', summary: fill.summary, guests: input.guests };
}
```
  同时补一个"`seatPriority` 必须比非优先版多座或相等"的断言（现在 `local-plan.test.ts:49-56` 只断言了 `>=`，恰好被"完全相同"满足，所以是假绿）。

### P1-4　`capacity` 不计锁定的障碍物：报"最多 24 座"，实际最多 20 座

- **现象**：座位区里有一件锁定衣柜占掉一格时，`capacity` 仍按"格数 × 每格座位"算（24 座），可这一格永远排不进去。W_CAPACITY 文案会告诉用户"这块座位区最多 24 座"，而真实上限是 20。这是"容量反算"的口径错，且它正是 `W_CAPACITY` 唯一的数字来源。
- **证据**：`scene-script-compiler.ts:335` `capacitySeats = slots.length * seatsPerSet`（纯几何，不看 `acceptBatch` 结果）；`:253` 累加；`:269-278` 直接拿它写进 W_CAPACITY。
- **复现**：

```js
// 沿用 P1-2 的 blocker（锁定衣柜压在 6 个格子中的 1 个）
for (const guests of [18, 20, 22, 24]) {
  const r = compileSceneScript(script({ guests }), { base: mk(12, 9, [blocker]), floorIndex: 0, makeId: ids() });
  console.log(guests, 'seats', r.seats, 'capacity', r.capacity, (r.issues.find(i => i.code === 'W_CAPACITY') || {}).message);
}
// 实测：18→20/24（无文案）；20→20/24（无文案）；22/24→20/24 + "脚本要 22 个座位，这块座位区最多 24 座，这一版摆出 20 个。"
// 真实可达上限是 20（4 格 × 4 座 + 1 格被锁定件永久占死）
```

- **最小修复**：容量用"实际能塞满多少格"反算，而不是几何格数：

```ts
// 在 settle 收敛后（或能一次排满的首轮）记 placedSeats = (placed 组数 + 剩余格数) 的保守下限，
// 更简单：capacity = seats + 因障碍物被判定为不可用的格数 × seatsPerSet
```
  最小可行做法：把 `capacitySeats` 改成"已放 + 剩余候选格"能接受的座位数（对 `candidates` 做一次干跑探测），或者文案改成不承诺上限（"这块场地这一版最多摆 N 座"用 `seats`）。

---

## P2 · 语义不一致

### P2-1　"全都放不下"时 `refusals` 是空的，只有数字没有原因

- **现象**：所有候选格都被锁定件挡住时，`ops` 记 `refused: 6`，`settled.converged: false`，但 `refusals` 数组**空**——写脚本的人拿不到任何可读原因（"什么挡住了、该挪哪件"）。设计意图（契约注释：不许抛异常，拒绝要有 code/message/hint）在这里断了。
- **证据**：`scene-script-compiler.ts:356-384` 循环。只有 `passes === MAX_SETTLE_PASSES`（`:373-382`）才 push `E_SET_BLOCKED`；`candidates` 被过滤空后**从 `:384` 直接返回**，没有任何 refusal。
- **复现**：

```js
const slab = makeItem({ id: 'slab', type: 'wardrobe', name: 'Slab', width: 10.4, depth: 7.4, height: 2, position: { x: 0, z: 0 }, locked: true });
const e = compileSceneScript(script({ guests: 16 }), { base: mk(12, 9, [slab]), floorIndex: 0, makeId: ids() });
console.log('seats', e.seats, 'dropped', e.dropped, 'settled', JSON.stringify(e.settled), 'refusals', JSON.stringify(e.refusals));
// 实测：seats 0，dropped 6，settled {passes:2, converged:false}，refusals []
// 多座位区版本同样：ops [{seating,placed:1,refused:1}]、refusals []
```

- **最小修复**：在 `:384` 前补一条对称的 refusal（用最后一轮 `failed` 的数量和 `acceptBatch` 的 `reason`）。

### P2-2　整套 `issues` / `refusals` 没有任何 UI 接线（包括新的容量文案）

- **现象**：`SceneScriptCompileResult` 新增的 `script / issues / refusals / ops / settled / capacity` 六个字段，**前端一处都没读**。只用到了 `added / removed / keptLocked / dropped / overlap* / seats / summary / blocked`。也就是说：`E_ROLE_UNFIT`、`E_SET_BLOCKED`、`W_CAPACITY`、`W_AISLE_NARROW`、`E_ZONE_OUTSIDE` 这些辛苦做的词表，运行时是**死数据**；一个座位都排不出来的用户，只能看到 `只摆得下 0 座`，看不到"座位区 3.0 × 1.4 m，一组桌椅都放不下"。
- **证据**：
  - `local-plan.ts:35-38` 的 `LocalPlanResult` 只扩展了 `via` / `fallbackReason` / `summary`；`viewOfLocalPlan`（`agent-panel.tsx:104-112`）只挑 `PlanProposal` 的字段；`planLines`（`agent-panel.tsx:121-143`）只用 `added/removing/keptLocked/dropped/overlapCount/seats/guests/seatPriority`。
  - 全仓 grep `refusals|\.capacity|\.settled|\.script\b`（排除测试/契约/编译器自身）：**零命中**。
- **复现**：`Select-String -Path frontend/components/room-organizer/panels/*.tsx -Pattern 'refusals|\.capacity|\.settled'` → 空。
- **最小修复**：`planLines` 里加一段 `plan.refusals?.slice(0, 2).map(r => r.message)`（或只取第一条），至少让"为什么少了一组"能说出口；否则这两个字段应从 `SceneScriptCompileResult` 里删掉，别留半截承诺。

### P2-3　`E_KEEP_OUT` 与 `E_SCRIPT_SHAPE` 在生产链路永不产生

- **现象**：契约声明了 11 个 issue code，其中 `E_KEEP_OUT`（"压在通道/预留区上，丢掉不挪"）在编译器里没有任何地方产生（`acceptBatch` 只会给出 `会压在通道或预留区上` 的字符串，由调用方转写成 `E_SET_BLOCKED` 或只计数）；`E_SCRIPT_SHAPE` 只由 `parseSceneScript` 产生，而 `parseSceneScript` 只有测试在调。词表和实现不是一对一。
- **证据**：`scene-script-contract.ts` 的 code 联合表 vs 全仓 grep：`E_KEEP_OUT` 仅出现在契约与测试；`parseSceneScript` 在 `scene-script.ts:51` 定义、仅在 `*.test.ts` 调用，生成链路上（`local-plan.ts:95-109` → `compileSceneScript`）从未经过它。
- **最小修复**：要么删掉 `E_KEEP_OUT`，把 keep-out 命中归到 `E_SET_BLOCKED`；要么让 `acceptBatch` 返回 `{ code }` 让调用方原样透传。`E_SCRIPT_SHAPE` 这条另说（见下条）。

### P2-4　`normalizeSceneScript` 对每份标准 brief 都报假的 `E_ZONE_OUTSIDE`

- **现象**：`12 × 9 / 24 人 / 有舞台有签到` 的**规范 brief** 一生成就带 **5 条** `E_ZONE_OUTSIDE` 警告，文案暗示"这些区被收进了场内"。实际上没有任何区越界——是 `clampZoneRect` 把角点按 0.1 m 网格取了整（`-5.65 → -5.6`、`-4.1 → -4.1`），`normalizeSceneScript` 用"取整前后是否不同"来判断"是否被拉回"，把取整当成了夹取。一旦 `issues` 接线到 UI（P2-2 的正常演进方向），每一版方案都会挂着 5 条假告警。
- **证据**：`scene-script.ts:84-119`（`:91` 调 `clampZoneRect`，`:100-112` 用 `clamped.x !== rect.x …` 报 `E_ZONE_OUTSIDE`）；`zones.ts` 的 `zoneFromCorners` 按 `ZONE_GRID = 0.1` 四舍五入。
- **复现**：

```js
const s = sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: 24, stage: true, checkin: true, seed: 3 });
const r = compileSceneScript(s, { base: mk(), floorIndex: 0, makeId: ids() });
console.log(r.issues.map(i => i.code));
// 实测：['E_ZONE_OUTSIDE','E_ZONE_OUTSIDE','E_ZONE_OUTSIDE','E_ZONE_OUTSIDE','E_ZONE_OUTSIDE','W_CAPACITY']
```

- **最小修复**：把"被夹"和"被取整"分开——`clampZoneRect` 返回 `{ rect, clamped: boolean }`，或比较时用 `1e-6` 容差判断"超出场地"（`|x| + w/2 > venue.width/2 + 1e-6` 之类），取整差异不报。

### P2-5　`W_DUPLICATE_ROLE` 说"只按第一块建"，实现却把每一块都建了

- **现象**：校验器明确警告 `stage 区不止一块，只按第一块建。`（`scene-script.ts:140`），但编译器 `:187` 是 `for (const zone of zonesWithRole(plan, 'stage'))`——**每块都建**。实测两块不重叠的 stage 区 → 出 2 块背板。警告与行为互相打脸，而警告还在 `issues` 里留着。
- **证据**：`scene-script.ts:138-142`（校验文案）vs `scene-script-compiler.ts:187`、`:217`（`checkin` 同理）。
- **复现**：

```js
const g = compileSceneScript({ version: 1, seed: 1, layoutMode: 'dining', zones: [
  { role: 'stage', rect: { x: -5.6, z: -4.4, w: 4.8, d: 1.4 } },
  { role: 'stage', rect: { x: -0.4, z: -4.4, w: 4.8, d: 1.4 } } ], constraints: { aisleMinM: 1.2, wallGapM: 0.35 } },
  { base: mk(), floorIndex: 0, makeId: ids() });
console.log('backdrops', last(g).floors[0].items.filter(i => i.type === 'backdrop').length, g.issues.map(i => i.code));
// 实测：backdrops 2，issues ['W_DUPLICATE_ROLE']（文案"只按第一块建"）
```

- **最小修复**：二选一。要么 `zonesWithRole(...).slice(0, 1)`（跟文案一致），要么把文案改成"会有多块，建议只留一块"。**推荐后者**：多块舞台是两个可用舞台，不是错误。

### P2-6　契约自相矛盾：`guests` 上限 10000，`zone.count` 上限 500，而 brief 直接 `count = guests`

- **现象**：`sceneScriptFromBrief` 把 `guests` 原样写进 `seating` 区的 `count`（`scene-script.ts:245-246`）。只要人数 ≥ 501，产出的脚本就**过不了自己的 `parseSceneScript`**（`zones[N].count` 超过 max 500）。今天没爆，是因为生成链路根本不 parse（见 P2-3）；一旦云端 planner / 草稿回读接上 `parseSceneScript`，501–10000 人的场地会整体 `E_SCRIPT_SHAPE` 被拒。
- **证据**：`scene-script-contract.ts`（`MAX_GUESTS = 10000`，zone `count` `.max(500)`）；`scene-script.ts:245-246`；`workbench-agent.ts:23` `HEADCOUNT_MAX = 10000`。
- **复现**：

```js
const { parseSceneScript } = require('./components/room-organizer/lib/scene-script.ts');
for (const g of [500, 501]) {
  const s = sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: g, stage: true, checkin: false, seed: 1 });
  const p = parseSceneScript(s);
  console.log(g, 'count', s.zones.find(z => z.role === 'seating').count, 'ok', p.ok, JSON.stringify(p.issues.map(i => [i.code, i.path])));
}
// 实测：500 → count 500 ok true；501 → count 501 ok false [['E_SCRIPT_SHAPE','zones.2.count']]
```

- **最小修复**：`count` 的 max 提到 `MAX_GUESTS`（500 那个上限没有产品依据），或者 brief 侧 `count: Math.min(guests, MAX_ZONE_COUNT)`。两者都行，但必须一致；顺手加一个"brief 产出的脚本必须能 parse 回来"的往返测试。

### P2-7　签到台没有"装得下"检查（舞台有），会静默越出自己的区

- **现象**：`checkin` 区只有 1.0 m 宽时，1.8 m 的接待台照样摆进去，左右各溢出 0.4 m 进入相邻区/通道，不报任何东西。舞台那条有显式宽度检查（`:191-200`），签到台和展位没有——同一类"区装不下这件家具"的处理不一致。
- **证据**：`scene-script-compiler.ts:217-233`（`checkin` 直接 `stamp(piece, 区中心)`，没有宽度/深度校验）vs `:191-200`（舞台有）。
- **复现**：

```js
const ck = compileSceneScript({ version: 1, seed: 1, layoutMode: 'dining',
  zones: [{ role: 'checkin', rect: { x: -1, z: 2, w: 1.0, d: 1.4 } }],
  constraints: { aisleMinM: 1.2, wallGapM: 0.35 } }, { base: mk(), floorIndex: 0, makeId: ids() });
const counter = last(ck).floors[0].items.find(i => i.type === 'counter');
console.log('counter x', counter.position.x, 'w', counter.width, '区 x 范围 -1..0 → 实际', counter.position.x - counter.width / 2, '..', counter.position.x + counter.width / 2);
// 实测：counter x -0.5 w 1.8 → 实际 -1.40 .. 0.40（越界 ±0.4），refusals []
```

- **最小修复**：给 `checkin`（和 `booth`）补舞台同款检查：`piece.width > rect.w - 2*wallGapM || piece.depth > rect.d - 2*wallGapM ⇒ E_ROLE_UNFIT`。

### P2-8　`seats` 不计锁定的椅子（与旧口径不同），会低估并触发假的容量提示

- **现象**：场地里有一把锁定的椅子时，最终布局其实有 17 把椅子，`seats` 报 16（`:267` 只数非锁定件）。旧路径 `seatCountIn` 是**数全部**椅子的。同一房间换引擎，座位数会掉 1，同时可能让"按 N 人摆了 M 座"偶发对不上（N 恰好等于真实座位数时）。
- **证据**：`scene-script-compiler.ts:266-267`（`placedItems` 已排除 `locked`）vs `agent-proposal.ts` 的 `seatCountIn`（数 `floor.items` 全部椅子）。
- **复现**：

```js
const lockedChair = makeItem({ id: 'lc', type: 'dining-chair', name: 'Locked chair', position: { x: 5.0, z: 3.9 }, locked: true });
const f = compileSceneScript(script({ guests: 16 }), { base: mk(12, 9, [lockedChair]), floorIndex: 0, makeId: ids() });
console.log('seats', f.seats, 'keptLocked', f.keptLocked, '实际椅子', last(f).floors[0].items.filter(i => i.type === 'dining-chair').length);
// 实测：seats 16，keptLocked 1，实际椅子 17
```

- **最小修复**：`seats` 把锁定椅子也算进来（`placedItems` 之外单独加回 `locked.filter(isSeat)`），或者在字段旁注明"本版新摆的座位数"，并让 `planLines` 用 `seats + keptLockedSeats`。

### P2-9　多座位区时 `settled` 只报最后一个区（有区失败也能显示"已收敛"）

- **现象**：一块座位区全被挡住、另一块正常时，`settled.converged` 仍是 `true`（后者覆盖前者），诊断信息把人往"没问题"方向误导。
- **证据**：`scene-script-compiler.ts:237-254`：`:252 settled = { passes: outcome.passes, converged: outcome.converged }` 每轮覆盖；`capacity` 却是累加（`:253`），两个字段口径不一致。
- **复现**：

```js
const slab = makeItem({ id: 'slab', type: 'wardrobe', name: 'Slab', width: 4.6, depth: 3.4, height: 2, position: { x: -2.85, z: -3.8 }, locked: true });
const multi = { version: 1, seed: 1, layoutMode: 'dining', zones: [
  { role: 'seating', rect: { x: -5.3, z: -3.8, w: 4.8, d: 3.5 }, count: 8 },
  { role: 'seating', rect: { x: 0.4, z: -3.8, w: 4.8, d: 3.5 }, count: 8 } ], constraints: { aisleMinM: 1.2, wallGapM: 0.35 } };
const m = compileSceneScript(multi, { base: mk(12, 9, [slab]), floorIndex: 0, makeId: ids() });
console.log('settled', JSON.stringify(m.settled), 'ops', JSON.stringify(m.ops), 'refusals', JSON.stringify(m.refusals));
// 实测：settled {passes:1, converged:true}；但 ops [{seating, placed:1, refused:1}]、refusals []
```

- **最小修复**：`settled` 改成 `{ passes: max, converged: 各区 logic-and, zones: number }`，或直接把 per-zone 结果挂到 `ops` 上。

---

## P3 · 可维护性 / 表达

### P3-1　`summary` 用未归一化的脚本生成，读白与实际不符
`scene-script-compiler.ts:83` 在 `normalizeSceneScript`（`:107`）之前生成读白。实测 `12 × 9 / 24 人`：读白说"签到台 2.4 × 1.3"，实际摆的是 2.3 m 宽（`zones.ts` 0.1 网格取整后）。建议 `:83` 移到 `:111` 之后（用 `plan`）。
- 复现：`console.log(r.summary)` 对照 `normalizeSceneScript(s, venue).script.zones`。

### P3-2　背板离北墙 0.75 m（旧实现 0.4 m），`wallGapM` 被扣两遍
`scene-script.ts:228-231` 生成 brief 时已经把 stage 区从墙边内缩了 `gap`，编译器 `:201` 摆背板时又加一次 `wallGapM`。实测 12 × 9：背板北沿 -3.75，北墙 -4.5 → **缝 0.75 m**；旧 `proposePlan` 是 0.4 m。纯视觉，需浏览器确认是否明显；若不接受，`:201` 改成 `rect.z + piece.depth / 2`。
- 复现：`last(r).floors[0].items.find(i => i.type === 'backdrop')` → `position.z - depth/2 = -3.75`。

### P3-3　`converged: true` 不等于"要的都摆下了"
`wanted` 被 `slots.length` 截断时（`:348`、`:359`），循环排满即 `converged: true`。语义上"收敛"指"这一轮没打架"，但字段名会被读成"按需求排好了"。建议改名 `settledQuietly` 或在 `capacity < asked` 时强制 `converged: false`。

### P3-4　`measureSet` 的 `makeId` 语义漂移 + `measure` 前缀 id 会落盘
`:424` 用固定 `idPrefix: 'measure'` 测量（会产生一批同 id 的临时件），`:436` 真正摆放才用 `seat-${makeId()}`。参数叫 `makeId` 却只在 build 里用，读起来像"测量也要 id"。建议测量用 `idPrefix: 'measure-' + makeId()` 或干脆说明"临时 id 不落盘"。

### P3-5　`seatsPerSet = Math.max(1, measured.count - 1)` 是魔法常数
`:334`：只有"5 件套 = 1 桌 4 椅"这一种家具集时成立。换一套（比如 1 桌 6 椅、或带吧台凳的）就错，而且它同时是 `capacity`（P1-1、P1-4）的唯一乘数。建议座位集本身声明 `seatsPerSet`（`FURNITURE_SETS` 加字段），或直接数 `type === 'dining-chair' | 'chair'` 的件数。

### P3-6　`scriptAttempt` 吞掉异常，编译期 bug 变成"静默降级"
`local-plan.ts:96-108`：`try { … } catch { return null }`。任何编译器抛错（我这轮评审就撞到过一次 `ReferenceError: rotatedVariant is not defined`）都只会让产品悄悄退回旧路径，测试之外没有任何信号（无 `console.warn`、无遥测、无 `fallbackReason`）。建议 `catch (error) { …; return { failed: true, error } }` 或至少 `console.warn` 一次。

### P3-7　`blocked` 时 `refused()` 不清场，但 UI 文案仍说"先出一版给你看着改"
`scene-script-compiler.ts:85-102` 返回 `layouts: [base]`（原样场地）、`removing: 0 / keptLocked: 0`；`agent-panel.tsx:750-751` 的 blocked 文案是"先出一版给你看着改：…"。用户看到的是没动过的场地 + 空 notes，无从"看着改"。建议 blocked 时仍给出"会清掉 N 件"的清场帧（`layouts: [cleared]`），或者把文案改成"脚本这版被拒了，原因是 X"。
- 触发条件：只有手写/云端脚本会走到（brief 路径的 blocked 会被 `local-plan.ts` 转 fallback），所以记 P3。

### P3-8　测试盲区（32 个新测试，一条都没覆盖 rotateBatch 朝向）
见文末「建议补的断言」。

---

# 二、六个问题的逐条回答

## 问题 1：几何是否正确？

**结论：几何约定与判定是对的，唯一错的不是几何而是朝向（P0-1）。朝向 bug 之所以没被几何测试抓到，是因为它恰好是 π 的偏差，`|cos|/|sin|` 不变，AABB 完全一致。**

1. **坐标约定**（NW 角 + w/d、场地居中、z 南正）：三处一致，没找到分歧。
   - 契约 `scene-script-contract.ts:28-33` `SCENE_SCRIPT_AXES = { unit: 'm', origin: 'center', axis: 'XZ', southIsPositiveZ: true }`；
   - `scene-script.ts:20` 注释"x = 0 是西墙，z = 0 是北墙"（配合 `RoomZone` 文档 `types.ts:262-266`："`x`/`z` is the north-west corner in world metres (room-centred)"）；
   - `gridSlots`（`scene-script-compiler.ts:464-477`）用 `rect.x + wallGap + halfX` 从西北角向内推格心，`stamp` 的 `position` 是件心，`intrudesKeepOut`（`:142-152`）与 `hasCollisions` 都按件心 ± 半宽算 → 三种表示之间没有偏移。
   - 南正核对：brief 把 stage 放在 `-depth/2 + gap`（北），把 checkin/plant 放在 `+`（南），落位后 stage 在 `z ≈ -3.7`、签到台在 `z ≈ +3.5`，与"舞台在北、签到在南"的常识一致。
2. **`rotatedHalfExtents` 的用法**：**正确，而且比通常以为的更准。** 对 90° 的整数倍旋转，AABB 的两个半轴精确互换（`|cos|`、`|sin|` 只会取到 0/1），所以 `rotatedVariant`（`:399-406`）把 `halfX/halfZ` 对调是**等值**而非保守近似 → `gridSlots` 用旋转后的尺寸排出的格子，与实际建造出来的包围盒严格吻合，不会出现"同版式组之间互相碰撞"。`measureSet`（`:423-438`）用真实 `buildFurnitureSet` 采样而不是猜 pitch，也是对的（1.8 m 的桌子带椅子实际宽 2.85 m）。
   - 唯一的保守性代价在任意角度（非 90° 倍数）时：AABB 会外扩，可能误拒靠边的件。编译器只产出 0/90/180/270，所以当下无影响；若日后允许脚本带角度，这里要换成 OBB。
3. **靠墙件**：两处口径不一致，但都不是"算错"，是"多留了 0.35 m"：
   - 背板：brief 已从墙内缩 `wallGapM`，编译器再加一次 → 12 × 9 实测离北墙 **0.75 m**（旧 0.4 m），见 P3-2。
   - 签到台/展位：**没有**"区装得下"检查（舞台有），1.0 m 宽的签到区会摆进 1.8 m 的接待台并溢出 0.4 m，见 P2-7。
4. **越界件 / keep-out**：三层闸门都在 `acceptBatch`（`:159-175`）：`intrudesKeepOut`（脚本的 aisle/reserved）→ `hasCollisions`（墙、柱、内墙、`floorKeepOut`、结构校验）→ `canApplyLayoutGeometry`（整场结构合法性）。脚本的 keep-out 与 `floorKeepOut` 是两套数据源，两套都生效、互不覆盖。**没有找到"能摆进通道"的漏网**；`12 × 9` 通道路径实测 0 违规。剩下的问题只是"装不下时的原因没记全"（P2-1）。
5. **真正的几何缺陷只有 P0-1（朝向）**，它不影响任何几何判定，所以几何层面的"挤/压墙/出界"是可信的。

## 问题 2：容量与 settle 收敛是否可靠？

- **settle 一定会终止**：`MAX_SETTLE_PASSES = 6`（`:72`）+ 每轮把失败格从 `candidates` 剔除（`:372`）+ 格间距 `2*half + SET_GAP_M(0.5)` ⇒ 同版式组之间不可能互撞，失败只可能来自**不随时间变化的**东西（锁定件、舞台、签到台、keep-out、结构）。失败格是单调减少的，所以循环次数 ≤ min(6, 格数)。不会出现"要得越少越摆不下"的死循环 —— 这点原设计是对的。
- **"永久剔除"不会误杀可放格**：既然失败原因在整个 settle 期间不变，被剔除的格在后续轮次也一定失败。唯一的理论反例是"两格各自都放得下、只有同时放才与结构冲突"，但结构判定是逐件叠加的，且格子间距已保证组间不重叠，构造不出来。
- **但"收敛"的语义被写松了**：`converged: true` 只表示"这一轮请求的都放下了"（`:367-370`）。当 `wanted > slots`（座位区装不下那么多人）时，请求被 `slice` 截断，排满也算 `converged: true`（P3-3）；多座位区时 `settled` 只保留最后一区（P2-9）。
- **`capacity` 不可靠，这是我最想拦下的一点**：
  - 组本身装不进场地时（`buildFurnitureSet` 返回 `[]` → `count = 0` → `seatsPerSet` 被 `Math.max(1, …)` 兜成 1），容量爆表：2 m 宽场地说"最多 **26** 座"、3 m 宽说"**52** 座"，而同一次编译一个座位都没摆出来（P1-1）。
  - 有锁定障碍时容量只按几何格数算，不扣掉永久占死的格：实测报"最多 24 座"、真实上限 20（P1-4）。
  - 也就是说 `capacity` 现在是"格子数 × 常数"，不是"这一版还能塞多少"。它唯一的消费者是 `W_CAPACITY` 文案（`:269-278`），而那条文案目前还没接到 UI（P2-2）——**在接线之前修掉它**，否则一上线就是假数字。

## 问题 3：记账（added / dropped / removing / keptLocked / overlapCount / seats）可信吗？

| 字段 | 可信度 | 依据 |
| --- | --- | --- |
| `added` | ✅ 精确 | `:282` = 最终楼层里非结构标记、非锁定的件数。12 × 9 / 24 人实测 25 = 1 背板 + 1 签到台 + 4 桌 + 16 椅 + 3 绿植，与逐件核对一致。 |
| `removing` | ✅ 精确 | `:118` 与真正被清掉的数量一致（只清非锁定、非结构标记）。 |
| `keptLocked` | ✅ 精确 | `:117` + `:119`，锁定件原样保留。 |
| `overlapCount` | ✅（脚本路径恒 0） | `acceptBatch` 已拦掉件间碰撞；`countOverlaps`（`:546`）会把**既有**的锁定件互相重叠也数进来，但那与本次出图无关，旧路径同口径。 |
| `seats` | ⚠️ 口径变了 | `:267` 只数非锁定椅子；旧 `seatCountIn` 数全部。房间实有 17 座会报 16（P2-8）。 |
| `dropped` | ❌ 不可信 | 两重问题：① 每轮重试都累加（`:371`），失败过但后来摆下的格子仍算"放不下"——12 × 9 座位一个没缺却报"1 件"; ② 单位混用，座位区记"组"、其他区记"件"（`:368` vs `:203`/`:223`），`sum(ops.placed) = 9` 而 `added = 25`（P1-2）。 |
| `capacity` | ❌ 不可信 | 见问题 2（P1-1、P1-4）。 |
| `ops` | ⚠️ 只能当诊断 | 单位混用；且"全挡"时 `refused` 有值而 `refusals` 是空的（P2-1）。 |

补一句：**"放不下的件数"目前有两套互不相容的口径**——`dropped`（按重试次数、混单位）和 `capacity - seats`（按座位）。二者都不等于"缺了多少件家具"。设计意图"任何放不下的件数都要记账"只做到了"有个数字"，没做到"这个数字能对上"。

## 问题 4：契约与类型

- **依赖与版本**：`zod` 在 `frontend/package.json` 与 `supabase/functions/deno.json` 的 import map 里都是 4.6.5，无版本漂移；`z.strictObject` 在两侧都可用。
- **schema 细节**：`.default({ aisleMinM: 1.2, wallGapM: 0.35 })`（契约 constraints）在 zod 4 下每次 parse 新建对象，没有共享可变默认值问题；`exactOptionalPropertyTypes: true` 下 `...(x ? { x } : {})` 的写法在 `scene-script.ts`（`:246`、`:270`）与 `local-plan.ts`（`:87-90`）一致，没有类型漏洞。4 个新文件 `tsc --noEmit` 0 错误。
- **跨目录 import 不会带来新的包体/运行边界风险**：`scene-script.ts:8` 直连 `../../../../supabase/functions/_shared/scene-script-contract`，与仓库既有做法同构（`_shared/domain`、`_shared/structural-geometry` 早就在被 frontend 直接 import），不是这次新开的先例。Deno 侧目前**没有**任何函数 import 这个契约（全仓只有 frontend 4 处引用），所以"共享契约"暂时是单向的、偏 frontend 的。
- **真正的契约问题在"校验没接线"**：`parseSceneScript`（`scene-script.ts:51`）只有测试在调；生成链路是"本地直接构造一个带类型的 Script 对象"交给编译器。于是：
  - 契约里的 bounds 形同虚设——`sceneScriptFromBrief` 直接把 `guests` 写进 `zone.count`（`scene-script.ts:245-246`），人数 ≥ 501 就产出一个**自己都 parse 不过**的脚本（实测 501 → `E_SCRIPT_SHAPE zones.2.count`，P2-6）；
  - `E_SCRIPT_SHAPE` 在生产链路永不产生（P2-3）。
  这不是"今天会坏"，而是"契约的承诺没有兑付点"：一旦云端 planner 或草稿回读接上 parse，501–10000 人的场地会整条被拒。
- **类型层导致的可观测性缺口**：`SceneScriptCompileResult extends PlanProposal` 多出的 6 个字段（`script/issues/refusals/ops/settled/capacity`）在 `LocalPlanResult`（`local-plan.ts:35-38`）里没声明，`viewOfLocalPlan(plan: PlanProposal)`（`agent-panel.tsx:104-112`）也拿不到 → 这正是 P2-2（整套词表没接线）的根源。建议要么在 `LocalPlanResult` 里显式带上 `refusals?: SceneScriptRefusal[]`，要么把这些字段从编译结果里删掉，别一行代码都没有消费者。

## 问题 5：把 `proposePlan` 换成 `localPlan` 带来的产品回归

按"用户能感知"排序：

1. **"加座，再排一版"在主路径失效**（P1-3，最实的一条）。`seatPriority` 的补偿分支不可达，点按钮前的提示专门提了"或按站立留空"（`agent-panel.tsx:139-140`），点了却一模一样。
2. **课室模式座位变少**：12 × 9 / 40 人，旧 24 座、新 20 座，帧数 9 → 5。新结果**没有重叠**（旧路径的 `tryAdd` 根本不查件间碰撞，只查结构，`agent-proposal.ts:199-210`），我倾向新口径更对，但用户少 4 座而`W_CAPACITY` 文案是死数据 ⇒ 完全不知道原因。要么接线 refusals，要么至少把"B 区被墙挡了"这种话说出来。
3. **小场地（8 × 6 及更小）几乎永久走旧引擎**：脚本路径一个座位都排不出来 → 退回启发式。**via 是稳定的**（我用 6 种小场地 × 8 个 variant 扫过，全是 `fallback`，没有 seed 抖动；因为脚本的座位数与 seed 无关，启发式的座位数也与 variant 无关），所以不会"换一版换引擎"；但 `fallbackReason` / `via` 没人显示 ⇒ 用户永远察觉不到自己在看旧方案。9 × 7、10 × 6 也是 fallback（实测），这个覆盖比想象的大。
4. **`blocked` 语义**：字段没变，口径也一致（新旧都只看 `canApplyLayoutGeometry`）；但 `refused()` 返回的是"没动过的原始场地 + removing 0"（P3-7），而 UI 文案说"先出一版给你看着改"，实际无内容可看。brief 路径的 blocked 一律转 fallback，所以这条在面板里基本摸不到。
5. **锁定件**：保留 ✅；会占格 → settle 按格剔除（设计对了），但 `seats` 不计锁定椅子（P2-8）。
6. **预览/撤销**：`presentProposal`（`agent-panel.tsx:733-753`）仍然逐帧、最后一帧 120 ms；`confirmProposal` 只 apply 最后一帧 ⇒ 一步撤销 ✅。帧数 5 正好等于 `GEN_STEPS`（`workbench-agent.ts:18`，5 条），旧课室模式 9 帧会让 `GEN_STEPS[n-1]` 越界——新版反而把旧的小 bug 修掉了。
7. **文案顺序**：`scriptSummaryOf`（`agent-panel.tsx:114-118`，新加）把计划读白拼在 notes 之前，`${intro}${planned}${notes.join('，')}。${tail}`。读白本身有信息量（"座位 11.3 × 4.1 m，24 座"），但它来自**未归一化**脚本（P3-1），可能与实际不符（签到台 2.4 × 1.3 vs 实际 2.3）。
8. **无关改动混在同文件**：`空白场地 → 空白空间`（`agent-panel.tsx:818-820`、`:1379` 附近）与本次无关，评审已排除，但提交时建议分开。

## 问题 6：测试盲区 + 最小建议

现状：3 个新测试文件共 **32 个用例**（`scene-script` 14、`scene-script-compiler` 11、`local-plan` 7），全绿。盲区按"如果补一条最能拦住哪类问题"排序：

| 盲区 | 会漏掉 | 最小断言 |
| --- | --- | --- |
| 从不断言 `item.rotation` / 朝向 | **P0-1**（16/16 椅子背对桌子却全绿） | 见 P0-1 的 `dot > 0` |
| `seatPriority` 只断言 `>=` | P1-3（"逐件相同"也满足 `>=`） | `expect(sig(prio)).not.toEqual(sig(plain))` 或 `expect(prio.seats).toBeGreaterThan(plain.seats)`（在脚本路径的用量下） |
| 不断言 `dropped` 与实际缺口一致 | P1-2（座位没缺却报 1 件） | 锁定一格 + `guests` 恰好满足：`expect(result.dropped).toBe(0)` |
| 不断言 `capacity` 与可达座位 | P1-1、P1-4 | 2 m 宽场地：`expect(result.capacity).toBe(0)`；锁定一件：`expect(result.capacity - result.seats).toBeLessThanOrEqual(seatsPerSet)` |
| 没有"brief 产出的脚本必须能 parse 回来"的往返测试 | P2-6 | `expect(parseSceneScript(sceneScriptFromBrief({ guests: 800, … })).ok).toBe(true)` |
| 不断言 `refusals` 非空当且仅当有件没摆下 | P2-1 | 全挡：`expect(result.refusals.length).toBeGreaterThan(0)` |
| 不断言标准 brief 不产生假告警 | P2-4 | `expect(result.issues.filter(i => i.code === 'E_ZONE_OUTSIDE')).toHaveLength(0)` |
| 多座位区只测了全成功 | P2-9 | 一区被挡：`expect(result.settled.converged).toBe(false)` |

建议再加两个"结构性"测试：① `sum(ops.placed)` 与 `added` 的口径在按件换算后相等（防止账面漂移）；② 同一脚本 + 同一 `makeId` 序列跑两次，`JSON.stringify` 全等（已有，保留）。

---

# 三、已确认没问题（逐条核过，不再展开复现）

1. 坐标/尺寸约定在契约、normalize、编译器、`RoomZone` 文档、渲染层之间一致（问题 1）。
2. `rotatedHalfExtents` 在 90° 倍数下与真实 AABB 精确相等；`gridSlots` 用旋转后的半宽排格不会自撞。
3. `acceptBatch` 是"整批接受或整批拒绝"（`:159-175`），不会出现"摆了一半的桌椅"；被拒时 `current` 不变（`:173` 只在通过时赋值）。
4. keep-out / 墙 / 柱 / 内墙三套判定都生效且不互相覆盖；通道路径实测 0 违规。
5. settle 有界、单调、不会死循环；失败格永久剔除是对的。
6. `added` / `removing` / `keptLocked` 三个字段精确（12 × 9 / 24 人：25 件，逐件核对通过）。
7. `overlapCount` 在脚本路径恒 0（`acceptBatch` 拦住了所有件间碰撞）。
8. 确定性：同输入跑两次逐件相同（`local-plan.test.ts:58-63`）；`makeId` 只影响 id，不影响几何。
9. 换一版（variant）不会换引擎：6 个小场地 × 8 个 variant 实测 via 与 seats 全部稳定（`8x6` → `fallback:8` × 8，`9x8` → `script:8` × 8 …）。
10. 帧数与进度：`layouts.length = 5`，`GEN_STEPS.length = 5`，`setProgress(step+1)` 不会越界（旧课室 9 帧才会）。
11. 确认/撤销：只 apply 最后一帧 → 一步撤回。
12. `blocked` 口径新旧一致（都是 `canApplyLayoutGeometry`）；`local-plan` 在脚本被拒时能安全退回启发式，且 fallback 不抛。
13. zod 4.6.5 两侧同版本；`strictObject`、`.default({...})`、`exactOptionalPropertyTypes` 的写法都正确；4 个新文件 `tsc` 0 错误。
14. 跨 `_shared` import 与既有做法同构，不新增打包边界风险。
15. `layered: 5 帧` 的预览节奏、`summary` 在非 blocked 分支才拼进文案、`scriptSummaryOf` 对缺失字段的兜底（`Array.isArray` + 长度判断）都正确。
16. `Plant` 的 `mulberry32(seed ^ 0x9e3779b9)` 决定论 ✓，`wanted * 6` 次尝试上限 ✓，摆不下的数量进 `ledger.refused` ✓（只是单位同样是"盆"）。

# 四、只能靠浏览器 / 交互验证（我给不了定论）

1. **3D 里椅子/课椅的真实朝向**（P0-1 的视觉定论）。数学上位置与 `rotation` 差 π 是事实；"背对桌子"是要用资产正面符号来读的（见「存疑」第 1 条）。请在 12 × 9 / 24 人、以及课室 12 × 9 / 40 人各截一张正视 3D 图。
2. 5 帧预览的节奏、"先读计划再落绿框"的顺序是否顺（`scriptSummaryOf` 现在拼在 notes 前面）。
3. 背板离北墙 0.75 m 是否肉眼可见地"离墙太远"（P3-2）。
4. "加座，再排一版"点下去的实际反馈（预期：方案与文案都不变，见 P1-3）。
5. 确认 → 撤销是否整体退回（含锁定件保持原位）。
6. `blocked` 分支在真实交互里是否可达（预期：只有手写/云端脚本会到）。
7. `空白场地 → 空白空间` 这批文案改动在面板上的实际呈现（与本功能无关，顺带看一眼）。

# 五、存疑（未验证，不下结论）

1. **椅子的"正面"符号**：我按家具目录自带的模板推断 `旋转 π/2 的椅子放在桌子东侧` ⇒ 正面 = 本地 +Z；作者手写的 5 件套（`scene-script` 不涉及，`furniture-sets` 里）也自洽为 +Z。若 3D 资产的正面前方另有一套约定，P0-1 的"背对"要反着读——但**位置映射与 `rotation` 必须同号**这个数学结论不受影响，仍是 bug。
2. `MAX_SETTLE_PASSES = 6` 的充分性：每轮剔除的是"当轮所有失败格"，所以轮数 ≤ 格数；24 格以内够用。超过 24 格且每轮只挡掉一格的理论场景没构造出来（未验证是否真会发生）。
3. `next build` 未跑（`npm run build` 含 `package-pages.mjs`，耗时）。跨目录 import 的 Next 打包影响按既有同构先例判断为无风险，但**未验证**。
4. 旧路径 `tryAdd` 只查结构、不查件间碰撞（`agent-proposal.ts:199-210`）是有意取舍还是欠债：这决定"新旧 seats 不可比"该怎么向产品解释。仓库里没找到说明（未验证）。
5. `overlapCount` 会把**既有的**锁定件互相重叠计入（`countOverlaps` 不区分新旧）。如果线上常见"用户自己锁了两件重叠的家具"，那么每版方案都会带一条"挤在一起"，需产品确认这是否是期望行为（未验证发生率）。

# 六、给 Lead 的处置建议（按性价比）

1. **先修 P0-1**（一个符号）：`rotation: (item.rotation ?? 0) - Math.PI / 2`，并补朝向断言。改动 1 行，消掉"主路径必出的错误产物"。
2. **再修 P1-3**（把座位优先判断提到早返回之前）：改动 5 行，救回"加座"按钮。
3. **接线前三思**：`W_CAPACITY` 的 `capacity` 现在是假数字（P1-1、P1-4）。如果马上要把 `issues` 显示到气泡里，请**先修容量口径**，否则等于主动把假上限告诉用户。
4. **账本改成"件"并把重试去重**（P1-2）：这次评审里"1 件放不下"和"52 件放不下"是最容易被用户当成 bug 的两条文案。
5. 其余 P2 可以排期；`E_ZONE_OUTSIDE` 假告警（P2-4）和 `count > 500`（P2-6）是"哪天接线就哪天爆"的定时炸弹，各 5 行以内可修。
