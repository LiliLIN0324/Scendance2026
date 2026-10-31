// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('空间与物料轨和壳层共存', () => {
  it('keeps 锁/晴光, Bingo, 空间, 物料, and the venue sidebar plus the flight import', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    const brand = source.indexOf('<RailAgentBrandSlot');
    const bingo = source.indexOf('<BingoRailButton');
    const space = source.indexOf('aria-label="空间"');
    const materials = source.indexOf('aria-label="物料"');
    const venue = source.indexOf('<VenueRailButton');
    expect(brand).toBeGreaterThan(-1);
    expect(bingo).toBeGreaterThan(brand);
    expect(space).toBeGreaterThan(bingo);
    expect(materials).toBeGreaterThan(space);
    expect(venue).toBeGreaterThan(materials);
    expect(source).toContain("import { QingguangAvatarFlight } from './panels/qingguang-avatar-flight'");
    expect(source).toContain('<QingguangAvatarFlight');
    expect(source).toContain("sidePanel === 'bingo' && <BingoPanel");
    expect(source).toContain("sidePanel === 'venue' && <VenueLibraryPanel");
    expect(source).toContain('<SpacePanel');
    expect(source).not.toContain('<MapRailButton');
    expect(source).not.toContain('AgentReopenCard');
  });
});
