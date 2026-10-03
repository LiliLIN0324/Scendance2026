// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { loadScenePreset } from '../three/scene-presets';
import { ScenePresetsPanel } from './scene-presets-panel';
import type { RoomLayout } from '../lib/types';

vi.mock('../three/scene-presets', () => ({ loadScenePreset: vi.fn() }));
const next: RoomLayout = { ...INITIAL_LAYOUT, scenePreset: 'popup', name: '青序 · 香氛快闪' };
beforeEach(() => { vi.mocked(loadScenePreset).mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const load = () => fireEvent.click(screen.getByRole('button', { name: /青序 · 香氛快闪/ }));

it('opens the selected preset once and permits loading it again', async () => {
  vi.mocked(loadScenePreset).mockResolvedValue(next);
  const apply = vi.fn();
  render(<ScenePresetsPanel layout={INITIAL_LAYOUT} onApply={apply}/>);
  await act(async () => { load(); load(); });
  expect(loadScenePreset).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith(next);
  await act(async () => { load(); });
  expect(apply).toHaveBeenCalledTimes(2);
});

it('preserves the draft when confirmation is declined or download fails', async () => {
  const apply = vi.fn();
  const populated = { ...INITIAL_LAYOUT, floors: [{ ...INITIAL_LAYOUT.floors[0], items: [{ id: 'existing' }] }] } as RoomLayout;
  render(<ScenePresetsPanel layout={populated} onApply={apply}/>);
  vi.mocked(window.confirm).mockReturnValue(false);
  load(); expect(loadScenePreset).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  vi.mocked(loadScenePreset).mockRejectedValue(new Error('模型下载失败'));
  await act(async () => { load(); });
  expect(screen.getByRole('status').textContent).toContain('模型下载失败');
  expect(apply).not.toHaveBeenCalled();
});

it('does not replace edits made while loading', async () => {
  let finish!: (layout: RoomLayout) => void;
  vi.mocked(loadScenePreset).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const apply = vi.fn();
  const { rerender } = render(<ScenePresetsPanel layout={INITIAL_LAYOUT} onApply={apply}/>);
  load();
  rerender(<ScenePresetsPanel layout={{ ...INITIAL_LAYOUT, name: '正在编辑的草稿' }} onApply={apply}/>);
  await act(async () => { finish(next); });
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('已保留当前草稿');
});

it('does not apply a late load after leaving the presets panel', async () => {
  let finish!: (layout: RoomLayout) => void;
  vi.mocked(loadScenePreset).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const apply = vi.fn();
  const { unmount } = render(<ScenePresetsPanel layout={INITIAL_LAYOUT} onApply={apply}/>);
  load(); unmount();
  await act(async () => { finish(next); });
  expect(apply).not.toHaveBeenCalled();
});
