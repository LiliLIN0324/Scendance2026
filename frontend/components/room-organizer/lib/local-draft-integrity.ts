/**
 * A checksum for an exported local draft, not a signature, a backup, a venue
 * confirmation or a safety result. Only already-redacted export text belongs here.
 */
const FORMAT = 'scendance-local-draft-checksum';
const VERSION = 1;
const ALGORITHM = 'SHA-256';
const CANONICALIZATION = 'utf8-payload-v1';
const DRAFT_FORMAT = 'scendance-local-draft-delivery';
const MAX_BYTES = 16 * 1024 * 1024;
const NOTICE = '仅核对文件内容与所附摘要是否一致；摘要可被重新计算，不证明文件来源、内容真实、场地方确认或现场安全，也不是可恢复备份。';

type Envelope = {format:string;version:number;algorithm:string;canonicalization:string;payload:string;digest:string};
export type LocalDraftIntegrityResult = {
  status:'consistent'|'invalid'|'unavailable';
  reason:'consistent'|'invalid_format'|'digest_mismatch'|'crypto_unavailable';
  notice:string;
};

/** A short-lived, synchronous fence around snapshot creation and digest. */
export function captureLocalDraftIntegrityFence(current:()=>boolean,subscriptions:ReadonlyArray<(invalidate:()=>void)=>()=>void>):{isCurrent:()=>boolean;release:()=>void}|null {
  let invalidated=false,released=false;
  const cleanups:Array<()=>void>=[];
  const release=()=>{if(released)return;released=true;for(const cleanup of cleanups)try{cleanup();}catch{/* best effort */}};
  const isCurrent=()=>{if(released||invalidated)return false;try{return current();}catch{return false;}};
  try {
    if(!isCurrent())return null;
    for(const subscribe of subscriptions){const cleanup=subscribe(()=>{invalidated=true;});if(typeof cleanup!=='function')throw new Error('invalid subscription');cleanups.push(cleanup);}
    if(!isCurrent()){release();return null;}
    return {isCurrent,release};
  } catch {release();return null;}
}

function bytes(text:string):Uint8Array<ArrayBuffer> {
  // TextEncoder replaces lone surrogates; rejecting them prevents two distinct
  // JavaScript strings from acquiring identical replacement-byte checksums.
  for(let i=0;i<text.length;i++){
    const unit=text.charCodeAt(i);
    if(unit>=0xd800&&unit<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw new Error('草案文本编码无效，未生成摘要。');}
    else if(unit>=0xdc00&&unit<=0xdfff)throw new Error('草案文本编码无效，未生成摘要。');
  }
  const encoded=new TextEncoder().encode(text);
  if(encoded.byteLength>MAX_BYTES)throw new Error('本地草案超出校验大小，未生成摘要。');
  return encoded;
}

function isDraft(payload:string):boolean {
  try {
    const value:unknown=JSON.parse(payload);
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const record=value as Record<string,unknown>;
    const snapshot=record.snapshot;
    return record.format===DRAFT_FORMAT&&record.version===1&&record.state==='draft_unverified'&&
      !!record.layout&&typeof record.layout==='object'&&!Array.isArray(record.layout)&&
      !!snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)&&
      typeof (snapshot as Record<string,unknown>).id==='string'&&!!((snapshot as Record<string,unknown>).id as string).trim()&&
      typeof (snapshot as Record<string,unknown>).generatedAt==='string'&&Number.isFinite(Date.parse((snapshot as Record<string,unknown>).generatedAt as string));
  } catch { return false; }
}

/** Reject duplicate outer keys, including differently escaped spellings. */
function parseFlatEnvelope(text:string):Record<string,unknown>|null {
  let i=0;
  const whitespace=()=>{while(i<text.length&&/[\x20\t\r\n]/.test(text[i]!))i++;};
  const quoted=():string=>{
    const start=i;
    if(text[i++]!=='"')throw new Error('invalid');
    while(i<text.length){
      const ch=text[i++]!;
      if(ch==='\\'){if(i>=text.length)throw new Error('invalid');i++;continue;}
      if(ch==='"')return JSON.parse(text.slice(start,i)) as string;
    }
    throw new Error('invalid');
  };
  try {
    whitespace();if(text[i++]!=='{')return null;
    const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>,seen=new Set<string>();
    whitespace();if(text[i]==='}'){i++;whitespace();return i===text.length?result:null;}
    while(i<text.length){
      whitespace();const key=quoted();if(seen.has(key))return null;seen.add(key);
      whitespace();if(text[i++]!==':')return null;whitespace();
      if(text[i]==='"')result[key]=quoted();
      else {const token=text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(!token)return null;result[key]=JSON.parse(token[0]);i+=token[0].length;}
      whitespace();if(text[i]==='}'){i++;whitespace();return i===text.length?result:null;}if(text[i++]!==',')return null;
    }
  } catch { return null; }
  return null;
}

async function digest(payload:string):Promise<string> {
  if(!globalThis.crypto?.subtle)throw new Error('当前环境不支持文件摘要，未生成校验信息。');
  const hash=await globalThis.crypto.subtle.digest(ALGORITHM,bytes(payload));
  return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}

/** Preserve and checksum the exact UTF-8 bytes of the already-redacted JSON export. */
export async function sealLocalDraft(payloadJson:string):Promise<string> {
  if(typeof payloadJson!=='string')throw new Error('不是可核对的本地待核验草案，未生成摘要。');
  bytes(payloadJson);
  if(!isDraft(payloadJson))throw new Error('不是可核对的本地待核验草案，未生成摘要。');
  const hash=await digest(payloadJson);
  const envelope:Envelope={format:FORMAT,version:VERSION,algorithm:ALGORITHM,canonicalization:CANONICALIZATION,payload:payloadJson,digest:hash};
  const output=JSON.stringify(envelope,null,2);bytes(output);return output;
}

/** Verify only byte consistency; any person can change both payload and checksum. */
export async function verifyLocalDraft(sealedJson:string):Promise<LocalDraftIntegrityResult> {
  const invalid=(reason:'invalid_format'|'digest_mismatch'):LocalDraftIntegrityResult=>({status:'invalid',reason,notice:NOTICE});
  if(typeof sealedJson!=='string')return invalid('invalid_format');
  try { if(bytes(sealedJson).byteLength>MAX_BYTES)return invalid('invalid_format'); } catch { return invalid('invalid_format'); }
  const parsed=parseFlatEnvelope(sealedJson);
  if(!parsed||Object.keys(parsed).sort().join(',')!=='algorithm,canonicalization,digest,format,payload,version'||
    parsed.format!==FORMAT||parsed.version!==VERSION||parsed.algorithm!==ALGORITHM||parsed.canonicalization!==CANONICALIZATION||
    typeof parsed.payload!=='string'||typeof parsed.digest!=='string'||!/^[0-9a-f]{64}$/.test(parsed.digest)||!isDraft(parsed.payload))return invalid('invalid_format');
  try { bytes(parsed.payload); } catch { return invalid('invalid_format'); }
  if(!globalThis.crypto?.subtle)return {status:'unavailable',reason:'crypto_unavailable',notice:NOTICE};
  try {
    return (await digest(parsed.payload))===parsed.digest
      ?{status:'consistent',reason:'consistent',notice:NOTICE}:invalid('digest_mismatch');
  } catch { return {status:'unavailable',reason:'crypto_unavailable',notice:NOTICE}; }
}
