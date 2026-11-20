import { describe, expect, it } from 'vitest';
import { sitePlanDataSchema } from '../../../../supabase/functions/_shared/site-plan';
import { validateWorkflowPlan } from './outdoor-agent-planning';
import { outdoorCorridorStrips, outdoorRingsOverlap } from './outdoor-event-logic';
import { planRingsOverlap } from './site-plan-editing';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
import { proposeWeddingLayout } from './wedding-layout';
import { weddingDesignRequest } from './wedding-request';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const rect=(w:number,s:number,e:number,n:number)=>[{x:w,y:s},{x:e,y:s},{x:e,y:n},{x:w,y:n}];
const venue=(size=70):SitePlanData=>({schemaVersion:1,boundary:rect(0,0,size,size),zones:[],facilities:[],routes:[],nodes:[],workers:[]});
const brief={event:'户外婚礼',guests:60,zones:[],items:[],people:[]};
const draft=(plan:SitePlanData,extra:Partial<Parameters<typeof proposeWeddingLayout>[0]>={})=>proposeWeddingLayout({plan,brief,library:[],signal:new AbortController().signal,...extra});

describe('场景驱动的婚礼空间规划',()=>{
  it('60人默认6桌10席，仪式焦点、中央通道和桌椅组团通过生产确认门',async()=>{
    const base=venue(),report=await draft(base);
    expect(report.plan.zones).toHaveLength(6);
    expect(new Set(report.plan.zones.map(z=>z.name)).size).toBe(6);
    expect(report.quantities.find(q=>q.role==='宴席圆桌')).toMatchObject({requested:6,placed:6});
    expect(report.checks).toMatchObject({collisions:0,boundary:0,obstacles:0,corridors:0,ceremonySeats:60,banquetSeats:60,access:'pending',safety:'unverified'});
    const arch=report.plan.facilities.find(f=>f.name==='仪式背景 1')!;
    const chairs=report.plan.facilities.filter(f=>f.name.startsWith('观礼椅'));
    expect(chairs.every(chair=>Math.abs(chair.position.x-arch.position.x)>1.75)).toBe(true);
    for(const chair of chairs){
      const angle=chair.rotationDeg*Math.PI/180,dx=arch.position.x-chair.position.x,dy=arch.position.y-chair.position.y;
      expect((-Math.sin(angle)*dx+Math.cos(angle)*dy)/Math.hypot(dx,dy)).toBeCloseTo(1);
    }
    for(let n=1;n<=6;n++)expect(report.plan.facilities.filter(f=>f.name.startsWith(`宴席 ${n} 桌 `))).toHaveLength(10);
    expect(()=>sitePlanDataSchema.parse(report.plan)).not.toThrow();
    expect(()=>validateWorkflowPlan(base,report.plan)).not.toThrow();
    expect(base.facilities).toHaveLength(0);
  });

  it('拥挤旧分区重排会尝试替代组织，完整保留原方案',async()=>{
    const plan=venue();plan.zones=[{id:crypto.randomUUID(),name:'仪式区',purpose:'audience',semantic:'audience',environment:'outdoor',polygon:rect(1,1,3,3),notes:''}];
    plan.facilities=[{id:crypto.randomUUID(),templateId:'old-chair',name:'旧观礼椅',zoneId:plan.zones[0].id,position:{x:2,y:2},rotationDeg:0,size:{width:0.5,depth:0.55},notes:''}];
    const original=structuredClone(plan),report=await draft(plan,{optimize:true});
    expect(plan).toEqual(original);expect(report.originalPlan).toEqual(original);
    expect(report.plan.facilities.some(f=>f.id===original.facilities[0].id)).toBe(false);
    expect(report.checks.ceremonySeats).toBe(60);expect(report.checks.banquetSeats).toBe(60);
    expect(()=>validateWorkflowPlan(plan,report.plan)).not.toThrow();
    expect(report.notes.join(' ')).toContain('自动比较 2 版');
    // 差异信息四个维度都要能核对：旧分区与旧椅子被换掉、新分区与通道新增，不就地改对象。
    expect(report.diff.zones.removed).toBeGreaterThanOrEqual(1);
    expect(report.diff.zones.added).toBeGreaterThanOrEqual(1);
    expect(report.diff.facilities.removed).toBeGreaterThanOrEqual(1);
    expect(report.diff.facilities.added).toBeGreaterThanOrEqual(1);
    expect(report.diff.routes.added).toBeGreaterThanOrEqual(1);
    expect(report.diff.facilities.changed+report.diff.zones.changed+report.diff.routes.changed).toBe(0);
    expect(report.diff.unchanged).toBe(false);
  });

  it('面积不足如实报告差额，不缩小物件或降低人数、不伪造入口',async()=>{
    const report=await draft(venue(16));
    expect(report.checks.target).toBe(60);expect(report.checks.banquetSeats).toBeLessThan(60);
    expect(report.plan.nodes).toEqual([]);
    expect(report.notes.join(' ')).toContain('差');expect(report.notes.join(' ')).toContain('待核对');
    expect(report.checks.collisions+report.checks.boundary+report.checks.obstacles+report.checks.corridors).toBe(0);
  });

  it('避开已知建筑/水域及全宽通道，匹配真实尺寸，拒绝把长桌冒充圆桌',async()=>{
    const block=rect(5,40,15,53),base=venue();
    const report=await draft(base,{hardBlocks:[block],library:[{id:'long-table',name:'长餐桌',source:'personal',width:2,depth:0.8,height:0.8,available:true,modelSlug:'long-table'}]});
    expect(report.plan.facilities.some(f=>f.sourceAssetId==='long-table'&&f.name.startsWith('宴席圆桌'))).toBe(false);
    for(const facility of report.plan.facilities){
      const ring=facilityFootprintRing(facility);
      expect(outdoorRingsOverlap(ring,block)).toBe(false);
      expect(report.plan.routes.some(r=>outdoorCorridorStrips(r.points,r.widthM??3).some(strip=>outdoorRingsOverlap(strip,ring)))).toBe(false);
    }
    expect(()=>validateWorkflowPlan(base,report.plan)).not.toThrow();
  });

  it('缺人数使用标记的60人假设；取消请求中止候选生成',async()=>{
    const report=await draft(venue(),{brief:{event:'户外婚礼',zones:[],items:[],people:[]}});
    expect(report.checks.target).toBe(60);expect(report.notes.join(' ')).toContain('人数未给定');
    const controller=new AbortController();controller.abort();
    await expect(draft(venue(),{signal:controller.signal})).rejects.toThrow();
  });
});

it('明确婚礼规划请求走本地设计能力；问句和否定不会触发写入',()=>{
  expect(weddingDesignRequest('请重新布置60人户外婚礼，不需要等待参数',undefined,venue())).toMatchObject({action:'design-event',facts:{guests:{value:60}}});
  expect(weddingDesignRequest('这里做60人婚礼，先出一版',undefined,venue())).toMatchObject({action:'design-event',facts:{guests:{value:60}}});
  expect(weddingDesignRequest('不知道仪式区怎么规划？','婚礼',venue())).toBeNull();
  expect(weddingDesignRequest('不要重新规划婚礼','婚礼',venue())).toBeNull();
});

describe('场地组织与候选取舍',()=>{
  const concave=():SitePlanData=>({schemaVersion:1,
    boundary:[{x:0,y:0},{x:40,y:0},{x:40,y:20},{x:20,y:20},{x:20,y:40},{x:0,y:40}],
    zones:[],facilities:[],routes:[],nodes:[],workers:[]});

  it('凹形场地：分区落在两臂而非外接矩形，桌椅不进入凹口且满员',async()=>{
    const notch=rect(20,20,40,40),report=await draft(concave());
    expect(report.site.usableRects).toBeGreaterThanOrEqual(2);
    expect(report.plan.zones).toHaveLength(6);
    for(const zone of report.plan.zones){
      // 凹口在边界之外：分区贴凹口边可以，进入凹口不行（贴边不算重叠）。
      expect(planRingsOverlap(zone.polygon,notch)).toBe(false);
      expect(facilityPlacementIssues(zone.polygon,report.plan.boundary)).toHaveLength(0);
    }
    for(let i=0;i<report.plan.zones.length;i++)for(let j=i+1;j<report.plan.zones.length;j++)
      expect(planRingsOverlap(report.plan.zones[i]!.polygon,report.plan.zones[j]!.polygon)).toBe(false);
    for(const facility of report.plan.facilities){
      expect(planRingsOverlap(facilityFootprintRing(facility),notch)).toBe(false);
      expect(facilityPlacementIssues(facilityFootprintRing(facility),report.plan.boundary)).toHaveLength(0);
    }
    expect(report.site.entrance.confirmed).toBe(false);
    // 多块连续区域时宴席留在入口侧、仪式放到最远处，宾客不用穿过背景去吃饭。
    const centerY=(ring:typeof report.plan.zones[number]['polygon'])=>ring.reduce((sum,point)=>sum+point.y,0)/ring.length;
    expect(centerY(report.plan.zones.find(zone=>zone.name==='宴席区')!.polygon))
      .toBeLessThan(centerY(report.plan.zones.find(zone=>zone.name==='仪式观礼区')!.polygon));
    expect(report.quantities.find(item=>item.role==='仪式背景')!.placed).toBe(1);
    expect(report.checks).toMatchObject({status:'ready',hardConflicts:0,ceremonySeats:60,banquetSeats:60});
    expect(()=>validateWorkflowPlan(concave(),report.plan)).not.toThrow();
  });

  it('含建筑场地：分区、桌椅与通道都不进入建筑足迹，可用面积如实扣减',async()=>{
    const building=rect(25,25,45,45),base=venue();
    base.buildings=[{id:'b1',name:'既有建筑',points:building}];
    const report=await draft(base);
    expect(report.site.placeableAreaM2).toBeLessThan(4800);
    for(const zone of report.plan.zones)expect(planRingsOverlap(zone.polygon,building)).toBe(false);
    for(const facility of report.plan.facilities)expect(outdoorRingsOverlap(facilityFootprintRing(facility),building)).toBe(false);
    for(const route of report.plan.routes)
      expect(outdoorCorridorStrips(route.points,route.widthM??3).some(strip=>outdoorRingsOverlap(strip,building))).toBe(false);
    expect(report.checks).toMatchObject({status:'ready',obstacles:0,boundary:0,collisions:0,corridors:0});
    expect(report.checks.ceremonySeats).toBe(60);
    // 建筑背后那一块仍要能沿中轴进人：主通道不能从坐席里斜着穿过去。
    const main=report.plan.routes.find(route=>route.name==='婚礼·宾客主通道')!;
    const last=main.points.at(-1)!,before=main.points.at(-2)!;
    expect(Math.abs(last.x-before.x)).toBeLessThan(0.3);
    expect(()=>sitePlanDataSchema.parse(report.plan)).not.toThrow();
  });

  it('狭小场地：按完整桌椅组落位，容量不足写差额而不是缩小目标',async()=>{
    const report=await draft(venue(22));
    const tables=report.plan.facilities.filter(f=>f.allocationKey?.includes(':banquet-table:'));
    const chairs=report.plan.facilities.filter(f=>f.allocationKey?.includes(':banquet-chair:'));
    expect(tables.length).toBeGreaterThan(0);
    // 每张桌都带座椅，且座椅都归属某张已落位的桌；不存在落单桌椅。
    const tableNos=new Set(tables.map(t=>Number(t.allocationKey!.split(':').at(-1))));
    for(const chair of chairs)expect(tableNos.has(Number(chair.allocationKey!.split(':').at(-2)))).toBe(true);
    expect(chairs.length).toBe(tables.length*10);
    expect(report.candidates.find(candidate=>candidate.id===report.recommendedId)!.metrics.tableGroupIntegrity).toBe(1);
    expect(report.notes.join(' ')).toContain('差');
    expect(report.checks.target).toBe(60);
    // 小场地里的迎宾与后勤同样要能落地：不为了画通道把整个迎宾带吃掉。
    const placedOf=(role:string)=>report.quantities.find(item=>item.role===role)?.placed??0;
    expect(placedOf('签到桌')).toBe(1);
    expect(placedOf('迎宾指示牌')).toBe(2);
    expect(placedOf('后勤备物桌')).toBe(2);

    // 更小的场地一桌也放不下：报 0 桌、整组率 0，人数目标仍是 60，不能把「没摆桌」写成合格。
    const smaller=await draft(venue(16));
    expect(smaller.plan.facilities.filter(f=>f.allocationKey?.includes(':banquet-table:'))).toHaveLength(0);
    expect(smaller.candidates.find(candidate=>candidate.id===smaller.recommendedId)!.metrics.tableGroupIntegrity).toBe(0);
    expect(smaller.checks.target).toBe(60);
    expect(smaller.notes.join(' ')).toContain('差');
  });

  it('阻断带把场地切成两半：没接上通道的分区如实列出，不假装连通也不删分区',async()=>{
    const base=venue();
    // 全宽阻断带：南北两块只能靠一条不存在的路过去，主通道无法生成。
    const report=await draft(base,{hardBlocks:[rect(0,30,70,34)]});
    expect(report.plan.zones.some(zone=>zone.name==='仪式观礼区')).toBe(true);
    expect(report.reachability.connected).toBe(false);
    expect(report.reachability.zonesWithoutRoute).toContain('仪式观礼区');
    expect(report.reachability.entranceToCeremonyM).toBeNull();
    expect(report.notes.join(' ')).toContain('没有任何通道贴边');
    expect(report.notes.join(' ')).toContain('现场可达性仍未核对');
    expect(report.checks.access).toBe('pending');
    expect(report.checks.safety).toBe('unverified');
    expect(report.diff.unchanged).toBe(false);
  });

  it('入口关系：已核验北门决定纵深方向，未核验节点不被当成已知入口',async()=>{
    const base=venue();
    const node={id:crypto.randomUUID(),kind:'entry' as const,name:'北门',position:{x:35,y:69},verification:'user-confirmed' as const,notes:''};
    base.nodes=[node];
    const report=await draft(base);
    expect(report.site.entrance).toMatchObject({confirmed:true,source:'node',name:'北门'});
    expect(report.site.approachDirection).toBe('south');
    const ceremony=report.plan.zones.find(zone=>zone.name==='仪式观礼区')!;
    const banquet=report.plan.zones.find(zone=>zone.name==='宴席区')!;
    const centerY=(ring:typeof ceremony.polygon)=>ring.reduce((sum,point)=>sum+point.y,0)/ring.length;
    expect(centerY(ceremony.polygon)).toBeLessThan(centerY(banquet.polygon));
    const main=report.plan.routes.find(route=>route.name==='婚礼·宾客主通道')!;
    expect(main.startNodeId).toBe(node.id);

    const unverified=venue();
    const {verification:_ignored,...plain}=node;
    void _ignored;
    unverified.nodes=[{...plain,id:crypto.randomUUID()}];
    const fallback=await draft(unverified);
    expect(fallback.site.entrance.confirmed).toBe(false);
    expect(fallback.notes.join(' ')).toContain('未核验');
    expect(fallback.plan.nodes).toEqual(unverified.nodes);
  });

  it('景观依据：有方向时焦点与观礼朝向跟随，无依据时不写成观景理由',async()=>{
    const base=venue();
    const report=await draft(base,{landscape:{direction:'east',evidence:'user-confirmed'}});
    expect(report.site.landscape).toMatchObject({applied:true,direction:'east',evidence:'user-confirmed'});
    expect(report.site.focusDirection).toBe('east');
    const arch=report.plan.facilities.find(f=>f.name==='仪式背景 1')!;
    const chairs=report.plan.facilities.filter(f=>f.name.startsWith('观礼椅'));
    expect(chairs.length).toBe(60);
    expect(chairs.every(chair=>chair.position.x<arch.position.x)).toBe(true);
    for(const chair of chairs){
      const angle=chair.rotationDeg*Math.PI/180,dx=arch.position.x-chair.position.x,dy=arch.position.y-chair.position.y;
      expect((-Math.sin(angle)*dx+Math.cos(angle)*dy)/Math.hypot(dx,dy)).toBeCloseTo(1);
    }
    expect(report.recommendation.reasons.join(' ')).toContain('景观依据');
    // 景观与入口不同轴时，主通道先沿入口轴再横切进中轴：两段都是直走廊，不把宴席斜着劈开。
    const main=report.plan.routes.find(route=>route.name==='婚礼·宾客主通道')!;
    expect(main.points.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(main.points[1]!.x-main.points[0]!.x)).toBeLessThan(0.3);
    expect(Math.abs(main.points.at(-1)!.y-main.points.at(-2)!.y)).toBeLessThan(0.3);

    // 斜向景观只取与入口轴垂直的分量，并把「未做 45° 斜排」写进依据。
    const diagonal=await draft(base,{landscape:{direction:'northeast',evidence:'user-confirmed'}});
    expect(diagonal.site.landscape).toMatchObject({applied:true,direction:'east'});
    expect(diagonal.site.focusDirection).toBe('east');
    expect(diagonal.site.landscape.note).toContain('东北');
    expect(diagonal.site.landscape.note).toContain('45°');

    const unknown=await draft(base);
    expect(unknown.site.landscape.applied).toBe(false);
    expect(unknown.site.landscape.requested).toBe(false);
    expect(unknown.site.focusDirection).toBe(unknown.site.approachDirection);
    expect(unknown.recommendation.reasons.join(' ')).toContain('没有依据');

    const opposite=await draft(base,{landscape:{direction:'south',evidence:'user-confirmed'}});
    expect(opposite.site.landscape).toMatchObject({applied:false,requested:true,direction:null});
    expect(opposite.site.landscape.note).toContain('相反');
    // 给了方向却没采用，不能写成「没有依据」：理由要说清楚是冲突，并要求确认优先关系。
    expect(opposite.recommendation.reasons.join(' ')).toContain('相反');
    expect(opposite.recommendation.reasons.join(' ')).toContain('优先关系');
    expect(opposite.recommendation.reasons.join(' ')).not.toContain('没有依据');
  });

  it('两版候选给出可核对的面积取舍，推荐结果与实际采用方案一致',async()=>{
    const report=await draft(venue());
    expect(report.candidates).toHaveLength(2);
    const [a,b]=report.candidates;
    expect(a.id).not.toBe(b.id);
    expect(a.metrics.ceremonyZoneM2).not.toBe(b.metrics.ceremonyZoneM2);
    expect(a.metrics.ceremonyZoneM2+b.metrics.banquetZoneM2).toBeGreaterThan(0);
    expect(report.recommendedId).toBe(report.recommendation.candidateId);
    const adopted=report.candidates.find(candidate=>candidate.id===report.recommendedId)!;
    expect(adopted.plan).toEqual(report.plan);
    expect(report.recommendation.reasons.length).toBeGreaterThanOrEqual(3);
    expect(report.recommendation.reasons.join(' ')).toContain('硬冲突 0 处');
    expect(report.recommendation.reasons.join(' ')).toMatch(/仪式区 \d+ ㎡ 对 \d+ ㎡/);
    // 草案内部连通性只证明这版自己把通道接上了，不能冒充现场可达与安全。
    expect(report.reachability.connected).toBe(true);
    expect(report.reachability.zonesWithoutRoute).toHaveLength(0);
    expect(report.reachability.entranceToCeremonyM).toBeGreaterThan(10);
    expect(report.checks.access).toBe('pending');
    expect(report.checks.safety).toBe('unverified');
    expect(report.notes.join(' ')).toContain('草案内部动线自检');
    expect(report.notes.join(' ')).toContain('不等于现场出入口可通行');
    expect(report.diff.facilities.added).toBe(report.plan.facilities.length);
    expect(report.diff.unchanged).toBe(false);
  });

  it('两版平手时按调用方指定的首选采用，比较视图才能真的拿到两版不同平面',async()=>{
    const ceremony=await draft(venue(),{strategy:'ceremony-first'});
    const banquet=await draft(venue(),{strategy:'banquet-first'});
    expect(ceremony.recommendedId).toBe('ceremony-first');
    expect(banquet.recommendedId).toBe('banquet-first');
    expect(ceremony.plan).not.toEqual(banquet.plan);
    const picked=banquet.candidates.find(candidate=>candidate.id==='banquet-first')!;
    expect(picked.plan).toEqual(banquet.plan);
    expect(picked.metrics.ceremonyZoneM2)
      .toBeLessThan(ceremony.candidates.find(candidate=>candidate.id==='ceremony-first')!.metrics.ceremonyZoneM2);
  });

  it('既有硬冲突先报告并标为待调整，不被容量或推荐分抵消',async()=>{
    const base=venue();
    base.facilities=[
      {id:crypto.randomUUID(),templateId:'old-a',name:'旧物件 A',position:{x:10,y:59},rotationDeg:0,size:{width:2,depth:2},notes:''},
      {id:crypto.randomUUID(),templateId:'old-b',name:'旧物件 B',position:{x:10.4,y:59},rotationDeg:0,size:{width:2,depth:2},notes:''},
    ];
    const report=await draft(base);
    expect(report.checks.collisions).toBeGreaterThan(0);
    expect(report.checks.status).toBe('needs-adjustment');
    expect(report.checks.hardConflicts).toBe(report.checks.collisions);
    expect(report.plan.facilities.filter(f=>f.templateId.startsWith('old-')).length).toBe(2);
    expect(report.notes.join(' ')).toContain('存在硬冲突');
    expect(report.notes.join(' ')).toContain('不能直接采用');
  });

  it('锁定件所在分区整块保留，重排只动其余婚礼分区',async()=>{
    const plan=venue();
    const zone={id:crypto.randomUUID(),name:'仪式区',purpose:'audience' as const,semantic:'audience' as const,environment:'outdoor' as const,polygon:rect(2,50,30,68),notes:''};
    const locked={id:crypto.randomUUID(),templateId:'locked-arch',name:'锁定背景',zoneId:zone.id,position:{x:16,y:66},rotationDeg:0,size:{width:4,depth:1},notes:'用户锁定'};
    plan.zones=[zone];plan.facilities=[locked];
    const report=await draft(plan,{optimize:true,lockedFacilityIds:[locked.id]});
    const kept=report.plan.facilities.find(f=>f.id===locked.id)!;
    expect(kept).toMatchObject({position:{x:16,y:66},rotationDeg:0,zoneId:zone.id,size:{width:4,depth:1}});
    expect(report.plan.zones.some(z=>z.id===zone.id)).toBe(true);
    expect(report.plan.zones.filter(z=>z.name==='仪式观礼区')).toHaveLength(0);
    expect(report.diff.facilities.kept).toBeGreaterThanOrEqual(1);
    expect(report.notes.join(' ')).toContain('没有移动');
  });
});
