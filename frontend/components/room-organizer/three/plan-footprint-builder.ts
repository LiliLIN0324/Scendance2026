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
  // 设计范围的压暗面：压在瓦片顶（z19 = 0.048 m）之上、场地线（0.05）之下。
  // 顺序不能反：洞里的场地线得能看见，而蒙版只该盖框外。
  scopeMask: 0.049,
  boundary: 0.05,
  // 白线底下的淡墨圈：比白线低 1.5 mm，先描一层宽一点的软底色，白线才在亮底图上立得住。
  scopeHalo: 0.0505,
  // 范围框压在场地线之上：它是「取景框」，读图优先级最高。
  scope: 0.052,
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

/**
 * 设计范围的「框外压暗」：一整块大面减去范围多边形（Shape + hole），
 * 和 2D 画布 `drawDesignScopeMask` 的 evenodd 挖洞同一个意思。
 *
 * 为什么不用多个四边形拼：拼出来的接缝在地面斜看时会露出亮缝，
 * 而 ShapeGeometry 一次三角化，边界与范围框严格共线。
 */
function scopeMaskGeometry(
  THREE: typeof import('three'),
  scope: readonly ShellPoint[],
  metrics: { width: number; depth: number },
): import('three').ShapeGeometry {
  // 2026-11-15：白纱比原来的深色幕明显得多，范围太小就会在远处看出一条直角边。
  // 3D 能拉到 span × 8 的距离，这里按壳体 60 倍铺（20 m 场地 ≈ 1.2 km），
  // 镜头拉到最远时白纱依旧盖满可见地面，不会出现「一块白色地毯」的边界。
  const reach = Math.max(metrics.width, metrics.depth) * 60;
  const shape = new THREE.Shape();
  shape.moveTo(-reach, -reach);
  shape.lineTo(reach, -reach);
  shape.lineTo(reach, reach);
  shape.lineTo(-reach, reach);
  shape.closePath();

  const points = scope.map(point => shapePoint(point, metrics));
  // 洞的绕向要与外框相反，否则三角化会把它当外轮廓、把整块地挖空。
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  const ring = area > 0 ? [...points].reverse() : points;

  const hole = new THREE.Path();
  ring.forEach(([x, y], index) => {
    if (index === 0) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  });
  hole.closePath();
  shape.holes.push(hole);
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
    // rotationDeg 为 ENU 逆时针为正；壳体 z = −y，three R_y(φ) 直接取 φ = rotationDeg。
    object.rotation.y = (prop.rotationDeg * Math.PI) / 180;
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

  // 地面文字：只在区块中心写分区名（舞台 / 排队区这类区域语义）。
  // 2026-11-16 用户：「3D 上面的物品写字不要，名字根本不重要，点开属性看就够了」——
  // 设施/物件的名字不再画到 3D 地面（原逻辑写在占位南侧），名字只在点选后的属性卡里出现。
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

  // 2026-11-15 设计范围（2D 里的「大陆框」）：先白纱蒙版框外，再描白色框线。
  // 之前 3D 根本没有这个层，所以 2D 圈好的范围切到 3D 就看不见——这才是「视觉没同步」的根因。
  // 2026-11-15 视觉定稿（用户「把 3D 的设计范围也统一成白色」）：
  // 框外从深色压暗改成白纱（与 2D 的 rgba(255,255,255,0.52) 同一档），
  // 框线从琥珀改成白线 + 一层淡墨底线——3D 没法做模糊，白色靠这圈投影立起来，
  // 这样斜看时线在亮底图上不会糊掉，观感与 2D 的白角标一致。
  if (shapes.scope.length >= 3) {
    const mask = new THREE.Mesh(
      scopeMaskGeometry(THREE, shapes.scope, metrics),
      flatMaterial(THREE, '#ffffff', 0.45),
    );
    mask.rotation.x = -Math.PI / 2;
    mask.position.y = ELEVATION.scopeMask;
    mask.renderOrder = 6;
    mask.userData.planDesignScope = true;
    mask.userData.planDesignScopeMask = true;
    group.add(mask);

    // 与 2D 画布同一个「四个 L 角标」：整圈框线太吵，2D 定稿就只留四角（用户「3D 和 2D 一模一样」）。
    // 臂长按短边 18% 取（与 2D 的 arm = min(34, minSide×0.18) 同一比例），米制下夹在 1.5～12 m。
    const scopeBounds = boundsOf(shapes.scope);
    const shortSide = Math.min(scopeBounds.maxX - scopeBounds.minX, scopeBounds.maxZ - scopeBounds.minZ);
    const arm = Math.max(1.5, Math.min(12, shortSide * 0.18));
    const corners: Array<{ cx: number; cz: number; sx: number; sz: number }> = [
      { cx: scopeBounds.minX, cz: scopeBounds.minZ, sx: 1, sz: 1 },
      { cx: scopeBounds.maxX, cz: scopeBounds.minZ, sx: -1, sz: 1 },
      { cx: scopeBounds.maxX, cz: scopeBounds.maxZ, sx: -1, sz: -1 },
      { cx: scopeBounds.minX, cz: scopeBounds.maxZ, sx: 1, sz: -1 },
    ];
    for (const corner of corners) {
      // 只画角、不连线：两段臂从角点伸出，和 2D 的 L 同一个形状。
      const elbow = [
        { x: corner.cx + corner.sx * arm, z: corner.cz },
        { x: corner.cx, z: corner.cz },
        { x: corner.cx, z: corner.cz + corner.sz * arm },
      ];
      // 白线下面垫一圈淡墨：3D 没有阴影，靠这圈让白线在白纱/浅色路面上也看得见。
      const halo = fatLine(THREE, elbow, metrics, '#0a0e14', 0.4, ELEVATION.scopeHalo, { lineWidth: 4.4 }, lineMaterials);
      if (halo) {
        halo.userData.planDesignScope = true;
        halo.userData.planDesignScopeHalo = true;
        group.add(halo);
      }
      // 与 2D 画布同一个白色、同一个线宽量级，两个视图才是「同一个框」。
      const bracket = fatLine(THREE, elbow, metrics, '#ffffff', 1, ELEVATION.scope, { lineWidth: 3.2 }, lineMaterials);
      if (bracket) {
        bracket.userData.planDesignScope = true;
        bracket.userData.planDesignScopeRing = true;
        group.add(bracket);
      }
    }

    // 字贴上边中点上方：与 2D 的「设计范围 · 约 N m²」同一个位置逻辑。
    const scopeLabel = buildGroundLabel(
      THREE,
      '设计范围',
      { x: (scopeBounds.minX + scopeBounds.maxX) / 2, z: scopeBounds.minZ - 1.6 },
      metrics,
      { widthM: 5, y: ELEVATION.label, color: '#ffffff' },
    );
    if (scopeLabel) {
      scopeLabel.userData.planDesignScopeLabel = true;
      group.add(scopeLabel);
    }
  }

  // 场地轮廓最后画，压在最高层，方便一眼看出 2D 画的边界在哪。
  if (shapes.boundary.length >= 3) {
    const boundary = borderLine(THREE, shapes.boundary, metrics, '#7fb3ff', 0.85, ELEVATION.boundary, lineMaterials, 2.5);
    if (boundary) group.add(boundary);
  }

  scene.add(group);
  return true;
}