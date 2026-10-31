// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isNavExpanded } from '../lib/nav-chrome';

const here = dirname(fileURLToPath(import.meta.url));

describe('左轨主入口面板', () => {
  it('keeps Bingo and venue panels in the left column, not canvas overlays', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain("sidePanel === 'bingo' && <BingoPanel");
    expect(source).toContain("sidePanel === 'venue' && <VenueLibraryPanel");
    expect(source).not.toContain('AgentReopenCard');
    expect(source).not.toMatch(/venueLibraryOpen\s*&&\s*<VenueLibraryPanel/);
  });

  it('expands the left card when a side panel is open without 晴光', () => {
    expect(isNavExpanded({ agentCollapsed: true, sidebarCollapsed: true, sidePanel: 'bingo' })).toBe(true);
    expect(isNavExpanded({ agentCollapsed: true, sidebarCollapsed: true, sidePanel: 'venue' })).toBe(true);
  });

  it('mutually excludes 晴光 dialogue from side panels in render guards', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain('!agentCollapsed && !sidePanel && <AgentPanel');
    expect(source).toContain('open={!agentCollapsed && !sidePanel}');
  });
});
