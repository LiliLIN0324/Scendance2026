import * as THREE from 'three';
import { PLANNING_ROUTE_KIND_COLORS } from '../../../lib/outdoor-plan-tokens';
import {
  MAX_VEHICLE_INSTANCES,
  vehicleCarrierFor,
  vehicleEntitySlots,
  vehicleLabelOf,
  vehicleModelSlugOf,
} from '../lib/vehicle-entities';
import {
  polylineTangentRad,
  vehicleFollowerProfileFor,
  vehiclePreviewSpeed,
  type VehicleFollowerProfile,
} from '../lib/vehicle-follower-profile';
import {
  createCachedGlbModel,
  disposeOwnedModel,
  ensureGlbAsset,
} from './glb-assets';
import { planFrameOf, routePathOf, sampleRoute, type RoutePath } from './plan-traffic-layer';
import { loadFacilityModelOverride, type FacilityModelCandidate } from '../lib/plan-facility-models';
import type { FurnitureItem } from '../lib/types';
import type {
  PlanRoute,
  PlanVehicle,
  SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';

/**
 * 车辆 / 后勤实体 3D 层（2026-11-16，任务 #117）。
 *
 * 旧 `plan-traffic-layer` 接管的是 facilities 里「名字像车」的设施（餐车 / 摆渡车…），
 * 靠名字正则匹配；本层接管独立集合 `plan.vehicles`（契约见 site-plan.ts 的
 * `planVehicleSchema`），与 2D `vehicle-markers` 同源口径：
 *
 * - 车型未登记 → 跳过，不猜成别的车（`vehicleCarrierFor` 返回 null）；
 * - 实例槽位由 `vehicleEntitySlots` 展开（每实体上限 `MAX_VEHICLE_INSTANCES`）；
 * - 占位长宽 / 转向档 / 速度档来自 `vehicleFollowerProfileFor`，速度单一来源 flow-sim；
 * - 挂得上动线（`routeIds` 能在 `plan.routes` 找到）→ 沿弧长巡游；缺线 = 停放 / 待命点，
 *   静态摆在落点槽位，不挂动态对象；
 * - `modelSlug` 只认实体自己写的，缺省记 `modelMissing`（库内无 GLB，留占位盒，不借近似车型）。
 *
 * 三条纪律与旧车流层一致：不虚构（没车没路不造）、不改数据（只在渲染层动）、
 * 可降级（没有 WebGL 的测试环境创建即空跑）。
 */

/** 占位车高（米）：预览量级，不是车型实测高度。 */
const PLACEHOLDER_HEIGHT_M = 1.5;

interface VehicleInstance {
  readonly vehicleId: string;
  readonly slotIndex: number;
  readonly root: THREE.Group;
  readonly path: RoutePath | null;
  /** 已走过的路程（米）；仅巡游实例使用。 */
  travelled: number;
  readonly speed: number;
  readonly moving: boolean;
  readonly profile: VehicleFollowerProfile;
  readonly modelMissing: boolean;
}

export interface PlanVehicleEntitiesLayer {
  /** 挂在场景根上的组；`sync` 负责把它对到场地中心。 */
  readonly group: THREE.Group;
  /** 重新按 plan 摆位、重建实例。多次调用幂等。 */
  sync(plan: SitePlanData): void;
  /** 每帧推进（秒）。 */
  advance(deltaSeconds: number): void;
  dispose(): void;
}

/**
 * plan 数学角（0 = +x 东，π/2 = +y 北）→ three 绕 Y 角。
 *
 * 本层组内 z = -(plan.y - cy)：北 (+y) 对应 -z。车头平面方向 (cosθ, sinθ) 折算到组内
 * (cosθ, 0, -sinθ)，故 `rotation.y = atan2(x, z) = atan2(cosθ, -sinθ)`。
 * 巡游实例直接用路线切线（已是组内向量），不走这个换算。
 */
export function planHeadingToThreeY(thetaRad: number): number {
  if (!Number.isFinite(thetaRad)) return 0;
  return Math.atan2(Math.cos(thetaRad), -Math.sin(thetaRad));
}

/** 一台占位车：底盘 + 玻璃舱 + 四轮，尺寸取 profile 占位长 / 宽。 */
function buildEntityVehicleMesh(profile: VehicleFollowerProfile, color: string): THREE.Group {
  const body = new THREE.Group();
  const length = profile.bodyLengthM;
  const width = profile.bodyWidthM;
  const height = PLACEHOLDER_HEIGHT_M;
  const paint = new THREE.Color(color);
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
  body.name = 'plan-vehicle-entity';
  return body;
}

function disposeInstance(root: THREE.Object3D): void {
  // 异步换上的 GLB 由缓存克隆而来，几何/材质不能按占位盒的方式直接 dispose；
  // 先收集模型 holder，跳过其子树，再交给 disposeOwnedModel 统一收口。
  const modelRoots = new Set<THREE.Object3D>();
  root.traverse(object => { if (object.userData.vehicleModel === true) modelRoots.add(object); });
  root.traverse(object => {
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (modelRoots.has(parent)) return;
    }
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(entry => entry.dispose());
    else if (material) material.dispose();
  });
  for (const modelRoot of modelRoots) disposeOwnedModel(modelRoot);
}

export function createPlanVehicleEntitiesLayer(baseY: number): PlanVehicleEntitiesLayer {
  const group = new THREE.Group();
  group.name = 'plan-vehicle-entities';

  let instances: VehicleInstance[] = [];
  let disposed = false;
  /** 每次 sync 递增：异步 GLB 回来时用它判断这批实例是否已经被清掉。 */
  let run = 0;
  const candidateCache = new Map<string, Promise<FacilityModelCandidate | null>>();

  const clear = () => {
    run += 1;
    for (const instance of instances) {
      group.remove(instance.root);
      disposeInstance(instance.root);
    }
    instances = [];
  };

  /** 同一 slug 只解析一次候选；多个实例共用，失败也不反复重试。 */
  const candidateFor = (slug: string): Promise<FacilityModelCandidate | null> => {
    let pending = candidateCache.get(slug);
    if (!pending) {
      pending = loadFacilityModelOverride(slug).catch(() => null);
      candidateCache.set(slug, pending);
    }
    return pending;
  };

  /**
   * 占位盒 → 真实车辆 GLB。
   * 失败时不动占位盒（宁可显示“模型未加载”，也不凭空消失或换成别的车型）。
   */
  const attachModel = async (
    root: THREE.Group,
    slug: string,
    profile: VehicleFollowerProfile,
    token: number,
  ): Promise<void> => {
    const candidate = await candidateFor(slug);
    if (!candidate || disposed || token !== run || root.parent !== group) return;
    try {
      await ensureGlbAsset(candidate.glbUrl, candidate.glbUrl);
    } catch {
      return;
    }
    if (disposed || token !== run || root.parent !== group) return;

    const item = {
      id: `vehicle-model-${slug}`,
      type: 'glb-asset',
      name: candidate.name,
      width: candidate.width,
      depth: candidate.depth,
      height: candidate.height,
      color: '#ffffff',
      icon: '◇',
      price: 0,
      category: 'vehicle',
      glbUrl: candidate.glbUrl,
      source: 'public_library',
      materialId: 'asset',
      notes: '',
    } as unknown as FurnitureItem;
    const model = createCachedGlbModel(item, false);
    if (!model) return;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (!(size.x > 0 && size.z > 0)) return;

    const holder = new THREE.Group();
    holder.userData.vehicleModel = true;
    holder.add(model);
    // 把模型水平居中、底面落在 y=0，再按占位长/宽等比缩到车位尺寸。
    model.position.set(-center.x, -box.min.y, -center.z);
    const longest = Math.max(size.x, size.z);
    const shortest = Math.min(size.x, size.z);
    const scale = Math.min(profile.bodyLengthM / longest, profile.bodyWidthM / shortest);
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    holder.scale.setScalar(scale);
    // 模型长边对齐组内 z 轴（与巡游切线朝向同一口径）。
    if (size.x > size.z) holder.rotation.y = Math.PI / 2;

    for (const child of root.children) child.visible = false;
    root.add(holder);
    root.userData.modelLoaded = true;
    root.userData.modelMissing = false;
  };

  const sync = (plan: SitePlanData) => {
    if (disposed) return;
    clear();
    const token = run;

    const boundary = Array.isArray(plan.boundary) ? plan.boundary : [];
    const frame = planFrameOf(boundary);
    if (!frame) {
      group.position.set(0, baseY, 0);
      return;
    }
    group.position.set(frame.cx, baseY, -frame.cy);

    const vehicles: PlanVehicle[] = Array.isArray(plan.vehicles) ? plan.vehicles : [];
    if (vehicles.length === 0) return;
    const routeById = new Map((Array.isArray(plan.routes) ? plan.routes : []).map(route => [route.id, route]));

    // 按 id 排序只为确定性：同样的 plan 每次得到同一批实例、同一个起点，便于截图对比。
    const ordered = [...vehicles].sort((a, b) => a.id.localeCompare(b.id));
    for (const vehicle of ordered) {
      const carrier = vehicleCarrierFor(vehicle.type);
      if (!carrier) continue; // 未登记车型：跳过，不回落成步行或别的车。
      const profile = vehicleFollowerProfileFor(carrier);
      const route: PlanRoute | undefined = (vehicle.routeIds ?? [])
        .map(id => routeById.get(id))
        .find((item): item is PlanRoute => item !== undefined);
      const path = route ? routePathOf(route, frame) : null;
      const modelMissing = vehicleModelSlugOf(vehicle) === null;
      const color = vehicle.color ?? PLANNING_ROUTE_KIND_COLORS.vehicle;
      const slots = vehicleEntitySlots(vehicle, profile.bodyWidthM).slice(0, MAX_VEHICLE_INSTANCES);

      slots.forEach((slot, slotIndex) => {
        const root = buildEntityVehicleMesh(profile, color);
        const moving = path !== null;
        let travelled = 0;

        if (moving && path) {
          // 起点错开，避免多台叠在一起像一辆。
          travelled = (path.total * slotIndex * 0.13) % path.total;
          const sample = sampleRoute(path, travelled);
          root.position.copy(sample.position);
          root.rotation.y = Math.atan2(sample.heading.x, sample.heading.z);
        } else {
          // 静态停放：plan 落点 + 槽位偏移 → 组内坐标（x = px - cx + offsetX，z = -(py - cy) - offsetY）。
          root.position.set(
            vehicle.position.x - frame.cx + slot.offsetX,
            0,
            -(vehicle.position.y - frame.cy) - slot.offsetY,
          );
          // 无路线 = 停放/待命：盒体正放；有路线（即使零长未巡游）取切线朝向。
          root.rotation.y = route
            ? planHeadingToThreeY(polylineTangentRad(route.points, 0))
            : 0;
        }

        root.name = `plan-vehicle-entity-${vehicle.id}`;
        root.userData = {
          planPropId: vehicle.id,
          vehicleId: vehicle.id,
          slotIndex,
          carrier: profile.carrier,
          modelMissing,
          label: slotIndex === 0 ? `${vehicleLabelOf(vehicle)} · ${vehicle.count} 台` : null,
        };
        group.add(root);

        // 2026-11-17 P0：有模型 slug 时异步换成真实 GLB；加载失败/超时保留占位盒，不改数据。
        const slug = vehicleModelSlugOf(vehicle);
        if (slug) void attachModel(root, slug, profile, token).catch(() => {});

        // 同一车型台与台的速度略错档，避免车队像机械同步。
        const unit = 0.55 + (slotIndex % 3) * 0.1;
        instances.push({
          vehicleId: vehicle.id,
          slotIndex,
          root,
          path,
          travelled,
          speed: vehiclePreviewSpeed(carrier, unit),
          moving,
          profile,
          modelMissing,
        });
      });
    }
  };

  const advance = (deltaSeconds: number) => {
    if (disposed || instances.length === 0) return;
    // 切标签页回来时 delta 可能是几十秒：卡住上限，避免车瞬移半圈。
    const step = Math.max(0, Math.min(0.25, deltaSeconds));
    if (step === 0) return;
    for (const instance of instances) {
      if (!instance.moving || !instance.path) continue;
      instance.travelled += instance.speed * step;
      const sample = sampleRoute(instance.path, instance.travelled);
      instance.root.position.copy(sample.position);
      instance.root.rotation.y = Math.atan2(sample.heading.x, sample.heading.z);
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clear();
    group.removeFromParent();
  };

  return { group, sync, advance, dispose };
}
