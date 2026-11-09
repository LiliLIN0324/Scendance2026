import { afterEach, describe, expect, it, vi } from 'vitest';
import { copySourceScope, deleteSource, deleteSourceForm, registerSourceFlush, storeSource, storeSourceForm, type SourceWriteGuard } from './source-storage';

const source = { id:'source', scope:'draft', name:'图纸', kind:'floorplan' as const, width:1, height:1, blob:new Blob(['a']) };
function guardFor(controller: AbortController): SourceWriteGuard {
  return { kind:'ordinary', signal:controller.signal, assertStillHeld(){ if(controller.signal.aborted)throw new Error('租约已失效'); } };
}
afterEach(()=>vi.unstubAllGlobals());

describe('ordinary source write guard',()=>{
  it.each(['image','delete image','form','delete form'] as const)('refuses %s before opening storage when the lease has been lost',async kind=>{
    const open=vi.fn();vi.stubGlobal('indexedDB',{open});const controller=new AbortController();controller.abort();const guard=guardFor(controller);
    const operation=kind==='image'?()=>storeSource(source,guard):kind==='delete image'?()=>deleteSource('source',guard)
      :kind==='form'?()=>storeSourceForm('draft',{name:'草稿'},guard):()=>deleteSourceForm('draft',guard);
    await expect(operation()).rejects.toThrow('租约已失效');expect(open).not.toHaveBeenCalled();
  });
  it('refuses a queued write if the lease is lost while opening IndexedDB',async()=>{
    let finish!:()=>void;const transaction=vi.fn(),close=vi.fn();
    vi.stubGlobal('indexedDB',{open(){const req={result:{transaction,close},onsuccess:undefined as undefined|(()=>void)};finish=()=>req.onsuccess?.();return req;}});
    const controller=new AbortController(), result=storeSourceForm('draft',{name:'草稿'},guardFor(controller));
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    controller.abort();finish();await expect(result).rejects.toThrow('租约已失效');
    expect(transaction).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();
  });
  it('aborts a staged ordinary write on loss before transaction commit',async()=>{
    let committed=false,aborted=false,success!:()=>void;const controller=new AbortController();
    const request={result:undefined, error:null, onsuccess:undefined as undefined|(()=>void)};
    const tx={error:null,oncomplete:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void),
      abort(){aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(){return {put(){success=()=>{if(!aborted)request.onsuccess?.();if(!aborted){committed=true;tx.oncomplete?.();}};return request;}};} };
    vi.stubGlobal('indexedDB',{open(){const req={result:{transaction:()=>tx,close:vi.fn()},onsuccess:undefined as undefined|(()=>void)};queueMicrotask(()=>req.onsuccess?.());return req;}});
    const result=storeSourceForm('draft',{name:'草稿'},guardFor(controller));
    await vi.waitFor(()=>expect(success).toBeTypeOf('function'));
    controller.abort();success();await expect(result).rejects.toThrow();
    expect(committed).toBe(false);
  });
  it('passes the same guard to a delayed registered flush and blocks its queued write after loss',async()=>{
    const open=vi.fn();vi.stubGlobal('indexedDB',{open});const controller=new AbortController(),guard=guardFor(controller);
    let resume!:()=>void, entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
    const unregister=registerSourceFlush('draft',async received=>{
      expect(received).toBe(guard);entered();await new Promise<void>(resolve=>{resume=resolve;});
      await storeSourceForm('draft:brief',{name:'待保存'},received);
    });
    try {
      const copying=copySourceScope('draft','target',guard);await started;
      controller.abort();resume();await expect(copying).rejects.toThrow('租约已失效');
      expect(open).not.toHaveBeenCalled();
    } finally { unregister(); }
  });
});
