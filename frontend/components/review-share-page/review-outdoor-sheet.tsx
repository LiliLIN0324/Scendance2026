'use client';

/**
 * 评审页的户外只读平面。
 * 与编辑器同一份 SitePlanData、同一套 ENU 米制坐标；不加载编辑工具，
 * 支持滚轮缩放、拖拽平移、点击换算回 ENU 落钉。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanPoint, SitePlanData } from '../../../supabase/functions/_shared/site-plan';
import type { ReviewPin } from '../room-organizer/lib/review-pins';

/** 把屏幕点击换算成 ENU 米制坐标；缩放/平移后的逆变换。 */
export function planPointFromClient(input: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  scale: number;
  tx: number;
  ty: number;
  bounds: { minX: number; maxY: number; width: number; height: number };
}): PlanPoint {
  const { clientX, clientY, rect, scale, tx, ty, bounds } = input;
  const sx = ((clientX - rect.left) / rect.width) * bounds.width;
  const sy = ((clientY - rect.top) / rect.height) * bounds.height;
  return { x: (sx - tx) / scale + bounds.minX, y: bounds.maxY - (sy - ty) / scale };
}

export interface ReviewOutdoorPin extends ReviewPin {
  floorId?: string | undefined;
  author?: string | undefined;
}

interface Props {
  plan: SitePlanData;
  pins: readonly ReviewOutdoorPin[];
  activePinId: string | null;
  onPick: (point: PlanPoint) => void;
  onFocusPin: (id: string) => void;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface ViewState {
  scale: number;
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function boundsOf(plan: SitePlanData): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (point: PlanPoint) => { xs.push(point.x); ys.push(point.y); };
  for (const point of plan.boundary) add(point);
  for (const zone of plan.zones) for (const point of zone.polygon) add(point);
  for (const facility of plan.facilities) {
    add({ x: facility.position.x - facility.size.width / 2, y: facility.position.y - facility.size.depth / 2 });
    add({ x: facility.position.x + facility.size.width / 2, y: facility.position.y + facility.size.depth / 2 });
  }
  for (const route of plan.routes) for (const point of route.points) add(point);
  for (const node of plan.nodes) add({ x: node.position.x, y: node.position.y });
  if (xs.length === 0) return { minX: -20, minY: -20, maxX: 20, maxY: 20, width: 40, height: 40 };
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max(4, Math.max(maxX - minX, maxY - minY) * 0.08);
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
  };
}

export function ReviewOutdoorSheet({ plan, pins, activePinId, onPick, onFocusPin }: Props): JSX.Element {
  const bounds = useMemo(() => boundsOf(plan), [plan]);
  const [view, setView] = useState<ViewState>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<PlanPoint | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number; moved: boolean } | null>(null);

  const toSvg = (point: PlanPoint) => ({
    x: point.x - bounds.minX,
    y: bounds.maxY - point.y,
  });

  const eventPoint = (event: { clientX: number; clientY: number }, element: SVGSVGElement): PlanPoint => planPointFromClient({
    clientX: event.clientX, clientY: event.clientY, rect: element.getBoundingClientRect(),
    scale: view.scale, tx: view.tx, ty: view.ty, bounds,
  });

  useEffect(() => {
    if (!activePinId) return;
    const pin = pins.find(item => item.id === activePinId);
    if (!pin) return;
    const point = toSvg({ x: pin.x, y: pin.z });
    setView(current => {
      const scale = Math.max(2, current.scale);
      return { scale, tx: bounds.width / 2 - point.x * scale, ty: bounds.height / 2 - point.y * scale };
    });
    // 只在选中钉变化时居中；平移/缩放不应反过来重置视图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePinId]);

  // React 的 onWheel 可能是 passive，拦不住页面滚动；这里显式用非 passive 监听。
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const sx = ((event.clientX - rect.left) / rect.width) * bounds.width;
      const sy = ((event.clientY - rect.top) / rect.height) * bounds.height;
      setView(current => {
        const scale = clamp(current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_SCALE, MAX_SCALE);
        const ratio = scale / current.scale;
        return { scale, tx: sx - (sx - current.tx) * ratio, ty: sy - (sy - current.ty) * ratio };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [bounds.width, bounds.height]);

  const zoomBy = (factor: number) => {
    setView(current => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = scale / current.scale;
      const cx = bounds.width / 2;
      const cy = bounds.height / 2;
      return { scale, tx: cx - (cx - current.tx) * ratio, ty: cy - (cy - current.ty) * ratio };
    });
  };

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#eef2ec' }}>
      <svg
        ref={svgRef}
        role="img"
        aria-label="户外方案平面，点击落钉，滚轮缩放，拖拽平移"
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        style={{ display: 'block', width: '100%', height: '62vh', minHeight: 420, cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { startX: event.clientX, startY: event.clientY, tx: view.tx, ty: view.ty, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) { setHover(eventPoint(event, event.currentTarget)); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          const dx = ((event.clientX - drag.startX) / rect.width) * bounds.width;
          const dy = ((event.clientY - drag.startY) / rect.height) * bounds.height;
          if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;
          setView(current => ({ ...current, tx: drag.tx + dx, ty: drag.ty + dy }));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 未捕获时忽略 */ }
          if (drag && !drag.moved) onPick(eventPoint(event, event.currentTarget));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="review-outdoor-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#d8dfd5" strokeWidth="0.15" />
          </pattern>
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          <rect x={0} y={0} width={bounds.width} height={bounds.height} fill="url(#review-outdoor-grid)" />
          {plan.boundary.length >= 3 && (
            <polygon
              points={plan.boundary.map(point => { const p = toSvg(point); return `${p.x},${p.y}`; }).join(' ')}
              fill="#ffffff"
              fillOpacity={0.55}
              stroke="#3f6b4a"
              strokeWidth={Math.max(0.25, bounds.width / 900) / view.scale}
            />
          )}
          {plan.zones.map(zone => (
            <polygon
              key={zone.id}
              points={zone.polygon.map(point => { const p = toSvg(point); return `${p.x},${p.y}`; }).join(' ')}
              fill={zone.color ?? '#8aa88f'}
              fillOpacity={zone.opacity ?? 0.22}
              stroke={zone.color ?? '#5d7d63'}
              strokeWidth={Math.max(0.12, bounds.width / 1800) / view.scale}
            />
          ))}
          {plan.routes.map(route => (
            <polyline
              key={route.id}
              points={route.points.map(point => { const p = toSvg(point); return `${p.x},${p.y}`; }).join(' ')}
              fill="none"
              stroke="#5b7fa6"
              strokeWidth={Math.max(0.2, bounds.width / 1200) / view.scale}
              strokeDasharray={`${Math.max(0.6, bounds.width / 400) / view.scale} ${Math.max(0.4, bounds.width / 700) / view.scale}`}
            />
          ))}
          {plan.facilities.map(facility => {
            const p = toSvg({ x: facility.position.x, y: facility.position.y });
            return (
              <g key={facility.id}>
                <rect
                  x={p.x - facility.size.width / 2}
                  y={p.y - facility.size.depth / 2}
                  width={facility.size.width}
                  height={facility.size.depth}
                  fill={facility.color ?? '#c9a66b'}
                  fillOpacity={0.75}
                  stroke="#7c6a4d"
                  strokeWidth={Math.max(0.1, bounds.width / 2000) / view.scale}
                />
                {view.scale >= 1.8 && (
                  <text x={p.x} y={p.y} fontSize={Math.max(1.4, bounds.width / 45) / view.scale} textAnchor="middle" fill="#3f3a30">
                    {facility.name}
                  </text>
                )}
              </g>
            );
          })}
          {plan.nodes.map(node => {
            const p = toSvg({ x: node.position.x, y: node.position.y });
            return <circle key={node.id} cx={p.x} cy={p.y} r={Math.max(0.5, bounds.width / 300)} fill="#2f6b46" />;
          })}
          {pins.map((pin, index) => {
            const p = toSvg({ x: pin.x, y: pin.z });
            const active = pin.id === activePinId;
            const r = Math.max(0.8, bounds.width / 130) / view.scale;
            return (
              <g
                key={pin.id}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onFocusPin(pin.id); }}
                style={{ cursor: 'pointer' }}
                opacity={pin.status === 'resolved' ? 0.6 : 1}
              >
                <title>{`${index + 1}. ${pin.text}`}</title>
                <circle cx={p.x} cy={p.y} r={r} fill={active ? '#1f7a4d' : pin.status === 'resolved' ? '#7c8b80' : '#2f6b46'} stroke="#ffffff" strokeWidth={r * 0.22} />
                <text x={p.x} y={p.y + r * 0.36} fontSize={r * 1.1} textAnchor="middle" fill="#ffffff">{index + 1}</text>
              </g>
            );
          })}
          {hover && (
            <circle
              cx={toSvg(hover).x}
              cy={toSvg(hover).y}
              r={Math.max(0.5, bounds.width / 260) / view.scale}
              fill="none"
              stroke="#1f7a4d"
              strokeWidth={Math.max(0.12, bounds.width / 900) / view.scale}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
        <button type="button" aria-label="放大" onClick={() => zoomBy(1.2)}>＋</button>
        <button type="button" aria-label="缩小" onClick={() => zoomBy(1 / 1.2)}>－</button>
        <button type="button" aria-label="复位视图" onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}>复位</button>
      </div>
      <p style={{ position: 'absolute', left: 10, bottom: 8, margin: 0, fontSize: 12, color: '#4c5a50' }}>滚轮缩放 · 拖拽平移 · 点击落钉</p>
    </div>
  );
}
