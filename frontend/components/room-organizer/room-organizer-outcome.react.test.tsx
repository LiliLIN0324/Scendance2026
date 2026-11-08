// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {generationMaterialDiff} from './lib/generation-material-diff';
import {__resetGenerationOutcome,useGenerationOutcome} from './lib/use-generation-outcome';
import {BingoAuditCard} from './panels/bingo-audit-card';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const capture=vi.hoisted(()=>({history:null as null|{undo():void;canUndo:boolean}}));
vi.mock('./hooks/use-history',async original=>{const actual=await original<typeof import('./hooks/use-history')>();return {...actual,useHistory:(...args:Parameters<typeof actual.useHistory>)=>{const value=actual.useHistory(...args);capture.history=value;return value;}};});
import {RoomOrganizer} from './room-organizer';
function OutcomeProbe(){const {outcome}=useGenerationOutcome();return <output data-testid="counts">{outcome?JSON.stringify({placed:outcome.placed.length,removed:outcome.removed?.length??0,skipped:outcome.skipped.length}):'none'}</output>;}
afterEach(()=>{cleanup();__resetGenerationOutcome();capture.history=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('writes material counts for the actual applied layout and marks the result historical after undo',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const base=makeLayout({id:'outcome-real',name:'现场活动',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'floor',items:[]})]});
 layoutStore.setState({layout:base,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(base));__resetGenerationOutcome();
 render(<><RoomOrganizer/><OutcomeProbe/><BingoAuditCard/></>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 fireEvent.change(input,{target:{value:'12 人，室内 12×9米，圆桌，出方案'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});const before=structuredClone(layoutStore.getState().layout);fireEvent.click(confirm);
 await waitFor(()=>expect(screen.getByTestId('counts').textContent).not.toBe('none'));
 const actual=layoutStore.getState().layout,diff=generationMaterialDiff(before,actual),counts=JSON.parse(screen.getByTestId('counts').textContent!);
 expect(counts).toEqual({placed:diff.added.length,removed:diff.removed.length,skipped:0});expect(diff.added.length).toBeGreaterThan(0);
 expect(screen.getByText('本次结果：')).toBeTruthy();expect(screen.queryByText(/净宽够 1.2/)).toBeNull();
 await waitFor(()=>expect(capture.history?.canUndo).toBe(true));act(()=>capture.history!.undo());
 await waitFor(()=>expect(screen.getByText(/历史操作结果/)).toBeTruthy());
},35000);
