import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { OutdoorTurn } from './outdoor-agent-contract';
import { createOutdoorMapContext } from './outdoor-map-context';
import { checkBoundaryRing } from './site-plan-editing';
import { planRingAreaM2 } from '../../../../supabase/functions/_shared/site-plan';

export interface VenueRangeBasis {
  kind: 'mapped-grass' | 'place-outline' | 'concept' | 'user-dimensions';
  detail: string;
  location?: 'mapped' | 'assumed';
  scale?: 'mapped' | 'assumed' | 'user-provided';
}
export interface VenueRangeProposal {
  boundary: SitePlanData['boundary'];
  basis: VenueRangeBasis;
}
const rectangle = (width: number, depth: number): SitePlanData['boundary'] => [
  { x: -width / 2, y: -depth / 2 }, { x: width / 2, y: -depth / 2 },
  { x: width / 2, y: depth / 2 }, { x: -width / 2, y: depth / 2 },
];

/** The probe rectangle only bounds evidence retrieval; it is never presented as a mapped lawn. */
export async function proposeAutomaticVenueRange(input: {
  plan: SitePlanData; anchor: NonNullable<SitePlanData['anchor']>; name: string;
  footprint: SitePlanData['boundary'] | null; signal: AbortSignal;
}): Promise<VenueRangeProposal> {
  const adapter = createOutdoorMapContext();
  const probe: SitePlanData = { ...input.plan, anchor: input.anchor, boundary: rectangle(500, 500),
    zones: [], facilities: [], routes: [], nodes: [], workers: [], vehicles: [], annotations: [], measurements: [], walls: [], designScope: rectangle(500, 500) };
  try {
    const map = await adapter.load(`venue-probe:${input.name}`, probe, [], false, input.signal);
    input.signal.throwIfAborted();
    const grass = (map.openAreas?.() ?? []).filter(area => area.tags.landuse === 'grass'
      && !['private', 'no'].includes(area.tags.access ?? '') && area.ring.length <= 200 && checkBoundaryRing(area.ring).ok)
      .filter(area => planRingAreaM2(area.ring) >= 100 && planRingAreaM2(area.ring) <= 30000)
      .filter(area => !input.footprint || area.ring.every(point => pointInside(point, input.footprint!)))
      .sort((a, b) => centerDistance(a.ring) - centerDistance(b.ring));
    if (grass[0]) return { boundary: grass[0].ring,
      basis: { kind: 'mapped-grass', location: 'mapped', scale: 'mapped', detail: `地图草地候选：${grass[0].name || input.name}（${grass[0].id}）；地图标记不代表已获活动使用许可。` } };
  } catch { input.signal.throwIfAborted(); }
  if (input.footprint && checkBoundaryRing(input.footprint).ok) return { boundary: input.footprint,
    basis: { kind: 'place-outline', location: 'mapped', scale: 'mapped', detail: '仅取得地点整体轮廓，尚未识别具体可用草坪；这是范围候选，可用聊天缩小，不能当作实测活动用地。' } };
  return { boundary: rectangle(40, 30), basis: { kind: 'concept', location: 'assumed', scale: 'assumed',
    detail: '未取得真实用地边界，先按 40×30 米建立概念草案；地点定位已保留，尺寸和草坪实际位置均为待核对假设。可直接说长宽或上传带尺寸图纸调整。' } };
}

function centerDistance(ring: SitePlanData['boundary']): number {
  return Math.hypot(ring.reduce((sum, p) => sum + p.x, 0) / ring.length, ring.reduce((sum, p) => sum + p.y, 0) / ring.length);
}
function pointInside(p: { x: number; y: number }, ring: SitePlanData['boundary']): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Pure geometry edits; missing metres and directions are never supplied by this function. */
export function reviseVenueRange(ring: SitePlanData['boundary'], request: NonNullable<OutdoorTurn['facts']['scope']>): SitePlanData['boundary'] {
  let next = ring.map(point => ({ ...point }));
  if (request.portion) {
    const axis = request.portion === 'east' || request.portion === 'west' ? 'x' : 'y';
    const values = next.map(point => point[axis]);
    const cut = (Math.min(...values) + Math.max(...values)) / 2;
    const direction = request.portion === 'east' || request.portion === 'north' ? 1 : -1;
    const clipped: typeof next = [];
    for (let i = 0; i < next.length; i++) {
      const a = next[i], b = next[(i + 1) % next.length];
      const aIn = direction * (a[axis] - cut) >= 0, bIn = direction * (b[axis] - cut) >= 0;
      if (aIn) clipped.push(a);
      if (aIn !== bIn) {
        const t = (cut - a[axis]) / (b[axis] - a[axis]);
        clipped.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    next = clipped.filter((p, i) => i === 0 || Math.hypot(p.x - clipped[i - 1].x, p.y - clipped[i - 1].y) > 0.001);
    if (next.length > 1 && Math.hypot(next[0].x - next.at(-1)!.x, next[0].y - next.at(-1)!.y) < 0.001) next.pop();
  }
  if (!checkBoundaryRing(next).ok) throw new Error('这块范围无法按该方向截取成一个有效区域；请用聊天说明要保留哪一片。');
  const xs = next.map(p => p.x), ys = next.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs), depth = Math.max(...ys) - Math.min(...ys);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const sx = (request.widthM ?? width) / width, sy = (request.depthM ?? depth) / depth;
  const radians = (request.rotationDeg ?? 0) * Math.PI / 180;
  next = next.map(p => {
    const x = (p.x - cx) * sx, y = (p.y - cy) * sy;
    return { x: Math.round((cx + x * Math.cos(radians) - y * Math.sin(radians) + (request.shiftEastM ?? 0)) * 100) / 100,
      y: Math.round((cy + x * Math.sin(radians) + y * Math.cos(radians) + (request.shiftNorthM ?? 0)) * 100) / 100 };
  });
  if (!checkBoundaryRing(next).ok) throw new Error('调整后的范围不合法，原方案保留，请重新说明尺寸。');
  return next;
}
