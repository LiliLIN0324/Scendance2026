import { describe, expect, it } from 'vitest';
import { PLAN_SECTION_HEIGHT_M, isPlanCut, planSymbol } from './plan-style';
import type { FurnitureItem } from './types';

const item = (overrides: Partial<FurnitureItem>): FurnitureItem => ({
  id: 'x',
  type: 'chair',
  name: 'chair',
  category: 'seating',
  width: 0.5,
  depth: 0.5,
  height: 0.5,
  color: '#35634f',
  position: { x: 0, z: 0 },
  rotation: 0,
  ...overrides,
} as FurnitureItem);

describe('isPlanCut', () => {
  it('cuts a tall item that crosses the section plane', () => {
    expect(isPlanCut(item({ height: 1.8 }))).toBe(true);
  });

  it('keeps low furniture below the plane as an outline', () => {
    expect(isPlanCut(item({ height: 0.75 }))).toBe(false);
  });

  it('uses elevation, so a high shelf above the plane is not cut', () => {
    expect(isPlanCut(item({ height: 0.4, elevation: PLAN_SECTION_HEIGHT_M }))).toBe(false);
  });

  it('never cuts the wall plane, even a full-height door', () => {
    expect(isPlanCut(item({ type: 'door', height: 2.1 }))).toBe(false);
    expect(isPlanCut(item({ type: 'window', height: 1.2, elevation: 0.9 }))).toBe(false);
  });
});

describe('planSymbol', () => {
  it('maps the common families', () => {
    expect(planSymbol(item({ type: 'sofa' }))).toBe('sofa');
    expect(planSymbol(item({ type: 'table' }))).toBe('table');
    expect(planSymbol(item({ type: 'plant' }))).toBe('plant');
    expect(planSymbol(item({ type: 'stairs' }))).toBe('stairs');
    expect(planSymbol(item({ type: 'door' }))).toBe('opening');
  });

  it('falls back to the category for unknown type strings', () => {
    expect(planSymbol(item({ type: 'unknown-thing', category: 'av' }))).toBe('equipment');
    expect(planSymbol(item({ type: 'unknown-thing', category: 'tables' }))).toBe('table');
    expect(planSymbol(item({ type: 'unknown-thing', category: 'decor' }))).toBe('none');
  });
});
