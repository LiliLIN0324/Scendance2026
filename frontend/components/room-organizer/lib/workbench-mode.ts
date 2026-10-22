/** Top-level editor IA modes (Phase 1). Planning brief nests under layout — no separate 策划 mode. */
export type WorkbenchMode = 'layout' | 'review' | 'delivery';

export const WORKBENCH_MODES: ReadonlyArray<{ id: WorkbenchMode; label: string; hint: string }> = [
  { id: 'layout', label: '空间布置', hint: '画布、素材架与活动需求' },
  { id: 'review', label: '项目评审', hint: '客户方案评审与发给客户' },
  { id: 'delivery', label: '方案执行', hint: '执行交付、点验与导出' },
];

export const WORKBENCH_MODE_DEFAULT: WorkbenchMode = 'layout';

/** Collapsed ~48px rail lucide names — distinct from materials Boxes / view Layers|Eye|Grid / header ClipboardList. */
export const WORKBENCH_MODE_ICONS = {
  layout: 'SquareStack',
  review: 'Send',
  delivery: 'ListChecks',
} as const satisfies Record<WorkbenchMode, string>;

export const WORKFLOW_GUIDE_DISMISS_KEY = 'scendance.workflowGuide.dismissed';
