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
    expect(spaceBlock).toContain('<RailSpace size={28}');
    expect(materialBlock).toContain('<RailCrate size={28}');
    expect(primary).not.toContain('<House');
    expect(primary).not.toContain('<Boxes');
    // 空间、物料、创作、户外规划共用圆钮。创作钮打开同一页两张卡片。
    // 标签不再写「拍摄场地」——否则用户会以为点开只有拍摄。
    expect(primary.match(/sc-rail-disc/g)).toHaveLength(4);
    expect(primary).toContain('aria-label="创作：重建真实场地、文生 3D 或图生 3D"');
    expect(primary).not.toContain('生成新场景');
    expect(primary).toContain('sc-rail-3d-tag');
    // 点开的是统一生成面板首层，再点一次收起。
    expect(primary).toContain("onClick={() => {");
    expect(primary).toContain("openGenerationSheet({ scope: 'venue' })");
    expect(primary).toContain('closeGenerationSheet()');
    expect(primary).toContain('data-tip="创作"');
    expect(primary).toContain('>创作</span>');
    expect(primary).not.toContain('data-tip="场地"');
    expect(primary).not.toContain('>场地</span>');
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
    // 旧「场地」轨钮（VenueRailButton）已删；现在的场地钮是新写的一颗，带冒号后缀，
    // 所以仍然封着无后缀的「aria-label="场地"」，防止又回到无歧义的旧命名上。
    expect(primary).not.toContain('<VenueRailButton');
    expect(primary).not.toContain('Store');
    expect(source).not.toContain('<VenueRailButton');
    expect(source).not.toContain('aria-label="场地"');
    // 轨钮已改口，旧文案不应再出现在源码里（手机端另有简短入口，不在本次范围）。
    expect(source).not.toContain('aria-label="拍摄场地：拍完当场判断能不能重建，并出 3D"');
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
    const markSource = readFileSync(join(here, 'bingo-status-mark.tsx'), 'utf8');
    expect(bingoSource).toContain('sc-rail-disc');
    expect(bingoSource).toContain('<BingoStatusMark');
    expect(markSource).toContain('sc-bingo-badge');
    expect(bingoSource).toContain('bingoRingPath');
    expect(bingoSource).not.toContain('sc-bingo-corner');
    expect(brandSource).toContain('<RailHall size={28}');
    expect(brandSource).not.toContain('<RailAvatar');
    for (const icon of ['door', 'ball', 'pyramid', 'cube']) {
      expect(existsSync(join(here, '../../../public/assets/rail', `${icon}.png`))).toBe(true);
    }
    expect(css).not.toMatch(/span\.sc-rail-word\s*\{[^}]*display:\s*block/);
    expect(css).not.toMatch(/button\.is-active\[data-tip\]::after\s*\{\s*opacity:\s*1/);
    expect(css).toMatch(/--sc-nav-rail-width:\s*56px/);
    expect(css).toMatch(/button\.sc-rail-disc\s*\{[^}]*width:\s*40px[^}]*border:\s*0/);
    expect(css).toMatch(/button\.sc-rail-disc > span\.sc-rail-avatar\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/);
    expect(css).toMatch(/\.sc-rail-avatar-tilt\s*\{[^}]*rotateX\(var\(--tilt-x/);
    expect(css).toMatch(/\.sc-rail-hall-eyes\s*\{[^}]*translate\(var\(--eye-x/);
    expect(css).toMatch(/\.sc-rail-eye\s*\{[^}]*background:\s*#fff/);
    expect(brandSource).toContain('useEyeFollow');
    expect(brandSource).not.toContain('RailLaneDot');
    expect(primary).not.toContain('RailLaneDot');
    expect(css).not.toMatch(/button\.sc-rail-disc\.is-active::before\s*\{[^}]*width:\s*3px/);
    expect(css).not.toMatch(/button\.sc-nav-brand\.is-active::before\s*\{[^}]*width:\s*3px/);
    expect(css).toMatch(/button\.sc-rail-disc\.is-active::before[\s,][^}]*content:\s*none/);
    expect(css).not.toMatch(/button\.is-active::before\s*\{/);
    expect(css).not.toContain('.sc-rail-dot');
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
