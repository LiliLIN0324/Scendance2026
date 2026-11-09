/** Isolated feasibility experiment only: not an application RPC or production migration. */
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,outsider,session,studio,scene} from '../../tests/fixtures';
import {backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene} from '../components/room-organizer/lib/backend-adapter';
import {prepareReviewEdit} from './reconstruction-edit-prototype';

describe('unbilled edit record feasibility in isolated PostgreSQL',()=>{
 let f:Awaited<ReturnType<typeof database>>;let projectId:string;let generation:number;let parentId:string;
 const assetId='70000000-0000-4000-8000-000000000001';
 const sources=[{assetId,kind:'floorplan',name:'plan.png',width:100,height:100}];
 const measured=layoutToBackendScene(createMeasuredRoomLayout(backendSceneToLayout(scene()),{width:12,depth:10,height:3}));
 if(measured.schemaVersion!==2)throw new Error('expected V2');
 const base=JSON.parse(JSON.stringify({...measured,sources})) as typeof measured;
 const edited=structuredClone(base);edited.structure.walls[0]!.thickness=0.3;
 beforeAll(async()=>{
  f=await database();
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'隔离核对',scene:scene()});projectId=project.id;
  generation=(await f.rpc(owner,'lease.acquire',{projectId,sessionId:session})).generation;
  await f.db.query(`insert into scene_private.assets(id,owner_id,name,source,license,storage_path,format,byte_size,sha256,metadata)
   values($1,$2,'plan.png','upload','{}','prototype','png',1,$3,$4::jsonb)`,[assetId,owner,'a'.repeat(64),JSON.stringify({width:100,height:100})]);
  await f.db.query("insert into scene_private.source_images(project_id,asset_id,kind) values($1,$2,'floorplan')",[projectId,assetId]);
  parentId=crypto.randomUUID();
  await f.db.query(`insert into scene_private.reconstruction_jobs(id,project_id,owner_id,request_key,fingerprint,input,base_hash,state,candidate,reserve_cents)
    values($1,$2,$3,$4,'original',$5::jsonb,'basis','needs_review',$6::jsonb,200)`,[parentId,projectId,owner,crypto.randomUUID(),JSON.stringify({scene:scene(),sources,expectedRevision:0}),JSON.stringify(base)]);
  await f.db.exec(`create schema edit_prototype;
    create table edit_prototype.versions(id uuid primary key, project_id uuid not null references scene_private.projects,
      owner_id uuid not null references auth.users, parent_id uuid not null references scene_private.reconstruction_jobs,
      revision bigint not null, base_scene jsonb not null, parent_base_hash text not null, sources jsonb not null,
      parent_snapshot jsonb not null, candidate jsonb not null, changes jsonb not null,
      confirmed boolean not null default false, consumed_job uuid, generation_key text, generation_input jsonb);
    create function edit_prototype.version(actor uuid, action text, data jsonb) returns jsonb language plpgsql as $$
    declare p scene_private.projects; parent scene_private.reconstruction_jobs; v edit_prototype.versions; source_row jsonb;
    begin
      p:=scene_private.require_lease(actor,data);
      select * into parent from scene_private.reconstruction_jobs where id=(data->>'parentId')::uuid for update;
      if not found or parent.project_id<>p.id or parent.owner_id<>actor or parent.state<>'needs_review'
         or parent.input->'sources' is distinct from data->'sources' or parent.input->'scene' is distinct from p.scene
         or parent.input->'expectedRevision' is distinct from to_jsonb(p.revision)
         or parent.candidate is distinct from data->'parentSnapshot' then raise exception 'PARENT_CHANGED'; end if;
      for source_row in select value from jsonb_array_elements(data->'sources') loop
        perform 1 from scene_private.source_images link join scene_private.assets asset on asset.id=link.asset_id
          where link.project_id=p.id and asset.id=(source_row->>'assetId')::uuid and link.kind=source_row->>'kind'
          and asset.owner_id=actor and asset.name=source_row->>'name' and asset.metadata->'width'=source_row->'width'
          and asset.metadata->'height'=source_row->'height' for share of link,asset;
        if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
      end loop;
      if data->'candidate'->'sources' is distinct from data->'sources'
        or data->'changes' is distinct from jsonb_build_object('before',parent.candidate,'after',data->'candidate')
        then raise exception 'DIFF_CHANGED'; end if;
      if action='create' then
        insert into edit_prototype.versions(id,project_id,owner_id,parent_id,revision,base_scene,parent_base_hash,sources,parent_snapshot,candidate,changes)
          values((data->>'id')::uuid,p.id,actor,parent.id,p.revision,p.scene,parent.base_hash,data->'sources',parent.candidate,data->'candidate',data->'changes') returning * into v;
      elsif action in ('confirm','get') then
        select * into v from edit_prototype.versions where id=(data->>'id')::uuid for update;
        if not found or v.project_id<>p.id or v.owner_id<>actor or v.parent_id<>parent.id or v.revision<>p.revision
          or v.base_scene is distinct from p.scene or v.parent_base_hash is distinct from parent.base_hash
          or v.sources is distinct from data->'sources' or v.parent_snapshot is distinct from parent.candidate
          or v.candidate is distinct from data->'candidate' or v.changes is distinct from data->'changes'
          or (action='confirm' and v.confirmed) then raise exception 'VERSION_CHANGED'; end if;
        if action='confirm' then update edit_prototype.versions set confirmed=true where id=v.id returning * into v; end if;
      else raise exception 'INVALID_ACTION'; end if;
      return to_jsonb(v);
    end $$;
    create function edit_prototype.start_generation(actor uuid, data jsonb) returns jsonb language plpgsql as $$
    declare v edit_prototype.versions; job jsonb; job_input jsonb;
    begin
      perform edit_prototype.version(actor,'get',data);
      select * into v from edit_prototype.versions where id=(data->>'id')::uuid for update;
      if not v.confirmed then raise exception 'VERSION_NOT_CONFIRMED'; end if;
      if coalesce(data->>'generationKey','')='' then raise exception 'GENERATION_KEY_REQUIRED'; end if;
      job_input:=data->'jobInput';
      if v.consumed_job is not null then
        if v.generation_key is distinct from data->>'generationKey' or v.generation_input is distinct from job_input then raise exception 'GENERATION_CONFLICT'; end if;
        return public.reconstruction_rpc(actor,'get',jsonb_build_object('projectId',v.project_id,'id',v.consumed_job));
      end if;
      if job_input->'scene' is distinct from v.base_scene or job_input->'sources' is distinct from v.sources
        or job_input->'reviewedScene' is distinct from v.candidate or job_input->>'reviewedJobId' is distinct from v.parent_id::text
        or job_input->>'projectId' is distinct from v.project_id::text
        or job_input->>'sessionId' is distinct from data->>'sessionId'
        or job_input->'generation' is distinct from data->'generation'
        or job_input->'expectedRevision' is distinct from to_jsonb(v.revision)
        then raise exception 'GENERATION_INPUT_CHANGED'; end if;
      job:=public.reconstruction_rpc(actor,'create',jsonb_build_object('input',job_input,'baseHash',v.parent_base_hash,
        'fingerprint',data->>'generationKey','reserveCents',200));
      if not exists(select 1 from scene_private.reconstruction_jobs j where j.id=(job->>'id')::uuid
        and j.owner_id=actor and j.project_id=v.project_id and j.base_hash=v.parent_base_hash
        and j.fingerprint=data->>'generationKey' and j.input=job_input and j.state='queued')
        then raise exception 'GENERATION_JOB_MISMATCH'; end if;
      update edit_prototype.versions set consumed_job=(job->>'id')::uuid,generation_key=data->>'generationKey',generation_input=job_input where id=v.id;
      return job;
    end $$;
    revoke all on schema edit_prototype from public,anon,authenticated;
    revoke all on all tables in schema edit_prototype from public,anon,authenticated;
    revoke all on function edit_prototype.version(uuid,text,jsonb) from public,anon,authenticated;
    revoke all on function edit_prototype.start_generation(uuid,jsonb) from public,anon,authenticated;
    grant usage on schema edit_prototype to service_role;
    grant select,insert,update on edit_prototype.versions to service_role;
    grant execute on function edit_prototype.version(uuid,text,jsonb) to service_role;
    grant execute on function edit_prototype.start_generation(uuid,jsonb) to service_role;`);
 },30000);
 afterAll(async()=>{await f?.db.close();});
 it('binds a draft and confirmation to the real lease, parent and exact candidate without touching budgets',async()=>{
  const id=crypto.randomUUID();const input={projectId,sessionId:session,generation,expectedRevision:0,parentId,id,sources,parentSnapshot:base,candidate:edited,changes:{before:base,after:edited}};
  const call=async(actor:string,action:string,data:unknown)=>f.db.query('select edit_prototype.version($1,$2,$3::jsonb)',[actor,action,JSON.stringify(data)]);
  const budget=await f.db.query('select * from scene_private.budgets order by kind');
  const daily=await f.db.query('select * from scene_private.text_daily_budgets order by usage_day');
  await call(owner,'create',input);
  await expect(call(outsider,'confirm',input)).rejects.toThrow();
  await expect(call(owner,'confirm',{...input,expectedRevision:1})).rejects.toThrow('REVISION_CONFLICT');
  await expect(call(owner,'confirm',{...input,candidate:base})).rejects.toThrow('DIFF_CHANGED');
  await expect(call(owner,'confirm',{...input,changes:{before:base,after:base}})).rejects.toThrow('DIFF_CHANGED');
  await expect(call(owner,'confirm',{...input,sources:['source-b']})).rejects.toThrow('PARENT_CHANGED');
  await f.db.query('delete from scene_private.source_images where project_id=$1 and asset_id=$2',[projectId,assetId]);
  await expect(call(owner,'confirm',input)).rejects.toThrow('SOURCE_UNAVAILABLE');
  await f.db.query("insert into scene_private.source_images(project_id,asset_id,kind) values($1,$2,'floorplan')",[projectId,assetId]);
  await f.db.query('update scene_private.assets set owner_id=$1 where id=$2',[outsider,assetId]);
  await expect(call(owner,'confirm',input)).rejects.toThrow('SOURCE_UNAVAILABLE');
  await f.db.query('update scene_private.assets set owner_id=$1 where id=$2',[owner,assetId]);
  await f.db.query('update scene_private.reconstruction_jobs set candidate=$1::jsonb where id=$2',[JSON.stringify(edited),parentId]);
  await expect(call(owner,'confirm',input)).rejects.toThrow('PARENT_CHANGED');
  await f.db.query('update scene_private.reconstruction_jobs set candidate=$1::jsonb where id=$2',[JSON.stringify(base),parentId]);
  await f.db.query("update scene_private.reconstruction_jobs set base_hash='changed' where id=$1",[parentId]);
  await expect(call(owner,'confirm',input)).rejects.toThrow('VERSION_CHANGED');
  await f.db.query("update scene_private.reconstruction_jobs set base_hash='basis' where id=$1",[parentId]);
  await call(owner,'confirm',input);
  expect(await call(owner,'get',input)).toEqual(await call(owner,'get',input));
  await expect(call(owner,'confirm',input)).rejects.toThrow('VERSION_CHANGED');
  expect(await f.db.query('select * from scene_private.budgets order by kind')).toEqual(budget);
  expect(await f.db.query('select * from scene_private.text_daily_budgets order by usage_day')).toEqual(daily);
 });
 it('accepts only server-validated V2, invalidates confirmation, and denies direct client database access',async()=>{
  const id=crypto.randomUUID();
  // This local adapter models an authenticated server: caller identity is established outside input,
  // and source candidate is loaded from the database instead of accepted from a client.
  const submit=async(actor:string,untrusted:unknown)=>{
   const original=(await f.db.query<{candidate:unknown}>('select candidate from scene_private.reconstruction_jobs where id=$1',[parentId])).rows[0]!.candidate;
   const prepared=prepareReviewEdit(original,untrusted);
   const payload={projectId,sessionId:session,generation,expectedRevision:0,parentId,id,sources,parentSnapshot:original,candidate:prepared.candidate,changes:{before:original,after:prepared.candidate}};
   const result=await f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<{version:{candidate:typeof base}}>('select edit_prototype.version($1,$2,$3::jsonb) as version',[actor,'create',JSON.stringify(payload)]);});
   return {version:result.rows[0]!.version,differences:prepared.differences};
  };
  const invalid=structuredClone(edited);invalid.structure.walls[0]!.end.x=NaN;
  await expect(submit(owner,invalid)).rejects.toThrow();
  await expect(submit(outsider,edited)).rejects.toThrow();
  const result=await submit(owner,edited);
  expect(result.version.candidate.structure.walls.every(w=>w.status==='inferred')).toBe(true);
  expect(result.differences.some(d=>d.label.includes('厚度'))).toBe(true);
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select edit_prototype.version($1,$2,$3::jsonb)',[owner,'confirm','{}']);})).rejects.toThrow(/permission denied/i);
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select public.reconstruction_rpc($1,$2,$3::jsonb)',[owner,'create','{}']);})).rejects.toThrow(/permission denied/i);
 });
 it('atomically binds the confirmed version to one normally billed job and rolls back interruptions',async()=>{
  const id=crypto.randomUUID(),requestId=crypto.randomUUID();
  const candidate=prepareReviewEdit(base,edited).candidate;
  const version={projectId,sessionId:session,generation,expectedRevision:0,parentId,id,sources,parentSnapshot:base,candidate,changes:{before:base,after:candidate}};
  const versionCall=async(action:string)=>f.db.query('select edit_prototype.version($1,$2,$3::jsonb)',[owner,action,JSON.stringify(version)]);
  const jobInput={projectId,sessionId:session,generation,expectedRevision:0,requestId,scene:scene(),sources,reviewedScene:candidate,reviewedJobId:parentId};
  const request={...version,jobInput,generationKey:'prototype-fingerprint'};
  const start=async(input:unknown)=>f.db.query<{job:{id:string}}>('select edit_prototype.start_generation($1,$2::jsonb) as job',[owner,JSON.stringify(input)]);
  const currentBudget=async()=>Number((await f.db.query<{committed_cents:string}>("select committed_cents from scene_private.budgets where kind='text'")).rows[0]!.committed_cents);
  const budget=await currentBudget();await versionCall('create');
  await expect(start(request)).rejects.toThrow('VERSION_NOT_CONFIRMED');expect(await currentBudget()).toBe(budget);
  await versionCall('confirm');
  await expect(start({...request,jobInput:{...jobInput,reviewedScene:base}})).rejects.toThrow('GENERATION_INPUT_CHANGED');
  const collision=crypto.randomUUID();
  await f.db.query("insert into scene_private.reconstruction_jobs(project_id,owner_id,request_key,fingerprint,input,base_hash,state,reserve_cents) values($1,$2,$3,$4,'{}','basis','needs_review',200)",[projectId,owner,collision,request.generationKey]);
  await expect(start({...request,jobInput:{...jobInput,requestId:collision}})).rejects.toThrow('GENERATION_JOB_MISMATCH');
  expect(await currentBudget()).toBe(budget);
  await expect(f.db.transaction(async tx=>{await tx.query('select edit_prototype.start_generation($1,$2::jsonb)',[owner,JSON.stringify(request)]);throw new Error('simulated disconnect');})).rejects.toThrow('simulated disconnect');
  expect(await currentBudget()).toBe(budget);
  expect((await f.db.query<{consumed_job:string|null}>('select consumed_job from edit_prototype.versions where id=$1',[id])).rows[0]!.consumed_job).toBeNull();
  const first=(await start(request)).rows[0]!.job;expect(await currentBudget()).toBe(budget+200);
  expect((await start(request)).rows[0]!.job.id).toBe(first.id);expect(await currentBudget()).toBe(budget+200);
  await expect(start({...request,generationKey:'another-request'})).rejects.toThrow('GENERATION_CONFLICT');
  await expect(start({...request,jobInput:{...jobInput,instruction:'不同要求'}})).rejects.toThrow('GENERATION_CONFLICT');
 });
});
