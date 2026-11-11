/**
 * 按米缩放的平面缩略图，和画布同一套 1.5m 剖面：切到的高家具填灰，
 * 矮家具只留浅色底和线，开洞不填。结构标记不画。
 * 从 share-menu 抽出为共享组件：候选卡（图文并茂）与发布面板共用。
 */
import { planDrawOrder } from '../lib/plan-order';
import { isPlanCut, planSymbol, type PlanSymbol } from '../lib/plan-style';
import { isStructuralMarker } from '../lib/structural-layout';
import type { FurnitureItem, RoomLayout } from '../lib/types';

export function PlanPreview({ layout, ariaLabel }: { layout: RoomLayout; ariaLabel?: string }): JSX.Element {
  const width = Math.max(layout.width || 0, 0.1);
  const depth = Math.max(layout.height || 0, 0.1);
  const floor = layout.floors?.[0];
  const items = planDrawOrder((floor?.items ?? []).filter(item => !isStructuralMarker(item)));
  // 1px ≈ 卡片宽度 260 上的描边，换算成米。
  const unit = Math.max(width, depth) / 260;
  const grid = Math.max(unit * 6, 0.5);
  const cols = Math.max(Math.round(width / grid), 1);
  const rows = Math.max(Math.round(depth / grid), 1);
  return <svg className="sc-publish-plan" viewBox={`0 0 ${width} ${depth}`} role="img" aria-label={ariaLabel ?? '平面预览'} preserveAspectRatio="xMidYMid meet">
    <rect x={0} y={0} width={width} height={depth} fill="#F7F5F0"/>
    {Array.from({ length: cols }, (_, index) => <line key={`v${index}`} x1={(index + 1) * grid} y1={0} x2={(index + 1) * grid} y2={depth} stroke="#E7E3DA" strokeWidth={unit * 0.7}/>)}
    {Array.from({ length: rows }, (_, index) => <line key={`h${index}`} x1={0} y1={(index + 1) * grid} x2={width} y2={(index + 1) * grid} stroke="#E7E3DA" strokeWidth={unit * 0.7}/>)}
    {(floor?.zones ?? []).map(zone => <rect key={zone.id} x={zone.x + width / 2} y={zone.z + depth / 2} width={Math.max(zone.w, 0.02)} height={Math.max(zone.d, 0.02)} fill={zone.color} opacity={0.18}/>)}
    <rect x={unit} y={unit} width={Math.max(width - unit * 2, 0.01)} height={Math.max(depth - unit * 2, 0.01)} fill="none" stroke="#3F453F" strokeWidth={unit * 2.4}/>
    <rect x={unit * 2.4} y={unit * 2.4} width={Math.max(width - unit * 4.8, 0.01)} height={Math.max(depth - unit * 4.8, 0.01)} fill="none" stroke="#A9B0A6" strokeWidth={unit * 0.8}/>
    {(floor?.interiorWalls ?? []).map(wall => <line key={wall.id}
      x1={wall.x1 + width / 2} y1={wall.z1 + depth / 2}
      x2={wall.x2 + width / 2} y2={wall.z2 + depth / 2}
      stroke="#3F453F" strokeWidth={Math.max(unit * 2.2, wall.thickness ?? 0)} strokeLinecap="butt"/>)}
    {items.map(item => <PlanPreviewItem key={item.id} item={item} width={width} depth={depth} unit={unit}/>)}
  </svg>;
}

function PlanPreviewItem({ item, width, depth, unit }: { item: FurnitureItem; width: number; depth: number; unit: number }): JSX.Element {
  const w = Math.max(item.width || 0, 0.02);
  const d = Math.max(item.depth || 0, 0.02);
  const cx = (item.position?.x ?? 0) + width / 2;
  const cy = (item.position?.z ?? 0) + depth / 2;
  const turn = Number.isFinite(item.rotation) ? (item.rotation ?? 0) * 180 / Math.PI : 0;
  const cut = isPlanCut(item);
  const symbol = planSymbol(item);
  const ink = cut ? '#4f554f' : '#7d837d';
  const round = symbol === 'round-table';
  const fill = cut ? '#c3c7c2' : item.color || '#9aa39c';
  const fillOpacity = cut ? 1 : symbol === 'rug' ? 0.1 : 0.14;
  const stroke = cut ? '#5f655f' : '#7d837d';
  const strokeWidth = cut ? unit * 1.4 : unit;
  return <g transform={turn ? `rotate(${-turn} ${cx} ${cy})` : undefined}>
    {symbol !== 'opening' && (round
      ? <ellipse cx={cx} cy={cy} rx={w / 2} ry={d / 2} fill={fill} fillOpacity={fillOpacity}/>
      : <rect x={cx - w / 2} y={cy - d / 2} width={w} height={d} fill={fill} fillOpacity={fillOpacity}/>)}
    {round
      ? <ellipse cx={cx} cy={cy} rx={w / 2} ry={d / 2} fill="none" stroke={stroke} strokeWidth={strokeWidth}/>
      : <rect x={cx - w / 2} y={cy - d / 2} width={w} height={d} fill="none"
        stroke={stroke} strokeWidth={strokeWidth}
        {...(symbol === 'rug' ? { strokeDasharray: `${unit * 5} ${unit * 3}` } : {})}/>}
    <g transform={`translate(${cx} ${cy})`}>
      <PlanPreviewSymbol kind={symbol} w={w} d={d} unit={unit} ink={ink}/>
    </g>
  </g>;
}

function PlanPreviewSymbol({ kind, w, d, unit, ink }: { kind: PlanSymbol; w: number; d: number; unit: number; ink: string }): JSX.Element | null {
  if (kind === 'none' || kind === 'rug' || kind === 'stairs') return null;
  if (w < unit * 7 || d < unit * 7) {
    if (kind === 'equipment' || kind === 'person' || kind === 'plant') {
      return <circle cx={0} cy={0} r={unit * 1.4} fill={ink}/>;
    }
    return null;
  }
  const halfW = w / 2;
  const halfD = d / 2;
  const inset = Math.min(unit * 4, Math.min(w, d) * 0.16);
  const stroke = { stroke: ink, strokeWidth: unit, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'seat':
      return <path {...stroke} d={`M${-halfW + inset} ${-halfD + inset}H${halfW - inset}M${-halfW + inset} ${-halfD + inset * 2}H${halfW - inset}`}/>;
    case 'sofa':
      return <path {...stroke} d={`M${-halfW + inset} ${-halfD + inset}H${halfW - inset}M${-halfW + inset} ${-halfD + inset * 2}H${halfW - inset}M0 ${-halfD + inset * 2}V${halfD - inset}`}/>;
    case 'table':
      return <rect {...stroke} x={-halfW + inset} y={-halfD + inset} width={w - inset * 2} height={d - inset * 2}/>;
    case 'round-table':
      return <circle {...stroke} cx={0} cy={0} r={Math.max(unit * 2, Math.min(w, d) / 2 - inset)}/>;
    case 'bed':
      return <path {...stroke} d={`M${-halfW + inset} ${-halfD + inset}h${w - inset * 2}v${d * 0.26}h${-(w - inset * 2)}zM${-halfW + inset} ${-halfD + d * 0.34}H${halfW - inset}`}/>;
    case 'plant':
      return <g {...stroke}>
        <circle cx={0} cy={0} r={Math.min(w, d) * 0.3}/>
        <path d={`M${-unit * 1.6} 0H${unit * 1.6}M0 ${-unit * 1.6}V${unit * 1.6}`}/>
      </g>;
    case 'storage':
      return <path {...stroke} d={`M${-halfW + inset} ${halfD - inset}H${halfW - inset}`}/>;
    case 'equipment':
      return <circle {...stroke} cx={0} cy={0} r={Math.max(unit * 1.6, Math.min(w, d) * 0.2)}/>;
    case 'opening':
      return <path {...stroke} d={`M${-halfW} 0H${halfW}`}/>;
    case 'person':
      return <circle {...stroke} cx={0} cy={0} r={Math.max(unit * 1.8, Math.min(w, d) * 0.28)}/>;
    default:
      return null;
  }
}
