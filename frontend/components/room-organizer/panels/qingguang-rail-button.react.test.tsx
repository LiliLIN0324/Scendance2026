// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QINGGUANG_RAIL_MASCOT, QingguangRailButton } from './qingguang-rail-button';

const here = dirname(fileURLToPath(import.meta.url));

afterEach(cleanup);

describe('晴光模式轨入口', () => {
  it('renders one avatar and no 布置 / 评审 / 执行 buttons', () => {
    const onOpen = vi.fn();
    render(<QingguangRailButton open onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: '晴光' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBeNull();
    expect(button.querySelector('img')?.getAttribute('src')).toBe(QINGGUANG_RAIL_MASCOT);
    expect(button.querySelector('.sc-rail-qingguang-dot')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '布置' })).toBeNull();
    expect(screen.queryByRole('button', { name: '评审' })).toBeNull();
    expect(screen.queryByRole('button', { name: '执行' })).toBeNull();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not mount the three mode icons on the workbench rail', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain('<QingguangRailButton');
    expect(source).toContain('<WorkbenchBrandToggle');
    expect(source).not.toContain('aria-label="工作流程"');
    expect(source).not.toContain('aria-label={mode.label}');
    expect(source).not.toMatch(/\b(SquareStack|ListChecks|Send)\b/);
    const openQingguang = source.slice(source.indexOf('const openQingguang'), source.indexOf('const openBusinessWorkspace'));
    expect(openQingguang).not.toContain('setWorkbenchMode');
  });

  it('mounts 晴光, Bingo and 场地 as three desks, not one shared shell', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain('<QingguangRailButton');
    expect(source).toContain('<BingoRailButton');
    expect(source).toContain('<VenueRailButton');
    expect(source).toContain("railDesk === 'qingguang' && <AgentPanel");
    expect(source).toContain("railDesk === 'bingo' && <BingoDesk");
    expect(source).toContain("railDesk === 'venue' && <VenueDesk");
    const agentAt = source.indexOf("railDesk === 'qingguang' && <AgentPanel");
    const bingoAt = source.indexOf("railDesk === 'bingo' && <BingoDesk");
    const venueAt = source.indexOf("railDesk === 'venue' && <VenueDesk");
    expect(bingoAt).toBeGreaterThan(agentAt);
    expect(venueAt).toBeGreaterThan(bingoAt);
  });
});
