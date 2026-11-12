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

/**
 * 引导气泡的指向锚点：
 * - `'canvas'`：画布中上（认识画布/动手绘制的步骤）。
 * - `'left'`：画布左缘、箭头指向左侧面板——主产品里是左栏
 *   「添加物件 / 已放置物件」页签，独立工作台里是画布左侧浮窗。
 */
export type GuideAnchor = 'canvas' | 'left';

export const GUIDE_STEP_CONTENT: Record<GuideStep, { title: string; body: string; cta: string; anchor: GuideAnchor }> = {
  welcome: {
    title: '这是你的场地画布',
    body: '底图是真地图瓦片，绿色虚线是场地边界，彩色块是功能分区。拖动平移、滚轮缩放先熟悉场地；左上角搜索框可以直接定位地点。',
    cta: '开始浏览',
    anchor: 'canvas',
  },
  layers: {
    title: '这边是物件库和已放清单',
    body: '「添加物件」按分组列出分区、出入口、动线、设施、人员，点一行就选中对应工具；「已放置物件」是清单树：点击定位、右键删除、行内可显隐锁定。',
    cta: '去看看',
    anchor: 'left',
  },
  edit: {
    title: '点一行物件，到画布动手',
    body: '在「添加物件」点一行（比如观众区），到画布落件：分区左键加点、双击闭合；设施单击即放，拖角改尺寸、圆柄旋转。放错 Ctrl+Z 随时撤销。',
    cta: '开始规划',
    anchor: 'canvas',
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

