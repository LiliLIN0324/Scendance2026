/**
 * 左侧导航的开合不单独记状态。
 *
 * 左列在不在，只看已经存在的两扇门：
 * - `agentCollapsed`：晴光列（方案会话 + 对话）
 * - `sidebarCollapsed`：工具抽屉（选中物料 / 观感）
 *
 * 两扇都关着 = 导航收起，只留 64px 窄轨。
 * 任一扇开着 = 导航展开，左列出现。
 * 幕景锁标两种状态都留在窄轨最顶，不搬到方案会话或对话卡顶上。
 *
 * logo 只写这两扇门：收起时两扇都关；展开时只开晴光，工具抽屉保持关着。
 * 晴光自己的收起、模式切换、打开评审/执行，以及以后同样去写这两扇门的场景回调
 * （包括尚未落地的 applySceneLayout）都会反映到 logo 上，不必再同步第三套布尔。
 */
export interface NavColumns {
  agentCollapsed: boolean;
  sidebarCollapsed: boolean;
}

/** 最左窄轨。幕景锁标和晴光头像都在这一列。与工作台 grid `--sc-nav-rail-width` 一致。 */
export const NAV_RAIL_WIDTH_PX = 64;

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
