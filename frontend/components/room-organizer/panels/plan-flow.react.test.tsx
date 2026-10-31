// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { PlanFlow, PlanHome, isPlanHome, planGenerateSentence } from './plan-flow';

vi.mock('../contexts', () => ({
  useRoomEditor: () => ({ layout: { width: 18, height: 12 }, activeFloor: { items: [] } }),
}));
vi.mock('./agent-panel', () => ({
  useAgent: () => ({ state: 'planReady', proposal: { id: 'plan' }, send: vi.fn() }),
}));

afterEach(() => { cleanup(); });

describe('plan flow v2', () => {
  it('keeps the first screen to cards, chips, and one generate verb', () => {
    const onGenerate = vi.fn();
    render(<PlanHome onGenerate={onGenerate} />);
    const generate = screen.getByRole('button', { name: '生成方案' }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(generate.className).not.toContain('btn-primary');
    expect(screen.queryByRole('tab', { name: '布置' })).toBeNull();
    expect(screen.queryByText(/Scene|Object|Compose|WorldGen|Meshy|Spline/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '发布会' }));
    fireEvent.click(screen.getByRole('button', { name: '室内 12×9' }));
    fireEvent.click(screen.getByRole('button', { name: '80 人' }));
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);
    expect(onGenerate).toHaveBeenCalledWith('80 人发布会，室内 12×9，出方案');
    expect(planGenerateSentence('发布会', '室内 12×9', 80)).toBe('80 人发布会，室内 12×9，出方案');
  });

  it('does not mount a canvas switch for 布置 / 物料 / 执行资料 after a plan exists', () => {
    const onHomeChange = vi.fn();
    const { container } = render(<PlanFlow onOpenAgent={vi.fn()} onHomeChange={onHomeChange} />);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.queryByRole('tab', { name: '布置' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '物料' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '执行资料' })).toBeNull();
    expect(onHomeChange).toHaveBeenCalledWith(false);
  });

  it('shows the home only before a plan exists', () => {
    expect(isPlanHome('empty', INITIAL_LAYOUT, false)).toBe(true);
    expect(isPlanHome('planProposed', INITIAL_LAYOUT, true)).toBe(false);
    expect(isPlanHome('empty', { ...INITIAL_LAYOUT, width: 12 }, false)).toBe(false);
    expect(isPlanHome('generating', INITIAL_LAYOUT, false)).toBe(false);
  });
});
