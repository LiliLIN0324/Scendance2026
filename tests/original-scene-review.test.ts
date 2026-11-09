import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,outsider,session,studio,scene,chair} from './fixtures';
import {sceneHash} from '../supabase/functions/_shared/domain';
import {prepareOriginalSceneReview} from '../supabase/functions/_shared/original-scene-review';

describe('isolated authorized original-scene review RPC',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);
 afterAll(async()=>{await f?.db.close();});
 async function setup(){
  const original=scene();original.objects=[chair('旧原始备注，不作为验收结论')];
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'原始场景事务',scene:original});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const candidate=structuredClone(original);candidate.objects[0]!.position.x+=1;
  const baseHash=await sceneHash(original),candidateHash=await sceneHash(candidate);
  const data={id:crypto.randomUUID(),projectId:project.id,sessionId:session,generation:lease.generation,expectedRevision:0,baseScene:original,baseHash,candidate,candidateHash};
  return {original,project,lease,candidate,data};
 }
 it('requires member ownership and leaves the original untouched until exact reviewed hash is committed',async()=>{
  const {original,project,candidate,data}=await setup(),rpc=f.backend.originalSceneReview!;
  const created=await rpc(owner,'create',data);expect(created.reused).toBe(false);expect((await rpc(owner,'create',data)).reused).toBe(true);
  await expect(rpc(outsider,'get',{projectId:project.id,id:data.id})).rejects.toThrow('ORIGINAL_REVIEW_NOT_FOUND');
  await expect(rpc(owner,'apply',{...data,candidateHash:'incorrect'})).rejects.toThrow('ORIGINAL_REVIEW_STALE');
  expect((await f.rpc(owner,'projects.get',{projectId:project.id})).scene).toEqual(original);
  const applied=await rpc(owner,'apply',data);expect(applied.scene).toEqual(candidate);expect(applied.scene.objects[0].notes).toBe(original.objects[0]!.notes);
  await expect(rpc(owner,'apply',data)).rejects.toThrow();
  const reviewed=await rpc(owner,'get',{projectId:project.id,id:data.id});expect(reviewed.applied_revision).toBe(1);
 });
 it('rejects a changed original even if the project revision was not incremented',async()=>{
  const {project,data}=await setup(),rpc=f.backend.originalSceneReview!;await rpc(owner,'create',data);
  await f.db.query("update scene_private.projects set scene=jsonb_set(scene,'{objects,0,notes}',to_jsonb('另一页面的原始备注'::text)) where id=$1",[project.id]);
  await expect(rpc(owner,'apply',data)).rejects.toThrow('ORIGINAL_REVIEW_STALE');
  expect((await f.rpc(owner,'projects.get',{projectId:project.id})).scene.objects[0].notes).toBe('另一页面的原始备注');
 });
 it('rolls back both scene and review marker when the containing transaction fails',async()=>{
  const {original,project,data}=await setup(),rpc=f.backend.originalSceneReview!;await rpc(owner,'create',data);
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.query('select public.original_scene_review_rpc($1,$2,$3::jsonb)',[owner,'apply',JSON.stringify(data)]);throw new Error('interrupt');})).rejects.toThrow('interrupt');
  expect((await f.rpc(owner,'projects.get',{projectId:project.id})).scene).toEqual(original);
  expect((await rpc(owner,'get',{projectId:project.id,id:data.id})).applied_at).toBeNull();
  expect((await rpc(owner,'apply',data)).revision).toBe(1);
 });
 it('denies direct invocation by authenticated database clients',async()=>{
  const {data}=await setup();
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select public.original_scene_review_rpc($1,$2,$3::jsonb)',[owner,'create',JSON.stringify(data)]);})).rejects.toThrow(/permission denied/i);
 });
 it('generates a neutral geometry diff while refusing hidden notes or design changes',async()=>{
  const {original,candidate}=await setup();const review=prepareOriginalSceneReview(original,candidate);
  expect(review.changes).toContainEqual({path:`/objects/by-id/${original.objects[0]!.id}/position/x`,before:{present:true,value:original.objects[0]!.position.x},after:{present:true,value:candidate.objects[0]!.position.x}});
  expect(JSON.stringify(review.changes)).not.toContain('旧原始备注');expect(review.candidate.objects[0]!.notes).toBe(original.objects[0]!.notes);
  const missing=structuredClone(candidate);missing.objects[0]!.notes='';expect(()=>prepareOriginalSceneReview(original,missing)).toThrow('ORIGINAL_REVIEW_HIDDEN_FIELD_CHANGED');
  const raw={...original,schemaVersion:2 as const,structure:{walls:[],columns:[],openings:[]},sources:[],dimensions:[],design:{concept:'消防部门已经批准',palette:[],highlights:[],requirements:[]}};
  const altered=structuredClone(raw);altered.design.concept='其他原文';expect(()=>prepareOriginalSceneReview(raw,altered)).toThrow('ORIGINAL_REVIEW_HIDDEN_FIELD_CHANGED');
  const resized=structuredClone(raw);resized.venue.width=20;expect(()=>prepareOriginalSceneReview(raw,resized)).toThrow('ORIGINAL_REVIEW_STRUCTURE_CHANGED');
  const locked=structuredClone(original);locked.objects[0]!.locked=true;const moved=structuredClone(locked);moved.objects[0]!.position.x+=1;
  expect(()=>prepareOriginalSceneReview(locked,moved)).toThrow('ORIGINAL_REVIEW_LOCKED_OBJECT_CHANGED');
 });
 it('lists each added and removed object by identity and rejects oversized reviews',()=>{
  const base=scene();base.objects=[chair(),chair()];
  const candidate=structuredClone(base);candidate.objects.shift();const added={...chair(),position:{x:6,z:6}};candidate.objects.push(added);
  const diff=prepareOriginalSceneReview(base,candidate).changes;
  expect(diff).toContainEqual({path:`/objects/by-id/${base.objects[0]!.id}/id`,before:{present:true,value:base.objects[0]!.id},after:{present:false}});
  expect(diff).toContainEqual({path:`/objects/by-id/${added.id}/materialId`,before:{present:false},after:{present:true,value:'chair'}});
  const empty={...scene(),schemaVersion:2 as const,structure:{walls:[],columns:[],openings:[]},sources:[],dimensions:[]};
  const large={...empty,objects:Array.from({length:50},(_,index)=>({...chair(),position:{x:.5+index%10,z:.5+Math.floor(index/10)}}))};
  expect(()=>prepareOriginalSceneReview(empty,large)).toThrow('ORIGINAL_REVIEW_DIFF_TOO_LARGE');
  const reordered=structuredClone(base);reordered.objects.reverse();expect(()=>prepareOriginalSceneReview(base,reordered)).toThrow('ORIGINAL_REVIEW_OBJECT_ORDER_CHANGED');
 });
 it('preserves omitted legacy defaults and original spelling for one strictly bounded move',()=>{
  const first={...chair(),color:'#ABCDEF'}, {notes:_missing,...legacyFirst}=first;
  const second={...chair('需要保留的原始备注'),position:{x:7,z:6}};
  const raw={...scene(),objects:[legacyFirst,second]},candidate=structuredClone(raw);candidate.objects[0]!.position.x=4;
  const review=prepareOriginalSceneReview(raw,candidate);
  expect(review.candidate).toEqual(candidate);expect(review.candidate.objects[0]).not.toHaveProperty('notes');
  expect(review.candidate.objects[0]!.color).toBe('#ABCDEF');expect(review.candidate.objects[1]!.notes).toBe('需要保留的原始备注');
  expect(review.changes).toEqual([{path:`/objects/by-id/${first.id}/position/x`,before:{present:true,value:3},after:{present:true,value:4}}]);
  const normalized=structuredClone(candidate) as typeof candidate & {objects:Array<Record<string,unknown>>};normalized.objects[0]!.notes='';
  expect(()=>prepareOriginalSceneReview(raw,normalized)).toThrow('ORIGINAL_REVIEW_INVALID_SCENE');
  const changedNote=structuredClone(candidate);(changedNote.objects[1]! as typeof second).notes='被删除';expect(()=>prepareOriginalSceneReview(raw,changedNote)).toThrow('ORIGINAL_REVIEW_INVALID_SCENE');
  const changedOther=structuredClone(candidate);changedOther.objects[1]!.position.x=6;expect(()=>prepareOriginalSceneReview(raw,changedOther)).toThrow('ORIGINAL_REVIEW_INVALID_SCENE');
  const overlapping=structuredClone(raw);overlapping.objects[0]!.position={...second.position};expect(()=>prepareOriginalSceneReview(raw,overlapping)).toThrow('ORIGINAL_REVIEW_GEOMETRY_CONFLICT');
 });
 it('refuses a new furniture overlap in a normalized authorized scene',()=>{
  const first=chair(),second={...chair(),position:{x:7,z:6}},base={...scene(),objects:[first,second]};
  const candidate=structuredClone(base);candidate.objects[0]!.position={...second.position};
  expect(()=>prepareOriginalSceneReview(base,candidate)).toThrow('ORIGINAL_REVIEW_GEOMETRY_CONFLICT');
 });
});
