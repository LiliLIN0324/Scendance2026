// @vitest-environment jsdom
import {cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {VERSION_HISTORY_PENDING_KEY} from '@/lib/version-history-pending';
import {STORAGE_KEY} from '../lib/constants';
import {makeFloor,makeItem,makeLayout} from '../lib/__testfixtures__/fixtures';
import {decodeShareUrl} from '../lib/share';
import {useLayoutPersistence} from './use-layout-persistence';
import {applyGuardedWorkspaceReplacement} from '../lib/workspace-write-guards';
vi.mock('../lib/share',()=>({isShareHash:(hash:string)=>hash.startsWith('#layout='),isShareHashWithinBudget:()=>true,decodeShareUrl:vi.fn()}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();history.replaceState(null,'','/');});
const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({}));}} as unknown as LockManager;
it('does not open a share when the guarded snapshot marker cannot be saved',async()=>{
 vi.stubGlobal('navigator',{locks});const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const local=makeLayout({name:'本地',floors:[makeFloor({items:[makeItem()]})]}),raw=JSON.stringify(local);
 localStorage.setItem(STORAGE_KEY,raw);window.location.hash='#layout=test';vi.mocked(decodeShareUrl).mockResolvedValue(makeLayout({name:'分享'}));
 const write=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key===VERSION_HISTORY_PENDING_KEY)throw new DOMException('full','QuotaExceededError');write.call(this,key,value);});
 const apply=vi.fn();renderHook(()=>useLayoutPersistence({layout:makeLayout(),onHydrate:apply,localWriteCapability:lease.capability}));
 await waitFor(()=>expect(apply).toHaveBeenCalled());
 expect(apply.mock.calls.map(call=>call[0].name)).not.toContain('分享');expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
 await lease.release();
});
it('never reverts to legacy autosave after capability removal',async()=>{
 vi.stubGlobal('navigator',{locks});const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const initial=makeLayout({name:'原布局'}),changed=makeLayout({name:'新布局'}),apply=vi.fn();
 const view=renderHook(({capability,layout})=>useLayoutPersistence({layout,onHydrate:apply,debounceMs:5,localWriteCapability:capability}),{initialProps:{capability:lease.capability as typeof lease.capability|undefined,layout:initial}});
 view.rerender({capability:undefined,layout:changed});await new Promise(resolve=>setTimeout(resolve,40));
 expect(localStorage.getItem(STORAGE_KEY)).toBeNull();await lease.release();
});

it('refuses a guarded workspace replacement when its recovery record cannot be written',async()=>{
 vi.stubGlobal('navigator',{locks});const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key===VERSION_HISTORY_PENDING_KEY)throw new DOMException('full','QuotaExceededError');original.call(this,key,value);});
 const apply=vi.fn(),layout=makeLayout({floors:[makeFloor({items:[makeItem()]})]});
 expect(()=>applyGuardedWorkspaceReplacement(layout,undefined,apply,lease.capability)).toThrow('恢复点');
 expect(apply).not.toHaveBeenCalled();await lease.release();
});
