# 37 · MP-PLAN 风格 brief（C1）

目标：同一场地、同一批区标注，按 3 个风格 brief 出 3 套**完整备选**，让甲方在 3 套里挑；
三套必须真的不同，不能是同一摆法换配色。

对应 [docs/24](24-Web端三个产品问题.md) 第 2 节 2-1～2-5；本轮做的是可自动验的部分，
真人盲评与真实提案仍按原判据另行验收。

## 1. 一套风格 brief 是什么

| 字段 | 含义 | 本轮边界 |
| --- | --- | --- |
| `label` / `prompt` | 客户能说的风格词（如「暖木宴会，圆桌围坐」） | 内置三套，中文短句 |
| `recipeOverride` | 把圆桌区改排成另一种**已验证过的配方** | 只放行 `roundtable → desk`（课桌排）和 `roundtable → checkin`（接待长桌矩阵） |
| `colors` | 家具 type → 颜色；未列出的保持 catalog 本色 | 只改颜色，不新增家具类型 |

设计红线：

- **不新造家具类型**：三种摆法都复用 `furniture-catalog` 里已有条目，几何基线（`scan-placement.ts`、`furniture-builders.ts`）不动；
- **风格不豁免规则**：每套仍走 `generateScoredPlans` 同一套硬约束（越界/穿模/可达/门弧/必留区），风格差异不能靠违规换；
- **配方白名单**：`roundtable → photo/rest/...` 这类覆盖一律忽略，回落原配方，防止风格把区改成未验摆法；
- **普通签到区不变**：多排只在「风格把大区改排成接待」时启用，正常签到区仍是一排。

## 2. 内置三套

| key | 短名 | 摆法 | 色彩 |
| --- | --- | --- | --- |
| `banquet-warm` | 暖木宴会 | 圆桌 Ø1.8 + 每桌 8 椅（一区最多 3 桌） | 胡桃木 + 香槟金 |
| `theater-ink` | 墨白剧院 | 1.8×0.6 课桌成排，每桌 3 椅，排距 1.4 m | 墨黑 + 白 |
| `reception-mist` | 雾蓝接待 | 1.4×0.6 接待桌成排（大区按纵深重复），每桌 1 椅 | 雾蓝 + 灰 |

## 3. 差异怎么算（docs/24 2-3）

`compareStylePlans(a, b)` 按「同一区 + 区内顺序」逐件配对，只比配得上的部分，不硬凑：

- **SKU 替换率** = 配对中 `type + 名称` 不同的件数 / 配对数；
- **位置变动率** = 配对中位移 > 0.5 m 的件数 / 配对数；
- **色彩族不同** = 两版用到的颜色集合不完全相同（至少 1 项不同）；
- **通过线** = `(SKU ≥30% 或 位置 ≥40%) 且 色彩族不同`。

## 4. 本轮实测（夹具，18×12 m 场地、中央 14×7 m 宾客区）

| 风格 | 件数 | 座位 | 跳过区 | 越界 | 可行 |
| --- | --- | --- | --- | --- | --- |
| 暖木宴会 | 27 | 24 | 0 | 0 | 是 |
| 墨白剧院 | 120 | 90 | 0 | 0 | 是 |
| 雾蓝接待 | 24 | 12 | 0 | 0 | 是 |

任两套：SKU 替换 100%、位置变动 96%～100%、色彩族均不同，3/3 过 2-3。
数据：[docs/evidence/C1/style-plan-runs.json](evidence/C1/style-plan-runs.json)。

## 5. 还没闭环

| docs/24 | 状态 | 还差什么 |
| --- | --- | --- |
| 2-1 8 小时出 3 版 | ⏳ | 生成层已能一次出 3 套；真实场地计时、出图/确认/导出全链路未跑 |
| 2-2 风格真的不同 | ⏳ | 3 人盲评未做（本轮只证可量化差异） |
| 2-3 差异可量化 | ✅ | 夹具 3/3 对过线，规则进 `npm run gate` |
| 2-4 甲方真会挑 | ⏳ | 需 10 次真实提案 |
| 2-5 不比人贵 | ⏳ | 需人工 3 版对照计时 |

**产品入口未接**：目前是纯函数层（`generateStylePlans`），工作台仍出「松/适中/密」三档密度；
把风格 brief 接进方案卡需要改独占区 `room-organizer.tsx`，按 COLLAB §四先登记再动。

## 6. 代码入口

| 位置 | 作用 |
| --- | --- |
| `frontend/lib/style-plan.ts` | 三套 brief、`generateStylePlans`、`isCompletePlan`、`compareStylePlans`（纯函数） |
| `frontend/lib/style-plan.test.ts` | 9 例：3/3 完整、SKU/位置/色彩过 2-3、可复现、配方白名单、只换列出 type、未传风格零变化 |
| `frontend/lib/plan-approve.ts` | 新增 `PlanZoneStyle` / `resolveZoneRecipe`；`planZones` 第三参可换配方与颜色；接待大区多排 |
| `frontend/lib/plan-scoring.ts` | `ScoringOptions.style` 透传到 `planZones`，评分口径不变 |
| `scripts/release-gate.mjs` | `style-plan.test.ts` 已进核心门禁 |
