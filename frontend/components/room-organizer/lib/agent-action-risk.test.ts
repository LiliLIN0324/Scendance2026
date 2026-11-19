import { expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { createStarterOutdoorPlan } from './outdoor-project-store';
import { layoutActionRisk, lockedLayoutChange, outdoorActionRisk } from './agent-action-risk';
import { gateAction } from './agent-supervision';

it('室内增量移动是普通修改，删除/资产替换/结构修改是覆盖，不依赖模型动作标签',()=>{
  const base=makeLayout({floors:[makeFloor({id:'f',name:'场地',height:3,items:[makeItem({id:'chair',locked:false})]})]});
  const next=structuredClone(base);next.floors[0].items[0].position={x:2,z:3};
  expect(layoutActionRisk(base,next)).toMatchObject({kind:'write',affectedCount:1});
  next.floors[0].items[0].assetId='replacement';expect(layoutActionRisk(base,next).kind).toBe('destructive');
  next.floors[0].items=[];expect(layoutActionRisk(base,next).kind).toBe('destructive');
  expect(layoutActionRisk(base,{...base,width:base.width+1}).kind).toBe('destructive');
});

it('户外人员、车辆、注记和物料同样参与影响量与删除风险判断',()=>{
  const base=createStarterOutdoorPlan();
  base.annotations=[{id:crypto.randomUUID(),kind:'note',name:'已标注入口',points:[{x:1,y:1}],text:'待核对',notes:''}];
  expect(outdoorActionRisk(base,{...base,annotations:[]})).toMatchObject({kind:'destructive',affectedCount:1});
  const next=structuredClone(base);next.annotations![0].text='改备注';
  expect(outdoorActionRisk(base,next)).toMatchObject({kind:'write',affectedCount:1});
});

it('大范围由实际候选统计，新增101件不会被模型自称的小改动放行',()=>{
  const base=makeLayout(),next=structuredClone(base);
  next.floors[0].items=Array.from({length:101},(_,index)=>makeItem({id:`new-${index}`}));
  expect(gateAction('key-points',layoutActionRisk(base,next)).required).toBe(true);
});

it('自动档同样不能修改锁定物件，更新加载URL不算修改锁定几何',()=>{
  const base=makeLayout({floors:[makeFloor({id:'f',name:'场地',height:3,items:[makeItem({id:'locked',locked:true})]})]});
  const next=structuredClone(base);next.floors[0].items[0].position={x:3,z:2};
  expect(lockedLayoutChange(base,next)).toContain('已锁定');
  const refreshed=structuredClone(base);refreshed.floors[0].items[0].glbUrl='https://example.test/refreshed.glb';
  expect(lockedLayoutChange(base,refreshed)).toBeNull();
});
