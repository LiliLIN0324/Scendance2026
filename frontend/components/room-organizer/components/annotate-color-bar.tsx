import type { JSX } from 'react';
import {
  PLANNING_LAYER_COLORS,
  PLANNING_RADIUS,
  PLANNING_SPACING,
  PLANNING_SURFACE,
  PLANNING_TEXT,
} from '@/lib/outdoor-plan-tokens';
import {
  PLAN_ANNOTATION_STROKE_WIDTHS,
  type PlanAnnotationStrokeWidth,
} from '../lib/site-plan-annotate';

/**
 * 2026-11-16 自由标注颜色条（Figma 颜色条）：
 * 色点与细/粗线宽排在同一条上（文本模式只留色点），不收进形状下拉或其它二级菜单。
 * 色值仍只用既有图层/表面 token，不另造 hex。
 * 2026-11-17 文本模式隐藏线宽（文本不吃线宽），只留颜色；切回形状时档位按原值回来。
 */
export const ANNOTATE_COLOR_SWATCHES: readonly { value: string; label: string }[] = [
  { value: PLANNING_LAYER_COLORS.annotate, label: '紫' },
  { value: PLANNING_SURFACE.panelText, label: '墨' },
  { value: PLANNING_LAYER_COLORS.boundary, label: '绿' },
  { value: PLANNING_LAYER_COLORS.route, label: '蓝' },
  { value: PLANNING_LAYER_COLORS.facility, label: '橙' },
  { value: PLANNING_LAYER_COLORS.worker, label: '粉' },
];

const STROKE_LABEL: Record<PlanAnnotationStrokeWidth, string> = {
  thin: '细线',
  thick: '粗线',
};

export function AnnotateColorBar({
  color,
  strokeWidth,
  showStrokeWidth = true,
  onColor,
  onStrokeWidth,
}: {
  color: string;
  strokeWidth: PlanAnnotationStrokeWidth;
  /** 文本模式只留颜色；形状模式显示细/粗线宽。 */
  showStrokeWidth?: boolean;
  onColor: (value: string) => void;
  onStrokeWidth: (value: PlanAnnotationStrokeWidth) => void;
}): JSX.Element {
  return (
    <div
      data-testid="annotate-color-bar"
      role="group"
      aria-label={showStrokeWidth ? '标注颜色与粗细' : '标注颜色'}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'nowrap',
        gap: PLANNING_SPACING.sm,
        width: '100%',
        height: 34,
        boxSizing: 'border-box',
        marginTop: PLANNING_SPACING.sm,
        padding: '5px 7px',
        background: PLANNING_SURFACE.fieldBg,
        borderRadius: PLANNING_RADIUS.md,
      }}
    >
      <div role="radiogroup" aria-label="标注颜色" style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
        {ANNOTATE_COLOR_SWATCHES.map(sw => {
          const active = color === sw.value;
          return (
            <button
              key={sw.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`标注颜色 ${sw.label}`}
              data-testid={`annotate-color-${sw.value.replace('#', '')}`}
              title={sw.label}
              onClick={() => onColor(sw.value)}
              style={{
                all: 'unset',
                boxSizing: 'border-box',
                width: 20,
                height: 20,
                borderRadius: 999,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
                background: sw.value,
                boxShadow: active
                  ? `inset 0 0 0 2px ${PLANNING_SURFACE.fieldBg}, 0 0 0 1.5px ${sw.value}`
                  : 'inset 0 0 0 1px rgba(20, 20, 22, 0.16)',
              }}
            >
              {active ? (
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden focusable="false">
                  <path d="M2.2 6.2 4.8 8.8 9.8 3.4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          );
        })}
      </div>
      {showStrokeWidth ? (
        <>
          <span
            aria-hidden
            style={{ width: 1, alignSelf: 'stretch', margin: '3px 0', background: PLANNING_SURFACE.panelBorder, flex: '0 0 auto' }}
          />
          <div role="radiogroup" aria-label="描边粗细" style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto', flex: '0 0 auto' }}>
            {PLAN_ANNOTATION_STROKE_WIDTHS.map(width => {
              const active = strokeWidth === width;
              return (
                <button
                  key={width}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={STROKE_LABEL[width]}
                  data-testid={`annotate-stroke-${width}`}
                  title={STROKE_LABEL[width]}
                  onClick={() => onStrokeWidth(width)}
                  style={{
                    all: 'unset',
                    boxSizing: 'border-box',
                    width: 30,
                    height: 24,
                    borderRadius: PLANNING_RADIUS.sm,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '0 0 auto',
                    background: active ? PLANNING_SURFACE.panelBg : 'transparent',
                    boxShadow: active ? `inset 0 0 0 1px ${PLANNING_SURFACE.panelBorder}` : 'none',
                    color,
                  }}
                >
                  <svg viewBox="0 0 20 10" width="16" height="8" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden focusable="false">
                    <line x1="2" y1="5" x2="18" y2="5" strokeWidth={width === 'thin' ? 1.5 : 3.5} />
                  </svg>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <span style={{ marginLeft: 'auto', flex: '0 0 auto', fontSize: 9, lineHeight: '14px', color: PLANNING_TEXT.muted, whiteSpace: 'nowrap' }}>
          文字只用颜色
        </span>
      )}
    </div>
  );
}
