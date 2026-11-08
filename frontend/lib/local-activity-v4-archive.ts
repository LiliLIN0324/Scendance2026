import {sha256} from '../../supabase/functions/_shared/domain';
import {localWriteCapabilityGuard,type LocalWriteCapability} from './local-write-lease';
import {captureWorkspaceWriteFence} from './workspace-write-fence';
import {addSourceRecord,listExactSourceNamespace,readSourceRecordSnapshot,type SourceWriteGuard} from './source-storage';
import {parseLocalProjectBackupJson} from './local-project-backup';
import {decodeSourceDocuments} from './source-backup';

/** Independent staging only; never opens or applies an activity. */
export const ACTIVITY_V4_ARCHIVE_NAMESPACE='local-activity-v4-immutable';
type ArchiveRecord={version:1;scope:string;id:string;sha256:string;backupJson:string};
export type ActivityV4ArchiveResult={status:'saved'|'unknown';archiveId:string;contentSha256:string};
const validId=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function validateBackup(text:string,scope:string){
 const parsed=parseLocalProjectBackupJson(text);
 if(parsed.source!=='backup'||parsed.backupVersion!==4||parsed.layout.id!==scope||parsed.brief.status==='not-in-file'||
   parsed.materialCheckins.status==='not-in-file'||parsed.sourceDocuments.status!=='present')throw new Error('仅接受同一活动的完整 V4 备份，原资料未改变。');
 return {...parsed,sourceDocuments:parsed.sourceDocuments};
}
/** The supplied backup must already be flushed and bound to the same live activity revision. */
export async function stageLocalActivityV4(input:{backupJson:string;scope:string;capability:LocalWriteCapability;isCurrent():boolean}):Promise<ActivityV4ArchiveResult>{
 const {backupJson,scope,capability,isCurrent}=input;
 if(typeof scope!=='string'||!scope.trim()||scope.length>128)throw new Error('活动编号无效，未创建归档。');
 const backup=validateBackup(backupJson,scope);
 const capabilityGuard=localWriteCapabilityGuard(capability),fence=captureWorkspaceWriteFence(capability);
 const check=()=>{fence?.();capabilityGuard.assertStillHeld();if(capabilityGuard.signal.aborted||isCurrent()!==true)throw new Error('活动或编辑权已变化，原资料保留。');};
 check();await decodeSourceDocuments(backup.sourceDocuments,scope);check();
 const digest=await sha256(backupJson);check();
 const archiveId=crypto.randomUUID();if(!validId(archiveId))throw new Error('无法创建归档编号，原资料未改变。');
 const record:ArchiveRecord={version:1,id:archiveId,scope,sha256:digest,backupJson};
 const guard:SourceWriteGuard={kind:'ordinary',signal:capabilityGuard.signal,assertStillHeld:check};
 try {
  await addSourceRecord([ACTIVITY_V4_ARCHIVE_NAMESPACE,archiveId],record,guard);check();
  const readback=await readSourceRecordSnapshot([ACTIVITY_V4_ARCHIVE_NAMESPACE,archiveId]);check();
  if(!readback.present||!readback.value||typeof readback.value!=='object')return {status:'unknown',archiveId,contentSha256:digest};
  const saved=readback.value as Partial<ArchiveRecord>;
  if(saved.version!==1||saved.id!==archiveId||saved.scope!==scope||saved.sha256!==digest||saved.backupJson!==backupJson)return {status:'unknown',archiveId,contentSha256:digest};
  const restored=validateBackup(saved.backupJson,scope);await decodeSourceDocuments(restored.sourceDocuments,scope);check();
  if(await sha256(saved.backupJson)!==digest)return {status:'unknown',archiveId,contentSha256:digest};check();
  return {status:'saved',archiveId,contentSha256:digest};
 }catch{return {status:'unknown',archiveId,contentSha256:digest};}
}

/** Exact bytes, dimensions, local zones and check-in records remain in the validated V4 JSON. */
export async function readStagedLocalActivityV4(archiveId:string,expectedScope:string,expectedSha256:string):Promise<string>{
 if(!validId(archiveId)||!expectedScope.trim()||!/^[0-9a-f]{64}$/.test(expectedSha256))throw new Error('归档编号、活动范围或内容依据无效。');
 const snapshot=await readSourceRecordSnapshot([ACTIVITY_V4_ARCHIVE_NAMESPACE,archiveId]);
 if(!snapshot.present||!snapshot.value||typeof snapshot.value!=='object')throw new Error('归档无法完整读取，请保留原资料。');
 const record=snapshot.value as Partial<ArchiveRecord>;
 if(Object.keys(record).sort().join(',')!=='backupJson,id,scope,sha256,version'||record.version!==1||record.id!==archiveId||record.scope!==expectedScope||typeof record.backupJson!=='string'||record.sha256!==expectedSha256||await sha256(record.backupJson)!==expectedSha256)throw new Error('归档内容或活动范围无法核对，请保留原资料。');
 const restored=validateBackup(record.backupJson,expectedScope);await decodeSourceDocuments(restored.sourceDocuments,expectedScope);return record.backupJson;
}

/** Locate crash-orphaned archives; any malformed, excessive or unverified record aborts the entire result. */
export async function listStagedLocalActivityV4(expectedScope:string):Promise<Array<{archiveId:string;contentSha256:string}>>{
 if(typeof expectedScope!=='string'||!expectedScope.trim()||expectedScope.length>128)throw new Error('活动范围无效。');
 const records=await listExactSourceNamespace(ACTIVITY_V4_ARCHIVE_NAMESPACE,100);
 const discovered:Array<{archiveId:string;contentSha256:string}>=[];
 for(const {key,value} of records){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('归档无法完整读取，请保留原资料。');
  const record=value as Partial<ArchiveRecord>;
  if(Object.keys(record).sort().join(',')!=='backupJson,id,scope,sha256,version'||record.version!==1||record.id!==key[1]||!validId(key[1])||
    typeof record.scope!=='string'||!record.scope.trim()||record.scope.length>128||typeof record.backupJson!=='string'||typeof record.sha256!=='string'||
    !/^[0-9a-f]{64}$/.test(record.sha256)||await sha256(record.backupJson)!==record.sha256)throw new Error('归档内容无法完整核对，请保留原资料。');
  const restored=validateBackup(record.backupJson,record.scope);await decodeSourceDocuments(restored.sourceDocuments,record.scope);
  if(record.scope===expectedScope)discovered.push({archiveId:key[1],contentSha256:record.sha256});
 }
 return discovered;
}
