import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NAV_BRAND_BAR_TRACKS,
  NAV_BRAND_BAR_WIDTH,
  NAV_COLLAPSE_LABEL,
  NAV_EXPAND_LABEL,
  NAV_RAIL_WIDTH_PX,
  isNavExpanded,
  navToggleLabel,
  toggleNavColumns,
} from './nav-chrome';

const here = dirname(fileURLToPath(import.meta.url));

describe('nav chrome state', () => {
  it('treats the left column as expanded whenever 晴光 or the tool drawer is open', () => {
    expect(isNavExpanded({ agentCollapsed: false, sidebarCollapsed: true })).toBe(true);
    expect(isNavExpanded({ agentCollapsed: true, sidebarCollapsed: false })).toBe(true);
    expect(isNavExpanded({ agentCollapsed: false, sidebarCollapsed: false })).toBe(true);
    expect(isNavExpanded({ agentCollapsed: true, sidebarCollapsed: true })).toBe(false);
    expect(isNavExpanded({ agentCollapsed: true, sidebarCollapsed: true, sidePanel: 'bingo' })).toBe(true);
    expect(isNavExpanded({ agentCollapsed: true, sidebarCollapsed: true, sidePanel: 'venue' })).toBe(true);
  });

  it('closes both doors from any open combination, and opens only 晴光 from fully closed', () => {
    const closed = { agentCollapsed: true, sidebarCollapsed: true, sidePanel: null };
    expect(toggleNavColumns({ agentCollapsed: false, sidebarCollapsed: true })).toEqual(closed);
    expect(toggleNavColumns({ agentCollapsed: true, sidebarCollapsed: false })).toEqual(closed);
    expect(toggleNavColumns({ agentCollapsed: false, sidebarCollapsed: false })).toEqual(closed);
    expect(toggleNavColumns(closed)).toEqual({ agentCollapsed: false, sidebarCollapsed: true, sidePanel: null });
  });

  it('round-trips the default 晴光 column without remembering a third flag', () => {
    const openAgent = { agentCollapsed: false, sidebarCollapsed: true, sidePanel: null };
    expect(toggleNavColumns(toggleNavColumns(openAgent))).toEqual(openAgent);
    expect(navToggleLabel(true)).toBe(NAV_COLLAPSE_LABEL);
    expect(navToggleLabel(false)).toBe(NAV_EXPAND_LABEL);
  });

  it('keeps the collapsed rail at 64px and lets the brand bar fill the 240–480 card', () => {
    expect(NAV_RAIL_WIDTH_PX).toBe(64);
    expect(NAV_BRAND_BAR_WIDTH).toBe('100%');
    expect(NAV_BRAND_BAR_TRACKS).toEqual({ min: 240, default: 320, max: 480 });
    const css = readFileSync(join(here, '../../../app/globals.css'), 'utf8');
    expect(css).toMatch(/--sc-nav-rail-width:\s*64px/);
    expect(css).toContain('grid-template-columns: var(--sc-nav-rail-width) var(--sc-left-card-width, 320px)');
    expect(css).toMatch(/\.sc-nav-brand\.is-wordmark\s*\{[^}]*width:\s*100%/);
    expect(css).not.toMatch(/sc-nav-brand[^}]{0,240}188px/);
  });

  it('does not store a separate navExpanded flag beside the two doors', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).not.toMatch(/navExpanded\s*=\s*useState|const \[navExpanded/);
    expect(source).toContain('toggleNavColumns');
    expect(source).toContain('isNavExpanded');
  });
});
