import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

function browser() {
  const values=new Map<string,string>();let held=false;
  const storage:Storage={get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(key)??null,key:index=>[...values.keys()][index]??null,
    setItem:(key,value)=>{values.set(key,String(value));},removeItem:key=>{values.delete(key);}};
  const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){
    if(held)return Promise.resolve().then(()=>callback(null));held=true;
    return Promise.resolve().then(()=>callback({})).finally(()=>{held=false;});
  }} as unknown as LockManager;
  vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:storage});
  return {storage,locks};
}
/** Stage IDB changes until completion; abort discards every pending write. */
function database() {
  let forms=new Map<string,unknown>(),images=new Map<string,unknown>(),deferOpen=false;
  const waiting:(()=>void)[]=[];
  const db={close:vi.fn(),transaction(_names:string|string[]){
    const stagedForms=structuredClone(forms),stagedImages=structuredClone(images);let pending=0,aborted=false,done=false;
    const tx={error:null as Error|null,oncomplete:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void),
      abort(){if(aborted||done)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(name:string){
        const map=name==='forms'?stagedForms:stagedImages;
        const key=(value:unknown)=>JSON.stringify(value);
        return {
          get:(k:unknown)=>request(()=>map.get(key(k))),getKey:(k:unknown)=>request(()=>map.has(key(k))?k:undefined),
          index:()=>({getAll:(scope:string)=>request(()=>[...stagedImages.values()].filter((item:any)=>item.scope===scope))}),
          put:(value:unknown,k?:unknown)=>request(()=>{map.set(key(k??(value as {id:string}).id),structuredClone(value));}),
          add:(value:unknown,k?:unknown)=>request(()=>{const id=key(k??(value as {id:string}).id);if(map.has(id))throw new Error('重复');map.set(id,structuredClone(value));}),
          delete:(k:unknown)=>request(()=>{map.delete(key(k));}),
        };
      }};
    function finish(){if(pending||aborted||done)return;done=true;forms=stagedForms;images=stagedImages;tx.oncomplete?.();}
    function request(run:()=>unknown){pending++;const req={result:undefined as unknown,error:null as Error|null,onsuccess:undefined as undefined|(()=>void)};
      queueMicrotask(()=>{if(aborted)return;try{req.result=run();req.onsuccess?.();}catch(error){tx.error=error as Error;tx.abort();}pending--;queueMicrotask(finish);});return req;}
    queueMicrotask(finish);return tx;
  }};
  vi.stubGlobal('indexedDB',{open(){const req={result:db,onsuccess:undefined as undefined|(()=>void)};const finish=()=>req.onsuccess?.();if(deferOpen)waiting.push(finish);else queueMicrotask(finish);return req;}});
  return {forms:()=>forms,images:()=>images,hold(){deferOpen=true;},release(){deferOpen=false;for(const finish of waiting.splice(0))finish();}};
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

it('uses one real lease across the isolated workspace adapters, rejects another tab and fails closed on loss',async()=>{
  vi.resetModules();const {storage,locks}=browser(),db=database();
  const leases=await import('./local-write-lease'),sessions=await import('./workspace-write-session');
  const source=await import('./source-storage'),fixtures=await import('../components/room-organizer/lib/__testfixtures__/fixtures');
  const firstManager=leases.createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>storage});
  const otherManager=leases.createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>storage});
  const lease=await firstManager.acquire(),session=sessions.createWorkspaceWriteSession(lease.capability);
  expect(()=>sessions.createWorkspaceWriteSession({} as never)).toThrow();
  await expect(otherManager.acquire()).rejects.toThrow('另一窗口');
  expect(session.library.save(fixtures.makeLayout(),'example')).not.toBeNull();
  expect(session.layout.snapshot(fixtures.makeLayout())).toBe(true);
  const environment=session.environment.read({kind:'project',id:'p'});expect(environment.ok).toBe(true);
  if(!environment.ok)throw new Error('environment unreadable');
  expect(session.environment.write('p',[{assetId:'hall',name:'场地'}],environment.snapshot.raw).ok).toBe(true);
  await session.sources.storeForm('brief',{name:'原资料'});
  expect(db.forms().get(JSON.stringify('brief'))).toEqual({name:'原资料'});
  const id=(n:number)=>`ab900000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const {materialCheckinLedgerSchema}=await import('../../supabase/functions/_shared/material-checkin-contract');
  const ledger=materialCheckinLedgerSchema.parse({projectId:'p',dataKind:'rehearsal' as const,sheets:[{id:id(1),acquisitionId:id(2),acquisitionSnapshot:{title:'椅子'},unit:'piece' as const,
    agreements:[{id:id(3),agreedQuantity:1,basisNote:'演练',recordedAt:'2026-10-09T01:00:00+08:00',recordedBy:'统筹'}],events:[]}]});
  await session.checkins.merge('p',ledger);
  db.hold();const queued=session.sources.storeForm('brief',{name:'不得写入'});void queued.catch(()=>{});
  session.close();db.release();await expect(queued).rejects.toThrow();
  expect(db.forms().get(JSON.stringify('brief'))).toEqual({name:'原资料'});
  await expect(source.storeSourceForm('brief',{name:'旧调用'})).rejects.toThrow();
  expect(()=>session.assertSessionWrite()).toThrow();
  expect(()=>session.library.delete('example')).toThrow();
  expect(()=>session.environment.clear('p',null)).toThrow();
  expect(()=>session.layout.snapshot(fixtures.makeLayout())).toThrow();
  await lease.release();const other=await otherManager.acquire(),next=sessions.createWorkspaceWriteSession(other.capability);
  expect(()=>session.assertWrite()).toThrow();next.close();await other.release();
});

it('revokes every adapter on actual lease loss and never reuses the old session after reacquisition',async()=>{
  vi.resetModules();const {storage,locks}=browser();database();
  const leases=await import('./local-write-lease'),sessions=await import('./workspace-write-session');
  const mgr=leases.createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>storage});
  const lease=await mgr.acquire(),session=sessions.createWorkspaceWriteSession(lease.capability);
  await session.sources.storeForm('brief',{name:'留存'});await lease.release();
  expect(()=>session.assertSessionWrite()).toThrow();
  await expect((await import('./source-storage')).storeSourceForm('brief',{name:'覆盖'})).rejects.toThrow();
  const nextLease=await mgr.acquire(),next=sessions.createWorkspaceWriteSession(nextLease.capability);
  expect(()=>session.assertWrite()).toThrow();
  await expect((await import('./source-storage')).readSourceForm('brief')).resolves.toEqual({name:'留存'});
  next.close();await nextLease.release();
});

it('legacy write APIs cannot bypass the active session or resume after it closes',async()=>{
 vi.resetModules();const {storage,locks}=browser();database();
 const leases=await import('./local-write-lease'),sessions=await import('./workspace-write-session');
 const library=await import('../components/room-organizer/lib/library'),history=await import('../components/room-organizer/lib/version-history');
 const environment=await import('../components/room-organizer/lib/environment-preference'),calibration=await import('../components/room-organizer/lib/site-capture');
 const persistence=await import('../components/room-organizer/lib/persistence'),fixtures=await import('../components/room-organizer/lib/__testfixtures__/fixtures');
 const assistant=await import('../components/room-organizer/lib/assistant-sessions'),bodies=await import('../components/room-organizer/lib/assistant-session-bodies');
 const lease=await leases.createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>storage}).acquire(),session=sessions.createWorkspaceWriteSession(lease.capability);
 expect(library.saveNamedLayout(fixtures.makeLayout(),'active')).not.toBeNull();
 expect(history.recordSnapshot(fixtures.makeLayout({name:'snapshot'}),{force:true})).toBe(true);
 expect(()=>environment.writeEnvironments('a',[])).toThrow('不支持');
 expect(()=>calibration.writeSiteCalibration(calibration.defaultSiteCalibration('a'))).toThrow('不支持');
 expect(assistant.writeAssistantSessionIndex(assistant.emptyAssistantSessionIndex())).toBe(false);
 expect(bodies.writeAssistantSessionBodies(bodies.emptyAssistantSessionBodies())).toBe(false);
 session.close();const before=storage.getItem('standalone-room-organizer-library:active');
 expect(library.saveNamedLayout(fixtures.makeLayout({width:22}),'active')).toBeNull();
 expect(history.recordSnapshot(fixtures.makeLayout({width:22}),{force:true})).toBe(false);
 expect(persistence.saveLayout(fixtures.makeLayout({width:22})).ok).toBe(false);
 expect(()=>environment.writeEnvironments('a',[])).toThrow();expect(()=>calibration.writeSiteCalibration(calibration.defaultSiteCalibration('a'))).toThrow();
 expect(storage.getItem('standalone-room-organizer-library:active')).toBe(before);await lease.release();
});
