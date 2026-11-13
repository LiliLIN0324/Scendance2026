import { describe, expect, it } from 'vitest';
import { buildZoneEventProposal } from './zone-event-proposal';
import { outdoorEventIssue, outdoorCorridorStrips, outdoorRingsOverlap } from './outdoor-event-logic';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
import { planPointInRing } from './site-plan-editing';
import type { PlanPoint, PlanNode, PlanRoute } from '../../../../supabase/functions/_shared/site-plan';
const boundary: PlanPoint[] = [{ x: -80, y: -70 }, { x: 80, y: -70 }, { x: 80, y: 70 }, { x: -80, y: 70 }];
const south: PlanNode = { id: 's', kind: 'both', name: '南入口', position: { x: 0, y: -70 }, notes: '' };
const north: PlanNode = { ...south, id: 'n', name: '北入口', position: { x: 0, y: 70 } };
function build(event = '讲座', guests = 45, ring = boundary, nodes = [south], routes: PlanRoute[] = []) {
  let n = 0;
  return buildZoneEventProposal({ boundary: ring, nodes, brief: { event, guests }, existingRoutes: routes }, () => `event-${++n}`);
}
describe('户外活动逻辑/几何守卫', () => {
  it('45人讲座：45把椅子，舞台在前、签到在入场侧，中央3m通道不被占用', () => {
    const p = build(); expect(p).not.toBeNull();
    expect(p!.facilities.filter(f => f.templateId.includes('chair'))).toHaveLength(45);
    expect(p!.facilities.some(f => f.name === '医疗帐篷' && f.size.width === 4 && f.size.depth === 3)).toBe(true);
    expect(p!.facilities.some(f => f.name === '讲台/舞台')).toBe(true);
    expect(p!.facilities.some(f => f.name === '签到台')).toBe(true);
    const stage = p!.zones.find(z => z.semantic === 'stage')!;
    const audience = p!.zones.find(z => z.semantic === 'audience')!;
    const checkin = p!.zones.find(z => z.semantic === 'checkin')!;
    expect(Math.min(...stage.polygon.map(x => x.y))).toBeGreaterThan(Math.max(...audience.polygon.map(x => x.y)));
    expect(Math.max(...checkin.polygon.map(x => x.y))).toBeLessThan(Math.min(...audience.polygon.map(x => x.y)));
    expect(p!.routes?.some(r => r.name.includes('签到接驳'))).toBe(true);
    const aisle = p!.routes!.find(r => r.name === '活动中央人行通道')!;
    for (const facility of p!.facilities) {
      const footprint = facilityFootprintRing(facility);
      expect(facilityPlacementIssues(footprint, boundary)).toEqual([]);
      if (facility.templateId.includes('chair')) expect(facility.rotationDeg).toBe(0);
      const xs = footprint.map(x => x.x); const centerX = aisle.points[0]!.x;
      if (Math.min(...footprint.map(p => p.y)) > Math.max(...aisle.points.map(p => p.y))) continue;
      expect(Math.max(...xs) <= centerX - 1.5 || Math.min(...xs) >= centerX + 1.5).toBe(true);
    }
    expect(p!.summary.warnings?.join('')).toContain('不是消防');
  });
  it('北入口朝向反转；80人市集出20摊、不照搬讲座舞台/座椅', () => {
    const p = build('讲座', 45, boundary, [north]); expect(p).not.toBeNull();
    expect(p!.facilities.filter(f => f.templateId.includes('chair')).every(f => f.rotationDeg === 180)).toBe(true);
    const market = build('市集', 80); expect(market).not.toBeNull();
    expect(market!.facilities.filter(f => f.name.startsWith('市集摊位'))).toHaveLength(20);
    expect(market!.facilities.some(f => f.templateId.includes('chair') || f.templateId.includes('stage'))).toBe(false);
  });
  it('规模随人数增长；狭长场地、超容量和不支持活动不硬套模板', () => {
    const large = build('讲座', 100); expect(large).not.toBeNull();
    expect(large!.facilities.filter(f => f.templateId.includes('chair'))).toHaveLength(100);
    const narrow = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }, { x: 0, y: 100 }];
    expect(build('讲座', 45, narrow, [{ ...south, position: { x: 5, y: 0 } }])).toBeNull();
    expect(build('讲座', 250)).toBeNull();
    expect(outdoorEventIssue('烟花燃放', 45)).toContain('只支持');
    expect(outdoorEventIssue('讲座', null)).toContain('人数');
  });
  it('L形真实场地内区域、设施和入口连接都不穿凹口', () => {
    const l = [{ x: -80, y: -70 }, { x: 80, y: -70 }, { x: 80, y: -5 }, { x: -5, y: -5 }, { x: -5, y: 70 }, { x: -80, y: 70 }];
    const p = build('讲座', 45, l); expect(p).not.toBeNull();
    for (const z of p!.zones) expect(facilityPlacementIssues(z.polygon, l)).toEqual([]);
    for (const f of p!.facilities) expect(facilityPlacementIssues(facilityFootprintRing(f), l)).toEqual([]);
    for (const r of p!.routes ?? []) for (const point of r.points) expect(planPointInRing(point, l)).toBe(true);
  });
  it('没有已确认场地入口，或仅活动子口时不冒充入口排活动', () => {
    expect(build('讲座', 45, boundary, [])).toBeNull();
    expect(build('讲座', 45, boundary, [{ ...south, name: '活动子口' }])).toBeNull();
  });
  it('车行线占满可用活动区就拒绝，不将座椅塞在人车混行线上', () => {
    const tiny = [{ x: -13, y: -20 }, { x: 13, y: -20 }, { x: 13, y: 20 }, { x: -13, y: 20 }];
    const route: PlanRoute = { id: 'v', kind: 'vehicle', name: '车行', points: [{ x: 0, y: -20 }, { x: 0, y: 20 }], widthM: 6, oneWay: false, notes: '' };
    expect(build('讲座', 45, tiny, [{ ...south, position: { x: 0, y: -20 } }], [route])).toBeNull();
  });
});

describe('public-size 80x70 site and off-centre boundary portals',()=>{
 const ring=[{x:0,y:0},{x:80,y:0},{x:80,y:70},{x:0,y:70}];
 it.each([{x:80,y:17.3},{x:80,y:33},{x:0,y:42.7},{x:22.3,y:0},{x:47.2,y:70}])('45 seats and a full-width connected ingress at %j',position=>{
  const p=build('讲座',45,ring,[{...south,position}]);
  expect(p).not.toBeNull();expect(p!.facilities.filter(f=>f.templateId.includes('chair'))).toHaveLength(45);
  for(const r of p!.routes??[])for(const strip of outdoorCorridorStrips(r.points,r.widthM??3))expect(facilityPlacementIssues(strip,ring)).toEqual([]);
 });
 it('keeps an existing 36.1m entry-connected pedestrian corridor clear instead of rejecting the first region only',()=>{
  const position={x:80,y:33};const route:PlanRoute={id:'existing-walk',name:'人行',kind:'pedestrian',points:[position,{x:43.9,y:33}],widthM:3,oneWay:false,notes:''};
  const p=build('讲座',45,ring,[{...south,position}],[route]);expect(p).not.toBeNull();
  for(const f of p!.facilities)for(const strip of outdoorCorridorStrips(route.points,3))expect(outdoorRingsOverlap(strip,facilityFootprintRing(f))).toBe(false);
 });
});

it('outside portal and corner portal without 3m clearance remain rejected, rather than snapping or weakening safety',()=>{
 const ring=[{x:0,y:0},{x:80,y:0},{x:80,y:70},{x:0,y:70}];
 expect(build('讲座',45,ring,[{...south,position:{x:80.2,y:33}}])).toBeNull();
 expect(build('讲座',45,ring,[{...south,position:{x:80,y:0.2}}])).toBeNull();
});
it('translated ENU anchors do not turn an 80x70m site into a different scale',()=>{
 const ring=[{x:410,y:-230},{x:490,y:-230},{x:490,y:-160},{x:410,y:-160}];
 const p=build('讲座',45,ring,[{...south,position:{x:490,y:-197}}]);expect(p).not.toBeNull();
 for(const z of p!.zones)expect(facilityPlacementIssues(z.polygon,ring)).toEqual([]);
});
