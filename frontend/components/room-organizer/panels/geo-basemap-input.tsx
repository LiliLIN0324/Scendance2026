'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, MapPin } from '@/components/solid-icons';
import { createPresetResearchArea, XIHU_LOCAL_NAME } from '../lib/research-area';
import type { RoomLayout } from '../lib/types';
import type { IsoBasemapStatus } from '../three/iso-basemap';

/**
 * 地图入口：只做西湖 · 平湖秋月这一小片。
 *
 * 暂时不做西湖以外的地方，所以这里不再有「搜索其他地点 / 卫星图 / 西湖 ISO / 纯路网」
 * 这些选择：点一下铺底图，3D 能加载就自动用 3D，加载失败自动退回卫星图；相机默认
 * 落在平湖秋月一带，而不是整片西湖。底图与卫星贴地同一条禁令：仅观感，不可作重建素材。
 */
export function GeoBasemapInput({ area, onApply, view2D, onFrameLocal, isoStatus, onRetryIso, venuePicker }: {
  area?: RoomLayout['researchArea'];
  /** 应用或清除底图；null 表示撤掉。 */
  onApply(area: RoomLayout['researchArea'] | null): void;
  view2D: boolean;
  /** 把相机焦点切回平湖秋月一带（局部取景，不是全湖）。 */
  onFrameLocal?(): void;
  isoStatus?: IsoBasemapStatus;
  onRetryIso?(): void;
  venuePicker?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || view2D) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, view2D]);

  if (view2D) return null;

  const isXihu = area?.presetId === 'xihu-scenic';
  const isoLoading = isXihu && isoStatus === 'loading';
  const isoFailed = isXihu && isoStatus === 'fallback';
  const notice = isoLoading ? '正在加载西湖 3D，当前先看卫星图。'
    : isoFailed ? '西湖 3D 加载失败，已退回卫星图。' : '';

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function applyLocal() {
    onApply(createPresetResearchArea());
    close();
  }

  return <div ref={root} className="sc-geo-basemap" data-testid="geo-basemap"
    onKeyDown={event => {
      if (open && event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }}>
    <button ref={trigger} type="button" className="sc-geo-toggle" aria-expanded={open} aria-controls={open ? panelId : undefined}
      aria-busy={isoLoading || undefined}
      title={isoLoading ? '西湖 3D 正在加载，当前先用卫星图' : isoFailed ? '西湖 3D 加载失败，当前用卫星图；点开可重试' : undefined}
      data-testid="geo-basemap-open" onClick={() => {
        // 还没有底图时一步到位：铺平湖秋月，不弹设置。
        if (!area) { applyLocal(); return; }
        setOpen(value => !value);
      }}>
      <MapPin size={14} aria-hidden="true"/>
      <span>{XIHU_LOCAL_NAME}</span>
      {isoLoading && <Loader2 size={12} className="cr-spin" aria-hidden="true"/>}
      <ChevronDown size={14} aria-hidden="true"/>
    </button>
    {venuePicker}
    {open && area && <section id={panelId} className="sc-geo-panel" aria-label="地图设置">
      <div className="sc-geo-current">
        <strong>{isXihu ? XIHU_LOCAL_NAME : area.name}</strong>
        <div className="sc-geo-actions">
          {isXihu
            ? <button type="button" data-testid="geo-basemap-frame" onClick={() => { onFrameLocal?.(); close(); }}>回到平湖秋月</button>
            : <button type="button" data-testid="geo-basemap-preset" onClick={applyLocal}>换成平湖秋月</button>}
          <button type="button" data-testid="geo-basemap-clear" onClick={() => { onApply(null); close(); }}>清除底图</button>
        </div>
      </div>
      {notice && <p className="sc-geo-notice" role="status">
        {notice}
        {isoFailed && <button type="button" onClick={() => onRetryIso?.()}>重试 3D</button>}
      </p>}
      <small className="sc-geo-attribution" data-testid="geo-basemap-attribution">
        {isXihu ? '3D © Aholo · 底图 © 高德地图 / OpenStreetMap 贡献者' : '底图 © 高德地图'}
      </small>
    </section>}
  </div>;
}