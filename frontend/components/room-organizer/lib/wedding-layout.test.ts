import { describe, expect, it } from 'vitest';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { sitePlanDataSchema } from '../../../../supabase/functions/_shared/site-plan';
import { proposeWeddingLayout } from './wedding-layout';
import { validateWorkflowPlan } from './outdoor-agent-planning';
import { outdoorCorridorStrips, outdoorRingsOverlap } from './outdoor-event-logic';
import { facilityFootprintRing } from './site-plan-facilities';
import { weddingDesignRequest } from './wedding-request';

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
  expect(weddingDesignRequest('不知道仪式区怎么规划？','婚礼',venue())).toBeNull();
  expect(weddingDesignRequest('不要重新规划婚礼','婚礼',venue())).toBeNull();
});
