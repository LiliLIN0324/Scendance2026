'use client';

import { useState } from 'react';
import { Loader2, MapPin, Satellite, Search, X } from '@/components/solid-icons';
import {
  createPresetResearchArea,
  createResearchArea,
  DEFAULT_RESEARCH_RADIUS_M,
  lookupPlace,
  RESEARCH_RADIUS_CHOICES,
  RESEARCH_SATELLITE_STYLE,
  researchAreaWith,
  type ResearchMapStyle,
} from '../lib/research-area';
import type { RoomLayout } from '../lib/types';

/**
 * docs/19 地理底图入口：画布左上角输入一句地名，高德定位后把那片真实地图铺进 3D 当底图，
 * 重建出来的场地就落在它的真实位置上。不输入也不影响——虚拟场地照常布置。
 * 底图与卫星贴地同一条禁令：仅观感，不可作重建素材。
 */
export function GeoBasemapInput({ area, onApply, view2D, onFrameOverview, overlaysVisible = true, onToggleOverlays }: {
  area?: RoomLayout['researchArea'];
  /** 应用或清除底图；null 表示撤掉。 */
  onApply(area: RoomLayout['researchArea'] | null): void;
  view2D: boolean;
  /** 点芯片名：把相机焦点切回整片底图（全湖视角）。 */
  onFrameOverview?(): void;
  /** 整景区矢量叠加（范围线 + 水面）是否可见；没有开关时按可见处理。 */
  overlaysVisible?: boolean;
  onToggleOverlays?(): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [radiusM, setRadiusM] = useState<number>(DEFAULT_RESEARCH_RADIUS_M);
  const [style, setStyle] = useState<ResearchMapStyle>(RESEARCH_SATELLITE_STYLE);
  if (view2D) return null;

  async function search() {
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true); setNotice('');
    try {
      const place = await lookupPlace(text);
      if (!place) { setNotice(`没查到「${text}」，换个说法再试。`); return; }
      onApply(createResearchArea(place, radiusM, style));
      setOpen(false); setQuery(''); setNotice('');
    } finally {
      setBusy(false);
    }
  }

  function patch(changes: { radiusM?: number; style?: ResearchMapStyle }) {
    if (!area) return;
    onApply(researchAreaWith(area, changes));
  }

  const radius = area?.radiusM ?? radiusM;
  const tileStyle = area?.style ?? style;

  return <div className="sc-geo-basemap" data-testid="geo-basemap">
    {area && <>
      <span className="sc-geo-chip" role="status">
        <MapPin size={12} aria-hidden="true"/>
        {onFrameOverview
          ? <button type="button" data-testid="geo-basemap-frame" title="回看整片底图"
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', fontWeight: 'inherit' }}
              onClick={onFrameOverview}><strong>底图 · {area.name}</strong></button>
          : <strong>底图 · {area.name}</strong>}
        <small>仅作参照</small>
        <button type="button" aria-label={`清除底图 ${area.name}`} data-testid="geo-basemap-clear"
          onClick={() => { onApply(null); setNotice(''); }}>×</button>
      </span>
      <span className="sc-geo-controls" role="group" aria-label="底图范围与样式">
        {!area.presetId && <label>
          <span className="sc-visually-hidden">底图半径</span>
          <select aria-label="底图半径" value={radius} onChange={event => patch({ radiusM: Number(event.target.value) })}>
            {RESEARCH_RADIUS_CHOICES.map(value => <option key={value} value={value}>{value} m</option>)}
          </select>
        </label>}
        {!area.presetId && <button type="button" aria-pressed={tileStyle === RESEARCH_SATELLITE_STYLE}
          title={tileStyle === RESEARCH_SATELLITE_STYLE ? '卫星影像 · 已叠路网注记，点切纯路网' : '当前纯路网，点切卫星影像（含路网）'}
          onClick={() => patch({ style: tileStyle === RESEARCH_SATELLITE_STYLE ? 7 : RESEARCH_SATELLITE_STYLE })}>
          <Satellite size={12} aria-hidden="true"/>
          <span>{tileStyle === RESEARCH_SATELLITE_STYLE ? '卫星含路网' : '纯路网'}</span>
        </button>}
        {area.presetId && onToggleOverlays && <button type="button" aria-pressed={overlaysVisible}
          data-testid="geo-basemap-overlays"
          title={overlaysVisible ? '景区范围线与水面 · 显示中，点隐藏' : '景区范围线与水面 · 已隐藏，点显示'}
          onClick={onToggleOverlays}>
          <span>{overlaysVisible ? '范围线/水面 开' : '范围线/水面 关'}</span>
        </button>}
      </span>
    </>}
    {open
      ? <span className="sc-geo-search">
        <input
          type="text"
          value={query}
          autoFocus
          maxLength={30}
          placeholder="地名，如：杭州西湖"
          aria-label="底图地名"
          data-testid="geo-basemap-query"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void search(); }}
        />
        <label>
          <span className="sc-visually-hidden">底图半径</span>
          <select aria-label="底图半径" value={radius} onChange={event => setRadiusM(Number(event.target.value))}>
            {RESEARCH_RADIUS_CHOICES.map(value => <option key={value} value={value}>{value} m</option>)}
          </select>
        </label>
        <button type="button" aria-label={tileStyle === RESEARCH_SATELLITE_STYLE ? '切到纯路网底图' : '切到卫星底图（含路网）'}
          onClick={() => setStyle(value => value === RESEARCH_SATELLITE_STYLE ? 7 : RESEARCH_SATELLITE_STYLE)}>
          <Satellite size={12} aria-hidden="true"/><span>{tileStyle === RESEARCH_SATELLITE_STYLE ? '卫星含路网' : '纯路网'}</span>
        </button>
        <button type="button" disabled={busy || !query.trim()} data-testid="geo-basemap-search" onClick={() => void search()}>
          {busy ? <Loader2 size={12} aria-hidden="true"/> : <Search size={12} aria-hidden="true"/>}
          <span>{busy ? '定位中…' : '定位'}</span>
        </button>
        <button type="button" aria-label="收起底图输入" onClick={() => { setOpen(false); setNotice(''); }}>
          <X size={12} aria-hidden="true"/>
        </button>
      </span>
      : <>
        <button type="button" className="sc-geo-toggle" aria-expanded={open} aria-label="标注地理位置底图"
          data-testid="geo-basemap-open" onClick={() => setOpen(true)}>
          <MapPin size={12} aria-hidden="true"/>
          <span>{area ? '改底图' : '底图定位'}</span>
        </button>
        {/* 整景区静态底图：预先拼好的 z15 大图，绕开 /amap-static 的 2048 长边限流。 */}
        <button type="button" className="sc-geo-toggle" aria-label="铺整景区底图"
          data-testid="geo-basemap-preset" onClick={() => onApply(createPresetResearchArea())}>
          <MapPin size={12} aria-hidden="true"/>
          <span>整景区</span>
        </button>
      </>}
    {notice && <span className="sc-geo-notice" role="alert">{notice}</span>}
    {area && <span className="sc-geo-attribution" data-testid="geo-basemap-attribution">
      {area.presetId === 'xihu-scenic'
        ? '底图 © 高德地图 · 范围线/水面 © OpenStreetMap 贡献者'
        : '底图 © 高德地图'}
    </span>}
  </div>;
}
