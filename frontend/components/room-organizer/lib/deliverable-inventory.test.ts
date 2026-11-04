import { describe, expect, it } from 'vitest';
import {
  customerInventory,
  deliverableInventory,
  floorInventory,
  inventoryTotal,
  summarizeInventory,
} from './deliverable-inventory';
import type { FloorLayout, FurnitureItem, RoomLayout, RoomZone } from './types';

function floor(id: string, name: string, items: FurnitureItem[], zones?: RoomZone[]): FloorLayout {
  return { id, name, items, floorColor: '#f5f6f7', ...(zones ? { zones } : {}) };
}

function layout(...floors: FloorLayout[]): RoomLayout {
  return { name: '测试场地', width: 10, height: 8, floors } as RoomLayout;
}

function item(patch: Partial<FurnitureItem> & { id: string; name: string }): FurnitureItem {
  return {
    type: 'chair', width: 0.5, depth: 0.5, height: 0.9, color: '#ffffff',
    icon: '🪑', ...patch,
  } as FurnitureItem;
}

describe('deliverable inventory', () => {
  it('returns nothing for an empty scene', () => {
    expect(deliverableInventory(layout(floor('f1', '一层', [])))).toEqual([]);
    expect(inventoryTotal([])).toBe(0);
    expect(summarizeInventory([])).toEqual([]);
  });

  it('keeps the same name with different sizes as separate lines', () => {
    const scene = floor('f1', '一层', [
      item({ id: 'a', name: '椅子' }),
      item({ id: 'b', name: '椅子', width: 0.7 }),
      item({ id: 'c', name: '椅子' }),
    ]);
    const rows = floorInventory(scene);
    expect(rows.map(row => [row.width, row.quantity])).toEqual([[0.5, 2], [0.7, 1]]);
    expect(inventoryTotal(rows)).toBe(3);
    expect(summarizeInventory(rows)).toEqual([{ name: '椅子', quantity: 3, lockedCount: 0 }]);
  });

  it('does not count structural markers left by deleted doors or columns', () => {
    const scene = floor('f1', '一层', [
      item({ id: 'real', name: '椅子' }),
      item({ id: 'door', name: '出入口', venueEntranceId: 'e1' }),
      item({ id: 'opening', name: '门洞', structuralOpeningId: 'o1' }),
      item({ id: 'column', name: '立柱', structuralColumnId: 'c1' }),
    ]);
    expect(inventoryTotal(floorInventory(scene))).toBe(1);
    expect(floorInventory(scene).map(row => row.name)).toEqual(['椅子']);
  });

  it('groups by zone and keeps unplaced items outside any zone', () => {
    const scene = floor('f1', '一层', [
      item({ id: 'a', name: '椅子', position: { x: 0, z: 0 } }),
      item({ id: 'b', name: '椅子', position: { x: 4.5, z: 4.5 } }),
      item({ id: 'c', name: '椅子', position: { x: 8, z: 2 } }),
      item({ id: 'd', name: '椅子' }),
    ], [{ id: 'left', name: '左区', color: '#eee', x: 3, z: 3, w: 3, d: 3 }]);
    const rows = floorInventory(scene);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.zoneId === 'left')).toMatchObject({ zoneName: '左区', quantity: 1 });
    expect(rows.find(row => row.zoneId === null)).toMatchObject({ zoneName: null, quantity: 3 });
    expect(inventoryTotal(rows)).toBe(4);
  });

  it('folds floors together for the customer view but keeps them apart for execution', () => {
    const all = deliverableInventory(layout(
      floor('f1', '一层', [item({ id: 'a', name: '椅子' })]),
      floor('f2', '二层', [item({ id: 'b', name: '椅子' })]),
    ));
    expect(all.map(row => row.floorName)).toEqual(['一层', '二层']);
    const customer = customerInventory(all);
    expect(customer).toHaveLength(1);
    expect(customer[0]!.quantity).toBe(2);
    expect(customer[0]!.floors).toEqual(['一层', '二层']);
  });

  it('counts locked units without splitting the row', () => {
    const rows = floorInventory(floor('f1', '一层', [
      item({ id: 'a', name: '椅子', locked: true }),
      item({ id: 'b', name: '椅子' }),
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(2);
    expect(rows[0]!.lockedCount).toBe(1);
  });
});
