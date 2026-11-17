import * as THREE from 'three';
import {
  routeCarrier,
  type PlanRoute,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';

/**
 * 场地车辆巡游层（2026-11-16）。
 *
 * 存在理由：3D 里餐车、观光车这类「本来就是车」的设施，摆在平面上只是又一个方盒子，
 * 和帐篷舞台没区别；用户看不出「车行流线是给谁走的」。这一层把车类设施从静态模型层
 * 里接管过来（`movesFacility` = 交给本层），让它们沿车行/人车一起的流线跑起来。
 *
 * 三条纪律：
 * 1. **不虚构**：只有场地里真有车行流线（carrier = vehicle / mixed）、且设施确实是车
 *    才动；缺任一条就退回静态摆放，绝不凭空造车、造路。
 * 2. **不改数据**：只在渲染层动，plan 里的坐标仍是用户摆的那一处；存档、导出、2D 都不受影响。
 * 3. **可降级**：数量上限 8 台，超出的留作静态；没有 WebGL 的测试环境里创建即空跑。
 */

/** 车类设施的名字/模板特征。宁可漏判（留静态）也不误判（把帐篷开上路）。
 *  模板 slug 是英文（oneplan:icon:food-truck / tour-bus），所以中文词之外还要认这几个词根；
 *  用边界匹配而不是子串，避免 carpet / cartoon 之类被当成车。 */
const VEHICLE_PATTERN = /餐车|咖啡车|观光车|摆渡车|接驳车|巴士|货车|卡车|房车|游园车|小火车/;
const VEHICLE_SLUG_PATTERN = /(^|[^a-z])(bus|van|truck|coach|cart|food-truck|tour-bus)([^a-z]|$)/;

/** 本层最多接管多少台车：再多就只是噪声，也不值得每帧算。 */
const MAX_VEHICLES = 8;

/** 车辆地面速度（m/s）：场地里 8 km/h 上下，看得出在动又不至于穿模。 */
const VEHICLE_SPEED = 2.2;

export interface PlanTrafficLayer {
  /** 挂在场景根上的组；`sync` 负责把它对到场地中心。 */
  readonly group: THREE.Group;
  /** 重新按 plan 摆位、重建车辆。多次调用幂等。 */
  sync(plan: SitePlanData): void;
  /** 这台设施是否由本层驱动（调用方据此跳过静态模型/占地贴纸）。 */
  movesFacility(id: string): boolean;
  /** 每帧推进（秒）。 */
  advance(deltaSeconds: number): void;
  dispose(): void;
}

export interface RoutePath {
  points: THREE.Vector3[];
  segmentLengths: number[];
  total: number;
}

interface Vehicle {
  id: string;
  root: THREE.Group;
  path: RoutePath;
  /** 已走过的路程（米），按 speed*dt 累加后对 total 取模。 */
  travelled: number;
  speed: number;
}

/** 边界包围盒中心：与 buildPlanFootprint 的 siteFrame 同一口径（顶点平均 ± 极值中点）。 */
export function planFrameOf(points: readonly { x: number; y: number }[]): {
  cx: number;
  cy: number;
  width: number;
  depth: number;
} | null {
  if (points.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    depth: maxY - minY,
  };
}

/** 可用于行车的流线：载体是车行或人车一起，且至少两个顶点。 */
export function drivableRoutes(routes: readonly PlanRoute[]): PlanRoute[] {
  return routes.filter(route => {
    const carrier = routeCarrier(route);
    return (carrier === 'vehicle' || carrier === 'mixed') && route.points.length >= 2;
  });
}

/** 这处设施是不是车（名字或模板里带车类词）。 */
export function isVehicleFacility(facility: {
  name: string;
  templateId?: string | undefined;
}): boolean {
  return (
    VEHICLE_PATTERN.test(facility.name) ||
    VEHICLE_SLUG_PATTERN.test(facility.name.toLowerCase()) ||
    VEHICLE_SLUG_PATTERN.test((facility.templateId ?? '').toLowerCase())
  );
}

/** 把一条流线折算成「本层坐标系」的折线：x = plan.x - cx，z = -(plan.y - cy)。 */
export function routePathOf(
  route: Pick<PlanRoute, 'points'>,
  frame: { cx: number; cy: number },
): RoutePath | null {
  const points: THREE.Vector3[] = [];
  for (const point of route.points) {
    // 相邻重复顶点在 schema 里已被拒绝，这里再兜一次：零长段会让切线算出 NaN。
    const last = points[points.length - 1];
    const x = point.x - frame.cx;
    const z = -(point.y - frame.cy);
    if (last && Math.abs(last.x - x) < 1e-6 && Math.abs(last.z - z) < 1e-6) continue;
    points.push(new THREE.Vector3(x, 0, z));
  }
  if (points.length < 2) return null;
  const segmentLengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = points[i]!.distanceTo(points[i - 1]!);
    segmentLengths.push(length);
    total += length;
  }
  if (total < 1e-3) return null;
  return { points, segmentLengths, total };
}

/** 折线上按路程取位置与朝向（朝向是归一化的前进方向）。 */
export function sampleRoute(path: RoutePath, travelled: number): {
  position: THREE.Vector3;
  heading: THREE.Vector3;
} {
  let remaining = ((travelled % path.total) + path.total) % path.total;
  for (let i = 0; i < path.segmentLengths.length; i += 1) {
    const length = path.segmentLengths[i]!;
    if (remaining <= length || i === path.segmentLengths.length - 1) {
      const from = path.points[i]!;
      const to = path.points[i + 1]!;
      const t = length > 1e-6 ? Math.min(1, remaining / length) : 0;
      const position = new THREE.Vector3().lerpVectors(from, to, t);
      const heading = new THREE.Vector3().subVectors(to, from);
      if (heading.lengthSq() < 1e-8) heading.set(0, 0, 1);
      return { position, heading: heading.normalize() };
    }
    remaining -= length;
  }
  return {
    position: path.points[0]!.clone(),
    heading: new THREE.Vector3(0, 0, 1),
  };
}

/** 一台低模车：车身 + 车顶，长度按 4.2 m、宽 1.9 m 起（餐车/摆渡车量级）。 */
function buildVehicleMesh(facility: {
  size?: { width: number; depth: number } | undefined;
  color?: string | undefined;
}): THREE.Group {
  const body = new THREE.Group();
  const length = Math.max(2.6, Math.min(6, Math.max(facility.size?.width ?? 0, facility.size?.depth ?? 0) || 4.2));
  const width = 1.9;
  const height = 1.6;
  const paint = new THREE.Color(facility.color ?? '#8a97a6');
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.55, metalness: 0.1 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: '#2b3947', roughness: 0.25, metalness: 0.2 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.62, length), bodyMaterial);
  chassis.position.y = height * 0.31 + 0.28;
  body.add(chassis);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.94, height * 0.34, length * 0.52), glassMaterial);
  cabin.position.set(0, height * 0.62 + 0.28 + height * 0.17, -length * 0.04);
  body.add(cabin);

  const wheelGeometry = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 12);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.9 });
  for (const x of [-width / 2 + 0.06, width / 2 - 0.06]) {
    for (const z of [-length * 0.3, length * 0.3]) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.28, z);
      body.add(wheel);
    }
  }
  body.name = 'plan-traffic-vehicle';
  return body;
}

function disposeVehicle(root: THREE.Object3D): void {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(entry => entry.dispose());
    else if (material) material.dispose();
  });
}

export function createPlanTrafficLayer(baseY: number): PlanTrafficLayer {
  const group = new THREE.Group();
  group.name = 'plan-traffic';

  let vehicles: Vehicle[] = [];
  let disposed = false;

  const clear = () => {
    for (const vehicle of vehicles) {
      group.remove(vehicle.root);
      disposeVehicle(vehicle.root);
    }
    vehicles = [];
  };

  const sync = (plan: SitePlanData) => {
    if (disposed) return;
    clear();
    const boundary = Array.isArray(plan.boundary) ? plan.boundary : [];
    const frame = planFrameOf(boundary);
    if (!frame) {
      group.position.set(0, baseY, 0);
      return;
    }
    group.position.set(frame.cx, baseY, -frame.cy);

    const routes = drivableRoutes(Array.isArray(plan.routes) ? plan.routes : []);
    if (routes.length === 0) return;
    const candidates = Array.isArray(plan.facilities)
      ? plan.facilities.filter(facility => isVehicleFacility(facility))
      : [];
    if (candidates.length === 0) return;

    // 按 id 排序只为确定性：同样的 plan 每次得到同一批车、同一个起点，便于截图对比。
    const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_VEHICLES);
    ordered.forEach((facility, index) => {
      // 多台车摊到不同流线；流线比车多时也不空转，按顺序回绕。
      const route = routes[index % routes.length]!;
      const path = routePathOf(route, frame);
      if (!path) return;
      const root = buildVehicleMesh(facility);
      // 起点错开，避免多台车叠在一起像一辆。
      const travelled = (path.total * index * 0.17) % path.total;
      const sample = sampleRoute(path, travelled);
      root.position.copy(sample.position);
      root.rotation.y = Math.atan2(sample.heading.x, sample.heading.z);
      root.name = `plan-traffic-${facility.id}`;
      root.userData.planPropId = facility.id;
      group.add(root);
      vehicles.push({
        id: facility.id,
        root,
        path,
        travelled,
        // 万一有超长流线（绕场一圈几百米），速度略提，免得一台车几分钟才走完。
        speed: VEHICLE_SPEED + Math.min(1.4, path.total / 400),
      });
    });
  };

  const movesFacility = (id: string) => vehicles.some(vehicle => vehicle.id === id);

  const advance = (deltaSeconds: number) => {
    if (disposed || vehicles.length === 0) return;
    // 切标签页回来时 delta 可能是几十秒：卡住上限，避免车瞬移半圈。
    const step = Math.max(0, Math.min(0.25, deltaSeconds));
    if (step === 0) return;
    for (const vehicle of vehicles) {
      vehicle.travelled += vehicle.speed * step;
      const sample = sampleRoute(vehicle.path, vehicle.travelled);
      vehicle.root.position.copy(sample.position);
      vehicle.root.rotation.y = Math.atan2(sample.heading.x, sample.heading.z);
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clear();
    group.removeFromParent();
  };

  return { group, sync, movesFacility, advance, dispose };
}
