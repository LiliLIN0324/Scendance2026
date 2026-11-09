import { readSourceScopeSnapshotV2, sameSourceScopeSnapshotV2, type SourceScopeSnapshotV2 } from './source-storage';

export type VenueSourceRevision = { status:'observed'; scope:string; digest:string } | { status:'unknown' };
export interface VenueSourceReadContext {
  /** Must become false immediately for unsaved edits, writes in flight, errors or scope changes. */
  isSettled(): boolean;
}
const unknown: VenueSourceRevision = {status:'unknown'};
const bytesToHex = (bytes:ArrayBuffer) => [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
async function sha256(bytes:BufferSource):Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('无法核验图纸原件。');
  return bytesToHex(await globalThis.crypto.subtle.digest('SHA-256',bytes));
}
/** Tagged canonical form preserves absent values, undefined, holes, file metadata and Blob bytes. */
async function canonical(value:unknown, ancestors=new Set<object>()):Promise<string> {
  if(value===undefined)return 'undefined';
  if(value===null)return 'null';
  if(typeof value==='string')return `string:${JSON.stringify(value)}`;
  if(typeof value==='boolean')return `boolean:${value}`;
  if(typeof value==='number'&&Number.isFinite(value))return `number:${Object.is(value,-0)?'-0':String(value)}`;
  if(typeof value!=='object'||ancestors.has(value))throw new Error('不支持的来源资料。');
  if(value instanceof Blob) {
    const tag=Object.prototype.toString.call(value);
    if(tag!=='[object Blob]'&&tag!=='[object File]')throw new Error('不支持的来源原件。');
    const file=tag==='[object File]'?value as File:null;
    return `blob:${JSON.stringify([value.type,value.size,file?.name??null,file?.lastModified??null])}:${await sha256(await value.arrayBuffer())}`;
  }
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new Error('不支持的来源元数据。');
  if(Object.getOwnPropertySymbols(value).length)throw new Error('不支持的来源元数据。');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.values(descriptors).some(descriptor=>!('value' in descriptor)))throw new Error('不支持的来源元数据。');
  ancestors.add(value);
  try {
    const keys=Object.keys(value).sort();const fields:string[]=[];
    for(const key of keys)fields.push(`${JSON.stringify(key)}:${await canonical((value as Record<string,unknown>)[key],ancestors)}`);
    return `${Array.isArray(value)?`array:${value.length}`:'object'}:{${fields.join(',')}}`;
  } finally {ancestors.delete(value);}
}
function validSources(snapshot:SourceScopeSnapshotV2,scope:string):boolean {
  const ids=new Set<string>();
  return snapshot.scope===scope && snapshot.sources.every(source=>{
    if(!source||source.scope!==scope||typeof source.id!=='string'||!source.id||ids.has(source.id)||
      !['floorplan','photo'].includes(source.kind)||!(source.blob instanceof Blob))return false;
    ids.add(source.id);return true;
  });
}
/**
 * A fresh observation, not a durable claim of currentness: callers must invalidate it on any
 * local/cross-tab change and repeat this read immediately before each dependent action.
 */
export async function readVenueSourceRevision(scope:string,context:VenueSourceReadContext):Promise<VenueSourceRevision> {
  try {
    if(typeof scope!=='string'||!scope.trim()||scope.length>128||!context.isSettled())return unknown;
    const first=await readSourceScopeSnapshotV2(scope);
    if(!context.isSettled()||!validSources(first,scope))return unknown;
    const sorted={...first,sources:[...first.sources].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};
    const encoded=await canonical(sorted);
    if(!context.isSettled())return unknown;
    const second=await readSourceScopeSnapshotV2(scope);
    if(!context.isSettled()||!validSources(second,scope)||!await sameSourceScopeSnapshotV2(first,second))return unknown;
    const digest=await sha256(new TextEncoder().encode(encoded));
    if(!context.isSettled())return unknown;
    return {status:'observed',scope,digest};
  } catch {return unknown;}
}
