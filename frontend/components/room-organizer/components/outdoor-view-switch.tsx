'use client';

/**
 * 户外「2D / 3D」视角切换（OnePlan 式分段胶囊 · B 墨黑皮肤定稿）。
 *
 * 落点（2026-11-13 定稿）：2D 覆盖层与 3D 接管态**同一个入口**，固定在画布左下动作簇，
 * 由 room-organizer 在画布层独立渲染；右轨 44px 竖轨不再纳横排文字胶囊。
 *
 * 定稿口径：
 * - 文案仅左「2D」右「3D」，不带后缀词、不附图标；
 * - 激活段实底近黑墨 `#141416`、白字；容器纯白 + 发丝线 + 柔和阴影；
 * - 标准档：段高 34、段内边距 `0 14px`、容器内边距 3、圆角全胶囊；
 * - 动效：滑块水平平移 `200ms cubic-bezier(.2,0,0,1)`；`prefers-reduced-motion` 下关闭。
 *
 * testid 前缀：`${prefix}-toggle` / `${prefix}-2d` / `${prefix}-3d`。
 */

import { PLANNING_SEGMENTED, PLANNING_SURFACE, PLANNING_TEXT } from '@/lib/outdoor-plan-tokens';

export type OutdoorPlanView = '2d' | '3d';

const VIEW_MODES: readonly (readonly [OutdoorPlanView, string])[] = [
  ['2d', '2D'],
  ['3d', '3D'],
];

export interface OutdoorViewSwitchProps {
  view: OutdoorPlanView;
  onChange: (next: OutdoorPlanView) => void;
  /** 容器 testid 前缀：`${prefix}-toggle` / `${prefix}-2d` / `${prefix}-3d`。 */
  testIdPrefix?: string;
}

export default function OutdoorViewSwitch({ view, onChange, testIdPrefix = 'outdoor-view' }: OutdoorViewSwitchProps) {
  const activeIndex = view === '3d' ? 1 : 0;
  const reducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      data-testid={`${testIdPrefix}-toggle`}
      role="group"
      aria-label="2D / 3D 视图切换"
      style={{
        position: 'relative',
        display: 'inline-grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 0,
        padding: PLANNING_SEGMENTED.containerPadding,
        borderRadius: PLANNING_SEGMENTED.radiusPill,
        background: PLANNING_SURFACE.panelBg,
        border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
        boxShadow: '0 4px 14px rgba(20, 20, 22, 0.10)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: PLANNING_SEGMENTED.containerPadding,
          left: PLANNING_SEGMENTED.containerPadding,
          width: `calc(50% - ${PLANNING_SEGMENTED.containerPadding}px)`,
          height: PLANNING_SEGMENTED.height,
          borderRadius: PLANNING_SEGMENTED.radiusPill,
          background: PLANNING_SURFACE.panelText,
          transform: reducedMotion ? undefined : `translateX(${activeIndex * 100}%)`,
          transition: reducedMotion ? 'none' : 'transform 200ms cubic-bezier(.2,0,0,1)',
        }}
      />
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
              position: 'relative',
              zIndex: 1,
              height: PLANNING_SEGMENTED.height,
              minWidth: 60,
              padding: '0 14px',
              borderRadius: PLANNING_SEGMENTED.radiusPill,
              border: 'none',
              background: 'transparent',
              color: active ? '#ffffff' : PLANNING_TEXT.soft,
              fontSize: PLANNING_SEGMENTED.fontSize,
              fontWeight: active ? PLANNING_SEGMENTED.activeWeight : PLANNING_SEGMENTED.inactiveWeight,
              letterSpacing: '.02em',
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
