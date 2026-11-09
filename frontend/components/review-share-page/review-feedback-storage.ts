import {localWriteCapabilityGuard,type LocalWriteCapability} from '@/lib/local-write-lease';
import {captureWorkspaceWriteFence} from '@/lib/workspace-write-fence';
import {createReviewFeedbackReceipt,inspectReviewFeedbackReceipt,reviewVersionForHash,type ReceiptPin} from './review-feedback-receipt';
import {REVIEW_SHARE_PIN_STORAGE_KEY_V2} from './share-pins';

type Store=Pick<Storage,'getItem'|'setItem'>;
type FeedbackFile={version:1;byPlan:Record<string,unknown>;completedByPlan?:Record<string,boolean>;[key:string]:unknown};
function parseFile(raw:string|null):FeedbackFile {
  if(raw===null)return {version:1,byPlan:{}};
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error('本机反馈无法完整读取，未写入。');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('本机反馈无法完整读取，未写入。');
  const file=value as FeedbackFile;
  if(file.version!==1||!file.byPlan||typeof file.byPlan!=='object'||Array.isArray(file.byPlan))throw new Error('本机反馈无法完整读取，未写入。');
  for(const [key,pins] of Object.entries(file.byPlan)){
    if(!/^review-v2:[0-9a-f]{64}$/.test(key)||!Array.isArray(pins))throw new Error('本机反馈无法完整读取，未写入。');
    createReviewFeedbackReceipt(`sha256:${key.slice(10)}`,pins as ReceiptPin[],false);
  }
  if(file.completedByPlan!==undefined&&(!file.completedByPlan||typeof file.completedByPlan!=='object'||Array.isArray(file.completedByPlan)||
    Object.entries(file.completedByPlan).some(([key,value])=>!/^review-v2:[0-9a-f]{64}$/.test(key)||typeof value!=='boolean')))throw new Error('本机反馈完成记录无法完整读取，未写入。');
  return file;
}
export async function readImportedReviewFeedback(storage:Pick<Storage,'getItem'>,shareHash:string):Promise<{pins:ReceiptPin[];reportedCompleted:boolean}> {
  const version=await reviewVersionForHash(shareHash),raw=storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2),file=parseFile(raw),key=`review-v2:${version.slice(7)}`;
  const pins=(file.byPlan[key]??[]) as ReceiptPin[];
  await inspectReviewFeedbackReceipt(createReviewFeedbackReceipt(version,pins,false),shareHash);
  if(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)!==raw)throw new Error('本机反馈在核对期间已变化，请重新读取。');
  return {pins,reportedCompleted:file.completedByPlan?.[key]===true};
}
/** User initiated only; file-reported completion is not identity verification or acceptance. */
export async function importReviewFeedback(storage:Store,json:string,shareHash:string,capability?:LocalWriteCapability,isCurrent?:()=>boolean):Promise<{state:'applied';added:number;duplicates:number;reportedCompleted:boolean}|{state:'unknown'}> {
  const guard=capability?localWriteCapabilityGuard(capability):undefined;
  const fence=captureWorkspaceWriteFence(capability);
  const check=()=>{fence?.();guard?.assertStillHeld();if(guard?.signal.aborted)throw new Error('本机编辑权已失效。');if(isCurrent&&isCurrent()!==true)throw new Error('活动或分享版本已变化，未导入反馈。');};
  check();if(!navigator.locks?.request)throw new Error('浏览器无法安全协调多个页面，未导入反馈。');
  return navigator.locks.request('scendance:review-feedback-pins',{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('另一页面正在修改反馈，请稍后重试。');
    check();const raw=storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2),file=parseFile(raw);
    const version=await reviewVersionForHash(shareHash),key=`review-v2:${version.slice(7)}`;check();
    const existing=(file.byPlan[key]??[]) as ReceiptPin[];
    await inspectReviewFeedbackReceipt(createReviewFeedbackReceipt(version,existing,false),shareHash);check();
    const result=await inspectReviewFeedbackReceipt(json,shareHash,existing);check();
    if(!(key in file.byPlan)&&Object.keys(file.byPlan).length>=40)throw new Error('本机反馈版本已满，请先备份并处理旧反馈。');
    if(existing.length+result.added.length>80)throw new Error('这一版反馈超过 80 条上限，未导入；请保留原反馈文件。');
    file.byPlan[key]=[...existing,...result.added];
    file.completedByPlan={...file.completedByPlan,[key]:file.completedByPlan?.[key]===true||result.receipt.completed};
    const next=JSON.stringify(file);check();if(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)!==raw)throw new Error('反馈在核对期间已变化，未导入。');
    try {check();storage.setItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2,next);check();if(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)!==next)throw new Error();check();}
    catch{return {state:'unknown' as const};}
    return {state:'applied' as const,added:result.added.length,duplicates:result.duplicates,reportedCompleted:file.completedByPlan[key]===true};
  });
}
