'use client';

import { Download, Upload } from 'lucide-react';
import { downloadTextFile } from '../lib/plan-export/download';
import { capturePlanFileName, capturePlanSheetHtml, PHOTOS_PER_STOP_HINT, type CapturePlan } from '../lib/site-capture';
import { RECON_MATERIAL_BAN } from '../lib/site-recon-mock';
import type { AmapPoint } from '../lib/amap-venue';

interface Props {
  plan: CapturePlan;
  polygon: AmapPoint[];
  name: string;
  location: string;
  /** 拍完的素材交给 Aholo 重建。只有在用的重建入口可达时才传，按钮不会指向一个打不开的面板。 */
  onUpload?: (() => void) | undefined;
}

/**
 * 现场采集单：圈画后沿主客流线（或边界）给出站位与朝向。
 * D1：默认 / 手画流线加密站位；重建吃的是连续重叠的素材，清单是导出到纸上带进现场的。
 */
export function SiteCaptureCard({ plan, polygon, name, location, onUpload }: Props): JSX.Element | null {
  if (!plan.stops.length) {
    return <p className="sc-capture-empty">这块地圈得太小，边界拉不出站位。重新圈一块再出采集单。</p>;
  }
  const isFlow = plan.mode === 'flow';
  const meta = isFlow
    ? `${plan.size.width} × ${plan.size.depth} m · 流线 ${plan.flowLength ?? 0} m · ${plan.stops.length} 个站位 · 每站${PHOTOS_PER_STOP_HINT}`
    : `${plan.size.width} × ${plan.size.depth} m · 一圈 ${plan.perimeter} m · ${plan.stops.length} 个站位 · 每站${PHOTOS_PER_STOP_HINT}`;
  return <section className="sc-capture" aria-label="现场采集单">
    <div className="sc-capture-head">
      <strong>现场采集单 · {plan.shots} 张{isFlow ? ' · 沿流线' : ''}</strong>
      <span className="sc-note">{meta}</span>
      <button type="button" className="sc-button" onClick={() => downloadTextFile(capturePlanFileName(name), 'text/html', capturePlanSheetHtml(plan, polygon, { name, location }))}>
        <Download size={16} aria-hidden="true"/>导出采集单
      </button>
      {onUpload && <button type="button" className="sc-button" onClick={onUpload}>
        <Upload size={16} aria-hidden="true"/>去上传现场素材
      </button>}
    </div>
    {isFlow && <p className="sc-note">站位沿主客流线加密；未手画时用场地长轴默认流线，可在地图上改画。</p>}
    {onUpload && <p className="sc-note">拍完回来：素材交给 Aholo 做场地重建，出来的 3D 场景按真实米数铺在画布上。</p>}
    <p className="sc-capture-warn" role="note">{RECON_MATERIAL_BAN}</p>
    {plan.preferVideo && <p className="sc-capture-warn">
      {isFlow
        ? <>这条流线 {plan.flowLength ?? 0} 米，站距要拉到 {plan.spacing} 米才走得完，重叠不够、重建容易糊。建议直接沿流线录一段视频（.mp4 / .mov）代替逐站拍照。</>
        : <>这块地一圈 {plan.perimeter} 米，站距要拉到 {plan.spacing} 米才走得完，重叠不够、重建容易糊。建议直接录一段绕场视频（.mp4 / .mov）代替逐站拍照。</>}
    </p>}
    <details className="sc-capture-list">
      <summary>看 {plan.stops.length} 个站位</summary>
      <ol>
        {plan.stops.map(stop => <li key={stop.index}>
          <strong>{stop.index}</strong>
          <span>镜头朝{stop.compass}（{stop.bearing}°）</span>
          <span className="sc-capture-coord">{stop.lng.toFixed(6)}, {stop.lat.toFixed(6)}</span>
        </li>)}
      </ol>
    </details>
  </section>;
}
