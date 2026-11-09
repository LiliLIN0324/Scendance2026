import {captureWorkspaceWriteFence} from '@/lib/workspace-write-fence';
import {localWriteCapabilityGuard,type LocalWriteCapability} from '@/lib/local-write-lease';
import {sameRecoveryFormValue} from '@/lib/recovery-form-value';
import {SITE_CALIBRATION_STORAGE_KEY,type SiteCalibration} from './site-capture';

export type CalibrationSnapshot={raw:string|null;records:Record<string,SiteCalibration>};
export type CalibrationPending={before:CalibrationSnapshot;candidate:SiteCalibration;attemptedRaw:string};
export type CalibrationRead={status:'ready';snapshot:CalibrationSnapshot}|{status:'unknown';reason:string};
export type CalibrationWrite={status:'saved';snapshot:CalibrationSnapshot}|{status:'blocked'|'unknown';reason:string;candidate:SiteCalibration;pending?:CalibrationPending};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function validRecord(value:unknown,key:string):value is SiteCalibration {
 if(!object(value)||value.version!==1||value.assetId!==key||!key.trim()||key.length>128||!finite(value.scale)||value.scale<=0||!finite(value.yawDeg)||!finite(value.updatedAt))return false;
 if(!object(value.origin)||!finite(value.origin.x)||!finite(value.origin.z)||!object(value.ground)||!finite(value.ground.y)||!object(value.ground.normal)||
   !finite(value.ground.normal.x)||!finite(value.ground.normal.y)||!finite(value.ground.normal.z)||!Array.isArray(value.anchors)||value.anchors.length>24)return false;
 if(!value.anchors.every(anchor=>object(anchor)&&typeof anchor.id==='string'&&!!anchor.id&&typeof anchor.label==='string'&&
   ['stage','entrance','custom'].includes(String(anchor.kind))&&finite(anchor.x)&&finite(anchor.z)))return false;
 if(value.reference!==undefined&&(!object(value.reference)||!['x','y','z'].includes(String(value.reference.axis))||
   !finite(value.reference.knownMeters)||value.reference.knownMeters<=0||!finite(value.reference.measuredMeters)||value.reference.measuredMeters<=0))return false;
 try{return sameRecoveryFormValue(value,JSON.parse(JSON.stringify(value)));}catch{return false;}
}
function parse(raw:string|null):Record<string,SiteCalibration>|null {
 if(raw===null)return {};
 try {const value:unknown=JSON.parse(raw);if(!object(value)||Object.keys(value).length>1000)return null;
  if(!Object.entries(value).every(([key,record])=>validRecord(record,key)))return null;
  return value as Record<string,SiteCalibration>;
 } catch{return null;}
}
function guard(capability:LocalWriteCapability):()=>void {const value=localWriteCapabilityGuard(capability),fence=captureWorkspaceWriteFence(capability);return ()=>{fence?.();value.assertStillHeld();if(value.signal.aborted)throw new Error('编辑权已失效');};}
export function readSiteCalibrationStrict(capability:LocalWriteCapability):CalibrationRead {
 try{const check=guard(capability);check();const raw=window.localStorage.getItem(SITE_CALIBRATION_STORAGE_KEY);check();
  const records=parse(raw);return records?{status:'ready',snapshot:{raw,records}}:{status:'unknown',reason:'本机标定记录损坏，请保留原件。'};
 }catch{return {status:'unknown',reason:'本机标定记录暂不可读取或编辑权已失效。'};}
}
/** Only a whole-map expected snapshot may be replaced; unconfirmed writes return the unchanged candidate. */
export function writeSiteCalibrationStrict(candidate:SiteCalibration,expected:CalibrationSnapshot,capability:LocalWriteCapability):CalibrationWrite {
 let intended:SiteCalibration;
 try{intended=structuredClone(candidate);}catch{return {status:'blocked',reason:'标定候选无法读取。',candidate};}
 if(!intended||typeof intended.assetId!=='string'||!validRecord(intended,intended.assetId))return {status:'blocked',reason:'标定候选不完整，原记录未改变。',candidate:intended};
 let attempted=false,pending:CalibrationPending|undefined;
 try{const check=guard(capability);check();const before=readSiteCalibrationStrict(capability);
  if(before.status!=='ready')return {status:'blocked',reason:before.reason,candidate:intended};
  if(expected.raw!==before.snapshot.raw||!sameRecoveryFormValue(expected.records,before.snapshot.records))return {status:'blocked',reason:'标定记录已变化，请先核对。',candidate:intended};
  const records={...before.snapshot.records,[intended.assetId]:intended},json=JSON.stringify(records);
  if(!sameRecoveryFormValue(records,JSON.parse(json)))return {status:'blocked',reason:'标定候选不能无损保存。',candidate:intended};
  pending={before:structuredClone(before.snapshot),candidate:intended,attemptedRaw:json};
  check();if(window.localStorage.getItem(SITE_CALIBRATION_STORAGE_KEY)!==before.snapshot.raw)return {status:'blocked',reason:'标定记录已变化，请先核对。',candidate:intended};
  check();attempted=true;window.localStorage.setItem(SITE_CALIBRATION_STORAGE_KEY,json);check();
  if(window.localStorage.getItem(SITE_CALIBRATION_STORAGE_KEY)!==json)return {status:'unknown',reason:'标定保存结果待核对。',candidate:intended,pending};
  check();return {status:'saved',snapshot:{raw:json,records}};
 }catch{return attempted&&pending?{status:'unknown',reason:'标定保存结果待核对。',candidate:intended,pending}:{status:'blocked',reason:'无法安全写入标定记录。',candidate:intended};}
}
/** Read only; never retries or rolls back a potentially committed change. */
export function reconcileSiteCalibration(pending:CalibrationPending,capability:LocalWriteCapability):'confirmed'|'retryable'|'conflict'|'unknown' {
 const current=readSiteCalibrationStrict(capability);if(current.status!=='ready')return 'unknown';
 if(current.snapshot.raw===pending.attemptedRaw)return 'confirmed';
 if(current.snapshot.raw===pending.before.raw&&sameRecoveryFormValue(current.snapshot.records,pending.before.records))return 'retryable';
 return 'conflict';
}
/** A caller may offer this JSON as a local download without exposing other assets' data. */
export function exportCalibrationCandidate(pending:CalibrationPending):string {
 return JSON.stringify({version:1,candidate:pending.candidate},null,2);
}
