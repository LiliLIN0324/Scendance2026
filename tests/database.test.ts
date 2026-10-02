import { beforeAll,afterAll,beforeEach,describe,it,expect } from 'vitest';
import { database,owner,editor,outsider,studio,session,scene,chair } from './fixtures.ts';
import { randomToken,sha256,sceneHash } from '../supabase/functions/_shared/domain.ts';

describe('PostgreSQL migrations and transactional contracts',()=>{
  let f:Awaited<ReturnType<typeof database>>,projectId:string,lease:Record<string,unknown>;
  beforeAll(async()=>{f=await database();},30000);
  afterAll(async()=>{await f?.db.close();});
  beforeEach(async()=>{
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Salon',scene:scene()});projectId=p.id;
    const l=await f.rpc(owner,'lease.acquire',{projectId,sessionId:session});lease={projectId,sessionId:session,generation:l.generation,expectedRevision:0};
  });
  it('denies non-members and caller-controlled table/RPC writes',async()=>{
    await expect(f.rpc(outsider,'projects.get',{projectId})).rejects.toThrow('PROJECT_NOT_FOUND');
    await expect(f.rpc(outsider,'projects.create',{studioId:studio,name:'Attack',scene:scene()})).rejects.toThrow('FORBIDDEN');
    for(const role of ['anon','authenticated']) for(const sql of ["select public.scene_rpc(null,'projects.list','{}')","select public.job_rpc(null,'jobs.claim','{}')",'select * from scene_private.projects',"update scene_private.projects set revision=999"])
      await expect(f.db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.exec(sql);})).rejects.toThrow(/permission denied/);
  });
  it('enables RLS on every business table and uses invoker functions',async()=>{
    const tables=await f.db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='scene_private' and c.relkind='r'");
    expect(tables.rows.length).toBeGreaterThan(10);expect(tables.rows.every(r=>r.relrowsecurity)).toBe(true);
    const funcs=await f.db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where proname in ('scene_rpc','job_rpc')");expect(funcs.rows.every(r=>!r.prosecdef)).toBe(true);
  });
  it('blocks other members and a second tab of the same user',async()=>{
    for(const actor of [owner,editor]) await expect(f.rpc(actor,'lease.acquire',{projectId,sessionId:crypto.randomUUID()})).rejects.toThrow('LEASE_BUSY');
    expect((await f.rpc(owner,'lease.acquire',{projectId,sessionId:session})).generation).toBe(lease.generation);
    expect((await f.rpc(owner,'lease.renew',lease)).generation).toBe(lease.generation);
  });
  it('renames under the lease and lists project and personal data without alias ambiguity',async()=>{
    const result=await f.rpc(owner,'projects.rename',{...lease,name:'Renamed'});expect(result.revision).toBe(1);
    const projects=await f.rpc(owner,'projects.list');expect(projects.some((p:{id:string;name:string})=>p.id===projectId&&p.name==='Renamed')).toBe(true);
    expect(await f.rpc(outsider,'projects.list')).toEqual([]);expect(Array.isArray(await f.rpc(owner,'assets.list'))).toBe(true);expect(Array.isArray(await f.jobs(owner,'jobs.list'))).toBe(true);
  });
  it('saves, rejects a stale revision, and preserves the committed scene',async()=>{
    const s=scene();s.objects=[chair()];
    expect((await f.rpc(owner,'scene.save',{...lease,scene:s})).revision).toBe(1);
    await expect(f.rpc(owner,'scene.save',{...lease,scene:scene()})).rejects.toThrow('REVISION_CONFLICT');
    expect((await f.rpc(owner,'projects.get',{projectId})).scene.objects).toHaveLength(1);
  });
  it('serializes two competing saves so only one revision wins',async()=>{
    const results=await Promise.allSettled([f.rpc(owner,'scene.save',{...lease,scene:scene()}),f.rpc(owner,'scene.save',{...lease,scene:scene()})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  });
  it('rejects expired lease, old generation and released sessions',async()=>{
    await f.db.query("update scene_private.projects set lease_expires=now()-interval '1 second' where id=$1",[projectId]);
    await expect(f.rpc(owner,'scene.save',{...lease,scene:scene()})).rejects.toThrow('LEASE_LOST');
    await expect(f.rpc(owner,'lease.renew',lease)).rejects.toThrow('LEASE_LOST');
    const next=await f.rpc(owner,'lease.acquire',{projectId,sessionId:session});expect(next.generation).toBe(2);
    await expect(f.rpc(owner,'scene.save',{...lease,scene:scene()})).rejects.toThrow('LEASE_LOST');
    await f.rpc(owner,'lease.release',{...lease,generation:2});
    const other=await f.rpc(editor,'lease.acquire',{projectId,sessionId:crypto.randomUUID()});expect(other.generation).toBe(3);
  });
  it('groups materials by specification, color, notes and freezes publication',async()=>{
    const s=scene();s.objects=[chair('internal'),chair('internal'),{...chair(),size:{width:1,depth:1,height:1}}];
    await f.rpc(owner,'scene.save',{...lease,scene:s});
    const bom=(await f.rpc(owner,'projects.get',{projectId})).materials;expect(bom.map((r:{quantity:number})=>r.quantity).sort()).toEqual([1,2]);
    const tokenHash=await sha256(randomToken());const pub=await f.rpc(owner,'publish',{projectId,expectedRevision:1,tokenHash});
    await f.rpc(owner,'scene.save',{...lease,expectedRevision:1,scene:scene()});
    const shared=await f.rpc(null,'share.read',{tokenHash});expect(shared.scene.objects).toHaveLength(3);expect(JSON.stringify(shared)).not.toContain('internal');
    await expect(f.db.query("update scene_private.publications set name='mutated' where id=$1",[pub.publicationId])).rejects.toThrow('IMMUTABLE_PUBLICATION');
    await f.rpc(owner,'shares.revoke',{projectId,shareId:pub.shareId});
    await expect(f.rpc(null,'share.read',{tokenHash})).rejects.toThrow('SHARE_NOT_FOUND');
  });
  it('only project creator/studio owner can publish or revoke',async()=>{
    await expect(f.rpc(editor,'publish',{projectId,expectedRevision:0,tokenHash:'a'.repeat(64)})).rejects.toThrow('FORBIDDEN');
    await expect(f.rpc(owner,'publish',{projectId,expectedRevision:99,tokenHash:'a'.repeat(64)})).rejects.toThrow('REVISION_CONFLICT');
  });
  it('shares only referenced assets; no access to the entire personal library',async()=>{
    const make=async()=>{const id=crypto.randomUUID();await f.rpc(owner,'assets.register',{id,name:'Prop',source:'hunyuan',license:{},storagePath:`${id}.glb`,format:'glb',byteSize:100,sha256:'a'.repeat(64),metadata:{}});return id;};
    const used=await make(),unused=await make();
    await expect(f.rpc(editor,'assets.get',{assetId:used})).rejects.toThrow('ASSET_NOT_FOUND');
    const s=scene();s.objects=[{...chair(),materialId:'asset',assetId:used}];await f.rpc(owner,'scene.save',{...lease,scene:s});
    expect((await f.rpc(editor,'assets.get',{assetId:used})).id).toBe(used);
    await expect(f.rpc(editor,'assets.get',{assetId:unused})).rejects.toThrow('ASSET_NOT_FOUND');
    await expect(f.rpc(outsider,'assets.get',{assetId:used})).rejects.toThrow('ASSET_NOT_FOUND');
    const tokenHash='b'.repeat(64);await f.rpc(owner,'publish',{projectId,expectedRevision:1,tokenHash});
    const shared=await f.rpc(null,'share.read',{tokenHash});expect(shared.assets.map((a:{id:string})=>a.id)).toEqual([used]);
    expect(shared.materials[0].notice).toBe('概念道具，实物待确认');
  });
  it('rejects proposals after local edit, cloud edit or lease change, and applies once',async()=>{
    const base=scene(),candidate=scene();candidate.objects=[chair()];const id=crypto.randomUUID();const baseHash=await sceneHash(base);
    await f.rpc(owner,'proposals.store',{...lease,id,localRevision:3,baseHash,scene:base,candidate,explanation:'Add chair',warnings:[]});
    const apply={...lease,proposalId:id,localRevision:3,baseHash};
    await expect(f.rpc(owner,'proposals.apply',{...apply,localRevision:4})).rejects.toThrow('STALE_PROPOSAL');
    await expect(f.rpc(owner,'proposals.apply',{...apply,baseHash:'changed'})).rejects.toThrow('STALE_PROPOSAL');
    const saved=await f.rpc(owner,'proposals.apply',apply);expect(saved.scene.objects).toHaveLength(1);expect(saved.previousScene).toEqual(base);
    await expect(f.rpc(owner,'proposals.apply',{...apply,expectedRevision:1})).rejects.toThrow('STALE_PROPOSAL');
  });
  it('rejects stale proposals after a cloud revision or editor handoff',async()=>{
    const base=scene(),id=crypto.randomUUID(),baseHash=await sceneHash(base);
    await f.rpc(owner,'proposals.store',{...lease,id,localRevision:0,baseHash,scene:base,candidate:base,explanation:'No changes',warnings:[]});
    await f.rpc(owner,'scene.save',{...lease,scene:base});
    await expect(f.rpc(owner,'proposals.apply',{...lease,expectedRevision:1,proposalId:id,localRevision:0,baseHash})).rejects.toThrow('STALE_PROPOSAL');
    await f.rpc(owner,'lease.release',lease);
    const acquired=await f.rpc(owner,'lease.acquire',{projectId,sessionId:session});
    await expect(f.rpc(owner,'proposals.store',{...lease,expectedRevision:1,id:crypto.randomUUID(),localRevision:0,baseHash,scene:base,candidate:base,explanation:'Late result',warnings:[]})).rejects.toThrow('LEASE_LOST');
    await expect(f.rpc(owner,'proposals.apply',{...lease,generation:acquired.generation,expectedRevision:1,proposalId:id,localRevision:0,baseHash})).rejects.toThrow('STALE_PROPOSAL');
  });
  it('keeps asset access after deleting one duplicate and excludes floorplans from share',async()=>{
    const assetId=crypto.randomUUID(),floorplan=crypto.randomUUID();
    for(const [id,format] of [[assetId,'glb'],[floorplan,'png']]) await f.rpc(owner,'assets.register',{id,name:'Asset',source:'upload',license:{},storagePath:`${id}.${format}`,format,byteSize:100,sha256:'c'.repeat(64),metadata:{}});
    const s=scene();s.venue.floorplanAssetId=floorplan;s.objects=[{...chair(),materialId:'asset',assetId},{...chair(),materialId:'asset',assetId}];
    await f.rpc(owner,'scene.save',{...lease,scene:s});s.objects.pop();await f.rpc(owner,'scene.save',{...lease,expectedRevision:1,scene:s});
    expect((await f.rpc(editor,'assets.get',{assetId})).id).toBe(assetId);
    const tokenHash='d'.repeat(64);await f.rpc(owner,'publish',{projectId,expectedRevision:2,tokenHash});
    const shared=await f.rpc(null,'share.read',{tokenHash});expect(shared.assets.map((a:{id:string})=>a.id)).toEqual([assetId]);expect(shared.scene.venue.floorplanAssetId).toBeUndefined();
  });
});
