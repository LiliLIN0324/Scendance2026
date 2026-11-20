/**
 * 3D → 2D 指针桥的落点解析（2026-11-20 地图编辑交互审计 B5）。
 *
 * 3D 的射线打不到地面时（相机贴地、把物件拖过地平线）`eventToPlanHit` 返回 null。
 * 旧桥把这个 null 和真实 clientX/clientY 一起送进 2D，2D 的 `eventPlanPoint` 于是退回
 * 「用 clientX/Y 减 2D 舞台矩形」反算——那个点跟 3D 表面无关，松手就把物件提交在错位置。
 *
 * 这里把规则定成纯函数，桥和测试共用一份：
 * - 有命中：用新命中，并记成「上一个有效落点」；
 * - 没命中：沿用上一个有效落点（拖拽预览停在最后一次真的踩到地面的位置）；
 * - 一次有效落点都没有（点天空起手）：不猜坐标，告诉调用方这次事件直接忽略。
 */

export interface PlanBridgeHit {
  px: { x: number; y: number };
  pt: { x: number; y: number };
}

export interface PlanBridgeResolution<H extends PlanBridgeHit> {
  /** 这次要用的落点；null = 这一次没有可用落点。 */
  hit: H | null;
  /** 更新后的「上一个有效落点」。 */
  lastHit: H | null;
  /** true = 这次事件应整个跳过（不合成、不派发给 2D）。 */
  ignore: boolean;
}

export function resolveBridgedHit<H extends PlanBridgeHit>(
  kind: 'down' | 'move' | 'up' | 'leave' | 'dblclick' | 'contextmenu',
  hit: H | null,
  lastHit: H | null,
): PlanBridgeResolution<H> {
  if (kind === 'leave') {
    return { hit: null, lastHit: null, ignore: false };
  }
  if (hit) {
    return { hit, lastHit: hit, ignore: false };
  }
  if (lastHit) {
    return { hit: lastHit, lastHit, ignore: false };
  }
  return { hit: null, lastHit: null, ignore: true };
}
