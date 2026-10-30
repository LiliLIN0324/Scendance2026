/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
'use client';

import { useEffect, useRef, useState } from 'react';
import { polygonBboxMeters } from '../lib/amap-venue';

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode: string };
    AMap?: any;
  }
}

const KEY_STORAGE = 'scendance:amap-key';
const SECURITY_STORAGE = 'scendance:amap-security';
const SCRIPT_ID = 'scendance-amap-script';

// Next 只静态内联 process.env.NEXT_PUBLIC_* 的字面量访问，用变量取 key 在浏览器里恒为空。
function envOrStorage(envValue: string | undefined, storageKey: string): string {
  if (envValue) return envValue;
  try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
}

let loaderPromise: Promise<void> | null = null;
function loadAmap(key: string, security: string): Promise<void> {
  if (window.AMap) return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  window._AMapSecurityConfig = { securityJsCode: security };
  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.PlaceSearch,AMap.MouseTool,AMap.ToolBar`;
    script.onload = () => resolve();
    script.onerror = () => { loaderPromise = null; reject(new Error('高德脚本加载失败，检查网络与 Key 域名白名单（需含 localhost:3000）。')); };
    document.head.appendChild(script);
  });
  return loaderPromise;
}

export interface VenuePickResult { name: string; location: string; polygon: { lng: number; lat: number }[] }

/** 高德选址圈画：搜索/点选地点 → 卫星图上画多边形 → 外接矩形生成场地。key 只留在本机。 */
export function AmapVenuePicker({ onPick, onClose }: { onPick(pick: VenuePickResult): void; onClose(): void }) {
  const [key, setKey] = useState(() => envOrStorage(process.env.NEXT_PUBLIC_AMAP_KEY, KEY_STORAGE));
  const [security, setSecurity] = useState(() => envOrStorage(process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE, SECURITY_STORAGE));
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('盐官潮乐之城');
  const [results, setResults] = useState<{ id: string; name: string; address: string; location: { lng: number; lat: number } }[]>([]);
  const [pickName, setPickName] = useState('盐官潮乐之城');
  const [pickLocation, setPickLocation] = useState('');
  const [bbox, setBbox] = useState<{ width: number; depth: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolRef = useRef<{ close?(clear?: boolean): void } | null>(null);
  const drawRef = useRef<{ lng: number; lat: number }[]>([]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setStatus('正在加载高德地图…');
    loadAmap(key, security).then(() => {
      if (cancelled || !containerRef.current) return;
      const AMap = window.AMap as any;
      const map = new AMap.Map(containerRef.current, { zoom: 15, center: [120.5394, 30.4049], mapStyle: 'amap://styles/whitesmoke' });
      mapRef.current = map;
      const satellite = new AMap.TileLayer();
      satellite.setMap(map);
      satellite.show();
      const mouseTool = new AMap.MouseTool(map);
      mouseTool.on('draw', (data: any) => {
        const path = data?.overlay?.getPath?.() ?? [];
        drawRef.current = path.map((p: any) => ({ lng: Number(p.lng), lat: Number(p.lat) }));
        // 少于 3 点等于没圈成面，别把 0 × 0 m 当成结果摆给用户。
        setBbox(drawRef.current.length < 3 ? null : polygonBboxMeters(drawRef.current));
        try { mouseTool.close(false); } catch { /* 已闭合 */ }
      });
      toolRef.current = mouseTool;
      setMapReady(true);
      setStatus('');
    }).catch(failure => setStatus(failure instanceof Error ? failure.message : String(failure)));
    return () => { cancelled = true; };
  }, [key, security]);

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
    setStatus('在卫星图上点击勾出场地边界，双击或回到起点闭合。');
    (toolRef.current as unknown as { polygon?(): void } | null)?.polygon?.();
  }

  function generate() {
    if (drawRef.current.length < 3) { setStatus('先在卫星图上圈出场地。'); return; }
    onPick({ name: pickName.trim() || '户外场地', location: pickLocation, polygon: drawRef.current });
  }

  if (!key || !security) {
    return <div className="sc-aholo-task" aria-label="高德选址圈画">
      <p className="sc-note">需要高德开放平台（lbs.amap.com）的 <strong>Web端(JS API)</strong> Key 与安全密钥。两者只存在本机浏览器，不会上传。</p>
      <label className="sc-field" htmlFor="amap-key-input">高德 Key</label>
      <input id="amap-key-input" className="sc-lux-direct-input" value={key} onChange={event => setKey(event.target.value)} placeholder="粘贴 Key" />
      <label className="sc-field" htmlFor="amap-security-input">安全密钥 securityJsCode</label>
      <input id="amap-security-input" className="sc-lux-direct-input" value={security} onChange={event => setSecurity(event.target.value)} placeholder="粘贴安全密钥" />
      <button type="button" className="sc-button" disabled={!key.trim() || !security.trim()}
        onClick={() => { try { localStorage.setItem(KEY_STORAGE, key.trim()); localStorage.setItem(SECURITY_STORAGE, security.trim()); } catch { /* 只丢缓存 */ } setStatus('已保存本机，正在加载…'); loadAmap(key.trim(), security.trim()).then(() => setStatus('')).catch(failure => setStatus(failure instanceof Error ? failure.message : String(failure))); }}>
        保存并加载地图
      </button>
      {status && <p className="sc-note">{status}</p>}
    </div>;
  }

  return <div className="sc-aholo-task" aria-label="高德选址圈画">
    <div style={{ display: 'flex', gap: 6 }}>
      <input aria-label="搜索地点" type="text" value={query} placeholder="搜索地点，如：盐官潮乐之城"
        onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') search(); }} />
      <button type="button" className="sc-button" onClick={search}>搜索</button>
    </div>
    {results.length > 0 && <ul className="sc-lux-direct-results">
      {results.map(result => <li key={result.id}>
        <button type="button" onClick={() => focusResult(result)}>{result.name}<span className="sc-note"> {result.address}</span></button>
      </li>)}
    </ul>}
    <div ref={containerRef} style={{ width: '100%', height: 260, borderRadius: 10, border: '1px solid var(--sc-line)' }} />
    <div style={{ display: 'flex', gap: 6 }}>
      <button type="button" className="sc-button" onClick={startDraw} disabled={!mapReady}>圈画场地</button>
      <button type="button" className="sc-button" onClick={generate} disabled={!bbox}>生成户外场地</button>
      <button type="button" className="sc-button" onClick={onClose}>关闭</button>
    </div>
    {bbox && <p className="sc-note">圈画外接矩形：<strong>{bbox.width} × {bbox.depth} m</strong>（自动按纬度换算真实米数）</p>}
    {status && <p className="sc-note">{status}</p>}
  </div>;
}
