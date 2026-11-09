// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('左栏助手与下方工具', () => {
  it('keeps the assistant toggle and puts space, materials, and handoff under it', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    const brand = source.indexOf('<WorkbenchBrandToggle');
    const primaryStart = source.indexOf('sc-mode-rail-primary');
    const primaryEnd = source.indexOf('sc-mode-rail-foot');
    const primary = source.slice(primaryStart, primaryEnd);
    expect(brand).toBeGreaterThan(-1);
    expect(primaryStart).toBeGreaterThan(brand);
    expect(primary).not.toContain('<BingoRailButton');
    expect(primary).not.toContain('aria-label="空间"');
    expect(primary).not.toContain('aria-label="物料"');
    expect(primary).not.toContain('sc-rail-disc');
    expect(primary).not.toContain('<House');
    expect(primary).not.toContain('<Boxes');
    expect(primary).not.toContain('sc-space-chevron');
    expect(primary).not.toContain('sc-rail-word');
    expect(primary).not.toContain('title="空间"');
    expect(primary).not.toContain('title="物料"');
    expect(source).toContain('<TaskToolShelf');
    expect(source).toContain('activeAgent="door"');
    expect(source).toContain("openToolGroup('space')");
    expect(source).toContain("openToolGroup('material')");
    expect(source).toContain("toggleSidebar: () => openToolGroup('material')");
    expect(source).not.toContain("toggleSidebar: () => toggleAgent('material')");
    expect(source).not.toContain("showAgent('space')");
    expect(source).not.toContain("showAgent('material')");
    expect(source).not.toContain('id="workbench-library-shelf"');
    expect(source).not.toContain('id="workbench-space-shelf"');
    expect(source).not.toContain('id="workbench-material-shelf"');
    expect(primary).not.toContain('<VenueRailButton');
    expect(primary).not.toContain('Store');
    expect(source).not.toContain('<VenueRailButton');
    expect(source).not.toContain('aria-label="场地"');
    expect(source).not.toContain('title="设置"');
    expect(source).not.toContain('RailAgentBrandSlot');
    expect(source).not.toContain('QingguangAvatarFlight');
    expect(source).not.toContain("sidePanel === 'bingo'");
    expect(source).toContain('const toggleAgent = useCallback');
    expect(source).not.toContain("onOpen={() => toggleAgent('bingo')}");
    const css = readFileSync(join(here, '../../../app/globals.css'), 'utf8');
    const bingoSource = readFileSync(join(here, 'bingo-rail-button.tsx'), 'utf8');
    const brandSource = readFileSync(join(here, 'workbench-brand-toggle.tsx'), 'utf8');
    expect(bingoSource).toContain('sc-rail-disc');
    expect(bingoSource).toContain('<RailAvatar form="ball"');
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
    expect(source).toContain('<PlannerSpace');
    expect(source).toContain('<PlannerMaterials');
    expect(source).toContain("onToggle={() => toggleAgent('door')}");
    expect(source).not.toContain('<MapRailButton');
    expect(source).not.toContain('AgentReopenCard');
  });
});
