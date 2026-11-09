// @vitest-environment jsdom
import {act,cleanup,render,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {layoutStore} from './hooks/use-layout-store';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {STORAGE_KEY} from './lib/constants';
import type {UsePlanAnnotationsResult} from './hooks/use-plan-annotations';
import type {ActivitySwitchGuard} from './lib/local-activity-switch-guard';

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const captured=vi.hoisted(()=>({annotation:null as UsePlanAnnotationsResult|null,guard:null as ActivitySwitchGuard|null}));
vi.mock('./hooks/use-plan-annotations',async original=>{const actual=await original<typeof import('./hooks/use-plan-annotations')>();return {...actual,usePlanAnnotations(){const value=actual.usePlanAnnotations();captured.annotation=value;return value;}};});
vi.mock('./panels/activities-gallery-mount',async()=>{const {useLocalActivitySwitchGuard}=await import('./lib/local-activity-switch-guard');return {ActivitiesGalleryMount(){captured.guard=useLocalActivitySwitchGuard();return null;}};});
import {RoomOrganizer} from './room-organizer';

beforeEach(()=>{vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
});
afterEach(()=>{cleanup();captured.annotation=null;captured.guard=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('exposes the real workbench draft guard to the activity gallery and refuses an unsaved zone',async()=>{
 const layout=makeLayout({id:'guard-integration',name:'本地活动',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'f',items:[]})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));render(<RoomOrganizer/>);
 await waitFor(()=>expect(captured.guard).not.toBeNull());expect(captured.annotation).not.toBeNull();
 act(()=>captured.annotation!.addZoneRects([{zoneType:'desk',label:'未应用区域',rect:{x:0,z:0,width:4,depth:3}}]));
 expect(()=>captured.guard!.capture()).toThrow('未应用的规划草稿');
 expect(captured.annotation!.getSnapshot().draft?.annotations[0]?.label).toBe('未应用区域');
 expect(layoutStore.getState().layout.id).toBe('guard-integration');
});
