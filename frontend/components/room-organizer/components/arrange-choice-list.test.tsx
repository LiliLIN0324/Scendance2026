// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArrangeChoiceList } from './arrange-choice-list';

afterEach(cleanup);

const choices = [
  { slug: 'chair', name: '礼堂椅', reason: '能力命中 · 场景匹配', count: 12 },
  { slug: 'bench', name: '长凳', reason: '能力命中', count: 12 },
];

describe('候选方案条', () => {
  it('列出型号和理由，点一款、换一批、取消都交给父组件', () => {
    const onPick = vi.fn();
    const onRefresh = vi.fn();
    const onCancel = vi.fn();
    render(<ArrangeChoiceList choices={choices} onPick={onPick} onRefresh={onRefresh} onCancel={onCancel} />);
    expect(screen.getByRole('group', { name: '候选方案' })).toBeTruthy();
    expect(screen.getByText('能力命中 · 场景匹配 · 12 件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '礼堂椅' }));
    fireEvent.click(screen.getByRole('button', { name: '换一批' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onPick).toHaveBeenCalledWith('chair');
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('排布进行中不能再点型号或换一批', () => {
    const onPick = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ArrangeChoiceList
        choices={choices}
        busy
        onPick={onPick}
        onRefresh={onRefresh}
        onCancel={() => undefined}
      />,
    );
    const chair = screen.getByRole('button', { name: '礼堂椅' }) as HTMLButtonElement;
    const refresh = screen.getByRole('button', { name: '换一批' }) as HTMLButtonElement;
    expect(chair.disabled).toBe(true);
    expect(refresh.disabled).toBe(true);
    fireEvent.click(chair);
    fireEvent.click(refresh);
    expect(onPick).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
