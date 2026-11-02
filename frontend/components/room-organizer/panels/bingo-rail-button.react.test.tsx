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
  bingoHeaderStatus: () => ({ text: '在线', tone: 'idle' as const, hint: '' }),
}));

import { BingoRailButton } from './bingo-rail-button';

const here = dirname(fileURLToPath(import.meta.url));

afterEach(cleanup);

describe('Bingo 左轨入口', () => {
  it('renders the ring shape and wires the status dot tone', () => {
    const onOpen = vi.fn();
    render(<BingoRailButton open onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Bingo' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(button.querySelector('img')).toBeNull();
    expect(button.querySelector('.sc-rail-bingo-dot.is-idle')).toBeTruthy();
    expect(button.className).toContain('sc-rail-disc');
    expect(button.className).toContain('is-active');
    expect(button.getAttribute('data-tip')).toBe('Bingo');
    expect(button.getAttribute('title')).toBeNull();
    expect(button.textContent ?? '').not.toMatch(/Bingo/);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not mount the three mode icons on the workbench rail', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain('<WorkbenchBrandToggle');
    expect(source).toContain('<BingoRailButton');
    expect(source).toContain('aria-label="空间"');
    expect(source).toContain('aria-label="物料"');
    expect(source).not.toContain('<VenueRailButton');
    expect(source).not.toContain('aria-label="场地"');
    expect(source).not.toContain('AgentReopenCard');
    expect(source).not.toContain('AssistantSessionDock');
    expect(source).not.toContain('aria-label="工作流程"');
    expect(source).not.toMatch(/\b(SquareStack|ListChecks|Send)\b/);
  });
});
