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

/* ---------------- 统一交付面板（户外场地方案） ---------------- */

/**
 * 交付对象（第一期轻量权限）：按对象打包可见动作，不依赖登录角色。
 * - client 对外交付：对方只读查看，不改动本地方案；
 * - review 送评审方：可在方案上落钉、完成评审，回执收进 Bingo；
 * - internal 内部协作：含工作资料与导出，仅团队内部使用。
 */
export const DELIVERY_AUDIENCES = [
  { id: 'client', label: '发给客户', note: '对外交付：对方只读查看，不改动本地方案' },
  { id: 'review', label: '送评审方', note: '送评审方：可在方案上落钉、完成评审，回执收进 Bingo' },
  { id: 'internal', label: '内部协作', note: '内部协作：含工作资料与导出，仅团队内部使用' },
] as const;

export type DeliveryAudience = (typeof DELIVERY_AUDIENCES)[number]['id'];

/** 面板三段：段对哪些交付对象可见（audiences 即定稿 data-aud 清单）。 */
export const DELIVERY_SEGMENTS = [
  { id: 'online', title: '在线分享', tag: '在线链接 · 不改本地方案', audiences: ['client', 'review', 'internal'] },
  { id: 'review', title: '送审 Bingo', tag: '评审留言与回执收进 Bingo 面板', audiences: ['review', 'internal'] },
  { id: 'export', title: '导出资料', tag: '勾选要带走的文件，参数在展开层选', audiences: ['client', 'internal'] },
] as const;

export type DeliverySegmentId = (typeof DELIVERY_SEGMENTS)[number]['id'];

/** 某段对给定交付对象是否可见（纯函数，便于测试）。 */
export function segmentVisible(
  segment: { audiences: readonly DeliveryAudience[] },
  audience: DeliveryAudience,
): boolean {
  return segment.audiences.includes(audience);
}

export type DeliveryExportId = 'png' | 'csv' | 'geojson' | 'pdf' | 'album' | 'handoff';

/** 导出二级参数组（视角 / 画质）；选项先记录选择，档位映射随后端能力补齐。 */
export interface DeliveryExportParamGroup {
  label: string;
  optionsKey: 'view' | 'scale';
  options: string[];
}

export interface DeliveryExportItem {
  id: DeliveryExportId;
  label: string;
  desc: string;
  /** 户外后端是否已接通；未通项进「规划中」折叠区置灰，不绑可点动作。 */
  enabled: boolean;
  /** 未通项的待接通说明。 */
  disabledHint?: string;
  params?: DeliveryExportParamGroup[];
}

/**
 * 导出清单：enabled 按户外真实后端口径——本机已接只读链接 / PNG / CSV / GeoJSON / PDF；
 * 机位册（四机位 three 抓帧）与交接包（任务表 / 物料台账 / 点验资料）尚缺户外对应链路，禁用占位。
 * 注：原型稿曾把 CSV / GeoJSON / PDF 标为规划中，现三项后端已接通，上移到可勾选主清单。
 */
export const DELIVERY_EXPORT_ITEMS: DeliveryExportItem[] = [
  {
    id: 'png',
    label: 'PNG 单帧',
    desc: '按所选机位出一张成图',
    enabled: true,
    params: [
      { label: '视角', optionsKey: 'view', options: ['跟随当前', '整体', '俯视', '正面', '对角'] },
      { label: '画质', optionsKey: 'scale', options: ['1080p', '4K', '6K'] },
    ],
  },
  { id: 'csv', label: '物料清单 CSV', desc: '分区、设施、动线、人员清单，Excel 直开', enabled: true },
  { id: 'geojson', label: 'GeoJSON 几何', desc: '分区与动线几何导出，GIS 可用', enabled: true },
  { id: 'pdf', label: 'PDF 演示稿', desc: '给客户讲解的排版稿', enabled: true },
  {
    id: 'album',
    label: '机位册 HTML',
    desc: '整体 / 俯视 / 正面 / 对角四机位现场出图，附离线图册',
    enabled: false,
    disabledHint: '户外四机位抓帧链路待接通',
    params: [{ label: '画质', optionsKey: 'scale', options: ['1080p', '4K', '6K'] }],
  },
  {
    id: 'handoff',
    label: '交接包 HTML',
    desc: '平面 + 任务表 + 物料工作单 + 点验资料',
    enabled: false,
    disabledHint: '任务表 / 物料 / 点验资料链路待接通',
  },
];

/** 已接通、可勾选导出的项。 */
export const enabledDeliveryExports = DELIVERY_EXPORT_ITEMS.filter(item => item.enabled);
/** 未接通、收进规划中折叠区的项。 */
export const futureDeliveryExports = DELIVERY_EXPORT_ITEMS.filter(item => !item.enabled);

