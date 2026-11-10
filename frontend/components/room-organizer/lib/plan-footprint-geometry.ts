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

export interface PlanFootprintShapes {
  boundary: ShellPoint[];
  zones: PlanFootprintZonesShape[];
  facilities: PlanFootprintFacilityShape[];
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