import { describe, expect, it } from 'vitest';
import {
  EXPORT_MENU_ITEMS,
  GUIDE_STEPS,
  GUIDE_STEP_CONTENT,
  completeGuideStep,
  currentGuideStep,
  dismissGuide,
  guideWillAppear,
  initialGuideState,
  parseGuideState,
  restartGuide,
  shareDialogContent,
} from './site-plan-guide';

describe('progressive first-open guide (H4-b)', () => {
  it('discloses steps in order and hides when all done or dismissed', () => {
    let state = initialGuideState();
    expect(currentGuideStep(state)).toBe('welcome');
    state = completeGuideStep(state, 'welcome');
    expect(currentGuideStep(state)).toBe('layers');
    state = completeGuideStep(state, 'layers');
    expect(currentGuideStep(state)).toBe('edit');
    state = completeGuideStep(state, 'edit');
    expect(currentGuideStep(state)).toBeNull();
    expect(guideWillAppear(state)).toBe(false);
  });

  it('dismisses the whole guide at once and stays quiet', () => {
    const dismissed = dismissGuide(initialGuideState());
    expect(currentGuideStep(dismissed)).toBeNull();
    expect(dismissed.done).toEqual([...GUIDE_STEPS]);
  });

  it('keeps completion idempotent and order-stable', () => {
    let state = initialGuideState();
    state = completeGuideStep(state, 'welcome');
    state = completeGuideStep(state, 'welcome'); // 重复完成不改状态。
    expect(state.done).toEqual(['welcome']);
  });

  it('parses persisted state leniently and falls back on garbage', () => {
    expect(parseGuideState({ done: ['welcome'], dismissed: false })).toEqual({ done: ['welcome'], dismissed: false });
    expect(parseGuideState({ done: ['welcome', 'bogus'], dismissed: true })).toEqual({ done: ['welcome'], dismissed: true });
    expect(parseGuideState(null)).toEqual(initialGuideState());
    expect(parseGuideState({ done: 'welcome' })).toEqual(initialGuideState());
    expect(parseGuideState(42)).toEqual(initialGuideState());
  });

  it('restarts the guide explicitly regardless of prior state', () => {
    const dismissed = dismissGuide(initialGuideState());
    const restarted = restartGuide(dismissed);
    expect(currentGuideStep(restarted)).toBe('welcome');
    expect(restarted.dismissed).toBe(false);
  });

  it('exposes content for every step with title/body/cta', () => {
    for (const step of GUIDE_STEPS) {
      const content = GUIDE_STEP_CONTENT[step];
      expect(content.title.length).toBeGreaterThan(0);
      expect(content.body.length).toBeGreaterThan(4);
      expect(content.cta.length).toBeGreaterThan(0);
    }
  });
});

describe('export menu & share dialog form (H4-b)', () => {
  it('lists the four export items in OnePlan-parity order', () => {
    expect(EXPORT_MENU_ITEMS.map(item => item.id)).toEqual(['png', 'csv', 'geojson', 'share']);
    for (const item of EXPORT_MENU_ITEMS) {
      expect(item.label.length).toBeGreaterThan(1);
      expect(item.hint.length).toBeGreaterThan(3);
    }
  });

  it('builds the share dialog content from the snapshot summary', () => {
    const dialog = shareDialogContent({
      revision: 7,
      updatedAt: '2026-11-10 13:30',
      counts: { zones: 3, facilities: 5, routes: 2, workers: 4 },
    });
    expect(dialog.title).toBe('分享只读规划');
    expect(dialog.lines[0]).toContain('r7');
    expect(dialog.lines[1]).toBe('3 分区 · 5 设施 · 2 动线 · 4 人员');
    expect(dialog.lines[2]).toContain('只读');
  });
});