/**
 * 画布右键的意图判定（纯函数，供 2D 舞台的 onContextMenu 分派）。
 *
 * 成熟编辑器的共同惯例：
 * - Blender / Unity / Unreal：右键 = 放弃当前放置/变换；
 * - AutoCAD：右键 = 结束当前命令；
 * - Figma / Sketch：放置中用 Esc 取消，右键留给上下文菜单。
 *
 * 本产品已经有右键菜单（浏览/选择态）和右键撤点（画线态），所以放置态单独收口：
 * 待放置物料时右键只做「取消放置」，不弹菜单、不落位；其余模式保持原行为。
 */
export type PlanRightClickAction = 'cancel-placement' | 'remove-draft-vertex' | 'context-menu' | 'ignore';

export function planRightClickAction(input: {
  /** 当前画布工具（PlanningEditMode）。 */
  mode: string;
  /** 是否正有待放置的设施/物料（模板或物料卡载荷仍在）。 */
  placing: boolean;
  /** 画线草稿已有多少个节点。 */
  draftCount: number;
}): PlanRightClickAction {
  if (input.mode === 'facility' && input.placing) return 'cancel-placement';
  if ((input.mode === 'zone' || input.mode === 'boundary' || input.mode === 'route') && input.draftCount > 0) {
    return 'remove-draft-vertex';
  }
  if (input.mode === 'view' || input.mode === 'select') return 'context-menu';
  return 'ignore';
}
