import { ROOM_OBJECT_TAGS } from './room-builder';
import { planFootprintShapes, type ShellPoint } from '../lib/plan-footprint-geometry';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type * as ThreeNS from 'three';

/**
 * 把 2D 规划实体摊到 3D 地面（P2-g「2D 设施与 3D 物料对位」的渲染层）。
 *
 * 几何全部在**壳体坐标**里算好（见 `lib/plan-footprint-geometry`），这里只负责翻成
 * three 的坐标：与 `buildStructureShell` 同一套「ShapeGeometry 绕 X 轴 -90°」把
 * (x, y) 铺成 (x, 0, -y)，所以分区色块正好贴在地面多边形上，不靠手调偏移。
 *
 * 抬升用 group 内的 z 把每层错开 1 cm 以内：贴地越近越像"画在地面上"，同时避免
 * 与地板 z-fighting。整个 group 打 `ROOM_OBJECT_TAGS.PlanFootprint` 标记，
 * 重建时 `removeTagged` 一次清掉，进出 3D/2D 不留残影。
 */

/** 各层的贴地高度（米）：边界 → 分区 → 设施 → 动线 → 点位，始终保持这个叠放次序。 */
const ELEVATION = {
  boundary: 0.02,
  zone: 0.03,
  facility: 0.035,
  route: 0.045,
  marker: 0.055,
} as const;

const MARKER_RADIUS = 0.9;

function shapePoint(point: ShellPoint, metrics: { width: number; depth: number }): [number, number] {
  return [point.x - metrics.width / 2, -(point.z - metrics.depth / 2)];
}

function ringShape(
  THREE: typeof import('three'),
  ring: readonly ShellPoint[],
  metrics: { width: number; depth: number },
): import('three').ShapeGeometry {
  const shape = new THREE.Shape();
  ring.forEach((point, index) => {
    const [x, y] = shapePoint(point, metrics);
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function flatMaterial(
  THREE: typeof import('three'),
  color: string,
  opacity: number,
): import('three').MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

function borderLine(
  THREE: typeof import('three'),
  ring: readonly ShellPoint[],
  metrics: { width: number; depth: number },
  color: string,
  opacity: number,
  elevation: number,
): import('three').Line {
  const points = ring.map(point => {
    const [x, y] = shapePoint(point, metrics);
    return new THREE.Vector3(x, y, 0);
  });
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity });
  const line = new THREE.LineLoop(geometry, material);
  line.rotation.x = -Math.PI / 2;
  // 抬升走 Y：几何先绕 X 轴 -90° 铺平，position 是场景轴，改 z 只会往南平移不会升高。
  line.position.y = elevation;
  return line;
}

export interface PlanFootprintMetrics {
  width: number;
  depth: number;
}

/**
 * 构建 2D 规划的 3D 地面图层。返回 false 表示平面数据不足（边界退化），
 * 调用方据此跳过挂载——不要在场上留一个空 group 影响后续重建判断。
 */
export function buildPlanFootprint(
  THREE: typeof import('three'),
  scene: ThreeNS.Scene,
  plan: SitePlanData | null | undefined,
  metrics: PlanFootprintMetrics,
): boolean {
  if (!plan) return false;
  const shapes = planFootprintShapes(plan, metrics);
  if (!shapes || shapes.boundary.length < 3) return false;

  const group = new THREE.Group();
  group.name = 'plan-footprint';
  group.userData.type = ROOM_OBJECT_TAGS.PlanFootprint;

  // 分区：半透明色块 + 描边，和 2D 画布同一套语义色。
  for (const zone of shapes.zones) {
    if (zone.points.length < 3) continue;
    const mesh = new THREE.Mesh(ringShape(THREE, zone.points, metrics), flatMaterial(THREE, zone.color, zone.opacity));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ELEVATION.zone;
    mesh.userData.planZoneId = zone.id;
    group.add(mesh);
    group.add(borderLine(THREE, zone.points, metrics, zone.color, Math.min(0.9, zone.opacity + 0.35), ELEVATION.zone));
  }

  // 设施：按平面上的占地矩形 + 朝向铺一块地贴（"物料在哪儿"先落在个真实占位上）。
  for (const facility of shapes.facilities) {
    if (facility.points.length < 3) continue;
    const mesh = new THREE.Mesh(ringShape(THREE, facility.points, metrics), flatMaterial(THREE, facility.color, 0.5));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ELEVATION.facility;
    mesh.userData.planFacilityId = facility.id;
    group.add(mesh);
    group.add(borderLine(THREE, facility.points, metrics, facility.color, 0.95, ELEVATION.facility + 0.001));
  }

  // 动线：折线直接压在设施之上，颜色区分人行/车辆/后勤。
  for (const route of shapes.routes) {
    if (route.points.length < 2) continue;
    const points = route.points.map(point => {
      const [x, y] = shapePoint(point, metrics);
      return new THREE.Vector3(x, y, 0);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: new THREE.Color(route.color), transparent: true, opacity: 0.95 });
    // 动线是开口折线（Line，不是 LineLoop：闭环会把首尾硬连一条直线）。
    const line = new THREE.Line(geometry, material);
    line.rotation.x = -Math.PI / 2;
    line.position.y = ELEVATION.route;
    line.userData.planRouteId = route.id;
    group.add(line);
  }

  // 出入口点位（环）与人员点位（实心圆盘）：位置对位，尺寸固定，不随缩放乱飘。
  for (const node of shapes.nodes) {
    const [x, y] = shapePoint(node.at, metrics);
    const geometry = new THREE.RingGeometry(MARKER_RADIUS * 0.55, MARKER_RADIUS, 24);
    // 圆盘是绕原点建的：先把几何平移到点位，再绕 X 铺平、按 Y 抬高。
    geometry.translate(x, y, 0);
    const mesh = new THREE.Mesh(geometry, flatMaterial(THREE, node.color, 0.9));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ELEVATION.marker;
    mesh.userData.planNodeId = node.id;
    group.add(mesh);
  }
  for (const worker of shapes.workers) {
    const [x, y] = shapePoint(worker.at, metrics);
    const geometry = new THREE.CircleGeometry(MARKER_RADIUS * 0.45, 18);
    geometry.translate(x, y, 0);
    const mesh = new THREE.Mesh(geometry, flatMaterial(THREE, worker.color, 0.85));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ELEVATION.marker;
    mesh.userData.planWorkerId = worker.id;
    group.add(mesh);
  }

  // 场地轮廓最后画，压在最高层，方便一眼看出 2D 画的边界在哪。
  group.add(borderLine(THREE, shapes.boundary, metrics, '#7fb3ff', 0.85, ELEVATION.boundary));

  scene.add(group);
  return true;
}