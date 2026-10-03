// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import RootLayout from './layout';
import type { ReactNode } from 'react';

vi.mock('@/components/workspace-shell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/lib/auth-provider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.open(); document.write('<!doctype html><html><head></head><body></body></html>'); document.close();
  vi.restoreAllMocks();
});

it.each([false, true])('hydrates the real root with extension injection=%s and preserves button interaction', async injected => {
  const click = vi.fn();
  const tree = <RootLayout><button onClick={click}>测试按钮</button></RootLayout>;
  document.open(); document.write(`<!doctype html>${renderToString(tree)}`); document.close();
  if (injected) document.documentElement.setAttribute('trancy-version', '7.9.1');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { root = hydrateRoot(document, tree); });
  expect(error.mock.calls).toEqual([]);
  document.querySelector('button')!.click();
  expect(click).toHaveBeenCalledOnce();
  expect(document.documentElement.getAttribute('trancy-version')).toBe(injected ? '7.9.1' : null);
});

it('still reports a real hydration mismatch inside the page', async () => {
  document.open(); document.write(`<!doctype html>${renderToString(<RootLayout><p>服务端内容</p></RootLayout>)}`); document.close();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { root = hydrateRoot(document, <RootLayout><p>不同的客户端内容</p></RootLayout>); });
  expect(error.mock.calls.flat().some(value => /hydrat|match/i.test(String(value)))).toBe(true);
});
