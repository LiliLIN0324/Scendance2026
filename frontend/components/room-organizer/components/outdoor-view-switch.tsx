'use client';

/**
 * 户外「2D 地图 / 3D 场地」视角切换（OnePlan 式分段胶囊）。
 *
 * 消费方：
 * - 2D 覆盖层左下簇（outdoor-plan-overlay.tsx，testIdPrefix 默认 `outdoor-view`）。
 * - 3D 接管态的切换已统一走右轨 #tool-2d3d（scendance-workspace.tsx），不再渲染本组件；
 *   2026-11-12 用户指令移除接管态左下角胶囊（`outdoor-takeover-view-*`）。
 *
 * 覆盖层在接管态**保活隐藏**（visibility:hidden），同屏仍留在 DOM 里；2D 卡内的
 * 切换钮因此要靠 testid 精确定位，避免 getByTestId 撞到隐藏节点。
 */

import { PLANNING_SURFACE } from '@/lib/outdoor-plan-tokens';

export type OutdoorPlanView = '2d' | '3d';

const VIEW_MODES: readonly (readonly [OutdoorPlanView, string])[] = [
  ['2d', '2D 地图'],
  ['3d', '3D 场地'],
];

export interface OutdoorViewSwitchProps {
  view: OutdoorPlanView;
  onChange: (next: OutdoorPlanView) => void;
  /** 容器 testid 前缀：`${prefix}-toggle` / `${prefix}-2d` / `${prefix}-3d`。 */
  testIdPrefix?: string;
}

export default function OutdoorViewSwitch({ view, onChange, testIdPrefix = 'outdoor-view' }: OutdoorViewSwitchProps) {
  return (
    <div
      data-testid={`${testIdPrefix}-toggle`}
      role="group"
      aria-label="视角：地图 2D / 场地 3D"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        borderRadius: 999,
        background: PLANNING_SURFACE.panelBg,
        border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
        boxShadow: '0 4px 14px rgba(20, 20, 22, 0.10)',
      }}
    >
      {VIEW_MODES.map(([mode, label]) => {
        const active = view === mode;
        return (
          <button
            key={mode}
            type="button"
            data-testid={`${testIdPrefix}-${mode}`}
            aria-pressed={active}
            onClick={() => onChange(mode)}
            style={{
              height: 28,
              padding: '0 12px',
              borderRadius: 999,
              border: 'none',
              background: active ? PLANNING_SURFACE.selectedBg : 'transparent',
              color: PLANNING_SURFACE.panelText,
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}