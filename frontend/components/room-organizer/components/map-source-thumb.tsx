'use client';

/**
 * 底图缩略图（2026-11-17 用户指令：3D「地图切换」四行也要和 2D 地图详情一样的缩略图，
 * 样式直接复用 `oc-map-details__thumb`，实现不再复制一份）。
 *
 * - `RealSourceThumb`：拿锚点那一块真实瓦片做小图（Google/Apple 选底图范式），
 *   与画布底图同源（alignedTileCenter 处理 GCJ/WGS 口径，境外锚点按类别换全球源）；
 *   无锚点、加载失败或 6s 未出图时回落 `SourceThumb` 手绘示意，网络断也不开天窗。
 * - `SourceThumb`：街道路网 / 卫星碎拼 / 深色路网 / 矢量蓝灰四种模板配色的示意图。
 */

import { useEffect, useMemo, useState } from 'react';
import { alignedTileCenter, sourceForLocation } from '../lib/basemap-alignment';
import { lngLatToTileXY, publicSourceTileUrl, tdtProbeTileUrl } from '../lib/tdt-probe';
import type { MapSourceId } from '../lib/map-source-slots';

/** 每枚底图缩略方格的示意画面：街道路网 / 卫星碎拼 / 深色路网 / 矢量蓝灰 四种模板配色。 */
export function SourceThumb({ id }: { id: MapSourceId }) {
  const palette: Record<MapSourceId, { bg: string; road: string; block: string; mode: 'street' | 'satellite' | 'dark' | 'vector' }> = {
    'amap-streets': { bg: '#E9F1E6', road: '#FFFFFF', block: '#CFE3C8', mode: 'street' },
    'amap-satellite': { bg: '#5E7A52', road: '#E8E4D6', block: '#4A6247', mode: 'satellite' },
    'carto-dark': { bg: '#2B2F36', road: '#6A707C', block: '#363B45', mode: 'dark' },
    osm: { bg: '#EAF3E4', road: '#FFFFFF', block: '#D8E8D0', mode: 'street' },
    'carto-light': { bg: '#F3F1EC', road: '#FFFFFF', block: '#E3DFD5', mode: 'street' },
    'amap-streets-labels': { bg: '#EDF3EE', road: '#FFFFFF', block: '#DCEAE6', mode: 'street' },
    'esri-satellite': { bg: '#4E6B55', road: '#7C8F6B', block: '#3E5A46', mode: 'satellite' },
    vec: { bg: '#EAF0F6', road: '#D4DCE6', block: '#DDE7F0', mode: 'vector' },
    img: { bg: '#4E6B55', road: '#6B805E', block: '#3E5A46', mode: 'satellite' },
  };
  const p = palette[id];
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="48" height="48" fill={p.bg} />
      {p.mode === 'street' || p.mode === 'vector' ? (
        <>
          <path d="M0 30 L20 26 L48 32" stroke={p.road} strokeWidth="4" fill="none" />
          <path d="M18 0 L22 48" stroke={p.road} strokeWidth="3" fill="none" />
          <rect x="4" y="4" width="12" height="9" rx="2" fill={p.block} />
          <rect x="30" y="30" width="14" height="10" rx="2" fill={p.block} />
          <rect x="32" y="6" width="9" height="7" rx="2" fill={p.block} opacity=".7" />
        </>
      ) : p.mode === 'dark' ? (
        <>
          <path d="M0 28 L24 22 L48 28" stroke={p.road} strokeWidth="3" fill="none" />
          <path d="M20 0 L26 48" stroke={p.road} strokeWidth="2.5" fill="none" />
          <rect x="5" y="5" width="13" height="10" rx="2" fill={p.block} />
          <rect x="30" y="30" width="13" height="10" rx="2" fill={p.block} />
        </>
      ) : (
        <>
          <path d="M6 0 L18 18 L12 34 L22 48" stroke={p.block} strokeWidth="7" fill="none" opacity=".7" />
          <path d="M28 4 L40 16 L34 32 L44 46" stroke={p.road} strokeWidth="2.5" fill="none" opacity=".8" />
          <circle cx="14" cy="12" r="4" fill={p.block} />
          <circle cx="34" cy="38" r="5" fill={p.block} />
        </>
      )}
    </svg>
  );
}

/** 真瓦片缩略图；没锚点/加载失败走手绘示意（与 2D 地图详情同一口径）。 */
export function RealSourceThumb({ id, lngLat }: { id: MapSourceId; lngLat: { lng: number; lat: number } | null }) {
  const [state, setState] = useState<'pending' | 'ok' | 'failed'>('pending');
  const url = useMemo(() => {
    if (!lngLat) return null;
    // z16（低纬约 600 m 视野）：比 z15 更贴近场地尺度，像 Google 选底图缩略的取景密度。
    const zoom = 16;
    const center = alignedTileCenter(lngLat.lng, lngLat.lat, id);
    const { x, y } = lngLatToTileXY(center.lng, center.lat, zoom);
    // 境外锚点：真瓦片缩略图与画布同口径换全球卫星/OSM，否则高德格子里永远是灰图。
    const effectiveId = sourceForLocation(id, lngLat.lng, lngLat.lat);
    if (effectiveId === 'vec' || effectiveId === 'img') return tdtProbeTileUrl(effectiveId, zoom, x, y).base;
    return publicSourceTileUrl(effectiveId, zoom, x, y);
  }, [id, lngLat?.lng, lngLat?.lat]);
  // 2026-11-16 用户实测：境外源在网络坏窗口会挂几十秒，缩略图一直空着像坏了——
  // 6s 没加载出来就回落手绘示意，不让用户盯着空格等浏览器超时。
  useEffect(() => {
    if (!url) return;
    const timer = window.setTimeout(() => setState(value => (value === 'pending' ? 'failed' : value)), 6000);
    return () => window.clearTimeout(timer);
  }, [url, state]);
  if (!url || state === 'failed') return <SourceThumb id={id} />;
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      decoding="async"
      onLoad={() => setState('ok')}
      onError={() => setState('failed')}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}
