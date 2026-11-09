'use client';

/**
 * 户外 2D 规划满铺画布组件（H2-a）。
 *
 * 组合方式：底图（公开源/天地图瓦片，复用 tdt-probe 工具）+ 六类业务图层
 * （outdoor-plan-canvas 纯函数）+ 内嵌图层栈开关面板。独立组件，不动 `room-organizer.tsx`。
 * 可见性支持受控（visibility + onVisibilityChange）与非受控（组件内开关）两种模式。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultLayerVisibility,
  drawAccessLayer,
  drawBoundaryLayer,
  drawFacilityLayer,
  drawRouteLayer,
  drawWorkerLayer,
  drawZoneLayer,
  isLayerVisible,
  type LayerVisibility,
  type PlanViewport,
} from '../lib/outdoor-plan-canvas';
import {
  publicSourceTileUrl,
  tdtProbeTileUrl,
  visibleTileGrid,
  type ProbePublicSource,
  type TdtProbeLayer,
} from '../lib/tdt-probe';
import { PLANNING_LABELS, PLANNING_LAYER_COLORS, PLANNING_RADIUS, PLANNING_SPACING, type PlanningLayerKind } from '@/lib/outdoor-plan-tokens';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

export type CanvasBasemapSource = TdtProbeLayer | ProbePublicSource;

interface View {
  lng: number;
  lat: number;
  zoom: number;
}

export interface OutdoorPlanCanvasProps {
  plan: SitePlanData;
  /** 图源：默认 OSM 街道（公开免费）。天地图两档待 key。 */
  source?: CanvasBasemapSource;
  initialView?: Partial<View>;
  /** 图层可见性（受控模式）；缺省全开、组件内开关直接生效。 */
  visibility?: LayerVisibility;
  onVisibilityChange?: (next: LayerVisibility) => void;
  onViewChange?: (next: View) => void;
}

const TILE = 256;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const isTdt = (s: CanvasBasemapSource): s is TdtProbeLayer => s === 'vec' || s === 'img';

const LAYER_ORDER: readonly ['boundary', 'zone', 'facility', 'route', 'worker', 'access'] = ['boundary', 'zone', 'facility', 'route', 'worker', 'access'];

export default function OutdoorPlanCanvas({
  plan,
  source = 'osm',
  initialView,
  visibility,
  onVisibilityChange,
  onViewChange,
}: OutdoorPlanCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const planCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({
    lng: initialView?.lng ?? (plan.anchor?.lng ?? 120.141306),
    lat: initialView?.lat ?? (plan.anchor?.lat ?? 30.2545),
    zoom: initialView?.zoom ?? 16,
  });
  const sourceRef = useRef<CanvasBasemapSource>(source);
  const planRef = useRef<SitePlanData>(plan);
  const dragRef = useRef<{ x: number; y: number }>();
  const layerStateRef = useRef<LayerVisibility>(visibility ?? defaultLayerVisibility());

  const [view, setView] = useState<View>({ ...viewRef.current });
  const [dragging, setDragging] = useState(false);
  const [layerState, setLayerState] = useState<LayerVisibility>(visibility ?? defaultLayerVisibility());
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => { planRef.current = plan; draw(); }, [plan]);
  useEffect(() => { sourceRef.current = source; draw(); }, [source]);
  useEffect(() => {
    if (visibility) {
      setLayerState(visibility);
      layerStateRef.current = visibility;
      draw();
    }
  }, [visibility]);
  useEffect(() => { layerStateRef.current = layerState; draw(); }, [layerState]);

  const draw = useCallback(() => {
    const stage = stageRef.current;
    const baseCanvas = baseCanvasRef.current;
    const planCanvas = planCanvasRef.current;
    if (!stage || !baseCanvas || !planCanvas) return;
    const baseCtx = baseCanvas.getContext('2d');
    const planCtx = planCanvas.getContext('2d');
    if (!baseCtx || !planCtx) return;

    const cssW = stage.clientWidth;
    const cssH = stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [baseCanvas, planCanvas]) {
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
    }
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.clearRect(0, 0, cssW, cssH);
    planCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    planCtx.clearRect(0, 0, cssW, cssH);

    const v = viewRef.current;
    const activeSource = sourceRef.current;
    const current = planRef.current;
    const vis = layerStateRef.current;

    // 1) 底图（baseCanvas）：公开源单层 / 天地图双层，异步瓦片只画在底图 canvas 上，
    //    永不覆盖业务层。
    const viewport: PlanViewport = { lng: v.lng, lat: v.lat, zoom: v.zoom, canvasW: cssW, canvasH: cssH };
    const world = 2 ** v.zoom * TILE;
    const centerPx = (v.lng + 180) / 360 * world;
    const latRad = v.lat * Math.PI / 180;
    const centerPy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * world;
    const grid = visibleTileGrid(v.lng, v.lat, v.zoom, cssW, cssH);
    grid.tiles.forEach(({ x, y }) => {
      const left = x * TILE - centerPx + cssW / 2;
      const top = y * TILE - centerPy + cssH / 2;
      const drawTile = (url: string) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => baseCtx.drawImage(img, left, top, TILE, TILE);
        img.src = url;
      };
      if (isTdt(activeSource)) {
        const pair = tdtProbeTileUrl(activeSource, v.zoom, x, y);
        drawTile(pair.base);
        drawTile(pair.annotation);
      } else {
        drawTile(publicSourceTileUrl(activeSource, v.zoom, x, y));
      }
    });

    // 2) 业务图层（planCanvas，叠在底图之上）：按图层栈顺序叠加，
    //    底图瓦片异步返回时不会覆盖业务层。
    if (isLayerVisible(vis, 'boundary')) drawBoundaryLayer({ ctx: planCtx, viewport }, current.boundary);
    if (isLayerVisible(vis, 'zone')) drawZoneLayer({ ctx: planCtx, viewport }, current.zones);
    if (isLayerVisible(vis, 'facility')) drawFacilityLayer({ ctx: planCtx, viewport }, current.facilities);
    if (isLayerVisible(vis, 'route')) drawRouteLayer({ ctx: planCtx, viewport }, current.routes);
    if (isLayerVisible(vis, 'worker')) drawWorkerLayer({ ctx: planCtx, viewport }, current.workers);
    if (isLayerVisible(vis, 'access')) drawAccessLayer({ ctx: planCtx, viewport }, current.nodes);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [draw]);

  function commitView(next: View) {
    viewRef.current = next;
    setView({ ...next });
    onViewChange?.(next);
    draw();
  }

  function pan(dx: number, dy: number) {
    const v = viewRef.current;
    const w = 2 ** v.zoom * TILE;
    const dLng = -dx / w * 360;
    const latRad = v.lat * Math.PI / 180;
    const dLat = -dy / w * (360 / (2 * Math.PI)) * Math.cos(latRad);
    commitView({
      lng: clamp(v.lng + dLng, -180, 180),
      lat: clamp(v.lat + dLat, -85, 85),
      zoom: v.zoom,
    });
  }

  function zoomBy(dir: number) {
    const v = viewRef.current;
    commitView({ ...v, zoom: clamp(v.zoom + dir, 3, 18) });
  }

  /** 图层栈开关：切换某层可见并回传（受控/非受控均生效）。 */
  function setLayerVisible(kind: PlanningLayerKind, visible: boolean) {
    const next = { ...layerState, [kind]: visible };
    setLayerState(next);
    layerStateRef.current = next;
    onVisibilityChange?.(next);
    draw();
  }

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    right: PLANNING_SPACING.sm,
    top: PLANNING_SPACING.sm,
    zIndex: 3,
    background: 'rgba(24, 34, 48, 0.92)',
    border: '1px solid #35485f',
    borderRadius: PLANNING_RADIUS.md,
    padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
    color: '#e7edf5',
    fontSize: 12,
    minWidth: 128,
    pointerEvents: 'auto',
  };

  return (
    <div
      ref={stageRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab' }}
      onMouseDown={event => { dragRef.current = { x: event.clientX, y: event.clientY }; setDragging(true); }}
      onMouseMove={event => {
        if (!dragRef.current) return;
        pan(event.clientX - dragRef.current.x, event.clientY - dragRef.current.y);
        dragRef.current = { x: event.clientX, y: event.clientY };
      }}
      onMouseUp={() => { dragRef.current = undefined; setDragging(false); }}
      onMouseLeave={() => { dragRef.current = undefined; setDragging(false); }}
      onWheel={e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }}
    >
      <canvas ref={baseCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-label="底图瓦片层" />
      <canvas ref={planCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-label="户外规划业务图层" />

      <div style={panelStyle}>
        <button
          type="button"
          onClick={() => setPanelOpen(open => !open)}
          style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, display: 'block', width: '100%' }}
          aria-expanded={panelOpen}
        >
          图层栈 {panelOpen ? '▾' : '▸'}
        </button>
        {panelOpen && LAYER_ORDER.map(kind => (
          <label key={kind} style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.xs, marginTop: PLANNING_SPACING.xs, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={layerState[kind]}
              onChange={event => setLayerVisible(kind, event.target.checked)}
            />
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: PLANNING_LAYER_COLORS[kind], display: 'inline-block' }} />
            {PLANNING_LABELS[kind]}
          </label>
        ))}
        <div style={{ marginTop: PLANNING_SPACING.sm, opacity: 0.75 }}>缩放 z{view.zoom} · 拖拽平移 · 滚轮缩放</div>
      </div>
    </div>
  );
}