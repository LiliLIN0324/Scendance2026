'use client';

/**
 * 客户评审看到的场地：工作台同一套底图（地图 / 卫星 / 浅色 / 纸面），
 * 方案按 ENU 叠在锚点上。评审人不能改红线、分区或物件。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanFacility, PlanNode, PlanPoint, PlanRoute, PlanVehicle, PlanZone, SitePlanData } from '../../../supabase/functions/_shared/site-plan';
import { planLevels } from '../room-organizer/lib/plan-levels';
import { basemapSourceAttribution } from '../room-organizer/lib/tdt-probe';
import { enuToLngLat, planPointToPixel } from '../room-organizer/lib/outdoor-plan-canvas';
import { REVIEW_BASEMAP_LABEL, REVIEW_BASEMAPS, type ReviewBasemap } from './review-access';
import {
  fitReviewCamera,
  panReviewCamera,
  reviewPointAt,
  reviewTileSource,
  reviewTiles,
  reviewViewport,
  zoomReviewCamera,
  type ReviewCamera,
} from './review-site-map';
export interface ReviewMapPin {
  id: string;
  x: number;
  z: number;
  text: string;
  status?: string | undefined;
}

type Ink = 'boundary' | 'zone' | 'route' | 'facility';

const INK_LABEL: Record<Ink, string> = {
  boundary: '红线',
  zone: '分区',
  route: '动线',
  facility: '物件',
};

interface Props {
  plan: SitePlanData;
  levelId: string;
  canSwitchLevel: boolean;
  onLevel: (levelId: string) => void;
  basemap: ReviewBasemap;
  canSwitchBasemap: boolean;
  onBasemap: (style: ReviewBasemap) => void;
  pins: readonly ReviewMapPin[];
  pinNumbers: ReadonlyMap<string, number>;
  activePinId: string | null;
  canPin: boolean;
  onPick: (point: PlanPoint) => void;
  onFocusPin: (id: string) => void;
}

export function ReviewSiteMap(props: Props): JSX.Element {
  const { plan } = props;
  const anchor = plan.anchor ?? null;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<ReviewCamera | null>(null);
  const [ink, setInk] = useState<Record<Ink, boolean>>({ boundary: true, zone: true, route: true, facility: true });
  const [tilesDown, setTilesDown] = useState(0);
  const dragRef = useRef<{ x: number; y: number; camera: ReviewCamera; moved: boolean } | null>(null);
  const fitted = useRef('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setTilesDown(0);
  }, [props.basemap]);

  useEffect(() => {
    if (!anchor || size.width < 8) return;
    const key = `${anchor.lng.toFixed(5)},${anchor.lat.toFixed(5)}|${props.levelId}`;
    if (fitted.current === key) return;
    const next = fitReviewCamera(plan, size.width, size.height);
    if (!next) return;
    fitted.current = key;
    setCamera(next);
    setTilesDown(0);
  }, [anchor, plan, props.levelId, size.width, size.height]);

  useEffect(() => {
    if (!anchor || !props.activePinId) return;
    const pin = props.pins.find(item => item.id === props.activePinId);
    if (!pin) return;
    const spot = enuToLngLat(pin.x, pin.z, anchor.lng, anchor.lat);
    setCamera(current => current ? { lng: spot.lng, lat: spot.lat, zoom: Math.max(current.zoom, 16) } : current);
  }, [anchor, props.activePinId, props.pins]);

  const viewport = anchor && camera && size.width > 0
    ? reviewViewport({ anchorLng: anchor.lng, anchorLat: anchor.lat, camera, width: size.width, height: size.height })
    : null;
  const tiles = useMemo(() => {
    if (!camera || props.basemap === 'paper' || !anchor) return [];
    return reviewTiles({ style: props.basemap, camera, width: size.width, height: size.height });
  }, [anchor, camera, props.basemap, size.width, size.height]);
  const source = camera && anchor ? reviewTileSource(props.basemap, camera.lng, camera.lat) : null;
  const levels = planLevels(plan);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !anchor) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      setCamera(current => {
        if (!current) return current;
        return zoomReviewCamera({
          camera: current,
          anchorLng: anchor.lng,
          anchorLat: anchor.lat,
          width: host.clientWidth,
          height: host.clientHeight,
          cursorX: event.clientX - rect.left,
          cursorY: event.clientY - rect.top,
          zoomIn: event.deltaY < 0,
        });
      });
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [anchor]);

  const project = (point: PlanPoint) => viewport ? planPointToPixel(point, viewport) : { x: 0, y: 0 };
  const ring = (points: readonly PlanPoint[]) => points.map(point => {
    const spot = project(point);
    return `${spot.x.toFixed(1)},${spot.y.toFixed(1)}`;
  }).join(' ');

  return (
    <div
      ref={hostRef}
      className={`rsp-map${anchor ? ' is-anchored' : ' is-unanchored'}${props.basemap === 'paper' ? ' is-paper' : ''}`}
      data-review-map={anchor ? 'site' : 'unanchored'}
      data-review-basemap={props.basemap}
    >
      {anchor && props.basemap !== 'paper' && (
        <div className="rsp-map-tiles" aria-hidden="true">
          {tiles.map(tile => (
            <img
              key={tile.key}
              alt=""
              src={tile.url}
              width={tile.size}
              height={tile.size}
              style={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size }}
              onError={() => setTilesDown(count => count + 1)}
            />
          ))}
        </div>
      )}
      <svg
        className="rsp-map-ink"
        role="img"
        aria-label={anchor ? '场地地图，滚轮缩放，拖拽平移，点击落钉' : '方案没有场地锚点'}
        onPointerDown={(event) => {
          if (!camera || (event.target as Element).closest('[data-review-pin]')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY, camera, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || !anchor) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
          setCamera(panReviewCamera({
            camera: drag.camera,
            width: size.width,
            height: size.height,
            anchorLng: anchor.lng,
            anchorLat: anchor.lat,
            dx,
            dy,
          }));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 未捕获时忽略 */ }
          if (!drag || drag.moved || !props.canPin || !viewport) return;
          if ((event.target as Element).closest('[data-review-pin]')) return;
          props.onPick(reviewPointAt({
            clientX: event.clientX,
            clientY: event.clientY,
            rect: event.currentTarget.getBoundingClientRect(),
            viewport,
          }));
        }}
      >
        {viewport && ink.boundary && plan.boundary.length >= 3 && (
          <polygon points={ring(plan.boundary)} className="rsp-map-boundary" />
        )}
        {viewport && ink.zone && plan.zones.map((zone: PlanZone) => (
          <polygon
            key={zone.id}
            points={ring(zone.polygon)}
            fill={zone.color ?? '#8aa88f'}
            fillOpacity={zone.opacity ?? 0.28}
            stroke={zone.color ?? '#5d7d63'}
            strokeWidth={1.5}
          />
        ))}
        {viewport && ink.route && plan.routes.map((route: PlanRoute) => (
          <polyline
            key={route.id}
            points={ring(route.points)}
            fill="none"
            stroke={route.kind === 'vehicle' ? '#8a5a32' : '#2f6394'}
            strokeWidth={route.kind === 'vehicle' ? 3 : 2.2}
            strokeDasharray={route.kind === 'pedestrian' ? '7 6' : undefined}
            strokeLinecap="round"
          />
        ))}
        {viewport && ink.facility && plan.facilities.map((facility: PlanFacility) => {
          const spot = project(facility.position);
          const mpp = Math.abs(planPointToPixel({ x: 1, y: 0 }, viewport).x - planPointToPixel({ x: 0, y: 0 }, viewport).x) || 1;
          const w = facility.size.width * mpp;
          const h = facility.size.depth * mpp;
          return (
            <g key={facility.id} transform={`translate(${spot.x} ${spot.y}) rotate(${-facility.rotationDeg})`}>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={facility.color ?? '#c9a66b'} fillOpacity={0.9} stroke="#3f3a30" strokeWidth={1} />
            </g>
          );
        })}
        {viewport && ink.route && plan.nodes.map((node: PlanNode) => {
          const spot = project(node.position);
          return <circle key={node.id} cx={spot.x} cy={spot.y} r={5} fill="#141416" />;
        })}
        {viewport && ink.route && (plan.vehicles ?? []).map((vehicle: PlanVehicle) => {
          const spot = project(vehicle.position);
          return <rect key={vehicle.id} x={spot.x - 5} y={spot.y - 3} width={10} height={6} rx={1.5} fill="#55585f" />;
        })}
        {viewport && props.pins.map(pin => {
          const spot = project({ x: pin.x, y: pin.z });
          const active = pin.id === props.activePinId;
          const number = props.pinNumbers.get(pin.id) ?? '';
          return (
            <g
              key={pin.id}
              data-review-pin={pin.id}
              className={active ? 'is-on' : ''}
              style={{ cursor: 'pointer' }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => { event.stopPropagation(); props.onFocusPin(pin.id); }}
            >
              <circle className="rsp-pin-dot" cx={spot.x} cy={spot.y} r={active ? 13 : 11} fill="#141416" stroke="#ffffff" strokeWidth={2} />
              <text className="rsp-pin-num" x={spot.x} y={spot.y + 4} textAnchor="middle" fill="#ffffff" fontSize={11} fontWeight={600} fontFamily="system-ui, sans-serif">{number}</text>
            </g>
          );
        })}
      </svg>
      {!anchor && (
        <p className="rsp-map-warn" role="status">这份方案没有场地锚点，对不上真实地图。</p>
      )}
      {anchor && props.basemap !== 'paper' && tilesDown > 0 && tilesDown >= tiles.length && tiles.length > 0 && (
        <p className="rsp-map-warn" role="status">底图暂时拉不到。方案仍按场地坐标叠在这里，不是示意格。</p>
      )}
      <div className="rsp-map-card" onPointerDown={(event) => event.stopPropagation()}>
        <label className="rsp-map-level">
          <span>图层</span>
          {props.canSwitchLevel ? (
            <select aria-label="图层" value={props.levelId} onChange={event => props.onLevel(event.currentTarget.value)}>
              {levels.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
            </select>
          ) : (
            <b>{levels.find(level => level.id === props.levelId)?.name ?? '当前图层'}</b>
          )}
        </label>
        <div className="rsp-map-row" role="group" aria-label="底图">
          <span>底图</span>
          {props.canSwitchBasemap ? REVIEW_BASEMAPS.map(style => (
            <button key={style} type="button" aria-pressed={props.basemap === style} onClick={() => props.onBasemap(style)}>
              {REVIEW_BASEMAP_LABEL[style]}
            </button>
          )) : <b>{REVIEW_BASEMAP_LABEL[props.basemap]}</b>}
        </div>
        <div className="rsp-map-row" role="group" aria-label="显示">
          <span>显示</span>
          {(Object.keys(INK_LABEL) as Ink[]).map(key => (
            <button key={key} type="button" aria-pressed={ink[key]} onClick={() => setInk(current => ({ ...current, [key]: !current[key] }))}>
              {INK_LABEL[key]}
            </button>
          ))}
        </div>
      </div>
      {source && <p className="rsp-map-credit">{basemapSourceAttribution(source)}</p>}
    </div>
  );
}
