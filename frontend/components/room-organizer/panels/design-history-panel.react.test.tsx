// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSidecarRef } from '@/lib/sidecar-records';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { designSnapshot } from '../lib/scene-layers';
import { makeFloor, makeItem } from '../lib/__testfixtures__/fixtures';
import type { VariantSaveAsDraft } from '../lib/variant-save-as';
import { DesignHistoryPanel } from './design-history-panel';
import type { DesignVariant, RoomLayout } from '../lib/types';

vi.mock('@/lib/sidecar-records', () => ({ resolveSidecarRef: vi.fn() }));

function layoutWith(variants: DesignVariant[], activeId: string): RoomLayout {
  return { ...structuredClone(INITIAL_LAYOUT), designBook: { activeId, variants } };
}

function baselineVariant(): DesignVariant {
  return { id: 'original', name: '原始方案', layout: designSnapshot(structuredClone(INITIAL_LAYOUT)) };
}

function snapshotLayout() {
  return designSnapshot(structuredClone(INITIAL_LAYOUT));
}

function geometryVariant(id: string, name: string): DesignVariant {
  return {
    id,
    name,
    origin: 'manual',
    savedAt: '2026-11-20T09:00:00.000Z',
    layout: { ...structuredClone(INITIAL_LAYOUT), floors: [makeFloor({ items: [makeItem({ name: '椅子 A' })] })] },
  };
}

function renderWithProvider(layout: RoomLayout, projectId: string) {
  const onApply = vi.fn();
  const onSaveAsVariant = vi.fn();
  const result = render(
    <RoomEditorProvider value={{ projectId } as unknown as RoomEditorContextValue}>
      <DesignHistoryPanel layout={layout} onApply={onApply} onSaveAsVariant={onSaveAsVariant} />
    </RoomEditorProvider>,
  );
  return { onApply, onSaveAsVariant, ...result };
}

function rowById(id: string) {
  return within(document.querySelector(`[data-variant-id="${id}"]`)! as HTMLElement);
}

describe('DesignHistoryPanel', () => {
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.mocked(resolveSidecarRef).mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('saves the current layout as a manual snapshot through onApply', () => {
    const onApply = vi.fn();
    render(<DesignHistoryPanel layout={structuredClone(INITIAL_LAYOUT)} onApply={onApply} />);
    expect(screen.queryByText('还没有存档方案。调整到一个阶段性版本时，先把当前方案存为过程态。')).toBeNull();
    expect(screen.getByText('还没有存档。到阶段版本时存一次。')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('过程态名称'), { target: { value: '迎宾区先落位' } });
    fireEvent.change(screen.getByLabelText('备注（可选）'), { target: { value: '桌距先按 1.2m' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const next = onApply.mock.calls[0]![0];
    expect(next.designBook!.activeId).toBe('original');
    const snapshot = next.designBook!.variants[next.designBook!.variants.length - 1]!;
    expect(snapshot.origin).toBe('manual');
    expect(snapshot.name).toBe('迎宾区先落位');
    expect(snapshot.note).toBe('桌距先按 1.2m');
    expect(typeof snapshot.savedAt).toBe('string');
  });

  it('loads a non-active snapshot and switches the active design', () => {
    const manual = { id: 'snap-1', name: '过程态一', layout: snapshotLayout(), origin: 'manual' as const, savedAt: '2026-11-20T09:00:00.000Z' };
    const layout = layoutWith([baselineVariant(), manual], 'original');
    const onApply = vi.fn();
    render(<DesignHistoryPanel layout={layout} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '载入这一版' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0].designBook!.activeId).toBe('snap-1');
  });

  it('removes a non-active, non-baseline snapshot', () => {
    const manual = { id: 'snap-1', name: '过程态一', layout: snapshotLayout(), origin: 'manual' as const, savedAt: '2026-11-20T09:00:00.000Z' };
    const layout = layoutWith([baselineVariant(), manual], 'original');
    const onApply = vi.fn();
    render(<DesignHistoryPanel layout={layout} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0].designBook!.variants.map((v: DesignVariant) => v.id)).toEqual(['original']);
  });

  it('marks the active design and hides load/remove for baseline and active rows', () => {
    const active = { id: 'snap-active', name: '当前过程态', layout: snapshotLayout(), origin: 'manual' as const };
    const layout = layoutWith([baselineVariant(), active], 'snap-active');
    render(<DesignHistoryPanel layout={layout} onApply={vi.fn()} />);
    expect(screen.getAllByText('当前方案')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '载入这一版' })).toBeNull();
    expect(screen.queryByRole('button', { name: '移除' })).toBeNull();
  });
});

describe('D6-3-c 历史变体摘要兜底与引用待核', () => {
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.mocked(resolveSidecarRef).mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('legacy variant without refs falls back to the embedded copy: no IDB read, stats pending, not marked stale', () => {
    const legacy: DesignVariant = { id: 'legacy-1', name: '旧方案', layout: snapshotLayout() };
    const layout = layoutWith([baselineVariant(), legacy], 'original');
    renderWithProvider(layout, 'project-c-1');
    expect(resolveSidecarRef).not.toHaveBeenCalled();
    expect(rowById('legacy-1').getByText('统计待核')).toBeTruthy();
    expect(rowById('legacy-1').queryByText('原方案未找到 / 已变动，待核')).toBeNull();
  });

  it('shows the frozen summary line when present, no pending reference notice', () => {
    const withSummary: DesignVariant = {
      id: 'snap-summary', name: '带摘要方案', layout: snapshotLayout(), origin: 'manual',
      summary: { headcount: 120, taskCount: 3, acquisitionCount: 1, staffingCount: 2, estimateCount: 0, itemCount: 7, chairCount: 3, tableCount: 2, otherItemCount: 2, zoneCount: 2 },
    };
    const layout = layoutWith([baselineVariant(), withSummary], 'original');
    renderWithProvider(layout, 'project-c-2');
    expect(rowById('snap-summary').getByText('120 人 · 7 件物料 · 椅 3 · 桌 2 · 2 区')).toBeTruthy();
    expect(rowById('snap-summary').queryByText('统计待核')).toBeNull();
  });

  it('missing referenced record marks the business facts pending but keeps geometry loadable, no substitution', async () => {
    vi.mocked(resolveSidecarRef).mockResolvedValue({ status: 'missing' } as never);
    const referenced: DesignVariant = {
      id: 'snap-missing', name: '引用已失方案', layout: snapshotLayout(), origin: 'manual',
      operationsRef: '22222222-2222-4222-8222-222222222222',
      planRef: '33333333-3333-4333-8333-333333333333',
      scan: { assetId: 'scan-1' },
    };
    const layout = layoutWith([baselineVariant(), referenced], 'original');
    const { onApply } = renderWithProvider(layout, 'project-c-3');
    await waitFor(() => expect(rowById('snap-missing').getByText('原方案未找到 / 已变动，待核')).toBeTruthy());
    // 几何仍可载入：按钮在、不被待核态挡死。
    fireEvent.click(rowById('snap-missing').getByRole('button', { name: '载入这一版' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0].designBook!.activeId).toBe('snap-missing');
  });

  it('referenced record resolved cleanly shows no stale notice', async () => {
    vi.mocked(resolveSidecarRef).mockResolvedValue({ status: 'record', record: { id: 'r-1', projectId: 'project-c-4', kind: 'operations', data: undefined, savedAt: '2026-11-27' }, data: undefined } as never);
    const referenced: DesignVariant = {
      id: 'snap-ok', name: '引用正常方案', layout: snapshotLayout(), origin: 'manual',
      operationsRef: '22222222-2222-4222-8222-222222222222',
      scan: { assetId: 'scan-1' },
    };
    const layout = layoutWith([baselineVariant(), referenced], 'original');
    renderWithProvider(layout, 'project-c-4');
    await waitFor(() => expect(resolveSidecarRef).toHaveBeenCalled());
    expect(rowById('snap-ok').queryByText('原方案未找到 / 已变动，待核')).toBeNull();
  });

  it('references without scan identity are also marked pending when resolved sidecars are present', async () => {
    vi.mocked(resolveSidecarRef).mockResolvedValue({ status: 'record', record: { id: 'r-2', projectId: 'project-c-5', kind: 'plan', data: undefined, savedAt: '2026-11-27' }, data: undefined } as never);
    const noScan: DesignVariant = {
      id: 'snap-noscan', name: '缺扫描方案', layout: snapshotLayout(), origin: 'manual',
      planRef: '33333333-3333-4333-8333-333333333333',
    };
    const layout = layoutWith([baselineVariant(), noScan], 'original');
    renderWithProvider(layout, 'project-c-5');
    await waitFor(() => expect(rowById('snap-noscan').getByText('原方案未找到 / 已变动，待核')).toBeTruthy());
  });
});

describe('T4 E3 逐变体另存入口', () => {
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.mocked(resolveSidecarRef).mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('clicking save-as builds a draft from geometry and hands it up with the variant', () => {
    const variant = geometryVariant('snap-save', '另存测试');
    const layout = layoutWith([baselineVariant(), variant], 'original');
    const { onSaveAsVariant } = renderWithProvider(layout, 'project-save-1');

    fireEvent.click(rowById('snap-save').getByRole('button', { name: '另存为新场地' }));

    expect(onSaveAsVariant).toHaveBeenCalledTimes(1);
    const [passedVariant, draft] = onSaveAsVariant.mock.calls[0]! as [DesignVariant, VariantSaveAsDraft];
    expect(passedVariant.id).toBe('snap-save');
    expect(draft.draft.name).toBe('另存测试');
    expect(draft.draft.floors[0]!.items).toHaveLength(1);
    expect(draft.draft.id).toBeUndefined();
    expect(draft.draft.eventOperations).toBeUndefined();
    expect(draft.draft.productionPlan).toBeUndefined();
    // 旧变体无 ref：内嵌副本只读，不复制进新记录，两槽标待核。
    expect(draft.sidecarEntries).toEqual([]);
    expect(draft.missingKinds).toEqual(['operations', 'plan']);
  });

  it('keeps the save-as button disabled when no shell handler is bound', () => {
    const variant = geometryVariant('snap-noop', '未接壳方案');
    const layout = layoutWith([baselineVariant(), variant], 'original');
    render(<DesignHistoryPanel layout={layout} onApply={vi.fn()} />);
    expect((rowById('snap-noop').getByRole('button', { name: '另存为新场地' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables save-as for a variant with no placed geometry', () => {
    const empty: DesignVariant = { id: 'snap-empty', name: '空几何方案', layout: snapshotLayout() };
    const layout = layoutWith([baselineVariant(), empty], 'original');
    const { onSaveAsVariant } = renderWithProvider(layout, 'project-save-2');
    expect((rowById('snap-empty').getByRole('button', { name: '另存为新场地' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSaveAsVariant).not.toHaveBeenCalled();
  });
});
