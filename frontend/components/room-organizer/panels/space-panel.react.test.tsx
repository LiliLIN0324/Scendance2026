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
  return { preview, current, onSelect: vi.fn(), onClear: vi.fn() };
}

describe('SpacePanel', () => {
  it('hosts scene templates and environment, and starts a blank space', () => {
    const onApply = vi.fn();
    let runNew: (() => void) | undefined;
    render(<SpacePanel layout={INITIAL_LAYOUT} onApply={onApply} onRegisterNew={run => { runNew = run; }}/>);
    expect(screen.getByRole('heading', { name: '场景模板' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '场景模板' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '环境' })).toBeTruthy();
    // 新建空间已收进输入框的 ＋ 菜单，由 chat 栏调用注册进来的动作。
    runNew?.();
    const next = onApply.mock.calls[0]![0] as RoomLayout;
    expect(next.width).toBe(12);
    expect(next.height).toBe(8);
  });

  it('sets a clicked environment item as this venue environment', async () => {
    const preview = environment();
    rememberAholoAsset({ assetId: '00000000-0000-4000-8000-000000000000', kind: 'spz', name: '午后咖啡馆', bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={preview}/>);
    expect(screen.getByLabelText('切换环境')).toBeTruthy();
    const item = (await screen.findAllByRole('menuitemradio')).find(node => node.textContent?.includes('午后咖啡馆'));
    expect(item).toBeTruthy();
    fireEvent.click(item!);
    expect(preview.onSelect).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000000', '午后咖啡馆');
  });

  it('marks the remembered environment as current and can drop it', () => {
    const current = { assetId: '00000000-0000-4000-8000-000000000000', name: '午后咖啡馆' };
    const preview = environment({ status: 'ready', assetId: current.assetId, name: current.name, splats: 1200 }, current);
    rememberAholoAsset({ assetId: current.assetId, kind: 'spz', name: current.name, bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={preview}/>);
    expect(screen.getByRole('button', { name: '当前环境午后咖啡馆' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '不用环境' }));
    expect(preview.onClear).toHaveBeenCalledTimes(1);
  });
});
