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
// 生成器要保证自己的产物过得了检查层：环几何与 rest 对坐距直接吃检查层阈值，
// 避免再出现「生成常数和检查常数各写一份」的漂移（G5/G7 根因）。
import { AISLE_CLEARANCE_THRESHOLD_M, CHAIR_GAP_THRESHOLD_M } from './human-factors';

/**
 * 圆桌直径（米）。与 furniture-catalog 的圆桌条目（Ø1.8，Hall D5 官方值）同步——
 * 旧值 1.2 与 catalog 脱钩是 G5 的第一层根因，别再各写一份。
 */
export const TABLE_DIAMETER = 1.8;
/** 椅子边长（米）。 */
export const CHAIR_SIZE = 0.45;
/**
 * 桌心到相邻椅心的径向距离（米）。
 * 要同时满足两条几何约束（都按最坏 round2 量化误差 ±0.015m 留余量）：
 * - 同环相邻椅弦长 2r·sin(π/8) ≥ CHAIR_GAP_THRESHOLD_M（8 椅均布不过挤）→ r ≥ 1.196；
 * - 椅内缘 r−CHAIR_SIZE/2 与桌缘 TABLE_DIAMETER/2 之间留 > AABB 容差 0.02m → r ≥ 1.145。
 * 旧值 0.9 会让椅脚伸进 Ø1.8 桌面里（G5 第二层根因）。
 */
export const CHAIR_RING_RADIUS = 1.22;
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
/**
 * 相邻两桌之间，两把面朝彼此的椅子的中心距下限（米）：
 * 跨桌椅距 = pitch − 2×CHAIR_RING_RADIUS，必须 ≥ CHAIR_GAP_THRESHOLD_M。
 * 额外 +0.1m 盖住 round2 量化误差，别让 0.90 被舍成 0.89 触发误报。
 */
export const ROUND_TABLE_PITCH_GUARD_M = 0.1;
/**
 * 圆桌区网格内缩（米）：桌心距 zone 边至少这么远，让最外圈椅子
 * （桌心 ± CHAIR_RING_RADIUS + CHAIR_SIZE/2）整个留在区里，
 * 不越过 zone 入口边（否则触发 ZONE_ENTRANCE_BLOCKED）也不被墙退距吞掉。
 */
export const ROUND_TABLE_INSET_M = ZONE_INSET + CHAIR_RING_RADIUS + CHAIR_SIZE / 2;

/* ---------- 课桌式（教室式）布局常数（对齐东京国际论坛 Hall D5 官方图） ---------- */
// 红线：以下常数直接来自官方图，不要用 density 旋钮缩放——课桌排距 1.4m、
// 走道 1.2m 是消防/人体工学硬值，dense 档也不能压到 0.9m。

/** 课桌宽（米，沿 x 方向）。 */
export const DESK_TABLE_WIDTH_M = 1.8;
/** 课桌深（米，沿 z 方向）。 */
export const DESK_TABLE_DEPTH_M = 0.6;
/** 讲座椅宽（米）。 */
export const DESK_CHAIR_WIDTH_M = 0.49;
/** 讲座椅深（米）。 */
export const DESK_CHAIR_DEPTH_M = 0.57;
/** 课桌排距（米，桌前沿到下一排桌前沿；官方 1400mm）。 */
export const DESK_ROW_PITCH_M = 1.4;
/** 课桌块间走道净宽（米；官方 1200mm）。 */
export const DESK_AISLE_M = 1.2;
/** 每桌配几把讲座椅（官方课桌图：1.8m 长桌沿长边坐 3 人）。 */
export const DESK_CHAIRS_PER_TABLE = 3;
/** 每个 block 内并几张课桌（官方「三列块」按 3 桌一块）。 */
export const DESK_BLOCK_TABLES = 3;
/** 讲台/舞台到第一排课桌前沿的留空（米；官方 5000mm，本批仅导出常量、不参与布置）。 */
export const STAGE_FRONT_CLEAR_M = 5.0;
/** 椅桌间隙（米，桌前沿到椅后缘）。 */
export const DESK_CHAIR_GAP_M = 0.05;
/**
 * 同一 block 内相邻课桌之间的拼接间隙（米）。
 * 官方图上课桌并桌是无缝拼接，但我们 AABB 重叠检测有 0.02m 容差，
 * 两桌正好相接会被误判为压住，这里留 0.04m 工程间隙（视觉上仍为并排）。
 */
export const DESK_TABLE_GAP_M = 0.04;

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
  desk: {
    table: getCatalogForZone('desk-table', 'desk')!,
    chair: getCatalogForZone('desk-chair', 'desk')!,
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
  // 桌心距下限：除了桌径 + 走道余量，还要保证相邻两桌的环椅互不贴脸
  // （跨桌椅距 = pitch − 2×环半径 ≥ CHAIR_GAP_THRESHOLD_M，见 ROUND_TABLE_PITCH_GUARD_M）。
  const pitch = Math.max(
    TABLE_DIAMETER + 0.3,
    2 * CHAIR_RING_RADIUS + CHAIR_GAP_THRESHOLD_M + ROUND_TABLE_PITCH_GUARD_M,
    spec.spacingMeters,
  );
  const placements: ZoneFurniturePlacement[] = [];
  const skipped: ZonePlanSkipped[] = [];

  for (const ann of annotations) {
    if (ann.kind !== 'zone' || ann.geometry.kind !== 'rect') continue;
    const g = ann.geometry;
    // 无 zoneType 的区不再兜底成圆桌（docs/32 §三.S1③：外部注入的无类型区
    // 曾被摆满 3 桌 24 椅）——落 skipped 让 UI 说人话，等用户补选区类型。
    if (!ann.zoneType) {
      skipped.push({
        zoneId: ann.id,
        label: ann.label,
        reason: '这个区没选类型，本版不落家具；点区重新选一个类型后再出方案',
      });
      continue;
    }
    // 故意放宽成 string：未来若扩展 zoneType 或外部注入非法值，不要静默按 rest 摆家具，
    // 走下面的「未知类型降级」分支落 skipped。
    const zoneType = ann.zoneType as string;
    const push = (p: Omit<ZoneFurniturePlacement, 'zoneId' | 'zoneType'>) =>
      placements.push({ ...p, zoneId: ann.id, zoneType: zoneType as ZoneSemanticType });

    if (g.width <= 0 || g.depth <= 0) {
      skipped.push({ zoneId: ann.id, label: ann.label, reason: '画得太小，基本是个点' });
      continue;
    }

    if (zoneType === 'roundtable') {
      // 内缩含整圈椅子（不是只含桌面）：桌心距区边至少 ROUND_TABLE_INSET_M，
      // 否则最外圈椅子越出区界，触发入口堵门/墙退距吞件（G5 修复前实测）。
      const inset = ROUND_TABLE_INSET_M;
      const minSide = inset * 2 + 0.1;
      if (g.width - inset * 2 < 0.1 || g.depth - inset * 2 < 0.1) {
        skipped.push({ zoneId: ann.id, label: ann.label, reason: `圆桌区至少要 ${minSide.toFixed(1)}×${minSide.toFixed(1)}m 才摆得下一桌八椅` });
        continue;
      }
      gridRoundtable(g.x, g.z, g.width, g.depth, inset, pitch, push);
    } else if (zoneType === 'desk') {
      // 课桌区：最小 6.0m 宽（1 个 block 3 桌）× 1.8m 深（1 排含椅）。
      const minW = ZONE_INSET * 2 + DESK_BLOCK_TABLES * DESK_TABLE_WIDTH_M;
      const minD = ZONE_INSET * 2 + DESK_TABLE_DEPTH_M + DESK_CHAIR_GAP_M + DESK_CHAIR_DEPTH_M;
      if (g.width < minW || g.depth < minD) {
        skipped.push({
          zoneId: ann.id,
          label: ann.label,
          reason: `课桌区至少要 ${minW.toFixed(1)}×${minD.toFixed(1)}m 才摆得下一排课桌（每桌 3 椅）`,
        });
        continue;
      }
      gridDeskRows(g.x, g.z, g.width, g.depth, push);
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
      // 深度下限 = 对坐中心距 + 椅深 + 两侧各 0.1m 余量：再浅长椅就会伸出区界（G7 同源）。
      const restMinDepth = AISLE_CLEARANCE_THRESHOLD_M + SPEC.rest.bench.depth + 0.2;
      if (g.width < 2.2 || g.depth < restMinDepth) {
        skipped.push({ zoneId: ann.id, label: ann.label, reason: `休息区至少要 2.2×${restMinDepth.toFixed(1)}m 才能两排长椅对坐` });
        continue;
      }
      rowsRest(g.x, g.z, g.width, g.depth, push);
    } else if (zoneType === 'reserved') {
      // 预留区/消防疏散（keep-out）：按定义本版不摆家具，也不进 skipped——
      // 「留空」是这个区的语义本身，不是失败；别区家具压进来由评分层
      // evaluateKeepOut 判 hard violation（KEEP_OUT_INTRUDED）。
      continue;
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

/**
 * 课桌式（教室式）排桌布局：
 * - 桌 1.8×0.6 沿 x 摆，每 block DESK_BLOCK_TABLES 桌并排（5.4m 宽）；
 * - block 间走道 DESK_AISLE_M=1.2m（官方课桌图）；
 * - 排距 DESK_ROW_PITCH_M=1.4m（桌前沿到下一排桌前沿；官方 1400mm）；
 * - 每桌 DESK_CHAIRS_PER_TABLE=3 把讲座椅沿桌长三等分摆在桌前沿外 0.05m；
 * - 椅子 rotation=π 面向 z 负方向（讲台/前方），ownerTableId 链到所属桌。
 *
 * 注意：排距/走道不随 density 旋钮缩放——这是官方硬值，dense 档也不能压到 0.9m。
 */
function gridDeskRows(
  x0: number,
  z0: number,
  w: number,
  d: number,
  push: (p: Omit<ZoneFurniturePlacement, 'zoneId' | 'zoneType'>) => void,
): void {
  const inset = ZONE_INSET;
  const left = x0 + inset;
  const right = x0 + w - inset;
  // 舞台前留空由 zone 坐标本身表达（fixture 里课桌区北缘内缩出台前带），
  // grid 函数不强行再加 5m——否则小房间（如 7.1m 深的会议室）会被吃光。
  const top = z0 + inset;
  const bottom = z0 + d - inset;

  const tableW = SPEC.desk.table.width; // 1.8
  const tableD = SPEC.desk.table.depth; // 0.6
  const chairD = SPEC.desk.chair.depth; // 0.57

  // 第一排桌心 z = top + tableD/2（桌前沿在 z 正方向）。
  let rowZ = top + tableD / 2;
  // 排距：桌前沿到下一排桌前沿 = DESK_ROW_PITCH_M；桌深相同 → 桌心距 = DESK_ROW_PITCH_M。
  const rowPitch = DESK_ROW_PITCH_M;

  while (rowZ + tableD / 2 <= bottom + 1e-6) {
    // 沿 x 从左到右摆 block，每个 block 内 DESK_BLOCK_TABLES 桌并排。
    let xCursor = left + tableW / 2;
    let tableIndexInBlock = 0;
    while (xCursor + tableW / 2 <= right + 1e-6) {
      const tableX = xCursor;
      const tableKey = `${round2(tableX)}|${round2(rowZ)}`;
      push({ spec: SPEC.desk.table, x: round2(tableX), z: round2(rowZ), rotation: 0 });

      // 每桌 3 椅沿桌长三等分（椅中心在桌长内等分，不伸出桌外）：
      // 偏移 = (k - (n-1)/2) * (tableW/n)，n=3 → ±0.6m。
      // z 在桌前沿（z 正方向）外 DESK_CHAIR_GAP_M。
      const chairZ = rowZ + tableD / 2 + DESK_CHAIR_GAP_M + chairD / 2;
      for (let k = 0; k < DESK_CHAIRS_PER_TABLE; k++) {
        const offset = (k - (DESK_CHAIRS_PER_TABLE - 1) / 2) * (tableW / DESK_CHAIRS_PER_TABLE);
        const chairX = tableX + offset;
        push({
          spec: SPEC.desk.chair,
          x: round2(chairX),
          z: round2(chairZ),
          rotation: Math.PI,
          ownerTableId: tableKey,
        });
      }

      // 下一桌：同一 block 内桌间留 DESK_TABLE_GAP_M 工程间隙（避开 AABB 0.02m 容差）；
      // block 内第 DESK_BLOCK_TABLES 桌之后，跳过 DESK_AISLE_M 走道。
      tableIndexInBlock += 1;
      if (tableIndexInBlock >= DESK_BLOCK_TABLES) {
        // 走到下一个 block：当前桌右缘 + 走道 + 下一桌半宽
        xCursor = xCursor + tableW / 2 + DESK_AISLE_M + tableW / 2;
        tableIndexInBlock = 0;
      } else {
        xCursor = xCursor + tableW + DESK_TABLE_GAP_M;
      }
    }
    rowZ += rowPitch;
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

/** 休息区：两排长椅对坐。对坐中心距直接取检查层阈值（G7：旧硬值 1.5 < 1.65 自产 INFEASIBLE）。 */
function rowsRest(
  x0: number,
  z0: number,
  w: number,
  d: number,
  push: (p: Omit<ZoneFurniturePlacement, 'zoneId' | 'zoneType'>) => void,
): void {
  const benchPitch = 2.2;
  const maxBenchesPerRow = 3;
  const aisle = AISLE_CLEARANCE_THRESHOLD_M;
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

/**
 * 同桌环椅对判定：这把餐椅是不是「环在这张桌边」的那把。
 *
 * 背景：AABB 是轴对齐近似，45° 环椅的包围盒角会戳进自家圆桌的包围盒
 * （径向距离 CHAIR_RING_RADIUS 够远，但逐轴比较 dx=dz≈0.86 < 桌半径+容差）。
 * 这类对不算压住——前提是径向距离真的 ≥ 桌半径+椅半宽−容差（自守卫）：
 * 环半径将来被改小（椅真伸进桌面），豁免自动失效，BBOX_OVERLAP 重新出现。
 * 供 applyWallClearance（不再吞斜向环椅）与 detectFurnitureOverlap（不再误报）共用。
 */
export function isRingChairOfTable(
  chair: ZoneFurniturePlacement,
  table: ZoneFurniturePlacement,
): boolean {
  if (chair.spec.type !== 'dining-chair' || !chair.ownerTableId) return false;
  if (`${table.x}|${table.z}` !== chair.ownerTableId) return false;
  const d = Math.hypot(chair.x - table.x, chair.z - table.z);
  return d >= TABLE_DIAMETER / 2 + CHAIR_SIZE / 2 - WALL_OVERLAP_TOLERANCE_M;
}

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
 * （0.02m 容差）则该件进 skipped。reason 按事实分两种：真内移过 →「贴墙放不下」；
 * 没内移就撞上 →「与其他家具位置压住」（旧版一律报贴墙，掩盖环椅自撞类冲突）。
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
    if ((p.spec.type === 'dining-chair' || p.spec.type === 'desk-chair') && p.ownerTableId) {
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
    // 例外：斜向环椅 vs 自家圆桌的 AABB 角碰撞不是真压住（isRingChairOfTable
    // 自带径向自守卫），不吞这件——否则每桌 8 椅会被吞掉 4 把（G5 实测）。
    // 径向距离按「内移之后」的位置算，才反映真实挤压状态。
    let collided = false;
    for (const q of accepted) {
      if (
        aabbOverlap(nx, nz, hw, hd, q.x, q.z, q.spec.width / 2, q.spec.depth / 2)
        && !isRingChairOfTable({ ...p, x: nx, z: nz }, q)
      ) {
        collided = true;
        break;
      }
    }
    if (collided) {
      // 两种事实分开说：真被墙顶过内移的才叫「贴墙放不下」；
      // 没挪一步就撞上的（如环椅几何自撞）直说「位置压住」——
      // 旧文案把第二种也报成贴墙，掩盖了真实的几何冲突（docs/32 §三.3）。
      skipped.push({
        zoneId: p.zoneId,
        label: p.zoneType,
        reason: (dx !== 0 || dz !== 0)
          ? `贴墙放不下「${p.spec.name}」，向内平移后与其他家具压住`
          : `「${p.spec.name}」与其他家具位置压住，本件跳过`,
      });
      continue;
    }
    accepted.push({ ...p, x: nx, z: nz });
  }

  return { placements: accepted, skipped };
}
