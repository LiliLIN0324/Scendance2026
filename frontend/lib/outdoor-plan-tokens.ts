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
  measure: '#2fa8b5', // 测量标注（H3-a）：青色，与其他图层色互异
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
} as const;

/** 图标尺寸（H4-a）：图例条目 / 类型胶囊 / 工具按钮三档（px）。 */
export const PLANNING_ICON_SIZES = {
  legend: 12,
  capsule: 11,
  tool: 12,
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
] as const;

export type PlanningIconName = (typeof PLANNING_ICONS)[number];

/** 类型胶囊的语义文案（H2-b 分区 + H2-c 设施 + H2-d 人员 + H3-a 测量）。 */
export const PLANNING_LABELS = {
  boundary: '场地边界',
  zone: '功能分区',
  facility: '设施',
  route: '动线',
  access: '出入口',
  worker: '人员',
  measure: '测量',
} as const;

/** H2-b/H2-c/H2-d/H3-a 画布编辑模式文案（面板工具行）。 */
export const PLANNING_EDIT_MODE_LABELS = {
  view: '浏览',
  boundary: '画边界',
  'boundary-vertex': '编辑边界',
  zone: '画分区',
  facility: '放设施',
  route: '画动线',
  node: '放节点',
  worker: '布人员',
  measure: '测量',
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
};

/**
 * 编辑工具图标映射（H4-a）：九个编辑模式各配一枚 Lucide 工具图标，与 PLANNING_EDIT_MODE_LABELS
 * 键一一对应；工具语义与图层语义可同源（放设施=tent、画动线=route）。
 */
export const PLANNING_EDIT_MODE_ICONS: Record<PlanningEditMode, PlanningIconName> = {
  view: 'hand',
  boundary: 'pen-tool',
  'boundary-vertex': 'move',
  zone: 'lasso',
  facility: 'tent',
  route: 'route',
  node: 'door-open',
  worker: 'user-plus',
  measure: 'ruler',
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
