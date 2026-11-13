import { describe, expect, it } from 'vitest';
import {
  PLANNING_EDIT_MODE_ICONS,
  PLANNING_EDIT_MODE_LABELS,
  PLANNING_ICON_SIZES,
  PLANNING_INFO_TAB_ICONS,
  PLANNING_ICONS,
  PLANNING_LAYER_COLORS,
  PLANNING_LAYER_ICONS,
  PLANNING_SEGMENTED,
  PLANNING_SURFACE,
  PLANNING_TEXT,
  PLANNING_TYPOGRAPHY,
  withAlphaHex,
} from './outdoor-plan-tokens';

describe('outdoor 2D planning visual tokens (H4-a)', () => {
  it('keeps typography a compact three-step scale', () => {
    expect(PLANNING_TYPOGRAPHY.panel).toBeGreaterThan(PLANNING_TYPOGRAPHY.row);
    expect(PLANNING_TYPOGRAPHY.row).toBeGreaterThan(PLANNING_TYPOGRAPHY.hint);
    expect(PLANNING_TYPOGRAPHY.panel).toBeLessThanOrEqual(14);
  });

  it('sources every panel surface colour from tokens (hex or translucent rgba)', () => {
    for (const value of Object.values(PLANNING_SURFACE)) {
      expect(value).toMatch(/^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, (0|\d?\.\d+)\))$/);
    }
    // 冷石画廊白（v5 收敛）：选中描边 = 品牌绿 --green #4A7C59（绿仅点睛）。
    expect(PLANNING_SURFACE.selectedBorder).toBe('#4a7c59');
  });

  it('keeps text tiers aligned to global ink/ink-soft/muted/faint variables', () => {
    expect(PLANNING_TEXT.soft).toBe('#55585f');
    expect(PLANNING_TEXT.muted).toBe('#71767e');
    // 占位 / 禁用灰对齐全局 --faint #A6AAB2。
    expect(PLANNING_TEXT.faint).toBe('#a6aab2');
  });

  it('derives rgba from hex via withAlphaHex without inventing new colours', () => {
    expect(withAlphaHex('#c98a2c', 0.14)).toBe('rgba(201, 138, 44, 0.14)');
    expect(withAlphaHex(PLANNING_LAYER_COLORS.boundary, 0.5)).toBe('rgba(53, 98, 74, 0.5)');
    // 非法输入原样返回（不抛错）。
    expect(withAlphaHex('nope', 0.5)).toBe('nope');
  });

  it('keeps icon sizes small and ordered for compact panels', () => {
    expect(PLANNING_ICON_SIZES.capsule).toBeLessThanOrEqual(PLANNING_ICON_SIZES.legend);
    expect(PLANNING_ICON_SIZES.tool).toBeLessThanOrEqual(13);
    expect(PLANNING_ICON_SIZES.legend).toBeGreaterThanOrEqual(11);
  });

  it('shares one segmented-control scale across the 2D/3D pill and the placed/library tabs', () => {
    expect(PLANNING_SEGMENTED.height).toBe(34);
    expect(PLANNING_SEGMENTED.fontSize).toBe(13);
    expect(PLANNING_SEGMENTED.activeWeight).toBe(600);
    expect(PLANNING_SEGMENTED.inactiveWeight).toBe(500);
    expect(PLANNING_SEGMENTED.activeWeight).toBeGreaterThan(PLANNING_SEGMENTED.inactiveWeight);
    expect(PLANNING_SEGMENTED.radiusPill).toBe(999);
    expect(PLANNING_SEGMENTED.containerPadding).toBe(3);
    expect(PLANNING_SEGMENTED.gap).toBe(3);
  });

  it('registers resolvable kebab-case icon names only (layer-group was unresolvable)', () => {
    for (const name of PLANNING_ICONS) expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(new Set(PLANNING_ICONS).size).toBe(PLANNING_ICONS.length);
    // lucide-react 1.48 没有 LayerGroup 导出：死名不得回流注册表。
    expect(PLANNING_ICONS).not.toContain('layer-group');
    expect(PLANNING_ICONS).toContain('layers');
    // H4-a 新增的图层/工具/页签词汇全部在册。
    for (const required of ['hexagon', 'tent', 'hand', 'pen-tool', 'move', 'lasso', 'user-plus', 'layout-grid', 'list', 'triangle-alert', 'info'] as const) {
      expect(PLANNING_ICONS).toContain(required);
    }
  });

  it('maps every planning layer kind to a registered icon', () => {
    const kinds = Object.keys(PLANNING_LAYER_COLORS) as (keyof typeof PLANNING_LAYER_COLORS)[];
    expect(Object.keys(PLANNING_LAYER_ICONS).sort()).toEqual([...kinds].sort());
    for (const [kind, icon] of Object.entries(PLANNING_LAYER_ICONS)) {
      expect(PLANNING_ICONS).toContain(icon);
      expect(PLANNING_LAYER_ICONS[kind as keyof typeof PLANNING_LAYER_ICONS]).toBe(icon);
    }
    // 边界/分区图标可辨（六边形 vs 形状组）。
    expect(PLANNING_LAYER_ICONS.boundary).not.toBe(PLANNING_LAYER_ICONS.zone);
  });

  it('maps all nine edit modes to registered tool icons', () => {
    expect(Object.keys(PLANNING_EDIT_MODE_ICONS).sort()).toEqual(Object.keys(PLANNING_EDIT_MODE_LABELS).sort());
    for (const icon of Object.values(PLANNING_EDIT_MODE_ICONS)) {
      expect(PLANNING_ICONS).toContain(icon);
    }
    expect(PLANNING_EDIT_MODE_ICONS.view).toBe('hand');
    expect(PLANNING_EDIT_MODE_ICONS.boundary).toBe('pen-tool');
    expect(PLANNING_EDIT_MODE_ICONS['boundary-vertex']).toBe('move');
    expect(PLANNING_EDIT_MODE_ICONS.zone).toBe('lasso');
    expect(PLANNING_EDIT_MODE_ICONS.worker).toBe('user-plus');
  });

  it('maps the four info tabs to registered icons', () => {
    expect(Object.keys(PLANNING_INFO_TAB_ICONS).sort()).toEqual(['inventory', 'issues', 'legend', 'overview']);
    for (const icon of Object.values(PLANNING_INFO_TAB_ICONS)) {
      expect(PLANNING_ICONS).toContain(icon);
    }
  });
});

