// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {retainReadonlyDraft} from './lib/readonly-draft-registry';
import {rememberUnsavedSource,clearUnsavedSourceDraftsForTests} from './panels/unsaved-source-drafts';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const saved=vi.hoisted(()=>({text:'',setBrief:null as null|((update:(value:import('./lib/creative-brief').CreativeBrief)=>import('./lib/creative-brief').CreativeBrief)=>void)}));
vi.mock('./panels/creative-studio',async original=>{const actual=await original<typeof import('./panels/creative-studio')>(),React=await import('react');
 function Probe(){saved.setBrief=actual.useStudioAgent()?.setBrief??null;return null;}
 function Wrapped(props:React.ComponentProps<typeof actual.CreativeStudioProvider>){return React.createElement(actual.CreativeStudioProvider,props,React.createElement(Probe),props.children);}
 return {...actual,CreativeStudioProvider:Wrapped};});
vi.mock('./lib/plan-export/download',async original=>({...await original<typeof import('./lib/plan-export/download')>(),downloadTextFile:(_name:string,_mime:string,value:string)=>{saved.text=value;}}));
import {IsolatedRoomOrganizer,captureIsolatedPageDrafts} from './isolated-room-organizer';
afterEach(()=>{cleanup();clearUnsavedSourceDraftsForTests();layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();saved.text='';});
it('exports scoped page drafts and reports missing categories after lease loss and later editor unmount',async()=>{
 const locks={request(_name:string,_opts:unknown,cb:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>cb({}));}} as unknown as LockManager;
 vi.stubGlobal('navigator',{locks});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const layout=makeLayout({id:'draft-export-a',name:'活动 A',floors:[makeFloor({id:'floor',items:[]})]});layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 const view=render(<IsolatedRoomOrganizer capability={lease.capability}/>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});fireEvent.change(input,{target:{value:'未发送原始要求'}});
 expect(saved.setBrief).not.toBeNull();act(()=>saved.setBrief!(current=>({...current,description:'未保存的需求原文'})));
 const photo={id:'p1',name:'现场原图.png',url:'blob:test',blob:new Blob(['raw-picture'],{type:'image/png'})};rememberUnsavedSource('draft-export-a',photo,true);
 await act(async()=>{await lease.release();});
 const other=makeLayout({id:'draft-export-b',name:'活动 B',floors:[makeFloor({id:'b',items:[]})]});
 act(()=>layoutStore.setState({layout:other,activeFloorIndex:0}));
 fireEvent.click(await screen.findByRole('button',{name:'整理页面草稿'}));fireEvent.click(screen.getByRole('button',{name:'下载文字与布局草稿'}));
 const bundle=JSON.parse(saved.text);expect(bundle.scope).toBe('draft-export-a');expect(bundle.sections.conversations.value.activity[0].text).toBe('未发送原始要求');
 expect(bundle.sections.brief).toMatchObject({status:'captured',value:{description:'未保存的需求原文'}});
 expect(bundle.sections.layout.status).toBe('captured');expect(bundle.sections.images.files[0].name).toBe('现场原图.png');
 expect(bundle.sections.calibration.status).toBe('unavailable');expect(bundle.omissions.join(' ')).toContain('不是完整备份');
 expect(screen.getByRole('button',{name:'下载原图：现场原图.png'}).closest('[inert]')).toBeNull();
 view.unmount();const after=captureIsolatedPageDrafts('draft-export-a');expect(after.layout.status).toBe('captured');
 expect(after.images.status).toBe('captured');expect(after.conversations.status).toBe('captured');
 expect(after.brief).toMatchObject({status:'captured',value:{description:'未保存的需求原文'}});
},25000);

it('does not mix the anonymous draft with a real activity named local',()=>{
 retainReadonlyDraft('local','layout',{status:'captured',value:makeLayout({id:'local',roof:{style:'none'}})});
 const snapshot=captureIsolatedPageDrafts('local');expect(snapshot.brief.status).toBe('unavailable');
 expect(snapshot.images.status).toBe('unavailable');expect(snapshot.environment.status).toBe('unavailable');
});
