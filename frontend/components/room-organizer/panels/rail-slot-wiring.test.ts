// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('rail slot wiring in room organizer', () => {
  it('derives brand vs qingguang from panel open and avatar landing', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    expect(source).toContain('railShowsBrand = qingguangPanelOpen && headerAvatarVisible');
    expect(source).toContain('railShowsQingguang = !railShowsBrand');
    expect(source).toContain('<RailAgentBrandSlot');
  });
});
