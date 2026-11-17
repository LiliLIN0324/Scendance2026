/**
 * 户外 2D 规划视觉 tokens（H1-c 基础 + H4-a 全量）。建立 2D 规划层与既有品牌收口的单一视觉契约：
 * - 主色沿用品牌幕景绿（`globals.css` 的 `--green-deep: #35624A`，与 `lib/brand-tokens.test.ts` 同口径），不另立新绿。
 * - 间距 / 圆角为紧凑、一致的比例尺，供 H2/H4 的 2D 画布与面板使用。
 * - 图层色板区分边界 / 分区 / 设施 / 动线 / 人员 / 节点 / 测量，H2-b 画区、H2-d 动线、H3-a 测量、H3-c 图例直接消费。
 * - H4-a 全量补齐：排版字号 / 面板表面色（原画布内联 hex 收敛入 tokens）/ 图标尺寸 / 透明度工具；
 *   Lucide 图标注册表 + 三张映射表（图层 / 编辑工具 / 信息页签），组件层 `outdoor-plan-icons.ts`
 *   负责 kebab 名 → LucideIcon 组件的编译期闭环映射（自绘同风格，不扒 OnePlan 素材）。
 */

/** 间距尺度（px）：紧凑布局适配小窗口。 */
export const PLANNING_SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/** 圆角尺度（px）。 */
export const PLANNING_RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

/** 2D 规划图层配色（全为 #rrggbb 小写，符合 SitePlan 颜色约束）。 */
export const PLANNING_LAYER_COLORS = {
  boundary: '#35624A', // 场地边界 = 品牌绿
  zone: '#7FB69A',
  facility: '#C98A2C',
  route: '#4A6FA3',
  access: '#3D6FA8',
  worker: '#B3628C',
  node: '#6B6B6B',
  measure: '#1f1f1f', // 测量：中性近黑（Google 测距口径），深底图自动转白，见 PLANNING_MEASURE_COLORS
  annotate: '#8e44ad', // 2026-11-11 用户指令：自由标注（文本/形状）：紫色，与其他图层色互异
} as const;

/**
 * 用地红线色（2026-11-16 用户：「做建筑设计会画一条用地红线」）。
 *
 * 为何不放进 `PLANNING_LAYER_COLORS`：那组 key 被图层可见性/图层图标/图例按
 * `Record<keyof typeof …>` 派生，多一个“不是图层”的 key 会连带要求补三张表。
 * 红色只属于地界线本身，单独一个常量刚好。
 * 越界警示仍用红色**虚线**：实线红 = 地界，虚线红 = 出错。
 */
export const PLANNING_BOUNDARY_LINE_COLOR = '#c8362c';

/**
 * 墙体两型配色（2026-11-17，M2 walls）：外墙深、内墙浅；实体自带 `color` 时优先。
 * 图例先用这份；2D 画布尚未消费 `plan.walls`，图面墙线等渲染线解锁后再共用。
 */
export const PLANNING_WALL_KIND_COLORS = {
  exterior: '#4b5563',
  interior: '#9ca3af',
} as const;

/** 墙体缺省类型（旧数据/迁移未判内外）时的中性色。 */
export const PLANNING_WALL_COLOR = '#6b7280';

/**
 * 出入口三型专属色（2026-11-15 用户：「入口 / 出口 / 出入口」要有各自的样子）：
 * 绿进、红出、青双向。贴纸芯片、放置幽灵、图例色块、工具箱选项四处共用这一份，
 * 同时就是 `plan-footprint-geometry` 里三维点位的配色来源——2D 与 3D 不会各说各话。
 */
export const PLANNING_NODE_KIND_COLORS = {
  entry: '#2f8f6a',
  exit: '#c0392b',
  both: '#3d8fa8',
} as const;

export type PlanningNodeKind = keyof typeof PLANNING_NODE_KIND_COLORS;

/**
 * 测量要素（距离/面积/路径）中性配色，对齐 Google Maps 测距：浅底近黑实线、
 * 卫星/深色底转白实线；端点为白心圆环，读数文字直接贴线、配反色描边光晕。
 * 全为 #rrggbb 小写。
 */
export const PLANNING_MEASURE_COLORS = {
  light: '#1f1f1f',
  dark: '#ffffff',
} as const;
export type PlanningLayerKind = keyof typeof PLANNING_LAYER_COLORS;

/**
 * 三类动线专属配色（H2-d）：人行蓝 / 车辆紫 / 后勤金，线型另有实线/长划/点划区分。
 * route 主色沿用图层色；三类色互异且都与图层色不同名，图例可辨。全为 #rrggbb 小写。
 */
export const PLANNING_ROUTE_KIND_COLORS = {
  pedestrian: '#4a6fa3',
  vehicle: '#8a6fa8',
  service: '#c9a22c',
} as const;

export type PlanningRouteKind = keyof typeof PLANNING_ROUTE_KIND_COLORS;

/**
 * 冲突/缺失标记色（H3-b）：冲突红 / 缺失橙 / 待核实灰。画布可定位标记与面板
 * 问题清单共用同一组色，与既有警示红 #c0392b 同源。全为 #rrggbb 小写。
 */
export const PLANNING_CONFLICT_COLORS = {
  conflict: '#c0392b',
  missing: '#e67e22',
  unverified: '#8b9aa6',
} as const;

export type PlanningConflictStatus = keyof typeof PLANNING_CONFLICT_COLORS;

/**
 * 分区语义默认色（H2-b）。覆盖 SitePlan 契约全部九类语义（含卡片「六类」主语义），
 * 分区未显式指定 color 时按语义取默认；医疗红取警示语义，舞台沿用设施暖色系。
 * 全为 #rrggbb 小写，符合 SitePlan 颜色约束。
 */
export const PLANNING_ZONE_COLORS = {
  stage: '#c98a2c',
  audience: '#7fb69a',
  parking: '#5e7fa6',
  loading: '#8a6fa8',
  checkin: '#3d8fa8',
  queue: '#c9a22c',
  medical: '#c0392b',
  vip: '#b3628c',
  reserved: '#8b9aa6',
  /** 2026-11-14 用户指令「建筑给室内分区」：室内区域 = 深灰蓝（与建筑禁区灰块呼应）。 */
  indoor: '#4d5866',
} as const;

export type PlanningZoneSemantic = keyof typeof PLANNING_ZONE_COLORS;

/** 分区透明度（H2-b）：OnePlan Areas 的 fill 透明度对应，默认 22%，可编辑但夹在区间内。 */
export const PLANNING_ZONE_OPACITY = {
  default: 0.22,
  min: 0.05,
  max: 0.6,
} as const;

/** 排版字号（H4-a）：面板标题 / 行内文本 / 脚注提示三档，紧凑布局适配小窗口。 */
export const PLANNING_TYPOGRAPHY = {
  panel: 12,
  row: 11,
  hint: 10,
} as const;

/**
 * 面板表面色（H4-a 建立，v5 收敛冷石画廊白）：画布左右面板 / 输入控件 / 激活态 /
 * 选中态 / 状态文案的唯一来源。值对齐主产品设计规范 docs/05-设计规范.md §一.1
 * 与 globals.css 的 CSS 变量（--paper/--hair/--ink/--plane/--green/--warn/--err），
 * 户外规划不再是独立深色产品——视觉完全服从主产品「冷石画廊白」：
 * 纯白纸面、发丝线分区、近黑墨字、品牌绿仅点睛（选中/激活）。
 * rgba 允许（面板底/选中底），hex 一律小写。
 */
export const PLANNING_SURFACE = {
  /** 面板底 = --paper 纯白（发丝线分区，不用深色底）。 */
  panelBg: '#ffffff',
  /** 面板描边 = --hair #E4E4E7 发丝线。 */
  panelBorder: '#e4e4e7',
  /** 面板正文 = --ink #141416 近黑墨字。 */
  panelText: '#141416',
  /** 输入控件底 = --plane #F4F5F7。 */
  fieldBg: '#f4f5f7',
  /** 激活态底 = --green-pale #EEF3EF（绿仅点睛：激活/选中/确认）。 */
  activeBg: '#eef3ef',
  /** 选中描边 = --green #4A7C59。 */
  selectedBorder: '#4a7c59',
  /** 选中底 = 品牌绿 12% 透明。 */
  selectedBg: 'rgba(74, 124, 89, 0.12)',
  /** 警示文字 = --warn #96651F。 */
  warnText: '#96651f',
  /** 危险文字 = --err #B4443C。 */
  dangerText: '#b4443c',
} as const;

/** 冷石画廊白文字层级（v5 新增）：面板内次级文字 / 弱化说明，对齐 --ink-soft / --muted。 */
export const PLANNING_TEXT = {
  /** 次级文字 = --ink-soft #55585F。 */
  soft: '#55585f',
  /** 弱化说明 = --muted #71767E。 */
  muted: '#71767e',
  /** 占位 / 禁用灰 = --faint #A6AAB2，比 muted 更浅，仅占位与禁用态。 */
  faint: '#a6aab2',
} as const;

/** 图标尺寸（H4-a）：图例条目 / 类型胶囊 / 工具按钮三档（px）。 */
export const PLANNING_ICON_SIZES = {
  legend: 12,
  capsule: 11,
  tool: 12,
} as const;

/**
 * 分段控件共享尺度（2026-11-13 收口）：画布左下「2D / 3D」胶囊与左栏
 * 「添加物件 / 已放置物件」页签同属 B 墨黑分段范式——激活段近黑墨实底白字、
 * 非激活次级墨字；两处只允许圆角形态不同（浮层短胶囊全圆角 / 内嵌宽分段小圆角），
 * 高度 / 字号 / 字重 / 内边距一律从本档取，不再各自写裸值。
 */
export const PLANNING_SEGMENTED = {
  /** 段内高度（px）。 */
  height: 34,
  /** 容器内边距（px）。 */
  containerPadding: 3,
  /** 段间距（px）。 */
  gap: 3,
  /** 浮层短胶囊：全圆角。 */
  radiusPill: 999,
  /** 内嵌宽分段：容器圆角（px）。 */
  radiusInline: PLANNING_RADIUS.md,
  /** 分段字号（px），介于面板正文与标题之间的强调档。 */
  fontSize: 13,
  activeWeight: 600,
  inactiveWeight: 500,
} as const;

/**
 * #rrggbb → rgba() 字符串（H4-a）：类型胶囊 / 选中态等需要「图层色 + 透明度」的场景，
 * 从 tokens hex 派生，不另立色值。非法输入原样返回（防御式，测试钉住合法路径）。
 */
export function withAlphaHex(hex: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return hex;
  const value = Number.parseInt(match[1]!, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Lucide 图标名（kebab-case，lucide-react 1.48 全部可解析）。H4-a 自绘同风格，不扒 OnePlan 素材。
 * 组件层 `outdoor-plan-icons.ts` 以 `Record<PlanningIconName, LucideIcon>` 强制闭环：
 * 登记名没有组件映射 = tsc 直接报错；`layer-group`（lucide-react 1.48 无 LayerGroup 导出）
 * 已替换为 `layers`。
 */
export const PLANNING_ICONS = [
  'shapes', // 分区 / 区域（分区图例与胶囊）
  'hexagon', // 场地边界（边界图层图标）
  'tent', // 设施（设施图例 / 胶囊 / 放置工具）
  'brick-wall', // 墙体（图例，2026-11-17 M2 walls）
  'truck', // 车辆 / 后勤（车辆语境备用，H5 导出沿用）
  'ruler', // 测量
  'route', // 动线
  'users', // 人员
  'user-plus', // 布人员工具
  'door-open', // 出入口
  'hand', // 浏览（平移缩放）工具
  'pen-tool', // 画边界工具
  'move', // 编辑边界（拖顶点）工具
  'lasso', // 画分区工具
  'layers', // 图层栈（替代 layer-group）
  'layout-grid', // 信息面板 · 总览
  'list', // 信息面板 · 清单
  'triangle-alert', // 信息面板 · 问题
  'info', // 信息面板 · 图例
  'sticky-note', // 标注
  'undo-2', // 撤销
  'redo-2', // 重做
  'map-pin', // 回到场地
  'download', // 导出
  'lock', // 图层锁定
  'lock-open', // 图层解锁
  'rotate-cw', // 设施旋转
  'copy', // 设施复制 / 坐标复制
  'plus', // 属性卡手风琴展开（Object setup / Notes，2026-11-12）
  'x', // 属性卡换页返回（阵列复制页关闭钮，2026-11-12）
  'box-select', // 框选工具（OnePlan Selection tool，2026-11-12）
  'sliders-horizontal', // 工具与属性浮窗（选中物体属性）
  'chevron-up', // 浮窗收起
  'chevron-down', // 浮窗展开
  'square', // 标注形状 · 矩形
  'circle', // 标注形状 · 圆形
  'triangle-shape', // 标注形状 · 三角形（区别于 triangle-alert 警示）
  'minus', // 标注形状 · 线段
  'footprints', // 动线类型 · 人行（2026-11-16 用户：类型不要下拉）
  'person-standing', // 动线类型 · 人行（2026-11-16 用户：要“行人”，不要脚印）
  'package', // 动线类型 · 后勤
] as const;

export type PlanningIconName = (typeof PLANNING_ICONS)[number];

/** 类型胶囊的语义文案（H2-b 分区 + H2-c 设施 + H2-d 人员 + H3-a 测量）。 */
export const PLANNING_LABELS = {
  boundary: '用地红线',
  zone: '功能分区',
  facility: '设施',
  route: '动线',
  access: '出入口',
  worker: '人员',
  measure: '测量',
  annotate: '标注',
} as const;

/** H2-b/H2-c/H2-d/H3-a 画布编辑模式文案（面板工具行）。 */
export const PLANNING_EDIT_MODE_LABELS = {
  view: '浏览',
  // 2026-11-12 OnePlan Selection tool：框选多选设施（S 快捷键，浏览旁并列钮）。
  select: '选择',
  boundary: '画红线',
  'boundary-vertex': '编辑红线',
  // 2026-11-15 用户指令「先快速画一个大陆，外面加蒙版」：设计范围是场地壳外面的一圈，
  // 单独一个模式——它不参与越界判定，只决定「哪块地算这次设计」。
  scope: '圈设计范围',
  zone: '画分区',
  facility: '放设施',
  route: '画动线',
  node: '放节点',
  worker: '布人员',
  // 2026-11-17 #118 补录入 UI：车辆是独立集合（plan.vehicles），与人员/设施并列。
  vehicle: '布车',
  measure: '测量',
  // 2026-11-11 用户指令：自由标注两模式（OnePlan 工具栏 T / 形状同款）。
  note: '放文本',
  shape: '画形状',
} as const;

export type PlanningEditMode = keyof typeof PLANNING_EDIT_MODE_LABELS;

/**
 * 图层图标映射（H4-a）：图层栈开关与类型胶囊共用。键覆盖 PLANNING_LAYER_COLORS 全部
 * 图层（含 node——出入口点位色与 access 同层）。值必须已登记 PLANNING_ICONS。
 */
export const PLANNING_LAYER_ICONS: Record<PlanningLayerKind, PlanningIconName> = {
  boundary: 'hexagon',
  zone: 'shapes',
  facility: 'tent',
  route: 'route',
  access: 'door-open',
  worker: 'users',
  node: 'door-open',
  measure: 'ruler',
  annotate: 'sticky-note',
};

/**
 * 编辑工具图标映射（H4-a）：九个编辑模式各配一枚 Lucide 工具图标，与 PLANNING_EDIT_MODE_LABELS
 * 键一一对应；工具语义与图层语义可同源（放设施=tent、画动线=route）。
 */
export const PLANNING_EDIT_MODE_ICONS: Record<PlanningEditMode, PlanningIconName> = {
  view: 'hand',
  // 2026-11-12 OnePlan Selection tool：虚线框选图标（OnePlan Selection tool: S 同语义）。
  select: 'box-select',
  boundary: 'pen-tool',
  'boundary-vertex': 'move',
  // 设计范围用外框图标；hexagon 已登记，与边界的笔尖、分区的套索都不撞。
  scope: 'hexagon',
  zone: 'lasso',
  facility: 'tent',
  route: 'route',
  node: 'door-open',
  worker: 'user-plus',
  // 2026-11-17 #118 补录入 UI：布车模式用车图标（已登记的 truck，与「车」组同源）。
  vehicle: 'truck',
  measure: 'ruler',
  // 2026-11-11 用户指令：自由标注（文本=便签图标、形状=shapes 组合图标）。
  note: 'sticky-note',
  shape: 'shapes',
};

/**
 * 信息面板页签图标映射（H4-a）：总览 / 清单 / 问题 / 图例四页签，键与画布组件
 * INFO_TABS 顺序一致。
 */
export const PLANNING_INFO_TAB_ICONS = {
  overview: 'layout-grid',
  inventory: 'list',
  issues: 'triangle-alert',
  legend: 'info',
} as const;
