import { describe, expect, it } from 'vitest';
import {
  PLAN_INVENTORY_LAYER,
  PLAN_LAYER_HUMAN_LABELS,
  PLAN_MODE_TARGET_LAYER,
  planEntityBlockReason,
  planEntityEditable,
  planLayerAccess,
  planLayerBlock,
  planLayerBlockReason,
  planLayerEditable,
  planModeAutoVisibleLayer,
} from './plan-edit-gate';

/**
 * 2026-11-20 审计 B3/K3/K8：可编辑性是「图层可见 ∧ 未锁定」这**一个**口径。
 * 这些用例锁的是判定本身，不是某个调用点——命中、清单行、属性写入、放置都复用它。
 */
describe('plan edit gate · 可编辑性单一判定', () => {
  it('缺省即可见、未锁定', () => {
    expect(planLayerAccess('facility', {}, {})).toEqual({ visible: true, locked: false });
    expect(planEntityEditable('facility', {}, {})).toBe(true);
  });

  it('隐藏层不可编辑，且原因优先说「隐藏」', () => {
    const access = planLayerAccess('facility', { facility: false }, { facility: true });
    expect(planLayerEditable(access)).toBe(false);
    expect(planLayerBlock(access)).toBe('hidden');
    expect(planLayerBlockReason('facility', access)).toContain('已隐藏');
  });

  it('锁定层可看不可改', () => {
    const access = planLayerAccess('facility', {}, { facility: true });
    expect(access.visible).toBe(true);
    expect(planLayerEditable(access)).toBe(false);
    expect(planLayerBlock(access)).toBe('locked');
    expect(planLayerBlockReason('facility', access)).toContain('已锁定');
  });

  it('实体种类按自己的图层判定（节点看 access，车辆看动线层）', () => {
    expect(PLAN_INVENTORY_LAYER.node).toBe('access');
    expect(PLAN_INVENTORY_LAYER.vehicle).toBe('route');
    // 关掉出入口层不影响车辆，关掉动线层会连车一起挡住。
    expect(planEntityEditable('vehicle', { access: false }, {})).toBe(true);
    expect(planEntityEditable('vehicle', { route: false }, {})).toBe(false);
    expect(planEntityBlockReason('node', { access: false }, {})).toContain('出入口');
  });

  it('锁设施层只挡设施，不连带红线/分区', () => {
    expect(planEntityEditable('facility', {}, { facility: true })).toBe(false);
    expect(planEntityEditable('zone', {}, { facility: true })).toBe(true);
    expect(planLayerEditable(planLayerAccess('boundary', {}, { facility: true }))).toBe(true);
  });

  it('可编辑时没有提示文案', () => {
    expect(planLayerBlockReason('facility', planLayerAccess('facility', {}, {}))).toBeNull();
    expect(planEntityBlockReason('facility', {}, {})).toBeNull();
  });

  it('每个图层都有可读名，node 不落空', () => {
    for (const layer of Object.keys(PLAN_LAYER_HUMAN_LABELS)) {
      expect(PLAN_LAYER_HUMAN_LABELS[layer as keyof typeof PLAN_LAYER_HUMAN_LABELS]).toBeTruthy();
    }
    expect(PLAN_LAYER_HUMAN_LABELS.node).toBe('出入口');
  });
});

describe('plan edit gate · 切工具自动打开目标层（K8）', () => {
  it('目标层被隐藏时返回该层', () => {
    expect(planModeAutoVisibleLayer('facility', { facility: false })).toBe('facility');
    expect(planModeAutoVisibleLayer('measure', { measure: false })).toBe('measure');
  });

  it('目标层可见或无目标层时不动作', () => {
    expect(planModeAutoVisibleLayer('facility', {})).toBeNull();
    expect(planModeAutoVisibleLayer('view', { facility: false })).toBeNull();
    expect(planModeAutoVisibleLayer('select', { facility: false })).toBeNull();
  });

  it('每个会落物的工具都登记了目标层，浏览/选择/编辑红线除外', () => {
    const modes = Object.keys(PLAN_MODE_TARGET_LAYER);
    expect(modes).toEqual(expect.arrayContaining(['boundary', 'zone', 'facility', 'route', 'node', 'worker', 'vehicle', 'measure', 'note', 'shape']));
    expect(PLAN_MODE_TARGET_LAYER.view).toBeUndefined();
    expect(PLAN_MODE_TARGET_LAYER.select).toBeUndefined();
  });
});
