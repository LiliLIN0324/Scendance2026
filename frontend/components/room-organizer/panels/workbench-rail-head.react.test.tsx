// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('空间与物料轨和壳层共存', () => {
  it('keeps one 空间 control under Bingo, with 物料 last in that stack', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    const brand = source.indexOf('<RailAgentBrandSlot');
    const bingo = source.indexOf('<BingoRailButton');
    const primaryStart = source.indexOf('sc-mode-rail-primary');
    const primaryEnd = source.indexOf('sc-mode-rail-foot');
    const primary = source.slice(primaryStart, primaryEnd);
    const space = primary.indexOf('aria-label="空间"');
    const materials = primary.indexOf('aria-label="物料"');
    expect(brand).toBeGreaterThan(-1);
    expect(primaryStart).toBeGreaterThan(brand);
    expect(bingo).toBeGreaterThan(primaryStart);
    expect(space).toBeGreaterThan(-1);
    expect(materials).toBeGreaterThan(space);
    expect(primary.indexOf('aria-label="空间"')).toBe(primary.lastIndexOf('aria-label="空间"'));
    expect(primary.indexOf('aria-label="物料"')).toBe(primary.lastIndexOf('aria-label="物料"'));
    expect(primary).toContain('<SpaceIcon');
    expect(primary).toContain('sc-rail-space sc-rail-disc');
    expect(primary).toContain('sc-rail-materials sc-rail-disc');
    expect(primary).toContain('data-tip="空间"');
    expect(primary).toContain('data-tip="物料"');
    expect(primary).not.toContain('sc-space-chevron');
    expect(primary).not.toContain('sc-rail-word');
    expect(primary).not.toMatch(/>\s*物料\s*</);
    expect(primary).not.toContain('title="空间"');
    expect(primary).not.toContain('title="物料"');
    expect(primary).not.toContain('场地');
    expect(primary).not.toContain('<VenueRailButton');
    expect(primary).not.toContain('Store');
    expect(source).not.toContain('<VenueRailButton');
    expect(source).not.toContain('aria-label="场地"');
    expect(source).not.toContain('title="设置"');
    const css = readFileSync(join(here, '../../../app/globals.css'), 'utf8');
    const bingoSource = readFileSync(join(here, 'bingo-rail-button.tsx'), 'utf8');
    const qingguangSource = readFileSync(join(here, 'qingguang-rail-button.tsx'), 'utf8');
    expect(bingoSource).toContain('sc-rail-disc');
    expect(qingguangSource).toContain('sc-rail-disc');
    expect(css).not.toMatch(/span\.sc-rail-word\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/button\.is-active\[data-tip\]::after\s*\{\s*opacity:\s*1/);
    expect(css).toMatch(/button\.sc-rail-disc\s*\{[^}]*width:\s*40px[^}]*border-radius:\s*999px/);
    expect(css).toMatch(/button\.sc-rail-disc\.is-active::before\s*\{[^}]*left:\s*-4px[^}]*top:\s*7px[^}]*bottom:\s*7px[^}]*width:\s*3px/);
    expect(css).not.toMatch(/button\.is-active::before\s*\{/);
    expect(source).toContain("import { QingguangAvatarFlight } from './panels/qingguang-avatar-flight'");
    expect(source).toContain('<QingguangAvatarFlight');
    expect(source).toContain("sidePanel === 'bingo' && <BingoPanel");
    expect(source).toContain("sidePanel === 'venue' && <VenueLibraryPanel");
    expect(source).toContain('<SpacePanel');
    expect(source).not.toContain('<MapRailButton');
    expect(source).not.toContain('AgentReopenCard');
  });
});
