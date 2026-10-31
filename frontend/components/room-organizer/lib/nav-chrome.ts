import { LEFT_CARD_WIDTH_DEFAULT, LEFT_CARD_WIDTH_MAX, LEFT_CARD_WIDTH_MIN } from './left-card-width';

/**
 * 左侧导航的开合不单独记状态。
 *
 * 左列在不在，只看已经存在的两扇门：
 * - `agentCollapsed`：晴光列
 * - `sidebarCollapsed`：工具抽屉（选中物料 / 观感）
 *
 * 两扇都关着 = 导航收起（64px 轨，只见 logo）。
 * 任一扇开着 = 导航展开（左卡在，顶上是短品牌条）。
 *
 * logo 只写这两扇门：收起时两扇都关；展开时只开晴光，工具抽屉保持关着。
 * 晴光自己的收起、模式切换、打开评审/执行，以及以后同样去写这两扇门的场景回调
 * （包括尚未落地的 applySceneLayout）都会反映到 logo 上，不必再同步第三套布尔。
 */
export interface NavColumns {
  agentCollapsed: boolean;
  sidebarCollapsed: boolean;
}

/** 收起后的模式轨。与工作台 grid 第一列 `--sc-nav-rail-width` 一致。 */
export const NAV_RAIL_WIDTH_PX = 64;

/**
 * 展开后的短品牌条不另设一列固定宽度。
 * 它铺满左卡：左卡由 `left-card-width` 钳在 240–480，默认 320。
 */
export const NAV_BRAND_BAR_WIDTH = '100%' as const;

export const NAV_EXPAND_LABEL = '展开导航栏';
export const NAV_COLLAPSE_LABEL = '收起导航栏';

export function navToggleLabel(expanded: boolean): string {
  return expanded ? NAV_COLLAPSE_LABEL : NAV_EXPAND_LABEL;
}

export function isNavExpanded(columns: NavColumns): boolean {
  return !columns.agentCollapsed || !columns.sidebarCollapsed;
}

export function toggleNavColumns(columns: NavColumns): NavColumns {
  if (isNavExpanded(columns)) return { agentCollapsed: true, sidebarCollapsed: true };
  return { agentCollapsed: false, sidebarCollapsed: true };
}

/** 左卡宽度边界。品牌条跟着这列走，测试用来锁住「不要另写死一列」。 */
export const NAV_BRAND_BAR_TRACKS = {
  min: LEFT_CARD_WIDTH_MIN,
  default: LEFT_CARD_WIDTH_DEFAULT,
  max: LEFT_CARD_WIDTH_MAX,
} as const;
