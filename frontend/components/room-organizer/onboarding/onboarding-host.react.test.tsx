// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import {
  HelpRailButton,
  ONBOARDING_STORAGE_KEY,
  OnboardingHost,
  closeHelpCenter,
  resetHelpCenterForTests,
  type OnboardingHostProps,
} from './onboarding-host';

function setup(props: OnboardingHostProps = {}) {
  return render(<>
    <HelpRailButton />
    <OnboardingHost {...props} />
  </>);
}

function stored(): { tours: Record<string, { done: string[]; muted: boolean }> } {
  const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
  return raw ? JSON.parse(raw) : { tours: {} };
}

function progress(tour: string): { done: string[]; muted: boolean } {
  return stored().tours[tour] ?? { done: [], muted: false };
}

function stepOfReel(): string | null {
  return screen.getByTestId('tour-reel').getAttribute('data-tour-step');
}

function startButton(tour: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour-start="${tour}"]`);
}

function openHelp(): void {
  fireEvent.click(screen.getByRole('button', { name: '帮助与上手' }));
  expect(screen.getByTestId('help-center')).toBeTruthy();
}

function startTour(tour: string): void {
  openHelp();
  const button = startButton(tour);
  if (!button) throw new Error(`帮助中心里没有航线 ${tour}`);
  fireEvent.click(button);
  expect(screen.getByTestId('tour-reel')).toBeTruthy();
}

function buttonInReel(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  window.localStorage.clear();
  resetHelpCenterForTests();
});

afterEach(() => {
  cleanup();
  mem?.clear();
  closeHelpCenter();
  resetHelpCenterForTests();
  vi.unstubAllGlobals();
});

describe('OnboardingHost（2026-11-20 全局引导）', () => {
  it('mounts quietly: no auto-pop in tests, help center closed', () => {
    setup();
    expect(screen.queryByTestId('tour-reel')).toBeNull();
    expect(screen.queryByTestId('help-center')).toBeNull();
  });

  it('the rail ? opens a help center listing the lines and their progress', () => {
    setup();
    openHelp();
    expect(screen.getByRole('heading', { name: '上手航线' })).toBeTruthy();
    for (const tour of ['first-run', 'canvas-basics', 'material-shelf', 'delivery', 'topic-undo']) {
      expect(startButton(tour), tour).toBeTruthy();
    }
    expect(startButton('first-run')!.textContent).toBe('开始');
    expect(screen.getByTestId('help-center').textContent).toContain('0/5');
    expect(screen.queryByTestId('tour-reel')).toBeNull();
  });

  it('falls back to a centred card when the control is not on screen', () => {
    setup();
    startTour('first-run');
    expect(stepOfReel()).toBe('site');
    expect(screen.getByText('1/5')).toBeTruthy();
    // jsdom 里控件尺寸为 0：宁可不圈，也不画个圈假装指着什么。
    expect(screen.queryByTestId('tour-ring')).toBeNull();
  });

  it('splits 「跳过这一步」 from 「以后不再提示」', () => {
    setup();
    startTour('first-run');

    // 跳过这一步：只记这一步，进度落到盘里，下一条接着走。
    fireEvent.click(buttonInReel('跳过这一步'));
    expect(stepOfReel()).toBe('ask');
    expect(progress('first-run')).toEqual({ done: ['site'], muted: false });

    // 以后不再提示：整条线静音，但看过的不丢。
    fireEvent.click(buttonInReel('以后不再提示'));
    expect(screen.queryByTestId('tour-reel')).toBeNull();
    expect(progress('first-run')).toEqual({ done: ['site'], muted: true });

    // 静音 ≠ 永久消失：帮助中心仍列着这条线，点下去从断点续播。
    openHelp();
    expect(startButton('first-run')!.textContent).toBe('继续');
    fireEvent.click(startButton('first-run')!);
    expect(stepOfReel()).toBe('ask');
  });

  it('Esc pauses without recording the step', () => {
    setup();
    startTour('canvas-basics');
    expect(stepOfReel()).toBe('canvasGesture');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('tour-reel')).toBeNull();
    expect(progress('canvas-basics')).toEqual({ done: [], muted: false });

    startTour('canvas-basics');
    expect(stepOfReel()).toBe('canvasGesture');
  });

  it('finishing a line turns it into 重看, and 重看 starts over', () => {
    setup();
    startTour('delivery');
    expect(stepOfReel()).toBe('publish');
    fireEvent.click(buttonInReel('下一步'));
    expect(stepOfReel()).toBe('export');
    fireEvent.click(buttonInReel('知道了'));
    expect(screen.queryByTestId('tour-reel')).toBeNull();
    expect(progress('delivery')).toEqual({ done: ['publish', 'export'], muted: false });

    openHelp();
    expect(startButton('delivery')!.textContent).toBe('重看');
    fireEvent.click(startButton('delivery')!);
    expect(stepOfReel()).toBe('publish');
    expect(progress('delivery').done).toEqual([]);
  });

  it('signal-gated steps never block the line, and the breakpoint survives a remount', () => {
    const { unmount } = setup();
    startTour('material-shelf');
    expect(stepOfReel()).toBe('shelfEntry');
    fireEvent.click(buttonInReel('下一步'));
    expect(stepOfReel()).toBe('shelf');
    // 现场没放过物件：「已放置清单」这一步不出现，这条线就地收摊。
    fireEvent.click(buttonInReel('下一步'));
    expect(screen.queryByTestId('tour-reel')).toBeNull();
    expect(progress('material-shelf').done).toEqual(['shelfEntry', 'shelf']);
    unmount();

    // 下次进工作台：不硬弹，但帮助中心写着走到哪儿了。
    setup({ signals: { hasBoundary: true, hasItems: true } });
    openHelp();
    expect(startButton('material-shelf')!.textContent).toBe('继续');
    expect(screen.getByText('2/3')).toBeTruthy();
    fireEvent.click(startButton('material-shelf')!);
    expect(stepOfReel()).toBe('placed');
  });

  it('delegates the shortcuts entry to the existing coach instead of duplicating it', () => {
    setup();
    const seen: string[] = [];
    const listener = (event: Event) => seen.push(event.type);
    window.addEventListener('scendance:open-shortcut-coach', listener);

    openHelp();
    fireEvent.click(screen.getByRole('button', { name: '键盘快捷键' }));
    expect(seen).toEqual(['scendance:open-shortcut-coach']);
    expect(screen.queryByTestId('help-center')).toBeNull();

    window.removeEventListener('scendance:open-shortcut-coach', listener);
  });

  it('keeps one line\'s mute off the others', () => {
    setup();
    startTour('first-run');
    fireEvent.click(buttonInReel('以后不再提示'));
    expect(progress('first-run').muted).toBe(true);
    expect(progress('canvas-basics')).toEqual({ done: [], muted: false });
  });
});
