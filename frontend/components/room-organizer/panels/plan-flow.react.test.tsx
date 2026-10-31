// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { PlanHome, PlanPlates, isPlanHome, materialRows, planGenerateSentence } from './plan-flow';

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

  it('treats plates as views of one plan', () => {
    const onExport = vi.fn();
    render(<PlanPlates items={[{ name: '共创桌' }, { name: '共创桌' }, { name: '活动座椅' }]} areaLabel="80 ㎡" onExport={onExport} />);
    const layoutTab = screen.getByRole('tab', { name: '布置' });
    expect(layoutTab.getAttribute('aria-selected')).toBe('true');
    expect(layoutTab.querySelector('svg')).toBeTruthy();
    expect(layoutTab.textContent).toBe('');
    expect(screen.queryByRole('tabpanel')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '物料' }));
    expect(screen.getByText('共创桌')).toBeTruthy();
    expect(materialRows([{ name: '共创桌' }, { name: '共创桌' }])).toEqual([{ name: '共创桌', count: 2 }]);
    fireEvent.click(screen.getByRole('tab', { name: '执行资料' }));
    expect(screen.getByText('3 件 · 80 ㎡')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '导出交接' }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '导出交接' }).className).not.toContain('btn-primary');
  });

  it('shows the home only before a plan exists', () => {
    expect(isPlanHome('empty', INITIAL_LAYOUT, false)).toBe(true);
    expect(isPlanHome('planProposed', INITIAL_LAYOUT, true)).toBe(false);
    expect(isPlanHome('empty', { ...INITIAL_LAYOUT, width: 12 }, false)).toBe(false);
    expect(isPlanHome('generating', INITIAL_LAYOUT, false)).toBe(false);
  });
});
