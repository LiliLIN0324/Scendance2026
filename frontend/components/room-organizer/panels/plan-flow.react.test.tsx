// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import {
  PLAN_EXAMPLES,
  PlanHome,
  isPlanHome,
  planGenerateFromDraft,
  planGenerateSentence,
  planHeardStatus,
  planSelectionFromText,
} from './plan-flow';

afterEach(() => { cleanup(); });

describe('plan flow v2', () => {
  it('leads with clickable examples instead of chip rows', () => {
    const onPickExample = vi.fn();
    render(<PlanHome onGenerate={vi.fn()} onPickExample={onPickExample} />);
    const examples = screen.getByRole('group', { name: '需求例句' });
    expect(within(examples).getAllByRole('button').map(button => button.textContent)).toEqual([...PLAN_EXAMPLES]);
    expect(screen.queryByRole('button', { name: '发布会' })).toBeNull();
    expect(screen.getByRole('button', { name: '生成方案' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: PLAN_EXAMPLES[0] }));
    expect(onPickExample).toHaveBeenCalledWith(PLAN_EXAMPLES[0]);
  });

  it('echoes a partial draft and asks for what is missing', () => {
    render(<PlanHome draft="30 人圆桌晚宴" onGenerate={vi.fn()} />);
    expect(screen.queryByRole('group', { name: '需求例句' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('30 人 · 圆桌晚宴 · 还差场地多大');
    expect(screen.getByRole('button', { name: '生成方案' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('enables generate from a complete draft sentence', () => {
    const onGenerate = vi.fn();
    render(<PlanHome draft="80 人发布会，室内 12×9" onGenerate={onGenerate} />);
    expect(screen.getByRole('status').textContent).toBe('已听懂：80 人 · 发布会 · 室内 12×9');
    expect(screen.getByRole('button', { name: '生成方案' }).getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
    expect(onGenerate).toHaveBeenCalledWith('80 人发布会，室内 12×9，出方案');
  });

  it('keeps chips behind adjust for correction', () => {
    const onGenerate = vi.fn();
    render(<PlanHome draft="80 人发布会，室内 12×9" onGenerate={onGenerate} />);
    expect(screen.queryByRole('button', { name: '工作坊' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '改类型或人数' }));
    fireEvent.click(screen.getByRole('button', { name: '工作坊' }));
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
    expect(onGenerate).toHaveBeenCalledWith('80 人工作坊，室内 12×9，出方案');
  });

  it('opens adjust when generate is pressed too early', () => {
    render(<PlanHome onGenerate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
    expect(screen.getByRole('status').textContent).toBe('先补齐活动类型、场地多大、人数，再生成方案。');
    expect(screen.getByRole('button', { name: '发布会' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起选项' })).toBeTruthy();
  });

  it('supports custom venue and headcount inside adjust', () => {
    const onGenerate = vi.fn();
    render(<PlanHome onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: '改类型或人数' }));
    fireEvent.click(screen.getByRole('button', { name: '品牌快闪' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义场地' }));
    fireEvent.change(screen.getByLabelText('场地宽度（米）'), { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('场地深度（米）'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '自定义人数' }));
    fireEvent.change(screen.getByLabelText('人数（人）'), { target: { value: '200' } });
    expect(screen.getByRole('status').textContent).toBe('已听懂：200 人 · 快闪 · 16×10 米');
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
    expect(onGenerate).toHaveBeenCalledWith('200 人快闪，16×10 米，出方案');
  });

  it('parses draft helpers and keeps generate sentence helpers', () => {
    expect(planSelectionFromText('80 人发布会，室内 12×9')).toMatchObject({
      activityId: 'launch',
      venueId: 'hall',
      headcount: 80,
      ready: true,
      heardParts: ['80 人', '发布会', '室内 12×9'],
    });
    expect(planSelectionFromText('30 人圆桌晚宴')).toMatchObject({
      activityPhrase: '圆桌晚宴',
      missing: ['场地多大'],
      ready: false,
    });
    expect(planHeardStatus(['30 人', '圆桌晚宴'], ['场地多大'])).toBe('30 人 · 圆桌晚宴 · 还差场地多大');
    expect(planGenerateFromDraft('80 人发布会，室内 12×9')).toBe('80 人发布会，室内 12×9，出方案');
    expect(planGenerateSentence('发布会', '室内 12×9', 80)).toBe('80 人发布会，室内 12×9，出方案');
  });

  it('shows the home only before a plan exists', () => {
    expect(isPlanHome('empty', INITIAL_LAYOUT, false)).toBe(true);
    expect(isPlanHome('planProposed', INITIAL_LAYOUT, true)).toBe(false);
    expect(isPlanHome('empty', { ...INITIAL_LAYOUT, width: 12 }, false)).toBe(false);
    expect(isPlanHome('generating', INITIAL_LAYOUT, false)).toBe(false);
  });
});
