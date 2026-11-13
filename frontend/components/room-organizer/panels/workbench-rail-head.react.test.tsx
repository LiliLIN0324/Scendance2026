// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('左轨四形与共用 Agent 面板', () => {
  it('keeps 门厅 / Bingo / 空间 / 物料 as four rail controls over one agent panel', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    const brand = source.indexOf('<WorkbenchBrandToggle');
    const primaryStart = source.indexOf('sc-mode-rail-primary');
    const primaryEnd = source.indexOf('sc-mode-rail-foot');
    const primary = source.slice(primaryStart, primaryEnd);
    const bingo = source.indexOf('<BingoRailButton', primaryStart);
    const space = source.indexOf('aria-label="空间"', primaryStart);
    const material = source.indexOf('aria-label="物料"', primaryStart);
    expect(brand).toBeGreaterThan(-1);
    expect(primaryStart).toBeGreaterThan(brand);
    expect(bingo).toBeGreaterThan(primaryStart);
    expect(bingo).toBeLessThan(space);
    expect(space).toBeGreaterThan(-1);
    expect(material).toBeGreaterThan(space);
    expect(primary).not.toContain('aria-label="空间与物料"');
    const spaceBlock = source.slice(space, material);
    const materialBlock = source.slice(material, primaryEnd);
    expect(spaceBlock).toContain('<LayoutGrid size={26}');
    expect(materialBlock).toContain('<Box size={26}');
    expect(primary).not.toContain('<House');
    expect(primary).not.toContain('<Boxes');
    // 空间、物料、拍摄场地、户外规划共用圆钮；标签沿用「拍完当场判断能不能重建，并出 3D」。
    expect(primary.match(/sc-rail-disc/g)).toHaveLength(4);
    expect(primary).toContain('aria-label="拍摄场地：拍完当场判断能不能重建，并出 3D"');
    expect(primary).toContain('onClick={captureOpen ? closeCapturePanel : openCapturePanel}');
    expect(primary).toContain('data-tip="空间"');
    expect(primary).toContain('data-tip="物料"');
    expect(primary).not.toContain('sc-space-chevron');
    expect(primary).not.toContain('sc-rail-word');
    expect(primary).toContain('sc-rail-label');
    expect(primary).not.toContain('title="空间"');
    expect(primary).not.toContain('title="物料"');
    expect(source).not.toContain('id="workbench-library-shelf"');
    expect(source).not.toContain('id="workbench-space-shelf"');
    expect(source).not.toContain('id="workbench-material-shelf"');
    expect(primary).not.toContain('aria-label="场地"');
    // 旧「场地」轨钮已删；「拍摄场地」（拍摄引导锚点）允许含「场地」二字，故只封具体名称。
    expect(primary).not.toContain('<VenueRailButton');
    expect(primary).not.toContain('Store');
    expect(source).not.toContain('<VenueRailButton');
    expect(source).not.toContain('aria-label="场地"');
    expect(source).not.toContain('title="设置"');
    expect(source).not.toContain('RailAgentBrandSlot');
    expect(source).not.toContain('QingguangAvatarFlight');
    expect(source).not.toContain("sidePanel === 'bingo'");
    expect(source).toContain('const toggleAgent = useCallback');
    expect(source).toContain("onOpen={() => toggleAgent('bingo')}");
    expect(source).toContain('activeAgent={activeAgent}');
    const css = readFileSync(join(here, '../../../app/globals.css'), 'utf8');
    const bingoSource = readFileSync(join(here, 'bingo-rail-button.tsx'), 'utf8');
    const brandSource = readFileSync(join(here, 'workbench-brand-toggle.tsx'), 'utf8');
    expect(bingoSource).toContain('sc-rail-disc');
    expect(bingoSource).toContain('sc-bingo-badge');
    expect(brandSource).toContain('<RailAvatar form="door"');
    for (const icon of ['door', 'ball', 'pyramid', 'cube']) {
      expect(existsSync(join(here, '../../../public/assets/rail', `${icon}.png`))).toBe(true);
    }
    expect(css).not.toMatch(/span\.sc-rail-word\s*\{[^}]*display:\s*block/);
    expect(css).not.toMatch(/button\.is-active\[data-tip\]::after\s*\{\s*opacity:\s*1/);
    expect(css).toMatch(/button\.sc-rail-disc\s*\{[^}]*width:\s*40px[^}]*border:\s*0/);
    expect(css).toMatch(/button\.sc-rail-disc > span\.sc-rail-avatar\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/);
    expect(css).toMatch(/\.sc-rail-avatar-tilt\s*\{[^}]*rotateX\(var\(--tilt-x/);
    expect(css).toMatch(/\.sc-rail-eye\s*\{[^}]*background:\s*#fff/);
    expect(css).toMatch(/button\.sc-rail-disc\.is-active::before\s*\{[^}]*left:\s*-4px[^}]*top:\s*7px[^}]*bottom:\s*7px[^}]*width:\s*3px/);
    expect(css).not.toMatch(/button\.is-active::before\s*\{/);
    expect(css).not.toContain('sc-rail-agent-brand-slot');
    expect(css).not.toContain('sc-bingo-ball');
    expect(source).not.toContain('<VenueLibraryPanel');
    expect(source).toContain('<SpacePanel variant="card"');
    expect(source).toContain('<ScendanceLibrary variant="card"');
    expect(source).toContain("onToggle={() => toggleAgent('door')}");
    expect(source).not.toContain('<MapRailButton />');
    expect(source).not.toContain('AgentReopenCard');
  });
});
