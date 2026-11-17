/** 户外右轨/底条共用的三张工具浮卡。 */
export type OutdoorInspectorPanel = 'measure' | 'annotate' | 'selection';
export type OutdoorInspectorPanels = Record<OutdoorInspectorPanel, boolean>;

/**
 * 2026-11-17 用户：测量和标注不能同时用，却可以同时打开，逻辑不对。
 * 测量/标注都是画布绘制工具，开一个就收另一个；属性卡只读，保持独立。
 * 返回原对象表示状态没变，避免无意义的重渲染。
 */
export function applyOutdoorInspectorPanel(
  current: OutdoorInspectorPanels,
  tab: OutdoorInspectorPanel,
  open: boolean,
): OutdoorInspectorPanels {
  if (open && tab === 'annotate') {
    if (current.annotate && !current.measure) return current;
    return { ...current, annotate: true, measure: false };
  }
  if (open && tab === 'measure') {
    if (current.measure && !current.annotate) return current;
    return { ...current, measure: true, annotate: false };
  }
  if (current[tab] === open) return current;
  return { ...current, [tab]: open };
}
