import { describe, expect, it } from 'vitest';
import { SHORTCUT_CATALOG } from './shortcut-catalog';

describe('shortcut catalog', () => {
  it('keeps group ids unique and every entry has both platform keys', () => {
    const ids = SHORTCUT_CATALOG.map(group => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of SHORTCUT_CATALOG) {
      for (const entry of group.entries) {
        expect(entry.action.trim()).not.toBe('');
        expect(entry.keys.win.trim()).not.toBe('');
        expect(entry.keys.mac.trim()).not.toBe('');
      }
    }
  });

  it('keeps actions unique inside each group', () => {
    for (const group of SHORTCUT_CATALOG) {
      const actions = group.entries.map(entry => entry.action);
      expect(new Set(actions).size).toBe(actions.length);
    }
  });

  it('does not claim G toggles wall or object snapping', () => {
    const gridEntry = SHORTCUT_CATALOG.flatMap(group => group.entries).find(entry => entry.action === '网格吸附');
    expect(gridEntry?.note).toContain('只切网格');
    expect(gridEntry?.note).toContain('独立');
  });

  it('documents the walkthrough and layout-lock exceptions', () => {
    const notes = SHORTCUT_CATALOG.flatMap(group => group.notes ?? []).join('\n');
    expect(notes).toContain('一人称漫游');
    expect(notes).toContain('评审 / 交付锁定');
  });
});
