import { describe, expect, it } from 'vitest';
import { makeInteractableEntry } from './interact-registry';
import {
  INTERACTABLE_GROUND_Y,
  facilityInteractables,
  interactHintLabel,
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
  });

  it('drops non-seat facilities and keeps an empty list empty', () => {
    const entries = seatInteractables([
      { id: 't1', name: '长桌', ref: 'x-table-y', position: { x: 0, y: 0 } },
    ]);
    expect(entries).toEqual([]);
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
