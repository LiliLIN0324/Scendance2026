import { ROOM_OBJECT_TAGS } from './room-builder';
import { planFootprintShapes, type ShellPoint } from '../lib/plan-footprint-geometry';
import { buildGroundLabel, buildPlanPropObject } from './plan-props-builder';
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
  label: 0.07,
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

/** 分区语义 → 地面标签文字（与 2D 图例同一套中文口径）。 */
const ZONE_LABELS: Record<string, string> = {
  stage: '舞台区',
  audience: '观众区',
  parking: '停车区',
  loading: '后勤装卸',
  checkin: '签到区',
  queue: '排队区',
  medical: '医疗点',
  vip: '贵宾区',
  reserved: '预留区',
};

function boundsOf(points: readonly ShellPoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return { minX, maxX, minZ, maxZ };
}

function centroidOf(points: readonly ShellPoint[]): ShellPoint {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
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

  // 设施实体：同一份 2D 数据在 3D 里立起来（帐篷/舞台/餐车/厕位/摊位/岗亭/垃圾桶）。
  // 位置与朝向都来自 2D 占地，所以两个视图里是同一个物件，不是各画一套。
  for (const prop of shapes.props) {
    const object = buildPlanPropObject(THREE, prop);
    if (!object.children.length) continue;
    object.position.set(prop.center.x - metrics.width / 2, 0, prop.center.z - metrics.depth / 2);
    // 2D 画布顺时针为正；three 绕 Y 正向是逆时针，所以取负。
    object.rotation.y = -(prop.rotationDeg * Math.PI) / 180;
    object.userData.planPropId = prop.id;
    object.name = `plan-prop-${prop.kind}`;
    group.add(object);
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

  // 地面文字：分区名写在区块中心，设施名写在占位南侧（OnePlan 那种「区块带名字」的读图感）。
  // 浏览器里才有 canvas；SSR/单测环境跳过，不影响图形本身。
  for (const zone of shapes.zones) {
    if (zone.points.length < 3) continue;
    const bounds = boundsOf(zone.points);
    const widthM = Math.min(7, Math.max(2.2, (bounds.maxX - bounds.minX) * 0.55));
    const label = buildGroundLabel(
      THREE,
      ZONE_LABELS[zone.semantic] ?? zone.semantic,
      centroidOf(zone.points),
      metrics,
      { widthM, y: ELEVATION.label, color: '#ffffff', bold: true },
    );
    if (label) {
      label.userData.planZoneLabel = zone.id;
      group.add(label);
    }
  }
  for (const prop of shapes.props) {
    const label = buildGroundLabel(
      THREE,
      prop.label,
      { x: prop.center.x, z: prop.center.z + prop.depth * 0.5 + 0.75 },
      metrics,
      { widthM: Math.min(5, Math.max(1.8, prop.width * 0.85)), y: ELEVATION.label, color: '#eef3f8' },
    );
    if (label) {
      label.userData.planPropLabel = prop.id;
      group.add(label);
    }
  }

  // 场地轮廓最后画，压在最高层，方便一眼看出 2D 画的边界在哪。
  group.add(borderLine(THREE, shapes.boundary, metrics, '#7fb3ff', 0.85, ELEVATION.boundary));

  scene.add(group);
  return true;
}