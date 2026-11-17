// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BingoRailButton } from './bingo-rail-button';
import { SettingsMenu } from './settings-menu';
import { WorkbenchBrandToggle } from './workbench-brand-toggle';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, path), 'utf8');

afterEach(cleanup);

describe('left rail icon toggles', () => {
  it('names the brand control and reports the door lane separately from the column', () => {
    render(<WorkbenchBrandToggle expanded={false} active onToggle={() => {}} />);
    const open = screen.getByRole('button', { name: '展开导航栏' });
    expect(open.getAttribute('aria-label')).toBe('展开导航栏');
    expect(open.getAttribute('aria-pressed')).toBe('true');
    expect(open.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps 更多 pressed only while its menu is open', () => {
    render(<SettingsMenu />);
    const more = screen.getByRole('button', { name: '更多' });
    expect(more.getAttribute('aria-pressed')).toBe('false');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-pressed')).toBe('true');
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('reports Bingo as pressed while that lane is open', () => {
    const { rerender } = render(<BingoRailButton open={false} onOpen={() => {}} />);
    const closed = screen.getByRole('button', { name: /收反馈/ });
    expect(closed.getAttribute('aria-label')).toMatch(/收反馈/);
    expect(closed.getAttribute('aria-pressed')).toBe('false');
    rerender(<BingoRailButton open onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: /收反馈/ }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('map and walk icon button contract', () => {
  it('keeps accessible names, pressed state, and a keyboard ring on the left rail and the map controls', () => {
    const organizer = read('../room-organizer.tsx');
    const primary = organizer.slice(organizer.indexOf('sc-mode-rail-primary'), organizer.indexOf('sc-mode-rail-foot'));
    expect(primary).toContain('aria-label="空间"');
    expect(primary).toContain("aria-pressed={isLaneOpen('space')}");
    expect(primary).toContain('aria-label="物料"');
    expect(primary).toContain("aria-pressed={isLaneOpen('material')}");
    expect(primary).toContain('aria-label="场地：重建真实场地，或生成新场景"');
    expect(primary).toContain('aria-pressed={captureOpen || generationOpen}');
    expect(primary).toContain('aria-label="户外规划：在地图上画边界分区动线"');
    expect(primary).toContain('aria-pressed={outdoorPanel !== null}');
    expect(primary).toContain('aria-expanded={outdoorPanel !== null}');
    expect(primary).toContain('activeUserId={chatPeerId}');
    expect(organizer).toContain('aria-pressed={mobileRailOpen}');
    expect(read('rail-team-block.tsx')).toContain('aria-pressed={member.userId === activeUserId}');
    expect(read('cloud-panel.tsx')).toContain('aria-label="账户中心"');
    expect(read('cloud-panel.tsx')).toContain('aria-pressed={accountOpen}');
    expect(read('agent-panel.tsx')).toContain('aria-label="会话历史"');
    expect(read('agent-panel.tsx')).toContain('aria-pressed={showHistory}');
    expect(read('agent-panel.css')).toMatch(/\.ap-icon-btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ink-soft, #55585f\)/);

    const overlay = read('../components/outdoor-plan-overlay.tsx');
    const layerStart = overlay.indexOf('id="tool-outdoor-source"');
    const layer = overlay.slice(layerStart, overlay.indexOf('outdoor-layer-strip', layerStart));
    expect(layer).toContain('aria-label={`图层，当前底图');
    expect(layer).toContain('aria-pressed={layerStripOpen}');

    const tools = read('scendance-workspace.tsx');
    const stackStart = tools.indexOf('aria-label="地图控制"');
    const stack = tools.slice(stackStart, tools.indexOf('id="oc-tool-dock"', stackStart));
    expect(stack).toContain("aria-pressed={outdoor?.view === '3d'}");
    expect(stack).toContain('id="tool-walk"');
    expect(stack).toContain('aria-pressed={walkPressed}');
    expect(stack).toContain("aria-label={walkPressed ? '退出漫游' : '第一人称漫游'}");
    expect(stack).toContain('aria-label="放大"');
    expect(stack).toContain('aria-label="缩小"');
    expect(stack).toContain('aria-label={focusVenueTip ?? \'回到框选场地\'}');

    const css = read('../../../app/globals.css');
    expect(css).toMatch(/\.sc-mode-rail button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ink-soft, #55585f\);\s*outline-offset:\s*2px;/);
    expect(css).toContain('.sc-workbench .sc-tool-column #tool-walk:focus-visible');
    expect(css).toContain('.sc-workbench .sc-tool-column #tool-view-toggle:focus-visible');
    expect(css).toContain('.sc-workbench .sc-tool-column #tool-map-type:focus-visible');
    expect(css).toMatch(/#tool-walk:focus-visible,[\s\S]*?outline:\s*2px solid var\(--ink-soft, #55585f\);\s*outline-offset:\s*2px;/);
    expect(css).toMatch(/\.oc-gm-zoom button:focus-visible \{\s*outline-offset:\s*-2px;\s*\}/);
    expect(read('mobile-shell.css')).toMatch(/\.sc-mobile-agent-entry:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ink-soft, #55585f\)/);
  });
});
