'use client';

import type { RefObject } from 'react';
import { DEFAULT_FLOOR_PLAN_OPACITY } from '../lib/constants';
import type { RoomLayout, ViewSettings } from '../lib/types';
import './reference-image-controls.css';

interface Props {
  layout: RoomLayout; view: ViewSettings; ready: boolean; notice: string;
  onShow(value: boolean): void; onOpacity(value: number): void;
  onReview(): void; onReload(): void; reviewButtonRef?: RefObject<HTMLButtonElement>;
}

export function ReferenceImageControls({ layout, view, ready, notice, onShow, onOpacity, onReview, onReload, reviewButtonRef }: Props): JSX.Element {
  const v2 = !!layout.backendSceneV2;
  const available = v2 ? ready : !!layout.floorPlanImage;
  const opacity = view.referenceImageOpacity ?? layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY;
  return <details className="sc-reference-image"><summary>参考底图</summary><div className="sc-reference-image-body">
    <strong>{v2 ? '图纸与当前设计对应' : '示意底图'}</strong>
    <p>{notice}</p>
    <label className="sc-reference-check"><input type="checkbox" aria-label="显示参考底图" checked={view.showReferenceImage !== false} disabled={!available} onChange={event => onShow(event.target.checked)}/>显示参考底图</label>
    <label>底图透明度 {Math.round(opacity * 100)}%<input aria-label="底图透明度" type="range" min="0" max="1" step="0.05" value={opacity} disabled={!available} onChange={event => onOpacity(Number(event.target.value))}/></label>
    {v2 && <button ref={reviewButtonRef} type="button" onClick={onReview}>选择图纸并核对对应</button>}
    {v2 && <button type="button" className="sc-reference-reload" onClick={onReload}>重新读取本机资料</button>}
  </div></details>;
}
