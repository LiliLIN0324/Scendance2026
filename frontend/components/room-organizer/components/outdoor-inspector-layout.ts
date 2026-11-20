/**
 * 户外画布「属性卡」（右轨测量/标注/属性三张卡）的版式契约。
 *
 * 2026-11-17（真实用户报「文字生成点不动」，生产 C1 走查时定案）：
 *
 * 卡片的宽度原来完全由内容决定 —— 外层是 `width: max-content`，卡片自己是
 * `flex: 0 0 auto`（不许收缩）。而「3D 模型候选」那一排是横向滚动条：
 * 它的 max-content 宽度 = 候选数 × 68px。素材库候选一多，整张卡就被撑到
 * 上千像素宽，冲出宿主（3D 接管态的宿主是整块覆盖层 `inset:0`）、冲出视口，
 * 「文字生成 / 图片生成 / 导入 GLB」三颗按钮落在可视区之外 —— 真鼠标点下去，
 * 命中的是底图 canvas，不是按钮。这类问题截图看不出来，只能量矩形。
 *
 * 这里把版式提成一份**可测的契约**，组件与回归脚本共用同一份值：
 *
 * 1) 候选条外面包一层 flex 行，候选条自己 `flex: 1 1 0` —— 滚动容器的
 *    `flex-basis: 0` 让它的固有宽度不再进卡片的内容宽度（规范里「滚动容器的
 *    自动最小尺寸为 0」那条路）；候选条仍然在自己那一行里横向滚动。
 * 2) 卡片允许收缩（`flex: 0 1 auto` + `min-width: 0` + `max-width: 100%`）：
 *    宿主有多宽卡片就多宽，绝不越界；卡片内容因此回到设计稿的 ~233px。
 * 3) 卡片体只做纵向滚动（`overflow-x: hidden`），横向滚动交给候选条自己。
 * 4) 外层浮条同时受宿主宽度与视口宽度约束（`min(100% - 32px, 100vw - 32px)`），
 *    宿主比视口宽时也不会把卡片送出屏幕。
 * 5) 「生成或导入模型」三颗按钮在卡片体内常驻底部（sticky）—— 用户 2026-11-15
 *    就说过「生成和导入模型不应该收在下方，因为这个很重要」；收在滚动区折叠线
 *    以下时，它既看不见也点不到。
 */
import type { CSSProperties } from 'react';
import { PLANNING_SPACING, PLANNING_SURFACE, PLANNING_TYPOGRAPHY } from '@/lib/outdoor-plan-tokens';

/** 属性卡在宿主里的定位（拖过之后才有值）。 */
export interface InspectorPanelPosition {
  x: number;
  y: number;
}

/**
 * 三张卡并排的外层浮条。
 *
 * `width: max-content` 保留「卡片按内容宽度」的意图（设计稿里属性卡 ~233px），
 * 但宽度上限同时受宿主与视口约束，且卡片自己允许收缩。
 */
export function inspectorStackStyle(position?: InspectorPanelPosition | null): CSSProperties {
  return {
    position: 'absolute',
    zIndex: 6,
    ...(position
      ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', transform: 'none' }
      : { top: 16, right: 68, left: 'auto', bottom: 'auto', transform: 'none' }),
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    width: 'max-content',
    // 宿主（3D 接管态是整块覆盖层）可能比视口宽，两个上限都要卡。
    maxWidth: 'min(calc(100% - 32px), calc(100vw - 32px))',
    maxHeight: 'calc(100% - 120px)',
  };
}

/** 单张卡片的外壳。 */
export function inspectorCardStyle(options: {
  key: string;
  annotateAnchor?: { left: number; bottom: number } | null;
  /**
   * 固定宽度（px）。2026-11-20 用户：「这个标注为什么搞那么宽」——
   * 卡片宽度原来由内容决定（fixed 定位 + width:auto = 收缩到内容宽），
   * 标注列表里一行长文本就把整张卡撑到近满屏；这里给出定宽，长文本在卡内省略。
   */
  fixedWidth?: number | undefined;
}): CSSProperties {
  const { key, annotateAnchor, fixedWidth } = options;
  const anchored = key === 'annotate' && annotateAnchor;
  return {
    // 允许收缩：内容再宽也不许冲出宿主/视口（2026-11-17「文字生成点不动」的修法）。
    flex: '0 1 auto',
    minWidth: 0,
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    background: PLANNING_SURFACE.panelBg,
    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
    borderRadius: 12,
    boxShadow: '0 10px 26px rgba(20, 24, 32, 0.10)',
    overflow: key === 'annotate' ? 'visible' : 'hidden',
    color: PLANNING_SURFACE.panelText,
    fontSize: PLANNING_TYPOGRAPHY.panel,
    ...(fixedWidth ? { width: fixedWidth } : {}),
    ...(anchored
      ? {
          position: 'fixed' as const,
          left: annotateAnchor.left,
          bottom: annotateAnchor.bottom,
          top: 'auto',
          right: 'auto',
          transform: 'translateX(-50%)',
          zIndex: 80,
          maxWidth: 'calc(100vw - 24px)',
        }
      : {}),
  };
}

/** 卡片体：只做纵向滚动，横向留给候选条自己。 */
export function inspectorCardBodyStyle(options: { key: string }): CSSProperties {
  return {
    minHeight: 0,
    minWidth: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    maxHeight: '46vh',
    padding: options.key === 'annotate' ? '8px 10px' : '0 12px 12px',
  };
}

/**
 * 「3D 模型候选」那一条的外层。
 *
 * 这一层是修法的关键：它让候选条变成 flex 项，`flex: 1 1 0` 的基准宽度为 0，
 * 于是候选再少再多，卡片的内容宽度都由「生成/导入模型」那三颗按钮决定（约 233px）。
 */
export const FACILITY_MODEL_STRIP_WRAPPER_STYLE: CSSProperties = {
  display: 'flex',
  minWidth: 0,
  maxWidth: '100%',
};

/** 候选条本体：仍然横向滚动。 */
export const FACILITY_MODEL_STRIP_STYLE: CSSProperties = {
  display: 'flex',
  gap: PLANNING_SPACING.xs,
  overflowX: 'auto',
  overflowY: 'hidden',
  paddingBottom: 2,
  scrollbarWidth: 'thin',
  flex: '1 1 0',
  minWidth: 0,
  // 关键：`flex: 1 1 0` 只是「基准宽度为 0」，它的 max-content 贡献仍然是内容宽度
  // （flex 规范 §9.9.3：flex-grow ≠ 0 时贡献取内容尺寸），卡片照样被撑宽。
  // `contain: inline-size` 才是把「行内尺寸与内容无关」这条规则用上：
  // 候选条的固有宽度不再进卡片的内容宽度，而它自己照样横向滚动。
  contain: 'inline-size',
};

/**
 * 「文字生成 / 图片生成 / 导入 GLB」三颗按钮所在的那一行。
 *
 * sticky 到卡片体底部：这三颗是用户 2026-11-15 点名「很重要、不该收在下方」的动作，
 * 收在折叠线以下时用户既看不见也点不到（2026-11-17 真实缺陷）。
 */
export const FACILITY_MODEL_ACTION_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  marginTop: 6,
  position: 'sticky',
  bottom: 0,
  zIndex: 1,
  paddingTop: 6,
  marginBottom: 0,
  background: PLANNING_SURFACE.panelBg,
};
