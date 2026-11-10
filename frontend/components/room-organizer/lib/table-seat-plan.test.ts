import { describe, expect, it } from 'vitest';
import { itemsOverlap } from './geometry';
import { buildFurnitureSet } from './furniture-sets';
import { rectDiningSet, ringDiningSet } from './ring-seating';
import {
  DEFAULT_ROUND_DIAMETER_M,
  readTableRequest,
  rectSeatLayout,
  resolveTableArrangement,
  roundSeatLayout,
} from './table-seat-plan';
import type { FurnitureItem } from './types';

function placed(item: { width: number; depth: number; position?: { x: number; z: number }; rotation?: number }, id: string): FurnitureItem {
  return { id, type: 'dining-table', name: '桌', height: 0.75, color: '#A0522D', icon: '🟫', ...item, position: item.position ?? { x: 0, z: 0 } };
}

describe('table size drives the seat count', () => {
  it('seats more people when a round table gets wider, and the chairs stay off the box', () => {
    const small = roundSeatLayout(DEFAULT_ROUND_DIAMETER_M);
    const wide = roundSeatLayout(2.2);
    expect(small.seats).toBeGreaterThanOrEqual(6);
    expect(wide.seats).toBeGreaterThan(small.seats);
    const set = buildFurnitureSet(ringDiningSet({ sideM: 2.2 }), { idPrefix: 'wide', roomWidth: 20, roomDepth: 16 });
    const table = set.find(item => item.name === '圆桌')!;
    const chairs = set.filter(item => item.name === '餐椅');
    expect(chairs).toHaveLength(wide.seats);
    expect(table.width).toBe(2.2);
    for (const chair of chairs) expect(itemsOverlap(table, chair)).toBe(false);
  });

  it('seats a long table from its length and width, ends included only when they fit', () => {
    const narrow = rectSeatLayout(1.2, 0.6);
    const long = rectSeatLayout(2.4, 0.9);
    expect(long.seats).toBeGreaterThan(narrow.seats);
    expect(narrow.seats).toBeGreaterThan(0);
    const set = buildFurnitureSet(rectDiningSet({ width: 2.4, depth: 0.9 }), { idPrefix: 'long', roomWidth: 20, roomDepth: 16 });
    const table = set.find(item => item.name === '长桌')!;
    expect(set.filter(item => item.name === '餐椅')).toHaveLength(long.seats);
    for (const chair of set.filter(item => item.name === '餐椅')) expect(itemsOverlap(table, chair)).toBe(false);
    expect(placed(table, 't').width).toBe(2.4);
  });

  it('turns a headcount into tables, and a stated diameter into fewer larger tables', () => {
    const fallback = resolveTableArrangement({ shape: 'round', guests: 80 });
    const wider = resolveTableArrangement({ shape: 'round', guests: 80, width: 2.2 });
    expect(fallback.width).toBe(DEFAULT_ROUND_DIAMETER_M);
    expect(fallback.depth).toBe(fallback.width);
    expect(fallback.tables).toBe(Math.ceil(80 / fallback.seatsPerTable));
    expect(wider.seatsPerTable).toBeGreaterThan(fallback.seatsPerTable);
    expect(wider.tables).toBeLessThan(fallback.tables);
    expect(fallback.explanation).toContain(`每桌 ${fallback.seatsPerTable} 人`);
    expect(fallback.explanation).toContain('80 人');
  });

  it('grows a round table until the asked party fits, and a rect table along its length', () => {
    const atDefault = roundSeatLayout(DEFAULT_ROUND_DIAMETER_M).seats;
    const round = resolveTableArrangement({ shape: 'round', guests: 80, peoplePerTable: atDefault + 2 });
    expect(round.seatsPerTable).toBeGreaterThanOrEqual(atDefault + 2);
    expect(round.width).toBeGreaterThan(DEFAULT_ROUND_DIAMETER_M);
    expect(round.tables).toBe(Math.ceil(80 / round.seatsPerTable));
    const rect = resolveTableArrangement({ shape: 'rect', guests: 24, peoplePerTable: 8 });
    expect(rect.seatsPerTable).toBeGreaterThanOrEqual(8);
    expect(rect.width).toBeGreaterThan(1.8);
    expect(rect.tables).toBe(Math.ceil(24 / rect.seatsPerTable));
  });

  it('reads a round diameter or a rect size from the brief and ignores the venue', () => {
    expect(readTableRequest('想围着坐，圆桌直径1.8米，80人')).toMatchObject({ shape: 'round', width: 1.8, depth: 1.8 });
    expect(readTableRequest('长桌2.4×0.9米，每桌坐6人')).toMatchObject({ shape: 'rect', width: 2.4, depth: 0.9, peoplePerTable: 6 });
    expect(readTableRequest('室内20×15米，80人')).toBeUndefined();
  });
});
