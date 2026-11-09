// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {makeCatalogItem,makeFloor,makeItem,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {STORAGE_KEY} from './lib/constants';
import type {CatalogPlacementResult} from './lib/catalog-placement-guard';

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const capture=vi.hoisted(()=>({results:[] as CatalogPlacementResult[],history:null as null|{undo():void;canUndo:boolean}}));
vi.mock('./hooks/use-history',async original=>{const actual=await original<typeof import('./hooks/use-history')>();return {...actual,useHistory:(...args:Parameters<typeof actual.useHistory>)=>{const value=actual.useHistory(...args);capture.history=value;return value;}};});
vi.mock('./panels/scendance-workspace',async original=>{
 const actual=await original<typeof import('./panels/scendance-workspace')>();
 return {...actual,ScendanceLibrary:(props:{placeCatalogItemResult:(item:ReturnType<typeof makeCatalogItem>)=>CatalogPlacementResult})=><div>
  <button onClick={()=>capture.results.push(props.placeCatalogItemResult(makeCatalogItem({name:'测试椅'})))}>放测试椅</button>
  <button onClick={()=>capture.results.push(props.placeCatalogItemResult(makeCatalogItem({name:'大件',width:20,depth:20})))}>放大件</button>
 </div>};
});
import {RoomOrganizer} from './room-organizer';

function setup(){
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const layout=makeLayout({id:'catalog-test',width:8,height:8,roof:{style:'none'},floors:[makeFloor({id:'floor-a',items:[makeItem({id:'existing'})]}),makeFloor({id:'floor-b'})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 render(<RoomOrganizer/>);
}
afterEach(()=>{cleanup();capture.results=[];capture.history=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

it('places two consecutive items away from an occupied centre and supports undo',async()=>{
 setup();fireEvent.click(await screen.findByRole('button',{name:'物料'}));
 const add=await screen.findByRole('button',{name:'放测试椅'});
 fireEvent.click(add);fireEvent.click(add);
 expect(capture.results.map(result=>result.status)).toEqual(['placed','placed']);
 const items=layoutStore.getState().layout.floors[0]!.items;expect(items).toHaveLength(3);
 expect(items[1]!.position).not.toEqual({x:0,z:0});expect(items[2]!.position).not.toEqual(items[1]!.position);
 await waitFor(()=>expect(capture.history?.canUndo).toBe(true));act(()=>capture.history!.undo());
 expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(2);
},30000);

it('keeps the first pending item rather than overwriting it and cancels on floor ABA',async()=>{
 setup();fireEvent.click(await screen.findByRole('button',{name:'物料'}));
 fireEvent.click(await screen.findByRole('button',{name:'放大件'}));
 expect(capture.results.at(-1)?.status).toBe('pending');expect(await screen.findByText(/待放置：大件/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'放测试椅'}));expect(capture.results.at(-1)?.status).toBe('failed');
 expect(screen.getByText(/待放置：大件/)).toBeTruthy();
 act(()=>{layoutStore.setState({activeFloorIndex:1});layoutStore.setState({activeFloorIndex:0});});
 await waitFor(()=>expect(screen.queryByText(/待放置：大件/)).toBeNull());
 expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(1);
},30000);

it('cannot carry a pending item through an activity ABA switch',async()=>{
 setup();fireEvent.click(await screen.findByRole('button',{name:'物料'}));
 fireEvent.click(await screen.findByRole('button',{name:'放大件'}));expect(await screen.findByText(/待放置：大件/)).toBeTruthy();
 const original=layoutStore.getState().layout;
 act(()=>{layoutStore.setState({layout:{...original,id:'other-activity'}});layoutStore.setState({layout:original});});
 await waitFor(()=>expect(screen.queryByText(/待放置：大件/)).toBeNull());
 expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(1);
},30000);
