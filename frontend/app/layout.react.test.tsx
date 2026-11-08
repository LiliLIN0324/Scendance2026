// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import RootLayout from './layout';
import { RESTORE_JOURNAL_MARKER } from '@/lib/restore-journal';
import type { ReactNode } from 'react';

const mounts = vi.hoisted(() => ({ workspace: vi.fn(), editor: vi.fn() }));
vi.mock('@/components/workspace-shell', () => ({ BootSkeleton: () => null, WorkspaceShell: ({ children }: { children: ReactNode }) => { mounts.workspace(); return children; } }));
vi.mock('@/lib/auth-provider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.open(); document.write('<!doctype html><html><head></head><body></body></html>'); document.close();
  vi.restoreAllMocks();
  localStorage.clear(); mounts.workspace.mockClear(); mounts.editor.mockClear();
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

it('still reports a real hydration mismatch inside the startup gate', async () => {
  const html = renderToString(<RootLayout><p>页面内容</p></RootLayout>).replace('正在核对本机恢复状态，请稍候。', '服务端不同内容');
  document.open(); document.write(`<!doctype html>${html}`); document.close();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { root = hydrateRoot(document, <RootLayout><p>页面内容</p></RootLayout>); });
  expect(error.mock.calls.flat().some(value => /hydrat|match/i.test(String(value)))).toBe(true);
});

function EditorProbe() { mounts.editor(); return <p>真实编辑入口</p>; }
async function hydrateWithEditor() {
  const tree = <RootLayout><EditorProbe/></RootLayout>;
  const html = renderToString(tree);
  document.open(); document.write(`<!doctype html>${html}`); document.close();
  expect(mounts.workspace).not.toHaveBeenCalled(); expect(mounts.editor).not.toHaveBeenCalled();
  await act(async () => { root = hydrateRoot(document, tree); });
}

it('keeps the entire workspace and editor unmounted until a pending marker is cleared and rechecked', async () => {
  localStorage.setItem(RESTORE_JOURNAL_MARKER, JSON.stringify({ version: 1, id: 'pending-restore' }));
  await hydrateWithEditor();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('上次恢复尚未核对完成');
  expect(mounts.workspace).not.toHaveBeenCalled(); expect(mounts.editor).not.toHaveBeenCalled();
  expect(localStorage.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  localStorage.removeItem(RESTORE_JOURNAL_MARKER);
  await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === '重新检查')!.click(); });
  expect(mounts.workspace).toHaveBeenCalled(); expect(mounts.editor).toHaveBeenCalled();
  expect(document.body.textContent).toContain('真实编辑入口');
});

it('keeps workspace and editor unmounted on storage failure until a successful recheck', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
  await hydrateWithEditor();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('无法读取或识别');
  expect(mounts.workspace).not.toHaveBeenCalled(); expect(mounts.editor).not.toHaveBeenCalled();
  read.mockRestore();
  await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === '重新检查')!.click(); });
  expect(mounts.workspace).toHaveBeenCalled(); expect(mounts.editor).toHaveBeenCalled();
});

it('watchdog recognizes the recovery screen but still reloads on actual chunk errors', () => {
  const html=renderToString(<RootLayout><p>内容</p></RootLayout>);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  const events:Record<string,(value:unknown)=>void>={};let watchdog!:()=>void;
  const localWindow={__pcReady:false,__pcRecoveryGateReady:true,addEventListener:(name:string,handler:(value:unknown)=>void)=>{events[name]=handler;}};
  const state=new Map<string,string>();const session={getItem:(key:string)=>state.get(key)??null,setItem:(key:string,value:string)=>state.set(key,value)};
  const location={pathname:'/',reload:vi.fn()};
  new Function('window','sessionStorage','location','setTimeout',script!)(localWindow,session,location,(callback:()=>void)=>{watchdog=callback;});
  watchdog();expect(location.reload).not.toHaveBeenCalled();
  events.error!({target:{tagName:'SCRIPT',src:'/_next/static/chunks/missing.js'}});
  expect(location.reload).toHaveBeenCalledOnce();
});
