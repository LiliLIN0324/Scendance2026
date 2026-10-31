// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agent-panel', () => ({
  useAgent: () => ({
    callbacks: { workbenchMode: 'layout' },
    state: 'idle',
  }),
  qingguangHeaderStatus: () => ({ text: '在线', tone: 'idle' as const, hint: '' }),
}));

import { QINGGUANG_RAIL_MASCOT, QingguangRailButton } from './qingguang-rail-button';

const here = dirname(fileURLToPath(import.meta.url));

afterEach(cleanup);

describe('晴光模式轨入口', () => {
  it('renders one avatar and wires the status dot tone', () => {
    const onOpen = vi.fn();
    render(<QingguangRailButton open onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: '晴光' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.querySelector('img')?.getAttribute('src')).toBe(QINGGUANG_RAIL_MASCOT);
    expect(button.querySelector('.sc-rail-qingguang-dot.is-idle')).toBeTruthy();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not mount the three mode icons on the workbench rail', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain('<RailAgentBrandSlot');
    expect(source).toContain('<BingoRailButton');
    expect(source).toContain('<VenueRailButton');
    expect(source).not.toContain('AgentReopenCard');
    expect(source).not.toContain('AssistantSessionDock');
    expect(source).not.toContain('aria-label="工作流程"');
    expect(source).not.toMatch(/\b(SquareStack|ListChecks|Send)\b/);
  });
});
