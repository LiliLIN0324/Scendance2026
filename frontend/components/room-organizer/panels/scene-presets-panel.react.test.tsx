// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import rehearsalExample from '../../../../docs/examples/30-person-rehearsal-operations.json';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { operationReview } from '../lib/event-operations';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { SCENE_PRESETS, type ScenePresetKey } from '../lib/scene-presets';
import { loadScenePreset } from '../three/scene-presets';
import { ScenePresetsPanel } from './scene-presets-panel';
import type { RoomLayout } from '../lib/types';

vi.mock('../three/scene-presets', () => ({ loadScenePreset: vi.fn() }));
const next: RoomLayout = { ...INITIAL_LAYOUT, scenePreset: 'popup', name: '青序 · 香氛快闪' };
beforeEach(() => { vi.mocked(loadScenePreset).mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const load = () => fireEvent.click(screen.getByRole('button', { name: /青序 · 香氛快闪/ }));

it('does not put review-only examples in the scene library', () => {
  const source=structuredClone(INITIAL_LAYOUT);
  const original=structuredClone(source),apply=vi.fn();
  render(<ScenePresetsPanel layout={source} onApply={apply}/>);
  expect(screen.queryByRole('link',{name:/分享会示例/})).toBeNull();
  expect(screen.queryByRole('link',{name:/Hall D5/})).toBeNull();
  expect(apply).not.toHaveBeenCalled();
  expect(source).toEqual(original);
});

it('offers a preview card for every packaged preset', () => {
  render(<ScenePresetsPanel layout={INITIAL_LAYOUT} onApply={vi.fn()}/>);
  const keys = Object.keys(SCENE_PRESETS) as ScenePresetKey[];
  expect(keys).toHaveLength(10);
  for (const key of keys) {
    const card = screen.getByRole('button', { name: new RegExp(SCENE_PRESETS[key].name) });
    expect(card.querySelector('img')?.getAttribute('src')).toBe(`/scene-presets/${key}/preview.jpg`);
    expect(card.getAttribute('title')).toBe(SCENE_PRESETS[key].description);
  }
});

it('puts the blank venue first and loads a 12 × 8 m editable shell without a preset', () => {
  const apply = vi.fn();
  render(<ScenePresetsPanel layout={INITIAL_LAYOUT} onApply={apply}/>);
  const first = document.querySelector('.sc-preset-rail .sc-preset-tile');
  expect(first?.textContent).toContain('空白空间');

  fireEvent.click(screen.getByRole('button', { name: '载入空白空间 12 × 8 米' }));
  expect(loadScenePreset).not.toHaveBeenCalled();
  const next = apply.mock.calls[0]![0] as RoomLayout;
  expect(next.width).toBe(12);
  expect(next.height).toBe(8);
  expect(next.scenePreset).toBeUndefined();
  expect(next.backendSceneV2?.structure.walls).toHaveLength(4);
  expect(next.name).toBe(INITIAL_LAYOUT.name);
  expect(next.floors[0]?.items.filter(item => !item.structuralOpeningId && !item.structuralColumnId && !item.venueEntranceId)).toHaveLength(0);
  expect(screen.queryByRole('status')).toBeNull();
});

it('replaces a worked-on layout with a blank shell without an extra confirm', () => {
  const apply = vi.fn();
  const populated = { ...INITIAL_LAYOUT, floors: [{ ...INITIAL_LAYOUT.floors[0], items: [{ id: 'existing' }] }] } as RoomLayout;
  render(<ScenePresetsPanel layout={populated} onApply={apply}/>);
  fireEvent.click(screen.getByRole('button', { name: '载入空白空间 12 × 8 米' }));
  expect(screen.queryByRole('group', { name: '确认换成空白空间' })).toBeNull();
  const next = apply.mock.calls[0]![0] as RoomLayout;
  expect(next.floors[0]?.items.some(item => item.id === 'existing')).toBe(false);
  expect(next.width).toBe(12);
});

it('arms a scene venue on the current outdoor map instead of replacing the layout', () => {
  const apply = vi.fn();
  const onPlace = vi.fn(() => true);
  render(<ScenePresetsPanel layout={INITIAL_LAYOUT} onApply={apply} onPlace={onPlace}/>);
  expect(screen.queryByRole('button', { name: /空白空间/ })).toBeNull();
  const card = screen.getByRole('button', { name: '摆放模板 青序 · 香氛快闪' });
  expect(card.getAttribute('title')).toContain('摆放到当前地图');
  fireEvent.click(card);
  expect(onPlace).toHaveBeenCalledWith('popup');
  expect(loadScenePreset).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

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

it('loads a preset directly on a worked-on layout and reports a failed load', async () => {
  const apply = vi.fn();
  const populated = { ...INITIAL_LAYOUT, floors: [{ ...INITIAL_LAYOUT.floors[0], items: [{ id: 'existing' }] }] } as RoomLayout;
  render(<ScenePresetsPanel layout={populated} onApply={apply}/>);
  vi.mocked(loadScenePreset).mockRejectedValue(new Error('模型下载失败'));
  await act(async () => { load(); });
  expect(screen.queryByRole('group', { name: /确认载入/ })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('模型下载失败');
  expect(apply).not.toHaveBeenCalled();
  vi.mocked(loadScenePreset).mockResolvedValue(next);
  await act(async () => { load(); });
  expect(apply).toHaveBeenCalledWith(next);
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

it('keeps the activity identity and all task records when a template replaces its objects', async () => {
  const operations = eventOperationsSchema.parse(rehearsalExample);
  operations.tasks[1]!.objectIds = ['old-table'];
  operations.tasks[1]!.actualStartedAt = '2026-10-08T09:05:00+08:00';
  operations.tasks[1]!.evidenceNote = '独立演练记录，非真实现场检查';
  const productionPlan=productionPlanSchema.parse({dataKind:'rehearsal',acquisitions:[{id:'00000000-0000-4000-8000-000000000020',title:'演练取得计划',objectIds:['old-table'],taskIds:[operations.tasks[1]!.id],sourceNote:'人工演练依据'}]});
  const previous = makeLayout({ id: 'rehearsal-activity', name: '独立演练活动', eventOperations: operations, productionPlan,
    floors: [makeFloor({ items: [makeItem({ id: 'old-table', handoff: { ownerName: '演练场务', dueDate: '', acceptance: '',
      status: 'doing', evidenceNote: '原物件的演练说明', evidenceUrls: [] } })] })] });
  const replacement = makeLayout({ name: '模板资源', scenePreset: 'popup',
    floors: [makeFloor({ items: [makeItem({ id: 'template-table' })] })] });
  vi.mocked(loadScenePreset).mockResolvedValue(replacement);
  const apply = vi.fn();
  render(<ScenePresetsPanel layout={previous} onApply={apply}/>);
  await act(async () => { load(); });
  const restored = apply.mock.calls[0]![0] as RoomLayout;
  expect(restored.id).toBe(previous.id); expect(restored.name).toBe(previous.name);
  expect(restored.eventOperations).toBe(operations);
  expect(restored.productionPlan).toBe(productionPlan);expect(restored.productionPlan!.acquisitions[0]!.objectIds).toEqual(['old-table']);
  expect(restored.eventOperations!.tasks).toHaveLength(6);
  expect(restored.floors[0]!.items[0]!).not.toHaveProperty('handoff');
  expect(await operationReview(restored, restored.eventOperations!.tasks[1]!)).toMatchObject({
    status: 'needs_review', missingObjectIds: ['old-table'],
  });
  expect(previous.floors[0]!.items[0]!.handoff?.evidenceNote).toBe('原物件的演练说明');
});
