import { readFile } from 'node:fs/promises';
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { database,owner,editor,outsider,studio,session,scene,chair } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { assetRecord } from '../supabase/functions/_shared/assets.ts';
import { ApiError } from '../supabase/functions/_shared/domain.ts';
import { materialInspectionSchema, materialVariantAssetSchema } from '../supabase/functions/_shared/asset-customization-contract.ts';

const chairPath=new URL('../assets/library/model/bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7.glb',import.meta.url);
describe('material variant authorization, immutable storage and explicit proposal apply',()=>{
  let f:Awaited<ReturnType<typeof database>>,api:ReturnType<typeof createApi>,source:Awaited<ReturnType<typeof assetRecord>>;
  const files=new Map<string,Uint8Array>(),upload=vi.fn(async(path:string,bytes:Uint8Array)=>{files.set(path,bytes.slice());});
  const download=vi.fn(async(path:string)=>{const bytes=files.get(path);if(!bytes)throw new ApiError('STORAGE_DOWNLOAD_FAILED',502);return bytes;});
  beforeAll(async()=>{
    f=await database();f.backend.upload=upload;f.backend.readSourceBytes=download;api=createApi(f.backend,()=>undefined);
    const bytes=new Uint8Array(await readFile(chairPath));
    source=await assetRecord(owner,bytes,{name:'Timber chair',source:'upload',sourceId:'timber-chair',sourceUrl:'https://library.example/chair',license:{id:'CC0-1.0'},metadata:{sourceSize:{width:0.5,depth:0.5,height:0.85}}});
    files.set(source.storagePath,bytes);await f.rpc(owner,'assets.register',source);
  },30000);
  afterAll(async()=>{await f?.db.close();});
  function req(path:string,method='GET',body?:unknown,actor=owner) {
    return api(new Request(`https://backend.example/scene-api${path}`,{method,headers:{Authorization:`Bearer ${actor}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
  }
  const changes=()=>({requestId:crypto.randomUUID(),sourceSha256:source.sha256,materialIndices:[0],baseColor:'#808080',roughness:0.8});
  async function variant() {
    const response=await req(`/assets/${source.id}/customize`,'POST',changes());expect(response.status).toBe(201);return materialVariantAssetSchema.parse(await response.json());
  }
  async function project() {
    const s=scene();s.objects=[{...chair('keep these notes'),materialId:'asset',assetId:source.id,color:'#dddddd',rotation:0.4},{...chair(),materialId:'asset',assetId:source.id,position:{x:6,z:3}}];
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Material preview',scene:s}),lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
    return {p,s,context:{sessionId:session,generation:lease.generation,expectedRevision:0}};
  }
  it('inspects only authorized assets and never fetches unauthorized private models',async()=>{
    const before=download.mock.calls.length;
    for(const actor of [editor,outsider]) {
      expect((await req(`/assets/${source.id}/materials`,'GET',undefined,actor)).status).toBe(404);
      expect((await req(`/assets/${source.id}/customize`,'POST',changes(),actor)).status).toBe(404);
    }
    expect(download.mock.calls.length).toBe(before);
    const result=materialInspectionSchema.parse(await (await req(`/assets/${source.id}/materials`)).json());
    expect(result.sha256).toBe(source.sha256);expect(result.slots.map(s=>s.name)).toEqual(['oak','walnut']);
  });
  it('registers an immutable child once, preserves license, and refuses changed replay or source hash',async()=>{
    const input=changes(),before=upload.mock.calls.length;
    const response=await req(`/assets/${source.id}/customize`,'POST',input);expect(response.status).toBe(201);
    const asset=materialVariantAssetSchema.parse(await response.json());expect(asset.id).not.toBe(source.id);expect(asset.sha256).not.toBe(source.sha256);
    expect(asset.metadata).toMatchObject({parentAssetId:source.id,sourceSha256:source.sha256,changeMode:'material',materialVariant:{procurementStatus:'needs_confirmation',validation:{geometryUVPreserved:true}}});
    const stored=await f.rpc(owner,'assets.get',{assetId:asset.id});expect(stored.license).toEqual({id:'CC0-1.0'});expect(stored.source_id).toBe('timber-chair');
    expect((await req(`/assets/${source.id}/customize`,'POST',input)).status).toBe(200);expect(upload.mock.calls.length).toBe(before+1);
    const conflict=await req(`/assets/${source.id}/customize`,'POST',{...input,roughness:0.2});expect((await conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    const changed=await req(`/assets/${source.id}/customize`,'POST',{...changes(),sourceSha256:'0'.repeat(64)});expect((await changed.json()).error.code).toBe('ASSET_VERSION_CONFLICT');
    expect((await f.rpc(owner,'assets.get',{assetId:source.id})).sha256).toBe(source.sha256);
    const inspection=materialInspectionSchema.parse(await (await req(`/assets/${asset.id}/materials`)).json());expect(inspection.parentAssetId).toBe(source.id);
  });
  it('retries an upload interruption with the same reserved asset ID and file path',async()=>{
    const input=changes();upload.mockRejectedValueOnce(new ApiError('STORAGE_UPLOAD_FAILED',502));
    expect((await req(`/assets/${source.id}/customize`,'POST',input)).status).toBe(502);
    const failedPath=upload.mock.calls.at(-1)![0];
    expect((await req(`/assets/${source.id}/customize`,'POST',input)).status).toBe(201);expect(upload.mock.calls.at(-1)![0]).toBe(failedPath);
  });
  it('prepares one-instance changes without saving, idempotently applies after confirmation and restores direct parent',async()=>{
    const asset=await variant(),{p,s,context}=await project();
    const input={...context,requestId:crypto.randomUUID(),localRevision:5,scene:s,objectIds:[s.objects[0].id],sourceAssetId:source.id,variantAssetId:asset.id};
    const response=await req(`/projects/${p.id}/material-variants`,'POST',input);expect(response.status).toBe(201);const proposal=await response.json();
    expect(proposal.candidate.objects).toEqual([{...s.objects[0],assetId:asset.id},s.objects[1]]);
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(s);
    const replay=await req(`/projects/${p.id}/material-variants`,'POST',input);expect(replay.status).toBe(200);expect((await replay.json()).id).toBe(proposal.id);
    const conflict=await req(`/projects/${p.id}/material-variants`,'POST',{...input,objectIds:[s.objects[1].id]});expect((await conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    const stale=await req(`/projects/${p.id}/proposals/apply`,'POST',{...context,proposalId:proposal.id,localRevision:6,currentScene:s});expect((await stale.json()).error.code).toBe('STALE_PROPOSAL');
    const applied=await req(`/projects/${p.id}/proposals/apply`,'POST',{...context,proposalId:proposal.id,localRevision:5,currentScene:s});expect(applied.status).toBe(200);const saved=await applied.json();
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(proposal.candidate);
    const restore=await req(`/projects/${p.id}/material-variants`,'POST',{...input,requestId:crypto.randomUUID(),expectedRevision:saved.revision,localRevision:6,scene:proposal.candidate,sourceAssetId:asset.id,variantAssetId:source.id});
    expect(restore.status).toBe(201);const restoreProposal=await restore.json();expect(restoreProposal.candidate).toEqual(s);
    const restored=await req(`/projects/${p.id}/proposals/apply`,'POST',{...context,expectedRevision:saved.revision,proposalId:restoreProposal.id,localRevision:6,currentScene:proposal.candidate});expect(restored.status).toBe(200);
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(s);
    expect((await f.db.query('select * from scene_private.requests')).rows).toHaveLength(0);
    // The new replay row must not prevent existing project/proposal deletion flows.
    await f.db.query('delete from scene_private.proposals where project_id=$1',[p.id]);
    expect((await f.db.query('select * from scene_private.material_variant_proposals where proposal_id=$1',[proposal.id])).rows).toHaveLength(0);
  });
  it('rejects locked, wrong-source, stale and unrelated replacement selections',async()=>{
    const asset=await variant(),{p,s,context}=await project(),base={...context,requestId:crypto.randomUUID(),localRevision:0,scene:s,objectIds:[s.objects[0].id],sourceAssetId:source.id,variantAssetId:asset.id};
    const locked={...s,objects:s.objects.map((o,i)=>i?o:{...o,locked:true})};
    for(const [patch,code] of [[{scene:locked},'OBJECT_LOCKED'],[{sourceAssetId:asset.id},'MATERIAL_VARIANT_SELECTION_INVALID'],[{variantAssetId:source.id},'MATERIAL_VARIANT_MISMATCH'],[{expectedRevision:5},'REVISION_CONFLICT']] as const) {
      const result=await req(`/projects/${p.id}/material-variants`,'POST',{...base,...patch});expect((await result.json()).error.code).toBe(code);
    }
    const missing=await req(`/projects/${p.id}/material-variants`,'POST',{...base,objectIds:[crypto.randomUUID()]});expect((await missing.json()).error.code).toBe('MATERIAL_VARIANT_SELECTION_INVALID');
  });
  it('accepts only texture lineage whose geometry and UV quality both passed',async()=>{
    const {p,s,context}=await project();
    const base={...context,requestId:crypto.randomUUID(),localRevision:0,scene:s,objectIds:[s.objects[0].id],sourceAssetId:source.id};
    for(const uvPreserved of [false,true]) {
      const texture=await assetRecord(owner,files.get(source.storagePath)!,{name:'Texture result',source:'hunyuan',license:{id:'generated'},metadata:{parentAssetId:source.id,sourceSha256:source.sha256,changeMode:'texture',textureVariant:{validation:{geometryPreserved:true,uvPreserved,tolerance:1e-5,comparison:'ordered-accessors-and-nodes'},procurementStatus:'needs_confirmation'}}});
      await f.rpc(owner,'assets.register',texture);
      const result=await req(`/projects/${p.id}/material-variants`,'POST',{...base,requestId:crypto.randomUUID(),variantAssetId:texture.id});
      if(uvPreserved) {expect(result.status).toBe(201);expect((await result.json()).candidate.objects[0]).toEqual({...s.objects[0],assetId:texture.id});}
      else expect((await result.json()).error.code).toBe('MATERIAL_VARIANT_MISMATCH');
    }
  });
  it('does not grant browser roles direct table or RPC access',async()=>{
    const result=await f.db.query<{allowed:boolean}>("select has_table_privilege('authenticated','scene_private.material_customizations','select') or has_table_privilege('anon','scene_private.material_variant_proposals','insert') or has_function_privilege('authenticated','public.scene_rpc(uuid,text,jsonb)','execute') as allowed");
    expect(result.rows[0].allowed).toBe(false);
  });
});
