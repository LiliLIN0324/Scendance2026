import type {
  PlanFacility,
  PlanPoint,
  SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { PLANNING_ZONE_COLORS, PLANNING_ZONE_OPACITY } from '@/lib/outdoor-plan-tokens';

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
  return {
    width,
    depth,
    scaleX,
    scaleZ,
    toShell(point: PlanPoint): ShellPoint {
      // y 北向 → z 南向：北沿落到 z=0，与壳体一致。
      return {
        x: clamp((point.x - minX) * scaleX, 0, width),
        z: clamp((maxY - point.y) * scaleZ, 0, depth),
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
}

const PROP_KIND_BY_TEMPLATE: Record<string, PlanPropKind> = {
  'booth-2x2': 'kiosk',
  'tent-3x3': 'tent',
  'medical-tent-4x3': 'tent',
  'food-truck-6x2.5': 'foodTruck',
  'stage-platform-8x6': 'stage',
  'toilet-2.4x1.2': 'toilet',
  'security-post-1.5x1.5': 'post',
  'trash-point-1.2x1.2': 'bin',
};

/** 模板名兜底：自定义模板也能按关键词落到合适的 3D 物件，而不是一律灰盒子。 */
export function planPropKind(templateId: string): PlanPropKind {
  const known = PROP_KIND_BY_TEMPLATE[templateId];
  if (known) return known;
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
}

/**
 * 设施占地矩形：绕自身中心按 `rotationDeg` 旋转后的四角。
 *
 * 2D 画布是「x 东、y 向屏幕下方=南」，`rotationDeg` 在画布上顺时针为正；
 * 壳体也是 x 东、z 向南，所以这里用同一套顺时针旋转换算，两个视图的朝向一致。
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
  return corners.map(([dx, dz]) => ({
    x: clamp(center.x + dx * cos - dz * sin, 0, frame.width),
    z: clamp(center.z + dx * sin + dz * cos, 0, frame.depth),
  }));
}

/**
 * 设施在 3D 里的落地形态：中心点 + 缩放后的占地 + 朝向。
 *
 * 尺寸给一个下限（0.6 m）：2D 里可以画一个很小的占位，但 3D 立一个 20 cm 的帐篷
 * 没有任何信息量，不如按「最小可辨认物件」画。
 */
export function facilityProp(
  facility: Pick<PlanFacility, 'id' | 'templateId' | 'name' | 'position' | 'rotationDeg' | 'size'>,
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
  };
}

/** 把一整份平面规划摊成 3D 地面上的图形（纯数据，供 three 层直接消费）。 */
export function planFootprintShapes(
  plan: Pick<SitePlanData, 'boundary' | 'zones' | 'facilities' | 'routes' | 'nodes' | 'workers'>,
  target: { width: number; depth: number },
): PlanFootprintShapes | null {
  const frame = planShellFrame(plan.boundary, target);
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
      color: ROUTE_COLORS[route.kind] ?? ROUTE_COLORS.pedestrian!,
      oneWay: route.oneWay,
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
  };
}