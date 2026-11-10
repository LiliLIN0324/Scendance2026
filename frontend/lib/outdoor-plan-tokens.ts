/**
 * 户外 2D 规划视觉 tokens（H1-c）。建立 2D 规划层与既有品牌收口的单一视觉契约：
 * - 主色沿用品牌幕景绿（`globals.css` 的 `--green-deep: #35624A`，与 `lib/brand-tokens.test.ts` 同口径），不另立新绿。
 * - 间距 / 圆角为紧凑、一致的比例尺，供 H2/H4 的 2D 画布与面板使用。
 * - 图层色板区分边界 / 分区 / 设施 / 动线 / 人员 / 节点 / 测量，H2-b 画区、H2-d 动线、H3-a 测量、H3-c 图例直接消费。
 * - Lucide 图标集：H4-a 的类型胶囊 / 图层 / 工具图标从 lucide-react 取，这里登记本层用到的图标名（kebab-case）。
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

/** Lucide 图标名（kebab-case，lucide-react 可导入）。H4-a 自绘同风格，不扒 OnePlan 素材。 */
export const PLANNING_ICONS = [
  'shapes', // 边界 / 区域
  'ruler', // 测量
  'route', // 动线
  'users', // 人员
  'truck', // 车辆 / 后勤
  'door-open', // 出入口
  'layer-group', // 图层
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