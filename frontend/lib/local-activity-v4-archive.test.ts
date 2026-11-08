import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {makeFloor,makeLayout} from '../components/room-organizer/lib/__testfixtures__/fixtures';
import {INITIAL_BRIEF} from '../components/room-organizer/lib/creative-brief';
import {createLocalWriteLeaseManager} from './local-write-lease';
import {serializeLocalProjectBackupV4,parseLocalProjectBackupJson} from './local-project-backup';
import {decodeSourceDocuments} from './source-backup';
import {stageLocalActivityV4,readStagedLocalActivityV4,listStagedLocalActivityV4,ACTIVITY_V4_ARCHIVE_NAMESPACE} from './local-activity-v4-archive';
import * as storage from './source-storage';

vi.mock('./source-storage',()=>({addSourceRecord:vi.fn(),readSourceRecordSnapshot:vi.fn(),listExactSourceNamespace:vi.fn()}));
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII=';
const scope='activity-one',records=new Map<string,unknown>();
let lease:Awaited<ReturnType<ReturnType<typeof createLocalWriteLeaseManager>['acquire']>>;
beforeEach(async()=>{
 records.clear();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:1,height:1,close:vi.fn()})));
 const local=new Map<string,string>(),localStorage={getItem:(k:string)=>local.get(k)??null,setItem:(k:string,v:string)=>local.set(k,v),removeItem:(k:string)=>local.delete(k)} as unknown as Storage;
 const locks={request:(_n:string,_o:unknown,cb:(lock:unknown)=>Promise<unknown>)=>cb({})} as unknown as LockManager;
 vi.stubGlobal('window',{localStorage});vi.stubGlobal('navigator',{locks});
 lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>localStorage}).acquire();
 vi.mocked(storage.addSourceRecord).mockImplementation(async(key,value,guard)=>{guard.assertStillHeld();const id=JSON.stringify(key);if(records.has(id))throw new Error('key exists');records.set(id,structuredClone(value));});
 vi.mocked(storage.readSourceRecordSnapshot).mockImplementation(async key=>{const id=JSON.stringify(key);return records.has(id)?{present:true,value:structuredClone(records.get(id))}:{present:false};});
 vi.mocked(storage.listExactSourceNamespace).mockImplementation(async namespace=>[...records.entries()].map(([key,value])=>({key:JSON.parse(key) as [string,string],value:structuredClone(value)})).filter(entry=>entry.key[0]===namespace));
});
afterEach(async()=>{await lease.release();vi.resetAllMocks();vi.unstubAllGlobals();});
async function backup(){
 const layout=makeLayout({id:scope,floors:[makeFloor({zones:[{id:'z',name:'休息区',color:'#4A7C59',x:-1,z:-1,w:2,d:2}]})]});
 const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
 const blob=new Blob([bytes],{type:'image/png'});
 const text=await serializeLocalProjectBackupV4(layout,{state:'ready',scope,brief:{status:'present',value:{...INITIAL_BRIEF,description:'活动需求'}}},
   {state:'ready',scope,materialCheckins:{status:'present',value:{schemaVersion:1,projectId:scope,dataKind:'rehearsal',sheets:[]}}},
   {scope,sources:[{id:'photo-one',scope,name:'现场图.png',kind:'floorplan',width:1,height:1,blob}],form:{text:'原图说明'}});
 return {text,layout,bytes};
}
describe('isolated immutable V4 activity staging',()=>{
 it('reads back zones, brief, checkins, image metadata and exact original image bytes',async()=>{
  const {text,layout,bytes}=await backup(),before=structuredClone(layout);
  const result=await stageLocalActivityV4({backupJson:text,scope,capability:lease.capability,isCurrent:()=>true});expect(result.status).toBe('saved');
  const saved=await readStagedLocalActivityV4(result.archiveId,scope,result.contentSha256);expect(saved).toBe(text);const data=parseLocalProjectBackupJson(saved);
  expect(data.layout.floors[0]!.zones).toEqual(before.floors[0]!.zones);expect(data.brief).toMatchObject({status:'present',value:{description:'活动需求'}});
  expect(data.materialCheckins).toMatchObject({status:'present',value:{projectId:scope}});expect(data.sourceDocuments.status).toBe('present');
  if(data.sourceDocuments.status!=='present')throw new Error('missing image');
  const decoded=await decodeSourceDocuments(data.sourceDocuments,scope);expect(decoded.sources[0]).toMatchObject({id:'photo-one',name:'现场图.png',kind:'floorplan',width:1,height:1});
  expect(new Uint8Array(await decoded.sources[0]!.blob!.arrayBuffer())).toEqual(bytes);expect(layout).toEqual(before);
 });
 it('does not overwrite any existing record and returns the identifier on uncertain write',async()=>{
  const {text}=await backup();vi.mocked(storage.addSourceRecord).mockImplementationOnce(async()=>{throw new Error('quota or collision');});
  const result=await stageLocalActivityV4({backupJson:text,scope,capability:lease.capability,isCurrent:()=>true});
  expect(result.status).toBe('unknown');expect(result.archiveId).toMatch(/^[0-9a-f-]+$/);expect(records.size).toBe(0);
 });
 it('retains an already written archive if current scope or capability becomes invalid before readback',async()=>{
  const {text}=await backup();let current=true;
  vi.mocked(storage.addSourceRecord).mockImplementationOnce(async(key,value,guard)=>{guard.assertStillHeld();records.set(JSON.stringify(key),structuredClone(value));current=false;});
  const result=await stageLocalActivityV4({backupJson:text,scope,capability:lease.capability,isCurrent:()=>current});
  expect(result.status).toBe('unknown');expect(records.has(JSON.stringify([ACTIVITY_V4_ARCHIVE_NAMESPACE,result.archiveId]))).toBe(true);
  expect(await readStagedLocalActivityV4(result.archiveId,scope,result.contentSha256)).toBe(text);
 });
 it('discovers an orphan with matching identity and fails the entire listing on corrupt data',async()=>{
  const {text}=await backup(),result=await stageLocalActivityV4({backupJson:text,scope,capability:lease.capability,isCurrent:()=>true});
  expect(await listStagedLocalActivityV4(scope)).toEqual([{archiveId:result.archiveId,contentSha256:result.contentSha256}]);
  records.set(JSON.stringify([ACTIVITY_V4_ARCHIVE_NAMESPACE,crypto.randomUUID()]),{version:1});
  await expect(listStagedLocalActivityV4(scope)).rejects.toThrow('无法完整核对');expect(records.size).toBe(2);
 });
 it('refuses a changed scope before any write and detects archive corruption on read',async()=>{
  const {text}=await backup();
  await expect(stageLocalActivityV4({backupJson:text,scope,capability:lease.capability,isCurrent:()=>false})).rejects.toThrow('活动或编辑权');
  expect(storage.addSourceRecord).not.toHaveBeenCalled();
  const result=await stageLocalActivityV4({backupJson:text,scope,capability:lease.capability,isCurrent:()=>true});
  const address=JSON.stringify([ACTIVITY_V4_ARCHIVE_NAMESPACE,result.archiveId]);const original=records.get(address) as Record<string,unknown>;
  records.set(address,{...original,backupJson:text.replace('活动需求','篡改需求')});
  await expect(readStagedLocalActivityV4(result.archiveId,scope,result.contentSha256)).rejects.toThrow('无法核对');
  expect(records.has(address)).toBe(true);
 });
});
