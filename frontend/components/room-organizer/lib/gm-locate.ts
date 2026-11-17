/** 定位钮点下去之后，视野有没有被挪走。 */
export type LocateOutcome = 'moved' | 'miss';

/** 蓝点脉冲停留时长。定位本身是同步的，这段只让人看见「正在定位」。 */
export const LOCATE_PENDING_MS = 720;
/** 失败说明留在钮旁的时长，够读完一句原因。 */
export const LOCATE_FAILED_MS = 3200;

export const LOCATE_PENDING_LABEL = '正在定位';
export const LOCATE_FAILED_LABEL = '无法定位：还没有可框选的场地';

/**
 * 和 focusScopeOrVenue 用同一套门槛。
 * 2D：画布在，并且已经圈了设计范围，或者至少有锚点。
 * 其余视图：地图足迹够三个点，才能框选场地。
 */
export function locateReadiness(input: {
  outdoor2D: boolean;
  designScopeCount: number;
  hasAnchor: boolean;
  hasOverlay: boolean;
  mapFootprintCount: number;
}): LocateOutcome {
  if (input.outdoor2D) {
    if (!input.hasOverlay) return 'miss';
    if (input.designScopeCount >= 3 || input.hasAnchor) return 'moved';
    return 'miss';
  }
  return input.mapFootprintCount >= 3 ? 'moved' : 'miss';
}
