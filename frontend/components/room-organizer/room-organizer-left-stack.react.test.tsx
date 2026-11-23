// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layoutStore } from './hooks/use-layout-store';
import { makeFloor, makeLayout } from './lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from './lib/constants';
import { resetGenerationSheetForTests } from './lib/generation-sheet';
import { INITIAL_LAYOUT } from './lib/initial-layout';
import { RoomOrganizer } from './room-organizer';
import { MemoryStorage } from '../../lib/test-support-memory-storage';

const mem = new MemoryStorage();
Object.defineProperty(globalThis, 'Storage', { configurable: true, value: MemoryStorage });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: mem });
Object.defineProperty(window, 'localStorage', { configurable: true, value: mem });

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  resetGenerationSheetForTests();
  mem.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom 没有 Element.scrollTo；Agent 对话区的钉底 effect 在挂载时会调用。
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value() {} });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  const layout = makeLayout({ id: 'left-stack-pair', name: '左栏分屏', width: 12, height: 9, roof: { style: 'none' }, floors: [makeFloor({ id: 'floor', items: [] })] });
  layoutStore.setState({ layout, activeFloorIndex: 0 });
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
});

afterEach(() => {
  cleanup();
  resetGenerationSheetForTests();
  layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  mem.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('创作与户外规划同开时两张卡都留在左栏，并给出一根分隔条', async () => {
  render(<RoomOrganizer />);
  fireEvent.click(screen.getByRole('button', { name: '创作：重建真实场地、文生 3D 或图生 3D' }));
  expect(await screen.findByTestId('generation-sheet')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '户外规划' }));
  const outdoor = await screen.findByTestId('outdoor-left-card');
  expect(outdoor.hasAttribute('hidden')).toBe(false);
  expect(screen.getByTestId('generation-sheet').hasAttribute('hidden')).toBe(false);
  expect(screen.getByTestId('left-stack-splitter')).toBeTruthy();

  await waitFor(() => {
    expect(outdoor.className).toContain('is-stack-first');
    expect(screen.getByTestId('generation-sheet').className).toContain('is-stack-second');
  });

  // 分隔条上的「上下换序」也要认创作卡：默认户外在上，点一下换创作到上面。
  fireEvent.click(screen.getByTestId('left-stack-swap'));
  await waitFor(() => {
    expect(outdoor.className).toContain('is-stack-second');
    expect(screen.getByTestId('generation-sheet').className).toContain('is-stack-first');
  });
});
