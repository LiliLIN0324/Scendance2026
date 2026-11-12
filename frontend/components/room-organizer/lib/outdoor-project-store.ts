/**
 * 地图项目本地存取层（项目体系分支 + 「从地图开始」）。
 *
 * 所有项目统一进地图工作台，不再区分室内/户外。判定与草稿都按 projectId
 * 落 localStorage（单 key 信封）：
 * - meta：名称/创建时间——存在即认定该项目有本机草稿（workspace-shell 据此续载）；
 * - plan：SitePlanData（schema 严格校验；坏数据宽容回落 null，上层用起步 plan）。
 *
 * 与 site-plan-store 的关系：那是「版本化子资源 + 并发冲突」的契约层（云端表
 * 接线后沿用），本层是本机草稿实现，保存态如实标「本机草稿」——
 * 云端子资源表接入后本层可平移到 IndexedDB/云端。
 *
 * storage 参数注入以便 node 环境测试；缺省 window.localStorage（SSR 不落盘）。
 */

import {
  sitePlanDataSchema,
  type PlanAnchor,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { XIHU_LOCAL_CENTER } from './research-area';

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
    // 「最近活动」指针：`/` 无参数时续上次用（见 latestOutdoorProjectId）。
    store.setItem(OUTDOOR_LAST_PROJECT_KEY, record.projectId);
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
    if (store.getItem(OUTDOOR_LAST_PROJECT_KEY) === projectId) store.removeItem(OUTDOOR_LAST_PROJECT_KEY);
  } catch {
    // 静默降级。
  }
}

/**
 * 项目解析（workspace-shell 开工前调用）：所有项目统一进地图工作台，不再区分室内/户外。
 * - `?project=<id>&mode=outdoor` 或 `?project=<id>&start=outdoor` → 显式地图入口；
 * - `?project=<id>` 过渡期按本机草稿嗅探（旧链接兼容）；
 * - 其余（无参数）→ null，由 shell 续最近项目或起步默认草稿。
 */
export function resolveOutdoorProjectId(search: string, storage?: KeyValueStorage | null): string | null {
  // 归一化：调用方可能传 window.location.search（"?project=…"）、完整 URL 或路径带参——
  // URLSearchParams 只认纯 query，取最后一个 "?" 起的部分解析。
  const query = search.includes('?') ? search.slice(search.lastIndexOf('?')) : search;
  const params = new URLSearchParams(query);
  const explicitMode = params.get('mode');
  const projectId = params.get('project')?.trim() ?? '';
  if (explicitMode === 'outdoor') {
    // 显式地图入口——没给 project 就用默认本机草稿（起步锚点平湖秋月），
    // 不再强依赖 URL 上 project=。workspace-shell 根路径无参数时也这么走。
    return projectId || ensureDefaultOutdoorProject(storage);
  }
  if (!projectId) return null;
  if (params.get('start') === 'outdoor') return projectId;
  // 旧 `?project=`（无 mode）过渡期仍按本机草稿嗅探；新入口一律带 mode，后续连同这段嗅探一起删除。
  return hasOutdoorPlanDraft(projectId, storage) ? projectId : null;
}

/** 最近动过的户外项目 id（`/` 无参数时「续上次」用）；没有户外记录时 null。 */
export const OUTDOOR_LAST_PROJECT_KEY = 'scendance-outdoor-last-v1';

export function latestOutdoorProjectId(storage?: KeyValueStorage | null): string | null {
  const store = storage ?? safeDefaultStorage();
  if (!store) return null;
  try {
    const id = store.getItem(OUTDOOR_LAST_PROJECT_KEY)?.trim() ?? '';
    return id || null;
  } catch {
    return null;
  }
}

/** 视角记忆（2026-11-11 用户拍板：按项目记住上次是 2D 还是 3D）。 */
export type OutdoorPlanView = '2d' | '3d';

export function outdoorPlanViewStorageKey(projectId: string): string {
  return `scendance-outdoor-view-v1:${projectId}`;
}

export function readOutdoorPlanView(projectId: string, storage?: KeyValueStorage | null): OutdoorPlanView | null {
  const store = storage ?? safeDefaultStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(outdoorPlanViewStorageKey(projectId));
    return raw === '2d' || raw === '3d' ? raw : null;
  } catch {
    return null;
  }
}

export function saveOutdoorPlanView(projectId: string, view: OutdoorPlanView, storage?: KeyValueStorage | null): void {
  const store = storage ?? safeDefaultStorage();
  if (!store) return;
  try {
    store.setItem(outdoorPlanViewStorageKey(projectId), view);
  } catch {
    // 静默降级：视角记忆失败不影响编辑。
  }
}

/**
 * 默认户外工作台 id（2026-11-11 用户拍板：`/` 无参数时直接进户外 2D 规划，
 * 起步锚点平湖秋月，找场地是工作台里的"搜地点"能力，不该挡在入口前面）。
 * 它是纯本机草稿——不进云端，不进 projects 列表。用户正式建项目时会在 VenuePicker
 * 里起新的云端项目并把它重命名。
 */
export const DEFAULT_OUTDOOR_PROJECT_ID = 'default-outdoor';

/** 确保默认户外工作台的本机草稿存在；返回它的 id。 */
export function ensureDefaultOutdoorProject(storage?: KeyValueStorage | null): string {
  const existing = readOutdoorProjectRecord(DEFAULT_OUTDOOR_PROJECT_ID, storage);
  if (existing) return DEFAULT_OUTDOOR_PROJECT_ID;
  const now = new Date().toISOString();
  saveOutdoorProjectRecord({
    v: 1,
    projectId: DEFAULT_OUTDOOR_PROJECT_ID,
    name: '新活动场地',
    createdAt: now,
    updatedAt: now,
    plan: createStarterOutdoorPlan(),
  }, storage);
  return DEFAULT_OUTDOOR_PROJECT_ID;
}

/**
 * 默认地理锚点（2026-11-11 用户拍板：户外规划默认有地理位置）：
 * 「西湖 · 平湖秋月」，GCJ-02，来源如实标 'preset'（产品预置，不是实测）。
 * 用户重新选址（picker/lookup）后会被真实锚点覆盖。
 */
export const DEFAULT_OUTDOOR_PLAN_ANCHOR: PlanAnchor = {
  lng: XIHU_LOCAL_CENTER.lng,
  lat: XIHU_LOCAL_CENTER.lat,
  crs: 'gcj-02',
  source: 'preset',
};

/**
 * 起步规划：零边界起步（2026-11-11 用户拍板「新建项目先不要一上来就开一个场地边界」——
 * 起步矩形反而制造越界误报），其余实体为空。传 anchor（创建活动时选的地点）则带上地理锚点，
 * 2D 一打开就是该地点的地图；不传则落 DEFAULT_OUTDOOR_PLAN_ANCHOR（平湖秋月预置锚点）——
 * 默认铺真地图。用户从物件库「场地边界（重画）」画完闭合才写入边界。
 */
export function createStarterOutdoorPlan(anchor?: PlanAnchor): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: anchor ?? DEFAULT_OUTDOOR_PLAN_ANCHOR,
    boundary: [],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
  };
}
