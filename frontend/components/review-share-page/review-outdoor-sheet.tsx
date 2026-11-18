'use client';

/**
 * 评审页的户外只读平面。
 * 与编辑器同一份 SitePlanData、同一套 ENU 米制坐标；不加载编辑工具，
 * 点击平面即把屏幕点换算回 ENU，交给上层落一颗户外钉。
 */

import { useMemo, useState } from 'react';
import type { PlanPoint, SitePlanData } from '../../../supabase/functions/_shared/site-plan';
import type { ReviewPin } from '../room-organizer/lib/review-pins';

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
  const [hover, setHover] = useState<PlanPoint | null>(null);

  const toSvg = (point: PlanPoint) => ({
    x: point.x - bounds.minX,
    y: bounds.maxY - point.y,
  });

  const fromEvent = (event: React.MouseEvent<SVGSVGElement>): PlanPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = bounds.minX + ((event.clientX - rect.left) / rect.width) * bounds.width;
    const y = bounds.maxY - ((event.clientY - rect.top) / rect.height) * bounds.height;
    return { x, y };
  };

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#eef2ec' }}>
      <svg
        role="img"
        aria-label="户外方案平面，点击落钉"
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        style={{ display: 'block', width: '100%', height: '62vh', minHeight: 420, cursor: 'crosshair' }}
        onClick={(event) => onPick(fromEvent(event))}
        onMouseMove={(event) => setHover(fromEvent(event))}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="review-outdoor-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#d8dfd5" strokeWidth="0.15" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={bounds.width} height={bounds.height} fill="url(#review-outdoor-grid)" />
        {plan.boundary.length >= 3 && (
          <polygon
            points={plan.boundary.map(point => { const p = toSvg(point); return `${p.x},${p.y}`; }).join(' ')}
            fill="#ffffff"
            fillOpacity={0.55}
            stroke="#3f6b4a"
            strokeWidth={Math.max(0.25, bounds.width / 900)}
          />
        )}
        {plan.zones.map(zone => (
          <polygon
            key={zone.id}
            points={zone.polygon.map(point => { const p = toSvg(point); return `${p.x},${p.y}`; }).join(' ')}
            fill={zone.color ?? '#8aa88f'}
            fillOpacity={zone.opacity ?? 0.22}
            stroke={zone.color ?? '#5d7d63'}
            strokeWidth={Math.max(0.12, bounds.width / 1800)}
          />
        ))}
        {plan.routes.map(route => (
          <polyline
            key={route.id}
            points={route.points.map(point => { const p = toSvg(point); return `${p.x},${p.y}`; }).join(' ')}
            fill="none"
            stroke="#5b7fa6"
            strokeWidth={Math.max(0.2, bounds.width / 1200)}
            strokeDasharray={`${Math.max(0.6, bounds.width / 400)} ${Math.max(0.4, bounds.width / 700)}`}
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
                strokeWidth={Math.max(0.1, bounds.width / 2000)}
              />
              {bounds.width < 160 && (
                <text x={p.x} y={p.y} fontSize={Math.max(1.4, bounds.width / 45)} textAnchor="middle" fill="#3f3a30">
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
          const r = Math.max(0.8, bounds.width / 130);
          return (
            <g key={pin.id} onClick={(event) => { event.stopPropagation(); onFocusPin(pin.id); }} style={{ cursor: 'pointer' }}>
              <circle cx={p.x} cy={p.y} r={r} fill={active ? '#1f7a4d' : '#2f6b46'} stroke="#ffffff" strokeWidth={r * 0.22} />
              <text x={p.x} y={p.y + r * 0.36} fontSize={r * 1.1} textAnchor="middle" fill="#ffffff">{index + 1}</text>
            </g>
          );
        })}
        {hover && (
          <circle
            cx={toSvg(hover).x}
            cy={toSvg(hover).y}
            r={Math.max(0.5, bounds.width / 260)}
            fill="none"
            stroke="#1f7a4d"
            strokeWidth={Math.max(0.12, bounds.width / 900)}
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}
