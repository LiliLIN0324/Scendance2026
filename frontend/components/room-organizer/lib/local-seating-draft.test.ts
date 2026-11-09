import {describe,expect,it} from 'vitest';
import {sceneSchema,type SceneV2} from '../../../../supabase/functions/_shared/domain';
import {itemsOverlap} from './geometry';
import {planLocalDeskChairDraft,type LocalDeskChairInput} from './local-seating-draft';
import {makeFloor,makeItem,makeLayout,makeUnplacedItem} from './__testfixtures__/fixtures';

const input:LocalDeskChairInput={floorIndex:0,mode:'one_desk_one_chair',count:30,
 desk:{width:.6,depth:.45,height:.75},chair:{width:.5,depth:.5,height:.85},deskChairGap:.1,columnGap:.3,rowGap:.5,edgeClearance:.3,
 assumptions:{count:'user',deskSize:'assumption',chairSize:'assumption',deskChairGap:'assumption',columnGap:'assumption',rowGap:'assumption',edgeClearance:'assumption'}};
const ids=(prefix='item')=>{let n=0;return()=>`${prefix}-${++n}`;};

describe('local editable desk-chair draft',()=>{
 it('creates 30 independent pairs without mutating or removing existing furniture',()=>{
  const old=makeItem({id:'existing',name:'旧桌',type:'table',locked:true,position:{x:0,z:0}});
  const original=makeLayout({width:20,height:20,floors:[makeFloor({items:[old]})]}),before=structuredClone(original);
  const result=planLocalDeskChairDraft(original,input,ids());
  expect(result).toMatchObject({requested:30,placed:30,shortfall:0,limitReason:null,assumptions:input});
  expect(original).toEqual(before);expect(result.layout).not.toBe(original);expect(result.layout.floors[0]!.items).toHaveLength(61);
  expect(result.layout.floors[0]!.items[0]).toEqual(old);
  const created=result.layout.floors[0]!.items.slice(1);
  expect(created.filter(item=>item.type==='desk')).toHaveLength(30);expect(created.filter(item=>item.type==='chair')).toHaveLength(30);
  expect(new Set(created.map(item=>item.id)).size).toBe(60);
  for(let i=0;i<created.length;i++)for(let j=i+1;j<created.length;j++)expect(itemsOverlap(created[i]!,created[j]!)).toBe(false);
  expect(created.every(item=>!itemsOverlap(item,old))).toBe(true);
  expect(result.unknown).toContain('消防规范');expect(result.unknown).toContain('实物规格与可用库存');
 });
 it('retains locked and unlocked obstacles and skips positions crossing walls',()=>{
  const obstacles=[makeItem({id:'locked',locked:true,position:{x:-4,z:-4}}),makeItem({id:'unlocked',position:{x:-2,z:-4}})];
  const original=makeLayout({width:12,height:12,floors:[makeFloor({items:obstacles,interiorWalls:[{id:'wall',x1:0,z1:-6,x2:0,z2:6,thickness:.2,height:3,status:'confirmed'}]})]});
  const result=planLocalDeskChairDraft(original,{...input,count:15},ids());
  expect(result.placed).toBeGreaterThan(0);expect(result.layout.floors[0]!.items.slice(0,2)).toEqual(obstacles);
  for(const item of result.layout.floors[0]!.items.slice(2)){
   expect(obstacles.some(old=>itemsOverlap(item,old))).toBe(false);
   expect(Math.abs(item.position!.x)).toBeGreaterThanOrEqual(item.width/2+.1-1e-6);
  }
 });
 it('reports a shortage rather than claiming the requested quantity fits',()=>{
  const original=makeLayout({width:2,height:2});const result=planLocalDeskChairDraft(original,input,ids());
  expect(result.placed).toBeLessThan(30);expect(result.shortfall).toBe(30-result.placed);expect(result.limitReason).toBe('no_placement');
 });
 it('reports zero capacity when a single pair cannot fit',()=>{
  const result=planLocalDeskChairDraft(makeLayout({width:.5,height:.5}),input,ids());
  expect(result).toMatchObject({placed:0,shortfall:30,limitReason:'no_placement'});
 });
 it('enforces the local 200-object limit without removing existing items',()=>{
  const items=Array.from({length:199},(_,n)=>makeItem({id:`old-${n}`,width:.01,depth:.01,height:.1,position:{x:8+n*.001,z:8}}));
  const original=makeLayout({width:20,height:20,floors:[makeFloor({items})]});
  const result=planLocalDeskChairDraft(original,input,ids());expect(result).toMatchObject({placed:0,shortfall:30,limitReason:'object_limit'});
  expect(result.layout.floors[0]!.items).toEqual(items);
 });
 it('refuses unknown unplaced obstacles or preset geometry rather than guessing',()=>{
  const unknown=makeLayout({floors:[makeFloor({items:[makeUnplacedItem()]})]});
  expect(planLocalDeskChairDraft(unknown,input,ids()).limitReason).toBe('incomplete_geometry');
  expect(planLocalDeskChairDraft(makeLayout({scenePreset:'conference'}),input,ids()).limitReason).toBe('preset_unverified');
 });
 it('reports invalid map or polygon geometry as unknown without a candidate',()=>{
  const map=makeLayout({mapGroundPolygon:[{lng:120,lat:30},{lng:121,lat:30},{lng:120,lat:31}]});
  expect(planLocalDeskChairDraft(map,input,ids()).limitReason).toBe('incomplete_geometry');
  const invalid=makeLayout({backendVenue:{shape:'polygon',width:8,depth:8,height:3,entrances:[],polygon:[{x:0,z:0},{x:8,z:8},{x:0,z:8},{x:8,z:0}]}});
  expect(planLocalDeskChairDraft(invalid,input,ids()).limitReason).toBe('incomplete_geometry');
 });
 it('refuses invalid walls and stored structures missing from the editor floor',()=>{
  const wall=makeLayout({floors:[makeFloor({interiorWalls:[{id:'wall',x1:0,z1:0,x2:NaN,z2:2}]})]});
  expect(planLocalDeskChairDraft(wall,input,ids())).toMatchObject({placed:0,limitReason:'incomplete_geometry'});
  const stored=sceneSchema.parse({schemaVersion:2,venue:{shape:'rectangle',width:8,depth:8,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral',structure:{walls:[{id:'00000000-0000-4000-8000-000000000001',start:{x:4,z:0},end:{x:4,z:8},thickness:.2,height:3,kind:'interior',status:'confirmed'}],openings:[],columns:[]},sources:[],dimensions:[]}) as SceneV2;
  const missing=makeLayout({backendSceneV2:stored,backendVenue:stored.venue});
  expect(planLocalDeskChairDraft(missing,input,ids())).toMatchObject({placed:0,limitReason:'incomplete_geometry'});
 });
 it('checks each pair against a concave polygon, not its enclosing rectangle',()=>{
  const layout=makeLayout({width:20,height:20,backendVenue:{shape:'polygon',width:20,depth:20,height:3,entrances:[],polygon:[{x:0,z:0},{x:20,z:0},{x:20,z:7},{x:8,z:7},{x:8,z:20},{x:0,z:20}]}});
  const result=planLocalDeskChairDraft(layout,{...input,count:60},ids());expect(result.placed).toBeGreaterThan(0);
  for(const item of result.layout.floors[0]!.items){
   const east=item.position!.x+10+item.width/2,south=item.position!.z+10+item.depth/2;
   expect(east<=8+1e-6||south<=7+1e-6).toBe(true);
  }
 });
 it('limits the layout to an explicitly selected region and preserves its source',()=>{
  const region={x1:-10,z1:-10,x2:0,z2:0,source:'user' as const};
  const result=planLocalDeskChairDraft(makeLayout({width:20,height:20}),{...input,count:30,region},ids());
  expect(result.placed).toBeGreaterThan(0);expect(result.assumptions.region).toEqual(region);
  for(const item of result.layout.floors[0]!.items){
   expect(item.position!.x-item.width/2).toBeGreaterThanOrEqual(-10);
   expect(item.position!.x+item.width/2).toBeLessThanOrEqual(0);
   expect(item.position!.z-item.depth/2).toBeGreaterThanOrEqual(-10);
   expect(item.position!.z+item.depth/2).toBeLessThanOrEqual(0);
  }
 });
 it('uses injected identifiers, avoids duplicates and supports repeatable geometry',()=>{
  const layout=makeLayout({width:10,height:10,floors:[makeFloor({items:[makeItem({id:'dup',position:{x:0,z:0}})]})]});
  const makeIds=()=>{const values=['dup',...Array.from({length:60},(_,n)=>`fresh-${n}`)];return()=>values.shift()??'';};
  const first=planLocalDeskChairDraft(layout,{...input,count:3},makeIds());
  const second=planLocalDeskChairDraft(layout,{...input,count:3},makeIds());
  expect(first).toEqual(second);expect(first.layout.floors[0]!.items.slice(1).every(item=>item.id!=='dup')).toBe(true);
  expect(()=>planLocalDeskChairDraft(layout,{...input,count:1},()=> 'dup')).toThrow('无法创建不重复的物件编号');
 });
 it('does not reuse an existing wall identity for a furniture instance',()=>{
  const layout=makeLayout({width:10,height:10,floors:[makeFloor({interiorWalls:[{id:'wall',x1:0,z1:-5,x2:0,z2:5,thickness:.2,height:3,status:'confirmed'}]})]});
  const values=['wall','desk','chair'];const result=planLocalDeskChairDraft(layout,{...input,count:1},()=>values.shift()??'');
  expect(result.placed).toBe(1);expect(result.layout.floors[0]!.items.map(item=>item.id)).toEqual(['desk','chair']);
 });
 it('requires the explicit mode and source for every assumption',()=>{
  expect(()=>planLocalDeskChairDraft(makeLayout(),{...input,mode:'dining'} as unknown as LocalDeskChairInput,ids())).toThrow();
  expect(()=>planLocalDeskChairDraft(makeLayout(),{...input,assumptions:{...input.assumptions,count:undefined}} as unknown as LocalDeskChairInput,ids())).toThrow();
 });
});
