// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentLoad, environmentLoadRatio } from './environment-load';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('环境铺开进度', () => {
  it('只认 0 到 1 的有限数', () => {
    expect(environmentLoadRatio(undefined)).toBeUndefined();
    expect(environmentLoadRatio(Number.NaN)).toBeUndefined();
    expect(environmentLoadRatio(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(environmentLoadRatio(-0.2)).toBe(0);
    expect(environmentLoadRatio(1.4)).toBe(1);
    expect(environmentLoadRatio(0.42)).toBe(0.42);
  });
});

describe('环境预览加载标记', () => {
  it('没在取回时不占画布', () => {
    render(<EnvironmentLoad active={false} name="" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('取回中有状态、场景名，长度未知时进度条在扫而不是停在 0', () => {
    render(<EnvironmentLoad active name="小型发布会场地" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('正在铺开环境「小型发布会场地」');
    expect(screen.getByText('小型发布会场地')).toBeTruthy();
    expect(screen.getByText('正在取回高斯')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.querySelector('.sc-env-load-fill')?.className).toContain('is-unknown');
  });

  it('有下载比例时绿条跟上，不再空扫', () => {
    render(<EnvironmentLoad active name="云E2E·宴会厅文生" progress={0.4} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    const fill = bar.querySelector('.sc-env-load-fill') as HTMLElement;
    expect(fill.className).not.toContain('is-unknown');
    expect(fill.style.width).toBe('40%');
    expect(screen.getByText('40%')).toBeTruthy();
  });

  it('0% 仍算还没动，避免一条死灰线', () => {
    render(<EnvironmentLoad active name="样例" progress={0} />);
    expect(screen.getByRole('progressbar').querySelector('.is-unknown')).toBeTruthy();
  });

  it('名字空着时退回高斯场景', () => {
    render(<EnvironmentLoad active name="  " />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toContain('高斯场景');
  });

  it('铺开完成后淡出再卸掉，不会停在画布上', () => {
    vi.useFakeTimers();
    const view = render(<EnvironmentLoad active name="小型发布会场地" progress={0.2} />);
    view.rerender(<EnvironmentLoad active={false} name="小型发布会场地" progress={1} />);
    expect(screen.getByRole('status').className).toContain('is-leaving');
    act(() => { vi.advanceTimersByTime(279); });
    expect(screen.queryByRole('status')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
