import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
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
  });

  it('closes both doors from any open combination, and opens only 晴光 from fully closed', () => {
    const closed = { agentCollapsed: true, sidebarCollapsed: true };
    expect(toggleNavColumns({ agentCollapsed: false, sidebarCollapsed: true })).toEqual(closed);
    expect(toggleNavColumns({ agentCollapsed: true, sidebarCollapsed: false })).toEqual(closed);
    expect(toggleNavColumns({ agentCollapsed: false, sidebarCollapsed: false })).toEqual(closed);
    expect(toggleNavColumns(closed)).toEqual({ agentCollapsed: false, sidebarCollapsed: true });
  });

  it('round-trips the default 晴光 column without remembering a third flag', () => {
    const openAgent = { agentCollapsed: false, sidebarCollapsed: true };
    expect(toggleNavColumns(toggleNavColumns(openAgent))).toEqual(openAgent);
    expect(navToggleLabel(true)).toBe(NAV_COLLAPSE_LABEL);
    expect(navToggleLabel(false)).toBe(NAV_EXPAND_LABEL);
  });

  it('keeps the brand on the 64px rail and off the session column', () => {
    expect(NAV_RAIL_WIDTH_PX).toBe(64);
    const css = readFileSync(join(here, '../../../app/globals.css'), 'utf8');
    expect(css).toMatch(/--sc-nav-rail-width:\s*64px/);
    expect(css).toContain('grid-template-columns: var(--sc-nav-rail-width) var(--sc-left-card-width, 320px)');
    expect(css).not.toMatch(/\.sc-left-column\s*>\s*\.sc-nav-brand/);
    expect(css).not.toMatch(/sc-nav-brand[^}]{0,240}188px/);
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    const rail = source.slice(source.indexOf('className="sc-mode-rail"'), source.indexOf('id="workbench-nav-column"'));
    const column = source.slice(source.indexOf('id="workbench-nav-column"'));
    expect(rail.match(/<WorkbenchBrandToggle/g)).toHaveLength(1);
    const marks = ['<WorkbenchBrandToggle', '<QingguangRailButton', '<BingoRailButton', '<VenueRailButton'];
    const places = marks.map(mark => rail.indexOf(mark));
    expect(places.every(place => place >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    const foot = rail.slice(rail.indexOf('sc-mode-rail-foot'));
    expect(foot).toContain('aria-label="设置"');
    expect(foot).not.toContain('BingoRailButton');
    expect(foot).not.toContain('VenueRailButton');
    expect(foot).not.toContain('sc-rail-draft');
    expect(rail.slice(0, rail.indexOf('sc-mode-rail-foot'))).not.toContain('aria-label="设置"');
    expect(rail).not.toContain('SessionHistory');
    expect(rail).not.toContain('<MapRailButton');
    expect(rail).not.toContain('RailBingoDraft');
    expect(rail).not.toContain('aria-label="图纸与照片"');
    expect(rail).not.toContain('aria-label="场地重建"');
    expect(rail).not.toContain('aria-label="生成物件"');
    expect(rail).not.toContain('aria-label="场地观感与物料"');
    expect(column).not.toContain('WorkbenchBrandToggle');
    expect(column).not.toContain('<AssistantSessionDock');
    expect(column).toContain('<BingoReviewPanel');
    expect(source).not.toContain('<AgentReopenCard');
    expect(source).not.toContain('<CanvasHeading');
    const chat = readFileSync(join(here, '../panels/agent-panel.tsx'), 'utf8');
    const chatCss = readFileSync(join(here, '../panels/agent-panel.css'), 'utf8');
    expect(chat).toContain('aria-label="会话历史"');
    expect(chat).toContain('<SessionHistoryPanel');
    expect(chat).toContain('embedded');
    expect(chat).not.toContain('mascot-slot');
    expect(chat).toContain('ap-session-mascot');
    expect(chat).not.toMatch(/BrandMark|sc-nav-brand|幕景/);
    expect(chatCss).toMatch(/\.ap-history-overlay\s*\{[^}]*max-height:\s*33\.333%/);
    expect(css).toMatch(/:not\(\.is-agent-collapsed\)[^{]*sc-rail-qingguang img[^}]*visibility:\s*hidden/);
    expect(css).toMatch(/\.sc-left-column \.sc-agent-panel \.sc-nav-brand[^}]*display:\s*none/);
    const bingo = readFileSync(join(here, '../panels/bingo-review-panel.tsx'), 'utf8');
    expect(bingo).toContain('data-bingo-side="developer"');
    expect(bingo).not.toMatch(/href=\{?plan\.href/);
    expect(bingo).not.toMatch(/打开评审页<\/a>/);
    expect(bingo).toContain('复制甲方评审链接');
    expect(bingo).toContain('在画布场地点钉');
    expect(source).toContain('enterVenueReviewPins');
    expect(source).toContain("setWorkbenchMode('review')");
    const clientReview = readFileSync(join(here, '../../review-share-page/review-share-page.tsx'), 'utf8');
    expect(clientReview).toContain('ReviewSharePlanStage');
    expect(clientReview).not.toContain('发表评论');
  });

  it('does not store a separate navExpanded flag beside the two doors', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).not.toMatch(/navExpanded\s*=\s*useState|const \[navExpanded/);
    expect(source).toContain('leftColumnOpen');
    expect(source).toContain('toggleNavColumns');
    expect(source).toContain('isNavExpanded');
  });
});
