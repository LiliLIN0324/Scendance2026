/**
 * 流线派生人群（2026-11-18 用户：「不是所有用户都有放很多人的意识，能不能给人的流线就直接加人在走」）。
 *
 * 现状：3D 里有没有人，取决于 2D 有没有放「人员点位」（`plan.workers`）。
 * 没人放点位时整场一个人都没有，可流线（`kind: pedestrian`）用户是画了的。
 *
 * 这一层只解决「画面里有人」：按人行流线的长度和宽度沿路布人，**不往 plan 里写任何东西**，
 * 也不进人员统计 / 容量 / 冲突报告——那些必须仍然只认用户自己放的岗位点位。
 *
 * 边界（与用户的约定）：
 * - 只在「没放观众/游客类点位」时启用；放了就以点位为准，派生退场（见 `shouldDeriveCrowd`）。
 * - 只走人行流线：车辆线、以及 carrier 明确为 vehicle/trolley 的线一律不铺人。
 * - 默认「稀」密度，全局人数有预算上限；一条线铺满人最容易被读成「人流密度达标」。
 * - 界面上必须带 `DERIVED_CROWD_NOTE`，说明是示意、不是实测人数。
 *
 * 坐标系：输入是平面 ENU（x 东、y 北），输出给 3D 的是壳体坐标落点 + 场景局部路点，
 * 与 `assignCrowdWalkRoutes` 同一套换算（shell − 场地尺寸/2）。
 */

import { routeCarrier, type PlanNode, type PlanPoint, type PlanRoute, type PlanWorker } from '../../../../supabase/functions/_shared/site-plan';
import { MIN_WAYPOINT_DISTANCE_M, routeLength } from './person-route';
import { crowdGlbUrl, crowdModelSlugForType } from './plan-crowd-placement';
import { walkablePedestrianRoutes } from './plan-crowd-routes';
import { planShellFrame } from './plan-footprint-geometry';
import { walkRoleGlbUrl } from './walk-roles';
import { defaultPersonForType, findPersonById, peopleOfType } from './people-registry';
import type { CrowdTypeId } from './crowd-types';
import type { CrowdShellPlacement, PlanSiteMetrics } from './plan-scene-placement';
import type { Vec2, WalkRoute } from './types';

/** 界面上必须和派生人群一起出现的一句话。 */
export const DERIVED_CROWD_NOTE = '人群按流线示意 · 非实测人数';

/** 密度档位：默认「稀」——宁可少，也不替用户暗示人流充足。 */
export const CROWD_DENSITIES = ['sparse', 'normal', 'dense'] as const;
export type CrowdDensity = (typeof CROWD_DENSITIES)[number];

/** 相邻两人的沿路间距（米）。宽度不足以并行的场地，这个数就是全部密度。 */
const SPACING_M: Readonly<Record<CrowdDensity, number>> = {
  sparse: 3.0,
  normal: 2.4,
  dense: 1.8,
};

/** 全局预算：再大的场地也不铺成集市，一次最多这么多人。 */
export const DERIVED_CROWD_BUDGET = 80;

/**
 * 单条流线上限：与「一个岗位最多 24 人」同量级。
 * 再密的档位也不会把一条通道铺成排队——密度首先由间距决定，这个数只是防极端长线吃光预算。
 */
const MAX_PER_ROUTE = 28;

/** 太短的流线（< 6 m）站两个人就贴脸，不如不铺。 */
const MIN_ROUTE_LENGTH_M = 6;

/** 端点离出入口节点这么近，就按「穿过场地的流」处理（单向续流，不原地折返）。 */
const NODE_SNAP_M = 3;

/** 车道偏移上限：贴着中心线走成一串假，偏太多又会走出路面。 */
const MAX_LANE_OFFSET_M = 1.2;
const MIN_LANE_OFFSET_M = 0.35;

export interface DerivedCrowdWalker {
  /** 派生实例 id（`route:<routeId>#<n>`），与真实点位 id 不可能撞。 */
  id: string;
  routeId: string;
  /** 沿路起点里程（米），确保同一条线的人不叠在一点。 */
  startDistance: number;
  /** 场景局部坐标里的巡游路线（与 WalkActor 同口径）。 */
  walk: WalkRoute;
  placement: CrowdShellPlacement;
}

export interface DerivedCrowdResult {
  walkers: DerivedCrowdWalker[];
  density: CrowdDensity;
  note: string;
}

/**
 * 把派生路人并进「点位人群 + 点位路线」这两份现成结构里，3D 只认这两个数组。
 *
 * 单独抽出来是为了能在单测里钉住合并语义（id 不撞、路线不丢、现场人数只算派生那份），
 * 而不是靠肉眼在 3D 里数人。
 */
export function mergeDerivedCrowd(input: {
  placements: readonly CrowdShellPlacement[];
  routeMap: ReadonlyMap<string, WalkRoute>;
  derived: DerivedCrowdResult | null;
}): { roster: CrowdShellPlacement[]; routeMap: Map<string, WalkRoute>; derivedCount: number } {
  const routeMap = new Map(input.routeMap);
  if (!input.derived || input.derived.walkers.length === 0) {
    return { roster: [...input.placements], routeMap, derivedCount: 0 };
  }
  const roster = [...input.placements];
  for (const walker of input.derived.walkers) {
    // 派生实例的 id 带 `route:` 前缀，与真实点位 id 不可能撞；这里再兜一层，撞了就跳过而不是覆盖。
    if (roster.some(placement => placement.id === walker.placement.id)) continue;
    roster.push(walker.placement);
    routeMap.set(walker.placement.id, walker.walk);
  }
  return { roster, routeMap, derivedCount: roster.length - input.placements.length };
}

/**
 * 派生人群的角色构成：以游客为主体（汉/唐/宋/明古装漫游角色都有独立模型与头像），
 * 再掺少量现场引导（志愿者）与安保（保安）——整条线上几十个人长得一模一样，
 * 一眼就能看出是程序摆的，反而不可信。
 *
 * 写成展开序列取模分配：同一个下标永远是同一个角色，刷新、重建人群都不会换人。
 * 12 人一轮 = 10 游客 + 1 志愿者 + 1 保安（游客约 83%）。
 */
const DERIVED_ROLE_POOL: readonly string[] = [
  'visitor:tang-female', 'visitor:song-female', 'visitor:tang-male',
  'visitor:ming-female', 'visitor:song-male', 'visitor:ming-male',
  'visitor:tang-female', 'visitor:song-female', 'volunteer',
  'visitor:ming-male', 'visitor:tang-male', 'security',
];

const DERIVED_ROLE_COLOR: Readonly<Record<string, string>> = {
  volunteer: '#d25555',
  security: '#3f5a80',
};
const DERIVED_VISITOR_COLOR = '#c8a06a';

interface DerivedRoleProfile {
  /** 登记表槽位 id：岗位类角色按序号在男女之间轮换，所以 id 也在这里定。 */
  slotId: string;
  name: string;
  crowdType: CrowdTypeId;
  color: string;
}

/** 岗位类（志愿者 / 保安）在男女两槽之间按序号轮换，固定序号永远同一个性别。 */
function staffSlotAt(crowdType: CrowdTypeId, index: number) {
  const list = peopleOfType(crowdType).filter(slot => slot.walkable);
  if (list.length === 0) return null;
  return list[index % list.length] ?? null;
}

/** 第 index 个派生路人是谁：角色、人群类型、标签色都由这一处决定。 */
export function derivedRoleAt(index: number): DerivedRoleProfile {
  const pool = DERIVED_ROLE_POOL;
  const key = pool[((index % pool.length) + pool.length) % pool.length]!;
  const slot = key.includes(':') ? findPersonById(key) : staffSlotAt(key as CrowdTypeId, index);
  if (!slot) throw new Error(`派生人群缺少登记槽位：${key}`);
  return {
    slotId: slot.id,
    name: slot.name,
    crowdType: slot.crowdType,
    color: DERIVED_ROLE_COLOR[slot.crowdType] ?? DERIVED_VISITOR_COLOR,
  };
}

export interface DeriveCrowdInput {
  routes: readonly PlanRoute[];
  nodes?: readonly PlanNode[];
  boundary: readonly PlanPoint[];
  metrics: PlanSiteMetrics;
  density?: CrowdDensity;
  budget?: number;
}

/**
 * 已经放过观众/游客类点位就不再派生：两份人同时在场，用户说不清哪个人数是他自己的。
 */
export function shouldDeriveCrowd(workers: readonly Pick<PlanWorker, 'role'>[]): boolean {
  if (workers.length === 0) return true;
  return !workers.some((worker) => {
    const role = (worker.role ?? '').trim();
    // 与 plan-crowd-placement 的 ROLE_TO_CROWD 同一批关键词，只取「会走动的人」。
    return role.includes('观众') || role.includes('游客') || role.includes('参观') || role.includes('演员');
  });
}

function toLocalPoint(point: PlanPoint, frame: ReturnType<typeof planShellFrame>, metrics: PlanSiteMetrics): Vec2 {
  if (!frame) return { x: point.x, z: -point.y };
  const shell = frame.toShell(point);
  return { x: shell.x - metrics.width / 2, z: shell.z - metrics.depth / 2 };
}

/** 去重相邻过近的点：一次手抖双击不该在路线上留一个零长段。 */
function simplify(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) >= MIN_WAYPOINT_DISTANCE_M) out.push(point);
  }
  return out;
}

/**
 * 沿行进方向的右侧平移整条折线（右手法向 = (dz, -dx)）。
 * 反向走的那份直接反转点序即可——法向跟着反转，右侧通行自动成立。
 */
function laneOffset(points: readonly Vec2[], lateral: number): Vec2[] {
  if (!lateral) return [...points];
  return points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: point.x + (dz / length) * lateral, z: point.z - (dx / length) * lateral };
  });
}

function nearNode(point: Vec2, nodes: readonly Vec2[]): boolean {
  return nodes.some((node) => Math.hypot(node.x - point.x, node.z - point.z) <= NODE_SNAP_M);
}

function placementFor(input: {
  id: string;
  routeId: string;
  midLocal: Vec2;
  metrics: PlanSiteMetrics;
  index: number;
  role: DerivedRoleProfile;
}): CrowdShellPlacement {
  const { role } = input;
  // 角色池里存的是登记表槽位 id；查不到才回退到该类型的默认模型。
  const person = findPersonById(role.slotId);
  const assetId = person?.assetId ?? defaultPersonForType(role.crowdType)?.assetId ?? null;
  const slug = assetId ? null : crowdModelSlugForType(role.crowdType, input.index);
  return {
    id: input.id,
    workerId: `derived:${input.routeId}`,
    role: role.name,
    crowdType: role.crowdType,
    assetId,
    slug,
    glbUrl: assetId ? walkRoleGlbUrl(assetId) : slug ? crowdGlbUrl(slug) : null,
    // at 只是兜底落点（有人群路线时 3D 不会用它）；ENU 与场景局部同一套近似互逆。
    at: { x: input.midLocal.x, y: -input.midLocal.z },
    offset: { x: 0, y: 0 },
    color: role.color,
    shell: { x: input.midLocal.x + input.metrics.width / 2, z: input.midLocal.z + input.metrics.depth / 2 },
  };
}

/**
 * 按人行流线派生人群。没有可用流线、或尺度退化时返回空数组（调用方照常渲染真实点位）。
 */
export function deriveCrowdFromRoutes(input: DeriveCrowdInput): DerivedCrowdResult {
  const density = input.density ?? 'sparse';
  const spacing = SPACING_M[density];
  const budget = Math.max(0, Math.floor(input.budget ?? DERIVED_CROWD_BUDGET));
  const metrics = input.metrics;
  if (budget === 0) return { walkers: [], density, note: DERIVED_CROWD_NOTE };
  if (!Number.isFinite(metrics.width) || !Number.isFinite(metrics.depth)) {
    return { walkers: [], density, note: DERIVED_CROWD_NOTE };
  }

  const frame = planShellFrame(input.boundary, metrics, { clampPoints: false });
  const nodePoints = (input.nodes ?? []).map((node) => toLocalPoint(node.position, frame, metrics));

  const candidates = walkablePedestrianRoutes(input.routes).flatMap((route) => {
    // 载体兜底：kind 说是人行、carrier 却写着推车/车行的，不铺人（与画布同一个 routeCarrier 口径）。
    const carrier = routeCarrier(route);
    if (carrier !== 'walk' && carrier !== 'mixed') return [];
    const points = simplify(route.points.map((point) => toLocalPoint(point, frame, metrics)));
    if (points.length < 2) return [];
    const length = routeLength(points, false);
    if (!(length >= MIN_ROUTE_LENGTH_M)) return [];
    const width = Number.isFinite(route.widthM) ? Math.max(0.8, route.widthM as number) : 2;
    const lane = Math.min(MAX_LANE_OFFSET_M, Math.max(MIN_LANE_OFFSET_M, width / 2 - 0.5));
    const through = route.oneWay === true
      || nearNode(points[0]!, nodePoints)
      || nearNode(points[points.length - 1]!, nodePoints);
    const wanted = Math.min(MAX_PER_ROUTE, Math.max(1, Math.floor(length / spacing)));
    return [{ route, points, length, lane, through, count: wanted }];
  });

  if (candidates.length === 0) return { walkers: [], density, note: DERIVED_CROWD_NOTE };

  // 预算分配：长线优先，因为长线最能说明「人怎么走」；预算不够时短线宁可不铺，也不挤成一堆。
  const order = [...candidates].sort((a, b) => b.length - a.length);
  let remaining = budget;
  for (const item of order) {
    if (remaining <= 0) {
      item.count = 0;
      continue;
    }
    item.count = Math.min(item.count, remaining);
    remaining -= item.count;
  }

  const walkers: DerivedCrowdWalker[] = [];
  for (const item of candidates) {
    if (item.count <= 0) continue;
    for (let index = 0; index < item.count; index += 1) {
      // 双向流线：一半走正向、一半反向，各自靠右，看起来才是迎面而过而不是跟队。
      const reverse = !item.through && index % 2 === 1;
      const base = reverse ? [...item.points].reverse() : item.points;
      const points = laneOffset(base, item.lane);
      const length = routeLength(points, false);
      const id = `route:${item.route.id}#${index}`;
      walkers.push({
        id,
        routeId: item.route.id,
        startDistance: item.count === 1 ? 0 : (index + 0.5) * (length / item.count),
        walk: {
          points,
          loop: false,
          pauseMs: 0,
          ...(item.through ? { oneWay: true } : {}),
        },
        placement: placementFor({
          id,
          routeId: item.route.id,
          midLocal: points[0]!,
          metrics,
          index: walkers.length,
          role: derivedRoleAt(walkers.length),
        }),
      });
    }
  }

  return { walkers, density, note: DERIVED_CROWD_NOTE };
}
