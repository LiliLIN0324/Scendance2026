import { describe, expect, it } from 'vitest';
import {
  PLANNING_EDIT_MODE_ICONS,
  PLANNING_INFO_TAB_ICONS,
  PLANNING_ICONS,
  PLANNING_LAYER_ICONS,
} from '@/lib/outdoor-plan-tokens';
import { PLANNING_ICON_COMPONENTS, planningIcon } from './outdoor-plan-icons';

describe('outdoor plan icon map (H4-a)', () => {
  it('maps every registered icon name to a real LucideIcon component', () => {
    // 编译期 Record 闭环的运行时复核：键集一致、每个值都是真值组件（lucide-react 1.48
    // 组件为 forwardRef 对象而非函数，不作 typeof 强判）。
    expect(Object.keys(PLANNING_ICON_COMPONENTS).sort()).toEqual([...PLANNING_ICONS].sort());
    for (const name of PLANNING_ICONS) {
      expect(PLANNING_ICON_COMPONENTS[name]).toBeTruthy();
    }
  });

  it('planningIcon resolves registered names and falls back to shapes', () => {
    expect(planningIcon('tent')).toBe(PLANNING_ICON_COMPONENTS.tent);
    expect(planningIcon('hexagon')).toBe(PLANNING_ICON_COMPONENTS.hexagon);
    // 回落恒返回组件（运行时防御路径）。
    expect(planningIcon('shapes')).toBeTruthy();
  });

  it('resolves layer and edit-mode icon maps through the same entry point', () => {
    for (const icon of Object.values(PLANNING_LAYER_ICONS)) {
      expect(planningIcon(icon)).toBe(PLANNING_ICON_COMPONENTS[icon]);
    }
    for (const icon of Object.values(PLANNING_EDIT_MODE_ICONS)) {
      expect(planningIcon(icon)).toBe(PLANNING_ICON_COMPONENTS[icon]);
    }
    for (const icon of Object.values(PLANNING_INFO_TAB_ICONS)) {
      expect(planningIcon(icon)).toBe(PLANNING_ICON_COMPONENTS[icon]);
    }
  });
});
