'use client';

import {
  PLANNING_RADIUS,
  PLANNING_SPACING,
  PLANNING_SURFACE,
  PLANNING_TYPOGRAPHY,
} from '@/lib/outdoor-plan-tokens';
import {
  LABOR_GENDER_LABELS,
  LABOR_GENDERS,
  type LaborGender,
} from '../lib/labor-gender';

/**
 * 劳动力性别属性：同一岗位图标上的男/女切换，不是第二套图标。
 * 样式对齐户外规划浅暖色属性条（点选即可，不做成表单墙）。
 */
export function LaborGenderControl({
  value,
  onChange,
  disabled = false,
  testIdPrefix,
}: {
  value: LaborGender;
  onChange: (gender: LaborGender) => void;
  disabled?: boolean;
  testIdPrefix: string;
}) {
  return (
    <div
      data-testid={testIdPrefix}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: PLANNING_SPACING.xs,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span style={{ flex: '0 0 auto' }}>性别</span>
      <div
        role="radiogroup"
        aria-label="性别"
        aria-disabled={disabled}
        style={{
          display: 'inline-flex',
          border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
          borderRadius: PLANNING_RADIUS.sm,
          overflow: 'hidden',
          background: PLANNING_SURFACE.fieldBg,
        }}
      >
        {LABOR_GENDERS.map(gender => {
          const selected = value === gender;
          return (
            <button
              key={gender}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`${testIdPrefix}-${gender}`}
              disabled={disabled}
              onClick={() => { if (!disabled && !selected) onChange(gender); }}
              style={{
                all: 'unset',
                cursor: disabled ? 'default' : 'pointer',
                padding: '2px 8px',
                fontSize: PLANNING_TYPOGRAPHY.row,
                color: PLANNING_SURFACE.panelText,
                background: selected ? PLANNING_SURFACE.selectedBg : 'transparent',
                boxShadow: selected ? `inset 0 0 0 1px ${PLANNING_SURFACE.selectedBorder}` : 'none',
              }}
            >
              {LABOR_GENDER_LABELS[gender]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
