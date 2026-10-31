// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import { SpacePanel } from './space-panel';
import type { RoomLayout } from '../lib/types';

vi.mock('../three/scene-presets', () => ({ loadScenePreset: vi.fn() }));

afterEach(() => { cleanup(); localStorage.clear(); });

function environment(preview: SplatPreviewState = { status: 'idle', assetId: '', name: '' }) {
  return { preview, onStart: vi.fn(), onStop: vi.fn() };
}

describe('SpacePanel', () => {
  it('hosts scene templates and environment preview, and starts a blank space', () => {
    const onApply = vi.fn();
    render(<SpacePanel layout={INITIAL_LAYOUT} onApply={onApply} environment={environment()}/>);
    expect(screen.getByRole('heading', { name: '场景模板' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '场景模板' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '环境预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /空白空间/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    const next = onApply.mock.calls[0]![0] as RoomLayout;
    expect(next.width).toBe(12);
    expect(next.height).toBe(8);
  });

  it('lists environment cards here instead of inside materials', async () => {
    const preview = environment();
    rememberAholoAsset({ assetId: '00000000-0000-4000-8000-000000000000', kind: 'spz', name: '午后咖啡馆', bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} onApply={vi.fn()} environment={preview}/>);
    const card = await screen.findByRole('button', { name: '预览午后咖啡馆' });
    expect(screen.getByRole('button', { name: '预览小型发布会场地（样例·非本场）' })).toBeTruthy();
    fireEvent.click(card);
    expect(preview.onStart).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000000');
  });
});
