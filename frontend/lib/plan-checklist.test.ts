import { describe, expect, it } from 'vitest';
import { buildPlanChecklist } from './plan-checklist';
import type { PlanAnnotation } from './plan-annotation';

const zone=(id:string,zoneType:PlanAnnotation['zoneType'],x=0):PlanAnnotation=>({id,kind:'zone',label:id,stageNo:1,zoneType,geometry:{kind:'rect',x,z:0,width:2,depth:2}} as PlanAnnotation);
describe('traceable plan checklist',()=>{
 it('records missing dimensions, door, human factors, zone pairs and every uncovered safety area',()=>{
  const checks=buildPlanChecklist({placements:[],annotations:[]});
  expect(new Set(checks.map(c=>c.id)).size).toBe(checks.length);
  for(const id of ['room-size','door','checkin-queue','boundary-reachability','pair:checkin:roundtable','pair:roundtable:rest','pair:photo:rest','egress','fire','accessibility','occupancy']){
   expect(checks.find(c=>c.id===id)).toMatchObject({status:'unknown'});
  }
  expect(checks.find(c=>c.id==='chair-gap')?.status).toBe('not_applicable');
  expect(checks.every(c=>c.applicability&&c.ruleScope&&Array.isArray(c.evidence))).toBe(true);
  expect(checks.some(c=>c.status==='pass')).toBe(false);
 });
 it('distinguishes a confirmed no-checkin from an unconfirmed need and an incomplete checkin zone',()=>{
  expect(buildPlanChecklist({placements:[],annotations:[],checkinRequired:false}).find(c=>c.id==='checkin-queue')?.status).toBe('not_applicable');
  const item=buildPlanChecklist({placements:[],annotations:[zone('c','checkin')],checkinRequired:false}).find(c=>c.id==='checkin-queue');
  expect(item?.status).toBe('unknown');expect(item?.applicability).toContain('未找到签到台');
 });
 it('keeps region pair sampling unknown, including unavailable sample points',()=>{
  const checks=buildPlanChecklist({placements:[],annotations:[zone('a','checkin'),zone('b','roundtable',50)],roomSize:{width:10,height:10}});
  const pair=checks.find(c=>c.id==='pair:checkin:roundtable');
  expect(pair?.status).toBe('unknown');expect(pair?.applicability).toContain('采样点不可用');
 });
 it('never treats a drawn door or numeric room size as confirmed safety',()=>{
  const door:PlanAnnotation={id:'d',kind:'door',label:'门',stageNo:1,geometry:{kind:'door',wall:'south',position:0,widthM:1.2}};
  const checks=buildPlanChecklist({placements:[],annotations:[door],roomSize:{width:12,height:9}});
  expect(checks.find(c=>c.id==='door')).toMatchObject({status:'unknown',evidence:['门标注 d']});
  expect(checks.find(c=>c.id==='room-size')?.status).toBe('unknown');
 });
 it('records a provable candidate collision without claiming that other placements are clear',()=>{
  const spec={type:'bench',name:'长椅',width:1,depth:.5,height:.5,color:'#4A7C59',icon:'x',category:'seating'};
  const p={spec,x:0,z:0,rotation:0,zoneId:'a',zoneType:'rest'};
  const checks=buildPlanChecklist({placements:[p,p] as never,annotations:[]});
  expect(checks.find(c=>c.id==='coincident-centres')).toMatchObject({status:'violated',evidence:[expect.stringContaining('中心重合')]});
  expect(buildPlanChecklist({placements:[p] as never,annotations:[]}).find(c=>c.id==='coincident-centres')?.status).toBe('unknown');
 });
});
