/**
 * 首次开图渐进引导（H4-b）——纯函数状态机。
 *
 * 设计（评审稿 §7 交互复刻）：第一次打开规划画布的用户不需要一次性面对九个编辑
 * 工具；引导按「认识画布 → 学会看图层 → 打开编辑」三步渐进披露，每步只在用户
 * 完成对应动作后出现下一步，可随时跳过；跳过状态落 localStorage，二刷不再打扰。
 *
 * 纯函数层不碰 DOM/localStorage——持久化由调用方注入，便于测试。
 */

/** 引导步骤：按披露次序排列。 */
export const GUIDE_STEPS = ['welcome', 'layers', 'edit'] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];

export const GUIDE_STEP_CONTENT: Record<GuideStep, { title: string; body: string; cta: string }> = {
  welcome: {
    title: '这是你的场地画布',
    body: '底图是真瓦片地图。绿色虚线是场地边界，彩色块是功能分区。先拖动、滚轮缩放，熟悉一下场地。',
    cta: '开始浏览',
  },
  layers: {
    title: '右侧是图层栈',
    body: '六类业务图层可独立开关：隐藏的图层只影响显示，全案统计与清单不变。',
    cta: '试试开关',
  },
  edit: {
    title: '准备好就可以开始编辑',
    body: '编辑工具九钮：画边界、编辑顶点、画分区、放设施、拉动线、放节点、布人员、测量，配合撤销随时回退。',
    cta: '开始规划',
  },
};

/** 引导持久化状态（由调用方存取）。 */
export interface GuideState {
  /** 已完成（含跳过）的步骤。 */
  done: GuideStep[];
  /** 用户明确跳过整个引导。 */
  dismissed: boolean;
}

export function initialGuideState(): GuideState {
  return { done: [], dismissed: false };
}

/** 当前应展示的步骤：第一个未完成步骤；全部完成或已跳过则不显示。 */
export function currentGuideStep(state: GuideState): GuideStep | null {
  if (state.dismissed) return null;
  return GUIDE_STEPS.find(step => !state.done.includes(step)) ?? null;
}

/** 完成当前步骤（点击 CTA 或完成对应动作）。幂等。 */
export function completeGuideStep(state: GuideState, step: GuideStep): GuideState {
  if (state.done.includes(step)) return state;
  return { ...state, done: [...state.done, step] };
}

/** 跳过整个引导：所有未完成步骤一并标记完成。 */
export function dismissGuide(_state: GuideState): GuideState {
  return { done: [...GUIDE_STEPS], dismissed: true };
}

/** 读取持久化视图的宽容解析：结构不符时回落初始态，不抛错（引导不能挡画布）。 */
export function parseGuideState(raw: unknown): GuideState {
  if (typeof raw !== 'object' || raw === null) return initialGuideState();
  const obj = raw as { done?: unknown; dismissed?: unknown };
  if (!Array.isArray(obj.done)) return initialGuideState();
  const done = obj.done.filter((s): s is GuideStep =>
    typeof s === 'string' && (GUIDE_STEPS as readonly string[]).includes(s));
  return { done, dismissed: obj.dismissed === true };
}

/** 引导是否还会出现（用于标题栏的「再看一遍」入口）。 */
export function guideWillAppear(state: GuideState): boolean {
  return currentGuideStep(state) !== null;
}

/** 重看引导：清除完成与跳过标记（重看=显式意愿）。 */
export function restartGuide(_state: GuideState): GuideState {
  return { done: [], dismissed: false };
}

/* ---------------- 导出菜单（H4-b 形态层） ---------------- */

/**
 * 导出菜单四项形态（对齐 OnePlan 四件套，实现归 H5）。
 * H4-b 只落形态：图标+文案+可用性；禁用项带「即将上线」而非可点报错。
 */
export const EXPORT_MENU_ITEMS = [
  { id: 'png', label: 'PNG 快照', hint: '72/300 DPI，含比例尺与图例' },
  { id: 'csv', label: 'CSV 清单', hint: '14 字段对齐，Excel 直开' },
  { id: 'geojson', label: 'GeoJSON', hint: '全量几何，GIS 可用' },
  { id: 'share', label: '只读分享', hint: '链接分享，绑定当前快照' },
] as const;

export type ExportItemId = (typeof EXPORT_MENU_ITEMS)[number]['id'];

/** 分享弹窗（毛玻璃）的形态数据：快照摘要 + 链接占位（真实链接 H5-b 生成）。 */
export function shareDialogContent(input: {
  revision: number;
  updatedAt: string;
  counts: { zones: number; facilities: number; routes: number; workers: number };
}): { title: string; lines: string[] } {
  const { revision, updatedAt, counts } = input;
  return {
    title: '分享只读规划',
    lines: [
      `绑定快照 r${revision} · ${updatedAt}`,
      `${counts.zones} 分区 · ${counts.facilities} 设施 · ${counts.routes} 动线 · ${counts.workers} 人员`,
      '链接生成（即将上线）：接收方只读、不可编辑、撤销即失效。',
    ],
  };
}

