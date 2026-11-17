import { describe, expect, it } from 'vitest';
import {
  facilityLibrarySizeResolver,
  findLibraryEntryByTemplateId,
  type LibraryEntry,
} from './oneplan-library';

/** 只填反查需要的字段；其余按真实 LibraryEntry 形状补一个占位。 */
function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  const base = {
    id: 'icon:chair-01',
    slug: 'chair-01',
    kind: 'icon',
    sticker: { kind: 'icon', slug: 'chair-01', icon: 'shapes' },
    nameZh: '椅子',
    nameEn: 'Chair',
    categoryZh: '座椅',
    width: 0.6,
    depth: 0.7,
    propKind: 'misc',
  } as unknown as LibraryEntry;
  return { ...base, ...overrides };
}

describe('oneplan-library templateId 反查（A1-5）', () => {
  it('按 oneplan: 前缀与 kind/slug 反查条目', () => {
    const chair = entry();
    expect(findLibraryEntryByTemplateId([chair], 'oneplan:icon:chair-01')).toBe(chair);
    expect(findLibraryEntryByTemplateId([chair], 'oneplan:scale:chair-01')).toBeNull();
  });

  it('兼容存量 library: 前缀', () => {
    const chair = entry();
    expect(findLibraryEntryByTemplateId([chair], 'library:icon:chair-01')).toBe(chair);
  });

  it('内置模板 id 与非法 id 返回 null，不抛错', () => {
    expect(findLibraryEntryByTemplateId([entry()], 'booth-2x2')).toBeNull();
    expect(findLibraryEntryByTemplateId([entry()], 'oneplan:icon')).toBeNull();
    expect(findLibraryEntryByTemplateId([entry()], 'oneplan:bogus:chair-01')).toBeNull();
  });

  it('尺寸解析器返回默认占地；查不到返回 undefined', () => {
    const resolve = facilityLibrarySizeResolver([entry()]);
    expect(resolve('oneplan:icon:chair-01')).toEqual({ width: 0.6, depth: 0.7 });
    expect(resolve('oneplan:icon:missing')).toBeUndefined();
    expect(resolve('booth-2x2')).toBeUndefined();
  });
});
