/** Top-level editor IA modes (Phase 1). Planning brief nests under layout — no separate 策划 mode. */
export type WorkbenchMode = 'layout' | 'review' | 'delivery';

export const WORKBENCH_MODES: ReadonlyArray<{ id: WorkbenchMode; label: string; hint: string }> = [
  { id: 'layout', label: '布置', hint: '场地、物料与方案预览' },
  { id: 'review', label: '评审', hint: '给客户看的方案' },
  { id: 'delivery', label: '执行', hint: '交接、点验与导出' },
];

export const WORKBENCH_MODE_DEFAULT: WorkbenchMode = 'layout';

/** Collapsed ~48px rail lucide names — distinct from materials Boxes / view Layers|Eye|Grid / header ClipboardList. */
export const WORKBENCH_MODE_ICONS = {
  layout: 'SquareStack',
  review: 'Send',
  delivery: 'ListChecks',
} as const satisfies Record<WorkbenchMode, string>;

export const WORKFLOW_GUIDE_DISMISS_KEY = 'scendance.workflowGuide.dismissed';
