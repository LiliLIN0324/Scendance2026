import { describe, expect, it } from 'vitest';
import { planRightClickAction } from './plan-right-click';

describe('planRightClickAction', () => {
  it('cancels a pending placement instead of opening the facility menu', () => {
    expect(planRightClickAction({ mode: 'facility', placing: true, draftCount: 0 })).toBe('cancel-placement');
  });

  it('leaves ordinary facility editing untouched when nothing is pending', () => {
    expect(planRightClickAction({ mode: 'facility', placing: false, draftCount: 0 })).toBe('ignore');
  });

  it('keeps right-click removing the last vertex while drawing rings/routes', () => {
    expect(planRightClickAction({ mode: 'zone', placing: false, draftCount: 3 })).toBe('remove-draft-vertex');
    expect(planRightClickAction({ mode: 'boundary', placing: false, draftCount: 1 })).toBe('remove-draft-vertex');
    expect(planRightClickAction({ mode: 'route', placing: false, draftCount: 2 })).toBe('remove-draft-vertex');
    expect(planRightClickAction({ mode: 'zone', placing: false, draftCount: 0 })).toBe('ignore');
  });

  it('keeps the existing facility context menu in browse/select', () => {
    expect(planRightClickAction({ mode: 'view', placing: false, draftCount: 0 })).toBe('context-menu');
    expect(planRightClickAction({ mode: 'select', placing: false, draftCount: 0 })).toBe('context-menu');
  });
});
