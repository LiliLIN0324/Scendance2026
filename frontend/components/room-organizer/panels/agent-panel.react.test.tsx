// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { INITIAL_BRIEF } from '../lib/creative-brief';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { presetModelUrl } from '../lib/scene-presets';
import { resetAssistantSessionsStoreForTests } from '../hooks/use-assistant-sessions';
import { ActivityBrief, AgentPanel, LayoutAgentProvider, MapVenueOverlay, type BriefTool } from './agent-panel';
import type { RoomLayout } from '../lib/types';
import type { WorkbenchMode } from '../lib/workbench-mode';

const state = vi.hoisted(() => ({
  layout: null as unknown as RoomLayout,
  apply: vi.fn(),
  addItems: vi.fn(),
  commitNow: vi.fn(),
  view: null as unknown,
  setView: vi.fn(),
}));

const studioMock = vi.hoisted(() => ({
  exportActivity: vi.fn(async () => {}),
  generate: vi.fn(async () => {}),
  discardPreview: vi.fn(),
  setBrief: vi.fn(),
  brief: { event: null as string | null, guests: null as number | null },
  hasSavedBrief: false,
  preview: null as unknown,
  stale: false,
  expired: false,
  busy: false,
  recoverable: false,
  connection: '离线引导',
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
  // 测试壳没有 CreativeStudioProvider：画廊桥拿到 null 动作集后整体不渲染（与真实 Context 缺省行为一致）。
  useLocalProjectBackup: () => null,
}));

const callbacks = {
  workbenchMode: 'layout' as WorkbenchMode,
  onOpenMaterials: vi.fn(), onSelectMode: vi.fn(), onOpenReview: vi.fn(),
  onOpenDelivery: vi.fn(), onFit: vi.fn(),
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

/**
 * 本地生成会先 applyLayout 立壳体，再在立好的场地上算候选。
 * 这份夹具让画布跟着 applyLayout 变，生成器读到的才是刚立起来的 12×9，而不是测试初始的空地。
 */
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

/** Material Symbols 私用区字形会混进 textContent，断言只看可见文案。 */
function visibleText(value: string | null | undefined): string {
  return (value ?? '').replace(/[\uE000-\uF8FF]/g, '').replace(/\s+/g, ' ').trim();
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText('告诉 Agent 要改的'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

async function reviewAndFix(): Promise<void> {
  send('看看哪里有问题');
  fireEvent.click(await screen.findByRole('button', { name: /按这条改：把靠边的桌椅往场中挪/ }));
}

beforeEach(() => {
  state.layout = seatLayout();
  state.view = makeViewSettings();
  state.apply = vi.fn();
  state.addItems = vi.fn();
  state.commitNow = vi.fn();
  state.setView = vi.fn();
  callbacks.workbenchMode = 'layout';
  for (const callback of Object.values(callbacks)) if (typeof callback === 'function') callback.mockClear();
  studioMock.exportActivity.mockReset(); studioMock.exportActivity.mockResolvedValue(undefined);
  studioMock.generate.mockReset(); studioMock.generate.mockResolvedValue(undefined);
  studioMock.discardPreview.mockClear(); studioMock.setBrief.mockClear();
  studioMock.brief = { event: null, guests: null };
  studioMock.hasSavedBrief = false;
  studioMock.preview = null; studioMock.stale = false; studioMock.expired = false; studioMock.busy = false;
  studioMock.recoverable = false;
  studioMock.connection = '离线引导';
  localStorage.clear();
  resetAssistantSessionsStoreForTests();
});

afterEach(cleanup);

describe('T-04 delivery narrative in the Agent panel', () => {
  it('opens customer review from the panel without claiming a sent link', () => {
    callbacks.workbenchMode = 'review';
    render(ui(state.layout));
    expect(screen.getByText(/评审 · /)).toBeTruthy();
    const cta = screen.getByRole('button', { name: '打开客户评审' });
    expect(cta.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(cta);
    expect(callbacks.onOpenReview).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('生成评审链接');
    expect(document.body.textContent).not.toContain('已发送');
    expect(document.body.textContent).not.toContain('已通知');
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

  it('labels execution exports as local internal material and never claims cloud collaboration', () => {
    callbacks.workbenchMode = 'delivery';
    render(ui(state.layout));
    expect(screen.getByText(/执行 · 本机内部资料/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '导出交接' }));
    expect(screen.getByText('导出完整活动交接')).toBeTruthy();
    expect(studioMock.exportActivity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '先不了' }));
    fireEvent.click(screen.getByRole('button', { name: '打开执行资料' }));
    expect(callbacks.onOpenDelivery).toHaveBeenCalledOnce();
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
  it('keeps the idle rail free of primary buttons and stage counters, with the demo strip intact', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:3099');
    try {
      render(ui(state.layout));
      expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();
      expect(screen.queryByText(/\d\/4/)).toBeNull();
      expect(screen.getByText(/演示环境 · 方案由本机规则生成/)).toBeTruthy();
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

  it('keeps the plan picker out of the Bingo review face', () => {
    state.layout = INITIAL_LAYOUT;
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    expect(screen.queryByLabelText('生成活动方案')).toBeNull();
  });

  it('puts 按风格配一套 on 活动 alongside 地图选址 and opens the style panel', () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/></LayoutAgentProvider>);
    const group = screen.getByRole('group', { name: '你可以做什么' });
    expect(within(group).getByRole('button', { name: /按风格配一套/ })).toBeTruthy();
    expect(within(group).getByRole('button', { name: /地图选址/ })).toBeTruthy();
    expect(within(group).queryByRole('button', { name: /生成物件/ })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: /按风格配一套/ }));
    expect(screen.getByRole('dialog', { name: '按风格配一套' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '按奶油会客配一套' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '按奶油会客配一套' }));
    expect(state.commitNow).toHaveBeenCalledOnce();
    expect(state.addItems).toHaveBeenCalledOnce();
    const items = state.addItems.mock.calls[0]![0] as { type: string; color?: string }[];
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items.some(item => item.type === 'sofa' && item.color === '#E8DCC8')).toBe(true);
    expect(screen.getByText(/按「奶油会客」放了一套/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '按风格配一套' })).toBeNull();
  });

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
    studioMock.brief = { event: '工作坊', guests: 40 };
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ActivityBrief tools={[]}/></LayoutAgentProvider>);
    const brief = screen.getByLabelText('活动简报');
    expect(within(brief).getByText('工作坊')).toBeTruthy();
    expect(within(brief).getByText('40 人')).toBeTruthy();
    expect(within(brief).queryByText('还没说')).toBeNull();
  });

  it('keeps untouched form defaults out of the brief', () => {
    studioMock.brief = { event: INITIAL_BRIEF.event, guests: INITIAL_BRIEF.guests };
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ActivityBrief tools={[]}/></LayoutAgentProvider>);
    const brief = screen.getByLabelText('活动简报');
    expect(within(brief).getAllByText('还没说').length).toBeGreaterThan(0);
    expect(within(brief).queryByText('品牌快闪')).toBeNull();
    expect(within(brief).queryByText('24 人')).toBeNull();
  });

  it('routes export intent to a preview card and only the confirm button triggers the handoff', async () => {
    render(ui(state.layout));
    send('导出给搭建方');
    const card = (await screen.findByText('导出完整活动交接')).closest('.ap-card') as HTMLElement;
    expect(within(card).getByText(/本机生成/)).toBeTruthy();
    expect(studioMock.exportActivity).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: '确认导出' }));
    await waitFor(() => expect(studioMock.exportActivity).toHaveBeenCalledOnce());
    expect(screen.queryByText('导出完整活动交接')).toBeNull();
  });

  it('keeps one green primary when export preview opens over a pending fix', async () => {
    render(ui(state.layout));
    await reviewAndFix();
    expect(await screen.findByText('改法预览')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');

    send('导出给搭建方');
    expect(await screen.findByText('导出完整活动交接')).toBeTruthy();
    const primaries = [...document.querySelectorAll('.sc-agent-panel .btn-primary')].map(button => button.textContent?.trim());
    expect(primaries).toEqual(['确认导出']);

    fireEvent.click(screen.getByRole('button', { name: '先不了' }));
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');
  });

  it('treats 出交接 as export but keeps 出物料清单 as an in-chat list', async () => {
    render(ui(state.layout));
    send('出交接');
    expect(await screen.findByText('导出完整活动交接')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '先不了' }));
    expect(screen.queryByText('导出完整活动交接')).toBeNull();
    send('出物料清单');
    // 清单仍在对话里回（同步），不应当落到导出预览卡。
    expect(screen.queryByText('导出完整活动交接')).toBeNull();
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
});

describe('T-05 生成完再亮确认 + 座位不够给改方案', () => {
  it('shows only progress while generating, then one green confirm with a seat fix link', async () => {
    const onApply = vi.fn();
    render(<LocalHarness initial={makeLayout()} onApply={onApply} brief/>);
    send('30 人，室内 12×9');

    // 逐帧预览期间：只有进度，没有可点的确认。
    expect(await screen.findByText('读场地')).toBeTruthy();
    expect(document.getElementById('gen-progress')).toBeTruthy();
    expect(document.getElementById('step-cta')).toBeNull();
    expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();

    // 最后一帧落稳后才亮：一屏恰一颗绿钮，座位缺口如实写出来，改法是文字链。
    expect(await screen.findByText(/^座位 \d+ \/ 30 · 还差 \d+$/, undefined, { timeout: 15000 })).toBeTruthy();
    expect(within(screen.getByLabelText('活动简报')).getByText('30 人')).toBeTruthy();
    expect(document.querySelectorAll('.sc-agent-panel .btn-primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');
    const fix = screen.getByRole('button', { name: '加座，再排一版' });
    expect(fix.className).toContain('ap-link');
    expect(fix.className).not.toContain('btn-primary');
    // 壳体（场地真相）在生成开始时经 onApply 落盘、进了撤销历史；物料仍一笔未写。
    expect(onApply).toHaveBeenCalledTimes(1);

    // 点改法：旧确认立刻消失、回到进度；同尺寸重排不再重复立壳，物料仍要等确认才落盘。
    fireEvent.click(fix);
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(document.getElementById('gen-progress')).toBeTruthy();
    expect(onApply).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('按 30 人摆了 30 座', undefined, { timeout: 15000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '加座，再排一版' })).toBeNull();
    expect(screen.getByRole('button', { name: '确认布置' }).className).toContain('btn-primary');

    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    const applied = onApply.mock.calls[1]![0] as RoomLayout;
    const seats = applied.floors[0]!.items.filter(item => item.type === 'chair' || item.type === 'dining-chair');
    expect(seats.length).toBeGreaterThanOrEqual(30);
  }, 20000);

  it('作废本地旧候选：画布改过之后，确认按钮不能再把旧候选盖上去', async () => {
    const onApply = vi.fn();
    const initial = makeLayout();
    const { rerender } = render(ui(initial, onApply));
    send('30 人，室内 12×9');
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
    send('30 人，室内 12×9');
    expect(await screen.findByText('读场地')).toBeTruthy();
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

  it('never shows a green confirm while the cloud is still writing this version', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); });
    const { rerender } = render(ui(state.layout));
    send('30 人，室内 12×9');
    expect(await screen.findByText('这版还在预览')).toBeTruthy();
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

  it('drops the green confirm when the cloud preview has gone stale', async () => {
    studioMock.connection = '项目已连接';
    studioMock.generate.mockImplementation(async () => { studioMock.preview = cloudPreview(); studioMock.stale = true; });
    render(ui(state.layout));
    send('30 人，室内 12×9');

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
    const { rerender } = render(ui(state.layout));
    send('30 人，室内 12×9');
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
    send('80 人酒会，户外 12×9');

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
    send('30 人，室内 12×9');
    expect(await screen.findByText('读场地')).toBeTruthy();
    send('导出给搭建方');
    expect(await screen.findByText(/确认先不亮/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认导出' })).toBeNull();
    expect(document.querySelector('.sc-agent-panel .btn-primary')).toBeNull();
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

  it('reports template meters in the brief, then unloads the template for the new size without a proposal', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={templateLayout()} onApply={onApply} onPreview={onPreview} brief/>);

    const brief = screen.getByLabelText('活动简报');
    expect(within(brief).getByText(/12 × 8 m/)).toBeTruthy();
    expect(within(brief).queryByText(/尺寸还没定/)).toBeNull();

    send('改成 20×12');
    expect(await screen.findByText(/已离开模板：模板物件已撤/)).toBeTruthy();
    await waitFor(() => expect(within(brief).getByText(/20 × 12 m/)).toBeTruthy());

    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    const applied = onApply.mock.calls[0]![0] as RoomLayout;
    expect(applied.width).toBe(20);
    expect(applied.height).toBe(12);
    expect(applied.scenePreset).toBeUndefined();
    expect(applied.backendSceneV2?.structure.walls).toHaveLength(4);
    expect(applied.floors[0]!.items.some(item => item.id === 'popup-seat')).toBe(false);
    expect(onPreview).not.toHaveBeenCalled();
    expect(document.getElementById('gen-progress')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(document.body.textContent).not.toContain('预览先作废');
  });
});

describe('T-VENUE-FEEL 只改尺寸的手感', () => {
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
    render(<LocalHarness initial={seatLayout()} onApply={onApply} brief/>);
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

  it('still previews and asks for confirmation when the sentence also names people', async () => {
    const onApply = vi.fn(), onPreview = vi.fn();
    render(<LocalHarness initial={seatLayout()} onApply={onApply} onPreview={onPreview}/>);
    send('40 人，室内 12×9');
    expect(await screen.findByRole('button', { name: '确认布置' }, { timeout: 15000 })).toBeTruthy();
    expect(onPreview).toHaveBeenCalled();
    // 壳体落盘走 onApply（进撤销历史）；带人数所以仍出提案，物料等确认。
    expect(onApply).toHaveBeenCalledTimes(1);
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

  it('Bingo 脸不挂任何布置生成入口，但中间态保留共用输入框', () => {
    state.layout = INITIAL_LAYOUT;
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel activeAgent="bingo"/></LayoutAgentProvider>);
    expect(screen.queryByLabelText('生成活动方案')).toBeNull();
    expect(screen.queryByRole('button', { name: '会话历史' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新开会话' })).toBeNull();
    expect(screen.queryByRole('group', { name: '你可以做什么' })).toBeNull();
    // S2 才把 Bingo 改成纯审校台；S1.0 中间态共用 composer 仍在，但不再有生成卡片。
    expect(screen.getByLabelText('告诉 Agent 要改的')).toBeTruthy();
    expect(document.getElementById('gen-progress')).toBeNull();
    expect(document.getElementById('plan-proposal')).toBeNull();
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
