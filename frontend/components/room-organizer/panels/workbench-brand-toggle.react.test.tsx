// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNavExpanded, toggleNavColumns, type NavColumns } from '../lib/nav-chrome';
import { WorkbenchBrandToggle } from './workbench-brand-toggle';

afterEach(cleanup);

describe('workbench brand toggle', () => {
  it('keeps the mark and the short 幕景 word on the same rail button in both states', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<WorkbenchBrandToggle expanded={false} onToggle={onToggle} />);
    const open = screen.getByRole('button', { name: '展开导航栏' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(open.getAttribute('data-tip')).toBe('展开导航栏');
    expect(open.classList.contains('is-mark')).toBe(true);
    expect(open.classList.contains('is-wordmark')).toBe(false);
    expect(open.textContent).toContain('幕景');
    expect(open.querySelector('.sc-brand-mark')).not.toBeNull();
    expect(open.querySelector('.sc-brand-dot')).toBeNull();
    expect(open.textContent).not.toContain('SCENDANCE');
    fireEvent.click(open);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<WorkbenchBrandToggle expanded onToggle={onToggle} />);
    const close = screen.getByRole('button', { name: '收起导航栏' });
    expect(close.getAttribute('aria-expanded')).toBe('true');
    expect(close.getAttribute('data-tip')).toBe('收起导航栏');
    expect(close.classList.contains('is-mark')).toBe(true);
    expect(close.textContent).toContain('幕景');
    expect(close.querySelector('.sc-brand-dot')).toBeNull();
    expect(close.textContent).not.toContain('SCENDANCE');
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
    const close = screen.getByRole('button', { name: '收起导航栏' });
    expect(close.textContent).toContain('幕景');
    expect(close.classList.contains('is-wordmark')).toBe(false);
    fireEvent.click(close);
    const shell = document.querySelector('[data-nav]') as HTMLElement;
    expect(shell.dataset.nav).toBe('collapsed');
    expect(shell.dataset.agent).toBe('true');
    expect(shell.dataset.drawer).toBe('true');
    expect(screen.getByRole('button', { name: '展开导航栏' }).textContent).toContain('幕景');

    fireEvent.click(screen.getByRole('button', { name: '展开导航栏' }));
    expect(shell.dataset.nav).toBe('expanded');
    expect(shell.dataset.agent).toBe('false');
    expect(shell.dataset.drawer).toBe('true');
    expect(screen.getByRole('button', { name: '收起导航栏' }).classList.contains('is-mark')).toBe(true);
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
    expect(screen.getByRole('button', { name: '收起导航栏' }).classList.contains('is-mark')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '收起导航栏' }));
    expect(shell.dataset.nav).toBe('collapsed');
    expect(shell.dataset.agent).toBe('true');
    expect(shell.dataset.drawer).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '打开晴光' }));
    expect(shell.dataset.nav).toBe('expanded');
    expect(shell.dataset.drawer).toBe('true');
  });
});
