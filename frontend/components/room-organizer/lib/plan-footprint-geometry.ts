import type {
  PlanAnnotation,
  PlanFacility,
  PlanMeasurement,
  PlanPoint,
  SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { PLANNING_LAYER_COLORS, PLANNING_ZONE_COLORS, PLANNING_ZONE_OPACITY } from '@/lib/outdoor-plan-tokens';
import { annotationRectRing } from './site-plan-annotate';

/**
 * 2D 规划实体 → 3D 场地坐标（P2-g「2D 设施与 3D 物料对位」的几何层）。
 *
 * 只做纯计算，不碰 three：输入是 SitePlan 的局部 ENU 米制坐标，输出是
 * **壳体坐标**（`0..width × 0..depth`，x 东、z 向南，北在平面图上沿）——
 * 与 `structure-builder.buildStructureShell` 吃的是同一套口径，所以本层画出来的
 * 地面上分区/设施/动线正好压在 3D 地面上，不需要再猜偏移。
 *
 * 映射按「平面边界的外接框铺满当前场地框」做，两个轴各自缩放：边界同步到 3D 后
 * 两者本来就等大（scale=1，无损）；用户还没同步边界时也能保证实体落在可见地面内，
 * 而不是跑到壳体外。
 */

export interface ShellPoint {
  x: number;
  z: number;
}

export interface PlanShellFrame {
  width: number;
  depth: number;
  /** 平面 ENU 米 → 壳体米 的两轴比例（边界同步后恒为 1）。 */
  scaleX: number;
  scaleZ: number;
  /** 默认把点夹在场地框内；户外倾斜地图关闭，避免框外的线/标注被挤到边上。 */
  clampPoints: boolean;
  /** 平面坐标 → 壳体坐标。 */
  toShell(point: PlanPoint): ShellPoint;
}

const EPS = 0.001;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 平面边界的外接框 → 场地框的映射。边界退化（面积过小）返回 null：
 * 宁可不画，也不要按一个假的框把实体摊在错的位置。
 */
export function planShellFrame(
  boundary: readonly PlanPoint[],
  target: { width: number; depth: number },
  options?: { clampPoints?: boolean },
): PlanShellFrame | null {
  if (boundary.length < 3) return null;
  const width = target.width;
  const depth = target.depth;
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width < 1 || depth < 1) return null;
  const xs = boundary.map(point => point.x);
  const ys = boundary.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rawWidth = maxX - minX;
  const rawDepth = maxY - minY;
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawDepth) || rawWidth < EPS || rawDepth < EPS) return null;
  const scaleX = width / rawWidth;
  const scaleZ = depth / rawDepth;
  const clampPoints = options?.clampPoints !== false;
  return {
    width,
    depth,
    scaleX,
    scaleZ,
    clampPoints,
    toShell(point: PlanPoint): ShellPoint {
      // y 北向 → z 南向：北沿落到 z=0，与壳体一致。
      const x = (point.x - minX) * scaleX;
      const z = (maxY - point.y) * scaleZ;
      if (!clampPoints) return { x, z };
      return {
        x: clamp(x, 0, width),
        z: clamp(z, 0, depth),
      };
    },
  };
}

/** 分区 / 动线的颜色与透明度口径（与 2D 画布同一套 token，3D 里不需要另配一套色）。 */
const ROUTE_COLORS: Record<string, string> = {
  pedestrian: '#2f8f6a',
  vehicle: '#c98a2c',
  service: '#8a6fa8',
};

const NODE_COLORS: Record<string, string> = {
  entry: '#2f8f6a',
  exit: '#c0392b',
  both: '#3d8fa8',
};

const FACILITY_FALLBACK_COLOR = '#8b9aa6';
const WORKER_FALLBACK_COLOR = '#5e7fa6';

function zoneColor(facilityOrZone: { semantic?: string | undefined; color?: string | undefined }): string {
  if (facilityOrZone.color) return facilityOrZone.color;
  const semantic = facilityOrZone.semantic ?? '';
  return (PLANNING_ZONE_COLORS as Record<string, string>)[semantic] ?? ROUTE_COLORS.pedestrian!;
}

export interface PlanFootprintZonesShape {
  id: string;
  semantic: string;
  points: ShellPoint[];
  color: string;
  opacity: number;
}

export interface PlanFootprintFacilityShape {
  id: string;
  points: ShellPoint[];
  color: string;
  label: string;
}

export interface PlanFootprintRouteShape {
  id: string;
  points: ShellPoint[];
  color: string;
  oneWay: boolean;
  /** 屏幕空间线宽（像素），跟人行/车行动线 2D 描边对齐。 */
  lineWidth: number;
}

export interface PlanFootprintStrokeShape {
  id: string;
  points: ShellPoint[];
  color: string;
  closed: boolean;
  lineWidth: number;
  label?: string;
  fill?: boolean;
}

export interface PlanFootprintMarkerShape {
  id: string;
  at: ShellPoint;
  color: string;
  label: string;
}

/** 2D 设施模板 → 3D 里立起来的物件类型（同一份数据，两个视图里是同一个东西）。 */
export type PlanPropKind =
  | 'tent'
  | 'stage'
  | 'kiosk'
  | 'foodTruck'
  | 'toilet'
  | 'post'
  | 'bin'
  | 'misc';

export interface PlanPropShape {
  id: string;
  templateId: string;
  kind: PlanPropKind;
  label: string;
  /** 占地中心（壳体坐标）。 */
  center: ShellPoint;
  /** 占地尺寸（壳体米，已按平面比例缩放）。 */
  width: number;
  depth: number;
  rotationDeg: number;
  /** 2026-11-12 活动包物件主题色（贴纸占位染色；缺省走既有贴纸画法）。 */
  color?: string;
  /**
   * V-5a：设施的手动 3D 模型 override（契约 planFacilitySchema.modelOverride，物料库 slug）。
   * 缺省走 plan-facility-models 的自动挑选；plan-model-layer 落位时优先消费。
   */
  modelOverride?: string;
}

/**
 * 2026-11-11 目录合并（第二阶段）：旧内置模板 id → 物件类型。
 * 这是唯一的别名表 —— 内置 8 模板不再是一套并列目录，而是指向同一批 3D 物件类型。
 */
export const PROP_KIND_BY_TEMPLATE: Record<string, PlanPropKind> = {
  'booth-2x2': 'kiosk',
  'tent-3x3': 'tent',
  'medical-tent-4x3': 'tent',
  'food-truck-6x2.5': 'foodTruck',
  'stage-platform-8x6': 'stage',
  'toilet-2.4x1.2': 'toilet',
  'security-post-1.5x1.5': 'post',
  'trash-point-1.2x1.2': 'bin',
};

/**
 * 每个 3D 物件类型的默认占地（米）。
 *
 * 2026-11-11 目录合并：物件库条目（`oneplan:` 模板）与旧内置模板共用同一张尺寸表，
 * 避免「帐篷」在目录/清单/3D 里出现三个不同尺寸。
 */
export const PLAN_PROP_SIZE: Record<PlanPropKind, { width: number; depth: number }> = {
  tent: { width: 3, depth: 3 },
  stage: { width: 8, depth: 6 },
  kiosk: { width: 2, depth: 2 },
  foodTruck: { width: 6, depth: 2.5 },
  toilet: { width: 2.4, depth: 1.2 },
  post: { width: 1.5, depth: 1.5 },
  bin: { width: 1.2, depth: 1.2 },
  misc: { width: 2, depth: 2 },
};

/** 模板名兜底：自定义模板也能按关键词落到合适的 3D 物件，而不是一律灰盒子。 */
export function planPropKind(templateId: string): PlanPropKind {
  const known = PROP_KIND_BY_TEMPLATE[templateId];
  if (known) return known;
  // 2026-11-12 活动包物件（`pack:` 模板）一律 misc → 2D 贴纸平铺占位：
  // OnePlan 的包线稿就是物件的 3D 脸，不让 'team-wax-truck' 这类 slug 含 truck/van
  // 被关键词拉去立餐车低模、也不让在线物料库按关键词乱配厢式货车。
  if (templateId.startsWith('pack:')) return 'misc';
  // P2-h：物件库模板 id 形如 `oneplan:icon:tent`，关键词只看 slug 段，避免 kind 段干扰。
  const key = templateId.toLowerCase().replace(/^oneplan:(icon|scale|area):/, '');
  if (key.includes('tent') || key.includes('marquee') || key.includes('canopy')) return 'tent';
  if (key.includes('stage') || key.includes('deck') || key.includes('platform')) return 'stage';
  if (key.includes('toilet') || key.includes('restroom') || key.includes('wc')) return 'toilet';
  if (key.includes('truck') || key.includes('van') || key.includes('trailer')) return 'foodTruck';
  if (key.includes('booth') || key.includes('stall') || key.includes('kiosk')) return 'kiosk';
  if (key.includes('post') || key.includes('guard') || key.includes('security')) return 'post';
  if (key.includes('trash') || key.includes('bin') || key.includes('waste')) return 'bin';
  return 'misc';
}

export interface PlanFootprintShapes {
  boundary: ShellPoint[];
  zones: PlanFootprintZonesShape[];
  facilities: PlanFootprintFacilityShape[];
  /** 需要真正立起来的 3D 物件（与 facilities 一一对应，尺寸/朝向已换算到壳体）。 */
  props: PlanPropShape[];
  routes: PlanFootprintRouteShape[];
  nodes: PlanFootprintMarkerShape[];
  workers: PlanFootprintMarkerShape[];
  measurements: PlanFootprintStrokeShape[];
  annotations: PlanFootprintStrokeShape[];
}

/**
 * 设施占地矩形：绕自身中心按 `rotationDeg` 旋转后的四角。
 *
 * `rotationDeg` 在 ENU（x 东、y 北）里逆时针为正；壳体是 x 东、z 南（z = −y）。
 * three 绕 Y 正向把本地 +X 映到 (cosφ, −sinφ)，故壳体矩阵取 φ = rotationDeg，
 * 与室内 itemCorners 同一套 R_y(φ) 式，保证 2D 画布与 3D 朝向一致。
 */
export function facilityFootprint(
  facility: Pick<PlanFacility, 'position' | 'rotationDeg' | 'size'>,
  frame: PlanShellFrame,
): ShellPoint[] {
  const center = frame.toShell(facility.position);
  const halfWidth = (facility.size.width / 2) * frame.scaleX;
  const halfDepth = (facility.size.depth / 2) * frame.scaleZ;
  const theta = (facility.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ];
  return corners.map(([dx, dz]) => {
    const x = center.x + dx * cos + dz * sin;
    const z = center.z - dx * sin + dz * cos;
    if (!frame.clampPoints) return { x, z };
    return {
      x: clamp(x, 0, frame.width),
      z: clamp(z, 0, frame.depth),
    };
  });
}

/**
 * 设施在 3D 里的落地形态：中心点 + 缩放后的占地 + 朝向。
 *
 * 尺寸给一个下限（0.6 m）：2D 里可以画一个很小的占位，但 3D 立一个 20 cm 的帐篷
 * 没有任何信息量，不如按「最小可辨认物件」画。
 */
export function facilityProp(
  facility: Pick<PlanFacility, 'id' | 'templateId' | 'name' | 'position' | 'rotationDeg' | 'size' | 'modelOverride'> & { color?: string | undefined },
  frame: PlanShellFrame,
): PlanPropShape {
  return {
    id: facility.id,
    templateId: facility.templateId,
    kind: planPropKind(facility.templateId),
    label: facility.name,
    center: frame.toShell(facility.position),
    width: Math.max(0.6, facility.size.width * frame.scaleX),
    depth: Math.max(0.6, facility.size.depth * frame.scaleZ),
    rotationDeg: facility.rotationDeg,
    ...(facility.color ? { color: facility.color } : {}),
    // V-5a：手动模型 override 原样透传给 plan-model-layer（undefined 不落键）。
    ...(facility.modelOverride !== undefined ? { modelOverride: facility.modelOverride } : {}),
  };
}

/** 把一整份平面规划摊成 3D 地面上的图形（纯数据，供 three 层直接消费）。 */
function measurementShape(measure: PlanMeasurement, frame: PlanShellFrame): PlanFootprintStrokeShape {
  return {
    id: measure.id,
    points: measure.points.map(point => frame.toShell(point)),
    color: PLANNING_LAYER_COLORS.measure,
    closed: measure.kind === 'area',
    lineWidth: 2.5,
    label: measure.name,
    fill: measure.kind === 'area',
  };
}

function annotationShape(annotation: PlanAnnotation, frame: PlanShellFrame): PlanFootprintStrokeShape | null {
  const color = annotation.color ?? PLANNING_LAYER_COLORS.annotate;
  if (annotation.kind === 'note') {
    if (!annotation.points[0]) return null;
    return {
      id: annotation.id,
      points: [frame.toShell(annotation.points[0])],
      color,
      closed: false,
      lineWidth: 2,
      label: annotation.text || annotation.name,
    };
  }
  if (annotation.kind === 'circle') {
    const center = annotation.points[0];
    const radius = annotation.radiusM ?? 0;
    if (!center || radius <= 0) return null;
    const points: ShellPoint[] = [];
    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * Math.PI * 2;
      points.push(frame.toShell({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      }));
    }
    return { id: annotation.id, points, color, closed: true, lineWidth: 2, fill: true, label: annotation.name };
  }
  if (annotation.kind === 'rect') {
    if (!annotation.points[0] || !annotation.points[1]) return null;
    const ring = annotationRectRing(annotation.points[0], annotation.points[1]).map(point => frame.toShell(point));
    return { id: annotation.id, points: ring, color, closed: true, lineWidth: 2, fill: true, label: annotation.name };
  }
  if (annotation.kind === 'triangle' || annotation.kind === 'line') {
    if (annotation.points.length < (annotation.kind === 'triangle' ? 3 : 2)) return null;
    return {
      id: annotation.id,
      points: annotation.points.map(point => frame.toShell(point)),
      color,
      closed: annotation.kind === 'triangle',
      lineWidth: 2,
      fill: annotation.kind === 'triangle',
      label: annotation.name,
    };
  }
  return null;
}

export function planFootprintShapes(
  plan: Pick<SitePlanData, 'boundary' | 'zones' | 'facilities' | 'routes' | 'nodes' | 'workers' | 'measurements' | 'annotations'>,
  target: { width: number; depth: number },
  options?: { clampPoints?: boolean },
): PlanFootprintShapes | null {
  const frame = planShellFrame(plan.boundary, target, options);
  if (!frame) return null;
  const defaultOpacity = PLANNING_ZONE_OPACITY.default;
  return {
    boundary: plan.boundary.map(point => frame.toShell(point)),
    zones: plan.zones.map(zone => ({
      id: zone.id,
      semantic: zone.semantic,
      points: zone.polygon.map(point => frame.toShell(point)),
      color: zoneColor(zone),
      opacity: clamp(zone.opacity ?? defaultOpacity, PLANNING_ZONE_OPACITY.min, PLANNING_ZONE_OPACITY.max),
    })),
    facilities: plan.facilities.map(facility => ({
      id: facility.id,
      points: facilityFootprint(facility, frame),
      color: facility.color ?? FACILITY_FALLBACK_COLOR,
      label: facility.name,
    })),
    props: plan.facilities.map(facility => facilityProp(facility, frame)),
    routes: plan.routes.map(route => ({
      id: route.id,
      points: route.points.map(point => frame.toShell(point)),
      // 2026-11-12 活动包赛道预设：动线主题色优先（契约 planRouteSchema.color）。
      color: route.color ?? ROUTE_COLORS[route.kind] ?? ROUTE_COLORS.pedestrian!,
      oneWay: route.oneWay,
      lineWidth: route.kind === 'vehicle' ? 3 : 2,
    })),
    nodes: plan.nodes.map(node => ({
      id: node.id,
      at: frame.toShell(node.position),
      color: NODE_COLORS[node.kind] ?? NODE_COLORS.both!,
      label: node.name,
    })),
    workers: plan.workers.map(worker => ({
      id: worker.id,
      at: frame.toShell(worker.position),
      color: worker.color ?? WORKER_FALLBACK_COLOR,
      label: `${worker.role} · ${worker.count} 人`,
    })),
    measurements: (plan.measurements ?? []).map(measure => measurementShape(measure, frame)),
    annotations: (plan.annotations ?? []).map(annotation => annotationShape(annotation, frame)).filter((item): item is PlanFootprintStrokeShape => item != null),
  };
}