import { describe, expect, it } from 'vitest';
import {
  CROWD_TYPE_MODELS,
  CROWD_TYPES,
  crowdTypeModelSlugs,
  crowdTypeModelStatus,
  crowdTypeStatusLabel,
} from './crowd-types';

describe('crowd type low-poly wiring', () => {
  it('assigns each low-poly person to at most one crowd type', () => {
    const slugs = Object.values(CROWD_TYPE_MODELS).flat();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('only maps slugs onto known crowd types', () => {
    const ids = new Set(CROWD_TYPES.map(type => type.id));
    for (const id of Object.keys(CROWD_TYPE_MODELS)) {
      expect(ids.has(id)).toBe(true);
      expect(crowdTypeModelSlugs(id).length).toBeGreaterThan(0);
    }
  });

  it('marks walk, low-poly, and empty types distinctly', () => {
    expect(crowdTypeModelStatus('performer')).toBe('walk');
    expect(crowdTypeStatusLabel('performer')).toBe('有漫游模型');
    expect(crowdTypeModelStatus('medical')).toBe('lowpoly');
    expect(crowdTypeStatusLabel('fire')).toBe('有低模');
    expect(crowdTypeModelStatus('staff')).toBe('lowpoly');
    expect(crowdTypeModelStatus('exhibitor')).toBe('lowpoly');
    expect(crowdTypeModelStatus('audience')).toBe('lowpoly');
    expect(crowdTypeModelStatus('security')).toBe('todo');
    expect(crowdTypeModelStatus('police')).toBe('todo');
    expect(crowdTypeModelStatus('volunteer')).toBe('todo');
    expect(crowdTypeModelStatus('executive')).toBe('todo');
    expect(crowdTypeModelStatus('manager')).toBe('todo');
    expect(crowdTypeModelStatus('admin')).toBe('todo');
    expect(crowdTypeStatusLabel('security')).toBe('待补模型');
    expect(crowdTypeStatusLabel('performer')).toBe('有漫游模型');
  });
});
