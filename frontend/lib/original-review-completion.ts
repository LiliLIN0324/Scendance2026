import {isOriginalReviewReceipt,originalReviewReceiptKey,readOriginalReviewPending,type OriginalReviewReceipt} from './original-review-commit';

/** Implementations must durably commit individual writes and enumerate every entry. */
export interface OriginalReviewCompletionStore {
  get(key:string):Promise<unknown | null>;
  put(key:string,value:OriginalReviewCompletion):Promise<void>;
  delete(key:string):Promise<void>;
  list():Promise<Array<{key:string;value:unknown}>>;
}
export interface OriginalReviewCompletion {version:1;receipt:OriginalReviewReceipt;appliedRevision:number}
export interface OriginalReviewCloudEvidence {
  projectId:string;reviewId:string;baseHash:string;candidateHash:string;baseRevision:number;
  appliedRevision:number | null;currentRevision:number;currentSceneHash:string;
}
const isolatedStorage=new WeakSet<object>(),isolatedLedgers=new WeakSet<object>();
/** Creates only in-memory test data; never wraps browser storage or IndexedDB. */
export function createIsolatedOriginalReviewStore(){
  const local=new Map<string,string>(),data=new Map<string,OriginalReviewCompletion>();
  const storage={get length(){return local.size;},key:(n:number)=>Array.from(local.keys())[n]??null,getItem:(k:string)=>local.get(k)??null,setItem:(k:string,v:string)=>{local.set(k,v);},removeItem:(k:string)=>{local.delete(k);}};
  const ledger:OriginalReviewCompletionStore={get:async k=>data.get(k)??null,put:async(k,v)=>{data.set(k,v);},delete:async k=>{data.delete(k);},list:async()=>Array.from(data,([key,value])=>({key,value}))};
  Object.freeze(storage);isolatedStorage.add(storage);isolatedLedgers.add(ledger);
  return {storage,ledger,local,data};
}
function same(a:unknown,b:unknown):boolean {return JSON.stringify(a)===JSON.stringify(b);}
function valid(value:unknown):value is OriginalReviewCompletion {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).sort().join(',')==='appliedRevision,receipt,version'&&v.version===1&&isOriginalReviewReceipt(v.receipt)&&v.appliedRevision===v.receipt.baseRevision+1;
}
function evidenceMatches(receipt:OriginalReviewReceipt,evidence:OriginalReviewCloudEvidence):boolean {
  return evidence.projectId===receipt.projectId&&evidence.reviewId===receipt.reviewId&&evidence.baseHash===receipt.baseHash&&
    evidence.candidateHash===receipt.candidateHash&&evidence.baseRevision===receipt.baseRevision&&
    evidence.appliedRevision===receipt.baseRevision+1&&evidence.currentRevision===receipt.baseRevision+1&&evidence.currentSceneHash===receipt.candidateHash;
}

/**
 * Under the same project lock as submission, validate the original server
 * record and current raw scene. Never trust a projected scene as evidence.
 * This is a protocol core: callers must integrate a durable store and audit
 * both stores before enabling any project writes.
 */
export async function reconcileIsolatedOriginalReviewCompletion(options:{
  accountId:string;projectId:string;storage:Pick<Storage,'getItem'|'removeItem'>;ledger:OriginalReviewCompletionStore;
  isCurrent:()=>boolean;readCloud:()=>Promise<OriginalReviewCloudEvidence>;
}):Promise<'cleared'|'blocked'> {
  const {accountId,projectId,storage,ledger,isCurrent,readCloud}=options;
  try {
    if(!isolatedStorage.has(storage)||!isolatedLedgers.has(ledger))return 'blocked';
    const key=originalReviewReceiptKey(accountId,projectId);
    if(!isCurrent())return 'blocked';
    const pending=readOriginalReviewPending(storage,key),old=await ledger.get(key);
    if(!isCurrent()||pending.state==='unavailable'||(old!==null&&!valid(old)))return 'blocked';
    const receipt=pending.state==='pending'?pending.receipt:old&&valid(old)?old.receipt:null;
    if(!receipt||receipt.projectId.toLowerCase()!==projectId.toLowerCase()||(old!==null&&(!valid(old)||!same(old.receipt,receipt))))return 'blocked';
    const cloud=await readCloud();
    if(!isCurrent()||!evidenceMatches(receipt,cloud))return 'blocked';
    const completion:OriginalReviewCompletion={version:1,receipt,appliedRevision:receipt.baseRevision+1};
    if(old===null){await ledger.put(key,completion);if(!isCurrent()||!same(await ledger.get(key),completion))return 'blocked';}
    else if(!same(old,completion))return 'blocked';
    const latest=readOriginalReviewPending(storage,key);
    if(latest.state==='unavailable'||(latest.state==='pending'&&!same(latest.receipt,receipt)))return 'blocked';
    if(latest.state==='pending')storage.removeItem(key);
    if(!isCurrent()||storage.getItem(key)!==null)return 'blocked';
    // If the deletion succeeds but its response is lost, the preconditions
    // were already durable and checked. A subsequent unreadable audit blocks.
    await ledger.delete(key);
    if(!isCurrent()||await ledger.get(key)!==null||storage.getItem(key)!==null)return 'blocked';
    return 'cleared';
  } catch {return 'blocked';}
}

/** Full enumeration is required; missing, malformed or unreadable stores block. */
export async function auditOriginalReviewStartup(options:{storage:Pick<Storage,'getItem'|'key'|'length'>;ledger:OriginalReviewCompletionStore}):Promise<'clear'|'blocked'> {
  try {
    // Probe even an apparently empty storage; otherwise inaccessible storage
    // that reports length zero could be mistaken for a clean startup.
    options.storage.getItem('scendance:original-review:availability-probe');
    const entries=await options.ledger.list();
    if(entries.length)return 'blocked';
    for(let index=0;index<options.storage.length;index++){
      const key=options.storage.key(index);
      if(key===null)return 'blocked';
      if(key.startsWith('scendance:original-review:')&&readOriginalReviewPending(options.storage,key).state!=='none')return 'blocked';
    }
    return 'clear';
  } catch {return 'blocked';}
}
