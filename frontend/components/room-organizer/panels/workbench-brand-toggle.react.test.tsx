// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNavExpanded, toggleNavColumns, type NavColumns } from '../lib/nav-chrome';
import { WorkbenchBrandToggle } from './workbench-brand-toggle';

afterEach(cleanup);

describe('workbench brand toggle', () => {
  it('keeps only the lock mark and never shows the 幕景 wordmark', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<WorkbenchBrandToggle expanded={false} onToggle={onToggle} />);
    const open = screen.getByRole('button', { name: '展开导航栏' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(open.getAttribute('data-tip')).toBe('展开导航栏');
    expect(open.getAttribute('title')).toBeNull();
    expect(open.className).toContain('is-mark');
    expect(open.textContent).not.toContain('幕景');
    expect(open.querySelector('.sc-brand-dot')).toBeNull();
    fireEvent.click(open);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<WorkbenchBrandToggle expanded onToggle={onToggle} />);
    const close = screen.getByRole('button', { name: '收起导航栏' });
    expect(close.getAttribute('aria-expanded')).toBe('true');
    expect(close.getAttribute('data-tip')).toBe('收起导航栏');
    expect(close.getAttribute('title')).toBeNull();
    expect(close.className).toContain('is-mark');
    expect(close.textContent).not.toContain('幕景');
    expect(close.querySelector('.sc-brand-dot')).toBeNull();
  });
});

function NavHarness({ initial }: { initial: NavColumns }): JSX.Element {
  const [agentCollapsed, setAgentCollapsed] = useState(initial.agentCollapsed);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initial.sidebarCollapsed);
  const columns = { agentCollapsed, sidebarCollapsed };
  const expanded = isNavExpanded(columns);
  return (
    <div data-nav={expanded ? 'expanded' : 'collapsed'} data-agent={String(agentCollapsed)} data-drawer={String(sidebarCollapsed)}>
      <WorkbenchBrandToggle expanded={expanded} onToggle={() => {
        const next = toggleNavColumns(columns);
        setAgentCollapsed(next.agentCollapsed);
        setSidebarCollapsed(next.sidebarCollapsed);
      }} />
      <button type="button" onClick={() => setAgentCollapsed(true)}>收起晴光</button>
      <button type="button" onClick={() => { setAgentCollapsed(false); setSidebarCollapsed(true); }}>打开晴光</button>
      <button type="button" onClick={() => setSidebarCollapsed(false)}>打开工具抽屉</button>
    </div>
  );
}

describe('logo mapped onto the two existing doors', () => {
  it('collapses 晴光 from the logo and opens it again without a third flag', () => {
    render(<NavHarness initial={{ agentCollapsed: false, sidebarCollapsed: true }} />);
    expect(screen.getByRole('button', { name: '收起导航栏' }).textContent).not.toContain('幕景');
    fireEvent.click(screen.getByRole('button', { name: '收起导航栏' }));
    const shell = document.querySelector('[data-nav]') as HTMLElement;
    expect(shell.dataset.nav).toBe('collapsed');
    expect(shell.dataset.agent).toBe('true');
    expect(shell.dataset.drawer).toBe('true');
    expect(screen.getByRole('button', { name: '展开导航栏' }).textContent).not.toContain('幕景');

    fireEvent.click(screen.getByRole('button', { name: '展开导航栏' }));
    expect(shell.dataset.nav).toBe('expanded');
    expect(shell.dataset.agent).toBe('false');
    expect(shell.dataset.drawer).toBe('true');
  });

  it('follows 晴光 and the tool drawer when those controls move on their own', () => {
    render(<NavHarness initial={{ agentCollapsed: false, sidebarCollapsed: true }} />);
    fireEvent.click(screen.getByRole('button', { name: '收起晴光' }));
    const shell = document.querySelector('[data-nav]') as HTMLElement;
    expect(shell.dataset.nav).toBe('collapsed');
    expect(screen.getByRole('button', { name: '展开导航栏' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '打开工具抽屉' }));
    expect(shell.dataset.nav).toBe('expanded');
    expect(shell.dataset.agent).toBe('true');
    expect(shell.dataset.drawer).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '收起导航栏' }));
    expect(shell.dataset.nav).toBe('collapsed');
    expect(shell.dataset.agent).toBe('true');
    expect(shell.dataset.drawer).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '打开晴光' }));
    expect(shell.dataset.nav).toBe('expanded');
    expect(shell.dataset.drawer).toBe('true');
  });
});
