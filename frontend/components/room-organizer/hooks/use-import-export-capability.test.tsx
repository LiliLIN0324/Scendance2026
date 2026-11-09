// @vitest-environment jsdom
import {act,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {VERSION_HISTORY_PENDING_KEY} from '@/lib/version-history-pending';
import {makeFloor,makeItem,makeLayout} from '../lib/__testfixtures__/fixtures';
import {useImportExport} from './use-import-export';
vi.mock('../lib/file-io',()=>({readLayoutFromFile:vi.fn(async()=>makeLayout({name:'导入'})),downloadDataUrlAsPng:vi.fn()}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('does not replace the canvas if the guarded snapshot cannot be saved',async()=>{
 const locks={request(_n:string,_o:unknown,cb:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>cb({}));}} as unknown as LockManager;
 vi.stubGlobal('navigator',{locks});vi.spyOn(window,'confirm').mockReturnValue(true);
 const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key===VERSION_HISTORY_PENDING_KEY)throw new DOMException('full','QuotaExceededError');original.call(this,key,value);});
 const applyLayout=vi.fn(), onImported=vi.fn(),layout=makeLayout({floors:[makeFloor({items:[makeItem()]})]});
 const params={layout,actions:{applyLayout} as never,localWriteCapability:lease.capability,view2D:true,canvasRef:{current:null},canvas2DRef:{current:null},rendererRef:{current:null},sceneRef:{current:null},cameraRef:{current:null},onImported};
 const hook=renderHook(()=>useImportExport(params));let result=true;
 await act(async()=>{result=await hook.result.current.handleImport(new File(['{}'],'file.json'));});
 expect(result).toBe(false);expect(applyLayout).not.toHaveBeenCalled();expect(onImported).not.toHaveBeenCalled();
 await lease.release();
});

it('does not return to unguarded imports if the capability disappears',async()=>{
 const locks={request(_n:string,_o:unknown,cb:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>cb({}));}} as unknown as LockManager;
 vi.stubGlobal('navigator',{locks});vi.spyOn(window,'confirm').mockReturnValue(true);
 const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const applyLayout=vi.fn(),onImported=vi.fn(),layout=makeLayout({floors:[makeFloor({items:[makeItem()]})]});
 const base={layout,actions:{applyLayout} as never,view2D:true,canvasRef:{current:null},canvas2DRef:{current:null},rendererRef:{current:null},sceneRef:{current:null},cameraRef:{current:null},onImported};
 const hook=renderHook(({capability})=>useImportExport({...base,localWriteCapability:capability}),{initialProps:{capability:lease.capability as typeof lease.capability|undefined}});
 hook.rerender({capability:undefined});let result=true;
 await act(async()=>{result=await hook.result.current.handleImport(new File(['{}'],'file.json'));});
 expect(result).toBe(false);expect(applyLayout).not.toHaveBeenCalled();await lease.release();
});
