import { describe, expect, it } from 'vitest';
import { buildZoneEventProposal } from './zone-event-proposal';
import { outdoorEventIssue, isShorelineEvent, supportedOutdoorEvent, outdoorCorridorStrips, outdoorRingsOverlap, outdoorRouteInsideRingLength, outdoorEventTemplates, outdoorEventTemplatesSummary } from './outdoor-event-logic';
import type { OutdoorEventTemplate } from './outdoor-event-logic';
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
    // 2026-11-18 文案口径：警告说清“这版是什么 + 缺的东西等你给”，不再写「不是消防…」这类免责句。
    expect(p!.summary.warnings?.join('')).toContain('几何初稿');
    expect(p!.summary.warnings?.join('')).toContain('等你指定');
  });
  it('北入口朝向反转；80人市集出20摊、不照搬讲座舞台/座椅', () => {
    const p = build('讲座', 45, boundary, [north]); expect(p).not.toBeNull();
    expect(p!.facilities.filter(f => f.templateId.includes('chair')).every(f => f.rotationDeg === 180)).toBe(true);
    const market = build('市集', 80); expect(market).not.toBeNull();
    expect(market!.facilities.filter(f => f.name.startsWith('市集摊位'))).toHaveLength(20);
    expect(market!.facilities.some(f => f.templateId.includes('chair') || f.templateId.includes('stage'))).toBe(false);
  });
  it('规模随人数增长；狭长场地、超容量拒绝；未知活动不再拦死（2026-11-17 解耦）', () => {
    const large = build('讲座', 100); expect(large).not.toBeNull();
    expect(large!.facilities.filter(f => f.templateId.includes('chair'))).toHaveLength(100);
    const narrow = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }, { x: 0, y: 100 }];
    expect(build('讲座', 45, narrow, [{ ...south, position: { x: 5, y: 0 } }])).toBeNull();
    expect(build('讲座', 250)).toBeNull();
    // 未知类型：没有现成模板 ≠ 不能做——issue 为空，走通用需求路径，不套假模板。
    expect(outdoorEventIssue('烟花燃放', 45)).toBeNull();
    expect(outdoorEventIssue('讲座', null)).toContain('人数');
  });
  it('沿岸类（钓鱼）人数可空、不进模板注册表，模板生成器不硬套市集网格', () => {
    expect(isShorelineEvent('钓鱼比赛')).toBe(true);
    expect(isShorelineEvent('河边垂钓大赛')).toBe(true);
    expect(isShorelineEvent('80 人市集')).toBe(false);
    expect(outdoorEventIssue('钓鱼比赛', null)).toBeNull();
    expect(outdoorEventIssue('垂钓大赛', 30)).toBeNull();
    // 模板注册表不含钓鱼：防止后续有人把它加进去后落到市集网格。
    expect(supportedOutdoorEvent('钓鱼比赛')).toBeNull();
    expect(build('钓鱼比赛', 30)).toBeNull();
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

/**
 * D1 模板注册表：识别正则/参数表/摆法以注册表条目为唯一来源，
 * 「目前支持」话术与示例说法从注册表动态生成；注册新模板接线自动跟上，空注册表给统一话术。
 */
describe('D1 模板注册表',()=>{
 /** 测试注入的最小模板：只验证注册表接线（识别/话术/派发），不承载真实几何。
  * 2026-11-20 D2 落了八类真实模板（含婚礼），注入桩不能再借「婚礼」占位——
  * 改用注册表里不存在的类型，避免与真实条目抢 first-match。 */
 function stubTemplate(): OutdoorEventTemplate {
  return {
   id:'registry-stub', label:'测试活动甲', match:/测试活动甲/u, example:'50 人测试活动甲', note:'测试活动甲', aisleWidth:3,
   measure:()=>({ width:22, depth:40, mainHeight:20, aisleEndY:30 }),
   zones:ctx=>({ main:ctx.zone('reserved','测试区',1,7,ctx.width-2,ctx.layout.mainHeight), stage:null }),
   fill:ctx=>(ctx.place('booth-2x2','仪式亭',4,10,2,2,ctx.main)?1:null),
  };
 }
 it('注册新模板：识别、「目前支持」话术、提案派发都自动跟上；撤掉即回退',()=>{
  const template=stubTemplate();
  outdoorEventTemplates.push(template);
  try{
   expect(supportedOutdoorEvent('来一场测试活动甲')?.id).toBe('registry-stub');
   expect(supportedOutdoorEvent('80 人市集')?.id).toBe('market');
   expect(supportedOutdoorEvent('45 人讲座')?.id).toBe('lecture');
   expect(outdoorEventIssue('测试活动甲',30)).toBeNull();
   expect(outdoorEventIssue(null,null)).toContain('测试活动甲');
   expect(outdoorEventTemplatesSummary()).toContain('测试活动甲');
   const p=build('测试活动甲',30);
   expect(p).not.toBeNull();
   expect(p!.facilities.some(f=>f.name==='仪式亭')).toBe(true);
  }finally{
   outdoorEventTemplates.splice(outdoorEventTemplates.indexOf(template),1);
  }
  expect(supportedOutdoorEvent('测试活动甲')).toBeNull();
 });
 it('注册表空跑：统一话术，不虚构类型',()=>{
  const saved=outdoorEventTemplates.splice(0,outdoorEventTemplates.length);
  try{
   expect(supportedOutdoorEvent('80 人市集')).toBeNull();
   expect(outdoorEventTemplatesSummary()).not.toContain('市集');
   expect(outdoorEventIssue(null,null)).toBe('先说活动类型，或沿岸类的「钓鱼比赛」。');
  }finally{
   outdoorEventTemplates.push(...saved);
  }
 });
});

/**
 * D2 模板扩展（2026-11-20）：相亲/社交市集、发布会、婚礼、演出/音乐会、美食节、车展、运动会、展览
 * 八类注册进注册表。每类三条底线：正例出真实提案、场地不足整版否决、无确认入口不出提案；
 * 注册表顺序（相亲先于市集、发布会先于讲座、车展先于展览）与「目前支持」话术一并锁定。
 */
describe('D2 模板扩展（八类新活动模板）',()=>{
 /** 12×10m 小场地：任何模板占地都放不下，用于「场地不足」反例（带场内入口，排除无入口干扰）。 */
 const tiny: PlanPoint[]=[{x:-6,y:-5},{x:6,y:-5},{x:6,y:5},{x:-6,y:5}];
 const tinyEntrance: PlanNode[]=[{...south,position:{x:0,y:-5}}];
 it.each([
  ['40 人相亲会',40],['80 人发布会',80],['30 人婚礼',30],['120 人音乐会',120],
  ['80 人美食节',80],['100 人车展',100],['90 人运动会',90],['60 人展览',60],
 ])('%s：正例出提案、场地不足与无入口各被否决',(event,guests)=>{
  const p=build(event,guests);
  expect(p,`${event} 应出几何提案`).not.toBeNull();
  expect(p!.facilities.length).toBeGreaterThan(2); // 除公共签到台/医疗帐篷外还有模板自有设施
  expect(build(event,guests,tiny,tinyEntrance),`${event} 场地不足应整版否决`).toBeNull();
  expect(build(event,guests,boundary,[]),`${event} 无确认入口不出提案`).toBeNull();
 });
 it('相亲/社交市集：联谊桌成排，不落普通市集摊位网格',()=>{
  const p=build('40 人相亲会',40)!;
  const tables=p.facilities.filter(f=>f.name.startsWith('相亲桌'));
  expect(tables).toHaveLength(10);
  expect(tables.every(f=>f.templateId==='oneplan:scale:round-table-and-chairs')).toBe(true);
  expect(p.facilities.some(f=>f.name.startsWith('市集摊位'))).toBe(false);
  expect(p.zones.some(z=>z.name==='联谊区')).toBe(true);
 });
 it('发布会：观众座椅+发布舞台+主视觉大屏；讲座正则不再吃掉发布会',()=>{
  expect(supportedOutdoorEvent('发布会')?.id).toBe('launch');
  const p=build('80 人发布会',80)!;
  expect(p.facilities.filter(f=>f.templateId.includes('chair'))).toHaveLength(80);
  expect(p.facilities.some(f=>f.name==='发布舞台')).toBe(true);
  expect(p.facilities.some(f=>f.name==='主视觉大屏')).toBe(true);
  expect(p.zones.some(z=>z.name==='发布区')).toBe(true);
 });
 it('婚礼：宾客座椅分块+仪式台+拱门，仪式区在观礼区深端',()=>{
  const p=build('30 人婚礼',30)!;
  expect(p.facilities.filter(f=>f.name.startsWith('宾客座椅'))).toHaveLength(30);
  expect(p.facilities.some(f=>f.name==='仪式台')).toBe(true);
  expect(p.facilities.some(f=>f.name==='婚礼拱门')).toBe(true);
  const stage=p.zones.find(z=>z.name==='仪式区')!;
  const main=p.zones.find(z=>z.name==='观礼区')!;
  // 婚礼拱门恰在观礼/仪式区交界线上（仪式动线的门槛），两区相邻不重叠。
  expect(Math.min(...stage.polygon.map(q=>q.y))).toBeGreaterThanOrEqual(Math.max(...main.polygon.map(q=>q.y)));
 });
 it('演出/音乐会：舞台两侧带侧屏，观众座椅成矩阵',()=>{
  const p=build('120 人音乐会',120)!;
  expect(p.facilities.filter(f=>f.templateId.includes('chair'))).toHaveLength(120);
  expect(p.facilities.some(f=>f.name==='演出舞台')).toBe(true);
  expect(p.facilities.filter(f=>f.name.startsWith('侧屏'))).toHaveLength(2);
 });
 it('美食节：餐车列+就餐长桌，不是摊位网格也不是讲座舞台',()=>{
  const p=build('80 人美食节',80)!;
  expect(p.facilities.filter(f=>f.name.startsWith('美食餐车'))).toHaveLength(3);
  expect(p.facilities.filter(f=>f.name.startsWith('就餐长桌'))).toHaveLength(10);
  expect(p.facilities.some(f=>f.templateId.includes('stage'))).toBe(false);
 });
 it('车展：展车按观展通道成网，附咨询帐篷',()=>{
  const p=build('100 人车展',100)!;
  const cars=p.facilities.filter(f=>f.name.startsWith('展车'));
  expect(cars).toHaveLength(5);
  expect(cars.every(f=>f.templateId==='oneplan:scale:car')).toBe(true);
  expect(p.facilities.some(f=>f.name==='咨询帐篷')).toBe(true);
 });
 it('运动会：终点龙门架+检录帐篷+赛道界标锥桶+休息长凳',()=>{
  const p=build('90 人运动会',90)!;
  expect(p.facilities.some(f=>f.name==='终点龙门架')).toBe(true);
  expect(p.facilities.some(f=>f.name==='检录帐篷')).toBe(true);
  expect(p.facilities.filter(f=>f.name.startsWith('赛道界标')).length).toBeGreaterThanOrEqual(6);
  expect(p.facilities.filter(f=>f.name.startsWith('休息长凳'))).toHaveLength(3);
 });
 it('展览：3×3 展位成排，与市集摊位区分',()=>{
  const p=build('60 人展览',60)!;
  const booths=p.facilities.filter(f=>f.name.startsWith('展位'));
  expect(booths).toHaveLength(15);
  expect(booths.every(f=>f.size.width===3&&f.size.depth===3)).toBe(true);
 });
 it('注册表顺序：相亲先于市集、发布会先于讲座、车展先于展览',()=>{
  expect(supportedOutdoorEvent('相亲市集')?.id).toBe('social');
  expect(supportedOutdoorEvent('80 人市集')?.id).toBe('market');
  expect(supportedOutdoorEvent('新品发布会')?.id).toBe('launch');
  expect(supportedOutdoorEvent('45 人讲座')?.id).toBe('lecture');
  expect(supportedOutdoorEvent('户外婚礼')?.id).toBe('wedding');
  // brief.event 可能整串含两族词（模型分类产物），数组顺序即裁判。
  expect(supportedOutdoorEvent('汽车展览会')?.id).toBe('car-show');
  expect(supportedOutdoorEvent('100 人展览')?.id).toBe('exhibition');
  expect(supportedOutdoorEvent('趣味运动会')?.id).toBe('sports');
 });
 it('「目前支持」话术随八类新模板更新；缺人数给可操作出路',()=>{
  const summary=outdoorEventTemplatesSummary();
  for(const label of ['相亲/社交市集','市集','发布会','讲座','婚礼','演出/音乐会','美食节','车展','运动会','展览']){
   expect(summary).toContain(label);
  }
  expect(outdoorEventIssue('美食节',null)).toContain('人数');
  expect(outdoorEventIssue('车展',null)).toContain('人数');
  expect(outdoorEventIssue('相亲会',null)).toContain('人数');
 });
});
/**
 * 2026-11-17 生产实测（杭州湖滨路）：判据从「中心线离墙多近」改成「中心线是否真的走进足迹」。
 * OSM 道路与建筑常在墙角共享顶点，贴墙走不是穿楼；真穿楼才是要提醒的事。
 */
describe('outdoorRouteInsideRingLength（穿楼长度）',()=>{
 const building: PlanPoint[]=[{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}];
 it('中心线从建筑里穿过：量到穿楼那一截，不按整条线段算',()=>{
  expect(outdoorRouteInsideRingLength([{x:-20,y:10},{x:50,y:10}],building)).toBeCloseTo(30,0);
 });
 it('中心线贴着外墙走（共享墙角顶点）：不算穿楼',()=>{
  expect(outdoorRouteInsideRingLength([{x:-20,y:0},{x:50,y:0}],building)).toBe(0);
 });
 it('中心线离墙一臂远：不算穿楼',()=>{
  expect(outdoorRouteInsideRingLength([{x:-20,y:-0.4},{x:50,y:-0.4}],building)).toBe(0);
 });
 it('只擦到墙角一个点：不算穿楼',()=>{
  expect(outdoorRouteInsideRingLength([{x:-20,y:0},{x:0,y:0},{x:0,y:20}],building)).toBe(0);
 });
});
