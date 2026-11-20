// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './account-menu';

function mountMenu(): void {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const anchorRef = { current: anchor as HTMLButtonElement | null };
  render(
    <AccountMenu
      open
      onClose={() => {}}
      anchorRef={anchorRef}
      displayName="endTree"
      studioName="endTree 的工作室"
      showSignOut
      busy={false}
      onOpenProjects={() => {}}
      onOpenAssets={() => {}}
      onOpenSettings={() => {}}
      onSignOut={() => {}}
    />,
  );
}

describe('AccountMenu support flyout hover', () => {
  beforeEach(() => {
    // 桌面悬停路径：hoverFine() 要求 (hover: hover) and (pointer: fine) 命中。
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      media: '(hover: hover) and (pointer: fine)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    document.querySelectorAll('body > button').forEach(node => node.remove());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('survives the gap between the 支持 row and its flyout instead of vanishing', () => {
    mountMenu();
    const row = screen.getByRole('menuitem', { name: '支持' }).parentElement as HTMLElement;
    fireEvent.mouseOver(row);
    expect(screen.getByRole('menu', { name: '支持' })).toBeTruthy();
    expect(document.querySelector('.sc-account-menu-bridge')).toBeTruthy();

    // 指针离开行、正走在 6px 间隙里：面板不能当场卸载。
    fireEvent.mouseOut(row, { relatedTarget: document.body });
    act(() => { vi.advanceTimersByTime(80); });
    expect(screen.queryByRole('menu', { name: '支持' })).toBeTruthy();

    // 进入面板即取消待关闭，久留也还在。
    fireEvent.mouseOver(screen.getByRole('menu', { name: '支持' }));
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('menu', { name: '支持' })).toBeTruthy();

    // 真正移出后才收起来。
    fireEvent.mouseOut(row, { relatedTarget: document.body });
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole('menu', { name: '支持' })).toBeNull();
  });

  it('still opens the flyout by click for touch and keyboard users', () => {
    mountMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '支持' }));
    expect(screen.getByRole('menu', { name: '支持' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '支持' }));
    expect(screen.queryByRole('menu', { name: '支持' })).toBeNull();
  });
});

describe('AccountMenu appearance flyout', () => {
  const onAppearanceModeChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      media: '(hover: hover) and (pointer: fine)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    document.querySelectorAll('body > button').forEach(node => node.remove());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    onAppearanceModeChange.mockClear();
  });

  it('shows the three modes in a right-side flyout without an inline current label', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const anchorRef = { current: anchor as HTMLButtonElement | null };
    render(
      <AccountMenu
        open
        onClose={() => {}}
        anchorRef={anchorRef}
        displayName="endTree"
        studioName="endTree 的工作室"
        showSignOut
        busy={false}
        onOpenProjects={() => {}}
        onOpenAssets={() => {}}
        onOpenSettings={() => {}}
        onSignOut={() => {}}
        appearanceMode="dark"
        onAppearanceModeChange={onAppearanceModeChange}
      />,
    );

    const rowButton = screen.getByRole('menuitem', { name: '外观' });
    expect(rowButton).toBeTruthy();
    expect(rowButton.textContent).not.toContain('深色');

    fireEvent.mouseOver(rowButton.parentElement as HTMLElement);
    const flyout = screen.getByRole('menu', { name: '外观模式' });
    expect(flyout).toBeTruthy();
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('menuitemradio', { name: '深色' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('menuitemradio', { name: '浅色' }));
    expect(onAppearanceModeChange).toHaveBeenCalledWith('light');
  });
});
