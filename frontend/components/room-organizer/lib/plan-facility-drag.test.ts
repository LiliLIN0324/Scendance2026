import { afterEach, describe, expect, it } from 'vitest';
import { clearPlanFacilityDrag, getPlanFacilityDrag, setPlanFacilityDrag } from './plan-facility-drag';

describe('plan facility drag store', () => {
  afterEach(() => clearPlanFacilityDrag());

  it('keeps the dragged template id available during dragover', () => {
    expect(getPlanFacilityDrag()).toBeNull();
    setPlanFacilityDrag('oneplan:icon:tent');
    expect(getPlanFacilityDrag()).toBe('oneplan:icon:tent');
  });

  it('clears on dragend/drop so the next pointer move has no stale ghost', () => {
    setPlanFacilityDrag('pack:market:stall');
    clearPlanFacilityDrag();
    expect(getPlanFacilityDrag()).toBeNull();
  });
});
