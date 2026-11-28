import type { CSSProperties, JSX } from 'react';
import { planAnnotationKindLabels } from '../../../../supabase/functions/_shared/site-plan';
import {
  PLANNING_RADIUS,
  PLANNING_SPACING,
  PLANNING_SURFACE,
  PLANNING_TYPOGRAPHY,
  type PlanningIconName,
} from '@/lib/outdoor-plan-tokens';
import { ANNOTATE_DRAW_SHORTCUT } from '../lib/annotate-draw-shortcuts';
import { PLAN_SHAPE_KINDS, type PlanShapeKind } from '../lib/site-plan-annotate';
import { planningIcon } from './outdoor-plan-icons';

/**
 * 2026-11-16 绘图工具条（Figma / Keynote）：
 * 文本 T、矩形、圆形、三角形、线段一次铺开，不再收进形状父钮。
 * 颜色点由旁边的 AnnotateColorBar 常驻，不放进这里的菜单。
 */
const SHAPE_ICONS: Record<PlanShapeKind, PlanningIconName> = {
  rect: 'square',
  circle: 'circle',
  triangle: 'triangle-shape',
  line: 'minus',
};

const SHAPE_TIP: Record<PlanShapeKind, string> = {
  rect: '矩形 · 按住拖，或点两个点',
  circle: '圆形 · 按住拖，或点两个点',
  triangle: '三角形 · 单击 3 点连成三角形',
  line: '线段 · 按住拖，或点两个点',
};

/** 2026-11-28 用户逐个拍板的最终尺寸：方形/圆形/三角形 16、线段 20（描边 2.5）、T 字 18px。 */
const SHAPE_ICON_SPEC: Record<PlanShapeKind, { size: number; strokeWidth?: number }> = {
  rect: { size: 16 },
  circle: { size: 16 },
  triangle: { size: 16 },
  line: { size: 20, strokeWidth: 2.5 },
};

export type AnnotateDrawTool = 'note' | PlanShapeKind;

function toolButtonStyle(active: boolean): CSSProperties {
  return {
    all: 'unset',
    boxSizing: 'border-box',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 46,
    maxWidth: 46,
    minWidth: 0,
    height: 46,
    flex: '1 1 0',
    borderRadius: PLANNING_RADIUS.md,
    border: `1.5px solid ${active ? PLANNING_SURFACE.selectedBorder : 'transparent'}`,
    background: active ? PLANNING_SURFACE.activeBg : 'transparent',
    color: active ? PLANNING_SURFACE.selectedBorder : PLANNING_SURFACE.panelText,
    fontWeight: 700,
    fontSize: PLANNING_TYPOGRAPHY.row,
  };
}

export function AnnotateDrawTools({
  active,
  onNote,
  onShape,
}: {
  active: AnnotateDrawTool | null;
  onNote: () => void;
  onShape: (kind: PlanShapeKind) => void;
}): JSX.Element {
  return (
    <div
      data-testid="annotate-draw-tools"
      role="toolbar"
      aria-label="绘图工具"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'nowrap',
        gap: 4,
        width: '100%',
        boxSizing: 'border-box',
        // 2026-11-28 用户指令：选项行去掉背后的灰色填充——只留图标本身。
        marginTop: PLANNING_SPACING.xs,
      }}
    >
      <button
        type="button"
        aria-pressed={active === 'note'}
        aria-keyshortcuts={ANNOTATE_DRAW_SHORTCUT.note}
        aria-label={planAnnotationKindLabels.note}
        data-testid="annotate-type-note"
        title={`文本 · ${ANNOTATE_DRAW_SHORTCUT.note} · 点一下放置，就地输入${active === 'note' ? ' · 再点退出' : ''}`}
        style={{ ...toolButtonStyle(active === 'note'), fontSize: 18, fontWeight: 600 }}
        onClick={onNote}
      >
        T
      </button>
      {PLAN_SHAPE_KINDS.map(kind => {
        const Icon = planningIcon(SHAPE_ICONS[kind]);
        const spec = SHAPE_ICON_SPEC[kind];
        const pressed = active === kind;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={pressed}
            aria-keyshortcuts={ANNOTATE_DRAW_SHORTCUT[kind]}
            aria-label={planAnnotationKindLabels[kind]}
            data-testid={`annotate-shape-${kind}`}
            title={`${SHAPE_TIP[kind]} · ${ANNOTATE_DRAW_SHORTCUT[kind]}${pressed ? ' · 再点退出' : ''}`}
            style={toolButtonStyle(pressed)}
            onClick={() => onShape(kind)}
          >
            <Icon size={spec.size} strokeWidth={spec.strokeWidth ?? 2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
