// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { presetModelUrl } from '../lib/scene-presets';
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
  recoverable: false,
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
  studioMock.recoverable = false;
  studioMock.connection = '离线引导';
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
    // 无眉题头：左栏 Tab 已标明位置，卡片直接以活动名开场。
    expect(within(brief).queryByText('来自对话')).toBeNull();
    expect(within(brief).getAllByText('还没说').length).toBeGreaterThan(0);
    expect(within(brief).queryByRole('textbox')).toBeNull();
    // 只有两条空地文字链：简报仍然是只读事实，不在左栏摆表单。
    const actions = within(brief).getAllByRole('button');
    expect(actions).toHaveLength(2);
    expect(actions[0]!.textContent).toContain('空白场地');
    expect(actions[1]!.textContent).toContain('从地图圈画户外场地');
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

    fireEvent.click(within(brief).getByRole('button', { name: /空白场地 · 12 × 8 m/ }));
    expect(await screen.findByText(/空白场地立好了：12 × 8 m/)).toBeTruthy();
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
