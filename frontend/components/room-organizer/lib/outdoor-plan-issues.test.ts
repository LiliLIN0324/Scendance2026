// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOutdoorPlanIssues,
  getOutdoorPlanIssues,
  onOutdoorPlanIssueFocus,
  publishOutdoorPlanIssues,
  requestOutdoorPlanIssueFocus,
  subscribeOutdoorPlanIssues,
} from './outdoor-plan-issues';

afterEach(() => clearOutdoorPlanIssues());

describe('outdoor plan issues bus', () => {
  it('publishes a snapshot and notifies subscribers once per change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOutdoorPlanIssues(listener);
    publishOutdoorPlanIssues([{ key: 'c-1', text: '主通道压线', anchor: { x: 2, y: 3 } }]);
    expect(getOutdoorPlanIssues()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    publishOutdoorPlanIssues([{ key: 'c-1', text: '主通道压线', anchor: { x: 2, y: 3 } }]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearOutdoorPlanIssues();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forwards a focus request with the issue key', () => {
    const handler = vi.fn();
    const off = onOutdoorPlanIssueFocus(handler);
    requestOutdoorPlanIssueFocus('f-stage-0');
    expect(handler).toHaveBeenCalledWith('f-stage-0');
    off();
    requestOutdoorPlanIssueFocus('f-stage-1');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
