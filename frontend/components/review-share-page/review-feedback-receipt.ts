import { isShareHash, readShareHash, MAX_SHARE_HASH_LENGTH } from '../room-organizer/lib/share';
import { floorElevation } from '../room-organizer/lib/storeys';
import type { ReviewPin } from '../room-organizer/lib/review-pins';

export type ReceiptPin = ReviewPin & {floorId:string};
export interface ReviewFeedbackReceipt {format:'scendance-review-feedback';version:1;planVersion:string;completed:boolean;pins:ReceiptPin[]}
const MAX_BYTES=256_000,MAX_PINS=80;
/** Exact link bytes identify this particular shared snapshot; not the local plan ID or 32-bit hash. */
export async function reviewVersionForHash(hash:string):Promise<string> {
  if(!isShareHash(hash)||hash.length>MAX_SHARE_HASH_LENGTH||!globalThis.crypto?.subtle)throw new Error('无法核对分享版本，请重新打开完整分享链接。');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(hash));
  return `sha256:${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}`;
}
function triple(v:unknown):v is [number,number,number] {return Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));}
function parsePin(raw:unknown):ReceiptPin {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('反馈钉格式无效。');
  const p=raw as Record<string,unknown>, camera=p.camera as Record<string,unknown>|null;
  if(Object.keys(p).sort().join(',')!=='camera,floorId,id,itemId,offset,status,text,x,y,z'||!camera||typeof camera!=='object'||Array.isArray(camera)||Object.keys(camera).sort().join(',')!=='position,target')throw new Error('反馈含有不支持的字段，请保留原文件并更新应用。');
  if(typeof p.id!=='string'||!p.id.trim()||p.id.length>80||typeof p.floorId!=='string'||!p.floorId.trim()||p.floorId.length>128||typeof p.text!=='string'||!p.text.trim()||[...p.text].length>80||
    !(p.itemId===null||typeof p.itemId==='string'&&p.itemId.length>0&&p.itemId.length<=128)||
    ![p.x,p.y,p.z].every(n=>typeof n==='number'&&Number.isFinite(n))||!(p.offset===null||triple(p.offset))||!camera||!triple(camera.position)||!triple(camera.target)||!(p.status==='open'||p.status==='resolved'))throw new Error('反馈钉内容或位置无效。');
  return {id:p.id,floorId:p.floorId,text:p.text,itemId:p.itemId as string|null,x:p.x as number,y:p.y as number,z:p.z as number,offset:p.offset as [number,number,number]|null,camera:{position:camera.position,target:camera.target},status:p.status};
}
function parseReceipt(json:string):ReviewFeedbackReceipt {
  if(typeof json!=='string'||new TextEncoder().encode(json).length>MAX_BYTES)throw new Error('反馈文件过大。');
  let raw:unknown;try{raw=JSON.parse(json);}catch{throw new Error('反馈文件不是有效 JSON。');}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('反馈文件格式无效。');
  const r=raw as Record<string,unknown>;
  if(Object.keys(r).sort().join(',')!=='completed,format,pins,planVersion,version')throw new Error('反馈含有不支持的字段，请保留原文件并更新应用。');
  if(r.format!=='scendance-review-feedback'||r.version!==1||typeof r.planVersion!=='string'||!/^sha256:[0-9a-f]{64}$/.test(r.planVersion)||typeof r.completed!=='boolean'||!Array.isArray(r.pins)||r.pins.length>MAX_PINS)throw new Error('反馈文件格式或版本无效。');
  const pins=r.pins.map(parsePin);if(new Set(pins.map(p=>p.id)).size!==pins.length)throw new Error('反馈文件包含重复编号。');
  return {format:'scendance-review-feedback',version:1,planVersion:r.planVersion,completed:r.completed,pins};
}
export function createReviewFeedbackReceipt(planVersion:string,pins:readonly ReceiptPin[],completed:boolean):string {
  return JSON.stringify(parseReceipt(JSON.stringify({format:'scendance-review-feedback',version:1,planVersion,completed,pins})),null,2);
}
/** Validates against the exact shared snapshot; returns a preview only, never writes. */
export async function inspectReviewFeedbackReceipt(json:string,shareHash:string,existing:readonly ReceiptPin[]=[]):Promise<{receipt:ReviewFeedbackReceipt;added:ReceiptPin[];duplicates:number}> {
  const receipt=parseReceipt(json), version=await reviewVersionForHash(shareHash);
  if(receipt.planVersion!==version)throw new Error('反馈属于其他分享版本，请选择对应的分享链接。');
  const decoded=await readShareHash(shareHash);if(!decoded.ok)throw new Error('分享方案无法读取，不能导入反馈。');
  for(const pin of receipt.pins){
    const index=decoded.layout.floors.findIndex(f=>f.id===pin.floorId),floor=decoded.layout.floors[index];
    if(!floor||!Number.isFinite(pin.y)||Math.abs(pin.y-floorElevation(decoded.layout.floors,index))>1e-6||
      Math.abs(pin.x)>decoded.layout.width/2+1e-6||Math.abs(pin.z)>decoded.layout.height/2+1e-6||
      (pin.itemId!==null&&!floor.items.some(item=>item.id===pin.itemId&&item.position)))throw new Error('反馈中的楼层、位置或物件不属于该分享版本。');
    const item=pin.itemId===null?null:floor.items.find(value=>value.id===pin.itemId);
    if(pin.itemId===null ? pin.offset!==null : !pin.offset||!item?.position||
      Math.abs(item.position.x+pin.offset[0]-pin.x)>1e-6||Math.abs(pin.offset[1])>1e-6||Math.abs(item.position.z+pin.offset[2]-pin.z)>1e-6)
      throw new Error('反馈位置与物件偏移不一致，未导入。');
  }
  const old=new Map(existing.map(pin=>{const clean=parsePin(pin);return [clean.id,clean] as const;}));
  if(old.size!==existing.length)throw new Error('已有反馈编号重复，未导入。');
  const added:ReceiptPin[]=[];let duplicates=0;
  for(const pin of receipt.pins){const previous=old.get(pin.id);if(!previous){added.push(pin);continue;}
    if(JSON.stringify(previous)!==JSON.stringify(pin))throw new Error('反馈编号与已有内容冲突，请人工核对。');duplicates++;}
  return {receipt,added,duplicates};
}
