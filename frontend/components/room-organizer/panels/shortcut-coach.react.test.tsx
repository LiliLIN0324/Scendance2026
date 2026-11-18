// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShortcutCoach } from './shortcut-coach';

afterEach(cleanup);

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

  it('opens the outdoor filter from Shift+/ and has no persistent capsule', () => {
    render(<ShortcutCoach mode="outdoor" />);

    expect(screen.queryByRole('button', { name: /快捷键速查/ })).toBeNull();
    expect(document.querySelector('.sc-shortcut-coach-trigger')).toBeNull();

    fireEvent.keyDown(window, { key: '/', shiftKey: true });
    expect(screen.getByRole('heading', { name: '户外规划' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '建造画布 · 编辑' })).toBeNull();
    expect(screen.getByRole('button', { name: '户外' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('closes when the mask is pressed', () => {
    render(<ShortcutCoach mode="build" />);

    fireEvent.keyDown(window, { key: '?' });
    const dialog = screen.getByRole('dialog', { name: '快捷键' });
    const backdrop = dialog.parentElement;
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop!);
    expect(screen.queryByRole('dialog', { name: '快捷键' })).toBeNull();
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
