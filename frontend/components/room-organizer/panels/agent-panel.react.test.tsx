// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { ActivityBrief, AgentPanel, LayoutAgentProvider } from './agent-panel';
import type { RoomLayout } from '../lib/types';
import type { WorkbenchMode } from '../lib/workbench-mode';

const state = vi.hoisted(() => ({
  layout: null as unknown as RoomLayout,
  apply: vi.fn(),
  view: null as unknown,
  setView: vi.fn(),
}));

const studioMock = vi.hoisted(() => ({
  exportActivity: vi.fn(async () => {}),
  generate: vi.fn(async () => {}),
  discardPreview: vi.fn(),
  setBrief: vi.fn(),
  brief: { event: null as string | null, guests: null as number | null },
  preview: null as unknown,
  stale: false,
  expired: false,
  busy: false,
  connection: '离线引导',
}));

vi.mock('../contexts', () => ({
  useRoomEditor: () => ({
    layout: state.layout,
    activeFloor: state.layout.floors[0],
    activeFloorIndex: 0,
    actions: { applyLayout: state.apply, setFloorPlan: vi.fn() },
    view: state.view,
    setView: state.setView,
    collidingIds: new Set<string>(),
  }),
}));
vi.mock('./creative-studio', () => ({ useStudioAgent: () => studioMock }));

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
  state.setView = vi.fn();
  callbacks.workbenchMode = 'layout';
  for (const callback of Object.values(callbacks)) if (typeof callback === 'function') callback.mockClear();
  studioMock.exportActivity.mockReset(); studioMock.exportActivity.mockResolvedValue(undefined);
  studioMock.generate.mockReset(); studioMock.generate.mockResolvedValue(undefined);
  studioMock.discardPreview.mockClear(); studioMock.setBrief.mockClear();
  studioMock.brief = { event: null, guests: null };
  studioMock.preview = null; studioMock.stale = false; studioMock.expired = false; studioMock.busy = false;
  localStorage.clear();
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
    const storageBefore = JSON.stringify({ ...localStorage });

    fireEvent.click(screen.getByRole('button', { name: /按这条改：把靠边的桌椅往场中挪/ }));
    expect(await screen.findByText('改法预览')).toBeTruthy();
    expect(screen.getByText(/只挪位置，其他没动 · 挪了 2 件/)).toBeTruthy();
    // T-UI：n/4 向导进度条已隐藏，右栏不再出现「第几步/共四步」的读数。
    expect(screen.queryByText(/\d\/4/)).toBeNull();
    await waitFor(() => expect(onPreview).toHaveBeenCalled());
    const previewed = onPreview.mock.calls.at(-1)![0] as RoomLayout;
    expect(previewed.floors[0]!.items.find(item => item.id === 'seat')!.position!.x).toBeLessThan(3.35);
    expect(onApply).not.toHaveBeenCalled();
    expect(JSON.stringify(state.layout)).toBe(before);
    expect(JSON.stringify({ ...localStorage })).toBe(storageBefore);

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

  it('keeps the left rail at exactly the three workbench modes', async () => {
    const { WORKBENCH_MODES } = await import('../lib/workbench-mode');
    expect(WORKBENCH_MODES.map(mode => mode.id)).toEqual(['layout', 'review', 'delivery']);
    expect(WORKBENCH_MODES.map(mode => mode.label)).toEqual(['布置', '评审', '执行']);
  });

  it('renders the activity brief as read-only facts from the conversation', () => {
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}><AgentPanel/><ActivityBrief tools={[]}/></LayoutAgentProvider>);
    const brief = screen.getByLabelText('活动简报');
    expect(within(brief).getByText('来自对话')).toBeTruthy();
    expect(within(brief).getAllByText('还没说').length).toBeGreaterThan(0);
    expect(within(brief).queryByRole('textbox')).toBeNull();
    expect(within(brief).queryByRole('button')).toBeNull();
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
