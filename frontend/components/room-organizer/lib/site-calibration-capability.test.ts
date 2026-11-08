// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {defaultSiteCalibration,SITE_CALIBRATION_STORAGE_KEY as KEY} from './site-capture';
import {readSiteCalibrationStrict,writeSiteCalibrationStrict,reconcileSiteCalibration,exportCalibrationCandidate} from './site-calibration-capability';
const locks={request(_name:string,_options:unknown,cb:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>cb({}));}} as unknown as LockManager;
let lease:Awaited<ReturnType<ReturnType<typeof createLocalWriteLeaseManager>['acquire']>>;
beforeEach(async()=>{localStorage.clear();vi.stubGlobal('navigator',{locks});lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();});
afterEach(async()=>{await lease.release();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('reads and updates a whole-map snapshot without changing unrelated assets',()=>{
 const a=defaultSiteCalibration('a'),b=defaultSiteCalibration('b');localStorage.setItem(KEY,JSON.stringify({a,b}));
 const initial=readSiteCalibrationStrict(lease.capability);expect(initial.status).toBe('ready');if(initial.status!=='ready')return;
 const changed={...a,yawDeg:25};const result=writeSiteCalibrationStrict(changed,initial.snapshot,lease.capability);
 expect(result.status).toBe('saved');expect(JSON.parse(localStorage.getItem(KEY)!).b).toEqual(b);
});
it('refuses malformed storage and third-party changes without overwriting either',()=>{
 localStorage.setItem(KEY,'broken');expect(readSiteCalibrationStrict(lease.capability).status).toBe('unknown');
 const blocked=writeSiteCalibrationStrict(defaultSiteCalibration('a'),{raw:null,records:{}},lease.capability);
 expect(blocked.status).toBe('blocked');expect(localStorage.getItem(KEY)).toBe('broken');
 localStorage.removeItem(KEY);const before=readSiteCalibrationStrict(lease.capability);if(before.status!=='ready')throw new Error();
 const other=JSON.stringify({b:defaultSiteCalibration('b')});localStorage.setItem(KEY,other);
 expect(writeSiteCalibrationStrict(defaultSiteCalibration('a'),before.snapshot,lease.capability).status).toBe('blocked');expect(localStorage.getItem(KEY)).toBe(other);
});
it('preserves an exportable candidate when readback is uncertain and never retries automatically',()=>{
 const before=readSiteCalibrationStrict(lease.capability);if(before.status!=='ready')throw new Error();
 const original=Storage.prototype.getItem;let count=0;
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key){if(key===KEY&&++count===3)throw new Error('blocked');return original.call(this,key);});
 const candidate={...defaultSiteCalibration('a'),yawDeg:30};const result=writeSiteCalibrationStrict(candidate,before.snapshot,lease.capability);
 expect(result.status).toBe('unknown');if(result.status!=='unknown'||!result.pending)throw new Error();
 vi.restoreAllMocks();expect(JSON.parse(exportCalibrationCandidate(result.pending)).candidate).toEqual(candidate);
 expect(reconcileSiteCalibration(result.pending,lease.capability)).toBe('confirmed');
 localStorage.setItem(KEY,JSON.stringify({b:defaultSiteCalibration('b')}));expect(reconcileSiteCalibration(result.pending,lease.capability)).toBe('conflict');
});
it('does not write with an expired or forged capability',async()=>{
 const before=readSiteCalibrationStrict(lease.capability);if(before.status!=='ready')throw new Error();await lease.release();
 expect(writeSiteCalibrationStrict(defaultSiteCalibration('a'),before.snapshot,lease.capability).status).toBe('blocked');
 expect(writeSiteCalibrationStrict(defaultSiteCalibration('a'),before.snapshot,{} as never).status).toBe('blocked');expect(localStorage.getItem(KEY)).toBeNull();
});
it('marks write unknown if authority is lost immediately after the write',()=>{
 const before=readSiteCalibrationStrict(lease.capability);if(before.status!=='ready')throw new Error();
 const original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){original.call(this,key,value);if(key===KEY)void lease.release();});
 const result=writeSiteCalibrationStrict(defaultSiteCalibration('a'),before.snapshot,lease.capability);
 expect(result.status).toBe('unknown');if(result.status==='unknown')expect(result.pending?.candidate.assetId).toBe('a');
});

it('refuses a concurrent change between the first and final read',()=>{
 const before=readSiteCalibrationStrict(lease.capability);if(before.status!=='ready')throw new Error();
 const read=Storage.prototype.getItem,write=Storage.prototype.setItem;let count=0;
 const third=JSON.stringify({b:defaultSiteCalibration('b')});
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key){if(key===KEY&&++count===2)write.call(this,key,third);return read.call(this,key);});
 expect(writeSiteCalibrationStrict(defaultSiteCalibration('a'),before.snapshot,lease.capability).status).toBe('blocked');
 expect(localStorage.getItem(KEY)).toBe(third);
});
it('fails closed on malformed candidate without writing',()=>{
 const before=readSiteCalibrationStrict(lease.capability);if(before.status!=='ready')throw new Error();
 expect(writeSiteCalibrationStrict(null as never,before.snapshot,lease.capability).status).toBe('blocked');
 expect(localStorage.getItem(KEY)).toBeNull();
});
