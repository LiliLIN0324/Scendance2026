import {webcrypto} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {readVenueSourceRevision} from './venue-source-revision';
import {readSourceScopeSnapshotV2,type SourceScopeSnapshotV2} from './source-storage';
vi.mock('./source-storage',async original=>{const actual=await original<typeof import('./source-storage')>();return {...actual,readSourceScopeSnapshotV2:vi.fn()};});
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();});
function snapshot(text='pixels'):SourceScopeSnapshotV2{return {version:2,scope:'event-1',sources:[{id:'a',scope:'event-1',kind:'floorplan',name:'图',width:10,height:20,blob:new Blob([text],{type:'image/png'})}],form:{present:true,value:{constraints:[{id:'ruler',valueMeters:12}],calibration:{x:1}}}};}
function setup(first:SourceScopeSnapshotV2,second=first){vi.stubGlobal('crypto',webcrypto);vi.mocked(readSourceScopeSnapshotV2).mockReset();vi.mocked(readSourceScopeSnapshotV2).mockResolvedValueOnce(first).mockResolvedValueOnce(second);}
const ready={isSettled:()=>true};
it('produces a deterministic strong digest and changes for original bytes, kind and calibration',async()=>{
 const original=snapshot();setup(original);const first=await readVenueSourceRevision('event-1',ready);
 setup(original);const same=await readVenueSourceRevision('event-1',ready);expect(first).toEqual(same);
 expect(first.status).toBe('observed');if(first.status==='observed')expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
 for(const changed of [snapshot('other'),{...original,sources:[{...original.sources[0]!,kind:'photo' as const}]},
   {...original,form:{present:true as const,value:{constraints:[{id:'ruler',valueMeters:13}],calibration:{x:1}}}}]){
  setup(changed);expect(await readVenueSourceRevision('event-1',ready)).not.toEqual(first);
 }
});
it('returns unknown while dirty, on read failure, missing original bytes or data changing during hashing',async()=>{
 vi.stubGlobal('crypto',webcrypto);expect(await readVenueSourceRevision('event-1',{isSettled:()=>false})).toEqual({status:'unknown'});
 vi.mocked(readSourceScopeSnapshotV2).mockRejectedValueOnce(new Error('offline'));
 expect(await readVenueSourceRevision('event-1',ready)).toEqual({status:'unknown'});
 const original=snapshot();setup({...original,sources:[{...original.sources[0]!,blob:undefined}]} as unknown as SourceScopeSnapshotV2);
 expect(await readVenueSourceRevision('event-1',ready)).toEqual({status:'unknown'});
 setup(original,snapshot('changed'));expect(await readVenueSourceRevision('event-1',ready)).toEqual({status:'unknown'});
 setup(original);let count=0;expect(await readVenueSourceRevision('event-1',{isSettled:()=>++count<3})).toEqual({status:'unknown'});
});
it('distinguishes an absent form from a present undefined form and rejects unsupported metadata',async()=>{
 const original=snapshot();setup({...original,form:{present:false}});const absent=await readVenueSourceRevision('event-1',ready);
 setup({...original,form:{present:true,value:undefined}});expect(await readVenueSourceRevision('event-1',ready)).not.toEqual(absent);
 setup({...original,form:{present:true,value:new Map()}});expect(await readVenueSourceRevision('event-1',ready)).toEqual({status:'unknown'});
});
