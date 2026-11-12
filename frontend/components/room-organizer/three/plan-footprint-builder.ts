import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { ROOM_OBJECT_TAGS } from './room-builder';
import { planFootprintShapes, type PlanFootprintStrokeShape, type ShellPoint } from '../lib/plan-footprint-geometry';
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

/** 各层贴在底图之上（米）。2026-11-12 用户反馈「物体没放在平面上」：
 *  旧值（boundary 0.18 … label 0.78）是瓦片金字塔还共面、靠层间距防 z-fighting 时代的
 *  设计——真模型落地后，悬空的色块/标签看起来像物体飘在半空。现在瓦片面片已
 *  depthWrite:false + renderOrder 定序（plan-basemap-tiles），规划层只需要贴着
 *  瓦片金字塔最高点（z19 = 0.048 m）之上以 8–12 mm 级差排开即可。 */
const ELEVATION = {
  boundary: 0.05,
  zone: 0.062,
  facility: 0.074,
  route: 0.086,
  marker: 0.134,
  measure: 0.098,
  annotate: 0.11,
  label: 0.15,
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
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.depthTest = true;
  return material;
}

function lineResolution(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 1920, y: 1080 };
  return { x: Math.max(1, window.innerWidth), y: Math.max(1, window.innerHeight) };
}

function fatLine(
  THREE: typeof import('three'),
  ring: readonly ShellPoint[],
  metrics: { width: number; depth: number },
  color: string,
  opacity: number,
  elevation: number,
  options: { closed?: boolean; lineWidth?: number },
  materials: InstanceType<typeof LineMaterial>[],
): Line2 | null {
  if (ring.length < 2) return null;
  const closed = options.closed === true;
  const positions: number[] = [];
  const source = closed ? [...ring, ring[0]!] : ring;
  for (const point of source) {
    const [x, y] = shapePoint(point, metrics);
    // 直接写场景坐标（x, 抬升, -y），不再靠绕 X 旋转，Line2 在倾斜镜头下宽度才稳定。
    positions.push(x, elevation, -y);
  }
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const resolution = lineResolution();
  const material = new LineMaterial({
    color: new THREE.Color(color).getHex(),
    transparent: true,
    opacity,
    linewidth: options.lineWidth ?? 2,
    depthTest: true,
    depthWrite: false,
    worldUnits: false,
    resolution: new THREE.Vector2(resolution.x, resolution.y),
  });
  materials.push(material);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.renderOrder = 8;
  return line;
}

function borderLine(
  THREE: typeof import('three'),
  ring: readonly ShellPoint[],
  metrics: { width: number; depth: number },
  color: string,
  opacity: number,
  elevation: number,
  materials: InstanceType<typeof LineMaterial>[],
  lineWidth = 2,
): Line2 | null {
  return fatLine(THREE, ring, metrics, color, opacity, elevation, { closed: true, lineWidth }, materials);
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
  options?: { clampPoints?: boolean },
): boolean {
  if (!plan) return false;
  const shapes = planFootprintShapes(plan, metrics, options);
  if (!shapes || shapes.boundary.length < 3) return false;

  const group = new THREE.Group();
  group.name = 'plan-footprint';
  group.userData.type = ROOM_OBJECT_TAGS.PlanFootprint;
  const lineMaterials: InstanceType<typeof LineMaterial>[] = [];
  group.userData.planLineMaterials = lineMaterials;

  // 分区：半透明色块 + 描边，和 2D 画布同一套语义色。
  for (const zone of shapes.zones) {
    if (zone.points.length < 3) continue;
    const mesh = new THREE.Mesh(ringShape(THREE, zone.points, metrics), flatMaterial(THREE, zone.color, zone.opacity));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ELEVATION.zone;
    mesh.userData.planZoneId = zone.id;
    group.add(mesh);
    const zoneBorder = borderLine(THREE, zone.points, metrics, zone.color, Math.min(0.9, zone.opacity + 0.35), ELEVATION.zone, lineMaterials, 2);
    if (zoneBorder) group.add(zoneBorder);
  }

  // 设施：按平面上的占地矩形 + 朝向铺一块地贴（"物料在哪儿"先落在个真实占位上）。
  for (const facility of shapes.facilities) {
    if (facility.points.length < 3) continue;
    const mesh = new THREE.Mesh(ringShape(THREE, facility.points, metrics), flatMaterial(THREE, facility.color, 0.5));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ELEVATION.facility;
    mesh.userData.planFacilityId = facility.id;
    group.add(mesh);
    const facilityBorder = borderLine(THREE, facility.points, metrics, facility.color, 0.95, ELEVATION.facility + 0.001, lineMaterials, 2);
    if (facilityBorder) group.add(facilityBorder);
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

  // 动线：折线直接压在设施之上，颜色区分人行/车辆/后勤。屏幕空间线宽对齐 2D。
  for (const route of shapes.routes) {
    if (route.points.length < 2) continue;
    const line = fatLine(THREE, route.points, metrics, route.color, 0.95, ELEVATION.route, { lineWidth: route.lineWidth }, lineMaterials);
    if (!line) continue;
    line.userData.planRouteId = route.id;
    group.add(line);
  }

  const addStroke = (stroke: PlanFootprintStrokeShape, elevation: number, userDataKey: string): void => {
    if (stroke.points.length >= 2) {
      const line = fatLine(
        THREE,
        stroke.points,
        metrics,
        stroke.color,
        0.95,
        elevation,
        { closed: stroke.closed, lineWidth: stroke.lineWidth },
        lineMaterials,
      );
      if (line) {
        line.userData[userDataKey] = stroke.id;
        group.add(line);
      }
    }
    if (stroke.fill && stroke.points.length >= 3) {
      const mesh = new THREE.Mesh(ringShape(THREE, stroke.points, metrics), flatMaterial(THREE, stroke.color, 0.16));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = elevation;
      mesh.userData[userDataKey] = stroke.id;
      group.add(mesh);
    }
    if (stroke.label && stroke.points[0]) {
      const at = stroke.points.length >= 3 ? centroidOf(stroke.points) : stroke.points[0];
      const label = buildGroundLabel(THREE, stroke.label, at, metrics, { widthM: 4.2, y: ELEVATION.label, color: '#f4f1fb' });
      if (label) {
        label.userData[userDataKey] = stroke.id;
        group.add(label);
      }
    } else if (stroke.points.length === 1 && stroke.points[0]) {
      const [x, y] = shapePoint(stroke.points[0], metrics);
      const geometry = new THREE.CircleGeometry(MARKER_RADIUS * 0.28, 16);
      geometry.translate(x, y, 0);
      const mesh = new THREE.Mesh(geometry, flatMaterial(THREE, stroke.color, 0.95));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = elevation;
      mesh.userData[userDataKey] = stroke.id;
      group.add(mesh);
    }
  };

  for (const measure of shapes.measurements) addStroke(measure, ELEVATION.measure, 'planMeasureId');
  for (const annotation of shapes.annotations) addStroke(annotation, ELEVATION.annotate, 'planAnnotationId');


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
  const boundary = borderLine(THREE, shapes.boundary, metrics, '#7fb3ff', 0.85, ELEVATION.boundary, lineMaterials, 2.5);
  if (boundary) group.add(boundary);

  scene.add(group);
  return true;
}