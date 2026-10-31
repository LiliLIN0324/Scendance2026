/**
 * Capabilities behind 晴光. The creation surface stays 晴光 + canvas.
 * Review and delivery are not mode-rail buttons; conversation actions (or a later share menu) still open them.
 * Planning brief nests under layout — no separate 策划 mode.
 */
export type WorkbenchMode = 'layout' | 'review' | 'delivery';

export const WORKBENCH_MODES: ReadonlyArray<{ id: WorkbenchMode; label: string; hint: string }> = [
  { id: 'layout', label: '布置', hint: '场地、物料与方案预览' },
  { id: 'review', label: '评审', hint: '给客户看的方案' },
  { id: 'delivery', label: '执行', hint: '交接、点验与导出' },
];

export const WORKBENCH_MODE_DEFAULT: WorkbenchMode = 'layout';

export const WORKFLOW_GUIDE_DISMISS_KEY = 'scendance.workflowGuide.dismissed';
