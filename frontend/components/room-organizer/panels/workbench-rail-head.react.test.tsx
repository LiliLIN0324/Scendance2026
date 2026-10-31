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
    expect(primary).toContain('sc-space-chevron');
    expect(primary).toContain('<span className="sc-rail-word">空间</span>');
    expect(primary).toContain('<span className="sc-rail-word">物料</span>');
    expect(primary).not.toContain('场地');
    expect(primary).not.toContain('<VenueRailButton');
    expect(primary).not.toContain('Store');
    expect(source).not.toContain('<VenueRailButton');
    expect(source).not.toContain('aria-label="场地"');
    expect(source).toContain("import { QingguangAvatarFlight } from './panels/qingguang-avatar-flight'");
    expect(source).toContain('<QingguangAvatarFlight');
    expect(source).toContain("sidePanel === 'bingo' && <BingoPanel");
    expect(source).toContain("sidePanel === 'venue' && <VenueLibraryPanel");
    expect(source).toContain('<SpacePanel');
    expect(source).not.toContain('<MapRailButton');
    expect(source).not.toContain('AgentReopenCard');
  });
});
