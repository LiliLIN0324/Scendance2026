import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from './oneplan-library';
import {
  CATEGORY_PLAN_STICKERS,
  CROWD_TYPE_PLAN_STICKERS,
  GENERIC_PLAN_STICKER,
  planStickerForModel,
} from './plan-icon-for-model';

function entry(partial: Pick<LibraryEntry, 'slug' | 'kind' | 'nameZh' | 'nameEn' | 'categoryZh'>): LibraryEntry {
  return {
    id: `${partial.kind}:${partial.slug}`,
    slug: partial.slug,
    kind: partial.kind,
    sticker: { kind: partial.kind, slug: partial.slug, icon: 'shapes' },
    nameZh: partial.nameZh,
    nameEn: partial.nameEn,
    categoryZh: partial.categoryZh,
    width: 1,
    depth: 1,
    propKind: 'misc',
  };
}

describe('planStickerForModel', () => {
  it('prefers a same-name library sticker over the category default', () => {
    const entries = [entry({
      slug: 'folding-chair',
      kind: 'scale',
      nameZh: '折叠椅',
      nameEn: 'Folding Chair',
      categoryZh: '设施物料 / 家具',
    })];
    const sticker = planStickerForModel({ name: '折叠椅', slug: 'folding-chair-01', bucket: 'seating' }, entries);
    expect(sticker.slug).toBe('folding-chair');
    expect(sticker.kind).toBe('scale');
  });

  it('falls back to the category sticker when nothing in the library matches', () => {
    const sticker = planStickerForModel({ name: '未知物件', slug: 'zzz-unknown', bucket: 'seating' }, []);
    expect(sticker).toEqual(CATEGORY_PLAN_STICKERS['家具']);
  });

  it('uses the crowd-type sticker for a wired people model', () => {
    const sticker = planStickerForModel({ name: 'Firefighter', slug: 'low-poly-character-figures-firefighter-standing-8ded7b6f', bucket: 'people' }, []);
    expect(sticker).toEqual(CROWD_TYPE_PLAN_STICKERS.fire);
  });

  it('falls back to a generic sticker when the bucket is unknown', () => {
    const sticker = planStickerForModel({ name: 'Mystery', slug: 'mystery', bucket: '' }, []);
    expect(sticker).toEqual(GENERIC_PLAN_STICKER);
  });
});
