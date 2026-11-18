// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShortcutReference } from './shortcut-reference';

afterEach(cleanup);

describe('ShortcutReference', () => {
  it('renders grouped shortcuts, platform keys and the grid-only caveat', () => {
    render(<ShortcutReference />);
    expect(screen.getByRole('heading', { name: '建造画布 · 编辑' })).toBeTruthy();
    expect(screen.getByText('撤销')).toBeTruthy();
    expect(screen.getAllByText('Ctrl').length).toBeGreaterThan(0);
    expect(screen.getAllByText('⌘').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Z').length).toBeGreaterThan(0);
    expect(screen.getAllByText('或').length).toBeGreaterThan(0);
    expect(screen.getByText('只切网格；墙 / 物件吸附是独立开关')).toBeTruthy();
    expect(screen.getByText('一人称漫游：WASD / 方向键归相机，裸单键关闭；撤销、重做、Esc 仍可用。')).toBeTruthy();
  });

  it('searches by action, key and note, and clears with Escape', () => {
    render(<ShortcutReference />);
    const search = screen.getByRole('searchbox', { name: '搜索快捷键' });

    fireEvent.change(search, { target: { value: 'Ctrl+Z' } });
    expect(screen.getByText('撤销')).toBeTruthy();
    expect(screen.queryByText('删除')).toBeNull();

    fireEvent.change(search, { target: { value: 'cmd' } });
    expect(screen.getAllByText('⌘').length).toBeGreaterThan(0);
    expect(screen.getByText('撤销')).toBeTruthy();

    fireEvent.change(search, { target: { value: 'del' } });
    expect(screen.getByText('删除')).toBeTruthy();

    fireEvent.change(search, { target: { value: '输入框' } });
    expect(screen.getByText('撤销')).toBeTruthy();
    expect(screen.getByText('重做')).toBeTruthy();
    expect(screen.getAllByText('输入框内不拦截').length).toBeGreaterThanOrEqual(2);

    fireEvent.keyDown(search, { key: 'Escape' });
    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByText('删除')).toBeTruthy();
  });

  it('filters by mode and keeps the exception notes searchable', () => {
    render(<ShortcutReference />);

    fireEvent.click(screen.getByRole('button', { name: '户外' }));
    expect(screen.getByRole('heading', { name: '户外规划' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '建造画布 · 编辑' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '例外' }));
    expect(screen.getByText('一人称漫游：WASD / 方向键归相机，裸单键关闭；撤销、重做、Esc 仍可用。')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '建造画布 · 编辑' })).toBeNull();
  });

  it('highlights the selected platform without hiding the other column', () => {
    render(<ShortcutReference />);

    fireEvent.click(screen.getByRole('button', { name: 'macOS' }));
    expect(screen.getByRole('button', { name: 'macOS' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Windows / Linux' }).getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-platform="mac"]')?.classList.contains('is-primary')).toBe(true);
    expect(document.querySelector('[data-platform="win"]')?.classList.contains('is-primary')).toBe(false);
    expect(screen.getAllByText('Ctrl').length).toBeGreaterThan(0);
    expect(screen.getAllByText('⌘').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Z').length).toBeGreaterThan(0);
  });

  it('shows a recoverable empty state and resets search and mode', () => {
    render(<ShortcutReference />);
    const search = screen.getByRole('searchbox', { name: '搜索快捷键' });

    fireEvent.change(search, { target: { value: 'zzzz-no-such-shortcut' } });
    expect(screen.getByText('没有匹配的快捷键')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '清除搜索与筛选' }));
    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByText('撤销')).toBeTruthy();
  });
});
