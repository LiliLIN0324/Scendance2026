import {describe,expect,it} from 'vitest';
import {canonical,sha256} from '../../../../supabase/functions/_shared/domain';
import {originalMovableObjects,previewOriginalObjectMove,verifyOriginalMoveSnapshot} from './original-scene-local-preview';

const id='22222222-2222-4222-8222-222222222222';
function scene(){return {schemaVersion:1,venue:{width:12,depth:10,height:3,shape:'rectangle',entrances:[]},objects:[{id,materialId:'chair',position:{x:2,z:3},rotation:0,size:{width:.5,depth:.5,height:.85},color:'#ffffff',locked:false,notes:'原始备注'}],camera:'overview',lighting:'neutral'};}
describe('authorized original scene local preview',()=>{
 it('refuses a locked target, changed raw record and invalid coordinates',async()=>{
  const raw=scene(),hash=await sha256(canonical(raw));
  await expect(previewOriginalObjectMove(raw,'a'.repeat(64),id,4,3)).rejects.toThrow('原始记录已变化');
  await expect(previewOriginalObjectMove(raw,hash,id,Infinity,3)).rejects.toThrow('物件不可修改');
  raw.objects[0]!.locked=true;expect(originalMovableObjects(raw)).toEqual([]);
  await expect(previewOriginalObjectMove(raw,await sha256(canonical(raw)),id,4,3)).rejects.toThrow('物件不可修改');
 });
 it('does not silently normalize old data into an editable candidate',async()=>{
  const raw=scene();const object=raw.objects[0]!;const {notes:_removed,...withoutNotes}=object;
  const old={...raw,objects:[withoutNotes]};expect(originalMovableObjects(old)).toEqual([]);
  await expect(previewOriginalObjectMove(old,await sha256(canonical(old)),id,4,3)).rejects.toThrow('原始记录已变化');
 });
 it('rejects a changed candidate, a changed activity and a changed revision before confirmation',async()=>{
  const raw=scene(),hash=await sha256(canonical(raw)),preview=await previewOriginalObjectMove(raw,hash,id,4,3);
  const snapshotText=JSON.stringify({...preview,revision:7}),input={raw,revision:7,objectId:id,x:4,z:3,snapshotText,isCurrent:()=>true};
  expect((await verifyOriginalMoveSnapshot(input)).candidateText).toBe(preview.candidateText);
  await expect(verifyOriginalMoveSnapshot({...input,snapshotText:JSON.stringify({...preview,revision:7,candidateText:'{}'})})).rejects.toThrow('候选已变化');
  await expect(verifyOriginalMoveSnapshot({...input,isCurrent:()=>false})).rejects.toThrow('活动已变化');
  await expect(verifyOriginalMoveSnapshot({...input,revision:8})).rejects.toThrow('原始版本已变化');
 });
});
