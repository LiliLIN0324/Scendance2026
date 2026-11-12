import { type Ref } from 'react';

export interface GeoScaleCompassProps {
  scaleLabelRef: Ref<HTMLSpanElement>;
  scaleBarRef: Ref<HTMLDivElement>;
  compassRef: Ref<HTMLDivElement>;
  /** 图源署名文案（basemapSourceAttribution）；空值不渲染胶囊（纸面模式无署名）。 */
  attribution?: string | null;
  /** testid 前缀：户外 3D 用 outdoor-3d，主舞台 GeoGround 用 geo-ground。 */
  testIdPrefix?: string;
}

/**
 * 地理底图左下角「比例尺 + 指北针罗盘 + 图源署名」簇（Google/高德范式）。
 *
 * outdoor-plan-3d 与主舞台 GeoGround（room-organizer）共用同一 DOM 结构与样式：
 * refs 由调用方驱动——户外 3D 在自己的渲染循环里每帧更新，主舞台挂
 * controls 'change' 监听更新。两处都是「北 = -z」相机口径，更新公式一致。
 */
export function GeoScaleCompass({ scaleLabelRef, scaleBarRef, compassRef, attribution, testIdPrefix = 'geo' }: GeoScaleCompassProps): JSX.Element {
  return (
    <>
      <div data-testid={`${testIdPrefix}-compass`} className="sc-geo-scale-north">
        <div className="sc-geo-scale-stack">
          <span ref={scaleLabelRef} className="sc-geo-scale-label">50 m</span>
          <div ref={scaleBarRef} className="sc-geo-scale-bar"/>
        </div>
        <div className="sc-geo-compass-dial">
          <div ref={compassRef} className="sc-geo-compass-needle">
            <div className="sc-geo-compass-tri is-north"/>
            <div className="sc-geo-compass-tri is-south"/>
            <span className="sc-geo-compass-n">N</span>
          </div>
        </div>
      </div>
      {attribution ? <div data-testid={`${testIdPrefix}-attribution`} className="sc-geo-attribution-pill">{attribution}</div> : null}
    </>
  );
}
