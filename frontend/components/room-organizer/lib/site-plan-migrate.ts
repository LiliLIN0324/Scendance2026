/**
 * 旧项目迁移演练（H1-c）：把旧壳体场地（RoomLayout 的 mapGroundFrame / sceneAnchor 派生）转成新 SitePlan ENU 米制 draft。
 *
 * 语义对齐蓝图 §7.3「迁移先预览再复制」：
 * - 输入旧工程只读，绝不改动原项目（迁移本身不写任何东西）。
 * - 先 `previewLegacyMigration` 出「预览 draft + 校准报告」，用户确认后再 `materializeLegacyDraft` 复制成一份
 *   新 SitePlan 快照（revision 1、新 planId）；旧工程原样可读、可回滚。
 * - 缺来源 / 朝向 / 可信尺度 / 关联 ID 的实体一律进 `report.pendingCalibration`（待校准），缺尺寸 / 越界进
 *   `report.droppedItems`。不虚构缺失的几何，只把可判的部分按原比例保留并标出待校准。
 *
 * 坐标换算（蓝图 §6 坐标约定）：旧壳体 z 在 latSign=-1 时向南（北在 z=0、平面图沿），+1 时向北。
 * 局部米制 ENU（x 东、y 北）；真实米 = 壳体单位 × metersPerUnit（sceneAnchor），回退为 ÷ frameScale。
 * 两者皆缺 → 尺度未知，保留原比例并标待校准（预览可先看结构，不做交付断言）。
 */

import {
  sitePlanDataSchema,
  sitePlanSnapshotSchema,
  type PlanAnchor,
  type PlanPoint,
  type SitePlanData,
  type SitePlanSnapshot,
} from '../../../../supabase/functions/_shared/site-plan';

/** 旧项目中的单个对象：壳体局部坐标（x 向东、z 向北/向南按 latSign）。宽深可选，缺即「待校准/丢弃」。 */
export interface LegacyItemInput {
  id: string;
  name: string;
  x: number;
  z: number;
  rotationDeg: number;
  width?: number;
  depth?: number;
}

/** 旧项目迁移输入：取自 RoomLayout 的可迁移子集，保持只读。 */
export interface LegacyPlanInput {
  /** 场地边界，壳体局部坐标环（x 向东、z 向北/向南）。 */
  boundary: readonly { x: number; z: number }[];
  items?: readonly LegacyItemInput[];
  /** sceneAnchor.metersPerUnit：1 世界单位对应的米数（优先）。 */
  metersPerUnit?: number;
  /** mapGroundFrame.scale：壳体米 / 真实米，metersPerUnit 缺失时的回退（取倒数）。 */
  frameScale?: number;
  /** z 向北取 +1，向南取 -1；旧帧缺省 +1。 */
  latSign?: 1 | -1;
  /** 场地地理锚点（GCJ-02）；缺 → 锚点待校准。 */
  anchor?: { lng: number; lat: number; source: 'picker' | 'manual' | 'lookup' | 'asset-geo' };
  /** 朝向基准（0 = 正北朝上）；缺或非 0 → 朝向待校准。 */
  orientationDeg?: number;
}

export interface PendingCalibration {
  label: string;
  reason: string;
}

export interface DroppedItem {
  itemId: string;
  reason: string;
}

export interface MigrationReport {
  /** 是否具备可信米制尺度（有 metersPerUnit 或 frameScale）。 */
  scaleOk: boolean;
  /** 是否已确认正北朝上（orientationDeg === 0）。 */
  orientationOk: boolean;
  /** 是否有地理锚点。 */
  anchorOk: boolean;
  /** 边界环是否可解析（>=3 顶点、面积 > 0）。 */
  boundaryOk: boolean;
  /** 待校准项（缺来源 / 朝向 / 尺度 / 锚点等）。 */
  pendingCalibration: PendingCalibration[];
  /** 因缺尺寸或越界被丢弃的实体。 */
  droppedItems: DroppedItem[];
  /** 保留进 draft 的设施数。 */
  keptItems: number;
}

/** 预览结果：数据（ENU 米制 draft）+ 报告。预览本身不写任何东西。 */
export interface MigrationPreview {
  data: SitePlanData;
  report: MigrationReport;
}

/** 解析尺度：返回「壳体单位 → 米」的系数；未知时返回 1 并 ok=false（保留原比例，标待校准）。 */
function resolveScale(input: LegacyPlanInput): { mpp: number; ok: boolean } {
  if (input.metersPerUnit !== undefined && Number.isFinite(input.metersPerUnit) && input.metersPerUnit > 0) {
    return { mpp: input.metersPerUnit, ok: true };
  }
  if (input.frameScale !== undefined && Number.isFinite(input.frameScale) && input.frameScale > 0) {
    return { mpp: 1 / input.frameScale, ok: true };
  }
  return { mpp: 1, ok: false };
}

/** 壳体 (x,z) → 局部 ENU（x 东、y 北）。 */
function toPlanPoint(p: { x: number; z: number }, mpp: number, northIsPlus: boolean): PlanPoint {
  return { x: p.x * mpp, y: (northIsPlus ? 1 : -1) * p.z * mpp };
}

/** 点在环内（射线法）。环为 ENU 点列（未闭合按闭合处理）。 */
function pointInRing(pt: PlanPoint, ring: readonly PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-12) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 边界环是否有效（≥3 顶点、无相邻重复、面积 > 0）。 */
function ringValid(ring: readonly PlanPoint[]): boolean {
  if (ring.length < 3) return false;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i]!.x === ring[i - 1]!.x && ring[i]!.y === ring[i - 1]!.y) return false;
  }
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2 > 1e-9;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100 + 0; // +0 把 -0 归一到 +0
}

/**
 * 预览旧项目迁移（只读，不写盘）。
 * @param input 旧工程的可迁移子集（调用方自行提取，原项目不被修改）。
 * @param newId 可选 UUID 生成器（便于测试；缺省 crypto.randomUUID）。
 */
export function previewLegacyMigration(
  input: LegacyPlanInput,
  newId: () => string = () => crypto.randomUUID(),
): MigrationPreview {
  const { mpp, ok: scaleOk } = resolveScale(input);
  const northSign = input.latSign !== -1; // 缺省 +1（北在 +z）
  const orientationOk = input.orientationDeg === 0;
  const anchorOk = input.anchor !== undefined;

  const boundaryEnu = input.boundary.map(p => toPlanPoint(p, mpp, northSign));
  const boundaryOk = ringValid(boundaryEnu);

  const pendingCalibration: PendingCalibration[] = [];
  if (!scaleOk) pendingCalibration.push({ label: '尺度', reason: '缺 metersPerUnit / frameScale，无法给出可信米制，仅保留原比例待校准' });
  if (!orientationOk) pendingCalibration.push({ label: '朝向', reason: '缺 orientationDeg=0 的确认，北向基准待校准' });
  if (!anchorOk) pendingCalibration.push({ label: '锚点', reason: '无地理锚点（仅本地坐标），未参与地理定位' });
  if (!boundaryOk) pendingCalibration.push({ label: '边界', reason: '边界环无法解析（顶点 <3 或退化），未写入边界' });

  const facilities: SitePlanData['facilities'] = [];
  const droppedItems: DroppedItem[] = [];

  for (const item of input.items ?? []) {
    if (item.width === undefined || item.depth === undefined || item.width <= 0 || item.depth <= 0) {
      droppedItems.push({ itemId: item.id, reason: '缺宽深，无法给出占地' });
      continue;
    }
    const pos = toPlanPoint({ x: item.x, z: item.z }, mpp, northSign);
    if (boundaryOk && !pointInRing(pos, boundaryEnu)) {
      droppedItems.push({ itemId: item.id, reason: '越出场地边界，不随规划复制' });
      continue;
    }
    facilities.push({
      id: newId(),
      templateId: item.name,
      name: item.name,
      position: pos,
      rotationDeg: item.rotationDeg,
      size: { width: item.width, depth: item.depth },
      notes: '',
    });
  }

  const data: SitePlanData = {
    schemaVersion: 1,
    ...(input.anchor
      ? { anchor: { lng: input.anchor.lng, lat: input.anchor.lat, crs: 'gcj-02', source: input.anchor.source } satisfies PlanAnchor }
      : {}),
    boundary: boundaryOk ? boundaryEnu.map(p => ({ x: round2(p.x), y: round2(p.y) })) : [],
    zones: [],
    facilities,
    routes: [],
    nodes: [],
    workers: [],
  };

  return {
    data,
    report: {
      scaleOk,
      orientationOk,
      anchorOk,
      boundaryOk,
      pendingCalibration,
      droppedItems,
      keptItems: facilities.length,
    },
  };
}

/**
 * 用户确认后把预览 draft 物化为独立 SitePlan 快照（复制，revision 1、新 planId）。
 * 不触碰旧工程，也不写存储；调用方可再经 site-plan-store 保存（并存语义见 H1-b）。
 */
export function materializeLegacyDraft(
  preview: MigrationPreview,
  projectId: string,
  now: () => Date = () => new Date(),
  newId: () => string = () => crypto.randomUUID(),
): SitePlanSnapshot {
  const parsed = sitePlanDataSchema.parse(preview.data);
  const snapshot: SitePlanSnapshot = {
    planId: newId(),
    projectId,
    revision: 1,
    updatedAt: now().toISOString(),
    data: parsed,
  };
  // 快照本身也过一次契约校验，保证复制产物可直接落盘 / 交付。
  sitePlanSnapshotSchema.parse(snapshot);
  return snapshot;
}