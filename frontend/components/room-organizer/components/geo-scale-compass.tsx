import { type Ref } from 'react';

export interface GeoScaleCompassProps {
  scaleLabelRef: Ref<HTMLSpanElement>;
  scaleBarRef: Ref<HTMLDivElement>;
  compassRef: Ref<HTMLDivElement>;
  /** 图源署名文案（basemapSourceAttribution）；空值不渲染（纸面模式无署名）。 */
  attribution?: string | null;
  /** testid 前缀：户外 3D 用 outdoor-3d，主舞台 GeoGround 用 geo-ground。 */
  testIdPrefix?: string;
}

/**
 * 地理底图角标簇（2026-11-14 用户指令「2D/3D 同步统一」）：
 * - 左下：比例尺 + 图源署名同行（署名跟在比例尺旁，不再右侧/短名）；
 * - 右下：白色圆角罗盘卡（指针随相机转向，北蓝南灰——与 2D「指北针|地图」卡同一套设计）。
 *
 * outdoor-plan-3d 与主舞台 GeoGround（room-organizer）共用同一 DOM 结构与样式：
 * refs 由调用方驱动——户外 3D 在自己的渲染循环里每帧更新，主舞台挂
 * controls 'change' 监听更新。两处都是「北 = -z」相机口径，更新公式一致。
 */
export function GeoScaleCompass({ scaleLabelRef, scaleBarRef, compassRef, attribution, testIdPrefix = 'geo' }: GeoScaleCompassProps): JSX.Element {
  return (
    <>
      <div data-testid={`${testIdPrefix}-scale`} className="sc-geo-scale-north">
        <div className="sc-geo-scale-stack">
          <span ref={scaleLabelRef} className="sc-geo-scale-label">50 m</span>
          <div ref={scaleBarRef} className="sc-geo-scale-bar"/>
        </div>
        {attribution ? <span className="sc-geo-attribution-text">{attribution}</span> : null}
      </div>
      <div data-testid={`${testIdPrefix}-compass`} className="sc-geo-compass-card">
        <div ref={compassRef} className="sc-geo-compass-needle">
          <svg width="20" height="28" viewBox="0 0 20 28" fill="none" aria-hidden="true">
            <path d="M10 1 L15.5 13 L10 10.4 L4.5 13 Z" fill="#1d4ed8" />
            <path d="M10 27 L15.5 15 L10 17.6 L4.5 15 Z" fill="#4b5563" />
          </svg>
        </div>
      </div>
    </>
  );
}
