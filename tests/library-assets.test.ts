import { afterEach, describe, expect, it } from 'vitest';
import { database, owner, editor, outsider, studio, scene, chair } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';

const assetId='40000000-0000-4000-8000-000000000001';
const record={id:assetId,name:'Library chair',source:'upload',sourceId:'library-chair',sourceUrl:'https://3dassets.dev/assets/library-chair',
  format:'glb',byteSize:100,sha256:'a'.repeat(64),storagePath:`${owner}/${assetId}/${'a'.repeat(64)}.glb`,
  license:{id:'CC0-1.0'},metadata:{catalog:'scendance-v041'}};
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
async function fixture(){const f=await database();cleanups.push(()=>f.db.close());return f;}
async function register(f:Awaited<ReturnType<typeof database>>,data=record){
  return f.db.transaction(async tx=>{
    await tx.exec('set local role service_role');
    return (await tx.query<{asset:unknown}>('select public.register_library_asset($1,$2,$3::jsonb) as asset',[owner,'library-chair',JSON.stringify(data)])).rows[0].asset;
  });
}

describe('registered public model library through existing scene API',{timeout:15_000},()=>{
  it('allows another studio to authorize, save and reopen a registered model without exposing private assets',async()=>{
    const f=await fixture();await register(f);
    await f.db.query('delete from scene_private.members where user_id=$1',[editor]);
    const other='20000000-0000-4000-8000-000000000002';
    await f.db.query('insert into scene_private.studios(id,name) values($1,$2)',[other,'Other studio']);
    await f.db.query("insert into scene_private.members values($1,$2,'owner','Other owner')",[other,editor]);
    const api=createApi(f.backend,()=>undefined);
    const response=await api(new Request(`https://api.test/assets/${assetId}/url`,{method:'POST',headers:{authorization:`Bearer ${editor}`}}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({id:assetId,format:'glb',expiresIn:300});
    const doc=scene();doc.objects=[{...chair(),materialId:'asset',assetId}];
    const created=await f.rpc(editor,'projects.create',{studioId:other,name:'Shared catalog scene',scene:doc});
    expect((await f.rpc(editor,'projects.get',{projectId:created.id})).scene).toEqual(doc);
    const privateId='40000000-0000-4000-8000-000000000002';
    await f.rpc(owner,'assets.register',{...record,id:privateId,storagePath:'private.glb'});
    await expect(f.rpc(editor,'assets.get',{assetId:privateId})).rejects.toMatchObject({code:'ASSET_NOT_FOUND'});
    await expect(f.rpc(outsider,'assets.get',{assetId})).rejects.toMatchObject({code:'ASSET_NOT_FOUND'});
    const invalid=scene();invalid.objects=[{...chair(),materialId:'asset',assetId:privateId}];
    await expect(f.rpc(editor,'projects.create',{studioId:other,name:'Forbidden',scene:invalid})).rejects.toMatchObject({code:'ASSET_FORBIDDEN'});
  });
  it('reuses an identical registration and rejects changed bytes or a different ID for the same model',async()=>{
    const f=await fixture();expect(await register(f)).toMatchObject({id:assetId});expect(await register(f)).toMatchObject({id:assetId});
    await expect(register(f,{...record,sha256:'b'.repeat(64),storagePath:`${owner}/${assetId}/${'b'.repeat(64)}.glb`})).rejects.toThrow('LIBRARY_ASSET_CONFLICT');
    const otherId=crypto.randomUUID();
    await expect(register(f,{...record,id:otherId,storagePath:`${owner}/${otherId}/${record.sha256}.glb`})).rejects.toThrow('LIBRARY_ASSET_CONFLICT');
    expect((await f.rpc(owner,'assets.list')).length).toBe(1);
  });
  it('never permits browser roles to register models or modify the shared registry',async()=>{
    const f=await fixture();
    for(const role of ['anon','authenticated']){
      await expect(f.db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query('select public.register_library_asset($1,$2,$3::jsonb)',[owner,'library-chair',JSON.stringify(record)]);})).rejects.toThrow(/permission denied/);
    }
    await expect(register(f,{...record,sourceUrl:'https://private.example/model.glb'})).rejects.toThrow('INVALID_LIBRARY_ASSET');
    expect(await f.rpc(owner,'projects.list')).toEqual([]);
    expect(await f.rpc(owner,'studios')).toEqual([expect.objectContaining({id:studio})]);
  });
});
