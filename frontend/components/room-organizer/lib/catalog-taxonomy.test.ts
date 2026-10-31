import { describe, expect, it } from 'vitest';
import { catalogGroupKey, catalogGroupLabel, matchesCatalogFilter } from './catalog-taxonomy';
import { EVENT_CATALOG, FURNITURE_CATALOG } from './constants';

describe('event catalog groups', () => {
  it('puts built-in event props on stage, check-in and booth instead of home rooms', () => {
    const byId = Object.fromEntries(EVENT_CATALOG.map(item => [item.materialId, item.category]));
    expect(byId.reception).toBe('checkin');
    expect(byId.backdrop).toBe('stage');
    expect(byId.display).toBe('booth');
    expect(byId.chair).toBe('seating');
    expect(catalogGroupLabel('checkin')).toBe('签到');
    expect(catalogGroupLabel('stage')).toBe('舞台');
    expect(catalogGroupLabel('booth')).toBe('展位');
  });

  it('rolls legacy and online buckets into the same groups', () => {
    expect(catalogGroupKey('bedroom')).toBe('rest');
    expect(catalogGroupKey('kitchen')).toBe('catering');
    expect(catalogGroupKey('exhibition')).toBe('booth');
    expect(catalogGroupKey('audio')).toBe('av');
    expect(catalogGroupKey('lighting')).toBe('av');
    expect(catalogGroupKey('plants')).toBe('decor');
    expect(catalogGroupLabel('audio')).toBe('视听');
    expect(matchesCatalogFilter('audio', 'av')).toBe(true);
    expect(matchesCatalogFilter('audio', 'audio')).toBe(true);
    expect(matchesCatalogFilter('audio', 'storage')).toBe(false);
    expect(FURNITURE_CATALOG.find(entry => entry.type === 'tree')?.category).toBe('outdoor');
    expect(catalogGroupKey('outdoor')).toBe('site');
    expect(FURNITURE_CATALOG.find(entry => entry.type === 'fridge')?.category).toBe('catering');
  });
});
