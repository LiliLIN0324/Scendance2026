// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutCoach } from './shortcut-coach';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ShortcutCoach', () => {
  it('opens from the ? key and closes with Escape', () => {
    render(<ShortcutCoach mode="build" />);

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('dialog', { name: '快捷键' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: '搜索快捷键' })).toBeTruthy();
    expect(screen.getAllByText('布置').length).toBeGreaterThan(0);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '快捷键' })).toBeNull();
  });

  it('opens the filter that matches the current canvas mode', () => {
    render(<ShortcutCoach mode="outdoor" />);

    fireEvent.keyDown(window, { key: '/', shiftKey: true });
    expect(screen.getByRole('heading', { name: '户外规划' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '建造画布 · 编辑' })).toBeNull();
    expect(screen.getByRole('button', { name: '户外' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not mount a shortcut pill on the canvas', () => {
    const { baseElement } = render(<ShortcutCoach mode="outdoor" />);

    expect(baseElement.querySelector('.sc-shortcut-coach-trigger')).toBeNull();
    expect(screen.queryByRole('button', { name: /快捷键速查（当前/ })).toBeNull();

    fireEvent.keyDown(window, { key: '?' });
    expect(baseElement.querySelector('.sc-shortcut-coach-trigger')).toBeNull();
    expect(screen.queryByRole('button', { name: /快捷键速查（当前/ })).toBeNull();
  });

  it('closes when the backdrop is pressed', () => {
    const { baseElement } = render(<ShortcutCoach mode="build" />);

    fireEvent.keyDown(window, { key: '?' });
    const backdrop = baseElement.querySelector('.sc-shortcut-coach-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop!);
    expect(screen.queryByRole('dialog', { name: '快捷键' })).toBeNull();
  });

  it('returns focus to the control that had it', () => {
    vi.useFakeTimers();
    render(
      <>
        <button type="button">画布工具</button>
        <ShortcutCoach mode="build" />
      </>,
    );

    const opener = screen.getByRole('button', { name: '画布工具' });
    opener.focus();
    fireEvent.keyDown(window, { key: '?' });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭快捷键速查' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '快捷键' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does not hijack ? while typing', () => {
    render(
      <>
        <input aria-label="测试输入" />
        <ShortcutCoach mode="build" />
      </>,
    );

    const input = screen.getByRole('textbox', { name: '测试输入' });
    input.focus();
    fireEvent.keyDown(input, { key: '?' });
    expect(screen.queryByRole('dialog', { name: '快捷键' })).toBeNull();
  });

  it('opens from the support and settings event without adding a map pill', () => {
    const { baseElement } = render(<ShortcutCoach mode="outdoor" />);
    fireEvent(window, new Event('scendance:open-shortcut-coach'));
    expect(screen.getByRole('dialog', { name: '快捷键' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '户外规划' })).toBeTruthy();
    expect(baseElement.querySelector('.sc-shortcut-coach-trigger')).toBeNull();
  });

  it('does not open on top of another modal', () => {
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="已有弹层" />
        <ShortcutCoach mode="build" />
      </>,
    );

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.queryByRole('dialog', { name: '快捷键' })).toBeNull();
  });
});
