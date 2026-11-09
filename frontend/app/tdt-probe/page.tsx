'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './tdt-probe.module.css';
import {
  TDT_PROBE_ATTRIBUTION,
  TDT_PROBE_DEFAULT,
  TDT_PROBE_MAX_ZOOM,
  TDT_PROBE_MIN_ZOOM,
  TDT_PROBE_TILE,
  drawMockTile,
  metersPerPixel,
  tdtProbeTileUrl,
  visibleTileGrid,
  type TdtProbeLayer,
} from '@/components/room-organizer/lib/tdt-probe';

interface View {
  lng: number;
  lat: number;
  zoom: number;
}

const TILE_REQ_BASE = '/api/tdt-tiles';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** 把一份经纬度中心转成当前缩放级下的「画布中心像素坐标」（以整幅墨卡托世界为原点）。 */
function centerPixel(v: View): { px: number; py: number } {
  const world = (2 ** v.zoom) * TDT_PROBE_TILE;
  const px = (v.lng + 180) / 360 * world;
  const latRad = v.lat * Math.PI / 180;
  const py = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * world;
  return { px, py };
}

export default function TdtProbePage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ ...TDT_PROBE_DEFAULT });
  const layerRef = useRef<TdtProbeLayer>('vec');

  const [view, setView] = useState<View>({ ...TDT_PROBE_DEFAULT });
  const [layer, setLayer] = useState<TdtProbeLayer>('vec');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tileCount, setTileCount] = useState(0);
  const [errorTiles, setErrorTiles] = useState(0);
  // mock 模式：服务端没 key 拉不到真瓦片时，用程序化占位网格兜底，交互仍可验证。
  const [mockMode, setMockMode] = useState(false);
  const [hasRealTiles, setHasRealTiles] = useState(false);

  const dragRef = useRef<{ x: number; y: number }>();

  const commitView = useCallback((next: View) => {
    viewRef.current = next;
    setView({ ...next });
  }, []);

  const draw = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssW = stage.clientWidth;
    const cssH = stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const v = viewRef.current;
    const currentLayer = layerRef.current;
    const { px: centerPx, py: centerPy } = centerPixel(v);
    const grid = visibleTileGrid(v.lng, v.lat, v.zoom, cssW, cssH);
    const total = grid.tiles.length;
    setTileCount(total);

    let finished = 0;
    let failed = 0;
    let anyReal = false;
    const baseX = (tx: number) => tx * TDT_PROBE_TILE - centerPx + cssW / 2;
    const baseY = (ty: number) => ty * TDT_PROBE_TILE - centerPy + cssH / 2;

    const drawMock = (tileX: number, tileY: number, tileLayer: TdtProbeLayer) => {
      ctx.save();
      ctx.translate(baseX(tileX), baseY(tileY));
      drawMockTile(ctx, tileX, tileY, v.zoom, tileLayer);
      ctx.restore();
    };

    const loadAndDraw = (url: string, tileX: number, tileY: number, tileLayer: TdtProbeLayer, onDone: () => void) => {
      const img = new Image();
      img.onload = () => {
        anyReal = true;
        ctx.drawImage(img, baseX(tileX), baseY(tileY), TDT_PROBE_TILE, TDT_PROBE_TILE);
        onDone();
      };
      img.onerror = () => { failed++; drawMock(tileX, tileY, tileLayer); onDone(); };
      img.crossOrigin = 'anonymous';
      img.src = url;
    };

    grid.tiles.forEach(({ x, y }) => {
      const urls = tdtProbeTileUrl(currentLayer, v.zoom, x, y, TILE_REQ_BASE);
      const complete = () => {
        finished++;
        if (finished === total) {
          setErrorTiles(failed);
          setLoading(false);
          setMockMode(!anyReal && failed > 0);
          setHasRealTiles(anyReal);
        }
      };
      loadAndDraw(urls.base, x, y, currentLayer, complete);
      loadAndDraw(urls.annotation, x, y, currentLayer, complete);
    });
  }, []);

  // 首帧与视口变化后重绘。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setLoading(true);
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [draw]);

  function panView(dx: number, dy: number) {
    const v = viewRef.current;
    const world = (2 ** v.zoom) * TDT_PROBE_TILE;
    const dLng = -dx / world * 360;
    const latRad = v.lat * Math.PI / 180;
    // y(纬度) 的墨卡托导数为 world/(2π)·sec(lat)，反解 dy → 纬度变化。
    const dLat = -dy / world * (360 / (2 * Math.PI)) * Math.cos(latRad);
    const next = { ...v, lng: clamp(v.lng + dLng, -180, 180), lat: clamp(v.lat + dLat, -85, 85) };
    commitView(next);
    draw();
  }

  function zoomStep(dir: number) {
    const v = viewRef.current;
    const next = { ...v, zoom: clamp(v.zoom + dir, TDT_PROBE_MIN_ZOOM, TDT_PROBE_MAX_ZOOM) };
    commitView(next);
    draw();
  }

  function scaleLabel(): string {
    const meters = Math.round(metersPerPixel(viewRef.current.lat, viewRef.current.zoom) * 80);
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>天地图满铺探针（H0-b）</h1>
        <small>EPSG:3857 · key 走服务端 /api/tdt-tiles</small>
        <div className={styles.controls}>
          <select
            aria-label="底图图层"
            value={layer}
            onChange={event => { const next = event.target.value as TdtProbeLayer; layerRef.current = next; setLayer(next); setNotice(''); setLoading(true); draw(); }}
          >
            <option value="vec">矢量底图</option>
            <option value="img">影像底图</option>
          </select>
          <button onClick={() => { commitView({ ...TDT_PROBE_DEFAULT }); draw(); }}>回到平湖秋月</button>
        </div>
      </header>
      <div
        ref={stageRef}
        className={`${styles.stage}${dragging ? ' ' + styles.dragging : ''}`}
        onMouseDown={event => { dragRef.current = { x: event.clientX, y: event.clientY }; setDragging(true); }}
        onMouseMove={event => {
          if (!dragRef.current) return;
          panView(event.clientX - dragRef.current.x, event.clientY - dragRef.current.y);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onMouseUp={() => { dragRef.current = undefined; setDragging(false); }}
        onMouseLeave={() => { dragRef.current = undefined; setDragging(false); }}
        onWheel={e => { e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1); }}
      >
        <canvas ref={canvasRef} className={styles.canvas} aria-label="天地图满铺画布" />
        {notice && <div className={styles.notice} role="status">{notice}</div>}
        <div className={styles.zoombar}>
          <button onClick={() => zoomStep(1)} aria-label="放大">+</button>
          <button onClick={() => zoomStep(-1)} aria-label="缩小">−</button>
        </div>
        <div className={`${styles.overlay} ${styles.scalebar}`}>
          <div className={styles.line} />
          <span>{scaleLabel()}</span>
        </div>
        <div className={`${styles.overlay} ${styles.attribution}`}>{TDT_PROBE_ATTRIBUTION}</div>
      </div>
      <footer className={styles.statusbar}>
        <span>图层 <b>{layer === 'vec' ? '矢量' : '影像'}</b></span>
        <span>缩放 <b>z{view.zoom}</b></span>
        <span>瓦片 <b>{loading ? `${tileCount} 加载中` : `${tileCount} 张`}</b></span>
        <span>失败 <b>{errorTiles}</b></span>
        <span>模式 <b>{mockMode ? '占位网格（待 key 实测）' : hasRealTiles ? '真实瓦片' : '待加载'}</b></span>
      </footer>
    </main>
  );
}