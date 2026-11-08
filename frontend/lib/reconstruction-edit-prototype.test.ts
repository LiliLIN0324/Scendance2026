import {describe,expect,it} from 'vitest';
import {scene} from '../../tests/fixtures';
import {backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene} from '../components/room-organizer/lib/backend-adapter';
import {prepareReviewEdit} from './reconstruction-edit-prototype';

function actualScene(){const value=layoutToBackendScene(createMeasuredRoomLayout(backendSceneToLayout(scene()),{width:12,depth:10,height:3}));if(value.schemaVersion!==2)throw new Error('expected v2');return JSON.parse(JSON.stringify(value)) as typeof value;}
describe('隔离重建修改准备',()=>{
 it('validates real V2 and invalidates old geometry and dimension confirmations',()=>{
  const before=actualScene(),after=structuredClone(before);after.structure.walls[0]!.thickness=0.3;
  const result=prepareReviewEdit(before,after);
  expect(result.candidate.structure.walls.every(w=>w.status==='inferred')).toBe(true);
  expect(result.candidate.dimensions.every(d=>d.status==='inferred')).toBe(true);
  expect(result.differences).toContainEqual({path:'/structure/walls/0/thickness',label:'场地结构 · 墙段 · 第 1 项 · 厚度',before:{exists:true,value:before.structure.walls[0]!.thickness},after:{exists:true,value:0.3}});
  expect(JSON.parse(JSON.stringify(result.differences))).toEqual(result.differences);
 });
 it('rejects incomplete, malformed, non-finite and source-swapped data',()=>{
  const before=actualScene(),after=structuredClone(before);after.structure.walls[0]!.end.x=NaN;
  expect(()=>prepareReviewEdit(before,after)).toThrow();
  const broken=structuredClone(before);broken.structure.walls.push(broken.structure.walls[0]!);
  expect(()=>prepareReviewEdit(before,broken)).toThrow();
  const swapped=structuredClone(before);swapped.sources.push({assetId:crypto.randomUUID(),kind:'photo',name:'现场.png',width:100,height:100});
  expect(()=>prepareReviewEdit(before,swapped)).toThrow('来源图片不可');
  expect(()=>prepareReviewEdit(before,{...before,lighting:undefined})).toThrow();
 });
});
