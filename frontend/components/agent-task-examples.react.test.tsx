// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskExamples } from './agent-task-examples';

const sentences = ['80 人发布会，室内 12×9', '30 人圆桌晚宴，室内 15×10', '120 人市集，户外 20×14'];
const nameOf = (sentence: string) => `试试这样描述你的活动：${sentence}`;

const mount = (onPick = vi.fn(), onExpand = vi.fn()) => render(<AgentTaskExamples onPick={onPick} onExpand={onExpand} />);

const stubMotionPreference = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: ((query: string) => ({
      matches, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia,
  });
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // jsdom 没有 matchMedia，不能把桩留在后面几个用例里。
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('输入框上方的例句行', () => {
  it('只占一行：一次一句，卡面不带标点，末尾是换能力卡的 ⌄', () => {
    const onExpand = vi.fn();
    const { container } = mount(vi.fn(), onExpand);
    expect(screen.getByRole('group', { name: '需求例句' })).toBeTruthy();
    expect(container.querySelectorAll('.sc-task-example')).toHaveLength(1);
    expect(container.querySelector('.sc-task-example strong')?.textContent).toBe('80 人发布会');
    expect(container.querySelector('.sc-task-example small')?.textContent).toBe('室内 12×9');
    // 这一格里没有独立的「你可以做什么」折叠行，也没有压在下面的补位卡。
    expect(container.querySelector('.sc-task-example-repeat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开你可以做什么' }));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('点这一行把带逗号的完整一句话交给调用方', () => {
    const onPick = vi.fn();
    mount(onPick);
    fireEvent.click(screen.getByRole('button', { name: nameOf(sentences[0]!) }));
    expect(onPick).toHaveBeenCalledWith(sentences[0]);
  });

  it('静止 3.2 秒换下一句，手动暂停后停住', () => {
    stubMotionPreference(false);
    vi.useFakeTimers();
    mount();
    expect(screen.getByRole('button', { name: nameOf(sentences[0]!) })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3300); });
    expect(screen.getByRole('button', { name: nameOf(sentences[1]!) })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '暂停示例轮播' }));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getByRole('button', { name: nameOf(sentences[1]!) })).toBeTruthy();
    expect(screen.getByRole('button', { name: '播放示例轮播' })).toBeTruthy();
  });
});
