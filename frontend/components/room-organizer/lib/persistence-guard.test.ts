import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { STORAGE_KEY } from './constants';
import { backupStoredLayout, discardRecoveryCopy, RECOVERY_STORAGE_KEY, resetStoredLayout, saveLayout, type RawStore } from './persistence';
import { recordSnapshot, VERSION_HISTORY_META_KEY, VERSION_HISTORY_STORAGE_KEY } from './version-history';

function memory() {
  const data = new Map<string,string>();
  const storage: RawStore = {
    get length(){return data.size;},key(index){return [...data.keys()][index]??null;},
    getItem(key){return data.get(key)??null;},setItem(key,value){data.set(key,value);},removeItem(key){data.delete(key);},
  };
  return { data, storage };
}
const original=()=>makeLayout({id:'activity',name:'原布局',floors:[makeFloor({items:[makeItem({id:'chair',type:'chair'})]})]});

describe('explicit storage write guard',()=>{
  it('never starts saving or deleting a recovery copy after loss',()=>{
    const {data,storage}=memory(), raw=JSON.stringify(original());data.set(STORAGE_KEY,raw);data.set(`${RECOVERY_STORAGE_KEY}-100-a`,'old-copy');
    const guard=()=>{throw new Error('租约已失效');};
    expect(saveLayout(original(),storage,guard).ok).toBe(false);
    expect(backupStoredLayout(storage,200,guard)).toBe(false);
    expect(discardRecoveryCopy(`${RECOVERY_STORAGE_KEY}-100-a`,storage,guard)).toBe(false);
    expect(data.get(STORAGE_KEY)).toBe(raw);expect(data.get(`${RECOVERY_STORAGE_KEY}-100-a`)).toBe('old-copy');
  });
  it('keeps main data and old versions when quota blocks a guarded save instead of evicting',()=>{
    const {data,storage}=memory(),raw=JSON.stringify(original());data.set(STORAGE_KEY,raw);data.set(VERSION_HISTORY_STORAGE_KEY,'old-snapshots');
    const writes=vi.spyOn(storage,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
    const remove=vi.spyOn(storage,'removeItem');
    expect(saveLayout(original(),storage,()=>{})).toEqual({ok:false,reason:'quota'});
    expect(writes).toHaveBeenCalledOnce();expect(remove).not.toHaveBeenCalled();
    expect(data.get(STORAGE_KEY)).toBe(raw);expect(data.get(VERSION_HISTORY_STORAGE_KEY)).toBe('old-snapshots');
  });
  it('keeps the main original when permission is lost after the recovery copy but before reset removal',()=>{
    const {data,storage}=memory(),raw=JSON.stringify(original());data.set(STORAGE_KEY,raw);
    let held=true;const originalSet=storage.setItem.bind(storage);
    vi.spyOn(storage,'setItem').mockImplementation((key,value)=>{originalSet(key,value);if(key.startsWith(RECOVERY_STORAGE_KEY))held=false;});
    const guard=()=>{if(!held)throw new Error('租约已失效');};
    expect(resetStoredLayout(storage,1000,guard)).toBe('refused');
    expect(data.get(STORAGE_KEY)).toBe(raw);
    expect([...data.entries()].some(([key,value])=>key.startsWith(RECOVERY_STORAGE_KEY)&&value===raw)).toBe(true);
  });
  it('does not evict previous recovery copies on quota or try compensation after permission is lost',()=>{
    const {data,storage}=memory(),raw=JSON.stringify(original());data.set(STORAGE_KEY,raw);
    const recovery=`${RECOVERY_STORAGE_KEY}-100-a`;data.set(recovery,'old-copy');
    vi.spyOn(storage,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
    const remove=vi.spyOn(storage,'removeItem');
    expect(backupStoredLayout(storage,200,()=>{})).toBe(false);
    expect(remove).not.toHaveBeenCalled();expect(data.get(STORAGE_KEY)).toBe(raw);expect(data.get(recovery)).toBe('old-copy');
  });
  it('checks permission on each snapshot write and never starts a sidecar write after loss',()=>{
    const {data,storage}=memory();let held=true;
    const set=storage.setItem.bind(storage);vi.spyOn(storage,'setItem').mockImplementation((key,value)=>{set(key,value);if(key===VERSION_HISTORY_STORAGE_KEY)held=false;});
    const guard=()=>{if(!held)throw new Error('租约已失效');};
    recordSnapshot(original(),{storage,force:true,assertWrite:guard});
    expect(data.has(VERSION_HISTORY_STORAGE_KEY)).toBe(true);
    expect(data.has(VERSION_HISTORY_META_KEY)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledOnce();
  });
});
