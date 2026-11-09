// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {StrictMode} from 'react';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {storeSourceForm} from '@/lib/source-storage';
import {saveNamedLayout} from './lib/library';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {IsolatedWorkspaceSession} from './isolated-workspace-session';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
import {RoomOrganizer} from './room-organizer';
afterEach(()=>{cleanup();layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('keeps real editor drafts exportable outside the inert surface after lease loss and blocks a second tab',async()=>{
 let held=false;const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){if(held)return Promise.resolve().then(()=>callback(null));held=true;return Promise.resolve().then(()=>callback({})).finally(()=>{held=false;});}} as unknown as LockManager;
 vi.stubGlobal('navigator',{locks});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const first=createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}),second=createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage});
 const lease=await first.acquire();await expect(second.acquire()).rejects.toThrow('另一窗口');
 const layout=makeLayout({id:'isolated',name:'场地',floors:[makeFloor({id:'floor',items:[]})]});layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 let exported:unknown;const captureDrafts=()=>{exported={layout:layoutStore.getState().layout,draft:(document.getElementById('ap-input') as HTMLTextAreaElement).value};return {scope:'isolated',layout:{status:'captured' as const,value:exported},conversations:{status:'none' as const},brief:{status:'none' as const},images:{status:'none' as const},environment:{status:'none' as const},calibration:{status:'unavailable' as const,reason:'未接入'}};};
 render(<IsolatedWorkspaceSession capability={lease.capability} captureDrafts={captureDrafts}>{session=><RoomOrganizer localWriteCapability={lease.capability} isolatedWriteSession={session}/>}</IsolatedWorkspaceSession>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});fireEvent.change(input,{target:{value:'尚未保存的草稿'}});
 await act(async()=>{await lease.release();});const button=await screen.findByRole('button',{name:'整理页面草稿'});
 expect(button.closest('[inert]')).toBeNull();expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('尚未保存的草稿');
 fireEvent.click(button);expect(exported).toMatchObject({layout:{id:'isolated'},draft:'尚未保存的草稿'});
 expect(saveNamedLayout(makeLayout(),'late')).toBeNull();await expect(storeSourceForm('isolated',{x:1})).rejects.toThrow();
 const peer=await second.acquire();await peer.release();
},25000);

it('offers the scoped export entry even when an isolated session cannot be established',async()=>{
 const captureDrafts=vi.fn(()=>({scope:'pending',layout:{status:'captured' as const,value:{name:'保留'}},conversations:{status:'unavailable' as const,reason:'尚未接入'},
 brief:{status:'unavailable' as const,reason:'尚未读取'},images:{status:'none' as const},environment:{status:'none' as const},calibration:{status:'none' as const}}));
 render(<IsolatedWorkspaceSession capability={{} as never} captureDrafts={captureDrafts}>{()=> <div>不应挂载</div>}</IsolatedWorkspaceSession>);
 expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('不应挂载')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'整理页面草稿'}));expect(captureDrafts).toHaveBeenCalledOnce();expect(screen.getByText(/需求草稿未包含/)).toBeTruthy();
});

it('survives StrictMode effect replay without dropping back to an unguarded session',async()=>{
 const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({}));}} as unknown as LockManager;
 vi.stubGlobal('navigator',{locks});const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const captureDrafts=()=>({scope:'strict',layout:{status:'none' as const},conversations:{status:'none' as const},brief:{status:'none' as const},images:{status:'none' as const},environment:{status:'none' as const},calibration:{status:'none' as const}});
 const view=render(<StrictMode><IsolatedWorkspaceSession capability={lease.capability} captureDrafts={captureDrafts}>{session=><button onClick={()=>session.assertWrite()}>编辑器就绪</button>}</IsolatedWorkspaceSession></StrictMode>);
 expect(await screen.findByRole('button',{name:'编辑器就绪'})).toBeTruthy();expect(screen.queryByText(/无法安全建立/)).toBeNull();
 view.unmount();await lease.release();
});
