/**
 * 户外项目本地存取层（Phase 2 · P2-a：项目体系分支 + 「从地图开始」）。
 *
 * 户外项目 = 项目体系里「从地图开始」的项目：打开时默认进 2D 规划工作台
 * （OutdoorPlanWorkspace），不挂室内 RoomOrganizer。判定与草稿都按 projectId
 * 落 localStorage（单 key 信封）：
 * - meta：名称/创建时间——**存在即认定这是户外项目**（workspace-shell 据此分支）；
 * - plan：SitePlanData（schema 严格校验；坏数据宽容回落 null，上层用起步 plan）。
 *
 * 与 site-plan-store 的关系：那是「版本化子资源 + 并发冲突」的契约层（云端表
 * 接线后沿用），本层是 Phase 2 的本机草稿实现，保存态如实标「本机草稿」——
 * 云端子资源表归 B 评审（评审稿 §7.1），接入后本层可平移到 IndexedDB/云端。
 *
 * storage 参数注入以便 node 环境测试；缺省 window.localStorage（SSR 不落盘）。
 */

import {
  sitePlanDataSchema,
  type PlanAnchor,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';

/** 最小存储面：测试用 Map mock 即可满足。 */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 单 key 信封：meta + plan 一起存，读一个 key 就能同时完成「判定 + 载入」。 */
export interface OutdoorProjectRecord {
  v: 1;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** 本机最新规划数据；null = 尚未落盘（新项目起步由上层工厂生成）。 */
  plan: SitePlanData | null;
}

function safeDefaultStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null; // 隐私模式/存储被禁：读写静默降级，编辑仍可用（刷新后回起步）。
  }
}

/** 按项目隔离的存储 key。前缀带 v1，将来信封结构演进时换前缀迁移。 */
export function outdoorPlanStorageKey(projectId: string): string {
  return `scendance-outdoor-plan-v1:${projectId}`;
}

/** 宽容读取：JSON 坏/信封不符返回 null；plan 字段坏只把 plan 回落 null（meta 仍有效）。 */
export function readOutdoorProjectRecord(projectId: string, storage?: KeyValueStorage | null): OutdoorProjectRecord | null {
  const store = storage ?? safeDefaultStorage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(outdoorPlanStorageKey(projectId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      (parsed as { v?: unknown }).v === 1 &&
      (parsed as { projectId?: unknown }).projectId === projectId
    ) {
      const record = parsed as OutdoorProjectRecord;
      if (typeof record.name !== 'string' || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') return null;
      let plan: SitePlanData | null = null;
      if (record.plan != null) {
        const verified = sitePlanDataSchema.safeParse(record.plan);
        plan = verified.success ? verified.data : null;
      }
      return { ...record, plan };
    }
    return null;
  } catch {
    return null;
  }
}

/** 存在即户外项目：meta 有效就算（plan 可为 null）。 */
export function hasOutdoorPlanDraft(projectId: string, storage?: KeyValueStorage | null): boolean {
  return readOutdoorProjectRecord(projectId, storage) !== null;
}

/**
 * 写整份记录：plan 严格过 sitePlanDataSchema（最后防线——上层 plan 来自画布
 * 编辑层本就合法）。名字/时间戳由调用方给；createdAt 想保留请传旧值。
 */
export function saveOutdoorProjectRecord(record: OutdoorProjectRecord, storage?: KeyValueStorage | null): void {
  if (record.plan != null) {
    const verified = sitePlanDataSchema.parse(record.plan);
    record = { ...record, plan: verified };
  }
  const store = storage ?? safeDefaultStorage();
  if (!store) return; // 存储不可用：静默降级（编辑仍可用，刷新不保留）。
  try {
    store.setItem(outdoorPlanStorageKey(record.projectId), JSON.stringify(record));
  } catch {
    // 配额满/隐私模式：静默降级，不阻断编辑。
  }
}

/** 只改名字（顶栏活动名）：保留 createdAt 与 plan，updatedAt 刷新。记录不存在时不无中生有。 */
export function renameOutdoorProject(projectId: string, name: string, storage?: KeyValueStorage | null): void {
  const record = readOutdoorProjectRecord(projectId, storage);
  if (!record) return;
  saveOutdoorProjectRecord({ ...record, name, updatedAt: new Date().toISOString() }, storage);
}

/** 删除本机草稿（测试/用户清库用；云端项目本体不受影响）。 */
export function clearOutdoorProjectRecord(projectId: string, storage?: KeyValueStorage | null): void {
  const store = storage ?? safeDefaultStorage();
  if (!store) return;
  try {
    store.removeItem(outdoorPlanStorageKey(projectId));
  } catch {
    // 静默降级。
  }
}

/**
 * 户外分支判定（workspace-shell 开工前调用）：
 * - `?project=<id>&start=outdoor`（venue-picker「从地图开始」硬跳）→ 户外；
 * - `?project=<id>` 且本机有户外草稿（再次打开户外项目）→ 户外；
 * - 其余（无参数 / 室内项目）→ null，走既有室内工作台。
 */
export function resolveOutdoorProjectId(search: string, storage?: KeyValueStorage | null): string | null {
  // 归一化：调用方可能传 window.location.search（"?project=…"）、完整 URL 或路径带参——
  // URLSearchParams 只认纯 query，取最后一个 "?" 起的部分解析。
  const query = search.includes('?') ? search.slice(search.lastIndexOf('?')) : search;
  const params = new URLSearchParams(query);
  const projectId = params.get('project')?.trim() ?? '';
  if (!projectId) return null;
  if (params.get('start') === 'outdoor') return projectId;
  return hasOutdoorPlanDraft(projectId, storage) ? projectId : null;
}

/**
 * 起步规划：100 × 60 m 矩形场地（中心在原点），其余实体为空。
 * 传 anchor（创建活动时选的地点）则带上地理锚点，2D 一打开就是该地点的地图；
 * 不传则锚点缺省，画布走纸面格网（室内/未选地点）。boundary 契约必填 3–64 点，
 * 起步矩形让用户打开即可拖顶点改边界，而不是面对空画布无从下手。
 */
export function createStarterOutdoorPlan(anchor?: PlanAnchor): SitePlanData {
  return {
    schemaVersion: 1,
    ...(anchor ? { anchor } : {}),
    boundary: [
      { x: -50, y: -30 },
      { x: 50, y: -30 },
      { x: 50, y: 30 },
      { x: -50, y: 30 },
    ],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
  };
}
