import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from './oneplan-library';
import { planStickerForModel } from './plan-icon-for-model';

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
  const entries = [
    entry({ slug: 'chair', kind: 'scale', nameZh: '椅子', nameEn: 'Chair', categoryZh: '设施物料 / 家具' }),
    entry({ slug: 'folding-chair', kind: 'scale', nameZh: '折叠椅', nameEn: 'Folding Chair', categoryZh: '设施物料 / 家具' }),
  ];

  it('shows a badge on the explicitly linked folding chair', () => {
    const sticker = planStickerForModel({ slug: 'izakaya-alley-and-ramen-shop-folding-chair-dbe1ca77' }, entries);
    expect(sticker).toEqual(entries[1].sticker);
  });

  it('shows the same badge on a reviewed variant', () => {
    const sticker = planStickerForModel({ slug: 'caravan-park-and-campsite-camping-chair-390fe145' }, entries);
    expect(sticker).toEqual(entries[1].sticker);
  });

  it('leaves unlinked chairs and unlinked models without a badge', () => {
    expect(planStickerForModel({ slug: 'folding-chair-01' }, entries)).toBeNull();
    expect(planStickerForModel({ slug: 'mystery' }, entries)).toBeNull();
  });
});
