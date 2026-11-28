import { describe, expect, it } from 'vitest';
import { boundaryFramePillState, framePillLayout, hitFramePillAction, showCandidateFramePill } from './outdoor-plan-canvas';

/** 屏幕像素口径的矩形框环（framePillLayout 吃的就是 planPointToPixel 之后的投影）。 */
const framePx = [
  { x: 100, y: 200 },
  { x: 400, y: 200 },
  { x: 400, y: 400 },
  { x: 100, y: 400 },
];
const viewport = { canvasW: 1200, canvasH: 800 };

describe('白框顶动作胶囊（2026-11-28 用户「红线的提示都追随在白框正上方」）', () => {
  it('整枚悬在框顶上方：胶囊底边距框顶 8px，水平居中于框', () => {
    const layout = framePillLayout(framePx, viewport, '候选活动范围（待核对）', ['confirm', 'cancel'])!;
    expect(layout).not.toBeNull();
    // 框顶 y=200，胶囊底边 = 200 - 8。
    expect(layout.pill.y + layout.pill.h).toBe(192);
    // 胶囊宽是奇偶不定的整数，中心允许 ±1px 取整差。
    expect(Math.abs(layout.pill.x + layout.pill.w / 2 - 250)).toBeLessThanOrEqual(1);
  });

  it('动作钮都在胶囊里、顺序保留，确认在最右', () => {
    const actions = ['confirm', 'cancel'] as const;
    const layout = framePillLayout(framePx, viewport, '红线已调整（待确认）', actions)!;
    expect(layout.actions.map(a => a.kind)).toEqual(['confirm', 'cancel']);
    for (const action of layout.actions) {
      expect(action.y).toBeGreaterThanOrEqual(layout.pill.y);
      expect(action.y + action.h).toBeLessThanOrEqual(layout.pill.y + layout.pill.h);
      expect(action.x).toBeGreaterThanOrEqual(layout.pill.x);
      expect(action.x + action.w).toBeLessThanOrEqual(layout.pill.x + layout.pill.w);
    }
    // 槽位从右往左：第一颗（confirm）比第二颗（cancel）更靠右。
    expect(layout.actions[0]!.x).toBeGreaterThan(layout.actions[1]!.x);
  });

  it('命中：点在钮热区里返回对应动作，点在标签/胶囊外返回 null', () => {
    const layout = framePillLayout(framePx, viewport, '已选中用地红线', ['delete', 'cancel'])!;
    const del = layout.actions[0]!;
    const cancel = layout.actions[1]!;
    expect(hitFramePillAction(layout, { x: del.x + del.w / 2, y: del.y + del.h / 2 })).toBe('delete');
    expect(hitFramePillAction(layout, { x: cancel.x + cancel.w / 2, y: cancel.y + cancel.h / 2 })).toBe('cancel');
    // 胶囊标签区（左半边）不是按钮。
    expect(hitFramePillAction(layout, { x: layout.pill.x + 6, y: layout.pill.y + layout.pill.h / 2 })).toBeNull();
    // 框里面（胶囊外）也不是。
    expect(hitFramePillAction(layout, { x: 250, y: 300 })).toBeNull();
  });

  it('贴近画布上缘时向内夹住，不出可视区', () => {
    const highFrame = framePx.map(p => ({ x: p.x, y: p.y - 190 }));
    const layout = framePillLayout(highFrame, viewport, '候选活动范围（待核对）', ['confirm', 'cancel'])!;
    expect(layout.pill.y).toBe(4);
  });

  it('框环不足 3 点或没有动作时不画', () => {
    expect(framePillLayout([framePx[0]!, framePx[1]!], viewport, 'x', ['confirm'])).toBeNull();
    expect(framePillLayout(framePx, viewport, 'x', [])).toBeNull();
  });
});

describe('胶囊态别决策（一次只画一枚：挂起 > 候选 > 选中）', () => {
  // 2026-11-28 用户「这种出卡和这种出卡也必须是统一的，不能是两个提示弹窗」：
  // 地点卡开着时，候选范围那枚胶囊不再画（同一件事只留一张卡）。
  it('地点卡开着时不画候选范围胶囊；卡关了照旧画', () => {
    const base = { scopePreview: true, boundaryPoints: 6 };
    expect(showCandidateFramePill({ ...base, placeCardOpen: true })).toBe(false);
    expect(showCandidateFramePill({ ...base, placeCardOpen: false })).toBe(true);
    // 没在预览、或边界不足 3 点，本来就不该有这枚胶囊。
    expect(showCandidateFramePill({ ...base, scopePreview: false, placeCardOpen: false })).toBe(false);
    expect(showCandidateFramePill({ scopePreview: true, boundaryPoints: 2, placeCardOpen: false })).toBe(false);
  });

  it('优先级：挂起的红线调整 > 候选活动范围 > 已选中用地红线', () => {
    const all = { pendingEdit: true, candidatePreview: true, boundarySelected: true, boundaryLocked: false };
    expect(boundaryFramePillState(all)!.kind).toBe('pending');
    expect(boundaryFramePillState({ ...all, pendingEdit: false })!.kind).toBe('candidate');
    expect(boundaryFramePillState({ ...all, pendingEdit: false, candidatePreview: false })!.kind).toBe('selected');
    expect(boundaryFramePillState({ ...all, pendingEdit: false, candidatePreview: false, boundarySelected: false })).toBeNull();
  });

  it('挂起与候选都带 ✓/✕；锁定态选中整枚不画（2026-11-28 用户拍板去掉），解锁才有删除/收起', () => {
    expect(boundaryFramePillState({ pendingEdit: true, candidatePreview: false, boundarySelected: false, boundaryLocked: false }))
      .toEqual({ kind: 'pending', label: '红线已调整（待确认）', actions: ['confirm', 'cancel'] });
    expect(boundaryFramePillState({ pendingEdit: false, candidatePreview: true, boundarySelected: false, boundaryLocked: false }))
      .toEqual({ kind: 'candidate', label: '候选活动范围（待核对）', actions: ['confirm', 'cancel'] });
    expect(boundaryFramePillState({ pendingEdit: false, candidatePreview: false, boundarySelected: true, boundaryLocked: true }))
      .toBeNull();
    expect(boundaryFramePillState({ pendingEdit: false, candidatePreview: false, boundarySelected: true, boundaryLocked: false }))
      .toEqual({ kind: 'selected', label: '已选中用地红线', actions: ['delete', 'cancel'] });
  });
});
