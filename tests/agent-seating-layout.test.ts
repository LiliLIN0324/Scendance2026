import {describe,expect,it} from 'vitest';
import {planDeskChairGroups,type DeskChairLayoutInput} from '../supabase/functions/_shared/agent-seating-layout.ts';
import {planSharedDesks} from '../supabase/functions/_shared/agent-shared-seating-layout.ts';
import {sceneSchema,sceneWarnings,type Scene} from '../supabase/functions/_shared/domain.ts';
import {reviewAgentCandidate} from '../supabase/functions/_shared/agent-candidate-review.ts';

const id=(n:number)=>`92000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const room=(width=20,depth=20):Scene=>sceneSchema.parse({schemaVersion:1,venue:{shape:'rectangle',width,depth,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral'});
const options:DeskChairLayoutInput={layout:'one_desk_one_chair',count:24,deskSize:{width:1.2,depth:0.6,height:0.75},chairSize:{width:0.5,depth:0.5,height:0.85},deskChairGap:0.2,columnGap:0.3,rowGap:0.5,edgeClearance:0.2};
const plan=(scene:Scene,input:DeskChairLayoutInput,run=1)=>planDeskChairGroups(scene,input,index=>`${run.toString(16).padStart(8,'0')}-0000-4000-8000-${String(index+1).padStart(12,'0')}`);

describe('deterministic desk and chair group layout',()=>{
 it('does not place a desk across a confirmed doorway opening',()=>{
  const wallId=id(200),doorId=id(201);
  const source=sceneSchema.parse({...room(12,10),schemaVersion:2,structure:{walls:[{id:wallId,start:{x:0,z:4},end:{x:12,z:4},thickness:0.2,height:3,kind:'interior',status:'confirmed'}],openings:[{id:doorId,wallId,kind:'door',offset:0,width:1.2,height:2.1,sillHeight:0,status:'confirmed'}],columns:[]},sources:[],dimensions:[]});
  const result=plan(source,{...options,count:1,edgeClearance:0,region:{x1:0,z1:3.9,x2:1.2,z2:5.2}});
  expect(result.placed).toBe(0);expect(result.shortfall).toBe(1);expect(result.scene.objects).toHaveLength(0);
 });
 it('creates 24 complete pairs, retaining the original and passing independent geometry review',()=>{
  const source=room(),before=structuredClone(source),result=plan(source,options);
  expect(source).toEqual(before);expect(result).toMatchObject({requested:24,placed:24,shortfall:0,limitReason:null});
  expect(result.scene.objects).toHaveLength(48);
  expect(result.scene.objects.filter(o=>o.materialId==='chair')).toHaveLength(24);
  expect(result.scene.objects.filter(o=>o.materialId==='table')).toHaveLength(24);
  expect(sceneWarnings(result.scene).filter(w=>w.code==='OVERLAP'||w.code==='OUT_OF_BOUNDS')).toEqual([]);
  expect(reviewAgentCandidate(source,result.scene,[],true)).toMatchObject({status:'unknown',violations:[]});
  expect(result.unknown).toEqual(expect.arrayContaining(['连续通行及疏散','消防规范','无障碍要求']));
  expect(plan(source,options)).toEqual(result);
  const other=plan(source,options,2);
  expect(other.scene.objects.map(o=>o.position)).toEqual(result.scene.objects.map(o=>o.position));
  expect(new Set([...other.scene.objects,...result.scene.objects].map(o=>o.id)).size).toBe(96);
 });
 it('reports the existing 50-object hard limit instead of silently claiming 30 pairs',()=>{
  const result=plan(room(),{...options,count:30});
  expect(result).toMatchObject({requested:30,placed:25,shortfall:5,limitReason:'object_limit'});
  expect(result.scene.objects).toHaveLength(50);expect(sceneSchema.safeParse(result.scene).success).toBe(true);
 });
 it('retains an existing obstacle, never collides with it, and counts it toward the limit',()=>{
  const existing={id:id(1),materialId:'table' as const,position:{x:0.8,z:0.5},rotation:0,size:{width:1.2,depth:0.6,height:0.75},color:'#ffffff',locked:false,notes:'原物件'};
  const source=sceneSchema.parse({...room(),objects:[existing]}),result=plan(source,{...options,count:30});
  expect(result.scene.objects[0]).toEqual(existing);expect(result.placed).toBe(24);expect(result.shortfall).toBe(6);
  expect(sceneWarnings(result.scene).filter(w=>w.code==='OVERLAP'||w.code==='OUT_OF_BOUNDS')).toEqual([]);
 });
 it('can shift the grid around a locked obstacle while preserving the old grid as a baseline',()=>{
  const obstacle={id:id(99),materialId:'table' as const,position:{x:0.8,z:0.5},rotation:0,size:{width:0.2,depth:0.2,height:0.75},color:'#ffffff',locked:true,notes:'锁定原物'};
  const source=sceneSchema.parse({...room(2.9,2),objects:[obstacle]}),input={...options,count:1};
  // The old fixed origin puts the first desk at x=.8, z=.5, overlapping the obstacle.
  const baseline={...source,objects:[obstacle,{...obstacle,id:id(100),locked:false,size:input.deskSize}]};
  expect(sceneWarnings(baseline).some(w=>w.code==='OVERLAP')).toBe(true);
  const before=structuredClone(source),result=plan(source,input);
  expect(result).toMatchObject({requested:1,placed:1,shortfall:0,limitReason:null});
  expect(source).toEqual(before);expect(result.scene.objects[0]).toEqual(obstacle);
  expect(result.scene.objects[1]!.size).toEqual(input.deskSize);expect(result.scene.objects[2]!.size).toEqual(input.chairSize);
  expect(result.scene.objects[2]!.position.z-result.scene.objects[1]!.position.z).toBeCloseTo(input.deskSize.depth/2+input.deskChairGap+input.chairSize.depth/2);
  expect(sceneWarnings(result.scene).filter(w=>w.code==='OVERLAP'||w.code==='OUT_OF_BOUNDS')).toEqual([]);
  expect(reviewAgentCandidate(source,result.scene,[],true).violations).toEqual([]);
 });
 it('does not place fewer pairs than the previous fixed-origin grid in bounded rectangular fixtures',()=>{
  const obstacle={id:id(110),materialId:'table' as const,position:{x:0.8,z:0.5},rotation:0,size:{width:0.2,depth:0.2,height:0.75},color:'#ffffff',locked:true,notes:''};
  const fixtures=[sceneSchema.parse({...room(2.9,2),objects:[obstacle]}),room(2,2),room(7,4)];
  for(const source of fixtures){
   const input={...options,count:8},baseline=structuredClone(source);
   const width=Math.max(input.deskSize.width,input.chairSize.width),depth=input.deskSize.depth+input.deskChairGap+input.chairSize.depth;
   let pairs=0;
   for(let z=input.edgeClearance;z+depth<=source.venue.depth-input.edgeClearance+1e-6&&pairs<input.count;z+=depth+input.rowGap){
    for(let x=input.edgeClearance+width/2;x+width/2<=source.venue.width-input.edgeClearance+1e-6&&pairs<input.count;x+=width+input.columnGap){
     const make=(materialId:'table'|'chair',size:typeof input.deskSize,centreZ:number,index:number)=>({id:id(300+index),materialId,position:{x,z:centreZ},rotation:0,size,color:'#ffffff',locked:false,notes:''});
     const desk=make('table',input.deskSize,z+input.deskSize.depth/2,pairs*2);
     const chair=make('chair',input.chairSize,z+input.deskSize.depth+input.deskChairGap+input.chairSize.depth/2,pairs*2+1);
     const attempt=sceneSchema.parse({...baseline,objects:[...baseline.objects,desk,chair]});
     if(sceneWarnings(attempt).some(w=>w.code==='OVERLAP'||w.code==='OUT_OF_BOUNDS'))continue;
     baseline.objects.push(desk,chair);pairs++;
    }
   }
   const result=plan(source,input);
   expect(result.placed).toBeGreaterThanOrEqual(pairs);
   expect(result.shortfall).toBe(input.count-result.placed);
   expect(result.scene.objects.slice(0,source.objects.length)).toEqual(source.objects);
   expect(sceneWarnings(result.scene).filter(w=>w.code==='OVERLAP'||w.code==='OUT_OF_BOUNDS')).toEqual([]);
  }
 });
 it('reports grid shortage without reducing the request or claiming maximum venue capacity',()=>{
  const result=plan(room(2,2),{...options,count:5});
  expect(result).toMatchObject({requested:5,placed:1,shortfall:4,limitReason:'no_placement'});
  expect(result.scene.objects).toHaveLength(2);
 });
 it('respects specified region, true polygon bounds and edge clearance',()=>{
  const source=sceneSchema.parse({...room(8,8),venue:{...room(8,8).venue,shape:'polygon',polygon:[{x:0,z:0},{x:8,z:0},{x:8,z:3},{x:3,z:3},{x:3,z:8},{x:0,z:8}]}});
  const result=plan(source,{...options,count:8,region:{x1:0,z1:0,x2:8,z2:8}});
  expect(result.placed).toBeGreaterThan(0);expect(sceneWarnings(result.scene).filter(w=>w.code==='OUT_OF_BOUNDS')).toEqual([]);
  expect(reviewAgentCandidate(source,result.scene,[],true).violations).toEqual([]);
  expect(()=>plan(source,{...options,region:{x1:0,z1:0,x2:9,z2:8}})).toThrow();
 });
 it('avoids inferred structural obstacles without claiming structure is confirmed',()=>{
  const source=sceneSchema.parse({...room(10,8),schemaVersion:2,structure:{walls:[{id:id(2),start:{x:4,z:0},end:{x:4,z:8},thickness:0.2,height:3,kind:'interior',status:'inferred'}],openings:[],columns:[]},sources:[],dimensions:[]});
  const result=plan(source,{...options,count:10});
  expect(result.placed).toBeGreaterThan(0);expect(result.unknown).toContain('场地结构来源或确认状态');
  expect(reviewAgentCandidate(source,result.scene,[],true).violations).toEqual([]);
 });
 it('does not pretend to inspect geometry hidden inside a preset',()=>{
  const source=sceneSchema.parse({...room(),scenePreset:'cafe'}),result=plan(source,{...options,count:30});
  expect(result).toMatchObject({placed:0,shortfall:30,limitReason:'preset_unverified'});expect(result.scene).toEqual(source);
 });
 it('validates the input and returns a bounded scan result',()=>{
  expect(()=>plan(room(),{...options,deskChairGap:0})).toThrow();
  const wall={id:id(5),materialId:'table' as const,position:{x:100,z:100},rotation:0,size:{width:200,depth:200,height:0.75},color:'#ffffff',locked:true,notes:''};
  const source=sceneSchema.parse({...room(200,200),objects:[wall]});
  const result=plan(source,{...options,count:30,deskSize:{width:0.02,depth:0.02,height:0.75},chairSize:{width:0.02,depth:0.02,height:0.85},columnGap:0,rowGap:0,edgeClearance:0});
  expect(result).toMatchObject({placed:0,shortfall:30,limitReason:'scan_limit'});
 });
 it.each(['single','shared'] as const)('shares the 5000-probe budget across phases and retains earlier best placement: %s',kind=>{
  const slot=kind==='single'?0.02:0.05;
  const obstacles=[
   {id:id(500),materialId:'table' as const,position:{x:(slot+1)/2,z:1},rotation:0,size:{width:1-slot,depth:2,height:0.75},color:'#ffffff',locked:true,notes:'保留'},
   {id:id(501),materialId:'table' as const,position:{x:slot/2,z:1.025},rotation:0,size:{width:slot,depth:1.95,height:0.75},color:'#ffffff',locked:true,notes:'保留'},
  ];
  const source=sceneSchema.parse({...room(1,2),objects:obstacles}),before=structuredClone(source);
  const tiny={...options,count:kind==='single'?2:4,deskSize:{width:slot,depth:0.02,height:0.75},chairSize:{width:0.02,depth:0.02,height:0.85},deskChairGap:0.01,columnGap:0,rowGap:0,edgeClearance:0};
  let calls=0;const factory=(n:number)=>{calls++;return `a1000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`;};
  if(kind==='single'){
   const result=planDeskChairGroups(source,tiny,factory);
   expect(result).toMatchObject({placed:1,shortfall:1,limitReason:'scan_limit'});
   expect(result.scene.objects.slice(0,2)).toEqual(obstacles);
   // 2000 probes in the first phase and 1960 in the second: reaching 5000
   // therefore demonstrates that the budget is shared across phase changes.
   expect(calls).toBe(10_000);
   expect(sceneWarnings(result.scene).filter(w=>w.code==='OVERLAP'||w.code==='OUT_OF_BOUNDS')).toEqual([]);
  } else {
   const {layout:_,...rest}=tiny;void _;
   const result=planSharedDesks(source,{...rest,layout:'two_people_per_desk',chairGap:0.01},factory);
   expect(result).toMatchObject({placedPeople:2,shortfall:2,limitReason:'scan_limit'});
   expect(result.scene.objects.slice(0,2)).toEqual(obstacles);
   // Two probe IDs each, plus one extra ID when the winning virtual chair
   // is expanded into two independent chairs.
   expect(calls).toBe(10_001);
   expect(sceneWarnings(result.scene).filter(w=>w.code==='OVERLAP'||w.code==='OUT_OF_BOUNDS')).toEqual([]);
  }
  expect(source).toEqual(before);
 });
 it('rejects invalid and repeated externally supplied IDs without touching the source',()=>{
  const source=room(),before=structuredClone(source);
  expect(()=>planDeskChairGroups(source,options,()=>id(1))).toThrow('SEATING_ID_COLLISION');
  expect(()=>planDeskChairGroups(source,options,()=>'<invalid>')).toThrow('SEATING_ID_INVALID');
  expect(source).toEqual(before);
 });
});
