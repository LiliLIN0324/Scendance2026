/**
 * 漫游视角档位与机位偏移纯函数层（#59 骨架迁移的可测地基，不接 three 场景）。
 *
 * 档位口径见 `.temp/research-B-camera-views.md`：
 * - `orbit` 鸟瞰环绕（OrbitControls 接管，相机独立于主角，不套身后）；
 * - `first` 第一人称（相机即玩家锚点，眼高不后拉）；
 * - `third` 第三人称跟随；
 * - `shoulder` 过肩跟随。
 *
 * 偏移常数迁自旧室内退役链路 `use-walkthrough.ts`（third 后拉 4 m + 右偏 0.65；
 * shoulder 后拉 1.5 m + 右偏 0.42 + 眼高 −0.18）。本模块只算平面偏移分量与高度修正，
 * 跟随 lerp / 遮挡射线 / avatar 摆位留场景与 hook 层。
 *
 * 坐标系：站点 ENU（x 东、z 北，米）；yaw 为朝向角，`forward = (sin yaw, cos yaw)`。
 */

export type WalkViewMode = 'orbit' | 'first' | 'third' | 'shoulder';

/** 视角循环顺序（按钮 / 快捷键依次切换）。 */
export const WALK_VIEW_ORDER: readonly WalkViewMode[] = ['orbit', 'first', 'third', 'shoulder'];

/** 档位机位偏移：后拉距离、右偏距离、眼高修正、是否第三人称跟随。 */
export interface ViewRigOffset {
  /** 沿后向拉离锚点的距离（米）；0 表示相机就在锚点。 */
  back: number;
  /** 沿右向偏移距离（米）。 */
  right: number;
  /** 相对锚点眼高的高度修正（米）。 */
  heightDelta: number;
  /** 是否为第三人称 / 过肩（需要 avatar 与跟随）。 */
  thirdPerson: boolean;
  /**
   * 本档是否由 OrbitControls 接管的高空环绕相机（#82 真鸟瞰）。
   * 为 true 时：hook 跳过步行移动与 walk-step 相机摆位、不抢指针锁；场景层重新启用
   * OrbitControls 摆高空俯视机位，左键环绕 / 滚轮缩放，不参与近邻 E 提示。
   */
  orbitCamera?: boolean;
}

export const VIEW_RIG_OFFSETS: Record<WalkViewMode, ViewRigOffset> = {
  orbit: { back: 0, right: 0, heightDelta: 0, thirdPerson: false, orbitCamera: true },
  first: { back: 0, right: 0, heightDelta: 0, thirdPerson: false },
  third: { back: 4, right: 0.65, heightDelta: 0, thirdPerson: true },
  shoulder: { back: 1.5, right: 0.42, heightDelta: -0.18, thirdPerson: true },
};

/** 取下一档视角（循环回到开头）。 */
export function nextWalkViewMode(current: WalkViewMode): WalkViewMode {
  const index = WALK_VIEW_ORDER.indexOf(current);
  const next = index < 0 ? 0 : (index + 1) % WALK_VIEW_ORDER.length;
  return WALK_VIEW_ORDER[next]!;
}

/** 取档位机位偏移常数。 */
export function viewRigOffset(mode: WalkViewMode): ViewRigOffset {
  return VIEW_RIG_OFFSETS[mode];
}

/** 平面偏移分量（ENU）：后拉沿后向、右偏沿右向。 */
export interface RigPlanOffset {
  x: number;
  z: number;
  heightDelta: number;
  thirdPerson: boolean;
  orbitCamera: boolean;
}

/** 编辑环绕的俯角上限（弧度）。小于 π/2，相机保持在目标水平面之上。 */
export const EDITOR_MAX_POLAR = Math.PI * 0.46;

/**
 * 鸟瞰漫游时相机相对目标至少抬高这么多（米）。
 * 近距离若仍用编辑俯角上限，近裁剪面会切进地面。
 */
export const WALK_AERIAL_CLEARANCE_M = 1.25;

/**
 * 按当前距离收紧俯角，使相机高度不低于 clearance。
 * 远距离仍受编辑上限约束。
 */
export function aerialPolarLimit(
  distance: number,
  clearance = WALK_AERIAL_CLEARANCE_M,
  editorMax = EDITOR_MAX_POLAR,
): number {
  if (!Number.isFinite(distance) || !Number.isFinite(clearance) || clearance <= 0) return editorMax;
  if (!(distance > clearance + 1e-4)) return Math.min(editorMax, 0.05);
  const byGround = Math.acos(Math.min(1, Math.max(0, clearance / distance)));
  return Math.min(editorMax, byGround);
}

/**
 * 按朝向 yaw 把档位偏移换算成锚点到相机的平面位移。
 * 相机期望位置 = 锚点 + (x, heightDelta, z)；场景层再做跟随阻尼与遮挡回退。
 */
export function rigOffsetForYaw(mode: WalkViewMode, yaw: number): RigPlanOffset {
  const offset = VIEW_RIG_OFFSETS[mode];
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // forward=(sin, cos)；右向量顺时针 90° = (cos, -sin)。
  const x = -offset.back * sin + offset.right * cos;
  const z = -offset.back * cos - offset.right * sin;
  return { x, z, heightDelta: offset.heightDelta, thirdPerson: offset.thirdPerson, orbitCamera: offset.orbitCamera ?? false };
}
