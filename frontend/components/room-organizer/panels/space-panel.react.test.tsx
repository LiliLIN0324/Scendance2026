// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { SpacePanel } from './space-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';
import type { RoomLayout } from '../lib/types';

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

function environment(preview: SplatPreviewState = { status: 'idle', assetId: '', name: '' }, current: StoredEnvironment | null = null) {
  return { preview, current, environments: current ? [current] : [], floors: [{ id: 'ground', name: '活动场地' }], onSelect: vi.fn(), onRemove: vi.fn(), onSetFloor: vi.fn(), onClear: vi.fn() };
}

describe('SpacePanel', () => {
  it('shows the real-venue entry with an honest empty state, and hosts templates in traditional', () => {
    const onApply = vi.fn();
    let runNew: (() => void) | undefined;
    render(<SpacePanel layout={INITIAL_LAYOUT} onApply={onApply} onRegisterNew={run => { runNew = run; }}/>);
    expect(screen.getByRole('heading', { name: '真实场地' })).toBeTruthy();
    // 空态=引导去采集引导页（对齐 c754e59 之后的「拍摄场地」链接），不再假装「还没有已扫描」。
    expect(screen.getByText('用手机拍一段场地')).toBeTruthy();
    const capture = screen.getByText('拍摄场地') as HTMLAnchorElement;
    expect(capture.getAttribute('href')).toBe('/guide/capture');
    // 默认 aholo 分支：未传 environment 时显示「当前环境」占位。
    expect(screen.getByRole('heading', { name: '当前环境' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /传统空间/ }));
    expect(screen.getByRole('heading', { name: '场景模板' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '环境' })).toBeTruthy();
    // 新建空间已收进输入框的 ＋ 菜单，由 chat 栏调用注册进来的动作。
    runNew?.();
    const next = onApply.mock.calls[0]![0] as RoomLayout;
    expect(next.width).toBe(12);
    expect(next.height).toBe(8);
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
    fireEvent.click(item);
    expect(onPickScan).toHaveBeenCalledWith(expect.objectContaining({
      assetId: '00000000-0000-4000-8000-000000000000',
      name: '午后咖啡馆',
      meters: { width: 12.4, depth: 8.6, height: 4.2 },
    }));
    // 演示场景仍留在环境切换里，不混进真实场地列表。
    expect(screen.queryByLabelText(/应用真实场地 .*宴会厅 A/)).toBeNull();
  });

  it('marks the remembered environment as current and can remove it', () => {
    const current = { assetId: '00000000-0000-4000-8000-000000000000', name: '午后咖啡馆' };
    const preview = environment({ status: 'ready', assetId: current.assetId, name: current.name, splats: 1200 }, current);
    rememberAholoAsset({ assetId: current.assetId, kind: 'spz', name: current.name, bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={preview} currentScanId={current.assetId}/>);
    expect(screen.getByLabelText('应用真实场地 午后咖啡馆').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '移除午后咖啡馆' }));
    expect(preview.onRemove).toHaveBeenCalledWith(current.assetId);
  });
});
