# 第 12 批「能摆 → 会摆」接口冻结（内部 spec，不对外导出）

本文件冻结两个新纯函数模块的导出签名，供两个子任务并行实现后再由 UI 串联。
实现时严格按此签名，不要增删导出、不要改字段名；后续 UI 串联直接消费。

## 已有上下文（不要重新发明）

- `planZones(annotations, density): ZonePlanOutcome` 已在 `./plan-approve.ts`
  - 返回 `{ placements: ZoneFurniturePlacement[], skipped: ZonePlanSkipped[] }`
  - `ZoneFurniturePlacement = { spec: FurnitureSpec, x, z, rotation, zoneId, zoneType }`
  - `FurnitureSpec = { type, name, category, width, depth, height, color, icon }`
- `PlanAnnotation` 在 `./plan-annotation.ts`，zone 标注的几何是 `{ kind:'rect', x, z, width, depth }`，`zoneType?: 'roundtable'|'checkin'|'photo'|'rest'`
- 坐标约定：米制、房间中心为原点；x 向右、z 向下（z 越小越靠「上/北」）。
- 签到区 `rowCheckin` 把签到台放在 zone 内侧（z 较大方向），工作人员椅在台后（z 更大）；
  因此「入口侧」约定为 **zone 的 z0 边（z 较小的那一侧）**——宾客从 z 负方向走来。

## flow-constraints.ts（必须导出）

```ts
/** 主通道最低净宽（米）：普通通过。 */
export const AISLE_MIN_NORMAL = 1.2;
/** 主通道最低净宽（米）：轮椅友好。 */
export const AISLE_MIN_WHEELCHAIR = 1.5;

export interface FlowEvaluation {
  /** 签到区入口侧（z0 边外）到最近家具/zone 家具投影的净空，米；没有签到区时返回 Infinity。 */
  aisleWidthM: number;
  /** aisleWidthM >= AISLE_MIN_WHEELCHAIR。 */
  wheelChairPassable: boolean;
  /** aisleWidthM >= AISLE_MIN_NORMAL。 */
  normalPassable: boolean;
  /** 签到区入口侧是否被任何家具（zone 内或 zone 外）堵上：从 z0 边往 z 负方向扫，遇到第一件家具即算堵。 */
  checkinBlocked: boolean;
  /** 全部人话违规原因（用于打分扣分项 + UI 回执），空数组表示通过。 */
  violations: string[];
}

/**
 * 评估一批 placements 相对 zone 标注的动线合规度。
 * - 没签到区时 aisleWidthM=Infinity、checkinBlocked=false、violations=[]（不约束）。
 * - 有签到区时：
 *   1. 取 zone 的 z0 边（x∈[x0,x0+w]）作为入口基准；
 *   2. 在 placements 中找「落入 [x0-0.3, x0+w+0.3] 横向条带且 z < z0」的家具，
 *      取其中 z 最大（最靠近 z0）的一件，净空 = z0 - 那件的 z 后缘（z + depth/2）；
 *      找不到就算没堵。
 *   3. aisleWidthM = 净空；checkinBlocked = 净空 < 0.5（贴脸堵）。
 *   4. violations：
 *      - 净空 < 1.2m → `签到台前通道只剩 ${净空.toFixed(1)}m，轮椅过不去`（同时记 normal 不过）
 *      - 1.2m ≤ 净空 < 1.5m → `签到台前通道 ${净空.toFixed(1)}m，轮椅过不去，但行人能过`
 *      - checkinBlocked → `签到区入口被家具贴脸堵住`
 */
export function evaluateFlow(
  placements: readonly ZoneFurniturePlacement[],
  zones: readonly PlanAnnotation[],
): FlowEvaluation;
```

## plan-scoring.ts（必须导出）

```ts
import type { PlanAnnotation, ZoneSemanticType } from './plan-annotation';
import type { ZoneFurniturePlacement, ZonePlanSkipped } from './plan-approve';
import { evaluateFlow } from './flow-constraints';

export type PlanVariantId = 'sparse' | 'balanced' | 'dense';

export interface ScoredPlan {
  variantId: PlanVariantId;
  /** UI 显示的中文短名，如「松」「适中」「密」。 */
  label: string;
  /** 实际喂给 planZones 的密度旋钮值。 */
  density: number;
  placements: ZoneFurniturePlacement[];
  skipped: ZonePlanSkipped[];
  /** 容量：可坐座位/工位件数。规则：餐椅+工作椅各算 1，长椅每张算 2，签到台本身不重复数。 */
  capacitySeats: number;
  /** 越界件数：placement 中心落在来源 zone rect 外扩 0.05m 之外的件数（一般应为 0；>0 说明生成器出问题）。 */
  outOfBounds: number;
  /** 动线评估结果（直接来自 evaluateFlow）。 */
  flow: FlowEvaluation;
  /** 总分：capacitySeats - 2*skipped.length - 3*outOfBounds - 动线扣分
   *   动线扣分：violations 每条含「轮椅过不去」且 normal 不过 → -5；
   *           violations 每条含「轮椅过不去」但 normal 过 → -2；
   *           checkinBlocked → -8。
   */
  score: number;
  /** 人话理由数组，2~4 条，正负有都写（如「可坐 12 座」「签到台前通道 0.8m，扣分」）。 */
  reasons: string[];
}

/**
 * 对同一批 zone 标注生成三版布置（密度 sparse=0.25 / balanced=0.5 / dense=0.8），
 * 每版独立调 planZones + evaluateFlow + 打分。返回三版数组（顺序固定）。
 */
export function generateScoredPlans(annotations: readonly PlanAnnotation[]): ScoredPlan[];

/**
 * 从三版里挑推荐版：score 最高；并列时优先 balanced > sparse > dense。
 * 若三版全 empty（placements 都空），返回 balanced 版（让 UI 走「摆不下」分支）。
 */
export function pickRecommendedPlan(plans: readonly ScoredPlan[]): ScoredPlan;
```

## 红线

- 不引新依赖；不引新色系；中文简体 UI 文案；UI 文案禁「高斯 / WorldGen」。
- 纯函数、不可变、不读 layoutStore、不接 React。
- 坐标与现有 `ZoneFurniturePlacement` 一致（米制、中心原点）。
- 越界判定：用 `p.x`、`p.z` 对照来源 `zoneId` 的 rect；找不到 zone 视为不越界（容错）。
