/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
'use client';

import { AlertTriangle, Check, Info, RotateCcw, Satellite, Search, X } from '@/components/solid-icons';
import { useEffect, useRef, useState } from 'react';
import { AMAP_KEY_STORAGE, AMAP_SECURITY_STORAGE, loadAmapScript, type AmapAutoComplete } from '../lib/amap-script';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, polygonBboxMeters, fetchSatelliteGroundDataUrl } from '../lib/amap-venue';
import { defaultGuestFlow } from '../lib/site-capture';
import { RECON_MATERIAL_BAN } from '../lib/site-recon-mock';
import {
  appendVertex,
  checkContour,
  checkFlowLine,
  polylineLengthMeters,
  undoVertex,
  type DrawPoint,
} from '../lib/venue-drawing';

// Next 只静态内联 process.env.NEXT_PUBLIC_* 的字面量访问，用变量取 key 在浏览器里恒为空。
function envOrStorage(envValue: string | undefined, storageKey: string): string {
  if (envValue) return envValue;
  try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
}

/** 说明收进标题旁的 ⓘ，默认不占版面。 */
function InfoTip({label,children}:{label:string;children:React.ReactNode}):JSX.Element{return <details className="sc-satellite-info"><summary aria-label={label}><Info size={13} aria-hidden="true"/></summary><p>{children}</p></details>;}

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

/** 正在画的图形种类。 */
type DrawKind = 'polygon' | 'flow' | null;

/** 输入联想的一条提示：区划/线路类 tip 可能没有坐标，点它转 POI 搜索。 */
export interface AmapSuggestion {
  id: string;
  name: string;
  /** 区划 + 地址串，用来区分同名地点（如「西湖」的区/景区同名条目）。 */
  detail: string;
  location?: { lng: number; lat: number };
}

function suggestionOf(raw: unknown, index: number): AmapSuggestion | null {
  const tip = raw as { id?: string; name?: string; district?: string; address?: string[] | string; location?: { lng?: number; lat?: number } };
  if (!tip?.name) return null;
  const parts = [tip.district, Array.isArray(tip.address) ? tip.address.join('') : tip.address].filter(Boolean);
  const lng = Number(tip.location?.lng);
  const lat = Number(tip.location?.lat);
  return {
    id: tip.id || `${tip.name}-${index}`,
    name: tip.name,
    detail: parts.join(' · '),
    ...(Number.isFinite(lng) && Number.isFinite(lat) ? { location: { lng, lat } } : {}),
  };
}

/**
 * 高德选址圈画：搜索/点选地点 → 卫星图上点选边界 → 显式「完成圈画」闭合 → 可选画主客流线 → 真轮廓壳体；卫星贴地参考默认开（仍仅观感）。key 只留在本机。
 * grow = 交给浮层撑高度：圈一块地要能看清地块，左栏那条 260px 的窄缝圈不准。
 *
 * 圈画为什么自己收点、不用地图 SDK 的绘制插件：SDK 只在「双击/回到起点闭合」时抛一个事件，
 * 用户看不到任何「完成」动作，闭合失败时按钮就一直是灰的、也没有原因。这里改成自己收点：
 * 每次点击加一个顶点（太近的重复点忽略），显式点「完成圈画」才闭合，闭合不合格会说清为什么，
 * 还能「撤销上一点」。判定逻辑在 lib/venue-drawing.ts，可以脱地图单测。
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
  const [suggestions, setSuggestions] = useState<AmapSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(-1);
  /** 正在画的图形种类（null = 没在画）。ref 给地图点击回调用，避免闭包过期。 */
  const [drawing, setDrawing] = useState<DrawKind>(null);
  /** 已点下的边界顶点（草稿）。ref 与 state 同步：state 渲染，ref 给点击回调。 */
  const draftRef = useRef<DrawPoint[]>([]);
  const [draft, setDraft] = useState<DrawPoint[]>([]);
  /** 已点下的流线折点（草稿）。 */
  const flowDraftRef = useRef<DrawPoint[]>([]);
  const [flowDraft, setFlowDraft] = useState<DrawPoint[]>([]);
  /** 选址预览：只挪地图视角、还没确认写入。 */
  const [previewed, setPreviewed] = useState<{ name: string; address: string } | null>(null);
  /** 场地已保存（写入锚点）后的状态标记，用于把「预览」和「已保存」在界面上分开。 */
  const [saved, setSaved] = useState(false);
  const mapRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** 草稿多边形 overlay（画的时候是半透明预览，闭合后就是最终边界）。 */
  const draftOverlayRef = useRef<{ setPath?(path: unknown[]): void; setOptions?(options: Record<string, unknown>): void; setMap?(map: unknown): void } | null>(null);
  /** 草稿流线 overlay。 */
  const flowOverlayRef = useRef<{ setPath?(path: unknown[]): void; setMap?(map: unknown): void } | null>(null);
  const drawRef = useRef<{ lng: number; lat: number }[]>([]);
  const flowRef = useRef<{ lng: number; lat: number }[]>([]);
  const drawingRef = useRef<DrawKind>(null);
  const savedPolygonRef = useRef(savedPolygon);
  savedPolygonRef.current = savedPolygon;
  // 连续搜索/联想的竞态守卫：每次发起自增，回包时序号不是当前值就丢弃（慢的旧响应不覆盖新结果）。
  const searchSeqRef = useRef(0);
  const suggestSeqRef = useRef(0);
  const suggestTimerRef = useRef<number | null>(null);
  const autoCompleteRef = useRef<AmapAutoComplete | null>(null);

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
          const initialSearch = searchSeqRef.current;
          const fit = () => {
            if (searchSeqRef.current === initialSearch) map.setFitView?.([overlay], false, [48, 48, 48, 48]);
          };
          fit();
          map.on?.('complete', fit);
        } catch { /* 标不上上次的范围也不挡重新圈 */ }
      }
      // 地图点击 = 圈画加一个顶点。绘制种类放在 drawingRef，事件回调里读现值。
      map.on?.('click', (event: any) => {
        const kind = drawingRef.current;
        if (!kind) return;
        const lnglat = event?.lnglat;
        const point = { lng: Number(lnglat?.lng), lat: Number(lnglat?.lat) };
        if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return;
        // 读现值而不是闭包里的 AMap/map：Key 变了会重建地图，闭包会指向旧实例。
        const liveAmap = window.AMap as any;
        const liveMap = mapRef.current;
        if (kind === 'polygon') {
          const next = appendVertex(draftRef.current, point);
          draftRef.current = next.points;
          setDraft(next.points);
          paintDraftPolygon(next.points, liveAmap, liveMap, true, draftOverlayRef);
          setStatus(next.rejected
            ? '这一点离上一个太近了，已忽略。'
            : `已点 ${next.points.length} 个点。至少 3 个才能围成一块地，点「完成圈画」闭合。`);
        } else {
          const next = appendVertex(flowDraftRef.current, point);
          flowDraftRef.current = next.points;
          setFlowDraft(next.points);
          paintDraftFlow(next.points, liveAmap, liveMap, flowOverlayRef);
          setStatus(next.rejected
            ? '这一点离上一个太近了，已忽略。'
            : `流线已点 ${next.points.length} 个点。至少 2 个才成线，点「完成流线」收尾。`);
        }
      });
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

  // 卸载时清掉联想防抖计时器，避免闭包 setState。
  useEffect(() => () => {
    if (suggestTimerRef.current != null) window.clearTimeout(suggestTimerRef.current);
  }, []);

  function search(keywordOverride?: string) {
    const keyword = (keywordOverride ?? query).trim();
    if (!keyword) return;
    const AMap = window.AMap as unknown as { PlaceSearch?: new (opts: Record<string, unknown>) => { search(kw: string, cb: (status: string, result: unknown) => void): void } };
    if (!mapReady || !AMap?.PlaceSearch) { setStatus('地图尚未就绪'); return; }
    closeSuggestions();
    setResults([]);
    const seq = ++searchSeqRef.current;
    const searcher = new AMap.PlaceSearch({ city: '全国', pageSize: 6 });
    searcher.search(keyword, (status, result) => {
      if (seq !== searchSeqRef.current) return; // 慢的旧响应不覆盖新结果
      const pois = (result as { poiList?: { pois?: { id: string; name: string; address?: string[] | string; location: { lng: number; lat: number } }[] } }).poiList?.pois ?? [];
      setResults(pois.map(poi => ({ id: poi.id, name: poi.name, address: Array.isArray(poi.address) ? poi.address.join('') : poi.address ?? '', location: poi.location })));
      setStatus(status === 'complete' ? '' : '没有找到这个地点，试试更短的关键词。');
    });
  }

  /** 输入联想（AutoComplete）：250ms 防抖 + 序号守卫，插件缺失时静默（回车仍可 PlaceSearch）。 */
  function suggest(raw: string) {
    const keyword = raw.trim();
    closeSuggestions();
    if (!keyword) return;
    const seq = suggestSeqRef.current;
    suggestTimerRef.current = window.setTimeout(() => {
      suggestTimerRef.current = null;
      const AMap = window.AMap as unknown as { AutoComplete?: new (opts: Record<string, unknown>) => AmapAutoComplete };
      if (!AMap?.AutoComplete) return;
      if (!autoCompleteRef.current) autoCompleteRef.current = new AMap.AutoComplete({ city: '全国' });
      autoCompleteRef.current.search(keyword, (status, result) => {
        if (seq !== suggestSeqRef.current) return; // 旧联想不覆盖新输入
        const tips = (result as { tips?: unknown[] }).tips ?? [];
        const items = tips.map(suggestionOf).filter((item): item is AmapSuggestion => item != null);
        setSuggestions(items);
        setActiveSuggest(-1);
        setSuggestOpen(status === 'complete' && items.length > 0);
      });
    }, 250);
  }

  function closeSuggestions() {
    ++suggestSeqRef.current;
    if (suggestTimerRef.current != null) {
      window.clearTimeout(suggestTimerRef.current);
      suggestTimerRef.current = null;
    }
    setSuggestOpen(false);
    setActiveSuggest(-1);
  }

  function clearSearch() {
    ++searchSeqRef.current;
    setResults([]);
    setSuggestions([]);
    closeSuggestions();
    setStatus('');
  }

  /** 预览地点：只挪地图视角与候选名，不写任何锚点；写入发生在「生成户外场地」。 */
  function previewPlace(result: { name: string; address: string; location: { lng: number; lat: number } }) {
    ++searchSeqRef.current;
    closeSuggestions();
    setResults([]);
    setPickName(result.name);
    setPickLocation(result.address);
    setPreviewed({ name: result.name, address: result.address });
    setSaved(false);
    setStatus(`已定位预览：${result.name}。在卫星图上圈出活动场地后点「生成户外场地」才确认写入。`);
    const map = mapRef.current as { setZoomAndCenter?(zoom: number, center: [number, number]): void } | null;
    map?.setZoomAndCenter?.(16, [result.location.lng, result.location.lat]);
  }

  /** 采用一条联想：有坐标直接预览；区划类 tip 没坐标，转成 POI 搜索。 */
  function adoptSuggestion(item: AmapSuggestion) {
    closeSuggestions();
    if (item.location) {
      previewPlace({ name: item.name, address: item.detail, location: item.location });
      return;
    }
    setQuery(item.name);
    search(item.name);
  }

  /** 开始圈画：清掉上一次草稿与已闭合边界，进入收点状态。 */
  function startDraw() {
    drawingRef.current = 'polygon';
    setDrawing('polygon');
    draftRef.current = [];
    setDraft([]);
    setFlowDraft([]);
    flowDraftRef.current = [];
    setBbox(null);
    setFlowMeters(null);
    drawRef.current = [];
    flowRef.current = [];
    setSaved(false);
    paintDraftPolygon([], window.AMap as any, mapRef.current, true, draftOverlayRef);
    setStatus('在卫星图上点击勾出场地边界，点「完成圈画」闭合。');
  }

  /** 结束圈画：顶点够且轮廓合格才闭合，不合格要说清原因。 */
  function finishDraw() {
    const points = draftRef.current;
    const check = checkContour(points);
    if (!check.ok) {
      setStatus(check.reason);
      return;
    }
    drawRef.current = points;
    setBbox(polygonBboxMeters(points));
    drawingRef.current = null;
    setDrawing(null);
    setDraft(points);
    paintDraftPolygon(points, window.AMap as any, mapRef.current, false, draftOverlayRef);
    setStatus(`边界已闭合：${check.vertexCount} 个点，约 ${Math.round(check.areaM2)} m²。可再点「画主客流线」，或直接生成（未画则用默认长轴流线）。`);
  }

  /** 撤销最后一个顶点（边界或流线，按当前在画的图形）。 */
  function undoPoint() {
    if (drawingRef.current === 'polygon') {
      const next = undoVertex(draftRef.current);
      draftRef.current = next;
      setDraft(next);
      paintDraftPolygon(next, window.AMap as any, mapRef.current, true, draftOverlayRef);
      setStatus(next.length === 0 ? '已撤销到 0 个点。' : `已撤销，现在 ${next.length} 个点。`);
      return;
    }
    if (drawingRef.current === 'flow') {
      const next = undoVertex(flowDraftRef.current);
      flowDraftRef.current = next;
      setFlowDraft(next);
      paintDraftFlow(next, window.AMap as any, mapRef.current, flowOverlayRef);
      setStatus(next.length === 0 ? '已撤销到 0 个点。' : `已撤销，现在 ${next.length} 个点。`);
    }
  }

  /** 放弃本次圈画（不动已保存的场地）。 */
  function cancelDraw() {
    const kind = drawingRef.current;
    drawingRef.current = null;
    setDrawing(null);
    if (kind === 'flow') {
      // 只放弃流线草稿，已闭合的边界必须留在图上，否则会出现「看不见边界却还能生成」。
      flowDraftRef.current = [];
      setFlowDraft([]);
      flowRef.current = [];
      setFlowMeters(null);
      paintDraftFlow([], window.AMap as any, mapRef.current, flowOverlayRef);
      setStatus('已放弃这次流线，生成时用默认长轴流线。');
      return;
    }
    draftRef.current = [];
    setDraft([]);
    flowDraftRef.current = [];
    setFlowDraft([]);
    drawRef.current = [];
    flowRef.current = [];
    setBbox(null);
    setFlowMeters(null);
    paintDraftPolygon([], window.AMap as any, mapRef.current, true, draftOverlayRef);
    paintDraftFlow([], window.AMap as any, mapRef.current, flowOverlayRef);
    setStatus('已放弃这次圈画。');
  }

  function startFlow() {
    if (drawRef.current.length < 3) {
      setStatus('先圈出场地边界，再画主客流线。');
      return;
    }
    drawingRef.current = 'flow';
    setDrawing('flow');
    flowDraftRef.current = [];
    setFlowDraft([]);
    setFlowMeters(null);
    setStatus('在圈内点出主客流线折点，点「完成流线」收尾。站位会沿这条线加密。');
  }

  /** 结束流线：至少两个点才成线。 */
  function finishFlow() {
    const points = flowDraftRef.current;
    const check = checkFlowLine(points);
    if (!check.ok) {
      setStatus(check.reason);
      return;
    }
    flowRef.current = points;
    const meters = Math.round(polylineLengthMeters(points) * 10) / 10;
    setFlowMeters(meters);
    drawingRef.current = null;
    setDrawing(null);
    setFlowDraft(points);
    setStatus(`主客流线约 ${meters} m。可点「生成户外场地」，或重画流线。`);
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
    if (drawing) { setStatus('先把当前的圈画完成或放弃，再生成场地。'); return; }
    if (drawRef.current.length < 3) { setStatus('先在卫星图上圈出场地，并点「完成圈画」。'); return; }
    setBusy(true);
    try {
      const flow = flowRef.current.length >= 2 ? flowRef.current : defaultGuestFlow(drawRef.current);
      const satelliteGroundImage = await resolveSatelliteImage(drawRef.current);
      setSaved(true);
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
      setSaved(true);
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
      <input aria-label="搜索地点" type="text" role="combobox" aria-expanded={suggestOpen} aria-autocomplete="list"
        value={query} placeholder="搜索地点，如：盐官潮乐之城"
        onChange={event => {
          ++searchSeqRef.current;
          setResults([]);
          setQuery(event.target.value);
          suggest(event.target.value);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && suggestOpen && suggestions.length > 0) {
            event.preventDefault();
            setActiveSuggest(index => Math.min(suggestions.length - 1, index + 1));
          } else if (event.key === 'ArrowUp' && suggestOpen && suggestions.length > 0) {
            event.preventDefault();
            setActiveSuggest(index => Math.max(-1, index - 1));
          } else if (event.key === 'Escape') {
            closeSuggestions();
          } else if (event.key === 'Enter') {
            if (suggestOpen && activeSuggest >= 0 && activeSuggest < suggestions.length) adoptSuggestion(suggestions[activeSuggest]!);
            else search();
          }
        }} />
      <button type="button" className="sc-button" aria-label="搜索" data-tip="搜索" title="搜索" onClick={() => search()} disabled={busy || !mapReady}><Search size={16} aria-hidden="true"/></button>
      {(results.length > 0 || suggestOpen) && <button type="button" className="sc-button" aria-label="清空搜索结果" data-tip="清空搜索" title="清空搜索结果（取消本次搜索，不改动场地）"
        onClick={clearSearch}><X size={16} aria-hidden="true"/></button>}
      <button type="button" className="sc-button" onClick={() => void demoPick()} disabled={busy} title="不手画：立 L 轮廓户外壳（非矩形）+ 默认长轴流线站位">演示圈画 · L 轮廓</button>
      {suggestOpen && suggestions.length > 0 && <ul className="sc-amap-suggest" role="listbox" aria-label="地点联想" data-testid="amap-suggest">
        {suggestions.map((item, index) => <li key={item.id} role="option" aria-selected={index === activeSuggest}>
          <button type="button" onMouseEnter={() => setActiveSuggest(index)} onClick={() => adoptSuggestion(item)}>
            <strong>{item.name}</strong><span className="sc-note">{item.detail ? ` ${item.detail}` : ''}</span>
          </button>
        </li>)}
      </ul>}
    </div>
    {results.length > 0 && <ul className="sc-lux-direct-results" aria-label="搜索结果">
      {results.map(result => <li key={result.id}>
        <button type="button" onClick={() => previewPlace(result)}>{result.name}<span className="sc-note"> {result.address}</span></button>
      </li>)}
    </ul>}
    <div ref={containerRef} style={{ width: '100%', position: 'relative', zIndex: 0, ...(grow ? { flex: '1 1 auto', minHeight: 240, minWidth: 0 } : { height: 260 }), borderRadius: 10, border: '1px solid var(--sc-line)' }} />
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', position: 'relative', zIndex: 2, flexShrink: 0 }}>
      <button type="button" className="sc-button" onClick={startDraw} disabled={!mapReady || busy || drawing === 'polygon'}>圈画场地</button>
      {drawing === 'polygon' && <>
        <button type="button" className="sc-button" aria-label="完成圈画" onClick={finishDraw} disabled={draft.length < 3}>
          <Check size={16} aria-hidden="true"/><span>完成圈画</span>
        </button>
        <button type="button" className="sc-button" aria-label="撤销上一点" onClick={undoPoint} disabled={draft.length === 0}>
          <RotateCcw size={16} aria-hidden="true"/><span>撤销上一点</span>
        </button>
        <button type="button" className="sc-button" aria-label="放弃圈画" onClick={cancelDraw}>放弃</button>
      </>}
      <button type="button" className="sc-button" onClick={startFlow} disabled={!mapReady || !bbox || busy || drawing === 'flow'}>画主客流线</button>
      {drawing === 'flow' && <>
        <button type="button" className="sc-button" aria-label="完成流线" onClick={finishFlow} disabled={flowDraft.length < 2}>
          <Check size={16} aria-hidden="true"/><span>完成流线</span>
        </button>
        <button type="button" className="sc-button" aria-label="撤销上一点" onClick={undoPoint} disabled={flowDraft.length === 0}>
          <RotateCcw size={16} aria-hidden="true"/><span>撤销上一点</span>
        </button>
        <button type="button" className="sc-button" aria-label="放弃圈画" onClick={cancelDraw}>放弃</button>
      </>}
      <button type="button" className="sc-button" onClick={() => void generate()} disabled={!bbox || busy || drawing !== null}>{busy ? '处理中…' : '生成户外场地'}</button>
      {!grow && <button type="button" className="sc-button" onClick={onClose}>关闭</button>}
    </div>
    {drawing === 'polygon' && <p className="sc-note" data-testid="draw-progress">已点 <strong>{draft.length}</strong> 个点（至少 3 个）。点「完成圈画」闭合，「撤销上一点」改最后一下；完成或放弃后才能生成场地。</p>}
    {drawing === 'flow' && <p className="sc-note" data-testid="flow-progress">流线已点 <strong>{flowDraft.length}</strong> 个点（至少 2 个）；完成或放弃后才能生成场地。</p>}
    {bbox && <p className="sc-note">圈画外接矩形：<strong>{bbox.width} × {bbox.depth} m</strong>
      {flowMeters != null ? <> · 主客流线 <strong>{flowMeters} m</strong></> : <> · 未手画流线时用默认长轴</>}
      （立壳跟多边形真轮廓，不只外接矩形）
    </p>}
    {previewed && <p className="sc-note" data-testid="venue-preview">
      选址预览：<strong>{previewed.name}</strong>{previewed.address ? ` · ${previewed.address}` : ''}
      {saved ? ' · 场地已保存' : ' · 尚未写入场地'}
    </p>}
    <div className="sc-satellite-row">
      <label className="sc-satellite-toggle">
        <input type="checkbox" checked={satelliteGround} disabled={busy} onChange={event => setSatelliteGround(event.target.checked)} aria-label="卫星贴地参考底图" />
        <Satellite size={15} aria-hidden="true"/>
        <span>卫星贴地参考</span>
        <em className="sc-badge is-quiet">默认开</em>
      </label>
      <span className="sc-badge is-quiet" title={RECON_MATERIAL_BAN}>仅参考</span>
      <InfoTip label="卫星底图能不能做重建素材">{RECON_MATERIAL_BAN}</InfoTip>
    </div>
    {status && (/失败|未加载|不可用|降级|未运行|代理|拒绝了/.test(status)
      ? <div className="sc-note sc-amap-error" role="status"><AlertTriangle size={13} aria-hidden="true"/><span>地图未加载</span><InfoTip label="地图加载排查">{status}；可在上方检查 Key 与安全密钥，或稍后重试。</InfoTip></div>
      : <p className="sc-note" role="status">{status}</p>)}
  </div>;
}

/** 画/刷新草稿多边形。draft=true 是半透明预览，draft=false 是已闭合的边界。 */
function paintDraftPolygon(points: DrawPoint[], AMap: any, map: unknown, draft: boolean, overlayRef: { current: unknown }): void {
  if (!AMap?.Polygon || !map) return;
  const path = points.map(point => [point.lng, point.lat]);
  const existing = overlayRef.current as { setPath?(path: unknown[]): void; setOptions?(options: Record<string, unknown>): void } | null;
  if (existing) {
    existing.setPath?.(path);
    existing.setOptions?.({
      strokeColor: '#2f6bff',
      fillColor: '#2f6bff',
      fillOpacity: draft ? 0.12 : 0.18,
      strokeWeight: 3,
      zIndex: 60,
    });
    return;
  }
  try {
    const overlay = new AMap.Polygon({
      path,
      strokeColor: '#2f6bff',
      strokeWeight: 3,
      fillColor: '#2f6bff',
      fillOpacity: draft ? 0.12 : 0.18,
      zIndex: 60,
    });
    overlay.setMap(map);
    overlayRef.current = overlay;
  } catch { /* 画不出预览不挡收点 */ }
}

/** 画/刷新草稿流线。 */
function paintDraftFlow(points: DrawPoint[], AMap: any, map: unknown, overlayRef: { current: unknown }): void {
  if (!AMap?.Polyline || !map) return;
  const path = points.map(point => [point.lng, point.lat]);
  const existing = overlayRef.current as { setPath?(path: unknown[]): void } | null;
  if (existing) {
    existing.setPath?.(path);
    return;
  }
  try {
    const overlay = new AMap.Polyline({ path, strokeColor: '#ff8a3d', strokeWeight: 4, strokeOpacity: 0.95, zIndex: 61 });
    overlay.setMap(map);
    overlayRef.current = overlay;
  } catch { /* 画不出预览不挡收点 */ }
}
