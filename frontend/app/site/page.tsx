'use client';

/**
 * 只读场地页（/site）。
 *
 * 客户拿到的是一条自带数据的链接（`#s2=…`）：点开就能看到场地轮廓、分区和尺度，
 * 不需要登录、不连后端。和 /view 的分工是：/view 看“摆了什么”，/site 看“地在哪、怎么划的”。
 *
 * 底图用高德街道瓦片直连：与快照里的 GCJ-02 锚点同坐标系，不需要 Key，也不用 JS API。
 * 瓦片拉不到时页面不空着——同一套投影下用纸面网格兜底，轮廓和分区照常可读。
 */
import { useEffect, useMemo, useState } from 'react';
import { enuToLngLat } from '@/components/room-organizer/lib/outdoor-plan-canvas';
import { tileUrlFor, TILE_PIXELS } from '@/components/room-organizer/three/plan-basemap-tiles';
import {
  readSiteSnapshotHash,
  siteArea,
  siteBoundaryBounds,
  siteSnapshotErrorMessage,
  SITE_SNAPSHOT_HASH_PREFIX,
  type SiteShareSnapshot,
  type SiteShareZone,
} from '@/lib/site-share';
import { planZoneSemanticLabels } from '../../../supabase/functions/_shared/site-plan';
import styles from './site.module.css';

const BASEMAP_SOURCE = 'amap-streets' as const;
const BASEMAP_ATTRIBUTION = '© 高德地图';
const MIN_MAP_ZOOM = 12;
const MAX_MAP_ZOOM = 19;

const ZONE_PALETTE = ['#2f6f4e', '#b28a3c', '#4a6f8a', '#8a5a4a', '#6b7f3a', '#7a5a8a', '#a05a3c', '#3c7f7a'];

interface Point { x: number; y: number }
interface Screen { left: number; top: number }

/** 分区没有自带颜色时按语义固定取色，保证同一条链接两次打开长得一样。 */
function zoneColor(zone: SiteShareZone, index: number): string {
  return zone.color ?? ZONE_PALETTE[index % ZONE_PALETTE.length];
}

function zoneLabel(zone: SiteShareZone): string {
  const known = planZoneSemanticLabels[zone.semantic as keyof typeof planZoneSemanticLabels];
  return known && known !== zone.name ? `${zone.name} · ${known}` : zone.name;
}

const metres = (value: number): string => `${Math.round(value).toLocaleString('zh-CN')} ㎡`;

/** 墨卡托世界像素（瓦片坐标 × 256）。 */
function worldPixel(lng: number, lat: number, zoom: number): Point {
  const scale = TILE_PIXELS * 2 ** zoom;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export default function SitePage(): JSX.Element {
  const [snapshot, setSnapshot] = useState<SiteShareSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [tilesDown, setTilesDown] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let active = true;
    const load = async () => {
      setBusy(true); setError(''); setSnapshot(null);
      const hash = window.location.hash;
      if (!hash.startsWith(SITE_SNAPSHOT_HASH_PREFIX)) {
        setError('场地链接不完整，请使用发布者提供的完整链接。');
        setBusy(false);
        return;
      }
      const result = await readSiteSnapshotHash(hash);
      if (!active) return;
      if (result.ok) setSnapshot(result.snapshot);
      else setError(siteSnapshotErrorMessage(result.reason));
      setBusy(false);
    };
    void load();
    window.addEventListener('hashchange', load);
    return () => { active = false; window.removeEventListener('hashchange', load); };
  }, [refresh]);

  useEffect(() => {
    const stage = document.getElementById('site-stage');
    if (!stage) return;
    const measure = () => setSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [snapshot]);

  const geometry = useMemo(() => {
    if (!snapshot) return null;
    const bounds = siteBoundaryBounds(snapshot.boundary);
    const centreEnu = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const centre = enuToLngLat(centreEnu.x, centreEnu.y, snapshot.anchor.lng, snapshot.anchor.lat);
    const zoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(snapshot.zoom)));
    const centrePixel = worldPixel(centre.lng, centre.lat, zoom);
    const toScreen = (point: Point): Screen => {
      const spot = enuToLngLat(point.x, point.y, snapshot.anchor.lng, snapshot.anchor.lat);
      const pixel = worldPixel(spot.lng, spot.lat, zoom);
      return { left: pixel.x - centrePixel.x + size.width / 2, top: pixel.y - centrePixel.y + size.height / 2 };
    };
    return {
      bounds,
      centre,
      zoom,
      area: siteArea(snapshot.boundary),
      span: Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1),
      toScreen,
      centrePixel,
      metresPerPixel: metresPerPixel(centre.lat, zoom),
    };
  }, [snapshot, size.width, size.height]);

  const tiles = useMemo(() => {
    if (!geometry || !size.width || !size.height) return [];
    const { zoom, centrePixel, centre } = geometry;
    const halfW = size.width / 2;
    const halfH = size.height / 2;
    const left = centrePixel.x - halfW;
    const top = centrePixel.y - halfH;
    const max = 2 ** zoom;
    const wrap = (value: number, limit: number) => ((value % limit) + limit) % limit;
    const x0 = Math.floor(left / TILE_PIXELS);
    const x1 = Math.floor((left + size.width) / TILE_PIXELS);
    const y0 = Math.max(0, Math.floor(top / TILE_PIXELS));
    const y1 = Math.min(max - 1, Math.floor((top + size.height) / TILE_PIXELS));
    const list: { key: string; url: string; left: number; top: number }[] = [];
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        list.push({
          key: `${zoom}-${x}-${y}`,
          url: tileUrlFor(BASEMAP_SOURCE, zoom, wrap(x, max), y),
          left: x * TILE_PIXELS - left,
          top: y * TILE_PIXELS - top,
        });
      }
    }
    void centre;
    return list;
  }, [geometry, size.width, size.height]);

  if (busy) {
    return <main className={styles.page}><section className={styles.state} role="status"><h1>正在打开场地</h1><p>正在读取链接里的场地轮廓与分区…</p></section></main>;
  }
  if (error || !snapshot || !geometry) {
    return <main className={styles.page}>
      <section className={styles.state} role="alert">
        <h1>暂时无法查看场地</h1>
        <p>{error || '链接里没有可用的场地数据。'}</p>
        <button type="button" onClick={() => setRefresh(value => value + 1)}>重试</button>
      </section>
    </main>;
  }

  const ringPath = (ring: Point[]): string => ring
    .map((point, index) => {
      const spot = geometry.toScreen(point);
      return `${index === 0 ? 'M' : 'L'}${spot.left.toFixed(1)} ${spot.top.toFixed(1)}`;
    })
    .join(' ') + ' Z';
  const scaleStep = niceStep(geometry.metresPerPixel * 120);

  return <main className={styles.page}>
    <header className={styles.masthead}>
      <span>幕景 <small>Scendance</small></span>
      <span>只读场地</span>
    </header>

    <div className={styles.title}>
      <div>
        <p className={styles.eyebrow}>只读 · 不可编辑 · {snapshot.zones.length} 个分区</p>
        <h1>{snapshot.title}</h1>
        <p className={styles.meta}>
          {metres(geometry.area)} · 锚点 {snapshot.anchor.lng.toFixed(5)}, {snapshot.anchor.lat.toFixed(5)}
          {snapshot.createdAt ? ` · ${new Date(snapshot.createdAt).toLocaleString('zh-CN')}` : ''}
        </p>
      </div>
    </div>

    <section className={styles.stage} id="site-stage" aria-label="场地平面">
      <div className={styles.tiles} aria-hidden="true" data-down={tilesDown}>
        {!tilesDown && tiles.map(tile => <TileImage
          key={tile.key}
          url={tile.url}
          left={tile.left}
          top={tile.top}
          onError={() => setTilesDown(true)}
        />)}
      </div>

      <svg className={styles.overlay} width={size.width} height={size.height} aria-hidden="true">
        {snapshot.zones.map((zone, index) => <path
          key={`${zone.name}-fill-${index}`}
          d={ringPath(zone.polygon)}
          fill={zoneColor(zone, index)}
          fillOpacity={0.26}
          stroke={zoneColor(zone, index)}
          strokeWidth={1.5}
        />)}
        <path d={ringPath(snapshot.boundary)} fill="none" stroke="#c2452d" strokeWidth={2} strokeDasharray="10 6" />
      </svg>

      {snapshot.zones.map((zone, index) => {
        // 太小或互相重叠的分区不叠标签：一块地上好几个小分区时，名字交给下方图例，
        // 地图只标得出位置的那些。
        const spots = zone.polygon.map(point => geometry.toScreen(point));
        const wide = Math.max(...spots.map(spot => spot.left)) - Math.min(...spots.map(spot => spot.left));
        const tall = Math.max(...spots.map(spot => spot.top)) - Math.min(...spots.map(spot => spot.top));
        if (wide < 96 || tall < 48) return null;
        const centroid = zoneCentroid(zone.polygon);
        const spot = geometry.toScreen(centroid);
        return <p
          key={`${zone.name}-label-${index}`}
          className={styles.zoneLabel}
          style={{ left: spot.left, top: spot.top }}
        >{zone.name}</p>;
      })}

      <div className={styles.north} aria-hidden="true"><span>N</span></div>
      <div className={styles.scale} aria-hidden="true">
        <span style={{ width: `${(scaleStep / geometry.metresPerPixel).toFixed(0)}px` }} />
        <small>{scaleStep} m</small>
      </div>
      <p className={styles.attribution}>{BASEMAP_ATTRIBUTION}{tilesDown ? ' · 底图未加载' : ''}</p>
    </section>

    <section className={styles.legend} aria-labelledby="site-legend-title">
      <div className={styles.legendHead}>
        <h2 id="site-legend-title">分区</h2>
        <span>共 {snapshot.zones.length} 个</span>
      </div>
      {snapshot.zones.length === 0
        ? <p className={styles.empty}>这块地还没有划区。</p>
        : <ul>{snapshot.zones.map((zone, index) => <li key={`${zone.name}-${index}`}>
          <i style={{ background: zoneColor(zone, index) }} aria-hidden="true" />
          <span>{zoneLabel(zone)}</span>
          <small>{metres(siteArea(zone.polygon))}</small>
        </li>)}</ul>}
    </section>

    <p className={styles.footnote}>
      {snapshot.note ? `${snapshot.note} ` : ''}
      此链接自带场地快照，无需登录即可打开；页面只读，不连接云端发布记录。
      轮廓与分区为设计依据，现场以实测和当届手册为准。
      {snapshot.source ? ` 来源：${snapshot.source}` : ''}
    </p>
  </main>;
}

/** 一块底图瓦片。远端已是 256px 定尺贴图，直连比 next/image 中转更快也更准。 */
function TileImage({ url, left, top, onError }: { url: string; left: number; top: number; onError: () => void }): JSX.Element {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={TILE_PIXELS} height={TILE_PIXELS} style={{ left, top }} onError={onError} />;
}

function niceStep(value: number): number {
  const candidates = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  return candidates.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, candidates[0]);
}

function zoneCentroid(ring: Point[]): Point {
  const total = ring.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / ring.length, y: total.y / ring.length };
}
