// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { readOutdoorProjectRecord } from '../lib/outdoor-project-store';
import { onOutdoorProjectSwitch } from '../lib/outdoor-project-switch';
import { REPLICA_CASES } from '../lib/replica-cases';
import { SpacePanel } from './space-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';

vi.mock('../three/scene-presets', () => ({ loadScenePreset: vi.fn() }));
// 空间卡现在常驻结构入口；这里只要给它一份最小壳体，不验证结构交互。
const structureContext = vi.hoisted(() => ({
  layout: { name: '普通壳体', width: 10, height: 8, floors: [{ id: 'ground', name: '活动场地', height: 3, items: [] }] },
  commitNow: () => {},
}));
vi.mock('../contexts', () => ({
  useRoomEditor: () => ({ layout: structureContext.layout, actions: {}, history: { commitNow: structureContext.commitNow } }),
  useSelection: () => ({ selectOnly: () => {} }),
}));

afterEach(() => { cleanup(); localStorage.clear(); });

function environment(preview: SplatPreviewState = { status: 'idle', assetId: '', name: '' }, current: StoredEnvironment | null = null, thumbnails?: Readonly<Record<string, string>>) {
  return { preview, current, environments: current ? [current] : [], floors: [{ id: 'ground', name: '活动场地' }], onSelect: vi.fn(), onRemove: vi.fn(), onSetFloor: vi.fn(), onClear: vi.fn(), ...(thumbnails ? { thumbnails } : {}) };
}

describe('SpacePanel', () => {
  it('puts real venues first and folds secondary actions', () => {
    const onApply = vi.fn();
    render(<SpacePanel layout={INITIAL_LAYOUT} onApply={onApply}/>);
    expect(screen.getByRole('heading', { name: '真实场地' })).toBeTruthy();
    // 面板打开即自动登记云端扫描库（索引 8 套实景），空库提示只在真没数据时出现
    expect(screen.getByText(/\d+ 套已扫描/)).toBeTruthy();
    expect(screen.queryByText('用手机拍一段场地')).toBeNull();
    expect(screen.getByText('场景模板').closest('details')?.open).toBe(false);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('lists scanned venues with size and time, and applies one on click', () => {
    const preview = environment();
    const onPickScan = vi.fn();
    rememberAholoAsset({
      assetId: '00000000-0000-4000-8000-000000000000', kind: 'spz', name: '午后咖啡馆', bytes: 20_000_000,
      savedAt: Date.UTC(2026, 10, 4), meters: { width: 12.4, depth: 8.6, height: 4.2 },
    });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={preview} onPickScan={onPickScan}/>);
    expect(screen.queryByText('还没有已扫描的真实场地')).toBeNull();
    const item = screen.getByLabelText('应用真实场地 午后咖啡馆');
    expect(screen.getByText(/12\.4 × 8\.6 m/)).toBeTruthy();
    // 没有截到止帧就不假扮缩略图：收成可点的索引行，名称与尺寸照常可见。
    expect(item.classList.contains('sc-scan-row')).toBe(true);
    expect(item.querySelector('img')).toBeNull();
    expect(document.querySelector('.sc-scan-card-shot')).toBeNull();
    expect(item.textContent).toContain('12.4 × 8.6 m');
    fireEvent.click(item);
    expect(onPickScan).toHaveBeenCalledWith(expect.objectContaining({
      assetId: '00000000-0000-4000-8000-000000000000',
      name: '午后咖啡馆',
      meters: { width: 12.4, depth: 8.6, height: 4.2 },
    }));
    // 演示场景仍留在环境切换里，不混进真实场地列表。
    expect(screen.queryByLabelText(/应用真实场地 .*宴会厅 A/)).toBeNull();
  });

  it('shows the captured cover as a large frame when one exists', () => {
    const assetId = '00000000-0000-4000-8000-000000000002';
    const cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==';
    rememberAholoAsset({ assetId, kind: 'spz', name: '有封面的场地', bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={environment(undefined, null, { [assetId]: cover })} onPickScan={vi.fn()}/>);
    const frame = screen.getByLabelText('应用真实场地 有封面的场地');
    expect(frame.classList.contains('sc-scan-card')).toBe(true);
    expect(frame.querySelector('img')?.getAttribute('src')).toBe(cover);
  });

  it('marks the remembered environment as current and can remove it', () => {
    const current = { assetId: '00000000-0000-4000-8000-000000000000', name: '午后咖啡馆' };
    const preview = environment({ status: 'ready', assetId: current.assetId, name: current.name, splats: 1200 }, current);
    rememberAholoAsset({ assetId: current.assetId, kind: 'spz', name: current.name, bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={preview} currentScanId={current.assetId}/>);
    expect(screen.getByLabelText('应用真实场地 午后咖啡馆').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('更多场地选项'));
    fireEvent.click(screen.getByText('项目中的场景'));
    fireEvent.click(screen.getByRole('button', { name: '移除午后咖啡馆' }));
    expect(preview.onRemove).toHaveBeenCalledWith(current.assetId);
  });

  // 2026-11-17 用户：「是不是上面的应该放在下面」「项目中的场景这玩意根本就不重要啊」
  // ＋「经典案例我要的也是和其他的视觉一样的卡片预览图」。
  it('card：案例与模板库在前、实景扫描在后，项目中的场景不再占位', () => {
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} onAddSampleScene={vi.fn()} variant="card"/>);
    const labels = [...document.querySelectorAll('details.sc-scene-group')]
      .map(group => group.querySelector('.sc-scene-group-label')?.textContent);
    expect(labels[0]).toBe('经典案例');
    expect(labels).not.toContain('项目中的场景');
    expect(labels[labels.length - 1]).toBe('我的实景扫描');
    // 2026-11-17 用户：「每次打开都默认打开了示例场景和我的实景扫描……默认都不要打开」——
    // 这两段从收起起步；展开与否交给用户点。
    for (const label of ['示例场景', '我的实景扫描']) {
      const group = [...document.querySelectorAll('details.sc-scene-group')]
        .find(node => node.querySelector('.sc-scene-group-label')?.textContent === label) as HTMLDetailsElement | undefined;
      expect(group, `${label} 分类行应该在`).toBeTruthy();
      expect(group!.open).toBe(false);
    }
    // 收起时不建卡（44 案各自要算一遍方案，懒挂载）。
    expect(document.querySelectorAll('.sc-space-cases .sc-space-sample').length).toBe(0);
    const group = document.querySelector('[data-testid="space-group-cases"]') as HTMLDetailsElement;
    group.open = true;
    fireEvent(group, new Event('toggle'));
    const cards = document.querySelectorAll('[data-testid="space-group-cases"] .sc-space-sample');
    expect(cards.length).toBe(REPLICA_CASES.length);
    expect(cards[0].querySelector('svg.sc-case-thumb')).toBeTruthy();
    expect(cards[0].textContent).toContain(REPLICA_CASES[0].title);
  });

  // 2026-11-17 用户：「切换经典案例不要直接白屏刷新重置……就按不换页改」——
  // 打开案例 = 写本机记录 + 请工作台就地换 project id；不再交给整页跳。
  it('card：打开经典案例先写本机记录，再请工作台同页切换', () => {
    const switched: string[] = [];
    const off = onOutdoorProjectSwitch(id => { switched.push(id); return true; });
    try {
      render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} variant="card"/>);
      const group = document.querySelector('[data-testid="space-group-cases"]') as HTMLDetailsElement;
      group.open = true;
      fireEvent(group, new Event('toggle'));
      const card = document.querySelector('[data-testid="space-group-cases"] .sc-space-sample') as HTMLElement;
      fireEvent.click(card);
      const expected = `replica-${REPLICA_CASES[0].id}`;
      expect(switched).toEqual([expected]);
      expect(readOutdoorProjectRecord(expected)?.name).toBe(`经典案例 · ${REPLICA_CASES[0].title}`);
    } finally {
      off();
    }
  });
});
