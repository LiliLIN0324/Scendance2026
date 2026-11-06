/**
 * 第 10/11 批「批注→施工」纯函数层：把 zone 矩形标注按语义类型转成家具放置列表。
 *
 * 设计红线：
 * - 纯函数、不可变，不接 React、不读 layoutStore；
 * - 坐标与 FurnitureItem.position 同一套约定：米制、房间中心为原点；
 * - route / measure 标注不参与转家具（它们是动线 / 参考线）；
 * - zoneType 决定家具配方：圆桌区=圆桌餐椅、签到区=签到台+工作椅、
 *   打卡区=背景墙+两侧绿植、休息区=对坐长椅；
 * - 每个配方都返回「为什么摆不下」，让批准回执能说人话。
 */

import type { PlanAnnotation, PlanPoint, ZoneSemanticType } from './plan-annotation';
import { densityToSpec } from './density';
import { getCatalogForZone } from './furniture-catalog';

/** 圆桌直径（米）。 */
export const TABLE_DIAMETER = 1.2;
/** 椅子边长（米）。 */
export const CHAIR_SIZE = 0.45;
/** 桌心到相邻椅心的径向距离（米）。 */
export const CHAIR_RING_RADIUS = 0.9;
/** 单 zone 最多落几桌（MVP 上限）。 */
export const MAX_TABLES_PER_ZONE = 3;
/** 距 zone 边缘的最小留白（米）。 */
export const ZONE_INSET = 0.3;
/** 所有家具 footprint 距四面墙的最小退距（米）。 */
export const WALL_CLEARANCE_M = 0.3;
/** 椅子背向桌子那侧（拉椅出人空间）距墙最小退距（米）。 */
export const CHAIR_BACK_CLEARANCE_M = 0.6;
/** 椅子中心到所属桌心允许的最大距离（米）：桌外接圆 + 椅深 + 容差。 */
export const MAX_CHAIR_OWNER_DIST_M = TABLE_DIAMETER / 2 + CHAIR_SIZE + 0.15;

/** 家具模板（与 onApprove 落库字段一一对应）。 */
export interface FurnitureSpec {
  type: string;
  name: string;
  category: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  icon: string;
}

/** 一件待放家具的描述（世界坐标，未挂 id / 资产）。 */
export interface ZoneFurniturePlacement {
  spec: FurnitureSpec;
  x: number;
  z: number;
  /** 朝向（弧度），椅子用于面对桌子。 */
  rotation: number;
  /** 来源 zone 标注 id，便于出问题时回溯。 */
  zoneId: string;
  zoneType: ZoneSemanticType;
  /**
   * 仅餐椅（secondary）使用：所属主桌的位置 key（`${table.x}|${table.z}`）。
   * 主桌本身（primary）不设置该字段。
   */
  ownerTableId?: string;
}

export interface ZonePlanSkipped {
  zoneId: string;
  label: string;
  reason: string;
}

export interface ZonePlanOutcome {
  placements: ZoneFurniturePlacement[];
  skipped: ZonePlanSkipped[];
}

/**
 * 嵌套 SPEC 视图：从 furniture-catalog 按 (type, zoneType) 取条目，
 * 保持原有 SPEC.roundtable.table / SPEC.checkin.desk 访问形态向后兼容。
 * catalog 是唯一数据源，未来加家具只改 furniture-catalog.ts。
 */
const SPEC = {
  roundtable: {
    table: getCatalogForZone('dining-table', 'roundtable')!,
    chair: getCatalogForZone('dining-chair', 'roundtable')!,
  },
  checkin: {
    desk: getCatalogForZone('table', 'checkin')!,
    chair: getCatalogForZone('dining-chair', 'checkin')!,
  },
  photo: {
    backdrop: getCatalogForZone('backdrop', 'photo')!,
    plant: getCatalogForZone('plant', 'photo')!,
  },
  rest: {
    bench: getCatalogForZone('bench', 'rest')!,
  },
};

/**
 * 把一组 zone 标注 + 密度旋钮转成家具放置列表（只返回 placements）。
 * 保留第 10 批旧签名；想知道「哪些区被跳过、为什么」请用 planZones。
 */
export function planZoneApprovals(
  annotations: readonly PlanAnnotation[],
  density: number,
): ZoneFurniturePlacement[] {
  return planZones(annotations, density).placements;
}

export function planZones(
  annotations: readonly PlanAnnotation[],
  density: number,
): ZonePlanOutcome {
  const spec = densityToSpec(density);
  const pitch = Math.max(TABLE_DIAMETER + 0.3, spec.spacingMeters);
  const placements: ZoneFurniturePlacement[] = [];
  const skipped: ZonePlanSkipped[] = [];

  for (const ann of annotations) {
    if (ann.kind !== 'zone' || ann.geometry.kind !== 'rect') continue;
    const g = ann.geometry;
    // 故意放宽成 string：未来若扩展 zoneType 或外部注入非法值，不要静默按 rest 摆家具，
    // 走下面的「未知类型降级」分支落 skipped。
    const zoneType = (ann.zoneType ?? 'roundtable') as string;
    const push = (p: Omit<ZoneFurniturePlacement, 'zoneId' | 'zoneType'>) =>
      placements.push({ ...p, zoneId: ann.id, zoneType: zoneType as ZoneSemanticType });

    if (g.width <= 0 || g.depth <= 0) {
      skipped.push({ zoneId: ann.id, label: ann.label, reason: '画得太小，基本是个点' });
      continue;
    }

    if (zoneType === 'roundtable') {
      const inset = ZONE_INSET + TABLE_DIAMETER / 2;
      if (g.width - inset * 2 < 0.1 || g.depth - inset * 2 < 0.1) {
        skipped.push({ zoneId: ann.id, label: ann.label, reason: '圆桌区至少要 1.9×1.9m 才摆得下一桌四椅' });
        continue;
      }
      gridRoundtable(g.x, g.z, g.width, g.depth, inset, pitch, push);
    } else if (zoneType === 'checkin') {
      if (g.width < 1.8 || g.depth < 1.4) {
        skipped.push({ zoneId: ann.id, label: ann.label, reason: '签到区至少要 1.8×1.4m（台面+工作人员座椅）' });
        continue;
      }
      rowCheckin(g.x, g.z, g.width, push);
    } else if (zoneType === 'photo') {
      if (g.width < 2.6 || g.depth < 1.4) {
        skipped.push({ zoneId: ann.id, label: ann.label, reason: '打卡区至少要 2.6×1.4m（背景墙+拍照站立空间）' });
        continue;
      }
      spotPhoto(g.x, g.z, g.width, push);
    } else if (zoneType === 'rest') {
      if (g.width < 2.2 || g.depth < 2.0) {
        skipped.push({ zoneId: ann.id, label: ann.label, reason: '休息区至少要 2.2×2.0m 才能两排长椅对坐' });
        continue;
      }
      rowsRest(g.x, g.z, g.width, g.depth, push);
    } else {
      // 未知 zoneType：不摆任何家具，落一条 skipped 让 UI 说人话。
      skipped.push({
        zoneId: ann.id,
        label: ann.label,
        reason: `未知区类型 ${zoneType}，按通用矩形区处理，本版不落家具`,
      });
    }
  }

  return { placements, skipped };
}

function gridRoundtable(
  x0: number,
  z0: number,
  w: number,
  d: number,
  inset: number,
  pitch: number,
  push: (p: Omit<ZoneFurniturePlacement, 'zoneId' | 'zoneType'>) => void,
): void {
  const minX = x0 + inset;
  const maxX = x0 + w - inset;
  const minZ = z0 + inset;
  const maxZ = z0 + d - inset;
  const centerX = x0 + w / 2;
  const centerZ = z0 + d / 2;

  const points: PlanPoint[] = [];
  for (let z = minZ; z <= maxZ + 1e-6; z += pitch) {
    for (let x = minX; x <= maxX + 1e-6; x += pitch) {
      points.push({ x: round2(x), z: round2(z) });
    }
  }
  if (points.length === 0) return;
  points.sort((a, b) => {
    const da = (a.x - centerX) ** 2 + (a.z - centerZ) ** 2;
    const db = (b.x - centerX) ** 2 + (b.z - centerZ) ** 2;
    return da - db;
  });

  // 每张主桌配椅数从 catalog 读（圆桌默认 8）。
  const chairsPerTable = SPEC.roundtable.table.chairsPerTable ?? 4;

  for (const tableAt of points.slice(0, MAX_TABLES_PER_ZONE)) {
    push({ spec: SPEC.roundtable.table, x: tableAt.x, z: tableAt.z, rotation: 0 });
    const tableKey = `${round2(tableAt.x)}|${round2(tableAt.z)}`;
    // 沿环周按角度均分摆椅；rotation 让椅面朝向桌心。
    for (let k = 0; k < chairsPerTable; k++) {
      const theta = (2 * Math.PI * k) / chairsPerTable;
      const cx = tableAt.x + CHAIR_RING_RADIUS * Math.cos(theta);
      const cz = tableAt.z + CHAIR_RING_RADIUS * Math.sin(theta);
      // facing = (-cos θ, -sin θ)；rotation r 满足 (sin r, -cos r) = facing。
      const rotation = Math.atan2(-Math.cos(theta), Math.sin(theta));
      push({
        spec: SPEC.roundtable.chair,
        x: round2(cx),
        z: round2(cz),
        rotation: round2(rotation),
        ownerTableId: tableKey,
      });
    }
  }
}

/** 签到台沿 zone 上边一字排开，工作人员椅在台后（z 正向）。 */
function rowCheckin(
  x0: number,
  z0: number,
  w: number,
  push: (p: Omit<ZoneFurniturePlacement, 'zoneId' | 'zoneType'>) => void,
): void {
  const stationPitch = 1.8;
  const maxStations = 4;
  const inset = ZONE_INSET;
  const usable = w - inset * 2;
  const count = Math.min(maxStations, Math.max(1, Math.floor(usable / stationPitch)));
  const rowZ = z0 + inset + SPEC.checkin.desk.depth / 2;
  for (let i = 0; i < count; i++) {
    const x = count === 1
      ? x0 + w / 2
      : x0 + inset + (usable * i) / (count - 1);
    push({ spec: SPEC.checkin.desk, x: round2(x), z: round2(rowZ), rotation: 0 });
    push({
      spec: SPEC.checkin.chair,
      x: round2(x),
      z: round2(rowZ + SPEC.checkin.desk.depth / 2 + 0.45),
      rotation: Math.PI,
    });
  }
}

/** 打卡区：背景墙靠 zone 后缘居中，两侧 1.5m 各一盆绿植，前方留空给人站。 */
function spotPhoto(
  x0: number,
  z0: number,
  w: number,
  push: (p: Omit<ZoneFurniturePlacement, 'zoneId' | 'zoneType'>) => void,
): void {
  const cx = x0 + w / 2;
  const wallZ = z0 + ZONE_INSET + SPEC.photo.backdrop.depth / 2;
  push({ spec: SPEC.photo.backdrop, x: round2(cx), z: round2(wallZ), rotation: 0 });
  for (const side of [-1, 1]) {
    push({ spec: SPEC.photo.plant, x: round2(cx + side * 1.5), z: round2(wallZ), rotation: 0 });
  }
}

/** 休息区：两排长椅对坐，中间留 1.5m 通道。 */
function rowsRest(
  x0: number,
  z0: number,
  w: number,
  d: number,
  push: (p: Omit<ZoneFurniturePlacement, 'zoneId' | 'zoneType'>) => void,
): void {
  const benchPitch = 2.2;
  const maxBenchesPerRow = 3;
  const aisle = 1.5;
  const inset = ZONE_INSET;
  const usable = w - inset * 2;
  const count = Math.min(maxBenchesPerRow, Math.max(1, Math.floor(usable / benchPitch)));
  const rowZ1 = z0 + d / 2 - aisle / 2;
  const rowZ2 = z0 + d / 2 + aisle / 2;
  for (let i = 0; i < count; i++) {
    const x = count === 1
      ? x0 + w / 2
      : x0 + inset + (usable * i) / (count - 1);
    push({ spec: SPEC.rest.bench, x: round2(x), z: round2(rowZ1), rotation: 0 });
    push({ spec: SPEC.rest.bench, x: round2(x), z: round2(rowZ2), rotation: Math.PI });
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/* ---------- 墙退距（4.0.1 新增） ---------- */

/** 场地尺寸（米制、房间中心为原点；width=x 全宽、height=z 全深）。与 plan-scoring.RoomSize 结构同形。 */
export interface PlanRoomSize {
  width: number;
  height: number;
}

export interface WallClearanceOutcome {
  placements: ZoneFurniturePlacement[];
  skipped: ZonePlanSkipped[];
}

/** 家具 footprint AABB 相交容差（米）：与 plan-scoring.BBOX_OVERLAP_TOLERANCE_M 同值。 */
const WALL_OVERLAP_TOLERANCE_M = 0.02;

function aabbOverlap(
  ax: number, az: number, ahw: number, ahd: number,
  bx: number, bz: number, bhw: number, bhd: number,
): boolean {
  const t = WALL_OVERLAP_TOLERANCE_M;
  const eps = 1e-6;
  const ax1 = ax - ahw - t;
  const ax2 = ax + ahw + t;
  const az1 = az - ahd - t;
  const az2 = az + ahd + t;
  const bx1 = bx - bhw - t;
  const bx2 = bx + bhw + t;
  const bz1 = bz - bhd - t;
  const bz2 = bz + bhd + t;
  return ax1 < bx2 - eps && bx1 < ax2 - eps && az1 < bz2 - eps && bz1 < az2 - eps;
}

/**
 * 墙退距后处理：每件家具 footprint 距四面墙至少 WALL_CLEARANCE_M（0.3m）；
 * 餐椅背向桌子那侧（拉椅出人）至少 CHAIR_BACK_CLEARANCE_M（0.6m）。
 * 越界先沿法线向内平移到刚好满足；平移后与已接受家具 footprint AABB 相交
 * （0.02m 容差）则该件进 skipped，reason 「贴墙放不下{家具名}」。
 *
 * 纯函数、不可变；输入数组不被修改。
 */
export function applyWallClearance(
  placements: readonly ZoneFurniturePlacement[],
  roomSize: PlanRoomSize,
): WallClearanceOutcome {
  const halfW = roomSize.width / 2;
  const halfH = roomSize.height / 2;
  const accepted: ZoneFurniturePlacement[] = [];
  const skipped: ZonePlanSkipped[] = [];

  for (const p of placements) {
    const hw = p.spec.width / 2;
    const hd = p.spec.depth / 2;

    // 四面墙退距；椅子背侧按 0.6m，其余按 0.3m。
    let cWest = WALL_CLEARANCE_M;
    let cEast = WALL_CLEARANCE_M;
    let cNorth = WALL_CLEARANCE_M;
    let cSouth = WALL_CLEARANCE_M;
    if (p.spec.type === 'dining-chair' && p.ownerTableId) {
      const [txRaw, tzRaw] = p.ownerTableId.split('|');
      const tx = Number(txRaw);
      const tz = Number(tzRaw);
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        const dx = p.x - tx;
        const dz = p.z - tz;
        const len = Math.hypot(dx, dz);
        if (len > 1e-6) {
          const backX = dx / len;
          const backZ = dz / len;
          if (backX < -0.5) cWest = CHAIR_BACK_CLEARANCE_M;
          else if (backX > 0.5) cEast = CHAIR_BACK_CLEARANCE_M;
          if (backZ < -0.5) cNorth = CHAIR_BACK_CLEARANCE_M;
          else if (backZ > 0.5) cSouth = CHAIR_BACK_CLEARANCE_M;
        }
      }
    }

    // 计算沿法线需要平移的量（dx / dz）。
    let dx = 0;
    let dz = 0;
    const leftEdge = p.x - hw;
    const rightEdge = p.x + hw;
    const topEdge = p.z - hd;
    const bottomEdge = p.z + hd;

    const westLimit = -halfW + cWest;
    if (leftEdge < westLimit) dx += westLimit - leftEdge;
    const eastLimit = halfW - cEast;
    if (rightEdge > eastLimit) dx += eastLimit - rightEdge;

    const northLimit = -halfH + cNorth;
    if (topEdge < northLimit) dz += northLimit - topEdge;
    const southLimit = halfH - cSouth;
    if (bottomEdge > southLimit) dz += southLimit - bottomEdge;

    const nx = round2(p.x + dx);
    const nz = round2(p.z + dz);

    // 与已接受家具做 AABB 相交检测；相交则放弃这件。
    let collided = false;
    for (const q of accepted) {
      if (aabbOverlap(nx, nz, hw, hd, q.x, q.z, q.spec.width / 2, q.spec.depth / 2)) {
        collided = true;
        break;
      }
    }
    if (collided) {
      skipped.push({
        zoneId: p.zoneId,
        label: p.zoneType,
        reason: `贴墙放不下「${p.spec.name}」，向内平移后与其他家具压住`,
      });
      continue;
    }
    accepted.push({ ...p, x: nx, z: nz });
  }

  return { placements: accepted, skipped };
}
