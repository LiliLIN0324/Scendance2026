import { describe, expect, it } from 'vitest';
import { addCustomTag, emptyMaterialLibraryMeta, parseMaterialLibraryMeta, toggleAssignment, toggleFavorite } from './material-library-meta';

describe('material library meta', () => {
  it('toggles a favorite without dropping other ids', () => {
    const once = toggleFavorite(emptyMaterialLibraryMeta(), 'chair');
    expect(once.favorites).toEqual(['chair']);
    const twice = toggleFavorite(once, 'chair');
    expect(twice.favorites).toEqual([]);
  });

  it('rejects an empty or reserved tag and keeps a new one', () => {
    const blank = addCustomTag(emptyMaterialLibraryMeta(), '   ');
    expect(blank.tag).toBeNull();
    const taken = addCustomTag(emptyMaterialLibraryMeta(), '空间', ['空间']);
    expect(taken.error).toContain('已经有了');
    const created = addCustomTag(emptyMaterialLibraryMeta(), '  沙滩  ');
    expect(created.tag).toBe('沙滩');
    expect(created.meta.customTags).toEqual(['沙滩']);
  });

  it('assigns a custom tag onto a material and round-trips through JSON', () => {
    const created = addCustomTag(emptyMaterialLibraryMeta(), '我的');
    const tagged = toggleAssignment(created.meta, 'seating-chaise', '我的');
    expect(tagged.assignments['seating-chaise']).toEqual(['我的']);
    const cleared = toggleAssignment(tagged, 'seating-chaise', '我的');
    expect(cleared.assignments['seating-chaise']).toBeUndefined();
    const raw = JSON.stringify(tagged);
    expect(parseMaterialLibraryMeta(raw).assignments['seating-chaise']).toEqual(['我的']);
    expect(parseMaterialLibraryMeta('nope')).toEqual(emptyMaterialLibraryMeta());
  });
});
