import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {sceneHash,sceneSchema} from '../supabase/functions/_shared/domain.ts';
import {chair,database,owner,scene,session,studio} from './fixtures.ts';

describe('proposal doorway apply guard',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 it('rejects an old stored proposal that newly occupies a confirmed opening',async()=>{
  const wallId=crypto.randomUUID(),doorId=crypto.randomUUID();
  const base=sceneSchema.parse({...scene(),schemaVersion:2,structure:{walls:[{id:wallId,start:{x:0,z:4},end:{x:12,z:4},thickness:0.2,height:3,kind:'interior',status:'confirmed'}],openings:[{id:doorId,wallId,kind:'door',offset:0,width:1.2,height:2.1,sillHeight:0,status:'confirmed'}],columns:[]},sources:[],dimensions:[]});
  const candidate=sceneSchema.parse({...base,objects:[{...chair(),position:{x:0.6,z:4}}]});
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Doorway test',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});const proposalId=crypto.randomUUID();
  await f.db.query("insert into scene_private.proposals(id,project_id,user_id,session_id,generation,base_revision,local_revision,base_hash,base_scene,candidate,explanation,warnings) values($1,$2,$3,$4,$5,0,0,$6,$7::jsonb,$8::jsonb,'preview','[]')",[proposalId,project.id,owner,session,lease.generation,await sceneHash(base),JSON.stringify(base),JSON.stringify(candidate)]);
  const api=createApi(f.backend,()=>undefined);
  const result=await api(new Request(`https://api.test/projects/${project.id}/proposals/apply`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,currentScene:base,proposalId})}));
  expect(result.status).toBe(422);expect((await result.json()).error.code).toBe('DOORWAY_BLOCKED');
  const stored=await f.rpc(owner,'projects.get',{projectId:project.id});expect(stored.revision).toBe(0);expect(stored.scene).toEqual(base);
 });
});
