/** Top-level editor IA. Planning brief nests under layout — no separate 策划 mode. */
export type WorkbenchMode = 'layout' | 'review' | 'delivery';

/**
 * 模式轨不放布置 / 评审 / 执行图标。原布置槽换成晴光头像，只打开旁边的对话。
 * 评审走工具轨「分享」的方案链接，执行走分享菜单里的到场清单抽屉。
 * `review` / `delivery` 仍留在类型里，供旧调用把晴光暂时放到那一态；
 * 若还被点到，走 `demoteLegacyMode`，不占常驻模式。
 */
export const WORKBENCH_MODES: ReadonlyArray<{ id: WorkbenchMode; label: string; hint: string }> = [
  { id: 'layout', label: '布置', hint: '场地、物料与方案预览' },
];

export const WORKBENCH_MODE_DEFAULT: WorkbenchMode = 'layout';

export const WORKFLOW_GUIDE_DISMISS_KEY = 'scendance.workflowGuide.dismissed';

/** 旧的评审/执行入口若还被点到，改去分享或清单，不切工作台模式。 */
export function demoteLegacyMode(mode: WorkbenchMode): 'layout' | 'open-share' | 'open-checklist' {
  if (mode === 'review') return 'open-share';
  if (mode === 'delivery') return 'open-checklist';
  return 'layout';
}
