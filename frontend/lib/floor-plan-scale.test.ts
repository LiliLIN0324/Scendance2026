import { describe, expect, it } from 'vitest';
import { normalizeRulerPoints, proposeScaleMeters } from './floor-plan-scale';

describe('proposeScaleMeters', () => {
  it('prefers parsed width from dimension text', () => {
    const result = proposeScaleMeters({
      normalizedSpan: 0.6,
      imageWidth: 1000,
      imageHeight: 800,
      dimensionText: '总宽 18 米，总深 9 米',
    });
    expect(result.meters).toBe(18);
    expect(result.aiSuggested).toBe(true);
    expect(result.hint).toBe('AI 建议，可改');
  });

  it('returns an editable default when no hints exist', () => {
    const result = proposeScaleMeters({
      normalizedSpan: 0.5,
      imageWidth: 1200,
      imageHeight: 900,
    });
    expect(result.meters).toBe(6);
    expect(result.confidence).toBe('low');
  });

  it('delegates to external proposer when provided', () => {
    const result = proposeScaleMeters({
      normalizedSpan: 0.2,
      imageWidth: 100,
      imageHeight: 100,
      externalProposer: () => ({ meters: 7.5, aiSuggested: true, hint: 'AI 建议，可改', confidence: 'high' }),
    });
    expect(result.meters).toBe(7.5);
    expect(result.confidence).toBe('high');
  });
});

describe('normalizeRulerPoints', () => {
  it('stores 0..1 image coordinates', () => {
    const { start, end } = normalizeRulerPoints({ x: 100, z: 50 }, { x: 900, z: 50 }, 1000, 500);
    expect(start).toEqual({ x: 0.1, z: 0.1 });
    expect(end).toEqual({ x: 0.9, z: 0.1 });
  });
});
