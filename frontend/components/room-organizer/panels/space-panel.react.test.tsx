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

afterEach(() => { cleanup(); localStorage.clear(); });

function environment(preview: SplatPreviewState = { status: 'idle', assetId: '', name: '' }, current: StoredEnvironment | null = null) {
  return { preview, current, onSelect: vi.fn(), onClear: vi.fn() };
}

describe('SpacePanel', () => {
  it('hosts scene templates and environment, and starts a blank space', () => {
    const onApply = vi.fn();
    render(<SpacePanel layout={INITIAL_LAYOUT} onApply={onApply} environment={environment()}/>);
    expect(screen.getByRole('heading', { name: '场景模板' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '场景模板' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '环境' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /空白空间/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    const next = onApply.mock.calls[0]![0] as RoomLayout;
    expect(next.width).toBe(12);
    expect(next.height).toBe(8);
  });

  it('sets a clicked environment card as this venue environment', async () => {
    const preview = environment();
    rememberAholoAsset({ assetId: '00000000-0000-4000-8000-000000000000', kind: 'spz', name: '午后咖啡馆', bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={preview}/>);
    const card = await screen.findByRole('button', { name: '设为环境午后咖啡馆' });
    expect(screen.getByRole('button', { name: '设为环境发布会小厅（样例·非本场）' })).toBeTruthy();
    fireEvent.click(card);
    expect(preview.onSelect).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000000', '午后咖啡馆');
  });

  it('marks the remembered environment as current and can drop it', () => {
    const current = { assetId: '00000000-0000-4000-8000-000000000000', name: '午后咖啡馆' };
    const preview = environment({ status: 'ready', assetId: current.assetId, name: current.name, splats: 1200 }, current);
    rememberAholoAsset({ assetId: current.assetId, kind: 'spz', name: current.name, bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={preview}/>);
    expect(screen.getByText(/当前环境：「午后咖啡馆」/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '设为环境午后咖啡馆' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '不用环境' }));
    expect(preview.onClear).toHaveBeenCalledTimes(1);
  });
});
