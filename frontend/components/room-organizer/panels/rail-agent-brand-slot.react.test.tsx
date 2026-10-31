// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agent-panel', () => ({
  useAgent: () => ({
    callbacks: { workbenchMode: 'layout' },
    state: 'idle',
  }),
  qingguangHeaderStatus: () => ({ text: '在线', tone: 'idle' as const, hint: '' }),
}));

import { RailAgentBrandSlot } from './rail-agent-brand-slot';

afterEach(cleanup);

describe('rail agent brand slot', () => {
  it('shows only qingguang when collapsed', () => {
    const railRef = createRef<HTMLButtonElement>();
    const { container } = render(
      <RailAgentBrandSlot
        showBrand={false}
        showQingguang
        navExpanded={false}
        qingguangPanelOpen={false}
        onToggleNav={vi.fn()}
        onOpenQingguang={vi.fn()}
        qingguangRailRef={railRef}
      />,
    );
    expect(container.querySelector('.sc-rail-slot-layer.is-qingguang.is-on')).toBeTruthy();
    expect(container.querySelector('.sc-rail-slot-layer.is-brand.is-on')).toBeNull();
    expect(screen.getByRole('button', { name: '晴光' })).toBeTruthy();
    expect(container.querySelector('.sc-rail-agent-brand-slot')?.getAttribute('data-rail-slot')).toBe('qingguang');
  });

  it('shows only brand lock when qingguang panel is open', () => {
    const railRef = createRef<HTMLButtonElement>();
    const { container } = render(
      <RailAgentBrandSlot
        showBrand
        showQingguang={false}
        navExpanded
        qingguangPanelOpen
        onToggleNav={vi.fn()}
        onOpenQingguang={vi.fn()}
        qingguangRailRef={railRef}
      />,
    );
    expect(container.querySelector('.sc-rail-slot-layer.is-brand.is-on')).toBeTruthy();
    expect(container.querySelector('.sc-rail-slot-layer.is-qingguang.is-on')).toBeNull();
    const brand = screen.getByRole('button', { name: '收起导航栏' });
    expect(brand.textContent).not.toContain('幕景');
    expect(container.querySelector('.sc-rail-agent-brand-slot')?.getAttribute('data-rail-slot')).toBe('brand');
  });
});
