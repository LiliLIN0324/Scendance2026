import { describe, expect, it } from 'vitest';
import {
  PLANNING_ICONS,
  PLANNING_LAYER_COLORS,
  PLANNING_RADIUS,
  PLANNING_SPACING,
} from './outdoor-plan-tokens';

describe('outdoor 2D planning tokens (H1-c)', () => {
  it('uses the single brand deep green as the primary colour (no new green)', () => {
    expect(PLANNING_LAYER_COLORS.boundary).toBe('#35624A');
    expect(PLANNING_LAYER_COLORS.boundary.toLowerCase()).toBe('#35624a');
  });

  it('keeps spacing strictly increasing and on a small, compact scale', () => {
    const s = PLANNING_SPACING;
    const vals = [s.xs, s.sm, s.md, s.lg, s.xl];
    for (let i = 1; i < vals.length; i++) expect(vals[i]!).toBeGreaterThan(vals[i - 1]!);
    expect(s.xl).toBeLessThanOrEqual(24);
  });

  it('keeps radius positive and small', () => {
    expect(PLANNING_RADIUS.md).toBeGreaterThan(PLANNING_RADIUS.sm);
    expect(PLANNING_RADIUS.lg).toBeGreaterThan(PLANNING_RADIUS.md);
    expect(PLANNING_RADIUS.lg).toBeLessThanOrEqual(14);
  });

  it('uses lowercase #rrggbb for every layer colour', () => {
    for (const value of Object.values(PLANNING_LAYER_COLORS)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('registers a non-empty set of kebab-case lucide icon names', () => {
    expect(PLANNING_ICONS.length).toBeGreaterThan(5);
    for (const name of PLANNING_ICONS) expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(new Set(PLANNING_ICONS).size).toBe(PLANNING_ICONS.length);
  });
});