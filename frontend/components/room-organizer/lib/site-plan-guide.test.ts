import { describe, expect, it } from 'vitest';
import {
  DELIVERY_AUDIENCES,
  DELIVERY_EXPORT_ITEMS,
  DELIVERY_SEGMENTS,
  EXPORT_MENU_ITEMS,
  GUIDE_STEPS,
  GUIDE_STEP_CONTENT,
  completeGuideStep,
  currentGuideStep,
  dismissGuide,
  enabledDeliveryExports,
  futureDeliveryExports,
  guideWillAppear,
  initialGuideState,
  parseGuideState,
  restartGuide,
  segmentVisible,
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

  it('anchors each step at the region it talks about', () => {
    // 2026-11-12 重做：welcome/edit 讲画布（箭头朝下），layers 讲左栏页签（箭头朝左）。
    expect(GUIDE_STEP_CONTENT.welcome.anchor).toBe('canvas');
    expect(GUIDE_STEP_CONTENT.layers.anchor).toBe('left');
    expect(GUIDE_STEP_CONTENT.edit.anchor).toBe('canvas');
  });

  it('copy matches the current OnePlan-style UI, not the retired toolbar', () => {
    // 文案护栏：界面改成左栏页签 + 物件库后，引导不得再提「右侧图层栈/九钮」旧形态。
    expect(GUIDE_STEP_CONTENT.layers.body).toContain('添加物件');
    expect(GUIDE_STEP_CONTENT.layers.body).toContain('已放置物件');
    expect(GUIDE_STEP_CONTENT.layers.title).not.toContain('右侧');
    expect(GUIDE_STEP_CONTENT.edit.body).toContain('添加物件');
    expect(GUIDE_STEP_CONTENT.edit.body).toContain('双击闭合');
    expect(GUIDE_STEP_CONTENT.edit.body).toContain('Ctrl+Z');
    expect(GUIDE_STEP_CONTENT.welcome.body).toContain('滚轮');
    expect(JSON.stringify(GUIDE_STEP_CONTENT)).not.toContain('九钮');
    expect(JSON.stringify(GUIDE_STEP_CONTENT)).not.toContain('图层栈');
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

describe('unified delivery panel (outdoor)', () => {
  it('exposes three lightweight audiences with labels and notes', () => {
    expect(DELIVERY_AUDIENCES.map(aud => aud.id)).toEqual(['client', 'review', 'internal']);
    for (const aud of DELIVERY_AUDIENCES) {
      expect(aud.label.length).toBeGreaterThan(0);
      expect(aud.note.length).toBeGreaterThan(4);
    }
  });

  it('hides segments according to the selected audience', () => {
    const online = DELIVERY_SEGMENTS.find(seg => seg.id === 'online')!;
    const review = DELIVERY_SEGMENTS.find(seg => seg.id === 'review')!;
    const exportSeg = DELIVERY_SEGMENTS.find(seg => seg.id === 'export')!;
    expect(DELIVERY_AUDIENCES.map(aud => aud.id)).toContain('client');
    for (const aud of ['client', 'review', 'internal'] as const) {
      expect(segmentVisible(online, aud)).toBe(true);
    }
    expect(segmentVisible(review, 'client')).toBe(false);
    expect(segmentVisible(review, 'review')).toBe(true);
    expect(segmentVisible(review, 'internal')).toBe(true);
    expect(segmentVisible(exportSeg, 'client')).toBe(true);
    expect(segmentVisible(exportSeg, 'review')).toBe(false);
    expect(segmentVisible(exportSeg, 'internal')).toBe(true);
  });

  it('marks export availability by the real outdoor backend', () => {
    expect(enabledDeliveryExports.map(item => item.id)).toEqual(['png', 'csv', 'geojson', 'pdf']);
    expect(futureDeliveryExports.map(item => item.id)).toEqual(['album', 'handoff']);
    for (const item of futureDeliveryExports) {
      expect(item.enabled).toBe(false);
      expect(item.disabledHint?.length).toBeGreaterThan(0);
    }
    for (const item of enabledDeliveryExports) {
      expect(item.enabled).toBe(true);
      expect(item.label.length).toBeGreaterThan(1);
      expect(item.desc.length).toBeGreaterThan(3);
    }
  });

  it('keeps PNG view and scale parameter options', () => {
    const png = DELIVERY_EXPORT_ITEMS.find(item => item.id === 'png')!;
    const view = png.params?.find(group => group.optionsKey === 'view');
    const scale = png.params?.find(group => group.optionsKey === 'scale');
    expect(view?.options).toEqual(['跟随当前', '整体', '俯视', '正面', '对角']);
    expect(scale?.options).toEqual(['1080p', '4K', '6K']);
  });
});