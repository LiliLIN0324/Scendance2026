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
    // 空间、物料、场地、户外规划共用圆钮。场地钮既承接「重建真实场地」也承接「生成新场景」，
    // 所以标签不再写「拍摄场地」——否则用户会以为点开只有拍摄。
    expect(primary.match(/sc-rail-disc/g)).toHaveLength(4);
    expect(primary).toContain('aria-label="场地：重建真实场地，或生成新场景"');
    expect(primary).toContain('sc-rail-capture-icon');
    expect(primary).toMatch(/sc-rail-capture-icon[\s\S]*<span className="sc-rail-3d-tag">3D<\/span>/);
    // 点开的是统一生成面板首层（只列场地两项），再点一次收起。
    expect(primary).toContain("onClick={() => {");
    expect(primary).toContain("openGenerationSheet({ scope: 'venue' })");
    expect(primary).toContain('closeGenerationSheet()');
    expect(primary).toContain('data-tip="场地"');
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
    expect(css).toMatch(/\.sc-mode-rail-primary\s*\{[^}]*gap:\s*4px/);
    expect(css).toMatch(/button\.sc-rail-disc\.is-active\s*\{[^}]*background:\s*var\(--wk-green-pale\)/);
    expect(css).toMatch(/button\.sc-rail-disc > span\.sc-rail-glyph\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/);
    expect(css).toMatch(/button\.sc-rail-disc > \.sc-rail-capture-icon\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/);
    expect(css).toMatch(/\.sc-rail-capture-icon > \.sc-rail-3d-tag\s*\{[^}]*position:\s*absolute[^}]*right:\s*-5px[^}]*bottom:\s*-3px/);
    expect(css).toMatch(/button\.sc-nav-brand\.is-active::before\s*\{[^}]*left:\s*-4px[^}]*width:\s*3px/);
    const icons = readFileSync(join(here, '../../solid-icons.tsx'), 'utf8');
    const glyphStart = icons.indexOf('const RAIL_STROKE = 1.6');
    const glyph = icons.slice(glyphStart);
    expect(glyphStart).toBeGreaterThan(-1);
    expect(glyph).toContain('sc-rail-glyph');
    expect(glyph).not.toContain('fill={active');
    expect(glyph).not.toContain('#FFFFFF');
    expect(glyph).toContain('r="8.75"');
    expect(glyph.match(/r="8\.75"/g)).toHaveLength(2);
    const spaceIcon = glyph.slice(glyph.indexOf('export const RailSpace'), glyph.indexOf('export const RailCrate'));
    const cells = [...spaceIcon.matchAll(/x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
      .map(match => match.slice(1).map(Number));
    expect(cells).toHaveLength(4);
    const [cellWidth, cellHeight] = [cells[0][2], cells[0][3]];
    for (const cell of cells) {
      expect(cell[2]).toBe(cellWidth);
      expect(cell[3]).toBe(cellHeight);
    }
    const xs = cells.map(cell => cell[0]).sort((a, b) => a - b);
    const ys = cells.map(cell => cell[1]).sort((a, b) => a - b);
    expect(xs[0]).toBe(3.25);
    expect(ys[0]).toBe(3.25);
    expect(xs[2] + cellWidth).toBeCloseTo(20.75);
    expect(ys[2] + cellHeight).toBeCloseTo(20.75);
    const gutter = xs[2] - (xs[0] + cellWidth);
    expect(gutter).toBeGreaterThan(1.6);
    expect(ys[2] - (ys[0] + cellHeight)).toBeCloseTo(gutter);
    expect(css).toMatch(/button\.sc-rail-disc\[aria-label="空间"\]:active\s*\{[^}]*background:\s*var\(--wk-plane-deep\)/);
    expect(css).toMatch(/button\.sc-rail-disc\[aria-label="空间"\]\.is-active:active\s*\{[^}]*color-mix\(in srgb, var\(--wk-green\) 22%, var\(--wk-paper\)\)/);
    expect(spaceIcon).not.toContain('fill=');
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
