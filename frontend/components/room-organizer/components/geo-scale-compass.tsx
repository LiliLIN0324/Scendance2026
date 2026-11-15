import { useRef, type PointerEvent as ReactPointerEvent, type Ref } from 'react';

export interface GeoScaleCompassProps {
  scaleLabelRef: Ref<HTMLSpanElement>;
  scaleBarRef: Ref<HTMLDivElement>;
  compassRef: Ref<HTMLDivElement>;
  /** 图源署名文案（basemapSourceAttribution）；空值不渲染（纸面模式无署名）。 */
  attribution?: string | null;
  /** testid 前缀：户外 3D 用 outdoor-3d，主舞台 GeoGround 用 geo-ground。 */
  testIdPrefix?: string;
  /** 点击罗盘（按下未拖动）：相机方位复位到正北。不传则罗盘纯展示、不响应指针。 */
  onResetNorth?: (() => void) | undefined;
  /** 在罗盘上左右拖动：入参为方位角增量（弧度，正方向由调用侧 spherical.theta 口径决定）。不传则不可拖。 */
  onOrbitDelta?: ((deltaTheta: number) => void) | undefined;
  /** 是否渲染右下罗盘卡。2026-11-15 用户指令：方向指示只保留右上工具簇那枚指北针，
      主舞台 2D 户外规划态传 false 撤掉旧罗盘；比例尺与署名始终保留。默认 true 供 3D 接管层兜底。 */
  showCompass?: boolean;
}

/** 判定拖动 vs 单击的水平位移阈值（CSS px）。 */
const COMPASS_DRAG_THRESHOLD_PX = 3;
/** 拖动转盘灵敏度：每像素对应的方位角弧度。 */
const COMPASS_ORBIT_RAD_PER_PX = 0.008;

/**
 * 地理底图角标簇（2026-11-14 用户指令「2D/3D 同步统一」）：
 * - 左下：比例尺 + 图源署名同行（署名跟在比例尺旁，不再右侧/短名）；
 * - 右下：白色圆角罗盘卡（指针随相机转向，北蓝南灰——与 2D「指北针|地图」卡同一套设计）。
 *
 * outdoor-plan-3d 与主舞台 GeoGround（room-organizer）共用同一 DOM 结构与样式：
 * refs 由调用方驱动——户外 3D 在自己的渲染循环里每帧更新，主舞台挂
 * controls 'change' 监听更新。两处都是「北 = -z」相机口径，更新公式一致。
 *
 * 罗盘交互（仅户外 3D 接入回调）：短按回正朝北；左右拖动转盘绕目标水平旋转。
 * 不传回调时退回纯展示，卡片不接指针事件。
 */
export function GeoScaleCompass({
  scaleLabelRef,
  scaleBarRef,
  compassRef,
  attribution,
  testIdPrefix = 'geo',
  onResetNorth,
  onOrbitDelta,
  showCompass = true,
}: GeoScaleCompassProps): JSX.Element {
  const interactionRef = useRef<{
    pointerId: number;
    startX: number;
    lastX: number;
    dragging: boolean;
  } | null>(null);

  const interactive = Boolean(onResetNorth || onOrbitDelta);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!interactive) return;
    interactionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = interactionRef.current;
    if (!state || state.pointerId !== event.pointerId || !onOrbitDelta) return;
    const dx = event.clientX - state.lastX;
    if (!state.dragging && Math.abs(event.clientX - state.startX) > COMPASS_DRAG_THRESHOLD_PX) {
      state.dragging = true;
    }
    if (state.dragging) {
      onOrbitDelta(dx * COMPASS_ORBIT_RAD_PER_PX);
      state.lastX = event.clientX;
    }
  };

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>, resetOnClick: boolean): void => {
    const state = interactionRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (resetOnClick && !state.dragging) onResetNorth?.();
    interactionRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* 指针已释放，忽略。 */
    }
  };

  const cardClass = interactive
    ? 'sc-geo-compass-card sc-geo-compass-card--interactive'
    : 'sc-geo-compass-card';

  return (
    <>
      <div data-testid={`${testIdPrefix}-scale`} className="sc-geo-scale-north">
        <div className="sc-geo-scale-stack">
          <span ref={scaleLabelRef} className="sc-geo-scale-label">50 m</span>
          <div ref={scaleBarRef} className="sc-geo-scale-bar"/>
        </div>
        {attribution ? <span className="sc-geo-attribution-text">{attribution}</span> : null}
      </div>
      {showCompass && (
      <div
        data-testid={`${testIdPrefix}-compass`}
        className={cardClass}
        role={interactive ? 'button' : undefined}
        aria-label={interactive ? '罗盘：点击回正朝北，左右拖动旋转视角' : undefined}
        onPointerDown={interactive ? handlePointerDown : undefined}
        onPointerMove={interactive ? handlePointerMove : undefined}
        onPointerUp={interactive ? (e => endInteraction(e, true)) : undefined}
        onPointerCancel={interactive ? (e => endInteraction(e, false)) : undefined}
      >
        <div ref={compassRef} className="sc-geo-compass-needle">
          <svg width="20" height="28" viewBox="0 0 20 28" fill="none" aria-hidden="true">
            <path d="M10 1 L15.5 13 L10 10.4 L4.5 13 Z" fill="#1d4ed8" />
            <path d="M10 27 L15.5 15 L10 17.6 L4.5 15 Z" fill="#4b5563" />
          </svg>
        </div>
      </div>
      )}
    </>
  );
}
