import {describe,expect,it} from 'vitest';
import {sceneSchema,type SceneV2} from '../../../../supabase/functions/_shared/domain';
import {layoutReducer} from '../hooks/layout-reducer';
import {backendSceneToLayout,layoutToBackendScene} from './backend-adapter';
import {deliveryVerificationScope} from './scene-delivery';
import {parseLocalProjectBackupJson,serializeLocalProjectBackup} from '../../../lib/local-project-backup';
import {layoutGeometryScene} from './structural-layout';
const id=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function scene():SceneV2{return sceneSchema.parse({schemaVersion:2,venue:{shape:'rectangle',width:8,depth:6,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral',
 structure:{walls:[{id:id(1),start:{x:0,z:0},end:{x:0,z:6},thickness:.2,height:3,kind:'exterior',status:'confirmed'}],
 openings:[{id:id(2),wallId:id(1),kind:'door',offset:2,width:1,height:2,sillHeight:0,status:'confirmed'}],
 columns:[{id:id(3),position:{x:4,z:4},size:{width:.5,depth:.5,height:3},rotation:0,status:'confirmed'}]},sources:[],
 dimensions:[{id:id(4),kind:'distance',targetId:id(2),measure:'width',valueMeters:1,status:'confirmed',label:'门宽'}]}) as SceneV2;}
describe('structural marker evidence',()=>{
 it('refuses unlocked door width or position and column position on the common reducer boundary',()=>{
  const layout=backendSceneToLayout(scene());let state={layout,activeFloorIndex:0};
  state=layoutReducer(state,{type:'setLocked',id:id(2),locked:false});
  for(const action of [{type:'resizeItem' as const,id:id(2),dimension:'width' as const,value:1.5},
    {type:'moveItem' as const,id:id(2),x:-4,z:.5},{type:'updateItem' as const,id:id(2),patch:{width:1.5}},
    {type:'removeItem' as const,id:id(2)},{type:'duplicateItem' as const,sourceId:id(2),newId:id(9)}])expect(layoutReducer(state,action)).toBe(state);
  state=layoutReducer(state,{type:'setLocked',id:id(3),locked:false});
  expect(layoutReducer(state,{type:'moveItem',id:id(3),x:1,z:1})).toBe(state);
  expect(layoutToBackendScene(state.layout)).toMatchObject({structure:{openings:[{width:1,status:'confirmed'}]}});
 });
 it('refuses V2 floor additions, deletions and reorder even for a wall-only confirmed source',()=>{
  const input=scene();input.structure.openings=[];input.structure.columns=[];
  input.dimensions=[{id:id(4),kind:'width',valueMeters:8,status:'confirmed',label:'场地宽'}];
  const layout=backendSceneToLayout(input),state={layout,activeFloorIndex:0};
  const add={type:'addFloor' as const,floor:{id:'new-floor',floorColor:'#fff',items:[]}};
  expect(layoutReducer(state,add)).toBe(state);
  const legacyBug={...layout,floors:[...layout.floors,{id:'new-floor',name:'新楼层',floorColor:'#fff',items:[]}]};
  const corruptedState={layout:legacyBug,activeFloorIndex:1};
  expect(layoutReducer(corruptedState,{type:'removeFloor',index:0})).toBe(corruptedState);
  expect(layoutReducer(corruptedState,{type:'reorderFloor',from:0,to:1})).toBe(corruptedState);
  expect(()=>layoutToBackendScene(corruptedState.layout)).toThrow('多层');
  const restored=layoutReducer(corruptedState,{type:'applyLayout',layout});
  const output=layoutToBackendScene(restored.layout) as SceneV2;
  expect(output.structure.walls).toHaveLength(1);expect(output.dimensions[0]).toMatchObject({status:'confirmed',valueMeters:8});
  const {backendSceneV2:_scene,...withoutV2}=layout;
  const ordinary={layout:withoutV2,activeFloorIndex:0};
  expect(layoutReducer(ordinary,add).layout.floors).toHaveLength(2);
 });
 it('does not promote a drawn wall without confirmation to a confirmed fact',()=>{
  const layout=backendSceneToLayout(scene());
  layout.floors[0]!.interiorWalls!.push({id:id(10),x1:-2,z1:-1,x2:2,z2:-1});
  const geometry=layoutGeometryScene(layout);
  expect(geometry.structure.walls.find(wall=>wall.id===id(10))?.status).toBe('inferred');
  expect(geometry.structure.walls.find(wall=>wall.id===id(1))?.status).toBe('confirmed');
  const saved=layoutToBackendScene(layout) as SceneV2;
  expect(saved.structure.walls.find(wall=>wall.id===id(10))?.status).toBe('inferred');
 });
 it('rejects confirmed wall deletion and bulk clear at the reducer, while exact undo remains valid',()=>{
  const input=scene();input.structure.openings=[];input.structure.columns=[];input.dimensions=[];
  const original=backendSceneToLayout(input),state={layout:original,activeFloorIndex:0};
  expect(layoutReducer(state,{type:'removeInteriorWall',id:id(1)})).toBe(state);
  expect(layoutReducer(state,{type:'clearInteriorWalls'})).toBe(state);
  const undone=layoutReducer(state,{type:'applyLayout',layout:structuredClone(original)});
  expect((layoutToBackendScene(undone.layout) as SceneV2).structure.walls[0]!.status).toBe('confirmed');
 });
 it.each(['evidence','dimension'] as const)('rejects deletion of an inferred wall with %s',kind=>{
  const input=scene();input.structure.openings=[];input.structure.columns=[];input.dimensions=[];input.structure.walls[0]!.status='inferred';
  if(kind==='evidence'){
    input.sources=[{assetId:id(20),kind:'floorplan',name:'图纸',width:800,height:600}];
    input.structure.walls[0]!.evidence=[{sourceAssetId:id(20),start:{x:0,z:0},end:{x:0,z:1}}];
  }else input.dimensions=[{id:id(21),kind:'wall',targetId:id(1),valueMeters:6,status:'confirmed',label:'墙长'}];
  const original=backendSceneToLayout(input),state={layout:original,activeFloorIndex:0};
  expect(layoutReducer(state,{type:'removeInteriorWall',id:id(1)})).toBe(state);
 });
 it('allows deleting an ordinary inferred wall with no linked evidence',()=>{
  const input=scene();input.structure.openings=[];input.structure.columns=[];input.dimensions=[];input.structure.walls[0]!.status='inferred';
  const original=backendSceneToLayout(input),state={layout:original,activeFloorIndex:0};
  const next=layoutReducer(state,{type:'removeInteriorWall',id:id(1)});
  expect(next).not.toBe(state);expect((layoutToBackendScene(next.layout) as SceneV2).structure.walls).toHaveLength(0);
 });
 it('refuses local-only promotion of inferred walls, including through a restored backup',()=>{
  const input=scene();input.structure.walls[0]!.status='inferred';
  const source=backendSceneToLayout(input),changed=structuredClone(source);
  changed.floors[0]!.interiorWalls![0]!.status='confirmed';
  const backup=serializeLocalProjectBackup(changed,{state:'ready',scope:changed.id??'local',brief:{status:'absent'}});
  const restored=parseLocalProjectBackupJson(backup).layout;
  expect(restored.backendSceneV2!.structure.walls[0]!.status).toBe('inferred');
  expect(()=>layoutToBackendScene(restored)).toThrow('墙体确认状态与原结构记录不一致');
  expect((layoutToBackendScene(source) as SceneV2).structure.walls[0]!.status).toBe('inferred');
 });
 it.each(['start','end','thickness','height','status'] as const)('rejects confirmed wall %s changed without updating evidence',field=>{
  const original=backendSceneToLayout(scene()),changed=structuredClone(original),wall=changed.floors[0]!.interiorWalls![0]!;
  if(field==='start')wall.x1+=0.1;else if(field==='end')wall.x2+=0.1;else if(field==='thickness')wall.thickness!+=0.1;else if(field==='height')wall.height!+=0.1;else wall.status='inferred';
  expect(()=>layoutToBackendScene(changed)).toThrow('墙体已改变');
  expect((layoutToBackendScene(original) as SceneV2).structure.walls[0]!.status).toBe('confirmed');
 });
 it('rejects geometry changes to an inferred wall linked to source evidence',()=>{
  const input=scene();input.structure.openings=[];input.structure.columns=[];input.dimensions=[];
  input.structure.walls[0]!.status='inferred';input.sources=[{assetId:id(20),kind:'floorplan',name:'平面图',width:800,height:600}];
  input.structure.walls[0]!.evidence=[{sourceAssetId:id(20),start:{x:0,z:0},end:{x:0,z:1}}];
  const original=backendSceneToLayout(input),changed=structuredClone(original);
  changed.floors[0]!.interiorWalls![0]!.x1+=0.1;
  expect(()=>layoutToBackendScene(changed)).toThrow('原结构确认和图纸依据不能沿用');
  const output=layoutToBackendScene(original) as SceneV2;expect(output.structure.walls[0]!.evidence).toEqual(input.structure.walls[0]!.evidence);
 });
 it('retains inferred door and column status and rejects promotion of a new wall',()=>{
  const input=scene();input.structure.openings[0]!.status='inferred';input.structure.columns[0]!.status='inferred';input.dimensions=[];
  const layout=backendSceneToLayout(input),output=layoutToBackendScene(layout) as SceneV2;
  expect(output.structure.openings[0]!.status).toBe('inferred');expect(output.structure.columns[0]!.status).toBe('inferred');
  layout.floors[0]!.interiorWalls!.push({id:id(10),x1:-2,z1:-1,x2:2,z2:-1,status:'confirmed'});
  expect(()=>layoutToBackendScene(layout)).toThrow('墙体确认状态与原结构记录不一致');
 });
 it('blocks exporting stale raw geometry while undoing to an exact snapshot remains valid',()=>{
  const original=backendSceneToLayout(scene()),stale=structuredClone(original);
  stale.floors[0]!.items.find(item=>item.structuralOpeningId===id(2))!.width=1.5;
  expect(()=>layoutToBackendScene(stale)).toThrow('原结构确认和尺寸依据不能沿用');
  const undone=layoutReducer({layout:stale,activeFloorIndex:0},{type:'applyLayout',layout:original});
  const restored=layoutToBackendScene(undone.layout);
  expect(deliveryVerificationScope(restored).dimensions[0]).toMatchObject({valueMeters:1,recordedStatus:'confirmed'});
 });
});
