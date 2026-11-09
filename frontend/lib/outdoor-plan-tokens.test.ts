import { describe, expect, it } from 'vitest';
import {
  PLANNING_EDIT_MODE_LABELS,
  PLANNING_ICONS,
  PLANNING_LAYER_COLORS,
  PLANNING_RADIUS,
  PLANNING_SPACING,
  PLANNING_ZONE_COLORS,
  PLANNING_ZONE_OPACITY,
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

  it('gives every zone semantic a lowercase #rrggbb default colour (H2-b)', () => {
    const semantics = Object.keys(PLANNING_ZONE_COLORS) as (keyof typeof PLANNING_ZONE_COLORS)[];
    // 契约九类语义全量；卡片「六类」主语义（观众/停车/装卸/签到/医疗/排队）必须在内。
    expect(semantics).toContain('audience');
    expect(semantics).toContain('parking');
    expect(semantics).toContain('loading');
    expect(semantics).toContain('checkin');
    expect(semantics).toContain('medical');
    expect(semantics).toContain('queue');
    expect(semantics.length).toBe(9);
    for (const value of Object.values(PLANNING_ZONE_COLORS)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    // 主语义色互异，图例可辨。
    const mainSix = ['audience', 'parking', 'loading', 'checkin', 'medical', 'queue'] as const;
    expect(new Set(mainSix.map(s => PLANNING_ZONE_COLORS[s])).size).toBe(6);
  });

  it('keeps zone opacity in a sane editable band (H2-b)', () => {
    expect(PLANNING_ZONE_OPACITY.min).toBeGreaterThan(0);
    expect(PLANNING_ZONE_OPACITY.default).toBeGreaterThanOrEqual(PLANNING_ZONE_OPACITY.min);
    expect(PLANNING_ZONE_OPACITY.default).toBeLessThanOrEqual(PLANNING_ZONE_OPACITY.max);
    expect(PLANNING_ZONE_OPACITY.max).toBeLessThan(1);
  });

  it('labels all four canvas edit modes (H2-b)', () => {
    expect(Object.keys(PLANNING_EDIT_MODE_LABELS).sort()).toEqual(['boundary', 'boundary-vertex', 'view', 'zone']);
    expect(PLANNING_EDIT_MODE_LABELS['boundary-vertex']).toBe('编辑边界');
  });
});