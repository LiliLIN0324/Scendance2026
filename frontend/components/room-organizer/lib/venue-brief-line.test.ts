import { describe, expect, it } from 'vitest';
import { venueBriefLine } from './venue-brief-line';

describe('venue brief line', () => {
  it('joins event, headcount and meters with a middle dot', () => {
    expect(venueBriefLine({ event: '发布会', guests: '80 人', dims: '室内 · 12 × 9 m' })).toBe('发布会 · 80 人 · 室内 · 12 × 9 m');
  });

  it('keeps the line when the conversation has not named the event or the headcount', () => {
    expect(venueBriefLine({ event: null, guests: '', dims: '室内 · 12 × 8 m' })).toBe('活动还没说 · 人数还没说 · 室内 · 12 × 8 m');
  });
});
