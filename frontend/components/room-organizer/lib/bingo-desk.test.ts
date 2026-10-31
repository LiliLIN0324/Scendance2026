import { describe, expect, it } from 'vitest';
import { readBingoFavorites, readBingoReviews, rememberBingoReview, toggleBingoFavorite } from './bingo-desk';

function memory(): Storage {
  const bag = new Map<string, string>();
  return {
    getItem: (key) => bag.get(key) ?? null,
    setItem: (key, value) => { bag.set(key, value); },
    removeItem: (key) => { bag.delete(key); },
    clear: () => { bag.clear(); },
    key: () => null,
    length: 0,
  };
}

describe('bingo desk', () => {
  it('keeps the latest pending review per plan and toggles a favorite', () => {
    const storage = memory();
    rememberBingoReview(storage, { title: '旧', href: '/review/#layout=old', planKey: 'local:house', id: 'a', now: new Date('2026-10-01T00:00:00Z') });
    const next = rememberBingoReview(storage, { title: '周末共创', href: '/review/#layout=new', planKey: 'local:house', id: 'b', now: new Date('2026-10-02T00:00:00Z') });
    expect(readBingoReviews(storage)).toEqual([next]);
    expect(toggleBingoFavorite(storage, 'b')).toEqual(['b']);
    expect(readBingoFavorites(storage)).toEqual(['b']);
    expect(toggleBingoFavorite(storage, 'b')).toEqual([]);
  });
});
