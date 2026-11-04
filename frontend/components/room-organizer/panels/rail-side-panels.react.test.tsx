// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isNavExpanded } from '../lib/nav-chrome';

const here = dirname(fileURLToPath(import.meta.url));

describe('左轨主入口面板', () => {
  it('keeps the venue panel in the left column, not canvas overlays', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).not.toContain("sidePanel === 'bingo'");
    expect(source).not.toContain('<BingoPanel');
    // S3：VenueLibraryPanel 生产零入口已删除。
    expect(source).not.toContain('<VenueLibraryPanel');
    expect(source).not.toContain('AgentReopenCard');
    expect(source).not.toMatch(/venueLibraryOpen\s*&&\s*<VenueLibraryPanel/);
    expect(source).not.toContain('<MapRailButton');
    expect(source).not.toContain('aria-label="场地资料"');
    expect(source).not.toContain('aria-label="生成与场地观感"');
    expect(source).toContain('onOpenReference:');
    const agentSource = readFileSync(join(here, 'agent-panel.tsx'), 'utf8');
    expect(agentSource).toContain('你可以做什么');
    expect(agentSource).toContain('id="ap-capabilities"');
  });

  it('expands the left card when a side panel is open without Bingo', () => {
    expect(isNavExpanded({ agentCollapsed: true, sidebarCollapsed: true, sidePanel: 'venue' })).toBe(true);
  });

  it('mutually excludes Bingo dialogue from side panels in render guards', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain('agentPanelVisible = (!agentCollapsed || agentClosing) && !sidePanel');
    expect(source).toContain('agentPanelOpen = !agentCollapsed && !agentClosing && !sidePanel');
    expect(source).toContain('agentPanelVisible && <AgentPanel');
  });
});
