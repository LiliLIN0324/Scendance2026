import { describe, expect, it } from 'vitest';
import { makeInteractableEntry } from './interact-registry';
import {
  INTERACTABLE_GROUND_Y,
  facilityInteractables,
  interactHintLabel,
  propInteractables,
  seatInteractables,
  workerInteractables,
} from './outdoor-interactables';

describe('workerInteractables', () => {
  it('maps a worker point to an npc entry with world-coordinate snapshot', () => {
    const [entry] = workerInteractables([
      { id: 'w1', role: '保安', count: 1, position: { x: 4, y: -6 } },
    ]);
    expect(entry?.id).toBe('w1');
    expect(entry?.kind).toBe('npc');
    expect(entry?.label).toBe('保安');
    expect(entry?.position).toEqual({ x: 4, y: INTERACTABLE_GROUND_Y, z: 6 });
    expect(entry?.subtitle).toBeUndefined();
  });

  it('marks a multi-copy worker count in the subtitle', () => {
    const [entry] = workerInteractables([
      { id: 'w2', role: '志愿者', count: 3, position: { x: -2, y: 5 } },
    ]);
    expect(entry?.subtitle).toBe('3 人');
    expect(entry?.position).toEqual({ x: -2, y: INTERACTABLE_GROUND_Y, z: -5 });
  });

  it('honours a custom ground y and keeps an empty list empty', () => {
    const [entry] = workerInteractables(
      [{ id: 'w3', role: '医务', count: 1, position: { x: 0, y: 0 } }],
      0.1,
    );
    expect(entry?.position?.y).toBe(0.1);
    expect(workerInteractables([])).toEqual([]);
  });
});

describe('facilityInteractables', () => {
  it('maps a facility to a facility entry with world-coordinate snapshot', () => {
    const [entry] = facilityInteractables([
      { id: 'f1', name: '签到岗亭', position: { x: 3, y: -4 } },
    ]);
    expect(entry?.id).toBe('f1');
    expect(entry?.kind).toBe('facility');
    expect(entry?.label).toBe('签到岗亭');
    expect(entry?.position).toEqual({ x: 3, y: INTERACTABLE_GROUND_Y, z: 4 });
    expect(entry?.subtitle).toBeUndefined();
  });

  it('honours a custom ground y and keeps an empty list empty', () => {
    const [entry] = facilityInteractables(
      [{ id: 'f2', name: '舞台', position: { x: 0, y: 0 } }],
      0.1,
    );
    expect(entry?.position?.y).toBe(0.1);
    expect(facilityInteractables([])).toEqual([]);
  });
});

describe('seatInteractables', () => {
  it('maps a chair to a seat entry with world position and seat metadata', () => {
    const [entry] = seatInteractables([
      { id: 'c1', name: '餐椅', ref: 'x-dining-chair-y', position: { x: 3, y: -4 }, rotationDeg: 90 },
    ]);
    expect(entry?.kind).toBe('seat');
    expect(entry?.label).toBe('坐下 · 餐椅');
    expect(entry?.position).toEqual({ x: 3, y: INTERACTABLE_GROUND_Y, z: 4 });
    expect(entry?.seat).toEqual({
      x: 3,
      y: -4,
      rotationDeg: 90,
      seatHeight: 0.45,
      eyeY: INTERACTABLE_GROUND_Y + 0.45 + 0.63,
    });
    expect(entry?.personAction).toBe('sit');
  });

  it('drops non-seat facilities and keeps an empty list empty', () => {
    const entries = seatInteractables([
      { id: 't1', name: '长桌', ref: 'x-table-y', position: { x: 0, y: 0 } },
    ]);
    expect(entries).toEqual([]);
  });
});

describe('propInteractables', () => {
  it('keeps seats as seat entries and gives tables / stages the matching action label', () => {
    const entries = propInteractables([
      { id: 'c1', name: '木质餐椅', position: { x: 1, y: 2 } },
      { id: 't1', name: '木桌', position: { x: 3, y: -4 } },
      { id: 's1', name: '舞台', position: { x: 0, y: 0 } },
    ]);
    const seat = entries.find(entry => entry.id === 'c1');
    const table = entries.find(entry => entry.id === 't1');
    const stage = entries.find(entry => entry.id === 's1');
    expect(seat?.kind).toBe('seat');
    expect(seat?.label).toBe('坐下 · 木质餐椅');
    expect(seat?.seat?.seatHeight).toBe(0.45);
    expect(seat?.personAction).toBe('sit');
    expect(table?.kind).toBe('facility');
    expect(table?.label).toBe('交谈 · 木桌');
    expect(table?.personAction).toBe('talk');
    expect(table?.position).toEqual({ x: 3, y: INTERACTABLE_GROUND_Y, z: 4 });
    expect(stage?.label).toBe('挥手 · 舞台');
    expect(stage?.personAction).toBe('wave');
  });

  it('keeps one entry per facility, including inert props, without duplicating seats', () => {
    const entries = propInteractables([
      { id: 'c1', name: '长椅', position: { x: 1, y: 2 } },
      { id: 'f1', name: '围栏', position: { x: 3, y: 4 } },
      { id: 'p1', name: '绿植', position: { x: 5, y: 6 } },
    ]);
    expect(entries).toHaveLength(3);
    expect(entries.filter(entry => entry.id === 'c1')).toHaveLength(1);
    expect(entries.find(entry => entry.id === 'f1')?.label).toBe('围栏');
    expect(entries.find(entry => entry.id === 'p1')?.label).toBe('绿植');
    expect(entries.find(entry => entry.id === 'f1')?.personAction).toBeUndefined();
    expect(entries.find(entry => entry.id === 'p1')?.personAction).toBeUndefined();
  });

  it('uses templateId / modelOverride as the real PlanFacility ref', () => {
    const entries = propInteractables([
      { id: 'c1', name: '物件 A', templateId: 'dining-chair-timber', position: { x: 0, y: 0 } },
      { id: 'b1', name: '物件 B', templateId: 'booth-2x2', position: { x: 1, y: 1 } },
      { id: 's1', name: '物件 C', modelOverride: 'festival-stage-deck', position: { x: 2, y: 2 } },
    ]);
    expect(entries.find(entry => entry.id === 'c1')?.kind).toBe('seat');
    expect(entries.find(entry => entry.id === 'c1')?.label).toBe('坐下 · 物件 A');
    expect(entries.find(entry => entry.id === 'b1')?.label).toBe('交谈 · 物件 B');
    expect(entries.find(entry => entry.id === 's1')?.label).toBe('挥手 · 物件 C');
  });

  it('honours a custom ground y and keeps an empty list empty', () => {
    const [entry] = propInteractables(
      [{ id: 't1', name: '服务台', position: { x: 0, y: 0 } }],
      0.2,
    );
    expect(entry?.position?.y).toBe(0.2);
    expect(propInteractables([])).toEqual([]);
  });
});

describe('interactHintLabel', () => {
  const seat = makeInteractableEntry({ id: 'c1', kind: 'seat', label: '坐下 · 餐椅', position: { x: 3, y: 0.052, z: 4 } });
  const facility = makeInteractableEntry({ id: 'f1', kind: 'facility', label: '签到岗亭', position: { x: 0, y: 0.052, z: 0 } });

  it('keeps the sit label when not seated', () => {
    expect(interactHintLabel(seat, false)).toBe('坐下 · 餐椅');
  });

  it('switches to stand-up label when seated on the same seat', () => {
    expect(interactHintLabel(seat, true)).toBe('起身 · 餐椅');
  });

  it('never rewrites a non-seat entry label', () => {
    expect(interactHintLabel(facility, true)).toBe('签到岗亭');
  });
});
