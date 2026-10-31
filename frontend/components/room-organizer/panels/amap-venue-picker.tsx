/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
'use client';

import { useEffect, useRef, useState } from 'react';
import { AMAP_KEY_STORAGE, AMAP_SECURITY_STORAGE, loadAmapScript } from '../lib/amap-script';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, polygonBboxMeters, SATELLITE_GROUND_LABEL, fetchSatelliteGroundDataUrl } from '../lib/amap-venue';
import { RECON_MATERIAL_BAN } from '../lib/site-recon-mock';
import { defaultGuestFlow } from '../lib/site-capture';

// Next 只静态内联 process.env.NEXT_PUBLIC_* 的字面量访问，用变量取 key 在浏览器里恒为空。
function envOrStorage(envValue: string | undefined, storageKey: string): string {
  if (envValue) return envValue;
  try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
}

export interface VenuePickResult {
  name: string;
  location: string;
  polygon: { lng: number; lat: number }[];
  /** 圈内主客流线折点；缺省时上层用默认长轴流线加密站位。 */
  flow?: { lng: number; lat: number }[];
  /** 卫星贴地参考底图（默认开）；仅观感，不可作重建素材。 */
  satelliteGround?: boolean;
  /** 已拉取的真实卫星参考 data URL（仅观感，不进重建上传）。 */
  satelliteGroundImage?: string;
}

type DrawMode = 'polygon' | 'polyline' | null;

/**
 * 高德选址圈画：搜索/点选地点 → 卫星图上画多边形 → 可选画主客流线 → 真轮廓壳体；卫星贴地参考默认开（仍仅观感）。key 只留在本机。
 * grow = 交给浮层撑高度：圈一块地要能看清地块，左栏那条 260px 的窄缝圈不准。
 */
export function AmapVenuePicker({ onPick, onClose, grow = false, savedPolygon }: {
  onPick(pick: VenuePickResult): void;
  onClose(): void;
  grow?: boolean;
  /** 已经存进场地的圈画。打开地图时画在卫星图上，方便对照；再圈一次会换成新的。 */
  savedPolygon?: { lng: number; lat: number }[];
}) {
  const [key, setKey] = useState(() => envOrStorage(process.env.NEXT_PUBLIC_AMAP_KEY, AMAP_KEY_STORAGE));
  const [security, setSecurity] = useState(() => envOrStorage(process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE, AMAP_SECURITY_STORAGE));
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('盐官潮乐之城');
  const [results, setResults] = useState<{ id: string; name: string; address: string; location: { lng: number; lat: number } }[]>([]);
  const [pickName, setPickName] = useState('盐官潮乐之城');
  const [pickLocation, setPickLocation] = useState('');
  const [bbox, setBbox] = useState<{ width: number; depth: number } | null>(null);
  const [flowMeters, setFlowMeters] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  /** 卫星贴地参考：地图立壳默认开；只贴观感底图，绝不进 Aholo 上传。 */
  const [satelliteGround, setSatelliteGround] = useState(true);
  const [busy, setBusy] = useState(false);
  const mapRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolRef = useRef<{ close?(clear?: boolean): void; polygon?(): void; polyline?(): void } | null>(null);
  const drawRef = useRef<{ lng: number; lat: number }[]>([]);
  const flowRef = useRef<{ lng: number; lat: number }[]>([]);
  const drawModeRef = useRef<DrawMode>(null);
  const savedPolygonRef = useRef(savedPolygon);
  savedPolygonRef.current = savedPolygon;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setStatus('正在加载高德地图…');
    loadAmapScript(key, security).then(() => {
      if (cancelled || !containerRef.current) return;
      const AMap = window.AMap as any;
      const remembered = (savedPolygonRef.current ?? []).filter((point: { lng: number; lat: number }) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
      const center = remembered.length
        ? [remembered.reduce((sum: number, point: { lng: number }) => sum + point.lng, 0) / remembered.length, remembered.reduce((sum: number, point: { lat: number }) => sum + point.lat, 0) / remembered.length]
        : [120.5394, 30.4049];
      const map = new AMap.Map(containerRef.current, { zoom: remembered.length >= 3 ? 17 : 15, center, mapStyle: 'amap://styles/whitesmoke' });
      mapRef.current = map;
      // 选址圈画底图用真卫星层，便于对照；贴地参考另拉静态卫星图。
      const satellite = AMap.TileLayer?.Satellite
        ? new AMap.TileLayer.Satellite()
        : new AMap.TileLayer();
      satellite.setMap(map);
      satellite.show();
      if (remembered.length >= 3 && AMap.Polygon) {
        try {
          const overlay = new AMap.Polygon({
            path: remembered.map((point: { lng: number; lat: number }) => [point.lng, point.lat]),
            strokeColor: '#2f6bff',
            strokeWeight: 3,
            fillColor: '#2f6bff',
            fillOpacity: 0.18,
            zIndex: 60,
          });
          overlay.setMap(map);
          const fit = () => map.setFitView?.([overlay], false, [48, 48, 48, 48]);
          fit();
          map.on?.('complete', fit);
        } catch { /* 标不上上次的范围也不挡重新圈 */ }
      }
      const mouseTool = new AMap.MouseTool(map);
      mouseTool.on('draw', (data: any) => {
        const overlay = data?.overlay ?? data?.obj ?? data;
        const path = overlay?.getPath?.() ?? [];
        const points = path.map((p: any) => ({ lng: Number(p.lng), lat: Number(p.lat) }));
        const mode = drawModeRef.current;
        drawModeRef.current = null;
        if (mode === 'polyline') {
          flowRef.current = points;
          if (points.length >= 2) {
            const latMid = points.reduce((s: number, p: { lat: number }) => s + p.lat, 0) / points.length;
            const kx = metersPerDegreeLng(latMid);
            let len = 0;
            for (let i = 0; i < points.length - 1; i++) {
              const a = points[i]!;
              const b = points[i + 1]!;
              len += Math.hypot((b.lng - a.lng) * kx, (b.lat - a.lat) * METERS_PER_DEGREE_LAT);
            }
            setFlowMeters(Math.round(len * 10) / 10);
            setStatus(`主客流线约 ${Math.round(len * 10) / 10} m。可点「生成户外场地」，或重画流线。`);
          } else {
            setFlowMeters(null);
          }
        } else {
          drawRef.current = points;
          // 少于 3 点等于没圈成面，别把 0 × 0 m 当成结果摆给用户。
          setBbox(drawRef.current.length < 3 ? null : polygonBboxMeters(drawRef.current));
          if (drawRef.current.length >= 3) {
            setStatus('边界已闭合。可再点「画主客流线」，或直接生成（未画则用默认长轴流线）。');
          }
        }
        try { mouseTool.close(false); } catch { /* 已闭合 */ }
      });
      toolRef.current = mouseTool;
      setMapReady(true);
      setStatus(remembered && remembered.length >= 3 ? '上次圈的范围已标在图上。再圈一次会换成新的场地。' : '');
    }).catch(failure => setStatus(failure instanceof Error ? failure.message : String(failure)));
    return () => { cancelled = true; };
  }, [key, security]);

  // 浮层开合与全屏都会改容器尺寸，高德按旧尺寸渲染会留下空白，得让它重量一次。
  useEffect(() => {
    const node = containerRef.current;
    const map = mapRef.current as { resize?(): void } | null;
    if (!node || !map || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.resize?.());
    observer.observe(node);
    return () => observer.disconnect();
  }, [mapReady]);

  function search() {
    const AMap = window.AMap as unknown as { PlaceSearch?: new (opts: Record<string, unknown>) => { search(kw: string, cb: (status: string, result: unknown) => void): void } };
    if (!AMap?.PlaceSearch) { setStatus('地图尚未就绪'); return; }
    const searcher = new AMap.PlaceSearch({ city: '全国', pageSize: 6 });
    searcher.search(query.trim(), (status, result) => {
      const pois = (result as { poiList?: { pois?: { id: string; name: string; address?: string[] | string; location: { lng: number; lat: number } }[] } }).poiList?.pois ?? [];
      setResults(pois.map(poi => ({ id: poi.id, name: poi.name, address: Array.isArray(poi.address) ? poi.address.join('') : poi.address ?? '', location: poi.location })));
      setStatus(status === 'complete' ? '' : '没有找到这个地点，试试更短的关键词。');
    });
  }

  function focusResult(result: { name: string; address: string; location: { lng: number; lat: number } }) {
    setPickName(result.name);
    setPickLocation(result.address);
    setStatus(`已定位：${result.name}。在卫星图上圈出活动场地，完成后点「生成户外场地」。`);
    const map = mapRef.current as { setZoomAndCenter?(zoom: number, center: [number, number]): void } | null;
    map?.setZoomAndCenter?.(16, [result.location.lng, result.location.lat]);
  }

  function startDraw() {
    drawModeRef.current = 'polygon';
    setStatus('在卫星图上点击勾出场地边界，双击或回到起点闭合。');
    toolRef.current?.polygon?.();
  }

  function startFlow() {
    if (drawRef.current.length < 3) {
      setStatus('先圈出场地边界，再画主客流线。');
      return;
    }
    drawModeRef.current = 'polyline';
    setStatus('在圈内点出主客流线折点，双击结束。站位会沿这条线加密。');
    toolRef.current?.polyline?.();
  }

  function staticKey(): string {
    // Next 只内联字面量 NEXT_PUBLIC_* 访问
    return process.env.NEXT_PUBLIC_AMAP_STATIC_KEY || key;
  }

  async function resolveSatelliteImage(polygon: { lng: number; lat: number }[]): Promise<string | undefined> {
    if (!satelliteGround) return undefined;
    setStatus('正在拉取卫星参考底图…');
    const image = await Promise.race([
      fetchSatelliteGroundDataUrl(polygon, staticKey()),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 9000)),
    ]);
    if (!image) {
      setStatus('卫星静态图暂不可用，已用参考占位底图（仍不可作重建素材）。');
      return undefined;
    }
    setStatus('');
    return image;
  }

  async function generate() {
    if (busy) return;
    if (drawRef.current.length < 3) { setStatus('先在卫星图上圈出场地。'); return; }
    setBusy(true);
    try {
      const flow = flowRef.current.length >= 2 ? flowRef.current : defaultGuestFlow(drawRef.current);
      const satelliteGroundImage = await resolveSatelliteImage(drawRef.current);
      onPick({
        name: pickName.trim() || '户外场地',
        location: pickLocation,
        polygon: drawRef.current,
        flow,
        satelliteGround,
        ...(satelliteGroundImage ? { satelliteGroundImage } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  /** D3 演示：不手画也能立一块非矩形（L 轮廓）户外壳，并带默认长轴流线；可选卫星贴地。 */
  async function demoPick() {
    if (busy) return;
    setBusy(true);
    try {
      const lat = 30.4049;
      const lng = 120.5394;
      const dLng = 12 / metersPerDegreeLng(lat);
      const dLat = 8 / METERS_PER_DEGREE_LAT;
      // L 形：外接约 12×8 m，轮廓非轴对齐矩形，便于肉眼验收真轮廓壳体。
      const polygon = [
        { lng, lat },
        { lng: lng + dLng, lat },
        { lng: lng + dLng, lat: lat + dLat * 0.45 },
        { lng: lng + dLng * 0.45, lat: lat + dLat * 0.45 },
        { lng: lng + dLng * 0.45, lat: lat + dLat },
        { lng, lat: lat + dLat },
      ];
      const satelliteGroundImage = await resolveSatelliteImage(polygon);
      onPick({
        name: pickName.trim() || '盐官潮乐之城',
        location: pickLocation || '海宁盐官',
        polygon,
        flow: defaultGuestFlow(polygon),
        satelliteGround,
        ...(satelliteGroundImage ? { satelliteGroundImage } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!key || !security) {
    return <div className={`sc-aholo-task${grow ? ' is-grow' : ''}`} aria-label="高德选址圈画">
      <p className="sc-note">需要高德开放平台（lbs.amap.com）的 <strong>Web端(JS API)</strong> Key 与安全密钥。两者只存在本机浏览器，不会上传。</p>
      <label className="sc-field" htmlFor="amap-key-input">高德 Key</label>
      <input id="amap-key-input" className="sc-lux-direct-input" value={key} onChange={event => setKey(event.target.value)} placeholder="粘贴 Key" />
      <label className="sc-field" htmlFor="amap-security-input">安全密钥 securityJsCode</label>
      <input id="amap-security-input" className="sc-lux-direct-input" value={security} onChange={event => setSecurity(event.target.value)} placeholder="粘贴安全密钥" />
      <button type="button" className="sc-button" disabled={!key.trim() || !security.trim()}
        onClick={() => { try { localStorage.setItem(AMAP_KEY_STORAGE, key.trim()); localStorage.setItem(AMAP_SECURITY_STORAGE, security.trim()); } catch { /* 只丢缓存 */ } setStatus('已保存本机，正在加载…'); loadAmapScript(key.trim(), security.trim()).then(() => setStatus('')).catch(failure => setStatus(failure instanceof Error ? failure.message : String(failure))); }}>
        保存并加载地图
      </button>
      {status && <p className="sc-note">{status}</p>}
    </div>;
  }

  return <div className={`sc-aholo-task${grow ? ' is-grow' : ''}`} aria-label="高德选址圈画">
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', position: 'relative', zIndex: 2 }}>
      <input aria-label="搜索地点" type="text" value={query} placeholder="搜索地点，如：盐官潮乐之城"
        onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') search(); }} />
      <button type="button" className="sc-button" onClick={search} disabled={busy}>搜索</button>
      <button type="button" className="sc-button" onClick={() => void demoPick()} disabled={busy} title="不手画：立 L 轮廓户外壳（非矩形）+ 默认长轴流线站位">演示圈画 · L 轮廓</button>
    </div>
    {results.length > 0 && <ul className="sc-lux-direct-results">
      {results.map(result => <li key={result.id}>
        <button type="button" onClick={() => focusResult(result)}>{result.name}<span className="sc-note"> {result.address}</span></button>
      </li>)}
    </ul>}
    <div ref={containerRef} style={{ width: '100%', position: 'relative', zIndex: 0, ...(grow ? { flex: '1 1 auto', minHeight: 240, minWidth: 0 } : { height: 260 }), borderRadius: 10, border: '1px solid var(--sc-line)' }} />
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', position: 'relative', zIndex: 2, flexShrink: 0 }}>
      <button type="button" className="sc-button" onClick={startDraw} disabled={!mapReady || busy}>圈画场地</button>
      <button type="button" className="sc-button" onClick={startFlow} disabled={!mapReady || !bbox || busy}>画主客流线</button>
      <button type="button" className="sc-button" onClick={() => void generate()} disabled={!bbox || busy}>{busy ? '处理中…' : '生成户外场地'}</button>
      {!grow && <button type="button" className="sc-button" onClick={onClose}>关闭</button>}
    </div>
    {bbox && <p className="sc-note">圈画外接矩形：<strong>{bbox.width} × {bbox.depth} m</strong>
      {flowMeters != null ? <> · 主客流线 <strong>{flowMeters} m</strong></> : <> · 未手画流线时用默认长轴</>}
      （立壳跟多边形真轮廓，不只外接矩形）
    </p>}
    <label className="sc-note" style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative', zIndex: 2 }}>
      <input type="checkbox" checked={satelliteGround} disabled={busy} onChange={event => setSatelliteGround(event.target.checked)}
        aria-label="卫星贴地参考底图" />
      卫星贴地参考底图（默认开）· {SATELLITE_GROUND_LABEL}
    </label>
    {satelliteGround && <p className="sc-note" role="note">{RECON_MATERIAL_BAN}</p>}
    {status && <p className="sc-note">{status}</p>}
  </div>;
}
