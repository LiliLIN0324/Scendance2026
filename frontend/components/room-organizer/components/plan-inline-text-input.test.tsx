// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanInlineTextInput } from './plan-inline-text-input';

/**
 * 2026-11-20 审计 K2：名字框「一次改名 = 一条 undo」。
 * 这些用例锁的是提交时机：输入中不写 plan，失焦/回车各提交一次，内容没变不提交。
 */
const field = () => screen.getByRole('textbox') as HTMLInputElement;

afterEach(cleanup);

describe('PlanInlineTextInput · 名字草稿提交', () => {
  it('输入过程中不提交，失焦时只提交一次', () => {
    const commit = vi.fn();
    render(<PlanInlineTextInput ariaLabel="设施名称" value="旧名" onCommit={commit} />);
    for (const value of ['桁', '桁架', '桁架 A']) fireEvent.change(field(), { target: { value } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.blur(field());
    expect(commit).toHaveBeenCalledExactlyOnceWith('桁架 A');
  });

  it('回车提交并失焦，不会因失焦再提交一次', () => {
    const commit = vi.fn();
    render(<PlanInlineTextInput ariaLabel="设施名称" value="旧名" onCommit={commit} />);
    fireEvent.change(field(), { target: { value: '展位' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    fireEvent.blur(field());
    expect(commit).toHaveBeenCalledExactlyOnceWith('展位');
  });

  it('中文输入法组合中的回车不算提交', () => {
    const commit = vi.fn();
    render(<PlanInlineTextInput ariaLabel="设施名称" value="旧名" onCommit={commit} />);
    fireEvent.change(field(), { target: { value: 'zhanwei' } });
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    expect(commit).not.toHaveBeenCalled();
  });

  it('内容没变就不提交（同一次改名只占一条历史）', () => {
    const commit = vi.fn();
    render(<PlanInlineTextInput ariaLabel="设施名称" value="旧名" onCommit={commit} />);
    fireEvent.focus(field());
    fireEvent.blur(field());
    expect(commit).not.toHaveBeenCalled();
  });

  it('清空后失焦回到上一个有效名，不提交空名', () => {
    const commit = vi.fn();
    render(<PlanInlineTextInput ariaLabel="分区名" value="签到区" onCommit={commit} />);
    fireEvent.change(field(), { target: { value: '   ' } });
    fireEvent.blur(field());
    expect(commit).not.toHaveBeenCalled();
    expect(field().value).toBe('签到区');
  });

  it('Esc 放弃这次改名', () => {
    const commit = vi.fn();
    render(<PlanInlineTextInput ariaLabel="分区名" value="签到区" onCommit={commit} />);
    fireEvent.change(field(), { target: { value: '不想要' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(commit).not.toHaveBeenCalled();
    expect(field().value).toBe('签到区');
  });

  it('外部值变化（撤销/换选中）时同步草稿', () => {
    const commit = vi.fn();
    const ui = render(<PlanInlineTextInput ariaLabel="分区名" value="A" onCommit={commit} />);
    fireEvent.change(field(), { target: { value: '正在打' } });
    ui.rerender(<PlanInlineTextInput ariaLabel="分区名" value="B" onCommit={commit} />);
    expect(field().value).toBe('B');
    expect(commit).not.toHaveBeenCalled();
  });
});
