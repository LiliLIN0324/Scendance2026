// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { resetAssistantSessionsStoreForTests } from './hooks/use-assistant-sessions';
import { resetVolatileAssistantMemoriesForTests } from './panels/agent-panel';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from './lib/__testfixtures__/fixtures';
import { layoutStore } from './hooks/use-layout-store';
import { STORAGE_KEY } from './lib/constants';
import { INITIAL_LAYOUT } from './lib/initial-layout';
import type { UsePlanAnnotationsResult } from './hooks/use-plan-annotations';

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const capture=vi.hoisted(()=>({annotation:null as UsePlanAnnotationsResult|null}));
vi.mock('./hooks/use-plan-annotations',async original=>{
  const actual=await original<typeof import('./hooks/use-plan-annotations')>();
  return {...actual,usePlanAnnotations(){const result=actual.usePlanAnnotations();capture.annotation=result;return result;}};
});
import { RoomOrganizer } from './room-organizer';
import * as notices from './lib/editor-notices';

beforeEach(()=>{
  resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
});
afterEach(()=>{cleanup();capture.annotation=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('真实工作台中同批新增未审阅路线后旧卡确认不会清空草案或应用布局',async()=>{
  const layout=makeLayout({id:'zone-project',name:'场地',width:20,height:16,roof:{style:'none'},floors:[makeFloor({id:'floor',items:[]})]});
  layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
  const notice=vi.spyOn(notices,'notify');
  render(<RoomOrganizer/>);
  await waitFor(()=>expect(capture.annotation).not.toBeNull());
  act(()=>capture.annotation!.addZoneRects([{zoneType:'desk',label:'座席区',rect:{x:0,z:0,width:8,depth:6}}]));
  const button=await screen.findByRole('button',{name:'应用布置'});
  expect((button as HTMLButtonElement).disabled).toBe(false);
  const before=structuredClone(layoutStore.getState().layout);
  act(()=>{
    capture.annotation!.addAnnotationFromPoints([{x:0,z:0},{x:3,z:2}],'route','刚新增路线');
    fireEvent.click(button);
  });
  expect(capture.annotation!.getSnapshot().draft?.annotations.map(item=>item.label)).toContain('刚新增路线');
  expect(layoutStore.getState().layout).toEqual(before);
  expect(notice).toHaveBeenCalledWith('区域草案已经变化，请重新核对。','error');
  expect(notice.mock.calls.some(([message,tone])=>tone==='success' && String(message).includes('已按'))).toBe(false);
});

it('真实工作台应用布局时出现新标注，不清除也不报全部完成',async()=>{
  const layout=makeLayout({id:'zone-project-2',name:'场地',width:20,height:16,roof:{style:'none'},floors:[makeFloor({id:'floor',items:[]})]});
  layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
  const notice=vi.spyOn(notices,'notify');render(<RoomOrganizer/>);
  await waitFor(()=>expect(capture.annotation).not.toBeNull());
  act(()=>capture.annotation!.addZoneRects([{zoneType:'desk',label:'座席区',rect:{x:0,z:0,width:8,depth:6}}]));
  const button=await screen.findByRole('button',{name:'应用布置'});expect((button as HTMLButtonElement).disabled).toBe(false);
  let added=false;
  const unsubscribe=layoutStore.subscribe(state=>{
    if(!added && (state.layout.floors[0]?.zones?.length??0)>0){added=true;capture.annotation!.addAnnotationFromPoints([{x:0,z:0},{x:3,z:2}],'route','应用中新路线');}
  });
  try {act(()=>fireEvent.click(button));} finally {unsubscribe();}
  expect(added).toBe(true);
  expect(capture.annotation!.getSnapshot().draft?.annotations.map(item=>item.label)).toContain('应用中新路线');
  expect(notice).toHaveBeenCalledWith('布局已应用；新添加的标注已保留，请重新核对。','info');
  expect(notice.mock.calls.some(([message,tone])=>tone==='success' && String(message).includes('已按'))).toBe(false);
});

it.each([false,true])('真实工作台首次加载不误报会话未保存，StrictMode=%s',async strict=>{
  const layout=makeLayout({id:'startup-project',name:'场地',roof:{style:'none'},floors:[makeFloor({id:'floor',items:[]})]});
  layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
  render(strict?<StrictMode><RoomOrganizer/></StrictMode>:<RoomOrganizer/>);
  const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
  expect(screen.queryByText(/会话未能保存在本机/)).toBeNull();
  fireEvent.change(input,{target:{value:'这是一段未发送的活动需求'}});
  expect((input as HTMLTextAreaElement).value).toBe('这是一段未发送的活动需求');
});

it('真实工作台同批 A→B→A 保留未发送输入且不误报会话保存失败',async()=>{
  const a=makeLayout({id:'aba-A',name:'活动 A',roof:{style:'none'},floors:[makeFloor({id:'floor-A',items:[]})]});
  const b=makeLayout({id:'aba-B',name:'活动 B',roof:{style:'none'},floors:[makeFloor({id:'floor-B',items:[]})]});
  layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
  render(<StrictMode><RoomOrganizer/></StrictMode>);
  const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
  fireEvent.change(input,{target:{value:'未发送且必须保留的内容'}});
  act(()=>{layoutStore.setState({layout:b,activeFloorIndex:0});layoutStore.setState({layout:a,activeFloorIndex:0});});
  await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('未发送且必须保留的内容'));
  expect(screen.queryByText(/会话未能保存在本机/)).toBeNull();
});

it('真实工作台普通切换活动时按作用域保留草稿，刷新后不会假装仍保存',async()=>{
  const a=makeLayout({id:'draft-A',name:'活动 A',roof:{style:'none'},floors:[makeFloor({id:'floor-A',items:[]})]});
  const b=makeLayout({id:'draft-B',name:'活动 B',roof:{style:'none'},floors:[makeFloor({id:'floor-B',items:[]})]});
  layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
  const view=render(<RoomOrganizer/>);const aInput=await screen.findByLabelText('告诉 Agent 要改的');
  fireEvent.change(aInput,{target:{value:'A 活动未发送内容'}});
  expect(screen.getByText(/刷新或关闭后会丢失/)).toBeTruthy();
  act(()=>layoutStore.setState({layout:b,activeFloorIndex:0}));
  await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe(''));
  fireEvent.change(screen.getByLabelText('告诉 Agent 要改的'),{target:{value:'B 活动未发送内容'}});
  act(()=>layoutStore.setState({layout:a,activeFloorIndex:0}));
  await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('A 活动未发送内容'));
  view.unmount();resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();
  render(<RoomOrganizer/>);await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe(''));
  expect(screen.queryByText(/刷新或关闭后会丢失/)).toBeNull();
});
