/**
 * Plan facility / zone CRUD 写入口纯函数层（S4 B 片 · B-1）。
 *
 * 口径（`docs/evidence/decouple-2026-11-26/s4-placement-takeover-plan.md` §4 B 片）：
 * - 本层是 plan 正源的唯一写侧纯函数：入参当前 `SitePlanData`，输出下一份 plan；
 *   不可变更新，不 mutate 入参；不调网络、不碰存储、不碰 React。
 * - 几何 / 占地 / 命名 / 环校验一律复用 `site-plan-facilities.ts` / `site-plan-editing.ts`，
 *   本层不另造 footprint、换算或校验公式。
 * - 字段白名单以 `planFacilitySchema` / `planZoneSchema` 为准：契约外字段
 *   （AV/安防视锥、挂墙结构、人物动画、elevation、wallId/structural 标记等）
 *   补丁里出现即剥离并记 `unknown-field`，不进 facility/zone，不编造槽位。
 * - legacy 三链（layout-reducer / use-layout-store / use-layout-state）本轮不删不碰，
 *   本层只新增 plan 侧通道；双读回落保持原样。
 */

import {
  planZoneSchema,
  type PlanFacility,
  type PlanPoint,
  type PlanZone,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { randomId } from './ids';
import {
  buildZone,
  checkPlanRing,
  type PlanEditIssue,
  type PlanEditResult,
} from './site-plan-editing';
import {
  buildFacility,
  facilityPassesContract,
} from './site-plan-facilities';

/** 契约平面点范围（±5000 m），与 site-plan planPointSchema 同源。 */
const PLAN_COORD_LIMIT_M = 5000;
/** 契约尺寸上限（宽/深 ≤ 100 m），与 planFacilitySchema.size 同源。 */
const PLAN_SIZE_LIMIT_M = 100;
/** 分区最小面积（m²），与 site-plan-editing PLAN_MIN_ZONE_AREA_M2 同口径。 */
const PLAN_MIN_ZONE_AREA_M2 = 1;

/* ---------------- 设施 action 联合 ---------------- */

/** 允许写入 facility 的白名单字段（与 planFacilitySchema 可改/可选槽位逐条对齐）。 */
export const FACILITY_PATCH_FIELDS = [
  'name', 'position', 'rotationDeg', 'size', 'zoneId', 'color', 'opacity', 'levelId',
  'notes', 'vendorName', 'vendorZone', 'inDate', 'inTime', 'outDate', 'outTime',
  'electricKw', 'strokeStyle', 'modelOverride', 'unitPrice', 'heightM', 'locked',
  'groupId', 'shape', 'finish', 'windowSillM', 'windowHeightM', 'sourceAssetId',
] as const;

export type FacilityPatchField = (typeof FACILITY_PATCH_FIELDS)[number];

export type FacilityPatch = {
  [K in FacilityPatchField]?: PlanFacility[K];
};

export interface FacilityAddInput {
  templateId: string;
  position: PlanPoint;
  rotationDeg?: number;
  zoneId?: string;
  color?: string;
  notes?: string;
  sourceAssetId?: string;
  modelOverride?: string;
  /**
   * 物件库动态模板：条目给定名称 / 宽深，不属于内置模板目录。
   * 不传时仍按 `templateId` 走内置目录（语义不变）；尺寸由条目给定，本层不编默认值。
   */
  template?: {
    name: string;
    width: number;
    depth: number;
    note?: string;
  };
}

export type FacilityAction =
  | { kind: 'add'; input: FacilityAddInput }
  | { kind: 'remove'; id: string }
  | { kind: 'update'; id: string; patch: FacilityPatch }
  | { kind: 'move'; id: string; position: PlanPoint }
  | { kind: 'rotate'; id: string; rotationDeg: number }
  | { kind: 'resize'; id: string; size: { width: number; depth: number } }
  | { kind: 'duplicate'; id: string }
  | { kind: 'setGroup'; ids: readonly string[]; groupId?: string }
  | { kind: 'clearGroup'; ids: readonly string[] }
  | { kind: 'setLocked'; id: string; locked: boolean }
  | { kind: 'setShape'; id: string; shape: NonNullable<PlanFacility['shape']> }
  | { kind: 'setFinish'; id: string; finish: NonNullable<PlanFacility['finish']> };

/* ---------------- 分区 action 联合 ---------------- */

/** 允许写入 zone 的白名单字段（semantic 建档后不就地改；归属走 levelId）。 */
export const ZONE_PATCH_FIELDS = [
  'name', 'polygon', 'color', 'opacity', 'event', 'environment', 'purpose', 'notes', 'levelId',
] as const;

export type ZonePatchField = (typeof ZONE_PATCH_FIELDS)[number];

export type ZonePatch = {
  [K in ZonePatchField]?: PlanZone[K];
};

export interface ZoneAddInput {
  semantic: PlanZone['semantic'];
  name: string;
  polygon: readonly PlanPoint[];
  color?: string;
  opacity?: number;
  event?: string;
  environment?: PlanZone['environment'];
  purpose?: PlanZone['purpose'];
  notes?: string;
  levelId?: string;
}

export type ZoneAction =
  | { kind: 'add'; input: ZoneAddInput }
  | { kind: 'update'; id: string; patch: ZonePatch }
  | { kind: 'remove'; id: string };

/**
 * 壳通道回调形状：纯层 action 函数 + 当前绑定 plan 由壳侧绑定构成。
 * context 只持有通道回调，不实现逻辑；无绑定 plan 时 `planActions` 为 null。
 */
export interface PlanActions {
  readonly applyFacility: (action: FacilityAction) => PlanEditResult<SitePlanData>;
  readonly applyZone: (action: ZoneAction) => PlanEditResult<SitePlanData>;
}

/* ---------------- 基础校验（口径全部对齐 zod 契约） ---------------- */

function pointInRange(pt: PlanPoint): boolean {
  return Number.isFinite(pt.x) && Number.isFinite(pt.y)
    && Math.abs(pt.x) <= PLAN_COORD_LIMIT_M && Math.abs(pt.y) <= PLAN_COORD_LIMIT_M;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function invalidIssue(code: PlanEditIssue['code'], message: string): PlanEditIssue {
  return { code, message };
}

function findFacility(plan: SitePlanData, id: string): PlanFacility | undefined {
  return plan.facilities.find(f => f.id === id);
}

function findZone(plan: SitePlanData, id: string): PlanZone | undefined {
  return plan.zones.find(z => z.id === id);
}

function zoneExists(plan: SitePlanData, zoneId: string): boolean {
  return plan.zones.some(z => z.id === zoneId);
}

function levelExists(plan: SitePlanData, levelId: string): boolean {
  return (plan.levels ?? []).some(l => l.id === levelId);
}

/** 逐字段校验 facility 补丁；返回清洗后的白名单值、被剥离字段与拒收问题。 */
function sanitizeFacilityPatch(
  patch: FacilityPatch,
  plan: SitePlanData,
): {
  next: Partial<PlanFacility>;
  dropped: string[];
  issue: PlanEditIssue | null;
} {
  const next: Partial<PlanFacility> = {};
  const dropped: string[] = [];
  const whitelist = new Set<string>(FACILITY_PATCH_FIELDS);

  for (const [key, value] of Object.entries(patch)) {
    if (!whitelist.has(key)) {
      dropped.push(key);
      continue;
    }
    if (value === undefined) {
      // 显式 undefined = 清掉该可选槽；不写回键，旧包只读兼容口径一致。
      continue;
    }
    next[key as FacilityPatchField] = value as never;
  }

  // 逐字段口径校验（与 planFacilitySchema 一一对应；非法即拒收，不夹带提交）。
  if (next.name !== undefined && (next.name.length < 1 || next.name.length > 60)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '设施名称需为 1–60 字。') };
  }
  if (next.position !== undefined && !pointInRange(next.position)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '设施位置超出平面范围（±5000 m）。') };
  }
  if (next.rotationDeg !== undefined && (!Number.isFinite(next.rotationDeg) || Math.abs(next.rotationDeg) > 360)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '设施旋转角度需在 -360° 到 360° 之间。') };
  }
  if (next.size !== undefined) {
    const { width, depth } = next.size;
    if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0
      || width > PLAN_SIZE_LIMIT_M || depth > PLAN_SIZE_LIMIT_M) {
      return { next, dropped, issue: invalidIssue('out-of-range', '设施宽深需为正数且不超过 100 m。') };
    }
  }
  if (next.color !== undefined && !HEX_COLOR.test(next.color)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '设施颜色需为 #RRGGBB 十六进制色值。') };
  }
  if (next.opacity !== undefined && (!Number.isFinite(next.opacity) || next.opacity < 0 || next.opacity > 1)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '设施透明度需在 0–1 之间。') };
  }
  if (next.zoneId !== undefined && !zoneExists(plan, next.zoneId)) {
    return { next, dropped, issue: invalidIssue('unknown-zone', '设施归属分区不存在。') };
  }
  if (next.levelId !== undefined && !levelExists(plan, next.levelId)) {
    return { next, dropped, issue: invalidIssue('not-found', '设施所属图层不存在。') };
  }
  if (next.electricKw !== undefined && (!Number.isFinite(next.electricKw) || next.electricKw < 0 || next.electricKw > 10000)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '用电功率需在 0–10000 kW 之间。') };
  }
  if (next.unitPrice !== undefined && (!Number.isFinite(next.unitPrice) || next.unitPrice < 0 || next.unitPrice > 1_000_000)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '单价需在 0–1,000,000 元之间。') };
  }
  if (next.heightM !== undefined && (!Number.isFinite(next.heightM) || next.heightM < 0 || next.heightM > 20)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '设施高度需在 0–20 m 之间。') };
  }
  if (next.windowSillM !== undefined && (!Number.isFinite(next.windowSillM) || next.windowSillM < 0 || next.windowSillM > 3)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '窗台高需在 0–3 m 之间。') };
  }
  if (next.windowHeightM !== undefined && (!Number.isFinite(next.windowHeightM) || next.windowHeightM < 0.2 || next.windowHeightM > 3)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '窗洞高需在 0.2–3 m 之间。') };
  }
  if (next.groupId !== undefined && (next.groupId.length < 1 || next.groupId.length > 60)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '分组号需为 1–60 字符。') };
  }
  if (next.notes !== undefined && next.notes.length > 500) {
    return { next, dropped, issue: invalidIssue('out-of-range', '设施备注不能超过 500 字。') };
  }
  if (next.sourceAssetId !== undefined && (next.sourceAssetId.length < 1 || next.sourceAssetId.length > 160)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '素材引用标识需为 1–160 字符。') };
  }
  if (next.modelOverride !== undefined && (next.modelOverride.length < 1 || next.modelOverride.length > 160)) {
    return { next, dropped, issue: invalidIssue('out-of-range', '模型 override 标识需为 1–160 字符。') };
  }
  return { next, dropped, issue: null };
}

/** 把清洗后的补丁合到设施副本上；补丁里显式 undefined 的可选槽被删除。 */
function mergeFacilityPatch(source: PlanFacility, patch: Partial<PlanFacility>): PlanFacility {
  const merged: PlanFacility = { ...source };
  for (const field of FACILITY_PATCH_FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value === undefined) {
      delete merged[field as keyof PlanFacility];
    } else {
      merged[field] = value as never;
    }
  }
  return merged;
}

/* ----------------设施 action 实现 ---------------- */

function addFacility(plan: SitePlanData, input: FacilityAddInput): PlanEditResult<SitePlanData> {
  if (!pointInRange(input.position)) {
    return { ok: false, issue: invalidIssue('out-of-range', '设施位置超出平面范围（±5000 m），请先放大地图再放置。') };
  }
  if (input.zoneId !== undefined && !zoneExists(plan, input.zoneId)) {
    return { ok: false, issue: invalidIssue('unknown-zone', '设施归属分区不存在。') };
  }
  if (input.template !== undefined) {
    const templateName = input.template.name.trim();
    if (templateName.length < 1 || templateName.length > 60) {
      return { ok: false, issue: invalidIssue('out-of-range', '动态模板名称需为 1–60 字符。') };
    }
    const { width, depth } = input.template;
    if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0
      || width > PLAN_SIZE_LIMIT_M || depth > PLAN_SIZE_LIMIT_M) {
      return { ok: false, issue: invalidIssue('out-of-range', '动态模板宽深需为正数且不超过 100 m。') };
    }
  }
  const dynamicTemplate = input.template !== undefined
    ? {
        templateId: input.templateId,
        name: input.template.name.trim(),
        width: input.template.width,
        depth: input.template.depth,
        note: input.template.note ?? '物料库模型',
      }
    : undefined;
  const built = buildFacility(
    {
      templateId: input.templateId,
      position: input.position,
      ...(dynamicTemplate !== undefined ? { name: dynamicTemplate.name } : {}),
      ...(input.rotationDeg !== undefined ? { rotationDeg: input.rotationDeg } : {}),
      ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(dynamicTemplate !== undefined ? { template: dynamicTemplate } : {}),
    },
    plan.boundary,
    plan.facilities,
  );
  if (!built.ok) return { ok: false, issue: built.issue };

  const extras: Partial<PlanFacility> = {};
  if (input.sourceAssetId !== undefined) extras.sourceAssetId = input.sourceAssetId;
  if (input.modelOverride !== undefined) extras.modelOverride = input.modelOverride;
  const merged: PlanFacility = { ...built.value, ...extras };
  if (!facilityPassesContract(merged)) {
    return { ok: false, issue: invalidIssue('out-of-range', '设施字段未通过契约校验。') };
  }
  return {
    ok: true,
    value: { ...plan, facilities: [...plan.facilities, merged] },
    ...(built.issues !== undefined ? { issues: built.issues } : {}),
  };
}

function updateFacility(plan: SitePlanData, id: string, patch: FacilityPatch): PlanEditResult<SitePlanData> {
  const source = findFacility(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `设施 ${id} 不存在。`) };

  const { next, dropped, issue } = sanitizeFacilityPatch(patch, plan);
  if (issue) return { ok: false, issue };

  const merged = mergeFacilityPatch(source, next);
  if (!facilityPassesContract(merged)) {
    return { ok: false, issue: invalidIssue('out-of-range', '设施字段未通过契约校验。') };
  }
  const issues: PlanEditIssue[] = dropped.map(key => ({
    code: 'unknown-field' as const,
    message: `字段「${key}」不在设施契约内，已剥离。`,
  }));
  return {
    ok: true,
    value: { ...plan, facilities: plan.facilities.map(f => (f.id === id ? merged : f)) },
    ...(issues.length > 0 ? { issues } : {}),
  };
}

function moveFacility(plan: SitePlanData, id: string, position: PlanPoint): PlanEditResult<SitePlanData> {
  const source = findFacility(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `设施 ${id} 不存在。`) };
  if (!pointInRange(position)) {
    return { ok: false, issue: invalidIssue('out-of-range', '设施位置超出平面范围（±5000 m）。') };
  }
  const moved: PlanFacility = { ...source, position: { x: position.x, y: position.y } };
  return { ok: true, value: { ...plan, facilities: plan.facilities.map(f => (f.id === id ? moved : f)) } };
}

function rotateFacility(plan: SitePlanData, id: string, rotationDeg: number): PlanEditResult<SitePlanData> {
  const source = findFacility(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `设施 ${id} 不存在。`) };
  if (!Number.isFinite(rotationDeg)) {
    return { ok: false, issue: invalidIssue('out-of-range', '设施旋转角度无效。') };
  }
  const clamped = Math.max(-360, Math.min(360, rotationDeg));
  const rotated: PlanFacility = { ...source, rotationDeg: clamped };
  return { ok: true, value: { ...plan, facilities: plan.facilities.map(f => (f.id === id ? rotated : f)) } };
}

function resizeFacility(plan: SitePlanData, id: string, size: { width: number; depth: number }): PlanEditResult<SitePlanData> {
  const source = findFacility(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `设施 ${id} 不存在。`) };
  const { width, depth } = size;
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0
    || width > PLAN_SIZE_LIMIT_M || depth > PLAN_SIZE_LIMIT_M) {
    return { ok: false, issue: invalidIssue('out-of-range', '设施宽深需为正数且不超过 100 m。') };
  }
  const resized: PlanFacility = { ...source, size: { width, depth } };
  return { ok: true, value: { ...plan, facilities: plan.facilities.map(f => (f.id === id ? resized : f)) } };
}

/**
 * 复制为新 uuid：位置沿 +0.5/+0.5 小偏移（对齐 legacy duplicateItem 户外偏移语义）。
 * legacy 口径：副本是松散拷贝——不加入原件分组、起始不锁定（reducer 删除 groupId/locked/handoff）；
 * handoff 本就不是 plan 字段，这里只剥离 groupId 与 locked。
 */
function duplicateFacility(plan: SitePlanData, id: string): PlanEditResult<SitePlanData> {
  const source = findFacility(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `设施 ${id} 不存在。`) };
  const position = { x: source.position.x + 0.5, y: source.position.y + 0.5 };
  if (!pointInRange(position)) {
    return { ok: false, issue: invalidIssue('out-of-range', '复制后的位置超出平面范围（±5000 m）。') };
  }
  const { groupId: _groupId, locked: _locked, id: _sourceId, ...rest } = source;
  const copy: PlanFacility = { ...rest, id: randomId('facility'), position };
  return { ok: true, value: { ...plan, facilities: [...plan.facilities, copy] } };
}

function setFacilityGroup(plan: SitePlanData, ids: readonly string[], groupId?: string): PlanEditResult<SitePlanData> {
  const wanted = new Set(ids);
  const matched = plan.facilities.filter(f => wanted.has(f.id));
  // legacy 口径：分组需要同伴——孤件分组没有意义（reducer 不足 2 件原样返回）。
  if (matched.length < 2) return { ok: true, value: plan };
  const nextGroupId = groupId ?? randomId('group');
  if (nextGroupId.length < 1 || nextGroupId.length > 60) {
    return { ok: false, issue: invalidIssue('out-of-range', '分组号需为 1–60 字符。') };
  }
  return {
    ok: true,
    value: {
      ...plan,
      facilities: plan.facilities.map(f => (wanted.has(f.id) ? { ...f, groupId: nextGroupId } : f)),
    },
  };
}

function clearFacilityGroup(plan: SitePlanData, ids: readonly string[]): PlanEditResult<SitePlanData> {
  const wanted = new Set(ids);
  return {
    ok: true,
    value: {
      ...plan,
      facilities: plan.facilities.map(f => {
        if (!wanted.has(f.id) || f.groupId === undefined) return f;
        const { groupId: _cleared, ...rest } = f;
        return rest;
      }),
    },
  };
}

function setFacilityLocked(plan: SitePlanData, id: string, locked: boolean): PlanEditResult<SitePlanData> {
  const source = findFacility(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `设施 ${id} 不存在。`) };
  const next: PlanFacility = { ...source, locked };
  return { ok: true, value: { ...plan, facilities: plan.facilities.map(f => (f.id === id ? next : f)) } };
}

function setFacilityShape(plan: SitePlanData, id: string, shape: NonNullable<PlanFacility['shape']>): PlanEditResult<SitePlanData> {
  const source = findFacility(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `设施 ${id} 不存在。`) };
  const next: PlanFacility = { ...source, shape };
  return { ok: true, value: { ...plan, facilities: plan.facilities.map(f => (f.id === id ? next : f)) } };
}

function setFacilityFinish(plan: SitePlanData, id: string, finish: NonNullable<PlanFacility['finish']>): PlanEditResult<SitePlanData> {
  const source = findFacility(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `设施 ${id} 不存在。`) };
  const next: PlanFacility = { ...source, finish };
  return { ok: true, value: { ...plan, facilities: plan.facilities.map(f => (f.id === id ? next : f)) } };
}

/** 设施 action 入口：纯函数，返回下一份 plan；找不到 id 时 plan 原样（失败分支不带变更）。 */
export function applyFacilityAction(plan: SitePlanData, action: FacilityAction): PlanEditResult<SitePlanData> {
  switch (action.kind) {
    case 'add':
      return addFacility(plan, action.input);
    case 'remove': {
      if (!findFacility(plan, action.id)) {
        return { ok: false, issue: invalidIssue('not-found', `设施 ${action.id} 不存在。`) };
      }
      return { ok: true, value: { ...plan, facilities: plan.facilities.filter(f => f.id !== action.id) } };
    }
    case 'update':
      return updateFacility(plan, action.id, action.patch);
    case 'move':
      return moveFacility(plan, action.id, action.position);
    case 'rotate':
      return rotateFacility(plan, action.id, action.rotationDeg);
    case 'resize':
      return resizeFacility(plan, action.id, action.size);
    case 'duplicate':
      return duplicateFacility(plan, action.id);
    case 'setGroup':
      return setFacilityGroup(plan, action.ids, action.groupId);
    case 'clearGroup':
      return clearFacilityGroup(plan, action.ids);
    case 'setLocked':
      return setFacilityLocked(plan, action.id, action.locked);
    case 'setShape':
      return setFacilityShape(plan, action.id, action.shape);
    case 'setFinish':
      return setFacilityFinish(plan, action.id, action.finish);
  }
}

/* ---------------- 分区 action 实现 ---------------- */

function zonePatchDroppedKeys(patch: ZonePatch): string[] {
  const whitelist = new Set<string>(ZONE_PATCH_FIELDS);
  return Object.keys(patch).filter(key => !whitelist.has(key));
}

function addZone(plan: SitePlanData, input: ZoneAddInput): PlanEditResult<SitePlanData> {
  if (input.levelId !== undefined && !levelExists(plan, input.levelId)) {
    return { ok: false, issue: invalidIssue('not-found', '分区所属图层不存在。') };
  }
  const built = buildZone(
    {
      semantic: input.semantic,
      name: input.name,
      polygon: input.polygon,
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    plan.boundary,
    plan.zones,
  );
  if (!built.ok) return { ok: false, issue: built.issue };

  const extras: Partial<PlanZone> = {};
  if (input.event !== undefined) extras.event = input.event;
  if (input.environment !== undefined) extras.environment = input.environment;
  if (input.purpose !== undefined) extras.purpose = input.purpose;
  if (input.levelId !== undefined) extras.levelId = input.levelId;
  const merged: PlanZone = { ...built.value, ...extras };
  if (!planZoneSchema.safeParse(merged).success) {
    return { ok: false, issue: invalidIssue('out-of-range', '分区字段未通过契约校验。') };
  }
  return {
    ok: true,
    value: { ...plan, zones: [...plan.zones, merged] },
    ...(built.issues !== undefined ? { issues: built.issues } : {}),
  };
}

function updateZone(plan: SitePlanData, id: string, patch: ZonePatch): PlanEditResult<SitePlanData> {
  const source = findZone(plan, id);
  if (!source) return { ok: false, issue: invalidIssue('not-found', `分区 ${id} 不存在。`) };

  const dropped = zonePatchDroppedKeys(patch);
  const next: Partial<PlanZone> = {};
  for (const field of ZONE_PATCH_FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value === undefined) continue;
    next[field] = value as never;
  }

  if (next.polygon !== undefined) {
    const check = checkPlanRing(next.polygon, PLAN_MIN_ZONE_AREA_M2, `分区「${source.name}」`);
    if (!check.ok) return { ok: false, issue: check.issue };
  }
  if (next.name !== undefined && (next.name.length < 1 || next.name.length > 60)) {
    return { ok: false, issue: invalidIssue('out-of-range', '分区名称需为 1–60 字。') };
  }
  if (next.color !== undefined && !HEX_COLOR.test(next.color)) {
    return { ok: false, issue: invalidIssue('out-of-range', '分区颜色需为 #RRGGBB 十六进制色值。') };
  }
  if (next.opacity !== undefined && (!Number.isFinite(next.opacity) || next.opacity < 0 || next.opacity > 1)) {
    return { ok: false, issue: invalidIssue('out-of-range', '分区透明度需在 0–1 之间。') };
  }
  if (next.levelId !== undefined && !levelExists(plan, next.levelId)) {
    return { ok: false, issue: invalidIssue('not-found', '分区所属图层不存在。') };
  }

  const merged: PlanZone = { ...source, ...next };
  if (!planZoneSchema.safeParse(merged).success) {
    return { ok: false, issue: invalidIssue('out-of-range', '分区字段未通过契约校验。') };
  }
  const issues: PlanEditIssue[] = dropped.map(key => ({
    code: 'unknown-field' as const,
    message: `字段「${key}」不在分区契约内，已剥离。`,
  }));
  return {
    ok: true,
    value: { ...plan, zones: plan.zones.map(z => (z.id === id ? merged : z)) },
    ...(issues.length > 0 ? { issues } : {}),
  };
}

/** 分区 action 入口：纯函数，返回下一份 plan；找不到 id 时 plan 原样（失败分支不带变更）。 */
export function applyZoneAction(plan: SitePlanData, action: ZoneAction): PlanEditResult<SitePlanData> {
  switch (action.kind) {
    case 'add':
      return addZone(plan, action.input);
    case 'remove': {
      if (!findZone(plan, action.id)) {
        return { ok: false, issue: invalidIssue('not-found', `分区 ${action.id} 不存在。`) };
      }
      return { ok: true, value: { ...plan, zones: plan.zones.filter(z => z.id !== action.id) } };
    }
    case 'update':
      return updateZone(plan, action.id, action.patch);
  }
}
