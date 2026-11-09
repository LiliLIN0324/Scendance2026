import {afterEach,describe,expect,it,vi} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {localDraftDeliveryJson} from './local-draft-delivery';
import {captureLocalDraftIntegrityFence,sealLocalDraft,verifyLocalDraft} from './local-draft-integrity';

function draft():string {
 const items=Array.from({length:60},(_,index)=>makeItem({id:`物件-${index}`,name:index%2?'示意椅':'示意桌',type:index%2?'chair':'desk',position:{x:index%10,z:Math.floor(index/10)}}));
 return localDraftDeliveryJson(makeLayout({name:'中文活动\n待核验',width:20,height:20,floors:[makeFloor({items})]}),{id:'草案-1',generatedAt:'2026-11-08T01:02:03.000Z'});
}
afterEach(()=>vi.unstubAllGlobals());

describe('local exported draft checksum',()=>{
 it('invalidates the capture on an A→B→A transition even if current values return to A',()=>{
  let value='A',invalidate=()=>{},unsubscribed=false;
  const capture=captureLocalDraftIntegrityFence(()=>value==='A',[listener=>{invalidate=listener;return()=>{unsubscribed=true;};}]);
  expect(capture?.isCurrent()).toBe(true);
  value='B';invalidate();value='A';invalidate();
  expect(capture?.isCurrent()).toBe(false);capture?.release();expect(unsubscribed).toBe(true);
 });
 it('fails closed and releases listeners if identity cannot be observed or subscription fails',()=>{
  let unsubscribed=false;
  const result=captureLocalDraftIntegrityFence(()=>true,[()=>()=>{unsubscribed=true;},()=>{throw Error('unavailable');}]);
  expect(result).toBeNull();expect(unsubscribed).toBe(true);
  expect(captureLocalDraftIntegrityFence(()=>false,[])).toBeNull();
 });
 it('checks exact redacted UTF-8 payload for sixty items, retaining unknown facts and metadata',async()=>{
  const payload=draft(),sealed=await sealLocalDraft(payload),envelope=JSON.parse(sealed);
  expect(envelope).toMatchObject({format:'scendance-local-draft-checksum',version:1,algorithm:'SHA-256',canonicalization:'utf8-payload-v1',payload});
  expect(envelope.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.parse(envelope.payload).layout.floors[0].items).toHaveLength(60);
  expect(JSON.parse(envelope.payload).confirmations.venue).toBe('unknown');
  expect(await verifyLocalDraft(sealed)).toMatchObject({status:'consistent',reason:'consistent'});
  expect((await verifyLocalDraft(sealed)).notice).toContain('不证明文件来源');
  expect(await sealLocalDraft(payload)).toBe(sealed);
 });
 it('does not depend on outer key order, but detects every payload byte including whitespace and snapshot metadata',async()=>{
  const original=JSON.parse(await sealLocalDraft(draft()));
  const reordered=JSON.stringify({digest:original.digest,payload:original.payload,version:original.version,canonicalization:original.canonicalization,format:original.format,algorithm:original.algorithm});
  expect((await verifyLocalDraft(reordered)).status).toBe('consistent');
  for(const payload of [original.payload+' ',original.payload.replace('草案-1','草案-2'),original.payload.replace('01:02:03','01:02:04'),original.payload.replace('示意椅','实物椅')]){
   expect(await verifyLocalDraft(JSON.stringify({...original,payload}))).toMatchObject({status:'invalid',reason:'digest_mismatch'});
  }
 });
 it('rejects changed outer metadata, missing digest, extra fields and duplicate escaped keys',async()=>{
  const envelope=JSON.parse(await sealLocalDraft(draft()));
  for(const altered of [{...envelope,version:2},{...envelope,algorithm:'SHA-1'},{...envelope,canonicalization:'other'},{...envelope,format:'other'},{...envelope,digest:undefined},{...envelope,other:'not covered'}]){
   expect((await verifyLocalDraft(JSON.stringify(altered))).status).toBe('invalid');
  }
  const raw=JSON.stringify(envelope).replace('{','{"\\u0066ormat":"scendance-local-draft-checksum",');
  expect(await verifyLocalDraft(raw)).toMatchObject({status:'invalid',reason:'invalid_format'});
  expect((await verifyLocalDraft('{not json')).status).toBe('invalid');
 });
 it('requires a draft with snapshot metadata and never treats a checksum as proof of authenticity',async()=>{
  await expect(sealLocalDraft('{}')).rejects.toThrow();
  const withoutSnapshot=JSON.parse(draft());delete withoutSnapshot.snapshot;
  await expect(sealLocalDraft(JSON.stringify(withoutSnapshot))).rejects.toThrow();
  const fabricated=JSON.parse(draft());fabricated.confirmations.venue='confirmed';
  const result=await verifyLocalDraft(await sealLocalDraft(JSON.stringify(fabricated)));
  expect(result.status).toBe('consistent');
  expect(result.notice).toContain('摘要可被重新计算');
  expect(result.notice).toContain('不证明');
 });
 it('fails closed when Web Crypto is unavailable or rejects',async()=>{
  const sealed=await sealLocalDraft(draft());
  vi.stubGlobal('crypto',{});
  await expect(sealLocalDraft(draft())).rejects.toThrow('当前环境不支持');
  expect(await verifyLocalDraft(sealed)).toMatchObject({status:'unavailable',reason:'crypto_unavailable'});
  vi.stubGlobal('crypto',{subtle:{digest:vi.fn().mockRejectedValue(new Error('unavailable'))}});
  expect(await verifyLocalDraft(sealed)).toMatchObject({status:'unavailable',reason:'crypto_unavailable'});
 });
 it('rejects lone surrogate payloads rather than hashing replacement bytes',async()=>{
  const malformed=draft().replace('中文活动',`中文${String.fromCharCode(0xd800)}活动`);
  await expect(sealLocalDraft(malformed)).rejects.toThrow('编码无效');
  const valid=JSON.parse(await sealLocalDraft(draft()));
  expect(await verifyLocalDraft(JSON.stringify({...valid,payload:malformed}))).toMatchObject({status:'invalid',reason:'invalid_format'});
 });
});
