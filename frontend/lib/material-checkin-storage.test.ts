import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { materialCheckinLedgerSchema } from '../../supabase/functions/_shared/material-checkin-contract';
import { checkedMaterialCheckins, materialCheckinStorageKey, mergeStoredMaterialCheckins, readMaterialCheckins, restoreMaterialCheckinsIfUnchanged } from './material-checkin-storage';
import { readSourceRecord, updateSourceForm } from './source-storage';
import { createLocalWriteLeaseManager, type LocalWriteCapability } from './local-write-lease';

vi.mock('./source-storage', () => ({ readSourceRecord: vi.fn(), updateSourceForm: vi.fn() }));
const records = new Map<string, unknown>();
const id = (n: number) => `ab900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = 'house-checkin-rehearsal';
function ledger(n = 1) {
  return materialCheckinLedgerSchema.parse({ projectId, dataKind: 'rehearsal', sheets: [{
    id: id(n), acquisitionId: id(100), acquisitionSnapshot: { title: '演练租赁椅' }, unit: 'piece',
    agreements: [{ id: id(n + 1000), agreedQuantity: 20, basisNote: '演练约定，不是真实合同', recordedAt: '2026-10-09T01:00:00+08:00', recordedBy: '演练统筹' }], events: [],
  }] });
}
beforeEach(() => {
  records.clear(); vi.clearAllMocks();
  vi.mocked(readSourceRecord).mockImplementation(async key => structuredClone(records.get(JSON.stringify(key))) as never);
  vi.mocked(updateSourceForm).mockImplementation(async (key, update, guard) => {
    guard?.assertStillHeld();
    const address = JSON.stringify(key), next = update(structuredClone(records.get(address)));
    guard?.assertStillHeld();
    if (next === undefined) records.delete(address); else records.set(address, structuredClone(next));
    return structuredClone(next) as never;
  });
});

afterEach(()=>vi.unstubAllGlobals());

describe('project-bound material checkin storage', () => {
  it('uses a compound key and retains no-ledger absence instead of inventing zeros', async () => {
    expect(materialCheckinStorageKey(projectId)).toEqual(['material-checkins', projectId]);
    expect(await readMaterialCheckins(projectId)).toBeUndefined();
    expect(() => materialCheckinStorageKey('')).toThrow('明确编号');
    expect(() => materialCheckinStorageKey('x'.repeat(129))).toThrow('明确编号');
  });
  it('merges separately based proposals against the stored current ledger without losing either sheet', async () => {
    const first = ledger(1), second = ledger(2);
    await Promise.all([mergeStoredMaterialCheckins(projectId, first), mergeStoredMaterialCheckins(projectId, second)]);
    const saved = await readMaterialCheckins(projectId);
    expect(saved!.sheets.map(sheet => sheet.id)).toEqual([id(1), id(2)]);
    expect(first.sheets).toHaveLength(1); expect(second.sheets).toHaveLength(1);
    await mergeStoredMaterialCheckins(projectId, first); expect((await readMaterialCheckins(projectId))!.sheets).toHaveLength(2);
  });
  it('refuses cross-project and conflicting record content without changing the saved ledger', async () => {
    const original = ledger(); await mergeStoredMaterialCheckins(projectId, original);
    await expect(mergeStoredMaterialCheckins(projectId, undefined as never)).rejects.toThrow('没有可保存');
    await expect(mergeStoredMaterialCheckins('another-project', original)).rejects.toThrow('另一个项目');
    const conflicting = structuredClone(original); conflicting.sheets[0].agreements[0].agreedQuantity = 19;
    await expect(mergeStoredMaterialCheckins(projectId, conflicting)).rejects.toThrow();
    expect(await readMaterialCheckins(projectId)).toEqual(original);
  });
  it('preserves unreadable stored data and lets a caller stop a stale write inside the transaction', async () => {
    const key = JSON.stringify(materialCheckinStorageKey(projectId)); records.set(key, { broken: true });
    await expect(mergeStoredMaterialCheckins(projectId, ledger())).rejects.toThrow('原资料已保留');
    expect(records.get(key)).toEqual({ broken: true }); records.clear();
    await expect(mergeStoredMaterialCheckins(projectId, ledger(), () => { throw new Error('项目已切换'); })).rejects.toThrow('项目已切换');
    expect(await readMaterialCheckins(projectId)).toBeUndefined();
  });
  it('compensates only an unchanged import and refuses to overwrite a later record', async () => {
    const imported = await mergeStoredMaterialCheckins(projectId, ledger());
    await restoreMaterialCheckinsIfUnchanged(projectId, imported, undefined);
    expect(await readMaterialCheckins(projectId)).toBeUndefined();
    await mergeStoredMaterialCheckins(projectId, imported); await mergeStoredMaterialCheckins(projectId, ledger(2));
    await expect(restoreMaterialCheckinsIfUnchanged(projectId, imported, undefined)).rejects.toThrow('新变化');
    expect((await readMaterialCheckins(projectId))!.sheets).toHaveLength(2);
  });
  it('并发更新时失效凭证不能覆盖另一持有者已保存的账册',async()=>{
    const values=new Map<string,string>();const store={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
    const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'writer'});}} as unknown as LockManager;
    vi.stubGlobal('window',{localStorage:store});vi.stubGlobal('navigator',{locks});
    const manager=createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>store}),a=await manager.acquire(),b=await manager.acquire();
    let resume!:()=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
    vi.mocked(updateSourceForm).mockImplementationOnce(async(key,update,guard)=>{
      guard?.assertStillHeld();const next=update(structuredClone(records.get(JSON.stringify(key))));started();
      await new Promise<void>(resolve=>{resume=resolve;});guard?.assertStillHeld();records.set(JSON.stringify(key),structuredClone(next));return next as never;
    });
    const stale=mergeStoredMaterialCheckins(projectId,ledger(1),()=>{},a.capability);void stale.catch(()=>{});await began;
    await mergeStoredMaterialCheckins(projectId,ledger(2),()=>{},b.capability);await a.release();resume();
    await expect(stale).rejects.toThrow('失效');expect((await readMaterialCheckins(projectId))?.sheets.map(row=>row.id)).toEqual([id(2)]);await b.release();
  });
  it('伪造普通能力在写事务前被拒绝',async()=>{
    await expect(mergeStoredMaterialCheckins(projectId,ledger(),()=>{},{kind:'ordinary'} as unknown as LocalWriteCapability)).rejects.toThrow('凭证无效');
    expect(updateSourceForm).not.toHaveBeenCalled();
  });
  it('rejects invalid future fields and never treats another ledger as an empty local one', () => {
    expect(() => checkedMaterialCheckins(projectId, { ...ledger(), futureData: [] })).toThrow('无法完整读取');
    expect(() => checkedMaterialCheckins(projectId, { ...ledger(), projectId: 'other' })).toThrow('另一个项目');
  });
});
