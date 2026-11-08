// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { INITIAL_BRIEF } from '../lib/creative-brief';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { presetModelUrl } from '../lib/scene-presets';
import { STAGE_PLATFORM_ASSET_ID } from '../lib/stage-platform-plan';
import * as stagePlatformPlan from '../lib/stage-platform-plan';
import { getAssistantSessionBodies, resetAssistantSessionsStoreForTests, useAssistantSessions } from '../hooks/use-assistant-sessions';
import { useHistory } from '../hooks/use-history';
import { useLayoutState } from '../hooks/use-layout-state';
import { layoutStore } from '../hooks/use-layout-store';
import {bindPendingCandidateRegistry,createPendingCandidateRegistry} from '../lib/pending-candidate-registry';
import { ActivityBrief, AgentPanel, LayoutAgentProvider, MapVenueOverlay, resetVolatileAssistantMemoriesForTests, useAgent, type BriefTool } from './agent-panel';
import type { RoomLayout } from '../lib/types';
import type { LayoutPlanDraft } from '../../../lib/plan-annotation';
import type { WorkbenchMode } from '../lib/workbench-mode';

const state = vi.hoisted(() => ({
  layout: null as unknown as RoomLayout,
  apply: vi.fn(),
  addItems: vi.fn(),
  commitNow: vi.fn(),
  view: null as unknown,
  setView: vi.fn(),
}));
const realLayoutStoreGetState = layoutStore.getState.bind(layoutStore);
let useRealLayoutStore = false;

const studioMock = vi.hoisted(() => ({
  exportActivity: vi.fn(async () => {}),
  exportCloudMaterialDraft: vi.fn(async () => {}), cloudMaterialDraftAvailable: false,
  generate: vi.fn(async (_message?: string, _options?: { requirePreview?: true }):Promise<{kind:'unchanged';runId:string;message:string}|void> => {}),
  cancelRun: vi.fn(async () => {}),
  discardPreview: vi.fn(),
  applyPreview: vi.fn(async () => {}),
  setCandidateInventory: vi.fn(() => true),
  setBrief: vi.fn(),
  brief: { event: null as string | null, guests: null as number | null, eventConfirmed: undefined as boolean | undefined, guestsConfirmed: undefined as boolean | undefined },
  hasSavedBrief: false,
  preview: null as unknown,
  stale: false,
  expired: false,
  busy: false,
  recoverable: false,
  applyRecovery: null as null | { projectId: string; revision: number; proposalId: string; outcome: 'pending' | 'committed' | 'cleanup_failed' },
  connection: '离线引导',
  controller: { briefExtract: vi.fn(), briefConversation: vi.fn(), assistantChat: vi.fn() },
  applyRecoveryReview: null as null | { status: 'base_matches' | 'candidate_matches' | 'unknown'; message: string },
  reviewingApplyRecovery: false,
  reviewApplyRecovery: vi.fn(async () => {}),
  acknowledgeApplyRecovery: vi.fn(async () => {}),
}));

vi.mock('../contexts', () => ({
  useRoomEditor: () => ({
    layout: state.layout,
    activeFloor: state.layout.floors[0],
    activeFloorIndex: 0,
    actions: { applyLayout: state.apply, addItems: state.addItems, setFloorPlan: vi.fn() },
    history: { commitNow: state.commitNow },
    view: state.view,
    setView: state.setView,
    collidingIds: new Set<string>(),
  }),
}));
vi.mock('./creative-studio', () => ({
  useStudioAgent: () => studioMock,
  isUnchangedProposal: (proposal:{base_scene?:unknown;candidate?:unknown}) => proposal.base_scene!==undefined&&proposal.candidate!==undefined&&JSON.stringify(proposal.base_scene)===JSON.stringify(proposal.candidate),
  // 测试壳没有 CreativeStudioProvider：画廊桥拿到 null 动作集后整体不渲染（与真实 Context 缺省行为一致）。
  useLocalProjectBackup: () => null,
}));

const callbacks = {
  workbenchMode: 'layout' as WorkbenchMode,
  onOpenMaterials: vi.fn(), onSelectMode: vi.fn(), onOpenReview: vi.fn(),
  onOpenDelivery: vi.fn(), onFit: vi.fn(),
  onIssueReviewLink: vi.fn(async ():Promise<string|{url:string;isCurrent:()=>boolean}|null> => ({url:'https://scendance.example/review/#layout=abc123',isCurrent:()=>true})),
};

function seatLayout(overrides: { locked?: boolean } = {}): RoomLayout {
  return makeLayout({
    floors: [makeFloor({ items: [
      makeItem({ id: 'table', type: 'table', name: '餐桌', width: 1.2, depth: 0.8, position: { x: 2.5, z: 0 } }),
      makeItem({ id: 'seat', type: 'chair', name: '椅子', width: 0.5, depth: 0.5, position: { x: 3.35, z: 0 }, ...(overrides.locked ? { locked: true } : {}) }),
    ] })],
  });
}

function ui(layout: RoomLayout, onApply = vi.fn(), onPreview = vi.fn()) {
  state.layout = layout;
  return <LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={onApply}><AgentPanel/></LayoutAgentProvider>;
}

/** 候选确认后让测试画布跟随实际应用，预览阶段不调用 onApply。 */
function LocalHarness({ initial, onApply, onPreview = vi.fn(), brief = false }: { initial: RoomLayout; onApply(next: RoomLayout): void; onPreview?(next: RoomLayout | null): void; brief?: boolean }) {
  const [current, setCurrent] = useState(initial);
  state.layout = current;
  state.apply = vi.fn((next: RoomLayout) => setCurrent(next));
  return <LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={next => { onApply(next); setCurrent(next); }}><AgentPanel/>{brief && <ActivityBrief tools={[]}/>}</LayoutAgentProvider>;
}

/** 云端预览只要这几栏：右栏的差分、提案卡与 stale 判断读的就是它们。 */
function cloudPreview(): unknown {
  return {
    assets: { assetUrls: {}, assetNames: {} },
    proposal: { explanation: '云端加了一把椅子', warnings: [] },
    base: makeLayout(),
    layout: makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'cloud-seat', type: 'chair', name: '椅子', position: { x: 1, z: 1 } })] })] }),
    briefKey: '', scope: 'local',
  };
}

describe('existing objects in a cloud candidate',()=>{
  it('shows an unchanged candidate only as a comparison and permits another changed candidate',async()=>{
    const base=makeLayout({width:12,height:9});const unchanged={base,layout:structuredClone(base),proposal:{base_scene:{objects:[]},candidate:{objects:[]},explanation:'原场景',warnings:[]},assets:{assetUrls:{},assetNames:{}},briefKey:'',scope:'local'};
    const changed={...(cloudPreview() as object),base,proposal:{base_scene:{objects:[]},candidate:{objects:[{id:'new'}]},explanation:'新增椅子',warnings:[]}};
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=unchanged;});
    const onApply=vi.fn();state.layout=base;
    const tree=()=> <LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/><ConfirmationProbe/></LayoutAgentProvider>;
    const view=render(tree());send('30 人，室内 12×9，圆桌');
    await screen.findByText('原场景对照');expect(screen.getAllByText(/这版未改变场景，仅供对照/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    send('确认布置');fireEvent.click(screen.getByRole('button',{name:'模拟其他确认入口'}));
    expect(studioMock.applyPreview).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    studioMock.preview=changed;view.rerender(tree());
    fireEvent.click(await screen.findByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(studioMock.applyPreview).toHaveBeenCalledOnce());
  });
  it('shows the removed and adjusted originals before confirmation without calling every change a move',async()=>{
    const removed=makeItem({id:'remove-1',name:'现有椅子',position:{x:-1,z:2}});
    const recolored=makeItem({id:'change-1',name:'现有桌子',position:{x:1,z:0},color:'#ffffff'});
    const base=makeLayout({floors:[makeFloor({name:'活动厅',items:[removed,recolored]})]});
    const candidate=makeLayout({floors:[makeFloor({name:'活动厅',items:[{...recolored,color:'#000000'}]})]});
    studioMock.connection='项目已连接';studioMock.preview={base,layout:candidate,proposal:{explanation:'预览',warnings:[]},assets:{assetUrls:{},assetNames:{}},briefKey:'',scope:'local'};
    const onApply=vi.fn();render(ui(base,onApply));
    expect(await screen.findByText(/移除 现有椅子（原场景第 1 件）：第 1 层（活动厅），横向 -1 米、纵向 2 米/)).toBeTruthy();
    expect(screen.getByText(/调整 现有桌子（原场景第 2 件）.*位置未变，其他属性有调整/)).toBeTruthy();
    expect(screen.getByText(/调整 1 件 · 撤掉 1 件/)).toBeTruthy();
    expect(screen.queryByText(/挪动 1 件/)).toBeNull();
    expect(onApply).not.toHaveBeenCalled();expect(studioMock.applyPreview).not.toHaveBeenCalled();
  });
  it('does not let a candidate unlock and modify a previously locked original',async()=>{
    const locked=makeItem({id:'locked-1',name:'锁定桌',locked:true,position:{x:1,z:0}});
    const base=makeLayout({floors:[makeFloor({items:[locked]})]});
    const candidate=makeLayout({floors:[makeFloor({items:[{...locked,locked:false,position:{x:2,z:0}}]})]});
    studioMock.connection='项目已连接';studioMock.preview={base,layout:candidate,proposal:{explanation:'预览',warnings:[]},assets:{assetUrls:{},assetNames:{}},briefKey:'',scope:'local'};
    render(ui(base));expect((await screen.findAllByText(/这版动了 1 件锁着的物料/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(studioMock.applyPreview).not.toHaveBeenCalled();
  });
});

function ConfirmationProbe(){const agent=useAgent();return <button type="button" onClick={agent.confirmProposal}>模拟其他确认入口</button>;}
function ForwardProbe({text,onProbe}:{text:string;onProbe:(allowed:boolean)=>void}){const agent=useAgent();return <button type="button" onClick={()=>onProbe(agent.canForward(text))}>检查转交</button>;}

/** Material Symbols 私用区字形会混进 textContent，断言只看可见文案。 */
function visibleText(value: string | null | undefined): string {
  return (value ?? '').replace(/[\uE000-\uF8FF]/g, '').replace(/\s+/g, ' ').trim();
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText('告诉 Agent 要改的'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

describe('single-agent input bridge',()=>{
  it('accepts only nonempty text for the current active activity and session',async()=>{
    state.layout=makeLayout({id:'bridge-activity'});let current=true;const result=vi.fn();
    const tree=(text:string)=><LayoutAgentProvider sessionScope="activity:bridge-activity" isSessionCurrent={()=>current} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ForwardProbe text={text} onProbe={result}/></LayoutAgentProvider>;
    const view=render(tree('帮我看场地'));
    await waitFor(()=>{fireEvent.click(screen.getByRole('button',{name:'检查转交'}));expect(result).toHaveBeenLastCalledWith(true);});
    view.rerender(tree('  '));fireEvent.click(screen.getByRole('button',{name:'检查转交'}));expect(result).toHaveBeenLastCalledWith(false);
    view.rerender(tree('帮我看场地'));current=false;fireEvent.click(screen.getByRole('button',{name:'检查转交'}));expect(result).toHaveBeenLastCalledWith(false);
  });
  it('does not accept pending or uncertain duplicate text and does not trigger another request',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(()=>{}));
    const result=vi.fn();state.layout=makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ForwardProbe text="80 人" onProbe={result}/></LayoutAgentProvider>);
    send('80 人');await screen.findByText('正在理解活动需求…');
    fireEvent.click(screen.getByRole('button',{name:'检查转交'}));expect(result).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button',{name:'停止等待'}));await screen.findByText(/服务商可能仍在处理或计费/);
    fireEvent.click(screen.getByRole('button',{name:'检查转交'}));expect(result).toHaveBeenLastCalledWith(false);
    expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(1);
  });
});

describe('dialogue export in-flight fence',()=>{
 function tracker(){const active=new Set<symbol>();let revision=0;return {active,get revision(){return revision;},start:()=>{const id=Symbol();active.add(id);revision++;let released=false;return()=>{if(!released){released=true;active.delete(id);revision++;}};}};}
 it('starts synchronously and holds independent tokens until all queued messages are understood',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','0');
  let first!:(value:unknown)=>void,second!:(value:unknown)=>void;
  studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(resolve=>{first=resolve;})).mockImplementationOnce(()=>new Promise(resolve=>{second=resolve;}));
  const fence=tracker();state.layout=makeLayout();render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start}><AgentPanel/></LayoutAgentProvider>);
  const captured=fence.revision;send('30人');expect(fence.active.size).toBe(1);expect(fence.revision).toBeGreaterThan(captured);
  send('室内');expect(fence.active.size).toBe(2);
  await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(1));
  await act(async()=>{first({enabled:true,extraction:{headcount:30}});});
  await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(2));expect(fence.active.size).toBe(1);
  await act(async()=>{second({enabled:true,extraction:{venueIO:'indoor'}});});await waitFor(()=>expect(fence.active.size).toBe(0));
 });
 it('releases all in-flight tokens on unmount without waiting for a provider',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','0');
  studioMock.controller.briefExtract.mockImplementation(()=>new Promise(()=>{}));const fence=tracker();state.layout=makeLayout();
  const view=render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start}><AgentPanel/></LayoutAgentProvider>);
  send('30人');send('室内');expect(fence.active.size).toBe(2);await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledOnce());
  view.unmount();expect(fence.active.size).toBe(0);
 });
 it('releases after a failed request without treating it as a successful dialogue',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','0');studioMock.controller.briefExtract.mockRejectedValueOnce(new Error('fixture failure'));
  const fence=tracker(),incomplete=vi.fn();state.layout=makeLayout();render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start} onDialogueIncompleteChange={incomplete}><AgentPanel/></LayoutAgentProvider>);
  send('30人');expect(fence.active.size).toBe(1);await waitFor(()=>expect(fence.active.size).toBe(0));expect(studioMock.controller.briefExtract).toHaveBeenCalledOnce();expect(incomplete).toHaveBeenCalledWith(expect.any(String),true);
 });
 it('releases on cancellation and does not apply a late provider response',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','0');let resolve!:(value:unknown)=>void;
  studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const fence=tracker(),changes=vi.fn(),incomplete=vi.fn();state.layout=makeLayout();
  render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start} onDialogueIncompleteChange={incomplete} onBriefMemoryChange={changes}><AgentPanel/></LayoutAgentProvider>);
  send('30人');await screen.findByText('正在理解活动需求…');expect(fence.active.size).toBe(1);fireEvent.click(screen.getByRole('button',{name:'停止等待'}));
  await waitFor(()=>expect(fence.active.size).toBe(0));expect(incomplete).toHaveBeenCalledWith(expect.any(String),true);const before=changes.mock.calls.length;
  await act(async()=>{resolve({enabled:true,extraction:{headcount:30}});await Promise.resolve();});expect(changes).toHaveBeenCalledTimes(before);expect(fence.active.size).toBe(0);
 });
 it('does not let a prior session completion release a newer session turn',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','0');let first!:(value:unknown)=>void,second!:(value:unknown)=>void;
  studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(done=>{first=done;})).mockImplementationOnce(()=>new Promise(done=>{second=done;}));
  const fence=tracker();state.layout=makeLayout();render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start}><AgentPanel/></LayoutAgentProvider>);
  send('30人');await screen.findByText('正在理解活动需求…');fireEvent.click(screen.getByRole('button',{name:'新开会话'}));await waitFor(()=>expect(fence.active.size).toBe(0));
  send('40人');await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(2));expect(fence.active.size).toBe(1);
  await act(async()=>{first({enabled:true,extraction:{headcount:30}});await Promise.resolve();});expect(fence.active.size).toBe(1);
  await act(async()=>{second({enabled:true,extraction:{headcount:40}});await Promise.resolve();});await waitFor(()=>expect(fence.active.size).toBe(0));
 });
 it('keeps the message fence through preview generation and queued follow-up',async()=>{
  const fence=tracker(),onApply=vi.fn();state.layout=makeLayout();
  render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply} onDialogueTurnStart={fence.start}><AgentPanel/></LayoutAgentProvider>);
  send('加一把椅子');send('再加一把椅子');expect(fence.active.size).toBe(2);expect(await screen.findByText(/条消息排队/)).toBeTruthy();
  await waitFor(()=>expect(fence.active.size).toBe(0),{timeout:15000});expect(onApply).not.toHaveBeenCalled();
 },20000);
 it('keeps the original words and does not dispatch if the fence cannot be acquired',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');state.layout=makeLayout();
  render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={()=>undefined as unknown as ()=>void}><AgentPanel/></LayoutAgentProvider>);
  send('30人');expect(await screen.findByText('30人')).toBeTruthy();expect(await screen.findByText('对话状态暂时无法核对，请稍后重试。')).toBeTruthy();expect(studioMock.controller.briefExtract).not.toHaveBeenCalled();
 });
 it('lets the export confirmation card run after its own request has finished',async()=>{
  const fence=tracker();state.layout=makeLayout();studioMock.exportActivity.mockImplementationOnce(async()=>{if(fence.active.size)throw Error('对话仍在处理');});
  render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start}><AgentPanel/></LayoutAgentProvider>);
  send('导出给搭建方');const button=await screen.findByRole('button',{name:'确认导出'});await waitFor(()=>expect(fence.active.size).toBe(0));
  fireEvent.click(button);await waitFor(()=>expect(studioMock.exportActivity).toHaveBeenCalledOnce());expect(await screen.findByText(/执行资料草案已发起下载/)).toBeTruthy();
 });
 it('does not report a successful card export while another dialogue remains unresolved',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','0');studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(()=>{}));
  const fence=tracker();state.layout=makeLayout();studioMock.exportActivity.mockImplementationOnce(async()=>{if(fence.active.size)throw Error('当前对话或活动无法核对，未生成交接文件。');});
  render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start}><AgentPanel/></LayoutAgentProvider>);
  send('30人');await screen.findByText('正在理解活动需求…');send('导出给搭建方');const button=await screen.findByRole('button',{name:'确认导出'});await waitFor(()=>expect(fence.active.size).toBe(1));
  fireEvent.click(button);expect(await screen.findByText('当前对话或活动无法核对，未生成交接文件。')).toBeTruthy();expect(screen.queryByText(/执行资料草案已发起下载/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'停止等待'}));await waitFor(()=>expect(fence.active.size).toBe(0));
 });
 it('keeps a mixed utility request incomplete even when the model omits its unhandled action',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
  studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{headcount:30},reply:'先按30人讨论。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]});
  const fence=tracker(),incomplete=vi.fn();state.layout=makeLayout();render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start} onDialogueIncompleteChange={incomplete}><AgentPanel/></LayoutAgentProvider>);
  send('30人，需要签到，给我物料清单');expect(incomplete).toHaveBeenCalledWith(expect.any(String),true);await waitFor(()=>expect(fence.active.size).toBe(0));expect(incomplete).not.toHaveBeenCalledWith(expect.any(String),false);
 });
 it('does not mark a cancelled purely general question as a failed event requirement',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');studioMock.controller.briefConversation.mockImplementationOnce(()=>new Promise(()=>{}));
  const fence=tracker(),incomplete=vi.fn();state.layout=makeLayout();render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onDialogueTurnStart={fence.start} onDialogueIncompleteChange={incomplete}><AgentPanel/></LayoutAgentProvider>);
  send('什么是活动动线？');await screen.findByText('正在理解活动需求…');fireEvent.click(screen.getByRole('button',{name:'停止等待'}));await waitFor(()=>expect(fence.active.size).toBe(0));expect(incomplete).not.toHaveBeenCalled();
 });
});

describe('scoped cloud seating constraints',()=>{
  it('passes selected furniture dimensions from an earlier turn, not unselected inventory',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockResolvedValue(undefined);
    render(ui({...state.layout,width:12,height:9}));
    send('桌宽1.8米');await screen.findByText('桌宽1.8米');
    send('库存椅宽60厘米');await screen.findByText('库存椅宽60厘米');
    send('30人，室内12×9，采用课桌椅，出方案');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    const [message,options]=studioMock.generate.mock.calls[0]!;
    expect(message).toContain('桌宽1.8米');expect(message).toContain('库存椅宽60厘米');expect(message).toContain('未核验、未选择');
    expect(options).toMatchObject({requirePreview:true,seatingSpecs:{desk:{width:{status:'reported',valueM:1.8,evidence:'桌宽1.8米',source:'user'}}}});
    expect((options as {seatingSpecs?:{chair?:unknown}}|undefined)?.seatingSpecs?.chair).toBeUndefined();
  });
  it('sends a previous user-stated shared desk requirement as structured context',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockResolvedValue(undefined);
    render(ui({...state.layout,width:12,height:9}));send('每2人一桌');await screen.findByText('每2人一桌');
    send('30人，室内12×9，采用课桌椅，出方案');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    const [message,options]=studioMock.generate.mock.calls[0]!;
    expect(message).toContain('用户原话：');expect(message).toContain('每2人一桌');
    expect(options).toMatchObject({requirePreview:true,seatingAllocation:{status:'shared_desk',peoplePerDesk:2,evidence:'每2人一桌',source:'user'}});
  });
  it('does not send an old conversation allocation in a new chat',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockResolvedValue(undefined);
    render(ui({...state.layout,width:12,height:9}));send('每2人一桌');await screen.findByText('每2人一桌');
    fireEvent.click(screen.getByRole('button',{name:'新开会话'}));send('30人，室内12×9，采用课桌椅，出方案');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    const [message,options]=studioMock.generate.mock.calls[0]!;
    expect(message).not.toContain('每2人一桌');expect(options).toEqual({requirePreview:true});
  });
  it('shows a program-provided allocation warning without presenting an internal code',async()=>{
    studioMock.connection='项目已连接';const preview=cloudPreview() as {proposal:{warnings:Array<{code:string;ids:string[]}>}};
    preview.proposal.warnings=[{code:'SEATING_ALLOCATION_UNVERIFIED',ids:[]}];studioMock.generate.mockImplementation(async()=>{studioMock.preview=preview;});
    render(ui({...state.layout,width:12,height:9}));send('30人，室内12×9，采用课桌椅，出方案');
    expect(await screen.findByText(/桌椅配比尚未核验/)).toBeTruthy();expect(document.body.textContent).not.toContain('SEATING_ALLOCATION_UNVERIFIED');
    expect(document.body.textContent).not.toContain('已选择每人一套');
  });
  it('shows an unverified headcount warning without exposing the internal code',async()=>{
    studioMock.connection='项目已连接';const preview=cloudPreview() as {proposal:{warnings:Array<{code:string;ids:string[]}>}};
    preview.proposal.warnings=[{code:'SEATING_HEADCOUNT_UNVERIFIED',ids:[]}];studioMock.generate.mockImplementation(async()=>{studioMock.preview=preview;});
    render(ui({...state.layout,width:12,height:9}));send('30人，室内12×9，采用课桌椅，出方案');
    expect(await screen.findByText(/人数来源尚未核验/)).toBeTruthy();expect(document.body.textContent).not.toContain('SEATING_HEADCOUNT_UNVERIFIED');
  });
  it('shows a program-provided specification warning without exposing its code',async()=>{
    studioMock.connection='项目已连接';const preview=cloudPreview() as {proposal:{warnings:Array<{code:string;ids:string[]}>}};
    preview.proposal.warnings=[{code:'SEATING_SPECS_UNVERIFIED',ids:[]}];studioMock.generate.mockImplementation(async()=>{studioMock.preview=preview;});
    render(ui({...state.layout,width:12,height:9}));send('30人，室内12×9，采用课桌椅，出方案');
    expect(await screen.findByText(/桌椅规格尚未核验/)).toBeTruthy();expect(document.body.textContent).not.toContain('SEATING_SPECS_UNVERIFIED');
  });
});

describe('explicit local-only seating draft',()=>{
  const fence=vi.fn(()=>true);
  let annotationSnapshot:{draft:LayoutPlanDraft|null;revision:number}={draft:null,revision:0};
  const readAnnotations=()=>structuredClone(annotationSnapshot);
  function configureLocalController(){
    const controller=studioMock.controller as typeof studioMock.controller & {getSnapshot?:()=>unknown;canCreateUnboundLocalDraft?:()=>boolean;localDraftAuthorityVersion?:()=>string};
    controller.getSnapshot=()=>({project:null,geometryBinding:null});controller.canCreateUnboundLocalDraft=fence;controller.localDraftAuthorityVersion=()=> '0:0';fence.mockReset().mockReturnValue(true);annotationSnapshot={draft:null,revision:0};
  }
  afterEach(()=>{const controller=studioMock.controller as typeof studioMock.controller & {getSnapshot?:()=>unknown;canCreateUnboundLocalDraft?:()=>boolean;localDraftAuthorityVersion?:()=>string;subscribe?:(callback:()=>void)=>()=>void};delete controller.getSnapshot;delete controller.canCreateUnboundLocalDraft;delete controller.localDraftAuthorityVersion;delete controller.subscribe;});
  it('allows a fully checked hand-drawn centreline as an unverified exploration draft',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    annotationSnapshot={revision:1,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'route',kind:'route',label:'入场',stageNo:1,geometry:{kind:'polyline',points:[{x:9.9,z:-2},{x:9.9,z:2}]}}]}};
    const onApply=vi.fn(),getRoute=()=>({source:'user' as const,floorId:'ground',sourceBasis:'unknown' as const});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} getUserRouteProvenance={getRoute} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/仅核对手绘路线中心线与数字模型包围占地/,{},{timeout:15000})).toBeTruthy();
    expect(screen.getByText(/图纸和照片资料状态、原件版本/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));expect(onApply).toHaveBeenCalledOnce();
  },20000);
  it('blocks a candidate that newly intersects a verified hand-drawn centreline',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    annotationSnapshot={revision:1,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'route',kind:'route',label:'入场',stageNo:1,geometry:{kind:'polyline',points:[{x:-9.5,z:-9.475},{x:9.5,z:-9.475}]}}]}};
    const onApply=vi.fn(),getRoute=()=>({source:'user' as const,floorId:'ground',sourceBasis:'unknown' as const});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} getUserRouteProvenance={getRoute} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect((await screen.findAllByText(/路线中心线与 .*模型包围占地新增或加重相交/,{},{timeout:15000})).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('reports incomplete route coverage even when another route has a known intersection',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    annotationSnapshot={revision:1,draft:{id:'draft',createdAt:1,stages:[],annotations:[
      {id:'route-1',kind:'route',label:'入场',stageNo:1,geometry:{kind:'polyline',points:[{x:-9.5,z:-9.475},{x:9.5,z:-9.475}]}},
      {id:'route-2',kind:'route',label:'未知路线',stageNo:1,geometry:{kind:'polyline',points:[{x:9,z:-2},{x:9,z:2}]}},
    ]}};
    const getRoute=(id:string)=>id==='route-1'?{source:'user' as const,floorId:'ground',sourceBasis:'unknown' as const}:null;
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} getUserRouteProvenance={getRoute} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect((await screen.findAllByText(/其他路线或物件信息仍未完整核对/,{},{timeout:15000})).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  },20000);
  it('does not apply a route-bound draft if the hand-drawn provenance expires without a new annotation revision',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    annotationSnapshot={revision:1,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'route',kind:'route',label:'入场',stageNo:1,geometry:{kind:'polyline',points:[{x:9.9,z:-2},{x:9.9,z:2}]}}]}};
    let valid=true;const getRoute=()=>valid?{source:'user' as const,floorId:'ground',sourceBasis:'unknown' as const}:null;const onApply=vi.fn();
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} getUserRouteProvenance={getRoute} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    valid=false;fireEvent.click(confirm);expect(await screen.findByText(/路线、区域或门标注已变化或无法核对/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('keeps an imported or other-floor route in preview-only state',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    annotationSnapshot={revision:1,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'route',kind:'route',label:'入场',stageNo:1,geometry:{kind:'polyline',points:[{x:9.9,z:-2},{x:9.9,z:2}]}}]}};
    const onApply=vi.fn(),getRoute=()=>({source:'user' as const,floorId:'other-floor',sourceBasis:'unknown' as const});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} getUserRouteProvenance={getRoute} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect((await screen.findAllByText(/尚未将已有路线、区域或阶段纳入组团计算/,{},{timeout:15000})).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('reports existing route occupation separately without blaming newly added furniture',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20,floors:[makeFloor({items:[makeItem({id:'existing',position:{x:9.5,z:0},width:.9,depth:.9})]})]});
    annotationSnapshot={revision:1,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'route',kind:'route',label:'入场',stageNo:1,geometry:{kind:'polyline',points:[{x:9.9,z:-2},{x:9.9,z:2}]}}]}};
    const onApply=vi.fn(),getRoute=()=>({source:'user' as const,floorId:'ground',sourceBasis:'unknown' as const});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} getUserRouteProvenance={getRoute} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/原场景已有 1 处路线与模型包围占地相交，不归因于本次新增/,{},{timeout:15000})).toBeTruthy();
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
  },20000);
  it('creates separate desks and chairs when explicitly asked for two per desk',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/需求 30 人、15 桌；本次排了 30 人、15 桌、30 把椅子，尚缺 0 人/,{},{timeout:15000})).toBeTruthy();
    const candidate=onPreview.mock.calls.find(([value])=>!!value)?.[0];
    expect(candidate.floors[0].items.filter((item:{type:string})=>item.type==='desk')).toHaveLength(15);
    expect(candidate.floors[0].items.filter((item:{type:string})=>item.type==='chair')).toHaveLength(30);
  },10000);
  it.each(['一桌坐两人','两人共用一张长桌'])('retains a shared-desk choice from the previous turn: %s',async text=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send(text);await screen.findByText(text);
    send('30人，室内20×20，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/每桌 2 人：用户明确选择/,{},{timeout:15000})).toBeTruthy();expect(onPreview.mock.calls.some(([candidate])=>!!candidate)).toBe(true);
  });
  it('keeps existing objects when previewing shared desks',async()=>{
    configureLocalController();const existing=makeItem({id:'old-item',type:'chair',position:{x:8,z:8}});
    state.layout=makeLayout({id:'local-seating',width:20,height:20,floors:[makeFloor({items:[existing]})]});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    await screen.findByText(/需求 30 人、15 桌；本次排了 30 人/,{},{timeout:15000});
    const candidate=onPreview.mock.calls.find(([value])=>!!value)?.[0];expect(candidate.floors[0].items.find((item:{id:string})=>item.id==='old-item')).toEqual(existing);
    expect(candidate.floors[0].items).toHaveLength(46);
  },20000);
  it('reports broken original desk-chair groups after revising a shared draft',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('2人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    await screen.findByText(/需求 2 人、1 桌；本次排了 2 人/,{},{timeout:15000});
    send('删除课桌');
    expect(await screen.findByText(/原生成的桌椅配套有 .*组缺少物件/,{},{timeout:15000})).toBeTruthy();
    expect(screen.getByText(/实际座位及现场条件仍需核验/)).toBeTruthy();
  },20000);
  it('retains an explicit original-object requirement across a local candidate revision',async()=>{
    configureLocalController();const old=makeItem({id:'old-plant',type:'plant',name:'绿植',position:{x:8,z:8}});
    state.layout=makeLayout({id:'local-seating',width:20,height:20,floors:[makeFloor({items:[old]})]});
    const onApply=vi.fn(),onPreview=vi.fn();
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('2人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    await screen.findByText(/需求 2 人、1 桌；本次排了 2 人/,{},{timeout:15000});
    send('请保留原有物件');
    await screen.findByText(/已记录：保留当前原有物件，不删除/);
    send('删除绿植');
    expect((await screen.findAllByText(/这版与保留原物要求冲突/,{},{timeout:15000})).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    send('确认布置');expect(onApply).not.toHaveBeenCalled();
    expect(state.layout.floors[0]!.items.find(item=>item.id==='old-plant')).toEqual(old);
  },20000);
  it('allows a color-only change when the user asked to keep originals but not their color',async()=>{
    configureLocalController();const old=makeItem({id:'old-plant',type:'plant',name:'绿植',position:{x:8,z:8}});
    state.layout=makeLayout({id:'local-seating',width:20,height:20,floors:[makeFloor({items:[old]})]});
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('2人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    await screen.findByText(/需求 2 人、1 桌；本次排了 2 人/,{},{timeout:15000});
    send('请保留原有物件');await screen.findByText(/已记录：保留当前原有物件，不删除/);
    send('把绿植改成灰色');
    await waitFor(()=>expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy(),{timeout:15000});
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]![0].floors[0].items.find((item:{id:string})=>item.id==='old-plant')).toMatchObject({id:'old-plant',color:'#9aa3ad'});
  },20000);
  it('marks an applied shared draft’s associations unknown when no in-memory witness remains',async()=>{
    configureLocalController();const initial=makeLayout({id:'local-seating',width:20,height:20});
    const onApply=vi.fn();function Harness(){const [current,setCurrent]=useState(initial);state.layout=current;return <LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={next=>{onApply(next);setCurrent(next);}}><AgentPanel/></LayoutAgentProvider>;}
    render(<Harness/>);
    send('2人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    await screen.findByText(/需求 2 人、1 桌；本次排了 2 人/,{},{timeout:15000});
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));expect(onApply).toHaveBeenCalledOnce();
    send('删除课桌');
    expect(await screen.findByText(/桌椅配套关系尚未核验，不能只按椅子数量认定座位充足/,{},{timeout:15000})).toBeTruthy();
  },20000);
  it('handles odd attendance without adding a phantom chair',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('31人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/需求 31 人、16 桌；本次排了 31 人、16 桌、31 把椅子/,{},{timeout:15000})).toBeTruthy();
  },20000);
  it('does not silently enlarge an explicitly narrow desk',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('桌子宽0.6米');await screen.findByText('桌子宽0.6米');
    send('30人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/两把椅子及指定椅距超过桌面宽度/,{},{timeout:15000})).toBeTruthy();expect(onPreview.mock.calls.some(([candidate])=>!!candidate)).toBe(false);
  },20000);
  it('does not claim to support three people per desk',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，每3人一桌，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/每桌\s*3\s*人.*暂不支持/,{},{timeout:15000})).toBeTruthy();
  },20000);
  it('keeps unselected stock specifications out of shared desk drafts',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('现有桌子宽1.8米');await screen.findByText('现有桌子宽1.8米');
    send('30人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/只记录为现有物料线索，尚未选择用于这版方案/)).toBeTruthy();expect(onPreview.mock.calls.some(([candidate])=>!!candidate)).toBe(false);
  });
  it('blocks a shared desk draft intersecting a route',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    annotationSnapshot={revision:1,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'route',kind:'route',label:'入场',stageNo:1,geometry:{kind:'polyline',points:[{x:-9.5,z:-9.475},{x:9.5,z:-9.475}]}}]}};
    const onApply=vi.fn(),getRoute=()=>({source:'user' as const,floorId:'ground',sourceBasis:'unknown' as const});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} getUserRouteProvenance={getRoute} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    expect((await screen.findAllByText(/路线中心线与 .*模型包围占地新增或加重相交/,{},{timeout:15000})).length).toBeGreaterThan(0);expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('refuses a shared draft after the local authority changes',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，每2人一桌，采用课桌椅，生成本地草案');
    const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});fence.mockReturnValue(false);fireEvent.click(confirm);
    expect(await screen.findByText(/云端连接或本机活动状态已变化/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('shows a shared desk shortfall without claiming venue capacity',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:3,height:3});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内3×3，每2人一桌，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/需求 30 人、15 桌；本次排了 \d+ 人、\d+ 桌、\d+ 把椅子，尚缺 \d+ 人/,{},{timeout:15000})).toBeTruthy();expect(screen.getByText(/不代表场地最大容量/)).toBeTruthy();
  },20000);
  it('uses a one-per-desk exploration assumption only when no allocation was stated',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/每人一桌：本次探索假设，用户尚未指定/,{},{timeout:15000})).toBeTruthy();
  },20000);
  it('allows an explicit correction from shared desks to one per person',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('每2人一桌');await screen.findByText('每2人一桌');send('改成每人一桌');await screen.findByText('改成每人一桌');
    send('30人，室内20×20，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/每人一桌：用户明确选择/,{},{timeout:15000})).toBeTruthy();
  },20000);
  it('does not generate the one-per-desk draft after the user negates it',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('不要每人一桌');await screen.findByText('不要每人一桌');send('30人，室内20×20，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/每桌人数尚不明确/)).toBeTruthy();expect(onPreview.mock.calls.some(([candidate])=>!!candidate)).toBe(false);
  });
  it('preserves an explicitly stated desk width across turns rather than using the default',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('桌子宽1.8米');await waitFor(()=>expect(document.querySelector('.ap-feed')?.textContent).toContain('桌子宽1.8米'));
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    await waitFor(()=>expect(onPreview.mock.calls.some(([layout])=>layout?.floors[0]?.items.some((item:{type:string;width:number})=>item.type==='desk'&&item.width===1.8))).toBe(true),{timeout:6000});
  },10000);
  it('uses corrected centimetre and millimetre values with visible user-provided provenance',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('桌子宽1.8米');await screen.findByText('桌子宽1.8米');
    send('桌子宽改为160厘米，椅子深570毫米');await screen.findByText('桌子宽改为160厘米，椅子深570毫米');
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/单人桌 1.6（用户提供）/,{},{timeout:15000})).toBeTruthy();
    const candidate=onPreview.mock.calls.map(([value])=>value).find(value=>value?.floors[0]?.items.some((item:{type:string;width:number})=>item.type==='desk'&&item.width===1.6));
    expect(candidate).toBeTruthy();expect(candidate.floors[0].items.some((item:{type:string;depth:number})=>item.type==='chair'&&item.depth===.57)).toBe(true);
  },20000);
  it('does not silently use a default when a previously stated dimension has no unit',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('桌子宽1.8');await screen.findByText('桌子宽1.8');
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/桌子宽度尚未明确/)).toBeTruthy();expect(onPreview.mock.calls.some(([value])=>!!value)).toBe(false);
  });
  it('requires clarification rather than silently keeping the old size after an ambiguous correction',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('桌子宽1.8米');await screen.findByText('桌子宽1.8米');
    send('改成1.6米');await screen.findByText('改成1.6米');
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/桌子宽度尚未明确/)).toBeTruthy();expect(onPreview.mock.calls.some(([value])=>!!value)).toBe(false);
  });
  it('does not use an observed stock size until the user explicitly selects it',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('现有桌子宽1.8米');await screen.findByText('现有桌子宽1.8米');
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    const notice=await screen.findByText(/只记录为现有物料线索，尚未选择用于这版方案/);
    expect(notice.textContent).toContain('使用现有桌子宽度1.8米');expect(notice.textContent).toContain('桌子按默认规格');
    expect(onPreview.mock.calls.some(([value])=>!!value)).toBe(false);
    send('使用现有桌子宽1.8米');await screen.findByText('使用现有桌子宽1.8米');
    send('生成本地草案');
    await waitFor(()=>expect(onPreview.mock.calls.some(([value])=>value?.floors[0]?.items.some((item:{type:string;width:number})=>item.type==='desk'&&item.width===1.8))).toBe(true),{timeout:15000});
  },20000);
  it('allows a clearly requested default illustration without claiming it matches stock',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('现有桌子宽1.8米');await screen.findByText('现有桌子宽1.8米');
    send('桌子按默认规格');await screen.findByText('桌子按默认规格');
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/单人桌 0.6（假设）/,{},{timeout:15000})).toBeTruthy();
    expect(onPreview.mock.calls.some(([value])=>value?.floors[0]?.items.some((item:{type:string;width:number})=>item.type==='desk'&&item.width===.6))).toBe(true);
  },20000);
  it('does not transfer furniture dimensions into a different chat',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('桌子宽1.8米');await screen.findByText('桌子宽1.8米');
    fireEvent.click(screen.getByRole('button',{name:'新开会话'}));
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    await waitFor(()=>expect(onPreview.mock.calls.some(([value])=>value?.floors[0]?.items.some((item:{type:string;width:number})=>item.type==='desk'&&item.width===.6))).toBe(true),{timeout:15000});
  },20000);
  it('previews 30 pairs without removing existing items, then applies and undoes locally',async()=>{
    const old=makeItem({id:'existing-local-chair',type:'chair',name:'已有椅子',locked:true,position:{x:8,z:8}});
    const base=makeLayout({id:'local-seating',width:20,height:20,floors:[makeFloor({items:[old]})]});
    useRealLayoutStore=true;layoutStore.setState({layout:base,activeFloorIndex:0});
    configureLocalController();
    function ScopedHistory(){
      const {layout,actions}=useLayoutState();const history=useHistory(layout,actions.applyLayout,{debounceMs:10});state.layout=layout;
      return <LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={next=>{history.commitNow();actions.applyLayout(next);}}>
        <AgentPanel/><button type="button" onClick={history.undo}>撤销本机草案</button>
      </LayoutAgentProvider>;
    }
    try {
      render(<ScopedHistory/>);send('30人，室内20×20，按一人一套课桌椅生成本地草案');
      await waitFor(()=>expect(visibleText(document.body.textContent)).toContain('本机草案：本次排了 30 / 30 套'),{timeout:3000});
      expect(layoutStore.getState().layout.floors[0]!.items).toEqual([old]);
      fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
      await waitFor(()=>expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(61));
      expect(layoutStore.getState().layout.floors[0]!.items.find(item=>item.id===old.id)).toEqual(old);
      fireEvent.click(screen.getByRole('button',{name:'导出与交接'}));expect(callbacks.onOpenDelivery).toHaveBeenCalledOnce();
      expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(61);
      fireEvent.click(screen.getByRole('button',{name:'撤销本机草案'}));
      await waitFor(()=>expect(layoutStore.getState().layout.floors[0]!.items).toEqual([old]));
    }finally{layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});useRealLayoutStore=false;}
  },20000);
  it('refuses confirmation if a cloud transition starts after the preview',async()=>{
    state.layout=makeLayout({id:'local-seating',width:20,height:20});
    configureLocalController();
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，采用课桌椅，生成本地草案');
    expect(await screen.findByText(/本机草案：本次排了 30 \/ 30 套/,{},{timeout:15000})).toBeTruthy();
    fence.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/云端连接或本机活动状态已变化/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('withdraws an in-flight preview if cloud preparation begins before it finishes',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onApply=vi.fn(),onPreview=vi.fn((candidate:RoomLayout|null)=>{if(candidate)fence.mockReturnValue(false);});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/本地草案预览已收回/,{},{timeout:15000})).toBeTruthy();
    expect(onPreview).toHaveBeenLastCalledWith(null);expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  },20000);
  it('refuses an explicit local draft while a cloud project is connected',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});studioMock.connection='项目已连接';
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/本地草案需要独立的本机活动/)).toBeTruthy();
    expect(studioMock.generate).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('displays a partial draft and its missing number without claiming venue capacity',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:3,height:3});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内3×3，按一人一套课桌椅生成本地草案');
    const line=await screen.findByText(/本机草案：本次排了 \d+ \/ 30 套，尚缺 \d+ 套/,{},{timeout:15000});
    expect(line.textContent).toContain('未同步云端');expect(line.textContent).not.toContain('场地最多');
  },20000);
  it('shows a Chinese reason if no placement fits',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:1,height:1});
    render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内1×1，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/当前排布没有找到可放位置/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('no_placement');
  });
  it('does not apply a local preview after switching activities',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/本机草案：本次排了 30 \/ 30 套/,{},{timeout:15000})).toBeTruthy();
    act(()=>{state.layout=makeLayout({id:'other-activity',width:20,height:20});fireEvent.click(screen.getByRole('button',{name:'确认布置'}));});
    expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('does not apply a local preview after the signed-in account changes',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const controller=studioMock.controller as typeof studioMock.controller & {getSnapshot:()=>unknown};
    let actor='account-a';controller.getSnapshot=()=>({project:null,geometryBinding:null,user:{id:actor},sessionId:'same-session'});
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/本机草案：本次排了 30 \/ 30 套/,{},{timeout:15000})).toBeTruthy();
    actor='account-b';fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/云端连接或本机活动状态已变化/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('invalidates an old preview even if the account changes A to B and back to A',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const controller=studioMock.controller as typeof studioMock.controller & {getSnapshot:()=>unknown;subscribe:(callback:()=>void)=>()=>void};
    let actor='account-a',notify=()=>{};
    controller.getSnapshot=()=>({project:null,geometryBinding:null,user:{id:actor},sessionId:'same-session'});
    controller.subscribe=callback=>{notify=callback;return()=>{};};
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/本机草案：本次排了 30 \/ 30 套/,{},{timeout:15000})).toBeTruthy();
    act(()=>{actor='account-b';notify();actor='account-a';notify();});
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('invalidates a local candidate when the user opens a new chat',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/本机草案：本次排了 30 \/ 30 套/,{},{timeout:15000})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'新开会话'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull());expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('refuses an old preview if the controller authority version changed without a visible account change',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const controller=studioMock.controller as typeof studioMock.controller & {localDraftAuthorityVersion:()=>string};
    let version='0:0';controller.localDraftAuthorityVersion=()=>version;
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/本机草案：本次排了 30 \/ 30 套/,{},{timeout:15000})).toBeTruthy();
    version='2:3';fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/云端连接或本机活动状态已变化/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('keeps an existing route as a visible unchecked limitation and does not enable confirmation',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    annotationSnapshot={revision:4,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'route',kind:'route',label:'入场路线',stageNo:1,geometry:{kind:'polyline',points:[{x:0,z:0},{x:1,z:1}]}}]}};
    const onApply=vi.fn(),onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={onPreview} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect((await screen.findAllByText(/尚未将已有路线、区域或阶段纳入组团计算/)).length).toBeGreaterThan(0);
    expect(onPreview.mock.calls.some(([value])=>!!value)).toBe(true);expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('refuses confirmation if annotations change before React rerenders',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    annotationSnapshot={revision:1,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'zone',kind:'zone',label:'预留区',stageNo:1,geometry:{kind:'rect',x:0,z:0,width:2,depth:2}}]}};
    fireEvent.click(confirm);expect(await screen.findByText(/路线、区域或门标注已变化或无法核对/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('keeps an unchecked doorway unknown while allowing a clearly labelled exploration draft',async()=>{
    configureLocalController();const door=makeItem({id:'existing-door',type:'door',name:'入口门',position:{x:0,z:-9},width:1,depth:.1});
    state.layout=makeLayout({id:'local-seating',width:20,height:20,floors:[makeFloor({items:[door]})]});
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect((await screen.findAllByText(/图中门洞或入口未纳入本次组团净空检查/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));expect(onApply).toHaveBeenCalledOnce();
    expect(await screen.findByText(/只是探索草案，不代表安全通过或可交付/)).toBeTruthy();
  },20000);
  it('does not treat an inferred default door as a hard failure',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    annotationSnapshot={revision:3,draft:{id:'draft',createdAt:1,stages:[],annotations:[{id:'inferred-door',kind:'door',label:'推测门',stageNo:1,geometry:{kind:'door',wall:'south',position:0,widthM:null,inferred:true}}]}};
    const onApply=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" getPlanAnnotationSnapshot={readAnnotations} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/图中门洞或入口未纳入本次组团净空检查/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));expect(onApply).toHaveBeenCalledOnce();
  },20000);
  it('refuses to generate when an annotation snapshot cannot be read',async()=>{
    configureLocalController();state.layout=makeLayout({id:'local-seating',width:20,height:20});
    const onPreview=vi.fn();render(<LayoutAgentProvider sessionScope="activity:local-seating" callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30人，室内20×20，按一人一套课桌椅生成本地草案');
    expect(await screen.findByText(/路线与区域标注无法完整读取/)).toBeTruthy();
    expect(onPreview.mock.calls.some(([value])=>!!value)).toBe(false);
  });
});

describe('明确待定的需求',()=>{
  it('回显已知人数，说明库存未保存，不要求用户立刻决定签到',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    studioMock.controller.briefExtract.mockResolvedValueOnce({enabled:true,extraction:{event:'讲座',headcount:30,venueIO:'indoor',activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'是否签到还没决定'}]}});
    const onApply=vi.fn();render(ui(makeLayout(),onApply));
    send('为长者办一场室内讲座，预计30人，现有80把椅子；是否签到还没决定。');
    const reply=await screen.findByText(/签到区暂时待定/);
    expect(reply.textContent).toContain('30 人');
    expect(reply.textContent).toContain('暂未计入库存');
    expect(reply.textContent).not.toContain('请告诉我是否需要');
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('活动需求与清单同句',()=>{
  it('保留整句交给需求理解，明确清单尚未执行',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    try {
      studioMock.controller.briefExtract.mockResolvedValueOnce({enabled:true,extraction:{headcount:30}});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('本场30人，给我物料清单');
      expect(await screen.findByText(/清单、检查、评审或导出操作暂未执行/)).toBeTruthy();
      await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledOnce());
      expect(studioMock.controller.briefExtract.mock.calls[0]?.[0]).toBe('本场30人，给我物料清单');
      expect(screen.queryByText(/画布上还没有物料，清单是空的/)).toBeNull();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
});

describe('只读活动问答',()=>{
  it('重新打开同一会话后保留可见问答上下文',async()=>{
    vi.stubEnv('NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED','1');
    try {
      studioMock.controller.assistantChat.mockResolvedValueOnce({status:'ok',answer:'可以先了解入场方式。'}).mockResolvedValueOnce({status:'ok',answer:'也要考虑到达时间。'});
      const layout=makeLayout();const first=render(ui(layout));send('签到有什么作用？');await screen.findByText('可以先了解入场方式。');
      first.unmount();render(ui(layout));await screen.findByText('可以先了解入场方式。');send('为什么活动要留通道？');await screen.findByText('也要考虑到达时间。');
      expect(studioMock.controller.assistantChat.mock.calls[1]?.[1]).toEqual([{role:'user',text:'签到有什么作用？'},{role:'assistant',text:'可以先了解入场方式。'}]);
    } finally {vi.unstubAllEnvs();}
  });
  it('普通问题进入模型问答，后续问题带本会话用户原话，不修改场景',async()=>{
    vi.stubEnv('NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED','1');
    try {
      studioMock.controller.assistantChat.mockResolvedValueOnce({status:'ok',answer:'签到可以帮助核对到场人员。'}).mockResolvedValueOnce({status:'ok',answer:'通道需要结合实际场地核验。'});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));
      send('签到有什么作用？');expect(await screen.findByText('签到可以帮助核对到场人员。')).toBeTruthy();
      send('为什么活动要留通道？');expect(await screen.findByText('通道需要结合实际场地核验。')).toBeTruthy();
      expect(studioMock.controller.assistantChat).toHaveBeenCalledTimes(2);
      expect(studioMock.controller.assistantChat.mock.calls[1]?.[1]).toEqual([{role:'user',text:'签到有什么作用？'},{role:'assistant',text:'签到可以帮助核对到场人员。'}]);
      expect(studioMock.controller.briefExtract).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
  it('停止等待后不显示迟到的问答，并要求确认后才重发',async()=>{
    vi.stubEnv('NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED','1');
    try {
      let finish!:(value:{status:'ok';answer:string})=>void;
      studioMock.controller.assistantChat.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
      render(ui(makeLayout()));send('签到有什么作用？');await waitFor(()=>expect(studioMock.controller.assistantChat).toHaveBeenCalledOnce());
      fireEvent.click(screen.getByRole('button',{name:'停止等待'}));
      await act(async()=>{finish({status:'ok',answer:'迟到的回答'});await Promise.resolve();});
      expect(screen.queryByText('迟到的回答')).toBeNull();send('签到有什么作用？');
      expect(await screen.findByRole('button',{name:'确认再次发送'})).toBeTruthy();expect(studioMock.controller.assistantChat).toHaveBeenCalledOnce();
    } finally {vi.unstubAllEnvs();}
  });
  it('账号切换再切回时丢弃旧账号的迟到回答',async()=>{
    vi.stubEnv('NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED','1');
    let actor='a';const listeners=new Set<()=>void>();
    const controller=studioMock.controller as typeof studioMock.controller&{getSnapshot?:()=>unknown;subscribe?:(fn:()=>void)=>()=>void};
    controller.getSnapshot=()=>({user:{id:actor}});controller.subscribe=fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
    try {
      let finish!:(value:{status:'ok';answer:string})=>void;
      studioMock.controller.assistantChat.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
      render(ui(makeLayout()));send('签到有什么作用？');await waitFor(()=>expect(studioMock.controller.assistantChat).toHaveBeenCalledOnce());
      act(()=>{actor='b';listeners.forEach(fn=>fn());actor='a';listeners.forEach(fn=>fn());});
      await act(async()=>{finish({status:'ok',answer:'旧账号的回答'});await Promise.resolve();});
      expect(screen.queryByText('旧账号的回答')).toBeNull();
    } finally {delete controller.getSnapshot;delete controller.subscribe;vi.unstubAllEnvs();}
  });
});

describe('同一轮理解和回答',()=>{
  it('生成失败时不臆断网络原因或催促重复请求',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
    try{
      const onApply=vi.fn();render(ui(makeLayout(),onApply));
      send('30人，室内20×20，按一人一套课桌椅生成本地草案');
      const message=await screen.findByText(/这次未完成，原场景未自动应用/);
      expect(message.textContent).toContain('请先查看任务状态或提示');
      expect(screen.queryByText(/可能是网络断了/)).toBeNull();expect(onApply).not.toHaveBeenCalled();
    }finally{vi.unstubAllEnvs();}
  });
  it('保留前一轮人数，不展示模型误称人数待定的回复',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try{
      const onMemory=vi.fn();state.layout=makeLayout();
      render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
      send('本场30人');await waitFor(()=>expect(onMemory.mock.calls.some(([memory])=>memory.headcount===30)).toBe(true));
      vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
      studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{layoutMode:'desk-chair'},reply:'本场总人数尚未在当前表述中明确，暂按人数待定探索。',unhandled:[],factEvidence:[{key:'layoutMode',evidence:'课桌椅'}]});
      send('采用课桌椅布局，每桌两人');
      expect(await screen.findByText(/本场已记录 30 人/)).toBeTruthy();
      expect(screen.queryByText(/暂按人数待定探索/)).toBeNull();
      expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(30);
    }finally{vi.unstubAllEnvs();}
  });
  it('不会因为模型截取了否定语句里的物料名就推荐该物料',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try {
      studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{},reply:'先保留你的选择。',unhandled:[],factEvidence:[],materialQueries:[{query:'椅子',evidence:'椅子'}]});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('本场不要椅子');
      expect(await screen.findByText('先保留你的选择。')).toBeTruthy();expect(screen.queryByRole('region',{name:'物料候选'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
  it('没有场地时记录口述物料，仍提供物料库入口',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try {
      studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{headcount:30,inventoryMentions:[{evidence:'80把椅子'}]},reply:'可先查看物料库里的椅子，规格还需核对。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('先按30人，我有80把椅子');
      expect(await screen.findByText(/可先查看物料库里的椅子/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button',{name:'查看物料库'}));expect(callbacks.onOpenMaterials).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
  it('资料尚缺时先讨论活动方向，不强迫立刻填场地',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try {
      studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{event:'创作体验'},reply:'可以先和社区讨论共同绘画或故事手作，场地和人数之后一起确定。',unhandled:[{kind:'other',evidence:'和杭州西湖的养老社区商议'}],factEvidence:[{key:'event',evidence:'创作体验'}]});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('我想和杭州西湖的养老社区商议一场创作体验，人数、具体场地、档期和物料都还没定，有什么方向？');
      expect(await screen.findByText(/可以先和社区讨论共同绘画或故事手作/)).toBeTruthy();expect(studioMock.controller.briefConversation).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
  it('用户说签到还没决定时不强迫马上决定，并告知库存尚未保存',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try {
      studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{headcount:30,venueIO:'indoor',inventoryMentions:[{evidence:'80把椅子'}],activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'是否签到还没决定'}]},reply:'先按30人室内讲座了解，签到可以稍后决定。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'},{key:'venueIO',evidence:'室内'}],materialQueries:[{query:'椅子',evidence:'80把椅子'}]});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('为长者办一场室内讲座，预计30人，现有80把椅子；是否签到还没决定。');
      const reply=await screen.findByText(/签到区暂时待定/);expect(reply.textContent).toContain('30 人');expect(reply.textContent).toContain('暂未计入库存');expect(reply.textContent).not.toContain('请告诉我是否需要');
      expect(await screen.findByText(/已记下你提到的物料数量/)).toBeTruthy();
      const candidates=await screen.findByRole('region',{name:'物料候选'});expect((await within(candidates).findByText(/软包餐椅/)).textContent).toContain('软包餐椅');expect(candidates.textContent).toContain('实物规格、库存和价格还需核实');
      fireEvent.click(within(candidates).getByRole('button',{name:'打开物料库'}));expect(callbacks.onOpenMaterials).toHaveBeenCalledOnce();
      expect(studioMock.controller.briefConversation).toHaveBeenCalledOnce();expect(studioMock.controller.briefExtract).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
  it('生成期间排队的问题仍带上当时的对话上下文',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try {
      studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{},reply:'签到有助于核对到场情况。',unhandled:[],factEvidence:[]});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('加一把椅子');send('签到有什么作用？');
      expect(await screen.findByText('签到有助于核对到场情况。',undefined,{timeout:15000})).toBeTruthy();
      expect(studioMock.controller.briefConversation.mock.calls[0]?.[1]).toContainEqual({role:'user',text:'加一把椅子'});expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  },20000);
  it('一次模型调用回答普通问题，不再追问人数，也不修改场景',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try {
      studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{},reply:'签到有助于核对到场情况，也可以选择不设置。',unhandled:[],factEvidence:[]});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('签到有什么作用？');
      expect(await screen.findByText('签到有助于核对到场情况，也可以选择不设置。')).toBeTruthy();
      expect(studioMock.controller.briefConversation).toHaveBeenCalledOnce();expect(studioMock.controller.briefExtract).not.toHaveBeenCalled();expect(studioMock.controller.assistantChat).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
  it('复合句保留人数和未执行清单，不假装完成动作',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try {
      studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{headcount:30},reply:'先按30人梳理活动需求。',unhandled:[{kind:'action',evidence:'给我物料清单'}],factEvidence:[{key:'headcount',evidence:'30人'}]});
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('本场30人，给我物料清单');
      expect(await screen.findByText(/以下内容尚未执行或仍需核对/)).toBeTruthy();expect(studioMock.controller.briefConversation).toHaveBeenCalledOnce();expect(studioMock.controller.briefExtract).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
  it('停止统一对话后不显示迟到回复或写入需求',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    try {
      let finish!:(value:unknown)=>void;studioMock.controller.briefConversation.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('计划30人参加');
      await waitFor(()=>expect(studioMock.controller.briefConversation).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole('button',{name:'停止等待'}));
      await act(async()=>{finish({enabled:true,extraction:{headcount:30},reply:'已记录30人',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]});await Promise.resolve();});
      expect(screen.queryByText('已记录30人')).toBeNull();expect(studioMock.setBrief).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
  });
  it('账号切换后不让旧模型结果写回本场需求',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    let actor='a';const listeners=new Set<()=>void>();
    const controller=studioMock.controller as typeof studioMock.controller&{getSnapshot?:()=>unknown;subscribe?:(fn:()=>void)=>()=>void};
    controller.getSnapshot=()=>({user:{id:actor}});controller.subscribe=fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
    try {
      let finish!:(value:unknown)=>void;studioMock.controller.briefConversation.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
      const onApply=vi.fn();render(ui(makeLayout(),onApply));send('本场30人');await waitFor(()=>expect(studioMock.controller.briefConversation).toHaveBeenCalledOnce());
      act(()=>{actor='b';listeners.forEach(fn=>fn());actor='a';listeners.forEach(fn=>fn());});
      await act(async()=>{finish({enabled:true,extraction:{headcount:30},reply:'30人的建议',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]});await Promise.resolve();});
      expect(screen.queryByText(/30人的建议/)).toBeNull();expect(studioMock.setBrief).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    } finally {delete controller.getSnapshot;delete controller.subscribe;vi.unstubAllEnvs();}
  });
});

async function reviewAndFix(): Promise<void> {
  send('看看哪里有问题');
  fireEvent.click(await screen.findByRole('button', { name: /按这条改：把靠边的桌椅往场中挪/ }));
}

beforeEach(() => {
  useRealLayoutStore = false;
  vi.spyOn(layoutStore, 'getState').mockImplementation(() => {
    const actual = realLayoutStoreGetState();
    return useRealLayoutStore ? actual : { ...actual, layout: state.layout };
  });
  state.layout = seatLayout();
  state.view = makeViewSettings();
  state.apply = vi.fn();
  state.addItems = vi.fn();
  state.commitNow = vi.fn();
  state.setView = vi.fn();
  callbacks.workbenchMode = 'layout';
  for (const callback of Object.values(callbacks)) if (typeof callback === 'function') callback.mockClear();
  studioMock.exportActivity.mockReset(); studioMock.exportActivity.mockResolvedValue(undefined);
  studioMock.exportCloudMaterialDraft.mockReset(); studioMock.exportCloudMaterialDraft.mockResolvedValue(undefined);studioMock.cloudMaterialDraftAvailable=false;
  studioMock.generate.mockReset(); studioMock.generate.mockResolvedValue(undefined);
  studioMock.cancelRun.mockClear();
  studioMock.discardPreview.mockReset(); studioMock.setBrief.mockClear();
  studioMock.applyPreview.mockReset(); studioMock.applyPreview.mockResolvedValue(undefined);
  studioMock.setCandidateInventory.mockReset();studioMock.setCandidateInventory.mockReturnValue(true);
  studioMock.brief = { event: null, guests: null, eventConfirmed: undefined, guestsConfirmed: undefined };
  studioMock.hasSavedBrief = false;
  studioMock.preview = null; studioMock.stale = false; studioMock.expired = false; studioMock.busy = false;
  studioMock.recoverable = false;
  studioMock.applyRecovery = null;
  studioMock.connection = '离线引导';
  studioMock.controller.briefExtract.mockReset();
  studioMock.controller.briefConversation.mockReset();
  studioMock.controller.assistantChat.mockReset();
  studioMock.applyRecovery = null; studioMock.applyRecoveryReview = null; studioMock.reviewingApplyRecovery = false;
  studioMock.reviewApplyRecovery.mockClear(); studioMock.acknowledgeApplyRecovery.mockClear();
  localStorage.clear();
  resetAssistantSessionsStoreForTests();
  resetVolatileAssistantMemoriesForTests();
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('T-04 delivery narrative in the Agent panel', () => {
  it('T3 封门：评审模式右栏不再渲染钉议卡槽，面板内没有「打开客户评审」', () => {
    callbacks.workbenchMode = 'review';
    render(ui(state.layout));
    // reviewSlot 死门已封死：评审只走分享链接，面板内不再有钉议卡 CTA。
    expect(screen.queryByRole('button', { name: '打开客户评审' })).toBeNull();
    expect(screen.queryByText('议题')).toBeNull();
    expect(screen.queryByText('确认可进执行')).toBeNull();
  });

  it('opens customer review from an explicit chat sentence', async () => {
    render(ui(state.layout));
    send('准备客户评审');
    await waitFor(() => expect(callbacks.onOpenReview).toHaveBeenCalledOnce());
  });

  // Agent 贯穿：评审/执行模式也留着输入框，说过的话必须回显在同一份记录里。
  it('does not edit the layout from chat while review is open', async () => {
    callbacks.workbenchMode = 'review';
    const onApply = vi.fn();
    render(ui(state.layout, onApply));
    send('再加两把椅子');
    expect(await screen.findByText(/不改布置/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps the conversation visible in review mode', async () => {
    callbacks.workbenchMode = 'review';
    render(ui(state.layout));
    send('准备客户评审');
    await waitFor(() => expect(callbacks.onOpenReview).toHaveBeenCalledOnce());
    const userTurn = document.querySelector('.ap-user');
    expect(userTurn?.textContent).toContain('准备客户评审');
    expect(document.querySelector('.ap-turn')?.textContent).toBeTruthy();
  });

  it('T3 封门：执行模式右栏不再渲染交付卡槽，导出交接入口已从面板拆除', () => {
    callbacks.workbenchMode = 'delivery';
    render(ui(state.layout));
    // deliverySlot 死门已封死：到场清单走分享菜单抽屉，面板内不再有交付卡。
    expect(screen.queryByRole('button', { name: '导出交接' })).toBeNull();
    expect(screen.queryByRole('button', { name: '打开执行资料' })).toBeNull();
    expect(screen.queryByText('导出执行资料草案')).toBeNull();
    expect(document.body.textContent).not.toContain('云端协作');
    expect(document.body.textContent).not.toContain('现场履约');
  });
});

describe('T-03 review in the Agent panel', () => {
  it('reports geometry issues without a compliance verdict, then previews a fix only', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(ui(state.layout, onApply, onPreview));
    send('看看哪里有问题');

    expect(await screen.findByText(/不是合规审查/)).toBeTruthy();
    expect(await screen.findByText(/入口通道我不猜/)).toBeTruthy();
    expect(await screen.findByText(/靠边的椅子拉不开/)).toBeTruthy();
    const before = JSON.stringify(state.layout);
    const draftBefore = localStorage.getItem(STORAGE_KEY);

    fireEvent.click(screen.getByRole('button', { name: /按这条改：把靠边的桌椅往场中挪/ }));
    expect(await screen.findByText('改法预览')).toBeTruthy();
    // 气泡先念一遍结果、卡片再给完整账单：这句在两张脸上都有，断言钉的是卡片那份。
    expect(within(screen.getByLabelText('本次结果')).getByText(/只挪位置，其他没动 · 挪了 2 件/)).toBeTruthy();
    // T-UI：n/4 向导进度条已隐藏，右栏不再出现「第几步/共四步」的读数。
    expect(screen.queryByText(/\d\/4/)).toBeNull();
    await waitFor(() => expect(onPreview).toHaveBeenCalled());
    const previewed = onPreview.mock.calls.at(-1)![0] as RoomLayout;
    expect(previewed.floors[0]!.items.find(item => item.id === 'seat')!.position!.x).toBeLessThan(3.35);
    expect(onApply).not.toHaveBeenCalled();
    expect(JSON.stringify(state.layout)).toBe(before);
    // 对话气泡可以写本机会话正文；预览本身不得动画布草稿键。
    expect(localStorage.getItem(STORAGE_KEY)).toBe(draftBefore);

    fireEvent.click(screen.getByRole('button', { name: '撤回' }));
    expect(await screen.findByText(/撤了：预览收回，物件都还在原位/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies the previewed fix once and leaves every other field alone', async () => {
    const onApply = vi.fn();
    const layout = seatLayout();
    const before = JSON.stringify(layout);
    render(ui(layout, onApply));
    await reviewAndFix();
    expect(await screen.findByText('改法预览')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![1]).toMatchObject({ expectedBase: layout, preserveProvenance: true, expectedFloor:{floorId:layout.floors[0]!.id,floorIndex:0} });
    const next = onApply.mock.calls[0]![0] as RoomLayout;
    expect(next.floors[0]!.items.find(item => item.id === 'seat')!.position!.x).toBeLessThan(3.35);
    expect(next.name).toBe(layout.name);
    const tableBefore = layout.floors[0]!.items.find(item => item.id === 'table')!;
    const tableAfter = next.floors[0]!.items.find(item => item.id === 'table')!;
    expect({ ...tableAfter, position: tableBefore.position }).toEqual(tableBefore);
    expect(JSON.stringify(layout)).toBe(before);
    expect(await screen.findByText(/确认了：2 件换了位置，其他没动/)).toBeTruthy();
  });

  it('reports a locked chair and never previews a hard move', async () => {
    const onApply = vi.fn();
    render(ui(seatLayout({ locked: true }), onApply));
    await reviewAndFix();
    expect(await screen.findByText(/锁着没动：椅子/)).toBeTruthy();
    expect(screen.queryByText('改法预览')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/这条没改成/)).toBeTruthy();
  });

  it('refuses a second review while a fix is still pending', async () => {
    const onApply = vi.fn();
    render(ui(seatLayout(), onApply));
    await reviewAndFix();
    expect(await screen.findByText('改法预览')).toBeTruthy();
    send('再看看哪里有问题');
    expect(await screen.findByText(/还有一版没确认：先点「确认布置」或「撤回」/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('T-UI visible interaction', () => {
  it('keeps the idle rail free of primary buttons and labels local rule-based understanding', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:3099');
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '0');
    try {
      render(ui(state.layout));
      expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();
      expect(screen.queryByText(/\d\/4/)).toBeNull();
      expect(screen.getByText(/本机试用 · 当前对话使用本机规则理解/)).toBeTruthy();
      expect(screen.queryByText(/生成能力尚未连接服务商/)).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });

  it('does not say the provider is unavailable or claim success merely from a local backend when model use is enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:3099');
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    try {
      render(ui(state.layout));
      expect(screen.getByText(/本机试用 · 可尝试智能对话，是否可用以实际运行结果为准/)).toBeTruthy();
      expect(screen.queryByText(/生成能力尚未连接服务商/)).toBeNull();
      expect(screen.queryByText(/智能服务已连接/)).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });

  it('puts speak-first examples in the 活动 chat, with chips behind adjust', () => {
    render(ui(INITIAL_LAYOUT));
    const home = screen.getByLabelText('生成活动方案');
    expect(home).toBeTruthy();
    expect(within(home).getByRole('group', { name: '需求例句' })).toBeTruthy();
    expect(within(home).getByRole('button', { name: '80 人发布会，室内 12×9' })).toBeTruthy();
    expect(within(home).getByRole('button', { name: '生成方案' })).toBeTruthy();
    expect(within(home).queryByRole('button', { name: '品牌快闪' })).toBeNull();
    fireEvent.click(within(home).getByRole('button', { name: '改类型或人数' }));
    expect(within(home).getByRole('button', { name: '品牌快闪' })).toBeTruthy();
  });

  it('restores 活动 bubbles when switching sessions and clears them on a new one', async () => {
    render(ui(state.layout));
    send('先记一句发布会需求');
    expect(await screen.findByText('先记一句发布会需求')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '新开会话' }));
    await waitFor(() => expect(screen.queryByText('先记一句发布会需求')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '会话历史' }));
    const rows = within(screen.getByRole('list', { name: '方案会话列表' })).getAllByRole('button', { name: /^新会话/ });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const previous = rows.find(button => button.getAttribute('aria-current') !== 'true');
    expect(previous).toBeTruthy();
    fireEvent.click(previous!);
    expect(await screen.findByText('先记一句发布会需求')).toBeTruthy();
  });

  it('keeps activity requirements separate when switching conversations and restores the earlier conversation', async () => {
    render(ui(state.layout));
    send('80 人');
    await screen.findByText(/记下了：80 人/);
    fireEvent.click(screen.getByRole('button', { name: '新开会话' }));
    await waitFor(() => expect(screen.queryByText(/记下了：80 人/)).toBeNull());
    send('30 人');
    await screen.findByText(/记下了：30 人/);
    fireEvent.click(screen.getByRole('button', { name: '会话历史' }));
    const rows = within(screen.getByRole('list', { name: '方案会话列表' })).getAllByRole('button', { name: /^新会话/ });
    fireEvent.click(rows.find(button => button.getAttribute('aria-current') !== 'true')!);
    await screen.findByText(/记下了：80 人/);
    send('室内');
    await screen.findByText(/记下了：80 人 · 室内/);
    expect(screen.queryByText(/30 人/)).toBeNull();
  });

  it('restores saved activity requirements when the conversation is reopened', async () => {
    const view = render(ui(state.layout));
    send('80 人');
    await screen.findByText(/记下了：80 人/);
    view.unmount();
    resetAssistantSessionsStoreForTests();
    render(ui(state.layout));
    await screen.findByText('80 人');
    send('室内');
    expect(await screen.findByText(/记下了：80 人 · 室内/)).toBeTruthy();
  });

  it('isolates A → B → A and survives refresh without importing old project facts',async()=>{
    const onMemory=vi.fn(),onApply=vi.fn(),onPreview=vi.fn();
    const tree=(id:string)=><LayoutAgentProvider key={id} sessionScope={`activity:${id}`} callbacks={callbacks} onApply={onApply} onPreview={onPreview} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
    state.layout=makeLayout({id:'A'});const view=render(tree('A'));
    send('80人，圆桌');await waitFor(()=>expect(onMemory.mock.calls.some(([m])=>m.headcount===80&&m.layoutModeConfirmed)).toBe(true));
    state.layout=makeLayout({id:'B'});view.rerender(tree('B'));
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull());
    expect(document.querySelector('.ap-feed')?.textContent).not.toContain('80 人');
    send('30人，课桌');await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(30));
    state.layout=makeLayout({id:'A'});view.rerender(tree('A'));
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(80));
    view.unmount();resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();render(tree('A'));
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(80));
  });
  it('does not write a late model response into a switched activity',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    try {
      let finish!:(value:unknown)=>void;
      studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
      const onMemory=vi.fn();const tree=(id:string)=><LayoutAgentProvider key={id} sessionScope={`activity:${id}`} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
      state.layout=makeLayout({id:'A'});const view=render(tree('A'));send('80人');
      await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledOnce());
      state.layout=makeLayout({id:'B'});view.rerender(tree('B'));
      await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull());
      await act(async()=>{finish({enabled:true,extraction:{headcount:80}});await Promise.resolve();});
      expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull();expect(document.querySelector('.ap-feed')?.textContent).not.toContain('80 人');
    } finally {vi.unstubAllEnvs();}
  });
  it('rejects a stale event immediately after the store changes, before a React rerender',async()=>{
    const onMemory=vi.fn(),onApply=vi.fn();state.layout=makeLayout({id:'A'});
    render(<LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={onApply} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    await waitFor(()=>expect(onMemory).toHaveBeenCalled());const before=onMemory.mock.calls.length;
    act(()=>{state.layout=makeLayout({id:'B'});send('80人，圆桌');});
    expect(onMemory.mock.calls.length).toBe(before);expect(onApply).not.toHaveBeenCalled();
  });
  it('does not carry an unidentified draft into a newly identified project',async()=>{
    const onMemory=vi.fn();const tree=(scope:string)=><LayoutAgentProvider key={scope} sessionScope={scope} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
    state.layout=makeLayout(); delete state.layout.id; const view=render(tree('draft:unidentified'));
    send('80人');await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(80));
    state.layout=makeLayout({id:'new'});view.rerender(tree('activity:new'));
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull());
  });

  it('does not bootstrap scoped session storage from a read or a denied write guard',async()=>{
    const before=localStorage.length;getAssistantSessionBodies('activity:read-only');expect(localStorage.length).toBe(before);
    state.layout=makeLayout({id:'locked'});
    render(<LayoutAgentProvider sessionScope="activity:locked" assertSessionWrite={()=>{throw new Error('失锁');}} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    expect(localStorage.length).toBe(before);
    send('80人');await screen.findByText(/无法保存在本机/);expect(localStorage.length).toBe(before);
  });
  it('keeps unsaved text and requirements in their original scope when the write guard denies persistence',async()=>{
    const onMemory=vi.fn(),deny=()=>{throw new Error('失锁');};
    const tree=(id:string)=><LayoutAgentProvider key={id} sessionScope={`activity:${id}`} assertSessionWrite={deny} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
    state.layout=makeLayout({id:'A'});const view=render(tree('A'));send('80人');
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(80));await screen.findByText(/无法保存在本机/);
    state.layout=makeLayout({id:'B'});view.rerender(tree('B'));await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull());
    state.layout=makeLayout({id:'A'});view.rerender(tree('A'));await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(80));
    expect(document.querySelector('.ap-feed')?.textContent).toContain('80人');
  });
  it('can read the old activity history after binding to a new ID without adopting its facts',async()=>{
    const onMemory=vi.fn();const tree=(id:string)=><LayoutAgentProvider key={id} sessionScope={`activity:${id}`} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
    state.layout=makeLayout({id:'local'});const view=render(tree('local'));send('80人');await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(80));
    state.layout=makeLayout({id:'cloud'});view.rerender(tree('cloud'));await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'会话历史'}));
    expect(screen.getByText('其他活动的会话（仅查看）')).toBeTruthy();
    expect(screen.getByText('保留在本机，不会自动作为当前活动的需求。')).toBeTruthy();
    expect(screen.getByText('你：80人')).toBeTruthy();expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull();
  });
  it('keeps legacy conversation available only as read-only history',async()=>{
    state.layout=makeLayout({id:'A'});const view=render(ui(state.layout));send('80人');await screen.findByText(/记下了：80 人/);
    const onMemory=vi.fn();view.unmount();render(<LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'会话历史'}));
    expect(screen.getByText('旧会话（未关联活动）')).toBeTruthy();expect(screen.getByText('仅供查看，不会自动作为当前活动的需求。')).toBeTruthy();
    expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull();
  });
  it('rejects confirmation if the store switches before React rerenders',async()=>{
    const onMemory=vi.fn(),onApply=vi.fn();const chair=makeItem({id:'only-chair',type:'chair',name:'椅子',position:{x:0,z:0},width:.5,depth:.5});
    state.layout=makeLayout({id:'A',width:24,height:16,floors:[makeFloor({items:[chair]})]});
    render(<LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={onApply} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('圆桌');await waitFor(()=>expect(onMemory.mock.calls.some(([m])=>m.layoutModeConfirmed===true)).toBe(true));
    send('把椅子往左挪10厘米');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    act(()=>{state.layout=makeLayout({id:'B'});fireEvent.click(confirm);});
    expect(onApply).not.toHaveBeenCalled();
  },20000);

  it('expires old dimensions on venue replacement and requires a concrete restatement',async()=>{
    const onMemory=vi.fn(),onApply=vi.fn(),onPreview=vi.fn();
    const initial=makeLayout({id:'A',width:12,height:9,floors:[makeFloor({items:[]})],venueScan:{assetId:'old',name:'旧场'}});
    useRealLayoutStore=true;state.layout=initial;layoutStore.setState({layout:initial,activeFloorIndex:0});const tree=()=> <LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={onApply} onPreview={onPreview} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
    const view=render(tree());send('12人，室内12×9米，圆桌');
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0].lengthM).toBe(12));
    await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    act(()=>{state.layout={...initial,width:20,height:15,venueScan:{assetId:'new',name:'新场'}};layoutStore.setState({layout:state.layout});});view.rerender(tree());
    send('出方案');expect(await screen.findByText(/旧场地记录为 12 × 9 米/)).toBeTruthy();
    expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({lengthM:null,widthM:null,scaleNeedsReconfirmation:true});
    send('确认');await waitFor(()=>expect(screen.getAllByText(/不能自动沿用/).length).toBeGreaterThanOrEqual(2));expect(onApply).not.toHaveBeenCalled();
    send('20×15米');await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({lengthM:20,widthM:15,scaleNeedsReconfirmation:false}));
    useRealLayoutStore=false;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});
  });
  it('binds the freshly confirmed 12×9 candidate to the applied venue rather than expiring it',async()=>{
    useRealLayoutStore=true;const onMemory=vi.fn(),onPreview=vi.fn(),onApply=vi.fn((next:RoomLayout)=>{state.layout=next;layoutStore.setState({layout:next});});
    state.layout=makeLayout({id:'A',width:23.8,height:16.1,floors:[makeFloor({items:[]})]});layoutStore.setState({layout:state.layout,activeFloorIndex:0});
    render(<LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={onApply} onPreview={onPreview} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('12人，室内12×9米，圆桌');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    fireEvent.click(confirm);await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    send('出方案');await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({lengthM:12,widthM:9,scaleNeedsReconfirmation:false}));
    expect(screen.queryByText(/旧场地记录为/)).toBeNull();
    useRealLayoutStore=false;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});
  },20000);
  it('blocks an old scale confirmation synchronously when the venue changes before rerender',async()=>{
    const onMemory=vi.fn(),onApply=vi.fn();state.layout=makeLayout({id:'A',width:23.8,height:16.1,floors:[makeFloor({items:[]})]});
    render(<LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={onApply} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('12人，室内12×9米，圆桌');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    act(()=>{state.layout={...state.layout,width:20,height:15};fireEvent.click(confirm);});
    expect(onApply).not.toHaveBeenCalled();expect(await screen.findByText(/旧场地尺寸需要重新说明/)).toBeTruthy();
  },20000);

  it('discards a model result if the venue changes during the same activity',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    try {
      let finish!:(value:unknown)=>void;studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
      const onMemory=vi.fn();state.layout=makeLayout({id:'A',width:12,height:9,venueScan:{assetId:'old',name:'旧场'}});
      render(<LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
      send('12×9米');await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledOnce());
      state.layout={...state.layout,width:20,height:15,venueScan:{assetId:'new',name:'新场'}};
      await act(async()=>{finish({enabled:true,extraction:{lengthM:12,widthM:9}});await Promise.resolve();});
      expect(await screen.findByText(/场地在理解需求期间发生变化/)).toBeTruthy();
      expect(onMemory.mock.calls.at(-1)?.[0].lengthM).toBeNull();
    } finally {vi.unstubAllEnvs();}
  });

  it('discards a late response after same-batch A → B → A even if the ID matches again',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    try {
      let finish!:(value:unknown)=>void;studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
      let epoch=1;const captured=epoch;const onMemory=vi.fn();state.layout=makeLayout({id:'A'});
      render(<LayoutAgentProvider sessionScope="activity:A" isSessionCurrent={()=>epoch===captured} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
      send('80人');await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledOnce());
      const beforeCalls=onMemory.mock.calls.length,beforeStorage=JSON.stringify({...localStorage});
      act(()=>{state.layout=makeLayout({id:'B'});epoch++;state.layout=makeLayout({id:'A'});epoch++;});
      await act(async()=>{finish({enabled:true,extraction:{headcount:80}});await Promise.resolve();});
      expect(onMemory.mock.calls.length).toBe(beforeCalls);expect(JSON.stringify({...localStorage})).toBe(beforeStorage);
    } finally {vi.unstubAllEnvs();}
  });

  it('requires fresh scale after reload when the venue basis contains an embedded image',async()=>{
    const onMemory=vi.fn(),onApply=vi.fn();const image='data:image/png;base64,'+'A'.repeat(17000);
    state.layout=makeLayout({id:'A',width:12,height:9,floorPlanImage:image,floors:[makeFloor({items:[]})]});
    const tree=()=> <LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={onApply} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
    const view=render(tree());send('12人，室内12×9米，圆桌');
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({lengthM:12,widthM:9,scaleNeedsReconfirmation:false}));
    expect(JSON.stringify({...localStorage})).not.toContain(image);
    view.unmount();resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();render(tree());
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({lengthM:12,widthM:9,scaleNeedsReconfirmation:true}));
    send('确认');expect(await screen.findByText(/旧场地记录为 12 × 9 米/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
    send('12×9米');await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({lengthM:12,widthM:9,scaleNeedsReconfirmation:false}));
  });

  it('binds explicitly stated dimensions only to an observed source from the same activity',async()=>{
    const onMemory=vi.fn(),confirmVenueSource=vi.fn(async(scope:string)=>({status:'observed' as const,scope,digest:'a'.repeat(64)}));state.layout=makeLayout({id:'A'});
    render(<LayoutAgentProvider sessionScope="activity:A" confirmVenueSource={confirmVenueSource} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('12人，12×9米，圆桌');await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({lengthM:12,widthM:9,venueSourceScope:'A',venueSourceDigest:'a'.repeat(64)}));
    expect(confirmVenueSource).toHaveBeenCalledWith('A');
  });
  it.each(['unknown','wrong-scope','invalid-digest','failure'] as const)('does not change requirements when venue source is %s',async mode=>{
    const onMemory=vi.fn(),onPreview=vi.fn();state.layout=makeLayout({id:'A'});
    const confirmVenueSource=vi.fn(async()=>{if(mode==='failure')throw new Error('读取失败');return mode==='unknown'?{status:'unknown' as const}:{status:'observed' as const,scope:mode==='invalid-digest'?'A':'B',digest:mode==='invalid-digest'?'short':'a'.repeat(64)};});
    render(<LayoutAgentProvider sessionScope="activity:A" confirmVenueSource={confirmVenueSource} callbacks={callbacks} onApply={vi.fn()} onPreview={onPreview} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    await waitFor(()=>expect(onMemory).toHaveBeenCalled());const before=structuredClone(onMemory.mock.calls.at(-1)?.[0]);
    send('12人，12×9米，圆桌');expect(await screen.findByText(/场地来源暂时无法核对/)).toBeTruthy();
    expect(onMemory.mock.calls.at(-1)?.[0]).toEqual(before);expect(onPreview.mock.calls.every(([v])=>v===null)).toBe(true);
  });
  it('does not bind a source result after the venue changes while reading',async()=>{
    let finish!:(v:{status:'observed';scope:string;digest:string})=>void;
    const onMemory=vi.fn(),confirmVenueSource=vi.fn(()=>new Promise<{status:'observed';scope:string;digest:string}>(resolve=>{finish=resolve;}));
    state.layout=makeLayout({id:'A',width:12,height:9});render(<LayoutAgentProvider sessionScope="activity:A" confirmVenueSource={confirmVenueSource} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    await waitFor(()=>expect(onMemory).toHaveBeenCalled());const before=onMemory.mock.calls.length;send('12人，12×9米，圆桌');await waitFor(()=>expect(confirmVenueSource).toHaveBeenCalledOnce());
    state.layout={...state.layout,width:20};await act(async()=>{finish({status:'observed',scope:'A',digest:'old'});await Promise.resolve();});
    expect(onMemory.mock.calls.length).toBe(before);
  });
  it('discards source observation if the zone draft changes while waiting',async()=>{
    let finish!:(v:{status:'observed';scope:string;digest:string})=>void;
    const onMemory=vi.fn(),confirmVenueSource=vi.fn(()=>new Promise<{status:'observed';scope:string;digest:string}>(resolve=>{finish=resolve;}));state.layout=makeLayout({id:'A'});
    const tree=(version:number)=><LayoutAgentProvider sessionScope="activity:A" zoneDraftRevision={version} confirmVenueSource={confirmVenueSource} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
    const view=render(tree(1));await waitFor(()=>expect(onMemory).toHaveBeenCalled());const before=onMemory.mock.calls.length;
    send('12人，12×9米，圆桌');await waitFor(()=>expect(confirmVenueSource).toHaveBeenCalledOnce());view.rerender(tree(2));
    await act(async()=>{finish({status:'observed',scope:'A',digest:'stale'});await Promise.resolve();});expect(onMemory.mock.calls.length).toBe(before);
  });
  it('does not fall back to unbound source confirmation after an injected authority disappears',async()=>{
    const onApply=vi.fn(),onMemory=vi.fn(),onPreview=vi.fn(),confirmVenueSource=vi.fn(async(scope:string)=>({status:'observed' as const,scope,digest:'a'.repeat(64)}));
    state.layout=makeLayout({id:'A',width:12,height:9,floors:[makeFloor({items:[]})]});
    const tree=(authority?:typeof confirmVenueSource)=><LayoutAgentProvider sessionScope="activity:A" {...(authority?{confirmVenueSource:authority}:{})} callbacks={callbacks} onApply={onApply} onPreview={onPreview} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>;
    const view=render(tree(confirmVenueSource));send('12人，12×9米，圆桌');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    view.rerender(tree());fireEvent.click(confirm);expect(onApply).not.toHaveBeenCalled();expect(await screen.findByText(/旧场地尺寸需要重新说明/)).toBeTruthy();
  },20000);
  it('serializes later messages while venue source confirmation is pending',async()=>{
    let finish!:(v:{status:'observed';scope:string;digest:string})=>void;
    const onMemory=vi.fn(),confirmVenueSource=vi.fn(()=>new Promise<{status:'observed';scope:string;digest:string}>(resolve=>{finish=resolve;}));state.layout=makeLayout({id:'A'});
    render(<LayoutAgentProvider sessionScope="activity:A" confirmVenueSource={confirmVenueSource} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('12人，12×9米，圆桌');await waitFor(()=>expect(confirmVenueSource).toHaveBeenCalledOnce());send('30人');
    await act(async()=>{finish({status:'observed',scope:'A',digest:'a'.repeat(64)});await Promise.resolve();});
    await waitFor(()=>expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({headcount:30,lengthM:12,widthM:9,venueSourceDigest:'a'.repeat(64)}),{timeout:15000});
  });
  it('keeps unsent drafts separate between conversations in the same activity',async()=>{
    state.layout=makeLayout({id:'A'});
    render(<LayoutAgentProvider sessionScope="activity:A" callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    const input=await screen.findByLabelText('告诉 Agent 要改的');fireEvent.change(input,{target:{value:'第一场未发送'}});
    fireEvent.click(screen.getByRole('button',{name:'新开会话'}));
    await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe(''));
    fireEvent.change(screen.getByLabelText('告诉 Agent 要改的'),{target:{value:'第二场未发送'}});
    fireEvent.click(screen.getByRole('button',{name:'会话历史'}));
    const rows=within(screen.getByRole('list',{name:'方案会话列表'})).getAllByRole('button',{name:/^新会话/});
    fireEvent.click(rows.find(button=>button.getAttribute('aria-current')!=='true')!);
    await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('第一场未发送'));
  });
  it('keeps an unsent draft if its captured activity epoch expires before submit',async()=>{
    let current=true;state.layout=makeLayout({id:'A'});const onMemory=vi.fn();
    render(<LayoutAgentProvider sessionScope="activity:A" isSessionCurrent={()=>current} callbacks={callbacks} onApply={vi.fn()} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    const input=await screen.findByLabelText('告诉 Agent 要改的');fireEvent.change(input,{target:{value:'仍需保留的请求'}});
    current=false;fireEvent.click(screen.getByRole('button',{name:'发送'}));
    expect((input as HTMLTextAreaElement).value).toBe('仍需保留的请求');
    expect(document.querySelector('.ap-feed')?.textContent).not.toContain('仍需保留的请求');
  });
  it('prevents duplicate submissions and serializes a different message', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    let finish!:(value:unknown)=>void;
    studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({enabled:true,extraction:{venueIO:'indoor'}});
    render(ui(state.layout));send('80 人');
    await screen.findByText('正在理解活动需求…');
    const input=screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'80 人'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
    expect(input.value).toBe('80 人');expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(1);
    send('室内');expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(1);
    finish({enabled:true,extraction:{headcount:80}});
    expect(await screen.findByText(/记下了：80 人 · 室内/)).toBeTruthy();expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(2);
  });
  it('stops waiting, preserves the input, and requires explicit confirmation before the same request is sent again',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');let finish!:(value:unknown)=>void;let signal:AbortSignal|undefined;
    studioMock.controller.briefExtract.mockImplementationOnce((_text:string,s:AbortSignal)=>{signal=s;return new Promise(resolve=>{finish=resolve;});}).mockResolvedValueOnce({enabled:true,extraction:{headcount:80}});
    render(ui(state.layout));send('80 人');await screen.findByText('正在理解活动需求…');
    fireEvent.click(screen.getByRole('button',{name:'停止等待'}));expect(signal?.aborted).toBe(true);
    expect(await screen.findByText(/服务商可能仍在处理或计费/)).toBeTruthy();
    await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('80 人'));
    finish({enabled:true,extraction:{headcount:100}});
    await waitFor(()=>expect(screen.queryByText('正在理解活动需求…')).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'发送'}));expect(await screen.findByRole('button',{name:'确认再次发送'})).toBeTruthy();
    expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'确认再次发送'}));await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(2));
    expect(document.querySelector('.ap-feed')?.textContent).not.toContain('记下了：100 人');
  });

  it('continues a separately submitted queued message after stopping the first request',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    studioMock.controller.briefExtract.mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValueOnce({enabled:true,extraction:{venueIO:'indoor'}});
    render(ui(state.layout));send('80 人');await screen.findByText('正在理解活动需求…');send('室内');
    expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'停止等待'}));
    await waitFor(()=>expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText(/室内/)).length).toBeGreaterThan(0);
  });

  it('does not overwrite previously accepted facts when a later request is cancelled',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    studioMock.controller.briefExtract.mockResolvedValueOnce({enabled:true,extraction:{headcount:80}}).mockImplementationOnce(()=>new Promise(()=>{}));
    render(ui(state.layout));send('80 人');await screen.findByText(/记下了：80 人/);
    send('需要签到');await screen.findByText('正在理解活动需求…');fireEvent.click(screen.getByRole('button',{name:'停止等待'}));
    expect(await screen.findByText(/服务商可能仍在处理或计费/)).toBeTruthy();
    expect(document.querySelector('.ap-feed')?.textContent).toContain('记下了：80 人');
    expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('需要签到');
  });

  it.each(['switch','ABA'])('refuses a local candidate after a same-batch floor %s while preserving its preview',async mode=>{
    useRealLayoutStore=true;const onApply=vi.fn(),onPreview=vi.fn();
    const base=makeLayout({width:12,height:9,floors:[makeFloor({id:'floor-a',items:[]}),makeFloor({id:'floor-b',items:[]})]});
    state.layout=base;layoutStore.setState({layout:base,activeFloorIndex:0});
    render(<LayoutAgentProvider callbacks={callbacks} onApply={onApply} onPreview={onPreview}><AgentPanel/></LayoutAgentProvider>);
    send('加一把椅子');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    const previous=onPreview.mock.calls.at(-1)?.[0];
    act(()=>{layoutStore.setState({activeFloorIndex:1});if(mode==='ABA')layoutStore.setState({activeFloorIndex:0});fireEvent.click(confirm);});
    expect(onApply).not.toHaveBeenCalled();expect(await screen.findByText(/当前楼层已经切换/)).toBeTruthy();
    expect(onPreview.mock.calls.at(-1)?.[0]).toBe(previous);expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
    useRealLayoutStore=false;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});
  },20000);

  it('refuses a review-fix candidate after switching floors without clearing it',async()=>{
    useRealLayoutStore=true;const onApply=vi.fn(),onPreview=vi.fn();
    const existing=seatLayout(),base={...existing,floors:[{...existing.floors[0]!,id:'floor-a'},makeFloor({id:'floor-b'})]};
    state.layout=base;layoutStore.setState({layout:base,activeFloorIndex:0});
    render(<LayoutAgentProvider callbacks={callbacks} onApply={onApply} onPreview={onPreview}><AgentPanel/></LayoutAgentProvider>);
    await reviewAndFix();const confirm=await screen.findByRole('button',{name:'确认布置'}),previous=onPreview.mock.calls.at(-1)?.[0];
    act(()=>{layoutStore.setState({activeFloorIndex:1});fireEvent.click(confirm);});
    expect(onApply).not.toHaveBeenCalled();expect(await screen.findByText(/当前楼层已经切换/)).toBeTruthy();expect(onPreview.mock.calls.at(-1)?.[0]).toBe(previous);
    useRealLayoutStore=false;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});
  });

  it('refuses a locally revised object after changing the current floor',async()=>{
    useRealLayoutStore=true;const onApply=vi.fn(),onPreview=vi.fn(),onMemory=vi.fn();
    const chair=makeItem({id:'only-chair',type:'chair',name:'椅子',color:'#112233',position:{x:0,z:0},width:.5,depth:.5});
    const base=makeLayout({width:24,height:16,floors:[makeFloor({id:'floor-a',items:[chair]}),makeFloor({id:'floor-b'})]});
    state.layout=base;layoutStore.setState({layout:base,activeFloorIndex:0});
    render(<LayoutAgentProvider callbacks={callbacks} onApply={onApply} onPreview={onPreview} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('圆桌');await waitFor(()=>expect(onMemory.mock.calls.some(([m])=>m.layoutModeConfirmed===true)).toBe(true));
    send('把椅子换成蓝色');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000}),previous=onPreview.mock.calls.at(-1)?.[0];
    act(()=>{layoutStore.setState({activeFloorIndex:1});fireEvent.click(confirm);});
    expect(onApply).not.toHaveBeenCalled();expect(await screen.findByText(/当前楼层已经切换/)).toBeTruthy();expect(onPreview.mock.calls.at(-1)?.[0]).toBe(previous);
    useRealLayoutStore=false;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});
  },20000);
  it('refuses a style candidate after a same-batch floor ABA',async()=>{
    useRealLayoutStore=true;const onApply=vi.fn(),onPreview=vi.fn();
    const base=makeLayout({width:12,height:9,floors:[makeFloor({id:'floor-a'}),makeFloor({id:'floor-b'})]});state.layout=base;layoutStore.setState({layout:base,activeFloorIndex:0});
    render(<LayoutAgentProvider callbacks={callbacks} onApply={onApply} onPreview={onPreview}><AgentPanel/></LayoutAgentProvider>);
    fireEvent.click(within(screen.getByRole('group',{name:'你可以做什么'})).getByRole('button',{name:/按风格配一套/}));
    fireEvent.click(screen.getByRole('button',{name:'按奶油会客配一套'}));const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000}),previous=onPreview.mock.calls.at(-1)?.[0];
    act(()=>{layoutStore.setState({activeFloorIndex:1});layoutStore.setState({activeFloorIndex:0});fireEvent.click(confirm);});
    expect(onApply).not.toHaveBeenCalled();expect(await screen.findByText(/当前楼层已经切换/)).toBeTruthy();expect(onPreview.mock.calls.at(-1)?.[0]).toBe(previous);
    useRealLayoutStore=false;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});
  },20000);

  it('retains a stated wheelchair route despite a contradictory model boolean and warns on the candidate',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    studioMock.controller.briefExtract.mockResolvedValue({enabled:true,extraction:{headcount:8,venueIO:'indoor',lengthM:12,widthM:9,layoutMode:'dining',mobilityAssistance:false}});
    const onMemory=vi.fn(),onApply=vi.fn();state.layout=makeLayout({width:12,height:9,floors:[makeFloor({items:[]})]});
    render(<LayoutAgentProvider callbacks={callbacks} onApply={onApply} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('8人，室内12×9米，圆桌，需要轮椅通道');
    expect(await screen.findByText(/已记录轮椅或行动辅助通行需求/,{exact:false},{timeout:15000})).toBeTruthy();
    expect(onMemory.mock.calls.at(-1)?.[0].mobilityRequirement).toMatchObject({decision:'needed',evidence:expect.stringContaining('需要轮椅通道')});
    expect(document.querySelector('.ap-feed')?.textContent).toContain('不代表合规通过');expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('keeps a conflicting wheelchair route request pending rather than generating',async()=>{
    const onMemory=vi.fn(),onApply=vi.fn();state.layout=makeLayout({width:12,height:9,floors:[makeFloor({items:[]})]});
    render(<LayoutAgentProvider callbacks={callbacks} onApply={onApply} onPreview={vi.fn()} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('8人，室内12×9米，圆桌，需要轮椅通道但不需要轮椅通道');
    expect(await screen.findByText(/轮椅通行需求尚未确定/)).toBeTruthy();
    expect(onMemory.mock.calls.at(-1)?.[0]).toMatchObject({mobilityNeedsClarification:true,mobilityRequirement:{decision:'unknown'}});
    send('出方案');expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps the plan picker out of the Bingo review face', () => {
    state.layout = INITIAL_LAYOUT;
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    expect(screen.queryByLabelText('生成活动方案')).toBeNull();
  });

  it('previews a checked style bundle and applies only after explicit confirmation', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    state.layout = makeLayout({ floors: [makeFloor({ items: [] })] });
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    const group = screen.getByRole('group', { name: '你可以做什么' });
    expect(within(group).getByRole('button', { name: /按风格配一套/ })).toBeTruthy();
    expect(within(group).getByRole('button', { name: /地图选址/ })).toBeTruthy();
    expect(within(group).queryByRole('button', { name: /生成物件/ })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: /按风格配一套/ }));
    expect(screen.getByRole('dialog', { name: '按风格配一套' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '按奶油会客配一套' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '按奶油会客配一套' }));
    expect(state.addItems).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    const preview = onPreview.mock.calls.map(([value]) => value as RoomLayout | null).find(value => value && value.floors[0]!.items.length > 0)!;
    expect(preview!.floors[0]!.items.every(item => item.provenance?.source === 'procedural')).toBe(true);
    expect(screen.getByText('新增物料由系统规则生成。')).toBeTruthy();
    fireEvent.click(confirm);
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]![0].floors[0].items.length).toBeGreaterThan(0);
    expect(onApply.mock.calls[0]![0]).toEqual(preview);
    expect(onApply.mock.calls[0]![1]).toMatchObject({ preserveProvenance: true });
  }, 20000);

  it('finishes the applied style even when accessing style-history storage fails', async () => {
    const onApply = vi.fn();
    state.layout = makeLayout({ floors: [makeFloor({ items: [] })] });
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    fireEvent.click(within(screen.getByRole('group', { name: '你可以做什么' })).getByRole('button', { name: /按风格配一套/ }));
    fireEvent.click(screen.getByRole('button', { name: '按奶油会客配一套' }));
    const confirm = await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    const storageGetter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('storage disabled'); });
    try {
      fireEvent.click(confirm);
      expect(onApply).toHaveBeenCalledOnce();
      expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
      expect(screen.getByText('布置已应用，但风格历史未能保存。')).toBeTruthy();
    } finally { storageGetter.mockRestore(); }
  }, 20000);

  it('preserves locked items in a style preview and rejects it when the canvas changes', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    const locked = makeItem({ id: 'locked-chair', type: 'chair', name: '锁定椅', position: { x: 7, z: 5 }, locked: true });
    const base = makeLayout({ width: 20, height: 16, floors: [makeFloor({ items: [locked] })] });
    const view = render(ui(base, onApply, onPreview));
    fireEvent.click(within(screen.getByRole('group', { name: '你可以做什么' })).getByRole('button', { name: /按风格配一套/ }));
    fireEvent.click(screen.getByRole('button', { name: '按奶油会客配一套' }));
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    const candidate = onPreview.mock.calls.map(([value]) => value as RoomLayout | null).find(value => value && value.floors[0]!.items.length > 1)!;
    expect(candidate!.floors[0]!.items.find(item => item.id === locked.id)).toEqual(locked);
    expect(onApply).not.toHaveBeenCalled();
    view.rerender(ui({ ...base, name: '场景已改' }, onApply, onPreview));
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull());
    expect(onApply).not.toHaveBeenCalled();
  }, 20000);

  it('applies one style candidate as one undoable step while retaining a locked object', async () => {
    const locked = makeItem({ id: 'locked-chair', type: 'chair', name: '锁定椅', position: { x: 7, z: 5 }, locked: true });
    const base = makeLayout({ width: 20, height: 16, floors: [makeFloor({ items: [locked] })] });
    useRealLayoutStore = true;
    layoutStore.setState({ layout: base, activeFloorIndex: 0 });
    function HistoryHarness() {
      const { layout, actions } = useLayoutState();
      const history = useHistory(layout, actions.applyLayout, { debounceMs: 10 });
      state.layout = layout;
      return <LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={next => { history.commitNow(); actions.applyLayout(next); }}>
        <AgentPanel/><button type="button" onClick={history.undo}>撤销测试操作</button>
      </LayoutAgentProvider>;
    }
    try {
      render(<HistoryHarness/>);
      fireEvent.click(within(screen.getByRole('group', { name: '你可以做什么' })).getByRole('button', { name: /按风格配一套/ }));
      fireEvent.click(screen.getByRole('button', { name: '按奶油会客配一套' }));
      fireEvent.click(await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 }));
      await waitFor(() => expect(layoutStore.getState().layout.floors[0]!.items.length).toBeGreaterThan(1));
      expect(layoutStore.getState().layout.floors[0]!.items.find(item => item.id === locked.id)).toEqual(locked);
      fireEvent.click(screen.getByRole('button', { name: '撤销测试操作' }));
      await waitFor(() => expect(layoutStore.getState().layout.floors[0]!.items).toEqual([locked]));
    } finally { layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 }); useRealLayoutStore = false; }
  }, 20000);
  it('rejects a style candidate if its planning draft changes before confirmation', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    state.layout = makeLayout({ floors: [makeFloor({ items: [] })] });
    const node = (zoneDraftRevision: number) => <LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={onApply} zoneDraftRevision={zoneDraftRevision}><AgentPanel/></LayoutAgentProvider>;
    const view = render(node(0));
    fireEvent.click(within(screen.getByRole('group', { name: '你可以做什么' })).getByRole('button', { name: /按风格配一套/ }));
    fireEvent.click(screen.getByRole('button', { name: '按奶油会客配一套' }));
    const confirm = await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    view.rerender(node(1));
    fireEvent.click(confirm);
    expect(onApply).not.toHaveBeenCalled();
    expect(await screen.findByText(/区域草案或楼层已经变化/)).toBeTruthy();
  }, 20000);

  it('keeps map选址 on the 活动 face together with the style chip', () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="door"/><MapVenueOverlay/></LayoutAgentProvider>);
    const group = screen.getByRole('group', { name: '你可以做什么' });
    expect(within(group).getByRole('button', { name: /地图选址/ })).toBeTruthy();
    expect(within(group).getByRole('button', { name: /按风格配一套/ })).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: /地图选址/ }));
    expect(screen.getByRole('dialog', { name: '地图选址' })).toBeTruthy();
  });

  it('keeps the left rail on 布置 and sends review or delivery elsewhere', async () => {
    const { WORKBENCH_MODES, demoteLegacyMode } = await import('../lib/workbench-mode');
    expect(WORKBENCH_MODES.map(mode => mode.id)).toEqual(['layout']);
    expect(WORKBENCH_MODES.map(mode => mode.label)).toEqual(['布置']);
    expect(demoteLegacyMode('review')).toBe('open-share');
    expect(demoteLegacyMode('delivery')).toBe('open-checklist');
  });

  it('renders the activity brief as read-only facts from the conversation', () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ActivityBrief tools={[]}/></LayoutAgentProvider>);
    const brief = screen.getByLabelText('活动简报');
    // 无眉题头：左栏 Tab 已标明位置，卡片直接以活动名开场。
    expect(within(brief).queryByText('来自对话')).toBeNull();
    expect(within(brief).getAllByText('还没说').length).toBeGreaterThan(0);
    expect(within(brief).queryByRole('textbox')).toBeNull();
    // 简报里能点的只有「这块场地从哪来」这一组。
    const actions = within(brief).getAllByRole('button');
    expect(actions.map(button => visibleText(button.textContent))).toEqual(['地图圈画', '空白空间 · 12 × 8 m']);
  });

  it('offers the map next to the drawings and opens it over the canvas', () => {
    const tools: BriefTool[] = [
      { id: 'reference', label: '图纸与照片', hint: '图纸、照片与实测尺寸', icon: <span aria-hidden="true"/>, group: 'venue', onOpen: vi.fn() },
      { id: 'brief', label: '活动需求表', hint: '完整需求与场地资料表单', icon: <span aria-hidden="true"/>, group: 'docs', onOpen: vi.fn() },
    ];
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><ActivityBrief tools={tools}/><MapVenueOverlay/></LayoutAgentProvider>);
    const ways = screen.getByRole('group', { name: '这块场地从哪来' });
    // 量出同一块场地的两条路并列，不再一个在左栏一个在左轨。
    expect(within(ways).getAllByRole('button').map(button => visibleText(button.textContent))).toEqual(['图纸与照片', '地图圈画', '空白空间 · 12 × 8 m']);
    expect(screen.queryByRole('dialog', { name: '地图选址' })).toBeNull();
    fireEvent.click(within(ways).getByRole('button', { name: /地图圈画/ }));
    const overlay = screen.getByRole('dialog', { name: '地图选址' });
    expect(within(overlay).getByText(/搜地点/)).toBeTruthy();
    expect(within(overlay).getByLabelText('高德选址圈画')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '地图选址' })).toBeNull();
  });

  it('still offers the map once a venue is standing, as a replacement', () => {
    state.layout = { ...seatLayout(), backendVenue: { shape: 'rectangle', entrances: [], width: 12, depth: 8, height: 4 } };
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><ActivityBrief tools={[]}/><MapVenueOverlay/></LayoutAgentProvider>);
    const ways = screen.getByRole('group', { name: '这块场地从哪来' });
    // 场地立起来后空地文字链退场，地图圈画留着。
    expect(within(ways).getAllByRole('button').map(button => visibleText(button.textContent))).toEqual(['地图圈画']);
    fireEvent.click(within(ways).getByRole('button', { name: /地图圈画/ }));
    // 入口不消失，浮层里说清楚这一圈是替换。
    expect(within(screen.getByRole('dialog', { name: '地图选址' })).getByText('重新圈一块会替换现在的场地。')).toBeTruthy();
  });

  // F-02：左栏表单是次要轨，但改过的值必须看得见——简报和对话回显读的是同一个 recap。
  it('echoes a left-rail form change into the brief', () => {
    studioMock.brief = { event: '工作坊', guests: 40, eventConfirmed: true, guestsConfirmed: true };
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ActivityBrief tools={[]}/></LayoutAgentProvider>);
    const brief = screen.getByLabelText('活动简报');
    expect(within(brief).getByText('工作坊')).toBeTruthy();
    expect(within(brief).getByText('40 人')).toBeTruthy();
    expect(within(brief).queryByText('还没说')).toBeNull();
  });

  it('keeps untouched form defaults out of the brief', () => {
    studioMock.brief = { event: INITIAL_BRIEF.event, guests: INITIAL_BRIEF.guests, eventConfirmed: false, guestsConfirmed: false };
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ActivityBrief tools={[]}/></LayoutAgentProvider>);
    const brief = screen.getByLabelText('活动简报');
    expect(within(brief).getAllByText('还没说').length).toBeGreaterThan(0);
    expect(within(brief).queryByText('品牌快闪')).toBeNull();
    expect(within(brief).queryByText('24 人')).toBeNull();
  });

  it('does not invent an event name when a real conversation gives people and seating only', async () => {
    studioMock.brief = { event: INITIAL_BRIEF.event, guests: INITIAL_BRIEF.guests, eventConfirmed: false, guestsConfirmed: false };
    studioMock.setBrief.mockImplementationOnce((update) => { studioMock.brief = update(studioMock.brief); studioMock.hasSavedBrief = true; });
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ActivityBrief tools={[]}/></LayoutAgentProvider>);
    send('12人，室内12×9米，需要休息区，不需要签到，圆桌，出方案');
    await waitFor(() => expect(studioMock.brief.guests).toBe(12));
    expect(studioMock.brief.guestsConfirmed).toBe(true);
    expect(studioMock.brief.eventConfirmed).toBe(false);
    expect(within(screen.getByLabelText('活动简报')).queryByText('品牌快闪')).toBeNull();
  });

  it('routes export intent to a preview card and only the confirm button triggers the handoff', async () => {
    render(ui(state.layout));
    send('导出给搭建方');
    const card = (await screen.findByText('导出执行资料草案')).closest('.ap-card') as HTMLElement;
    expect(within(card).getByText(/不完整包含对话需求/)).toBeTruthy();
    expect(screen.getByText(/不完整包含本次对话需求.*对照当前对话及现场条件/)).toBeTruthy();
    expect(studioMock.exportActivity).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: '确认导出' }));
    await waitFor(() => expect(studioMock.exportActivity).toHaveBeenCalledOnce());
    expect(await screen.findByText(/执行资料草案已发起下载.*核对手工需求与当前对话.*消防和无障碍等条件仍需核验/)).toBeTruthy();
    expect(screen.queryByText('导出执行资料草案')).toBeNull();
  });

  it('offers a clearly limited cloud material draft without claiming a complete handoff',async()=>{
    studioMock.cloudMaterialDraftAvailable=true;
    render(ui(state.layout));send('导出给搭建方');
    const card=(await screen.findByText('导出执行资料草案')).closest('.ap-card') as HTMLElement;
    expect(within(card).getByText(/云项目暂不支持此执行资料草案/)).toBeTruthy();
    expect(within(card).getByText(/本机快照，未冻结/)).toBeTruthy();
    expect(within(card).queryByRole('button',{name:'确认导出'})).toBeNull();
    fireEvent.click(within(card).getByRole('button',{name:'导出当前场景物料清单草案'}));
    await waitFor(()=>expect(studioMock.exportCloudMaterialDraft).toHaveBeenCalledOnce());
    expect(studioMock.exportActivity).not.toHaveBeenCalled();
    expect(await screen.findByText(/当前场景物料清单草案已发起下载/)).toBeTruthy();
  });

  it('does not offer export of the old scene while a fix is awaiting confirmation', async () => {
    render(ui(state.layout));
    await reviewAndFix();
    expect(await screen.findByText('改法预览')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');

    send('导出给搭建方');
    expect(await screen.findByText(/当前有尚未应用的方案预览；导出读取的是原场景/)).toBeTruthy();
    expect(screen.queryByText('导出执行资料草案')).toBeNull();
    const primaries = [...document.querySelectorAll('.sc-agent-panel .btn-primary')].map(button => button.textContent?.trim());
    expect(primaries).toEqual(['确认布置']);
    expect(studioMock.exportActivity).not.toHaveBeenCalled();
    expect(studioMock.exportCloudMaterialDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '撤回' }));
    send('导出给搭建方');
    expect(await screen.findByRole('button', { name: '确认导出' })).toBeTruthy();
  });
  it('registers a local fix until it is explicitly withdrawn',async()=>{
    const registry=createPendingCandidateRegistry(),scope={},access=bindPendingCandidateRegistry(registry,scope,()=>true);
    render(<LayoutAgentProvider pendingCandidates={access} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    const before=access.capture()!;expect(before.hasPending).toBe(false);
    await reviewAndFix();await screen.findByText('改法预览');
    expect(before.isCurrent()).toBe(false);
    expect(access.capture()).toMatchObject({local:true,hasPending:true});
    fireEvent.click(screen.getByRole('button',{name:'撤回'}));
    expect(access.capture()).toMatchObject({local:false,hasPending:false});
  });
  it('invalidates an export capture on chat switch without silently clearing a retained candidate',async()=>{
    const registry=createPendingCandidateRegistry(),scope={},access=bindPendingCandidateRegistry(registry,scope,()=>true);
    render(<LayoutAgentProvider pendingCandidates={access} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    await reviewAndFix();await screen.findByText('改法预览');const before=access.capture()!;
    fireEvent.click(screen.getByRole('button',{name:'新开会话'}));
    expect(before.isCurrent()).toBe(false);
    expect(access.capture()).toMatchObject({local:true,hasPending:true});
  });

  it('withdraws the export action if a cloud candidate arrives after the export card', async()=>{
    studioMock.connection='项目已连接';studioMock.cloudMaterialDraftAvailable=true;
    const {rerender}=render(ui(state.layout));send('导出给搭建方');
    expect(await screen.findByRole('button',{name:'导出当前场景物料清单草案'})).toBeTruthy();
    studioMock.preview=cloudPreview();rerender(ui(state.layout));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'导出当前场景物料清单草案'})).toBeNull());
    expect(screen.getByText(/当前有尚未应用的方案预览；请先确认布置或撤回预览/)).toBeTruthy();
    expect(studioMock.exportCloudMaterialDraft).not.toHaveBeenCalled();
  });

  it('checks pending candidates again when either export action is invoked directly', async()=>{
    function ExportActions(){const agent=useAgent();return <><button onClick={agent.confirmExport}>直接导出</button><button onClick={agent.confirmCloudMaterialDraft}>直接导出物料</button></>;}
    studioMock.connection='项目已连接';studioMock.cloudMaterialDraftAvailable=true;studioMock.preview=cloudPreview();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ExportActions/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button',{name:'直接导出'}));
    fireEvent.click(screen.getByRole('button',{name:'直接导出物料'}));
    await waitFor(()=>expect(screen.getAllByText(/当前有尚未应用的方案预览；导出读取的是原场景/).length).toBe(2));
    expect(studioMock.exportActivity).not.toHaveBeenCalled();expect(studioMock.exportCloudMaterialDraft).not.toHaveBeenCalled();
  });

  it('treats 出交接 as export but keeps 出物料清单 as an in-chat list', async () => {
    render(ui(state.layout));
    send('出交接');
    expect(await screen.findByText('导出执行资料草案')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '先不了' }));
    expect(screen.queryByText('导出执行资料草案')).toBeNull();
    send('出物料清单');
    // 清单仍在对话里回（同步），不应当落到导出预览卡。
    expect(screen.queryByText('导出执行资料草案')).toBeNull();
    expect(studioMock.exportActivity).not.toHaveBeenCalled();
  });

  it('retracts the confirmed card when the canvas changes underneath it (undo or manual edit)', async () => {
    const onApply = vi.fn();
    const layout = seatLayout();
    const { rerender } = render(ui(layout, onApply));
    await reviewAndFix();
    fireEvent.click(await screen.findByRole('button', { name: '确认布置' }));
    expect(await screen.findByText('这一版布置')).toBeTruthy();
    const moved = { ...layout, floors: [{ ...layout.floors[0]!, items: layout.floors[0]!.items.map(item => item.id === 'seat' ? { ...item, position: { x: 1, z: 1 } } : item) }] } as RoomLayout;
    rerender(ui(moved, onApply));
    await waitFor(() => expect(screen.queryByText('这一版布置')).toBeNull());
    expect(await screen.findByText(/画布改过了（撤销或手动调整）/)).toBeTruthy();
  });
  it.each(['layout name', 'handoff record'])('invalidates an old review candidate when a later %s would be overwritten', async changed => {
    const onApply = vi.fn();
    const base = seatLayout();
    const view = render(ui(base, onApply));
    await reviewAndFix();
    expect(await screen.findByRole('button', { name: '确认布置' })).toBeTruthy();
    const next: RoomLayout = changed === 'layout name' ? { ...base, name: '改过的活动名' } : {
      ...base, floors: base.floors.map(floor => ({ ...floor, items: floor.items.map(item => item.id === 'seat'
        ? { ...item, handoff: { ownerName: '现场负责人', dueDate: '', acceptance: '', status: 'todo' as const, evidenceUrls: [], evidenceNote: '' } } : item) })),
    };
    view.rerender(ui(next, onApply));
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull());
    expect(onApply).not.toHaveBeenCalled();
  });
  it.each(['notes', 'lock'])('reads the synchronous store when %s changes before React renders', async changed => {
    useRealLayoutStore = true;
    const onApply = vi.fn(), base = seatLayout();
    layoutStore.setState({ layout: base, activeFloorIndex: 0 });
    try {
      render(ui(base, onApply));
      await reviewAndFix();
      const confirm = await screen.findByRole('button', { name: '确认布置' });
      const next: RoomLayout = { ...base, floors: base.floors.map(floor => ({ ...floor,
        items: floor.items.map(item => item.id === 'seat' ? { ...item, ...(changed === 'lock' ? { locked: true } : { notes: '现场备注' }) } : item),
      })) };
      act(() => { layoutStore.setState({ layout: next }); fireEvent.click(confirm); });
      expect(onApply).not.toHaveBeenCalled();
      expect(layoutStore.getState().layout.floors[0]!.items.find(item => item.id === 'seat')).toMatchObject(changed === 'lock' ? { locked: true } : { notes: '现场备注' });
    } finally { layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 }); useRealLayoutStore = false; }
  });
});

describe('T-05 生成完再亮确认 + 座位不够给改方案', () => {
  it('does not apply a visible candidate while a later requirement is being understood',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    studioMock.controller.briefConversation.mockImplementationOnce(()=>new Promise(()=>{}));
    const onApply=vi.fn();render(<LocalHarness initial={makeLayout({id:'activity-a'})} onApply={onApply}/>);
    send('加一把椅子');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    send('30人');await screen.findByText('正在理解活动需求…');
    fireEvent.click(confirm);
    expect(onApply).not.toHaveBeenCalled();expect(screen.getByText(/还有消息或方案正在处理/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'停止等待'}));
  },20000);
  it('按发送顺序处理生成预览期间的后续物料请求',async()=>{
    const onApply=vi.fn(),onPreview=vi.fn();render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/>);
    send('加一把椅子');send('再加一把椅子');
    expect(await screen.findByText(/条消息排队/)).toBeTruthy();expect(screen.getAllByText('加一把椅子')).toHaveLength(1);expect(screen.getAllByText('再加一把椅子')).toHaveLength(1);
    await waitFor(()=>expect(screen.queryByText(/条消息排队/)).toBeNull(),{timeout:15000});
    await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    const candidate=onPreview.mock.calls.map(call=>call[0]).filter(Boolean).at(-1) as RoomLayout;
    expect(candidate.floors[0]!.items.filter(item=>item.type==='chair').length).toBe(2);expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('停止当前预览后仍继续处理已排队的下一句',async()=>{
    const onApply=vi.fn(),onPreview=vi.fn();render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/>);
    send('加一把椅子');send('再加一把椅子');await screen.findByText(/条消息排队/);send('停一下');
    await waitFor(()=>expect(screen.queryByText(/条消息排队/)).toBeNull(),{timeout:15000});
    await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    const candidate=onPreview.mock.calls.map(call=>call[0]).filter(Boolean).at(-1) as RoomLayout;
    expect(candidate.floors[0]!.items.filter(item=>item.type==='chair').length).toBe(2);expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('同一批次切换会话再切回时，旧生成和排队消息不会继续执行',async()=>{
    function SwitchAwayAndBack(){const sessions=useAssistantSessions(()=>{});return <button type="button" onClick={()=>{const original=sessions.activeId;if(original){sessions.openSession();sessions.selectSession(original);}}}>切换后返回</button>;}
    const onApply=vi.fn(),onPreview=vi.fn();render(<><LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/><SwitchAwayAndBack/></>);
    send('加一把椅子');send('再加一把椅子');await screen.findByText(/条消息排队/);fireEvent.click(screen.getByRole('button',{name:'切换后返回'}));
    await waitFor(()=>expect(screen.queryByText(/条消息排队/)).toBeNull(),{timeout:15000});expect(onPreview.mock.calls.at(-1)?.[0]).toBeNull();expect(onApply).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  },20000);
  it('同一批次切换账号再切回时，旧生成和排队消息不会继续执行',async()=>{
    let actor='account-a';const listeners=new Set<()=>void>();const controller=studioMock.controller as typeof studioMock.controller&{getSnapshot?:()=>unknown;subscribe?:(fn:()=>void)=>()=>void};
    controller.getSnapshot=()=>({user:{id:actor}});controller.subscribe=fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
    try{
      const onApply=vi.fn(),onPreview=vi.fn();render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/>);
      send('加一把椅子');send('再加一把椅子');await screen.findByText(/条消息排队/);
      act(()=>{actor='account-b';listeners.forEach(fn=>fn());actor='account-a';listeners.forEach(fn=>fn());});
      await waitFor(()=>expect(screen.queryByText(/条消息排队/)).toBeNull(),{timeout:15000});expect(onPreview.mock.calls.at(-1)?.[0]).toBeNull();expect(onApply).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    }finally{delete controller.getSnapshot;delete controller.subscribe;}
  },20000);
  it.each([['10厘米',0.1],['100毫米',0.1],['0.1m',0.1],['两米',2]])('previews exact converted movement %s before applying', async (distance, meters) => {
    const onApply = vi.fn(), onPreview = vi.fn();
    const chair = makeItem({id:'only-chair',type:'chair',name:'椅子',position:{x:0,z:0},width:0.5,depth:0.5});
    state.layout=makeLayout({width:24,height:16,floors:[makeFloor({items:[chair]})]});
    const onMemory=vi.fn();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={onApply} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('圆桌');
    await waitFor(() => expect(onMemory.mock.calls.some(([value]) => value.layoutModeConfirmed === true)).toBe(true));
    send(`把椅子往左挪${distance}`);
    const confirm = await screen.findByRole('button', {name:'确认布置'}, {timeout:15000});
    expect(document.querySelector('#plan-proposal')?.textContent).toContain(`椅子：左移 ${meters} 米`);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![0].floors[0]!.items[0]!.position!.x).toBeCloseTo(-meters);
  }, 20000);
  it('does not silently round a one-millimetre move', async () => {
    const onApply=vi.fn(),onPreview=vi.fn();
    const chair=makeItem({id:'only-chair',type:'chair',name:'椅子',position:{x:0,z:0},width:.5,depth:.5});
    render(<LocalHarness initial={makeLayout({width:24,height:16,floors:[makeFloor({items:[chair]})]})} onApply={onApply} onPreview={onPreview}/>);
    send('把椅子往左挪1毫米');
    expect(await screen.findByText(/画布精度无法准确完成/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.every(([value])=>value===null)).toBe(true);
  });
  it.each(['把椅子往左挪10英尺','把椅子往左挪两步','把椅子往左挪','把椅子往左挪一米，暂时不要移动','把椅子往左挪一米，再删掉桌子'])('asks before an ambiguous or mixed move: %s',async message=>{
    const onApply=vi.fn(),onPreview=vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/>);
    send(message);
    expect(await screen.findByText(/移动距离或要求不明确/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.every(([value])=>value===null)).toBe(true);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  });
  it('previews the exact scale and before/after dimensions instead of describing a move', async () => {
    const onApply=vi.fn(),onPreview=vi.fn(),onMemory=vi.fn();
    const chair=makeItem({id:'only-chair',type:'chair',name:'椅子',position:{x:0,z:0},width:.5,depth:.5,height:1});
    state.layout=makeLayout({width:24,height:16,floors:[makeFloor({items:[chair]})]});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={onApply} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('圆桌'); await waitFor(()=>expect(onMemory.mock.calls.some(([value])=>value.layoutModeConfirmed===true)).toBe(true));
    send('把椅子放大2倍');
    const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    const card=document.querySelector('#plan-proposal')!.textContent!;
    expect(card).toContain('椅子：缩放 2 倍，0.5 × 0.5 × 1 米 → 1 × 1 × 2 米');
    expect(card).not.toContain('挪动 1 件'); expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(confirm);await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![0].floors[0]!.items[0]).toMatchObject({width:1,depth:1,height:2});
  },20000);
  it.each(['把椅子放大10倍','把椅子缩小到0.1倍'])('refuses out-of-range scale: %s',async message=>{
    const onApply=vi.fn(),onPreview=vi.fn();
    const chair=makeItem({id:'only-chair',type:'chair',name:'椅子',position:{x:0,z:0},width:.5,depth:.5});
    render(<LocalHarness initial={makeLayout({width:24,height:16,floors:[makeFloor({items:[chair]})]})} onApply={onApply} onPreview={onPreview}/>);
    send(message);expect(await screen.findByText(/超出支持范围/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();expect(onPreview.mock.calls.every(([v])=>v===null)).toBe(true);
  });
  it.each([['顺时针',90],['逆时针',-90]])('previews and applies exact %s rotation',async(direction,degrees)=>{
    const onApply=vi.fn(),onPreview=vi.fn(),onMemory=vi.fn();
    const chair=makeItem({id:'only-chair',type:'chair',name:'椅子',position:{x:0,z:0},rotation:0,width:.5,depth:.5});
    state.layout=makeLayout({width:24,height:16,floors:[makeFloor({items:[chair]})]});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={onApply} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('圆桌'); await waitFor(()=>expect(onMemory.mock.calls.some(([value])=>value.layoutModeConfirmed===true)).toBe(true));
    send(`把椅子${direction}旋转90度`);
    const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    expect(document.querySelector('#plan-proposal')?.textContent).toContain(`椅子：旋转角度 0° → ${degrees}°`);
    expect(onApply).not.toHaveBeenCalled();fireEvent.click(confirm);await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![0].floors[0]!.items[0]!.rotation).toBeCloseTo(degrees*Math.PI/180);
  },20000);
  it.each(['把椅子顺时针旋转90度但不要旋转','把椅子顺时针旋转90度，暂时不要转','把椅子顺时针旋转90度到180度','把椅子顺时针旋转90弧度','把椅子旋转90度','把椅子顺时针旋转0.0001度','把椅子顺时针旋转90度，再删掉桌子'])('rejects incomplete or contradictory rotation %s',async message=>{
    const onApply=vi.fn(),onPreview=vi.fn();render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/>);
    send(message);expect(await screen.findByText(/旋转方向、角度或要求不明确/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();expect(onPreview.mock.calls.every(([value])=>value===null)).toBe(true);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  });
  it('does not rotate a locked object',async()=>{
    const onApply=vi.fn(),onPreview=vi.fn();const chair=makeItem({id:'only-chair',type:'chair',name:'椅子',locked:true,position:{x:0,z:0}});
    render(<LocalHarness initial={makeLayout({floors:[makeFloor({items:[chair]})]})} onApply={onApply} onPreview={onPreview}/>);
    send('把椅子顺时针旋转90度');expect(await screen.findByText(/锁着/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  });
  it('previews the actual old and new color before explicit confirmation',async()=>{
    const onApply=vi.fn(),onPreview=vi.fn(),onMemory=vi.fn();
    const chair=makeItem({id:'only-chair',type:'chair',name:'椅子',color:'#112233',position:{x:0,z:0},width:.5,depth:.5});
    state.layout=makeLayout({width:24,height:16,floors:[makeFloor({items:[chair]})]});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={onApply} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('圆桌');await waitFor(()=>expect(onMemory.mock.calls.some(([value])=>value.layoutModeConfirmed===true)).toBe(true));
    send('把椅子换成蓝色');const confirm=await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    expect(document.querySelector('#plan-proposal')?.textContent).toContain('椅子：颜色 #112233 → #3b6fd4');
    expect(onApply).not.toHaveBeenCalled();fireEvent.click(confirm);await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![0].floors[0]!.items[0]!.color).toBe('#3b6fd4');
  },20000);
  it.each(['把椅子换成蓝色但不要蓝色','把椅子换成蓝色，暂时不要改色','把椅子换成紫色','把椅子换成蓝色，再删除桌子'])('rejects ambiguous recoloring %s',async message=>{
    const onApply=vi.fn(),onPreview=vi.fn();render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/>);
    send(message);expect(await screen.findByText(/颜色或要求不明确/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.every(([value])=>value===null)).toBe(true);expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  });
  it('asks for attendance before creating an activity layout, without disabling direct edits',async()=>{
    const onApply=vi.fn(),onPreview=vi.fn();const base=makeLayout({backendVenue:{shape:'rectangle',entrances:[],width:12,depth:9,height:3},floors:[makeFloor({items:[]})]});
    render(<LocalHarness initial={base} onApply={onApply} onPreview={onPreview}/>);send('圆桌，出方案');
    expect(await screen.findByText(/请先说明本场预计人数/)).toBeTruthy();expect(onPreview.mock.calls.every(([v])=>v===null)).toBe(true);expect(onApply).not.toHaveBeenCalled();
    send('加一把椅子');expect(await screen.findByRole('button',{name:'确认布置'},{timeout:15000})).toBeTruthy();
  },20000);
  it('uses the explicitly stated one attendee and never adds unrequested plants',async()=>{
    const onMemory=vi.fn(),onPreview=vi.fn();state.layout=makeLayout({width:12,height:9,floors:[makeFloor({items:[]})]});
    render(<LayoutAgentProvider callbacks={callbacks} onApply={vi.fn()} onPreview={onPreview} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send('1人，室内12×9米，圆桌，出方案');await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(1);
    const preview=onPreview.mock.calls.map(([v])=>v as RoomLayout|null).filter((v):v is RoomLayout=>v!==null).at(-1)!;
    expect(preview.floors.flatMap(f=>f.items).some(item=>item.type==='plant'||item.type==='flowerpot')).toBe(false);
  },20000);
  it.each(['0人','-1人','10001人'])('never promotes invalid attendance %s',async value=>{
    const onMemory=vi.fn(),onPreview=vi.fn();state.layout=makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onApply={vi.fn()} onPreview={onPreview} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send(`${value}，室内12×9米，圆桌，出方案`);await waitFor(()=>expect(onMemory).toHaveBeenCalled());
    expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBeNull();expect(onPreview.mock.calls.every(([v])=>v===null)).toBe(true);
  });
  it('keeps local procedural provenance unchanged between preview and application', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    const base = makeLayout({ floors: [makeFloor({ items: [] })] });
    render(ui(base, onApply, onPreview));
    send('30人，室内12×9，圆桌');
    const confirm = await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    const preview = onPreview.mock.calls.map(([value]) => value as RoomLayout | null).filter((value): value is RoomLayout => value !== null).at(-1)!;
    expect(preview.floors[0]!.items.filter(item => !item.structuralOpeningId).every(item => item.provenance?.source === 'procedural')).toBe(true);
    fireEvent.click(confirm);
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]![0]).toEqual(preview);
    expect(onApply.mock.calls[0]![1]).toMatchObject({ preserveProvenance: true });
  }, 20000);
  it.each([['加100把椅子', '100', '50'], ['加一百把椅子', '100', '50'], ['加30盏灯', '30', '20']])('rejects the requested quantity instead of silently reducing it: %s', async (message, count, limit) => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/>);
    send(message);
    expect(await screen.findByText(new RegExp(`你要求添加 ${count} 件，单次支持 1 至 ${limit} 件`))).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.every(([value]) => value === null)).toBe(true);
  });
  it.each(['不要加一盏灯', '别添加两把椅子', '不确定是否要加一张桌子', '加一盏灯但不要加椅子', '加两把椅子和一张桌子', '加灯，再加椅子'])('does not preview or apply ambiguous additions: %s', async message => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview} />);
    send(message);
    expect(await screen.findByText(/物料增减的意思尚不明确/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.every(([value]) => value === null)).toBe(true);
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
  });
  it.each(['把舞台往西挪1米，人数改成80人', '加两把椅子，人数改成80'])('does not silently discard the activity requirement in %s', async message => {
    const onApply = vi.fn(), onPreview = vi.fn(), onMemory = vi.fn();
    state.layout = makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={onPreview} onApply={onApply} onBriefMemoryChange={onMemory}><AgentPanel/></LayoutAgentProvider>);
    send(message);
    expect(await screen.findByText(/同时包含物件修改和活动需求，请分开发送/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.every(([value]) => value === null)).toBe(true);
    expect(onMemory.mock.calls.every(([memory]) => memory.headcount !== 80)).toBe(true);
  });
  it('reports the real chair count consistently after asking how to seat 30 guests', async () => {
    const onPreview=vi.fn(),onApply=vi.fn();const initial=makeLayout();
    render(<LocalHarness initial={initial} onApply={onApply} onPreview={onPreview}/>);
    send('30人，室内12×9米，出方案');
    expect(await screen.findByText(/还没确定布置方式/)).toBeTruthy();
    send('圆桌');
    expect(await screen.findByText('正在准备布置预览')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/定舞台位置|放绿植/);
    await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    const final=onPreview.mock.calls.map(([value])=>value as RoomLayout|null).filter((value):value is RoomLayout=>value!==null).at(-1)!;
    const count=final.floors[0]!.items.filter(item=>['chair','dining-chair','desk-chair'].includes(item.type)).length;
    expect(count).toBeGreaterThan(0);
    expect(document.getElementById('plan-seats')?.textContent).toContain(count < 30 ? `座位 ${count} / 30` : `${count} 把单人椅`);
    const summary=screen.getByText(new RegExp(`候选共识别 ${count} 把单人椅`));
    expect(summary.textContent).not.toMatch(/，30 座/);
    expect(onApply).not.toHaveBeenCalled();expect(state.layout).toEqual(initial);
  },20000);
  it('asks for a layout before generating when the user has not selected one', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview} />);
    send('30 人，室内 12×9');
    expect(await screen.findByText(/还没确定布置方式/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.every(([value]) => value === null)).toBe(true);
    send('圆桌');
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    expect(onApply).not.toHaveBeenCalled();
  }, 20000);
  it('requires restating a negated count and centimetre dimensions instead of confirming them as facts', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview} />);
    send('不要80人，12×9厘米');
    expect(await screen.findByText(/刚才的本场人数、场地长宽（单位：米）无法确定/)).toBeTruthy();
    expect(screen.queryByText(/人数 80、场地长（米） 12/)).toBeNull();
    send('确认');
    await waitFor(() => expect(screen.getAllByText(/回复「确认」不能代替具体信息/).length).toBeGreaterThan(1));
    send('出方案');
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.every(([value]) => value === null)).toBe(true);
    send('60人，12×9米，圆桌');
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    expect(onApply).not.toHaveBeenCalled();
  }, 20000);
  it('still applies a current area suggestion after explicit confirmation', async () => {
    const applyZones = vi.fn(() => '签到区');
    state.layout = makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onApplyZoneRects={applyZones}><AgentPanel/></LayoutAgentProvider>);
    send('需要签到区');
    fireEvent.click(await screen.findByRole('button', { name: '好，帮我圈' }));
    expect(applyZones).toHaveBeenCalledWith(['checkin']);
  });
  it('consumes a successful suggestion once even if its button is clicked repeatedly', async () => {
    const applyZones = vi.fn(() => '签到区'); state.layout = makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onApplyZoneRects={applyZones}><AgentPanel/></LayoutAgentProvider>);
    send('需要签到区'); const button = await screen.findByRole('button', { name: '好，帮我圈' });
    fireEvent.click(button); fireEvent.click(button);
    expect(applyZones).toHaveBeenCalledOnce();
    expect(await screen.findByText(/这条区域建议已过期/)).toBeTruthy();
  });
  it('consumes the same suggestion when accepted in text and refuses its old button', async () => {
    const applyZones = vi.fn(() => '签到区'); state.layout = makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onApplyZoneRects={applyZones}><AgentPanel/></LayoutAgentProvider>);
    send('需要签到区');const button=await screen.findByRole('button',{name:'好，帮我圈'});
    send('好');await waitFor(()=>expect(applyZones).toHaveBeenCalledOnce());
    fireEvent.click(button);expect(applyZones).toHaveBeenCalledOnce();
    expect(await screen.findByText(/这条区域建议已过期/)).toBeTruthy();
  });
  it('invalidates an area suggestion if the independent annotation draft changes', async () => {
    const applyZones = vi.fn(() => '签到区'); state.layout = makeLayout();
    const component = (revision: number) => <LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onApplyZoneRects={applyZones} zoneDraftRevision={revision}><AgentPanel/></LayoutAgentProvider>;
    const view=render(component(1)); send('需要签到区');
    const button=await screen.findByRole('button',{name:'好，帮我圈'});
    view.rerender(component(2));fireEvent.click(button);
    expect(applyZones).not.toHaveBeenCalled();expect(await screen.findByText(/这条区域建议已过期/)).toBeTruthy();
  });
  it('explains a failed draw and does not consume the suggestion on failure', async () => {
    const applyZones = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('签到区'); state.layout = makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onApplyZoneRects={applyZones}><AgentPanel/></LayoutAgentProvider>);
    send('需要签到区');const button=await screen.findByRole('button',{name:'好，帮我圈'});
    fireEvent.click(button);expect(await screen.findByText(/这次没有圈区/)).toBeTruthy();
    fireEvent.click(button);expect(applyZones).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/已经在 2D 上圈好签到区/)).toBeTruthy();
  });
  it.each(['button', 'reply'] as const)('refuses an old area suggestion after the scene changes via %s', async action => {
    const applyZones = vi.fn(() => '签到区');
    const initial = makeLayout();
    const renderWith = (current: RoomLayout) => {
      state.layout = current;
      return <LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onApplyZoneRects={applyZones}><AgentPanel/></LayoutAgentProvider>;
    };
    const view = render(renderWith(initial));
    send('需要签到区');
    const button = await screen.findByRole('button', { name: '好，帮我圈' });
    view.rerender(renderWith({ ...initial, width: initial.width + 1 }));
    if (action === 'button') fireEvent.click(button); else send('好');
    expect(applyZones).not.toHaveBeenCalled();
    expect(await screen.findByText(/场地或需求已变化，这条区域建议已过期/)).toBeTruthy();
  });

  it('refuses a stored area card after the requirement changes away and back', async () => {
    const applyZones = vi.fn(() => '签到区');
    state.layout = makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onApplyZoneRects={applyZones}><AgentPanel/></LayoutAgentProvider>);
    send('需要签到区');
    const old = await screen.findByRole('button', { name: '好，帮我圈' });
    send('不要签到区');
    await screen.findByText(/不设签到区/);
    send('需要签到区');
    await waitFor(() => expect(screen.getAllByRole('button', { name: '好，帮我圈' }).length).toBeGreaterThan(1));
    fireEvent.click(old);
    expect(applyZones).not.toHaveBeenCalled();
    expect(await screen.findByText(/场地或需求已变化，这条区域建议已过期/)).toBeTruthy();
  });
  it('does not turn an uncertain stage mention into a stage in the preview', async () => {
    const onPreview = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={vi.fn()} onPreview={onPreview} />);
    send('30 人，室内 12×9，圆桌，不排除需要舞台');
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    const previews = onPreview.mock.calls.map(([value]) => value as RoomLayout | null).filter((value): value is RoomLayout => value !== null);
    expect(previews.length).toBeGreaterThan(0);
    expect(previews.every(value => value.floors[0]!.items.every(item => item.assetId !== STAGE_PLATFORM_ASSET_ID && item.type !== 'backdrop'))).toBe(true);
    expect(screen.getAllByText(/舞台.*尚未说明/).length).toBeGreaterThan(0);
  }, 20000);
  it('allows an explicitly deferred check-in to be explored but not applied as confirmed',async()=>{
    const onPreview=vi.fn(),onApply=vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview}/>);
    send('签到尚未决定');
    await screen.findByText(/签到区暂时待定/);
    send('30 人，室内 12×9，圆桌');
    await screen.findByText('签到需求尚未确认。',undefined,{timeout:15000});
    expect(onPreview).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/还有需求待确认/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('shows an explicitly deferred rest area as unknown in the preview',async()=>{
    const onApply=vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply}/>);
    send('休息区尚未决定');
    await screen.findByText(/休息区暂时待定/);
    send('30 人，室内 12×9，圆桌');
    await screen.findByText('休息区需求尚未确认。',undefined,{timeout:15000});
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/还有需求待确认/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('shows an explicitly deferred seating requirement as unknown in the preview',async()=>{
    const onApply=vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply}/>);
    send('人人入座尚未决定');
    await screen.findByText(/所有人入座暂时待定/);
    send('30 人，室内 12×9，圆桌');
    await screen.findByText('是否所有人入座尚未确认。',undefined,{timeout:15000});
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/还有需求待确认/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  },20000);
  it('previews a real stage platform instead of treating the backdrop as the stage', async () => {
    const onPreview = vi.fn(), onApply = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} onPreview={onPreview} />);
    send('30 人，室内 12×9，圆桌，需要舞台');
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    const previews = onPreview.mock.calls.map(([value]) => value as RoomLayout | null).filter((value): value is RoomLayout => value !== null);
    expect(previews.some(value => value.floors[0]!.items.some(item => item.assetId === STAGE_PLATFORM_ASSET_ID && item.name === '舞台平台（示意）'))).toBe(true);
    expect(screen.queryByText(/请补充舞台物料或调整需求/)).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  }, 20000);
  it('does not count a backdrop as a stage when the platform cannot be placed', async () => {
    const stageSearch = vi.spyOn(stagePlatformPlan, 'proposeStagePlatform').mockReturnValue({ ok: false, reason: '这次搜索没有找到可放示意舞台模块的空位；请调整布置或手动选择位置，不能据此断定场地无解。' });
    const backdrop = makeItem({ id: 'backdrop', type: 'backdrop', materialId: 'backdrop', name: '舞台背景板', width: 2, depth: 0.2, position: { x: 0, z: -3 }, locked: true });
    render(<LocalHarness initial={makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [backdrop] })] })} onApply={vi.fn()} />);
    send('30 人，室内 12×9，圆桌，需要舞台');
    expect((await screen.findAllByText(/请补充舞台物料或调整需求|没有找到可放示意舞台模块的空位/, {}, { timeout: 15000 })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(stageSearch).toHaveBeenCalled();
    stageSearch.mockRestore();
  }, 20000);
  it('offers read-only cloud recovery from the activity panel before acknowledgement', async () => {
    studioMock.applyRecovery = { projectId: 'p', proposalId: 'x', revision: 4, outcome: 'pending' };
    const view = render(ui(state.layout));
    expect(screen.getByText(/云端提交结果尚不明确/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /解除提醒/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '只读核对云端版本' }));
    expect(studioMock.reviewApplyRecovery).toHaveBeenCalledOnce();
    studioMock.applyRecoveryReview = { status: 'unknown', message: '未能确定云端结果，请手动核对。' };
    view.rerender(ui(state.layout));
    expect(screen.getByText('未能确定云端结果，请手动核对。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '我已手动核对，解除提醒' }));
    expect(studioMock.acknowledgeApplyRecovery).toHaveBeenCalledOnce();
  });
  it('shows only progress while generating, then one green confirm with a seat fix link', async () => {
    const onApply = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} brief/>);
    send('30 人，室内 12×9，圆桌，需要签到');

    // 逐帧预览期间：只有进度，没有可点的确认。
    expect(await screen.findByText('正在准备布置预览')).toBeTruthy();
    expect(document.getElementById('gen-progress')).toBeTruthy();
    expect(document.getElementById('step-cta')).toBeNull();
    expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();

    // 最后一帧落稳后才亮：一屏恰一颗绿钮，座位缺口如实写出来，改法是文字链。
    expect(await screen.findByText(/^座位 \d+ \/ 30 · 还差 \d+$/, undefined, { timeout: 15000 })).toBeTruthy();
    expect(within(document.getElementById('plan-proposal')!).getByText('舞台需求尚未确认。')).toBeTruthy();
    expect(within(document.getElementById('plan-proposal')!).queryByText('签到需求尚未确认。')).toBeNull();
    expect(within(screen.getByLabelText('活动简报')).getByText('30 人')).toBeTruthy();
    expect(document.querySelectorAll('.sc-agent-panel .btn-primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');
    const fix = screen.getByRole('button', { name: '加座，再排一版' });
    expect(fix.className).toContain('ap-link');
    expect(fix.className).not.toContain('btn-primary');
    // 场地和物料都只在预览中，确认前不改变原画布。
    expect(onApply).not.toHaveBeenCalled();

    // 点改法：旧确认立刻消失、回到进度；同尺寸重排不再重复立壳，物料仍要等确认才落盘。
    fireEvent.click(fix);
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(document.getElementById('gen-progress')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    expect(await screen.findByText('识别到 30 把单人椅，目标 30 人；座位用途及可用性待核验', undefined, { timeout: 15000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '加座，再排一版' })).toBeNull();
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');

    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const applied = onApply.mock.calls[0]![0] as RoomLayout;
    const seats = applied.floors[0]!.items.filter(item => item.type === 'chair' || item.type === 'dining-chair');
    expect(seats.length).toBeGreaterThanOrEqual(30);
  }, 20000);

  it('reports the remaining shortfall without claiming a venue capacity limit after reseating', async () => {
    render(<LocalHarness initial={makeLayout()} onApply={vi.fn()} brief/>);
    send('200 人，室内 12×9，圆桌，需要签到');
    const fix = await screen.findByRole('button', { name: '加座，再排一版' }, { timeout: 15000 });
    fireEvent.click(fix);
    expect(await screen.findByText(/^这次排到 \d+ 座，仍缺 \d+ 座；可尝试调整物料规格、功能区或场地，再核对方案。$/, undefined, { timeout: 15000 })).toBeTruthy();
    expect(screen.queryByText(/就是头|按站立留空/)).toBeNull();
  }, 20000);

  it('作废本地旧候选：画布改过之后，确认按钮不能再把旧候选盖上去', async () => {
    const onApply = vi.fn();
    const initial = makeLayout();
    const { rerender } = render(ui(initial, onApply));
    send('30 人，室内 12×9，圆桌');
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    const callsBefore = onApply.mock.calls.length;

    rerender(ui({ ...initial, width: 10 }, onApply));
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull());
    expect(await screen.findByText(/场景在这期间改过了，这版预览先作废/)).toBeTruthy();
    expect(onApply).toHaveBeenCalledTimes(callsBefore);
  }, 20000);

  it('keeps the confirm hidden while a version is paused mid-generation', async () => {
    const onPreview = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={vi.fn()} onPreview={onPreview}/>);
    send('30 人，室内 12×9，圆桌，需要签到');
    expect(await screen.findByText('正在准备布置预览')).toBeTruthy();
    await waitFor(() => expect(onPreview).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '停一下' }));
    expect(screen.getByRole('button', { name: '接着摆' })).toBeTruthy();
    expect(document.getElementById('step-cta')).toBeNull();
    expect(document.getElementById('plan-proposal')).toBeNull();
    expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '接着摆' }));
    expect(await screen.findByText(/^座位 \d+ \/ 30 · 还差 \d+$/, undefined, { timeout: 15000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');
  }, 20000);
  it('keeps a hidden paused proposal registered so delivery cannot use the old layout',async()=>{
    const registry=createPendingCandidateRegistry(),scope={},access=bindPendingCandidateRegistry(registry,scope,()=>true),onPreview=vi.fn();
    state.layout=makeLayout();render(<LayoutAgentProvider pendingCandidates={access} callbacks={callbacks} onPreview={onPreview} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    send('30 人，室内 12×9，圆桌，需要签到');await screen.findByText('正在准备布置预览');
    await waitFor(()=>expect(onPreview.mock.calls.some(([candidate])=>candidate!==null)).toBe(true));
    fireEvent.click(screen.getByRole('button',{name:'停一下'}));
    expect(screen.getByRole('button',{name:'接着摆'})).toBeTruthy();
    expect(access.capture()).toMatchObject({local:true,hasPending:true});
  },20000);

  it('never shows a green confirm while the cloud is still writing this version', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    const { rerender } = render(ui({...state.layout,width:12,height:9}));
    send('30 人，室内 12×9，圆桌');
    expect(await screen.findByText('这版还在预览')).toBeTruthy();
    expect(within(document.getElementById('plan-proposal')!).getByText('签到需求尚未确认。')).toBeTruthy();
    expect(within(document.getElementById('plan-proposal')!).getByText('舞台需求尚未确认。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');

    studioMock.busy = true;
    rerender(ui(state.layout));
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(screen.getByText('正在整理这一版…')).toBeTruthy();
    expect(document.getElementById('step-cta')).toBeNull();

    studioMock.busy = false;
    rerender(ui(state.layout));
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');
  });
  it('adopts a cloud preview when its React update commits after generate resolves',async()=>{
    studioMock.connection='项目已连接';
    studioMock.generate.mockResolvedValue(undefined);
    const {rerender}=render(ui({...state.layout,width:12,height:9}));
    send('30 人，室内 12×9，圆桌');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    await act(async()=>{await Promise.resolve();});
    studioMock.preview=cloudPreview();
    rerender(ui(state.layout));
    expect(await screen.findByRole('button',{name:'确认布置'})).toBeTruthy();
  });
  it('leaves the generating state when the cloud run resolves without a candidate',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockResolvedValue(undefined);
    render(ui({...state.layout,width:12,height:9}));send('30 人，室内 12×9，圆桌');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    await waitFor(()=>expect(document.getElementById('agent-panel')?.dataset.state).not.toBe('generating'));
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  });
  it('ignores a cancelled run’s late preview but accepts a later independent run',async()=>{
    studioMock.connection='项目已连接';let finish!:()=>void;
    studioMock.generate.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const {rerender}=render(ui({...state.layout,width:12,height:9}));send('30 人，室内 12×9，圆桌');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    send('停一下');await waitFor(()=>expect(studioMock.cancelRun).toHaveBeenCalledOnce());
    await act(async()=>{finish();await Promise.resolve();});
    studioMock.preview=cloudPreview();rerender(ui(state.layout));
    expect(document.getElementById('agent-panel')?.dataset.state).not.toBe('proposed');
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    studioMock.preview=null;studioMock.busy=true;rerender(ui(state.layout));
    studioMock.preview=cloudPreview();studioMock.busy=false;rerender(ui(state.layout));
    expect(await screen.findByRole('button',{name:'确认布置'})).toBeTruthy();
  });
  it('does not adopt a late cloud preview from an earlier conversation',async()=>{
    function Switch(){const sessions=useAssistantSessions(()=>{});return <button type="button" onClick={()=>sessions.openSession()}>切换会话</button>;}
    studioMock.connection='项目已连接';let finish!:()=>void;
    studioMock.generate.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    state.layout={...state.layout,width:12,height:9};
    const screenFor=()=> <>{ui(state.layout)}<Switch/></>;
    const {rerender}=render(screenFor());send('30 人，室内 12×9，圆桌');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button',{name:'切换会话'}));
    await act(async()=>{finish();await Promise.resolve();});
    studioMock.preview=cloudPreview();rerender(screenFor());
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  });
  it('shows unknown safety checks on the main candidate card',async()=>{
    studioMock.connection='项目已连接';
    const preview=cloudPreview() as {proposal:{warnings:Array<{code:string;ids:string[]}>}};
    preview.proposal.warnings=[{code:'SAFETY_CHECKS_UNKNOWN',ids:[]}];
    studioMock.generate.mockImplementation(async()=>{studioMock.preview=preview;});render(ui({...state.layout,width:12,height:9}));
    send('30 人，室内 12×9，圆桌');
    expect(await screen.findByText(/出口、疏散、门扇、无障碍、消防和核定人数仍需核验/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('SAFETY_CHECKS_UNKNOWN');
  });
  it('shows the program-verified seating shortfall without expanding model text',async()=>{
    studioMock.connection='项目已连接';
    const preview=cloudPreview() as {proposal:{warnings:Array<{code:string;ids:string[]}>}};
    preview.proposal.warnings=[{code:'SAFETY_CHECKS_UNKNOWN',ids:[]},{code:'SEATING_SHORTFALL:30:24:object_limit',ids:[]}];
    studioMock.generate.mockImplementation(async()=>{studioMock.preview=preview;});
    render(ui({...state.layout,width:12,height:9}));send('30 人，室内 12×9，圆桌');
    expect(await screen.findByText(/本版排了 24 \/ 30 套，尚缺 6 套/)).toBeTruthy();
    expect(screen.getByText(/已触及云场景物件数量上限，不代表场地最大容量/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('SEATING_SHORTFALL:30:24');
  });

  it('shows the verified shared desk shortfall in the proposal card',async()=>{
    studioMock.connection='项目已连接';
    const preview=cloudPreview() as {proposal:{warnings:Array<{code:string;ids:string[]}>}};
    preview.proposal.warnings=[{code:'SHARED_SEATING_SHORTFALL:30:24:12:object_limit',ids:[]}];
    studioMock.generate.mockImplementation(async()=>{studioMock.preview=preview;});
    render(ui({...state.layout,width:12,height:9}));send('30 人，室内 12×9，圆桌');
    expect(await screen.findByText(/本版排了 24 \/ 30 人，12 桌，尚缺 6 人/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('SHARED_SEATING_SHORTFALL');
  });

  it('does not send confirmed dimensions to cloud with a differently sized scene',async()=>{
    studioMock.connection='项目已连接';
    const onApply=vi.fn();render(ui(makeLayout({width:10,height:8}),onApply));
    send('30 人，室内 12×9，圆桌');
    await waitFor(()=>expect(visibleText(document.body.textContent)).toContain('当前场地是 10 × 8 米'));
    expect(studioMock.generate).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('uses actual canvas area instead of invented 4:3 dimensions for an area-only cloud request',async()=>{
    studioMock.connection='项目已连接';
    studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    render(ui(makeLayout({width:10,height:8})));
    send('30 人，室内 80 平米，圆桌');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    expect(visibleText(document.body.textContent)).not.toContain('本次没有提交生成');
  });

  it('stops an area-only cloud request when the actual canvas area clearly differs',async()=>{
    studioMock.connection='项目已连接';const onApply=vi.fn();
    render(ui(makeLayout({width:10,height:8}),onApply));
    send('30 人，室内 120 平米，圆桌');
    await waitFor(()=>expect(visibleText(document.body.textContent)).toMatch(/120 平方米.*80 平方米/));
    expect(studioMock.generate).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('shows the cloud candidate explanation as unverified model text',async()=>{
    studioMock.connection='项目已连接';
    studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    render(ui(makeLayout({width:12,height:9})));
    send('30 人，室内 12×9，圆桌');
    const card=await screen.findByText('这版还在预览');
    const preview=card.closest('#plan-proposal')!;
    expect(within(preview as HTMLElement).getByText('查看模型原文（未经核验）')).toBeTruthy();
    expect(within(preview as HTMLElement).getByText('云端加了一把椅子')).toBeTruthy();
  });

  it('does not apply a cloud preview after an unhandled layout modification',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    studioMock.discardPreview.mockImplementation(()=>{studioMock.preview=null;});
    const onApply=vi.fn(),onMemory=vi.fn();state.layout=makeLayout({width:12,height:9});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply} onBriefMemoryChange={onMemory}><AgentPanel/><ConfirmationProbe/></LayoutAgentProvider>);
    send('30 人，室内 12×9，课桌椅');await screen.findByRole('button',{name:'确认布置'});studioMock.discardPreview.mockClear();
    const before=structuredClone(onMemory.mock.lastCall?.[0]);
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{},reply:'这个调整还需要处理。',unhandled:[{kind:'action',evidence:'请让桌椅形成半圆形'}],factEvidence:[]});
    send('请让桌椅形成半圆形');await screen.findByText(/以下内容尚未执行或仍需核对/);
    expect(onMemory.mock.lastCall?.[0]).toEqual(before);
    expect(screen.getByText(/旧方案预览已收回.*重新生成/)).toBeTruthy();
    expect(studioMock.discardPreview).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'模拟其他确认入口'}));expect(studioMock.applyPreview).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('keeps an unchanged preview when the user asks an ordinary question',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');vi.stubEnv('NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED','1');
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    studioMock.discardPreview.mockImplementation(()=>{studioMock.preview=null;});
    state.layout=makeLayout({width:12,height:9});render(ui(state.layout));
    send('30 人，室内 12×9，课桌椅');await screen.findByRole('button',{name:'确认布置'});studioMock.discardPreview.mockClear();
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    studioMock.controller.briefConversation.mockResolvedValueOnce({enabled:true,extraction:{},reply:'活动动线是参与者经过各区域的路径。',unhandled:[{kind:'question',evidence:'什么是活动动线？'}],factEvidence:[]});
    send('什么是活动动线？');await screen.findByText(/活动动线是参与者经过各区域的路径/);
    expect(studioMock.discardPreview).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
  });

  it('shows the current zero seating result without offering a confirmation',async()=>{
    studioMock.connection='项目已连接';
    const message='本次新增课桌椅组团 0 / 30 套；原场景物件未计入。本次排布未找到更多可用位置，不代表场地最大容量。实际座席和现场条件仍需核验。';
    studioMock.generate.mockResolvedValueOnce({kind:'unchanged',runId:'run-one',message});
    const onApply=vi.fn();render(ui(makeLayout({width:12,height:9}),onApply));send('30 人，室内 12×9，圆桌');
    await waitFor(()=>expect(studioMock.generate).toHaveBeenCalledOnce());
    expect(await studioMock.generate.mock.results[0]!.value).toMatchObject({kind:'unchanged'});
    await waitFor(()=>expect(visibleText(document.body.textContent)).toContain(message));expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    expect(document.getElementById('agent-panel')?.getAttribute('data-state')).not.toBe('generateFailed');
    expect(studioMock.applyPreview).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not publish a zero seating result after the user stops the run',async()=>{
    studioMock.connection='项目已连接';let finish!:(value:{kind:'unchanged';runId:string;message:string})=>void;
    studioMock.generate.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(ui(makeLayout({width:12,height:9})));send('30 人，室内 12×9，圆桌');await waitFor(()=>expect(finish).toBeTypeOf('function'));
    send('停一下');await act(async()=>finish({kind:'unchanged',runId:'run-old',message:'过期零结果不应出现'}));
    expect(screen.queryByText('过期零结果不应出现')).toBeNull();expect(studioMock.applyPreview).not.toHaveBeenCalled();
  });
  it('does not publish a zero seating result after switching conversation',async()=>{
    studioMock.connection='项目已连接';let finish!:(value:{kind:'unchanged';runId:string;message:string})=>void;
    studioMock.generate.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(ui(makeLayout({width:12,height:9})));send('30 人，室内 12×9，圆桌');await waitFor(()=>expect(finish).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button',{name:'新开会话'}));await act(async()=>finish({kind:'unchanged',runId:'run-old',message:'旧会话零结果不应出现'}));
    expect(screen.queryByText('旧会话零结果不应出现')).toBeNull();expect(studioMock.applyPreview).not.toHaveBeenCalled();
  });

  it('blocks a known cloud inventory shortage even through another confirmation entry',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    const base=makeLayout({width:12,height:9});state.layout=base;
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ConfirmationProbe/></LayoutAgentProvider>);
    send('30 人，室内 12×9，圆桌');
    await screen.findByText('这版还在预览');fireEvent.click(screen.getByText('核对这版物料数量'));
    const input=screen.getByRole('textbox',{name:/椅子.*候选 1 件/});fireEvent.change(input,{target:{value:'0'}});
    expect(studioMock.setCandidateInventory).toHaveBeenLastCalledWith(studioMock.preview,expect.objectContaining({origin:'user_reported'}),expect.any(String),expect.anything());
    expect(screen.getByText(/已填写的物料数量不足/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    const callsBefore=studioMock.controller.briefExtract.mock.calls.length;
    send('确认布置');
    expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(callsBefore);
    expect(studioMock.applyPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'模拟其他确认入口'}));
    expect(studioMock.applyPreview).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/缺 1 件椅子/)).length).toBeGreaterThan(0);
  });
  it('blocks invalid inventory input instead of treating it as unknown',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    state.layout=makeLayout({width:12,height:9});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ConfirmationProbe/></LayoutAgentProvider>);
    send('30 人，室内 12×9，圆桌');await screen.findByText('这版还在预览');
    fireEvent.click(screen.getByText('核对这版物料数量'));
    const input=screen.getByRole('textbox',{name:/椅子.*候选 1 件/});
    fireEvent.change(input,{target:{value:'0'}});fireEvent.change(input,{target:{value:'-1'}});
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    send('确认布置');fireEvent.click(screen.getByRole('button',{name:'模拟其他确认入口'}));
    expect(studioMock.applyPreview).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/物料数量输入无效/)).length).toBeGreaterThan(0);
  });

  it('applies a visible local candidate once on an explicit standalone chat confirmation',async()=>{
    const onApply=vi.fn();state.layout=makeLayout({width:12,height:9});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30 人，室内 12×9，圆桌');await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    send('应用这版');await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    send('确认布置');await waitFor(()=>expect(screen.getByText(/当前没有可确认的布置预览/)).toBeTruthy());
    expect(onApply).toHaveBeenCalledOnce();expect(studioMock.controller.briefExtract).not.toHaveBeenCalled();
  },20000);

  it('does not apply a retracted candidate via a chat confirmation',async()=>{
    const onApply=vi.fn();state.layout=makeLayout({width:12,height:9});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30 人，室内 12×9，圆桌');await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    fireEvent.click(screen.getByRole('button',{name:'撤回'}));send('确认布置');
    expect(await screen.findByText(/当前没有可确认的布置预览/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();expect(studioMock.applyPreview).not.toHaveBeenCalled();
  },20000);

  it('does not submit the same cloud candidate twice while confirmation is pending',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    studioMock.applyPreview.mockImplementation(()=>new Promise(()=>{}));
    state.layout=makeLayout({width:12,height:9});render(ui(state.layout));
    send('30 人，室内 12×9，圆桌');await screen.findByText('这版还在预览');
    send('确认布置');send('应用这版');
    expect(studioMock.applyPreview).toHaveBeenCalledOnce();
    expect(studioMock.controller.briefExtract).not.toHaveBeenCalled();
  });

  it.each(['不要确认布置','怎么确认布置？','确认场地尺寸'])('does not apply the candidate for a non-action or different confirmation: %s',async text=>{
    const onApply=vi.fn();state.layout=makeLayout({width:12,height:9});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('加一把椅子');await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    send(text);await waitFor(()=>expect(screen.getByText(text)).toBeTruthy());
    expect(onApply).not.toHaveBeenCalled();expect(studioMock.applyPreview).not.toHaveBeenCalled();
  },20000);

  it('does not confuse a pending fact confirmation with confirmation of a proposal',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    studioMock.controller.briefExtract.mockResolvedValueOnce({enabled:true,extraction:{headcount:30,lengthM:12,widthM:9}});
    const onApply=vi.fn();state.layout=makeLayout({width:12,height:9});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/></LayoutAgentProvider>);
    send('30 人，12×9，生成方案');await screen.findByText(/还没确定布置方式/);
    const callsBefore=studioMock.controller.briefExtract.mock.calls.length;send('确认布置');
    expect(await screen.findByText(/当前没有可确认的布置预览/)).toBeTruthy();
    expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(callsBefore);expect(onApply).not.toHaveBeenCalled();expect(studioMock.generate).not.toHaveBeenCalled();
  });

  it('keeps unknown inventory available for preview and discards old counts when the cloud candidate changes',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    const view=render(ui(makeLayout({width:12,height:9})));send('30 人，室内 12×9，圆桌');
    await screen.findByText('这版还在预览');fireEvent.click(screen.getByText('核对这版物料数量'));
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox',{name:/椅子.*候选 1 件/}),{target:{value:'0'}});
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    studioMock.preview=cloudPreview();view.rerender(ui(state.layout));
    fireEvent.click(screen.getByText('核对这版物料数量'));
    expect((screen.getByRole('textbox',{name:/椅子.*候选 1 件/}) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
  });

  it('blocks a reported shortage for a local candidate and rechecks through the confirmation callback',async()=>{
    const onApply=vi.fn();state.layout=makeLayout({width:12,height:9});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel/><ConfirmationProbe/></LayoutAgentProvider>);
    send('加一把椅子');await screen.findByRole('button',{name:'确认布置'},{timeout:15000});
    fireEvent.click(screen.getByText('核对这版物料数量'));
    const input=screen.getAllByRole('textbox').find(item=>(item as HTMLInputElement).placeholder==='可用总数，未知留空');expect(input).toBeTruthy();
    fireEvent.change(input!,{target:{value:'0'}});
    expect(screen.getByText(/已填写的物料数量不足/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'模拟其他确认入口'}));expect(onApply).not.toHaveBeenCalled();
  },20000);

  it('does not reuse cloud inventory input after changing chat sessions',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    render(ui(makeLayout({width:12,height:9})));send('30 人，室内 12×9，圆桌');await screen.findByText('这版还在预览');
    fireEvent.click(screen.getByText('核对这版物料数量'));fireEvent.change(screen.getByRole('textbox',{name:/椅子.*候选 1 件/}),{target:{value:'0'}});
    fireEvent.click(screen.getByRole('button',{name:'新开会话'}));
    await waitFor(()=>{const input=screen.queryByRole('textbox',{name:/椅子.*候选 1 件/});expect(input===null||(input as HTMLInputElement).value==='').toBe(true);});
    expect(studioMock.applyPreview).not.toHaveBeenCalled();
  });

  it('holds confirmation when cloud and local versions still need reconciliation', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    const { rerender } = render(ui({...state.layout,width:12,height:9}));
    send('30 人，室内 12×9，圆桌');
    await screen.findByRole('button', { name: '确认布置' });
    studioMock.applyRecovery = { projectId: 'p', revision: 4, proposalId: 'x', outcome: 'committed' };
    rerender(ui(state.layout));
    expect((await screen.findAllByText(/云端已提交第 4 版，本机应用结果未能确认/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(studioMock.applyPreview).not.toHaveBeenCalled();
  });

  it('does not announce a canvas write when cloud commit needs local recovery', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    studioMock.applyPreview.mockImplementation(async () => {
      studioMock.preview = null;
      studioMock.applyRecovery = { projectId: 'p', revision: 4, proposalId: 'x', outcome: 'pending' };
    });
    const { rerender } = render(ui({...state.layout,width:12,height:9}));
    send('30 人，室内 12×9，圆桌');
    fireEvent.click(await screen.findByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(studioMock.applyPreview).toHaveBeenCalledOnce());
    rerender(ui(state.layout));
    expect((await screen.findAllByText(/云端提交结果尚不明确/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/云端已提交第 4 版/)).toBeNull();
    expect(screen.queryByText(/写进画布了/)).toBeNull();
  });

  it('reports cleanup failure without assuming either cloud or local outcome', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    studioMock.applyPreview.mockImplementation(async () => {
      studioMock.preview = null;
      studioMock.applyRecovery = { projectId: 'p', revision: 4, proposalId: 'x', outcome: 'cleanup_failed' };
    });
    const { rerender } = render(ui({...state.layout,width:12,height:9}));
    send('30 人，室内 12×9，圆桌');
    fireEvent.click(await screen.findByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(studioMock.applyPreview).toHaveBeenCalledOnce());
    rerender(ui(state.layout));
    expect((await screen.findAllByText(/本机核对记录未能清除/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/本机应用结果未能确认/)).toBeNull();
    expect(screen.queryByText(/云端已提交第 4 版/)).toBeNull();
  });

  it('sends earlier activity choices along with the last sentence when generating a cloud preview', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    render(ui({...state.layout,width:12,height:9}));
    send('80 人讲座');
    await screen.findByText(/还差.*场地多大/);
    send('不需要签到');
    await screen.findByText('不需要签到');
    send('室内 12×9，圆桌');
    await waitFor(() => expect(studioMock.generate).toHaveBeenCalled());
    const prompt = studioMock.generate.mock.calls[0]![0] as string;
    expect(prompt).toContain('80');
    expect(prompt).toContain('不需要签到区');
    expect(prompt).toContain('12 × 9');
    expect(studioMock.generate.mock.calls[0]![1]).toEqual({ requirePreview: true });
  });

  it('confirms a model-interpreted activity need before using it in the cloud plan', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    try {
      studioMock.connection = '项目已连接';
      studioMock.controller.briefExtract
        .mockResolvedValueOnce({ enabled: true, extraction: { event: '讲座', headcount: 80, lengthM: 12, widthM: 9,
          activityNeeds: [{ kind: 'checkin', decision: 'not_needed', evidence: '不用安排接待台' }] } })
        .mockResolvedValueOnce({ enabled: true, extraction: {} });
      studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
      render(ui({...state.layout,width:12,height:9}));
      send('80人讲座，12×9，圆桌，不用安排接待台');
      expect(await screen.findByText(/关于活动需求，我理解为不需要签到区/)).toBeTruthy();
      expect(studioMock.generate).not.toHaveBeenCalled();
      send('确认');
      expect(await screen.findByText(/记下了：不需要签到区/)).toBeTruthy();
      send('出方案');
      await waitFor(() => expect(studioMock.generate).toHaveBeenCalled());
      expect(studioMock.generate.mock.calls[0]![0]).toContain('不需要签到区');
      // “出方案”是完整纯命令，走本地状态机，不重复调用付费模型。
      expect(studioMock.controller.briefExtract).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllEnvs(); }
  });

  it('shows the specific safe model-service notice when understanding falls back', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    try {
      studioMock.controller.briefExtract.mockResolvedValue({ enabled: true, extraction: null, reason: 'PROVIDER_HTTP_ERROR:429' });
      render(ui(state.layout));
      send('举办一场讲座');
      expect(await screen.findByText(/智能理解服务请求过多；请先核对服务状态和用量/)).toBeTruthy();
      expect(document.body.textContent).not.toContain('PROVIDER_HTTP_ERROR');
    } finally { vi.unstubAllEnvs(); }
  });

  it('shows the actual identified chair count for an estimated desk-chair plan without claiming complete pairs',async()=>{
    studioMock.connection='项目已连接';
    studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    render(ui({...state.layout,width:12,height:9}));
    send('预计30人，室内12×9，采用课桌椅布局，出方案');
    const warning=await screen.findByText(/规划课桌椅，当前仅识别到/);
    expect(warning.textContent).toContain('约 30 人');expect(warning.textContent).toContain('1 把单人椅');
    expect(screen.getByText(/其他家具容量、课桌数量和现场条件仍需核验。每桌人数尚未确认/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
  });
  it('shows a shared-desk choice without claiming one desk per person or a seating conflict',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    render(ui({...state.layout,width:12,height:9}));send('每2人一桌');await screen.findByText('每2人一桌');
    send('不要求所有人都坐下');await screen.findByText(/不要求所有参加者都入座/);
    send('预计30人，室内12×9，采用课桌椅布局，出方案');
    expect(await screen.findByText(/已说明不要求人人入座。用户要求每桌 2 人/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('已选择每人一套');expect(document.body.textContent).not.toContain('两项需求可能不一致');
  });

  it('keeps combined or unrecognized furniture capacity unknown in a desk-chair plan',async()=>{
    studioMock.connection='项目已连接';
    const preview=cloudPreview() as {layout:RoomLayout};
    preview.layout.floors[0]!.items=[makeItem({id:'combined',type:'sofa',name:'组合家具',position:{x:1,z:1}})];
    studioMock.generate.mockImplementation(async()=>{studioMock.preview=preview;});
    render(ui({...state.layout,width:12,height:9}));
    send('预计30人，室内12×9，采用课桌椅布局，出方案');
    expect(await screen.findByText(/当前仅识别到 0 把单人椅/)).toBeTruthy();
    expect(screen.getByText(/其他家具容量、课桌数量和现场条件仍需核验。每桌人数尚未确认/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
  });

  it('does not infer an all-seated requirement from event attendance alone',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    render(ui({...state.layout,width:12,height:9}));send('预计30人，室内12×9，圆桌，出方案');
    await screen.findByText('这版还在预览');
    expect(screen.queryByText(/规划课桌椅，当前仅识别到/)).toBeNull();
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
  });

  it('keeps an explicit not-all-seated correction visible beside the desk-chair choice',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    render(ui({...state.layout,width:12,height:9}));
    send('不要求所有人都坐下');await screen.findByText(/不要求所有参加者都入座/);
    send('预计30人，室内12×9，采用课桌椅布局，出方案');
    expect(await screen.findByText(/已说明不要求人人入座。每桌人数尚未确认/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
  });

  it('uses the later not-all-seated correction instead of retaining an old seating mandate',async()=>{
    studioMock.connection='项目已连接';studioMock.generate.mockImplementation(async()=>{studioMock.preview=cloudPreview();});
    render(ui({...state.layout,width:12,height:9}));
    send('所有人都坐下');await screen.findByText(/每位参加者都需要座位/);
    send('不要求所有人都坐下');await screen.findByText(/不要求所有参加者都入座/);
    send('预计30人，室内12×9，采用课桌椅布局，出方案');
    expect(await screen.findByText(/已说明不要求人人入座。每桌人数尚未确认/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();
  });

  it('does not allow confirming a cloud candidate that cannot account for a mandatory seated audience', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    try {
      studioMock.connection = '项目已连接';
      studioMock.controller.briefExtract.mockResolvedValue({ enabled: true, extraction: {
        headcount: 200, layoutMode: 'desk-chair', lengthM: 12, widthM: 9,
        requirements: [{ key: 'headcount', value: 200, mode: 'must' }],
      } });
      studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
      render(ui({...state.layout,width:12,height:9}));
      send('必须让 200 人坐课桌，12×9 米');
      expect((await screen.findAllByText(/未能核对是否满足 200 人/)).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });

  it('blocks a cloud candidate when all guests need seats even without a mandatory headcount', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    render(ui({...state.layout,width:12,height:9}));
    send('200人，所有人都坐下，12×9，圆桌');
    expect((await screen.findAllByText(/未能核对是否满足 200 人/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
  });

  it('blocks a cloud candidate when all guests need seats but headcount is unknown', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    render(ui(state.layout));
    send('所有人都坐下，12×9，圆桌，出方案');
    expect((await screen.findAllByText(/请先说明本场预计人数/)).length).toBeGreaterThan(0);
    expect(studioMock.generate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
  });

  it('warns when estimated attendance has enough chairs in the cloud candidate', async () => {
    studioMock.connection = '项目已连接';
    const preview = cloudPreview() as { layout: RoomLayout };
    preview.layout.floors[0]!.items = Array.from({ length: 8 }, (_, i) => makeItem({ id: `chair-${i}`, type: 'chair', position: { x: i - 3.5, z: 0 } }));
    studioMock.generate.mockImplementation(async () => { studioMock.preview = preview; });
    render(ui({...state.layout,width:12,height:9}));
    send('8 人，所有人都坐下，12×9，圆桌，出方案');
    expect(await screen.findByText(/人数可能变化/)).toBeTruthy();
  });

  it('blocks a local candidate when all guests need seats but headcount was not mandatory', async () => {
    render(ui(state.layout));
    send('200人，所有人都坐下，12×9，圆桌');
    expect((await screen.findAllByText(/未能核对是否满足 200 人/, {}, { timeout: 15000 })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
  });

  it('drops the green confirm when the cloud preview has gone stale', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); studioMock.stale = true; });
    render(ui({...state.layout,width:12,height:9}));
    send('30 人，室内 12×9，圆桌');

    const card = await waitFor(() => {
      const element = document.getElementById('plan-proposal');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(within(card).getByText(/场地、需求或编辑权在这期间变了/)).toBeTruthy();
    expect(document.getElementById('step-cta')).toBeNull();
    expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();
    expect(screen.getByRole('button', { name: '撤回' })).toBeTruthy();
  });

  it('keeps confirm off while a cloud run is still recovering', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    const { rerender } = render(ui({...state.layout,width:12,height:9}));
    send('30 人，室内 12×9，圆桌');
    expect(await screen.findByRole('button', { name: '确认布置' })).toBeTruthy();

    studioMock.recoverable = true;
    rerender(ui(state.layout));
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(screen.getByText('上一版还在恢复，确认先不亮。')).toBeTruthy();
    expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();
  });
});

describe('brief stays in step with the sentence', () => {
  it('writes headcount, event and venue onto the brief before any confirm', async () => {
    const onApply = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} brief/>);
    send('改成 80 人酒会');

    const brief = screen.getByLabelText('活动简报');
    await waitFor(() => expect(within(brief).getByText('80 人')).toBeTruthy());
    expect(within(brief).getByText('酒会')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();

    send('改成户外');
    await waitFor(() => expect(within(brief).getByText(/户外/)).toBeTruthy());
    expect(within(brief).getByText('80 人')).toBeTruthy();
    expect(within(brief).getByText('酒会')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('updates the brief while the cloud is busy and does not start a second preview', async () => {
    studioMock.connection = '项目已连接';
    studioMock.busy = true;
    const onApply = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} brief/>);
    send('80 人酒会，户外 12×9，圆桌');

    const brief = screen.getByLabelText('活动简报');
    await waitFor(() => expect(within(brief).getByText('80 人')).toBeTruthy());
    expect(within(brief).getByText('酒会')).toBeTruthy();
    expect(within(brief).getByText(/^户外 · 12 × 9 m$/)).toBeTruthy();
    expect(studioMock.generate).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();
  });

  it('does not light export confirm while a layout preview is still being drawn', async () => {
    render(<LocalHarness initial={makeLayout()} onApply={vi.fn()} brief/>);
    send('30 人，室内 12×9，圆桌');
    expect(await screen.findByText('正在准备布置预览')).toBeTruthy();
    send('导出给搭建方');
    expect(await screen.findByText(/条消息排队/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认导出' })).toBeNull();
    expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();
    expect(await screen.findByText(/当前有尚未应用的方案预览；导出读取的是原场景/,{},{timeout:15000})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'确认导出'})).toBeNull();
    expect(studioMock.exportActivity).not.toHaveBeenCalled();
  });
});

describe('T-VENUE 模板场馆改尺寸', () => {
  function templateLayout(): RoomLayout {
    return makeLayout({
      name: '青序 · 香氛快闪', scenePreset: 'popup', width: 12, height: 8, roof: { style: 'none' },
      floors: [makeFloor({ items: [
        makeItem({ id: 'popup-seat', type: 'glb-asset', name: '模板座椅', glbUrl: presetModelUrl('popup'), glbNode: 'Seat' }),
      ] })],
    });
  }

  it('refuses a size-only change that would discard template furniture', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={templateLayout()} onApply={onApply} onPreview={onPreview} brief/>);

    const brief = screen.getByLabelText('活动简报');
    expect(within(brief).getByText(/12 × 8 m/)).toBeTruthy();
    expect(within(brief).queryByText(/尺寸还没定/)).toBeNull();

    send('改成 20×12');
    expect(await screen.findByText(/会移除 1 件已有物料，场地没有更改/)).toBeTruthy();
    expect(within(brief).getByText(/12 × 8 m/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
    expect(document.getElementById('gen-progress')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(document.body.textContent).not.toContain('预览先作废');
  });
});

describe('T-VENUE-FEEL 只改尺寸的手感', () => {
  it.each(['所有人都坐下，12×9', '不需要舞台，12×9'])('does not directly apply a size change when the sentence also says %s', async sentence => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={seatLayout()} onApply={onApply} onPreview={onPreview}/>);
    send(sentence);
    expect(await screen.findByText(/还没确定布置方式/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    send('圆桌');
    expect(await screen.findByText(/请先说明本场预计人数/)).toBeTruthy();
    send('12人');
    await waitFor(() => expect(onPreview).toHaveBeenCalled(), { timeout: 15000 });
    expect(onApply).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('场地改成 12 × 9 m');
  }, 20000);
  it('changes only the venue shell when the sentence is just a new size', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={seatLayout()} onApply={onApply} onPreview={onPreview} brief/>);

    send('改成 15×10');
    expect(await screen.findByText(/场地改成 15 × 10 m/)).toBeTruthy();
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    const applied = onApply.mock.calls[0]![0] as RoomLayout;
    expect(applied.width).toBe(15);
    expect(applied.height).toBe(10);
    expect(applied.backendSceneV2?.structure.walls).toHaveLength(4);
    expect(onPreview).not.toHaveBeenCalled();
    expect(document.getElementById('gen-progress')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(document.body.textContent).not.toContain('预览先作废');
    expect(within(screen.getByLabelText('活动简报')).getByText(/15 × 10 m/)).toBeTruthy();
  });

  it('starts a blank 12 × 8 venue from the brief link in one click', async () => {
    const onApply = vi.fn();
    render(<LocalHarness initial={makeLayout({ floors: [makeFloor({ items: [] })] })} onApply={onApply} brief/>);
    const brief = screen.getByLabelText('活动简报');
    expect(within(brief).queryByText(/尺寸还没定/)).toBeNull();

    fireEvent.click(within(brief).getByRole('button', { name: /空白空间 · 12 × 8 m/ }));
    expect(await screen.findByText(/空白空间立好了：12 × 8 m/)).toBeTruthy();
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    const applied = onApply.mock.calls[0]![0] as RoomLayout;
    expect(applied.width).toBe(12);
    expect(applied.height).toBe(8);
    expect(applied.scenePreset).toBeUndefined();
    expect(applied.backendSceneV2?.structure.walls).toHaveLength(4);
    expect(within(brief).getByText(/12 × 8 m/)).toBeTruthy();
    expect(within(brief).queryByText(/尺寸还没定/)).toBeNull();
  });

  it('refuses to replace existing locked items and zones with a blank venue', async () => {
    const onApply = vi.fn(), initial = seatLayout({ locked: true });
    initial.floors[0]!.zones = [{ id: 'rest', name: '休息区', x: -2, z: -2, w: 1, d: 1, color: '#4A7C59' }];
    const before = structuredClone(initial);
    render(<LocalHarness initial={initial} onApply={onApply} brief/>);
    fireEvent.click(within(screen.getByLabelText('活动简报')).getByRole('button', { name: /空白空间 · 12 × 8 m/ }));
    expect(await screen.findByText(/2 件物料、1 个区域/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(initial).toEqual(before);
  });

  it('still previews and asks for confirmation when the sentence also names people', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={seatLayout()} onApply={onApply} onPreview={onPreview}/>);
    send('40 人，室内 12×9，圆桌');
    expect(await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 })).toBeTruthy();
    expect(onPreview).toHaveBeenCalled();
    // 场地和物料都需确认后才写入。
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/场地将从 .* 改为 .*确认前不会修改场地/)).toBeTruthy();
  }, 25000);

  it('shows removed objects and dimensions in the candidate before applying once', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    const old = makeItem({ id: 'old-chair', name: '原有椅子', type: 'chair', position: { x: 4, z: 0 } });
    render(<LocalHarness initial={makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [old] })] })} onApply={onApply} onPreview={onPreview}/>);
    send('8 人，室内 6×6，圆桌');
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/场地将从 12 × 9 m 改为 6 × 6 m/)).toBeTruthy();
    expect(screen.getByText('本次结果 · 36 ㎡')).toBeTruthy();
    expect(screen.getAllByText(/撤掉 1 件/).length).toBeGreaterThan(0);
    const candidate = onPreview.mock.calls.at(-1)?.[0] as RoomLayout;
    expect(candidate.width).toBe(6);
    expect(candidate.floors[0]!.items.some(item => item.id === old.id)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect((onApply.mock.calls[0]![0] as RoomLayout).width).toBe(6);
  }, 25000);

  it('rejects a size-only change that would delete existing furniture', async () => {
    const onApply = vi.fn();
    const old = makeItem({ id: 'old-chair', name: '原有椅子', type: 'chair', position: { x: 4, z: 0 } });
    render(<LocalHarness initial={makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [old] })] })} onApply={onApply} brief/>);
    send('改成 6×6');
    expect(await screen.findByText(/会移除 1 件已有物料，场地没有更改/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText('活动简报')).getByText(/12 × 9 m/)).toBeTruthy();
  });

  it('preserves a user-drawn zone that still fits after a size-only change', async () => {
    const onApply = vi.fn();
    const zone = { id: 'user-zone', name: '原有区域', color: '#4A7C59', x: -2, z: -2, w: 2, d: 2 };
    render(<LocalHarness initial={makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [], zones: [zone] })] })} onApply={onApply}/>);
    send('改成 6×6');
    expect(await screen.findByText(/场地改成 6 × 6 m/)).toBeTruthy();
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]![0].floors[0].zones).toContainEqual(zone);
  });

  it('does not apply a smaller venue when an existing zone would be outside it',async()=>{
    const onApply=vi.fn(),zone={id:'outside-zone',name:'原有区域',color:'#4A7C59',x:4,z:0,w:2,d:2};
    render(<LocalHarness initial={makeLayout({width:12,height:9,floors:[makeFloor({items:[],zones:[zone]})]})} onApply={onApply}/>);
    send('改成 6×6');expect(await screen.findByText(/现有区域超出新场地范围/)).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  });
  it('does not propose a smaller venue when an existing zone would be outside it',async()=>{
    const onApply=vi.fn(),onPreview=vi.fn(),zone={id:'outside-zone',name:'原有区域',color:'#4A7C59',x:4,z:0,w:2,d:2};
    render(<LocalHarness initial={makeLayout({width:12,height:9,floors:[makeFloor({items:[],zones:[zone]})]})} onApply={onApply} onPreview={onPreview}/>);
    send('8 人，室内 6×6，圆桌');expect(await screen.findByText(/现有区域超出新场地范围/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(onApply).not.toHaveBeenCalled();expect(onPreview.mock.calls.every(([value])=>value===null)).toBe(true);
  });

  it('preserves an existing zone in the generated venue candidate', async () => {
    const onApply = vi.fn(),onPreview=vi.fn();
    const zone = { id: 'existing-zone', name: '原有区域', color: '#4A7C59', x: -2, z: -2, w: 2, d: 2 };
    render(<LocalHarness initial={makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [], zones: [zone] })] })} onApply={onApply} onPreview={onPreview}/>);
    send('8 人，室内 6×6，圆桌');
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText(/这版将移除 1 个已有区域标注/)).toBeNull();
    expect(onPreview.mock.calls.at(-1)?.[0].floors[0].zones).toContainEqual(zone);
  }, 25000);

  it('shows rest area geometry and the example bench before confirmation', async () => {
    const onApply = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply}/>);
    send('8 人，室内 12×9，圆桌，需要休息区');
    await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/休息区（待核验）：2.2 × 1.6 m，中心坐标/)).toBeTruthy();
    expect(screen.getByText(/示意长椅 1.4 × 0.4 m.*通行和消防条件待核验/)).toBeTruthy();
  }, 25000);
});

describe('T-PLAN 按图纸估跟住说过的面积', () => {
  it('「300 平米，按图纸估」折的是说过的 300 ㎡，不是画布上那块旧空地', async () => {
    // jsdom 的 Image 不会为 data URL 触发 onload，也没有 canvas 缩放：给一张 2:1 的图纸（边长在缩放阈值内）走真链路。
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 1200;
      naturalHeight = 600;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const onApply = vi.fn();
    render(<LocalHarness initial={makeLayout({ width: 12, height: 8 })} onApply={onApply}/>);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    // 选中先在输入框挂住，不立刻进对话；点发送才按原链路读进场地。
    expect(await screen.findByText('plan.png')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /按图纸估一版/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByRole('button', { name: /按图纸估一版/ })).toBeTruthy();

    send('300平米，按图纸估');
    const line = await screen.findByText(/你说的 300 ㎡/, undefined, { timeout: 15000 });
    const dims = line.textContent?.match(/估的 ([\d.]+) × ([\d.]+) m/);
    expect(Number(dims?.[1]) * Number(dims?.[2])).toBeGreaterThan(12 * 8);
    vi.unstubAllGlobals();
  }, 25000);

  it('报出 100 米上限，并把被拒的尺寸从简报里收回——画布没变，简报就不能跟着变', async () => {
    const onApply = vi.fn();
    render(<LocalHarness initial={makeLayout({ width: 12, height: 8 })} onApply={onApply} brief/>);
    send('改成 200×150');
    expect(await screen.findByText(/这块场地最多立到 100 米/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(within(screen.getByLabelText('活动简报')).getByText(/室内 · 12 × 8 m/)).toBeTruthy());
    expect(screen.getByLabelText('活动简报').textContent).not.toContain('200 × 150');
  }, 25000);
});

describe('T-ATTACH 图纸照片先进输入框', () => {
  it('选进来先挂在输入框，点发送才进对话；也能撤掉', async () => {
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 1200;
      naturalHeight = 600;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    render(<LocalHarness initial={makeLayout({ width: 12, height: 8 })} onApply={vi.fn()}/>);
    const sendButton = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    expect(await screen.findByText('plan.png')).toBeTruthy();
    expect(screen.getByRole('button', { name: '移除附件' })).toBeTruthy();
    expect(sendButton.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /按图纸估一版/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '移除附件' }));
    expect(screen.queryByText('plan.png')).toBeNull();
    expect(screen.queryByRole('button', { name: '移除附件' })).toBeNull();
    expect(sendButton.disabled).toBe(true);
    vi.unstubAllGlobals();
  }, 25000);
});

describe('活动在左侧工作台（S1 后默认脸）', () => {
  it('preserves the visible session and blocks memory writes and deletion after the write guard is lost', async () => {
    let held = true;
    const assertSessionWrite = () => { if (!held) throw new Error('lease lost'); };
    const onMemory = vi.fn();
    state.layout = makeLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onBriefMemoryChange={onMemory} assertSessionWrite={assertSessionWrite}><AgentPanel/></LayoutAgentProvider>);
    send('80人');
    await waitFor(() => expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(80));
    const key = 'scendance.assistant-brief-memory.v1';
    const before = localStorage.getItem(key);
    expect(before).toContain('80');
    held = false;
    send('60人');
    await waitFor(() => expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(60));
    expect(localStorage.getItem(key)).toBe(before);
    expect(await screen.findByText(/这次需求暂时无法保存在本机/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '会话历史' }));
    fireEvent.click(screen.getByRole('button', { name: /^删除 / }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(screen.getByRole('button', { name: /^删除 / })).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(before);
    expect(screen.getByText('这场改动没能写进本机')).toBeTruthy();
  });
  it('does not fall back to unguarded writes when an injected session guard disappears', async () => {
    const onMemory = vi.fn(), guard = vi.fn();
    state.layout = makeLayout();
    const node = (assertSessionWrite?: () => void) => <LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()} onBriefMemoryChange={onMemory} assertSessionWrite={assertSessionWrite}><AgentPanel/></LayoutAgentProvider>;
    const view = render(node(guard));
    send('80人');
    await waitFor(() => expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(80));
    const key = 'scendance.assistant-brief-memory.v1';
    const before = localStorage.getItem(key);
    view.rerender(node());
    send('60人');
    await waitFor(() => expect(onMemory.mock.calls.at(-1)?.[0].headcount).toBe(60));
    expect(localStorage.getItem(key)).toBe(before);
    expect(await screen.findByText(/这次需求暂时无法保存在本机/)).toBeTruthy();
  });
  it('explains when text and scene context may leave the device', () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '0');
    try {
      const view = render(ui(makeLayout()));
      expect(screen.getByText('文字识别按本机规则处理。未连接云端方案生成。')).toBeTruthy();
      expect(screen.getByLabelText('告诉 Agent 要改的').getAttribute('aria-describedby')).toBe('ap-data-notice');
      vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
      view.rerender(ui(makeLayout()));
      expect(screen.getByText('输入文字可能发送至模型服务。未连接云端方案生成。')).toBeTruthy();
      studioMock.connection = '项目已连接';
      view.rerender(ui(makeLayout()));
      expect(screen.getByText('输入文字可能发送至模型服务。云端生成会发送当前场景及部分对话上下文。')).toBeTruthy();
      vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '0');
      view.rerender(ui(makeLayout()));
      expect(screen.getByText('文字识别按本机规则处理。云端生成会发送当前场景及部分对话上下文。')).toBeTruthy();
    } finally { vi.unstubAllEnvs(); }
  });
  it('会话头展示标题，能力芯片与输入框可用', () => {
    render(ui(makeLayout()));
    expect(screen.getByRole('group', { name: '你可以做什么' })).toBeTruthy();
    const input = screen.getByLabelText('告诉 Agent 要改的');
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it('空输入时把引导句逐字打出来，Tab 一次填整句', () => {
    render(ui(makeLayout()));
    expect(document.querySelector('.ap-ghost')?.textContent).toBe('80 人发布会，室内 12×9，安排签到和主舞台');
    const input = screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement;
    // 引导层出现时 placeholder 让位，不能再叠一层灰字。
    expect(input.getAttribute('placeholder')).toBe('');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('80 人发布会，室内 12×9，安排签到和主舞台');
    // 填满之后引导层让开，不再压在真句子上。
    expect(document.querySelector('.ap-ghost')).toBeNull();
  });
});

describe('S1 活动归位：活动脸接走唯一生成对话，假分派拆除', () => {
  it('活动脸集齐例句卡、会话操作与两枚能力芯片', () => {
    state.layout = INITIAL_LAYOUT;
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    // 默认脸即活动：布置生成例句卡归活动脸。
    expect(screen.getByLabelText('生成活动方案')).toBeTruthy();
    // 会话历史与新开随生成主对话一起归活动脸。
    expect(screen.getByRole('button', { name: '会话历史' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新开会话' })).toBeTruthy();
    const group = screen.getByRole('group', { name: '你可以做什么' });
    expect(within(group).getByRole('button', { name: /地图选址/ })).toBeTruthy();
    expect(within(group).getByRole('button', { name: /按风格配一套/ })).toBeTruthy();
    // 面板身份文案已改名「活动」（标题显示会话名，名字落在 aside aria-label）。
    expect(document.getElementById('agent-panel')?.getAttribute('aria-label')).toBe('活动');
  });

  it('Bingo 脸是纯审校台：无输入框、无布置话术，空态只说审校的事', () => {
    state.layout = INITIAL_LAYOUT;
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    expect(screen.queryByLabelText('生成活动方案')).toBeNull();
    expect(screen.queryByRole('button', { name: '会话历史' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新开会话' })).toBeNull();
    expect(screen.queryByRole('group', { name: '你可以做什么' })).toBeNull();
    // T2：composer 已从 Bingo 脸摘除——输入框、布置空态话术都不在。
    expect(screen.queryByLabelText('告诉 Agent 要改的')).toBeNull();
    expect(screen.queryByText('先说一句就行')).toBeNull();
    expect(screen.getByText('这边只管审校')).toBeTruthy();
    expect(screen.getByText(/对方的意见保存在对方浏览器，不会自动回到这里/)).toBeTruthy();
    expect(document.getElementById('gen-progress')).toBeNull();
    expect(document.getElementById('plan-proposal')).toBeNull();
    // 审校状态台三钮在位。
    expect(screen.getByRole('button', { name: '立即体检' })).toBeTruthy();
  });

  it('Bingo 脸只回放审校气泡：体检回执出现在审校台', async () => {
    state.layout = seatLayout();
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button', { name: '立即体检' }));
    expect(await screen.findByText(/不是合规审查/)).toBeTruthy();
  });

  it('假分派控件与话术全部消失，空态改成统一的先说一句引导', () => {
    state.layout = INITIAL_LAYOUT;
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="door"/></LayoutAgentProvider>);
    expect(screen.queryByRole('group', { name: '这场对话里找谁说' })).toBeNull();
    expect(screen.queryByRole('group', { name: '一起说的 agent' })).toBeNull();
    expect(screen.queryByText('分派结果')).toBeNull();
    expect(screen.queryByText('先说一句，我来分派')).toBeNull();
    expect(screen.getByText('先说一句就行')).toBeTruthy();
    // 输入框不再有点名分支的中性 placeholder 话术。
    const input = screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement;
    expect(input.placeholder).not.toContain('选中的 agent');
  });

  it('S1.1 画廊桥缺 Provider 时安静不渲染，活动脸与 Bingo 脸都不炸', () => {
    state.layout = INITIAL_LAYOUT;
    const view = render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    // 本壳没有 CreativeStudioProvider，useLocalProjectBackup() 为 null：画廊整块缺席而非抛错。
    expect(view.container.querySelector('.sc-local-activities')).toBeNull();
    view.rerender(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    expect(view.container.querySelector('.sc-local-activities')).toBeNull();
  });
});

describe('S2 Bingo 审校台：三钮状态台直达', () => {
  it('Bingo 脸渲染三钮状态台', () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    expect(screen.getByRole('button', { name: '立即体检' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '准备客户评审' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送钉评链接' })).toBeTruthy();
  });

  it('活动脸不挂审校状态台三钮', () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    expect(screen.queryByRole('button', { name: '立即体检' })).toBeNull();
    expect(screen.queryByRole('button', { name: '准备客户评审' })).toBeNull();
    expect(screen.queryByRole('button', { name: '发送钉评链接' })).toBeNull();
  });

  it('点「立即体检」不打字即出几何体检回执', async () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button', { name: '立即体检' }));
    // 与 T-03 口令路径同引擎、同口径声明，只是入口从 send() 换成按钮。
    expect(await screen.findByText(/不是合规审查/)).toBeTruthy();
  });

  it('点「准备客户评审」直接回调，不落气泡', () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button', { name: '准备客户评审' }));
    expect(callbacks.onOpenReview).toHaveBeenCalledOnce();
  });

  it.each(['floor','floor-aba','layout','layout-aba'])('does not claim an old link is ready after same-batch %s changes',async mode=>{
    useRealLayoutStore=true;const base=makeLayout({id:'review-scope',floors:[makeFloor({id:'floor-a'}),makeFloor({id:'floor-b'})]});
    state.layout=base;layoutStore.setState({layout:base,activeFloorIndex:0});
    let finish!:(value:{url:string;isCurrent:()=>boolean})=>void;
    callbacks.onIssueReviewLink.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button',{name:'发送钉评链接'}));fireEvent.click(screen.getByRole('button',{name:'发送钉评链接'}));
    expect(callbacks.onIssueReviewLink).toHaveBeenCalledTimes(1);
    act(()=>{if(mode==='layout'||mode==='layout-aba'){const revision=layoutStore.getState().revision;layoutStore.setState({layout:{...base,name:'改后的方案'},revision:revision+1});if(mode==='layout-aba')layoutStore.setState({layout:base,revision:revision+2});}else {layoutStore.setState({activeFloorIndex:1});if(mode==='floor-aba')layoutStore.setState({activeFloorIndex:0});}});
    await act(async()=>{finish({url:'https://example.test/review/#layout=old',isCurrent:()=>true});await Promise.resolve();});
    expect(await screen.findByText(/旧评审记录如已写入会保留，链接未复制/)).toBeTruthy();expect(screen.queryByText(/评审链接已准备好/)).toBeNull();
    useRealLayoutStore=false;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});
  });
  it('requires the producer guard to remain valid even if the local snapshot is unchanged',async()=>{
    callbacks.onIssueReviewLink.mockResolvedValueOnce({url:'https://example.test/review/#layout=old',isCurrent:()=>false});
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button',{name:'发送钉评链接'}));
    expect(await screen.findByText(/旧评审记录如已写入会保留，链接未复制/)).toBeTruthy();expect(screen.queryByText(/评审链接已准备好/)).toBeNull();
  });

  it('never treats an unguarded legacy return as a verified current link',async()=>{
    callbacks.onIssueReviewLink.mockResolvedValueOnce('https://example.test/review/#layout=legacy');
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button',{name:'发送钉评链接'}));
    expect(await screen.findByText(/当前版本无法核对/)).toBeTruthy();expect(screen.queryByText(/评审链接已准备好/)).toBeNull();
  });
  it('does not report an old result into a replaced activity session',async()=>{
    let epoch=1;const captured=epoch;let finish!:(value:{url:string;isCurrent:()=>boolean})=>void;
    callbacks.onIssueReviewLink.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    state.layout=makeLayout({id:'review-a'});render(<LayoutAgentProvider sessionScope="activity:review-a" isSessionCurrent={()=>epoch===captured} callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button',{name:'发送钉评链接'}));epoch+=2;
    await act(async()=>{finish({url:'https://example.test/review/#layout=old',isCurrent:()=>false});await Promise.resolve();});
    expect(screen.queryByText(/评审链接已准备好/)).toBeNull();expect(screen.queryByText(/链接未复制/)).toBeNull();
  });

  it('点「发送钉评链接」只指路到甲方评审记录卡，聊天不打链接', async () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    fireEvent.click(screen.getByRole('button', { name: '发送钉评链接' }));
    await waitFor(() => expect(callbacks.onIssueReviewLink).toHaveBeenCalled());
    expect(screen.getByText(/对方的意见仅保存在对方浏览器，不会自动回到这里/)).toBeTruthy();
    // 长链接不进聊天框；复制动作住在审计卡上（复用既有「复制甲方链接」钮）。
    expect(screen.queryByRole('button', { name: '复制评审链接' })).toBeNull();
  });
});
