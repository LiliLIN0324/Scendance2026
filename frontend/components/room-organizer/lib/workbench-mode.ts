/** Top-level editor IA. Planning brief nests under layout — no separate 策划 mode. */
export type WorkbenchMode = 'layout' | 'review' | 'delivery';

/**
 * 模式轨只常驻布置。评审走工具轨「分享」的方案链接，执行走分享菜单里的到场清单抽屉。
 * `review` / `delivery` 仍留在类型里，供旧调用和测试把晴光暂时放到那一态；
 * 轨上要点它们时走 `demoteLegacyMode`，不占常驻模式。
 */
export const WORKBENCH_MODES: ReadonlyArray<{ id: WorkbenchMode; label: string; hint: string }> = [
  { id: 'layout', label: '布置', hint: '场地、物料与方案预览' },
];

export const WORKBENCH_MODE_DEFAULT: WorkbenchMode = 'layout';

/** Collapsed ~48px rail lucide names — distinct from materials Boxes / view Layers|Eye|Grid / header ClipboardList. */
export const WORKBENCH_MODE_ICONS = {
  layout: 'SquareStack',
  review: 'Send',
  delivery: 'ListChecks',
} as const satisfies Record<WorkbenchMode, string>;

export const WORKFLOW_GUIDE_DISMISS_KEY = 'scendance.workflowGuide.dismissed';

/** 旧的评审/执行入口若还被点到，改去分享或清单，不切工作台模式。 */
export function demoteLegacyMode(mode: WorkbenchMode): 'layout' | 'open-share' | 'open-checklist' {
  if (mode === 'review') return 'open-share';
  if (mode === 'delivery') return 'open-checklist';
  return 'layout';
}
