/** 可解释的户外活动 v1：小型讲座/会议与市集。不是消防/容量安全认证。 */
import type { PlanFacility, PlanNode, PlanPoint, PlanRoute, PlanZone } from '../../../../supabase/functions/_shared/site-plan';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
import { planPointInRing, planSegmentsCrossStrict } from './site-plan-editing';
import type { BuildZoneEventInput, ZoneEventProposal } from './zone-event-proposal';

type Side = 'N' | 'S' | 'E' | 'W';
export function supportedOutdoorEvent(event: string | null): 'lecture' | 'market' | null {
  if (!event) return null;
  if (/市集|集市|展销/u.test(event)) return 'market';
  if (/讲座|会议|论坛|发布会/u.test(event)) return 'lecture';
  return null;
}

/** 返回缺失/不支持原因，供同一个 Agent 的渐进引导卡使用。 */
export function outdoorEventIssue(event: string | null, guests: number | null): string | null {
  if (!event) return '先说活动类型，例如「45 人讲座」或「80 人市集」。';
  if (!supportedOutdoorEvent(event)) return '目前自动排布只支持小型讲座/会议和市集；其他活动请先手动规划，不会套一个假合适的模板。';
  if (!guests || !Number.isFinite(guests) || !Number.isInteger(guests) || guests < 1) return '还缺预计人数；说一句「45 人讲座」或「80 人市集」即可继续。';
  if (guests > 200) return '这版只支持 1–200 人的小型活动；更大活动需要人工核对容量、疏散和交通组织。';
  return null;
}

function box(ring: readonly PlanPoint[]) {
  return { w: Math.min(...ring.map(p => p.x)), e: Math.max(...ring.map(p => p.x)), s: Math.min(...ring.map(p => p.y)), n: Math.max(...ring.map(p => p.y)) };
}
function overlaps(a: PlanFacility, b: PlanFacility): boolean {
  const x = box(facilityFootprintRing(a)); const y = box(facilityFootprintRing(b));
  return x.w < y.e + 0.3 && x.e > y.w - 0.3 && x.s < y.n + 0.3 && x.n > y.s - 0.3;
}
function pathCrossesRing(points: PlanPoint[], ring: PlanPoint[]): boolean {
  if (points.some(p => planPointInRing(p, ring))) return true;
  for (let i = 1; i < points.length; i += 1) for (let j = 0; j < ring.length; j += 1) {
    if (planSegmentsCrossStrict(points[i - 1]!, points[i]!, ring[j]!, ring[(j + 1) % ring.length]!)) return true;
  }
  return false;
}

/** Width-aware swept strips. End caps stay at the confirmed portal, not outside the site. */
export function outdoorCorridorStrips(points: PlanPoint[], width: number): PlanPoint[][] {
  const rings: PlanPoint[][] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!; const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y); if (length < 0.01) continue;
    const nx = -(b.y - a.y) / length * width / 2; const ny = (b.x - a.x) / length * width / 2;
    rings.push([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }]);
  }
  return rings;
}
export function outdoorRingsOverlap(a: PlanPoint[], b: PlanPoint[]): boolean {
  return pathCrossesRing([...a, a[0]!], b) || pathCrossesRing([...b, b[0]!], a);
}

function distanceToRoute(point: PlanPoint, route: PlanRoute): number {
  let best = Infinity;
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1]!; const b = route.points[i]!; const dx = b.x - a.x; const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}
/** Real portals only; an outside node or an activity sub-portal is not a confirmed site entrance. */
export function confirmedOutdoorEntrances(nodes: readonly PlanNode[], boundary: readonly PlanPoint[]): PlanNode[] {
  return nodes.filter(node => node.kind !== 'exit' && !/子口|子出入口/u.test(node.name + node.notes) && planPointInRing(node.position, boundary));
}
export function outdoorEventSiteSummary(input: Pick<BuildZoneEventInput, 'boundary' | 'nodes' | 'existingRoutes' | 'existingFacilities'>): string {
  const b = box(input.boundary);
  const area = Math.abs(input.boundary.reduce((sum,p,i)=>{const q=input.boundary[(i+1)%input.boundary.length]!;return sum+p.x*q.y-q.x*p.y;},0))/2;
  return `当前边界包围盒约 ${(b.e-b.w).toFixed(1)}×${(b.n-b.s).toFixed(1)}m、面积约 ${Math.round(area)}㎡（不等于可用活动面积），边界内有效入口 ${confirmedOutdoorEntrances(input.nodes,input.boundary).length} 个；现有设施 ${input.existingFacilities?.length ?? 0} 件、人行线 ${(input.existingRoutes??[]).filter(r=>r.kind==='pedestrian').length} 条、车行/后勤线 ${(input.existingRoutes??[]).filter(r=>r.kind!=='pedestrian').length} 条。`;
}
/** At a boundary portal first travel perpendicular into the site. A diagonal sweep at the
 * portal spills outside even when its centreline fits; never waive the full-width guard. */
function connectionPaths(from: PlanPoint, to: PlanPoint, boundary: PlanPoint[]): PlanPoint[][] {
  const inward = (point: PlanPoint): PlanPoint[] => {
    let edge: {a:PlanPoint;b:PlanPoint;distance:number}|null=null;
    for(let i=0;i<boundary.length;i+=1){
      const a=boundary[i]!,b=boundary[(i+1)%boundary.length]!,dx=b.x-a.x,dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
      const distance=Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
      if(!edge||distance<edge.distance)edge={a,b,distance};
    }
    if(!edge||edge.distance>3)return [];
    const dx=edge.b.x-edge.a.x,dy=edge.b.y-edge.a.y,length=Math.hypot(dx,dy);
    if(length<0.01)return [];
    return [1,-1].map(sign=>({x:point.x-sign*dy/length*3,y:point.y+sign*dx/length*3})).filter(p=>planPointInRing(p,boundary));
  };
  const paths:PlanPoint[][]=[];
  for(const start of [null,...inward(from)])for(const end of [null,...inward(to)]){
    const a=start??from,b=end??to;
    for(const middle of [[],[{x:a.x,y:b.y}],[{x:b.x,y:a.y}]]){
      const points=[from,...(start?[start]:[]),...middle,...(end?[end]:[]),to];
      paths.push(points.filter((p,i)=>i===0||Math.hypot(p.x-points[i-1]!.x,p.y-points[i-1]!.y)>0.01));
    }
  }
  return paths;
}

export function buildLogicalOutdoorEvent(input: BuildZoneEventInput, id: () => string): ZoneEventProposal | null {
  const kind = supportedOutdoorEvent(input.brief.event);
  const guests = input.brief.guests;
  if (!kind || outdoorEventIssue(input.brief.event, guests) || !guests) return null;
  const { boundary } = input;
  if (boundary.length < 3) return null;
  const bb = box(boundary);
  const entranceScore = (node: PlanNode) => (input.existingRoutes ?? []).reduce((score, route) => {
    if (distanceToRoute(node.position, route) > (route.widthM ?? 3) / 2 + 1) return score;
    return score + (route.kind === 'pedestrian' ? -10 : 100);
  }, 0);
  const entrance = confirmedOutdoorEntrances(input.nodes, boundary).sort((a, b) => entranceScore(a) - entranceScore(b))[0];
  if (!entrance) return null;
  const side: Side = !entrance ? 'S' : ([
    ['S', Math.abs(entrance.position.y - bb.s)], ['N', Math.abs(entrance.position.y - bb.n)],
    ['W', Math.abs(entrance.position.x - bb.w)], ['E', Math.abs(entrance.position.x - bb.e)],
  ] as [Side, number][]).sort((a, b) => a[1] - b[1])[0]![0];
  const stalls = Math.ceil(guests / 4);
  // 规模来自人数，不把整个公园 bbox 铺满。3m 中央通道 + 两侧设施 + 外侧留白。
  const cols = kind === 'lecture' ? Math.max(4, Math.min(16, Math.ceil(Math.sqrt(guests)))) : 2;
  const rows = kind === 'lecture' ? Math.ceil(guests / cols) : Math.ceil(stalls / 2);
  const width = kind === 'lecture' ? Math.max(22, cols * 0.95 + 7) : 19;
  const depth = kind === 'lecture' ? rows * 1.2 + 23 : rows * 4 + 13;
  const alongY = side === 'S' || side === 'N';
  const rectW = alongY ? width : depth; const rectH = alongY ? depth : width;
  if (bb.e - bb.w < rectW + 2 || bb.n - bb.s < rectH + 2) return null;
  const local = (x: number, y: number): PlanPoint => {
    if (side === 'S') return { x, y };
    if (side === 'N') return { x: width - x, y: depth - y };
    if (side === 'W') return { x: y, y: width - x };
    return { x: depth - y, y: x };
  };
  const candidates: PlanPoint[] = [];
  for (let ix = 0; ix <= 8; ix += 1) for (let iy = 0; iy <= 8; iy += 1) candidates.push({
    x: bb.w + 1 + (bb.e - bb.w - rectW - 2) * ix / 8,
    y: bb.s + 1 + (bb.n - bb.s - rectH - 2) * iy / 8,
  });
  const priority = entrance?.position ?? { x: (bb.w + bb.e) / 2, y: bb.s };
  candidates.sort((a, b) => Math.hypot(a.x + rectW / 2 - priority.x, a.y + rectH / 2 - priority.y) - Math.hypot(b.x + rectW / 2 - priority.x, b.y + rectH / 2 - priority.y));
  const tryCandidate = (origin: PlanPoint): ZoneEventProposal | null => {
    const point = (x: number, y: number): PlanPoint => {
      const p = local(x, y);
      return { x: Math.round((origin.x + p.x) * 10) / 10, y: Math.round((origin.y + p.y) * 10) / 10 };
    };
    const zones: PlanZone[] = [];
    const facilities: PlanFacility[] = [];
    const zone = (semantic: PlanZone['semantic'], name: string, x: number, y: number, w: number, h: number): PlanZone => {
      const result: PlanZone = { id: id(), semantic, name, event: `${input.brief.event}·${name}`.slice(0, 120),
        polygon: [point(x, y), point(x + w, y), point(x + w, y + h), point(x, y + h)],
        notes: `${guests} 人${kind === 'market' ? '市集，约每摊4人' : '讲座/会议'}；通道与外侧留白不计入设施占地。` };
      zones.push(result); return result;
    };
    const checkin = zone('checkin', '签到区', width / 2 - 5, 0, 10, 4);
    const medical = zone('medical', '医疗点', 0, 0, 4, 4);
    const main = kind === 'lecture' ? zone('audience', '观众区', 1, 7, width - 2, depth - 19)
      : zone('reserved', '市集区', 1, 7, width - 2, depth - 10);
    const stage = kind === 'lecture' ? zone('stage', '舞台区', width / 2 - 5, depth - 10, 10, 8) : null;
    const facing = side === 'S' ? 0 : side === 'N' ? 180 : side === 'W' ? 90 : 270;
    const place = (templateId: string, name: string, x: number, y: number, w: number, d: number, parent: PlanZone): boolean => {
      const item: PlanFacility = { id: id(), templateId, name, position: point(x, y), rotationDeg: facing,
        size: { width: w, depth: d }, zoneId: parent.id, notes: '活动逻辑提案：面向舞台/通道；非安全认证。' };
      const ring = facilityFootprintRing(item);
      if (facilityPlacementIssues(ring, boundary).length || facilityPlacementIssues(ring, parent.polygon).length) return false;
      if ([...facilities, ...(input.existingFacilities ?? [])].some(other => overlaps(item, other))) return false;
      facilities.push(item); return true;
    };
    if (!place('booth-2x2', '签到台', width / 2 - 3, 2, 2, 2, checkin)
      || !place('medical-tent-4x3', '医疗帐篷', 2, 2, 4, 3, medical)) return null;
    if (stage && !place('stage-platform-8x6', '讲台/舞台', width / 2, depth - 6, 8, 6, stage)) return null;
    let count = 0;
    if (kind === 'lecture') {
      const leftCols = Math.ceil(cols / 2);
      for (let row = 0; row < rows && count < guests; row += 1) for (let col = 0; col < cols && count < guests; col += 1) {
        const offset = col < leftCols ? -(leftCols - col) * 0.95 - 1.5 : (col - leftCols + 1) * 0.95 + 1.5;
        if (place('oneplan:scale-fg:chair', `观众座椅 ${count + 1}`, width / 2 + offset, 8 + row * 1.2, 0.55, 0.6, main)) count += 1;
      }
      if (count < guests) return null; // 放不下人数就不产出「看起来能容纳」的提案。
    } else {
      for (let row = 0; row < rows; row += 1) for (const x of [width / 2 - 4, width / 2 + 4]) {
        if (count < stalls && place('booth-2x2', `市集摊位 ${count + 1}`, x, 8.5 + row * 4, 2, 2, main)) count += 1;
      }
      if (count < stalls) return null;
    }
    if (zones.some(z => facilityPlacementIssues(z.polygon, boundary).length)) return null;
    const aisle = [point(width / 2, 0), point(width / 2, kind === 'lecture' ? depth - 11 : depth - 1)];
    const routes: PlanRoute[] = [{ id: id(), kind: 'pedestrian', name: '活动中央人行通道', points: aisle, widthM: 3, oneWay: false, notes: '预留3m示意通道，需现场核对；非疏散安全认证。' }];
    const nodes: PlanNode[] = [];
    const clearCorridor = (points: PlanPoint[]): boolean => outdoorCorridorStrips(points, 3).every(strip =>
      !facilityPlacementIssues(strip, boundary).length
      && ![...facilities, ...(input.existingFacilities ?? [])].some(f => outdoorRingsOverlap(strip, facilityFootprintRing(f)))
      && !(input.existingRoutes ?? []).some(r => r.kind !== 'pedestrian' && outdoorCorridorStrips(r.points, (r.widthM ?? 4) + 2).some(road => outdoorRingsOverlap(strip, road))));
    if (!clearCorridor(aisle)) return null;
    // Preserve existing pedestrian aisles as real occupied corridors, not just harmless centerlines.
    if ((input.existingRoutes ?? []).some(r => r.kind === 'pedestrian' && outdoorCorridorStrips(r.points, r.widthM ?? 3).some(strip => facilities.some(f => outdoorRingsOverlap(strip, facilityFootprintRing(f)))))) return null;
    const warnings = ['仅为几何与业务初稿；不是消防、疏散或人数容量安全认证。', '厕所、停车、后勤与无障碍服务需核对现场资源，不虚构其位置。'];
    if (entrance) {
      const end = aisle[0]!;
      const paths = connectionPaths(entrance.position, end, boundary);
      const path = paths.find(clearCorridor);
      if (!path) return null;
      if (Math.hypot(entrance.position.x - end.x, entrance.position.y - end.y) > 0.5) routes.push({ id: id(), kind: 'pedestrian', name: '入口至签到接驳', points: path, widthM: 3, oneWay: false, notes: '入口→签到→观众/市集；需现场复核。' });
    } else warnings.push('尚未确认场地入口：请先完成流线/出入口并重新生成。');
    const otherExits = input.nodes.filter(node => node.id !== entrance?.id && node.kind !== 'entry');
    let connectedExits = 0;
    for (const exit of otherExits.slice(0, 2)) {
      const from = aisle[aisle.length - 1]!;
      const paths = connectionPaths(from, exit.position, boundary);
      const path = paths.find(clearCorridor);
      if (!path) continue;
      routes.push({ id: id(), kind: 'pedestrian', name: '活动区至既有出口接驳', points: path, widthM: 3, oneWay: false, notes: '只接已有出口，不新造场地疏散出口；需现场核对。' });
      connectedExits += 1;
    }
    if (!connectedExits) warnings.push('未连通独立的第二出口，不能据此认定疏散合格；请补充真实出口并重排。');
    // 子口在既有人行通道上，不把它冒充一个新的场地疏散出口。
    nodes.push({ id: id(), kind: 'both', name: '活动区子口', position: aisle[0]!, notes: '活动子口（不是场地疏散出口）。' });
    return { zones, facilities, routes, nodes, summary: { zones: zones.length, facilities: facilities.length, side, warnings } };
  };
  for (const candidate of candidates) {
    const ring = [{ x: candidate.x, y: candidate.y }, { x: candidate.x + rectW, y: candidate.y }, { x: candidate.x + rectW, y: candidate.y + rectH }, { x: candidate.x, y: candidate.y + rectH }];
    if (facilityPlacementIssues(ring, boundary).length) continue;
    if ((input.existingRoutes ?? []).some(route => {
      if (route.kind === 'pedestrian') return false;
      const b = box(ring); const pad = (route.widthM ?? 4) / 2 + 1;
      return pathCrossesRing(route.points, [{ x: b.w - pad, y: b.s - pad }, { x: b.e + pad, y: b.s - pad }, { x: b.e + pad, y: b.n + pad }, { x: b.w - pad, y: b.n + pad }]);
    })) continue;
    if ((input.existingFacilities ?? []).some(f => pathCrossesRing(facilityFootprintRing(f), ring) || planPointInRing(ring[0]!, facilityFootprintRing(f)))) continue;
    const proposal = tryCandidate(candidate);
    if (proposal) return proposal;
  }
  return null;
}
