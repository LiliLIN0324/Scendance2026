import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPlanFacilityDrag, consumePlanFacilityDrag, getPlanFacilityDrag, setPlanFacilityDrag } from './plan-facility-drag';

describe('plan facility drag store', () => {
  afterEach(() => {
    consumePlanFacilityDrag();
    vi.useRealTimers();
  });

  it('keeps the dragged template id available during dragover', () => {
    expect(getPlanFacilityDrag()).toBeNull();
    setPlanFacilityDrag('oneplan:icon:tent');
    expect(getPlanFacilityDrag()).toBe('oneplan:icon:tent');
  });

  it('keeps the id until the dragend timer so a drop in the same turn can still read it', () => {
    vi.useFakeTimers();
    setPlanFacilityDrag('pack:market:stall');
    clearPlanFacilityDrag();
    expect(getPlanFacilityDrag()).toBe('pack:market:stall');
    vi.runAllTimers();
    expect(getPlanFacilityDrag()).toBeNull();
  });
});
