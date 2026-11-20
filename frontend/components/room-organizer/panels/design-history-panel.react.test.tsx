// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { designSnapshot } from '../lib/scene-layers';
import { DesignHistoryPanel } from './design-history-panel';
import type { DesignVariant, RoomLayout } from '../lib/types';

function layoutWith(variants: DesignVariant[], activeId: string): RoomLayout {
  return { ...structuredClone(INITIAL_LAYOUT), designBook: { activeId, variants } };
}

function baselineVariant(): DesignVariant {
  return { id: 'original', name: '原始方案', layout: designSnapshot(structuredClone(INITIAL_LAYOUT)) };
}

describe('DesignHistoryPanel', () => {
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
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
    const manual = { id: 'snap-1', name: '过程态一', layout: designSnapshot(structuredClone(INITIAL_LAYOUT)), origin: 'manual' as const, savedAt: '2026-11-20T09:00:00.000Z' };
    const layout = layoutWith([baselineVariant(), manual], 'original');
    const onApply = vi.fn();
    render(<DesignHistoryPanel layout={layout} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '载入这一版' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0].designBook!.activeId).toBe('snap-1');
  });

  it('removes a non-active, non-baseline snapshot', () => {
    const manual = { id: 'snap-1', name: '过程态一', layout: designSnapshot(structuredClone(INITIAL_LAYOUT)), origin: 'manual' as const, savedAt: '2026-11-20T09:00:00.000Z' };
    const layout = layoutWith([baselineVariant(), manual], 'original');
    const onApply = vi.fn();
    render(<DesignHistoryPanel layout={layout} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0].designBook!.variants.map((v: DesignVariant) => v.id)).toEqual(['original']);
  });

  it('marks the active design and hides load/remove for baseline and active rows', () => {
    const active = { id: 'snap-active', name: '当前过程态', layout: designSnapshot(structuredClone(INITIAL_LAYOUT)), origin: 'manual' as const };
    const layout = layoutWith([baselineVariant(), active], 'snap-active');
    render(<DesignHistoryPanel layout={layout} onApply={vi.fn()} />);
    expect(screen.getAllByText('当前方案')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '载入这一版' })).toBeNull();
    expect(screen.queryByRole('button', { name: '移除' })).toBeNull();
  });
});
