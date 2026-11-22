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
  /** 2026-11-17：后端发号的活动 id（跨设备身份）。未同步时为空。 */
  remoteActivityId?: string;
  /** 本机已同步到的后端版本号；后端 revision 不匹配即冲突，不静默覆盖。 */
  remoteRevision?: number;
  /**
   * 2026-11-20（审计 B1/F9）：盘上这份 plan 还没被云端确认过。
   * 关页/隐藏时只做本机落盘、不再等在途推送，靠这个标记让下次打开补推一次；
   * 内容与盘上完全一致的「干净打开」不写盘也不推送，避免每次打开都把版本 +1。
   */
  unsyncedPlan?: boolean;
}

/**
 * 本机落盘结果（对齐 `persistence.ts` 的 `SaveResult`：写不进去就要说写不进去）。
 * `unavailable` = 没有可用存储（SSR/隐私模式/被禁），`quota` = 配额满，`unknown` = 其它异常。
 * plan 不合法仍然**抛错**——那是上层构造出的坏数据，属于程序缺陷，不该被当成「暂时写不进去」。
 */
export type OutdoorSaveFailureReason = 'unavailable' | 'quota' | 'unknown';
export type OutdoorSaveResult = { ok: true } | { ok: false; reason: OutdoorSaveFailureReason };

function storageFailureReason(error: unknown): OutdoorSaveFailureReason {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    const code = (error as { code?: unknown }).code;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return 'quota';
  }
  return 'unknown';
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

/**
 * 户外保存态上报/订阅 scope（2026-11-20 审计 B2）：必须和消费方同口径。
 * 云面板订阅的是 `layout.id ?? 'local'`（panels/cloud-panel.tsx）；
 * 覆盖层以前用存储槽 `projectId || 'local-draft'` 当 scope，没有 id 时两边就对不上，
 * 于是「本机存失败 / 云端未同步」只能写进一个没人订阅的分区。这里统一成同一个口径。
 * 注意：它只是状态机的 scope，不是存储 key——空 id 的草稿仍落在 LOCAL_DRAFT_SLOT。
 */
export function outdoorSaveScope(projectId: string | null | undefined): string {
  const id = projectId?.trim();
  return id || 'local';
}

/**
 * 结构相等：忽略对象键序，只判内容。
 * 用途：判断「盘上那一版」与「要写的这一版」是不是同一份内容——
 * 打开项目时内容没变就不该写盘（F9），推送回执也不该拿旧快照盖新版。
 */
export function samePlanContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => samePlanContent(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    // 可选字段显式设为 undefined 和省略该字段落盘后相同，不应制造历史或待同步改动。
    const keys = Object.keys(left).filter(key => left[key] !== undefined);
    if (keys.length !== Object.keys(right).filter(key => right[key] !== undefined).length) return false;
    return keys.every(key => Object.hasOwn(right, key) && samePlanContent(left[key], right[key]));
  }
  return false;
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
 *
 * 活动级规划（2026-11-17）用 `trackLastProject=false`：那条 key 属于某个活动，
 * 不是工作台要续开的项目，不能顶掉「最近项目」指针。
 */
export function saveOutdoorProjectRecord(record: OutdoorProjectRecord, storage?: KeyValueStorage | null,
  trackLastProject = true): OutdoorSaveResult {
  if (record.plan != null) {
    const verified = sitePlanDataSchema.parse(record.plan);
    record = { ...record, plan: verified };
  }
  const store = storage ?? safeDefaultStorage();
  if (!store) return { ok: false, reason: 'unavailable' }; // 存储不可用：编辑仍可用，但必须如实上报没落盘。
  try {
    store.setItem(outdoorPlanStorageKey(record.projectId), JSON.stringify(record));
  } catch (error) {
    // 配额满/隐私模式：不阻断编辑，但这次改动确实没存下来——由上层决定怎么提示。
    return { ok: false, reason: storageFailureReason(error) };
  }
  // 「最近活动」指针：`/` 无参数时续上次用（见 latestOutdoorProjectId）。
  // 指针写失败不影响「这份规划已落盘」的事实，只影响续开入口，因此单独吞掉。
  if (trackLastProject) {
    try { store.setItem(OUTDOOR_LAST_PROJECT_KEY, record.projectId); } catch { /* 续开入口退化，不改变已落盘结果 */ }
  }
  return { ok: true };
}

/**
 * 只更新云端身份字段（发号 id / 版本号 / 待同步标记），**不碰 plan**。
 *
 * 2026-11-20（审计 B2/B6）：推送回执写回本机记录时，旧实现整份覆盖成「推送那一刻」的快照；
 * 请求在途期间若又存过一版新 plan，回执就把盘上的新 plan 退回旧版（刷新即丢最新改动）。
 * 回执只该改版本指针，因此这里重读当前记录再合并。
 */
export function patchOutdoorProjectRemote(projectId: string, patch: {
  remoteActivityId?: string;
  remoteRevision?: number;
  unsyncedPlan?: boolean;
}, storage?: KeyValueStorage | null): OutdoorSaveResult {
  const record = readOutdoorProjectRecord(projectId, storage);
  if (!record) return { ok: false, reason: 'unavailable' };
  const next: OutdoorProjectRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
    ...(patch.remoteActivityId ? { remoteActivityId: patch.remoteActivityId } : {}),
    ...(typeof patch.remoteRevision === 'number' ? { remoteRevision: patch.remoteRevision } : {}),
    ...(typeof patch.unsyncedPlan === 'boolean' ? { unsyncedPlan: patch.unsyncedPlan } : {}),
  };
  return saveOutdoorProjectRecord(next, storage, false);
}

/** 只改名字（顶栏活动名）：保留 createdAt 与 plan，updatedAt 刷新。记录不存在时不无中生有。 */
export function renameOutdoorProject(projectId: string, name: string, storage?: KeyValueStorage | null): void {
  const record = readOutdoorProjectRecord(projectId, storage);
  if (!record) return;
  saveOutdoorProjectRecord({ ...record, name, updatedAt: new Date().toISOString() }, storage);
}

/** 删除本机草稿（测试/用户清库用；云端项目本体不受影响）。 */
/** 2026-11-19：「存为方案」后地图规划跟着新项目走。只复制，不删本机草稿的槽位。 */
export function copyOutdoorProjectRecord(fromId: string, toId: string, storage?: KeyValueStorage | null): boolean {
  if (!fromId || !toId || fromId === toId) return false;
  const record = readOutdoorProjectRecord(fromId, storage);
  if (!record) return false;
  try {
    return saveOutdoorProjectRecord({ ...record, projectId: toId, updatedAt: new Date().toISOString() }, storage).ok;
  } catch { return false; }
}

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
 * - 其余（无参数 / 仅 mode=outdoor）→ null，由 shell 续最近项目、枚举本机活动或起步默认草稿。
 */
export function resolveOutdoorProjectId(search: string, storage?: KeyValueStorage | null): string | null {
  // 归一化：调用方可能传 window.location.search（"?project=…"）、完整 URL 或路径带参——
  // URLSearchParams 只认纯 query，取最后一个 "?" 起的部分解析。
  const query = search.includes('?') ? search.slice(search.lastIndexOf('?')) : search;
  const params = new URLSearchParams(query);
  const explicitMode = params.get('mode');
  const projectId = params.get('project')?.trim() ?? '';
  if (explicitMode === 'outdoor') {
    // 显式地图入口：没给 project 时不在这里越权起默认草稿，交回壳体兜底——
    // 否则壳体的最近项目 / 本机活动枚举会被这份 default-outdoor 短路，刷新续不回旧活动。
    return projectId || null;
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

/** 枚举存储里的键：优先标准 Storage 的 `length`/`key()`；否则退回对象自有可枚举键。 */
function listStorageKeys(store: KeyValueStorage): string[] {
  const indexed = store as KeyValueStorage & { length?: number; key?: (index: number) => string | null };
  if (typeof indexed.length === 'number' && typeof indexed.key === 'function') {
    const keys: string[] = [];
    for (let i = 0; i < indexed.length; i++) {
      const key = indexed.key(i);
      if (key) keys.push(key);
    }
    return keys;
  }
  return Object.keys(store);
}

/**
 * 列出本机全部 plan 草稿记录（按 `updatedAt` 降序，同时间按 id 字典序）。
 *
 * 这是 plan 侧草稿索引身份恢复的地基（B1-b 解除条件）：本机活动 `house-*` 刻意不顶
 * 最近指针，无参刷新时不能只靠 `latestOutdoorProjectId` 召回；恢复身份应从这份 plan
 * 草稿索引取，而不是借室内 layout 单槽反推。当前只提供枚举读取，shell 恢复策略另立。
 * 非本前缀的指针/接管标记等元键自然被过滤；坏信封宽容跳过。
 */
export function listOutdoorProjectRecords(storage?: KeyValueStorage | null): OutdoorProjectRecord[] {
  const store = storage ?? safeDefaultStorage();
  if (!store) return [];
  const prefix = outdoorPlanStorageKey('');
  const records: OutdoorProjectRecord[] = [];
  let keys: string[];
  try {
    keys = listStorageKeys(store);
  } catch {
    return [];
  }
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const projectId = key.slice(prefix.length);
    if (!projectId) continue;
    const record = readOutdoorProjectRecord(projectId, store);
    if (record) records.push(record);
  }
  records.sort((a, b) =>
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.projectId.localeCompare(b.projectId));
  return records;
}

/** 本机新建活动的 id 前缀（`withHouseId` 发号，见 `lib/ids.ts`）。 */
export const LOCAL_ACTIVITY_ID_PREFIX = 'house-';

/**
 * 无参刷新兜底选取：最近编辑的本机活动草稿。
 *
 * 本机活动 `house-*` 刻意不顶「最近项目」指针、URL 也不带 `project=`；指针缺失时
 * 从草稿索引里把它找回来，会话槽 / 卡片槽才能接回同一份历史。只认 `house-*`：
 * `replica-*` 案例副本与云项目走指针 / URL 兜底，不在这里抢续。枚举已按 updatedAt
 * 降序，取首条命中即可。
 */
export function latestLocalActivityRecord(storage?: KeyValueStorage | null): OutdoorProjectRecord | null {
  for (const record of listOutdoorProjectRecords(storage)) {
    if (record.projectId.startsWith(LOCAL_ACTIVITY_ID_PREFIX)) return record;
  }
  return null;
}

/**
 * 无参 / 弱参刷新的兜底身份选取（壳体开工前调用）。
 *
 * - 最近指针指向云项目 / 案例副本 / 本机活动 → 续那个 projectId；
 * - 指针缺失，或指针只是纯起步草稿 `default-outdoor` → 让位给最近编辑的本机 `house-*` 活动；
 *   空草稿不该把更近编辑过的本机活动短路掉，否则刷新会话槽漂移、历史接不回；
 * - 都没有 → 起步默认草稿。
 */
export function resolveFallbackOutdoorProject(storage?: KeyValueStorage | null): string {
  const last = latestOutdoorProjectId(storage);
  if (last && last !== DEFAULT_OUTDOOR_PROJECT_ID) return last;
  const local = latestLocalActivityRecord(storage);
  if (local) return local.projectId;
  return ensureDefaultOutdoorProject(storage);
}

/**
 * 默认户外工作台 id（2026-11-11 用户拍板：`/` 无参数时直接进户外 2D 规划，
 * 起步概览西湖区，找场地是工作台里的"搜地点"能力，不该挡在入口前面）。
 * 它是纯本机草稿——不进云端，不进 projects 列表。用户正式建项目时会在 VenuePicker
 * 里起新的云端项目并把它重命名。
 */
export const DEFAULT_OUTDOOR_PROJECT_ID = 'default-outdoor';

/**
 * 活动级规划的接管标记（2026-11-17）：升级前所有本机活动共用 `default-outdoor` 这一份规划。
 * 新版按活动存规划，第一次挂载时把这份旧规划交给当时打开的那个活动，之后不再重复接管——
 * 否则以后每建一个空活动都会“继承”上一份规划，看起来就像复制了当前项目。
 */
export const OUTDOOR_PLAN_ACTIVITY_ADOPTED_KEY = 'scendance-outdoor-plan-activity-adopted-v1';

/**
 * 把一个旧版共用的规划记录一次性交给指定活动。
 * 只在该活动还没有自己的记录、且本机从未接管过时执行；返回是否接管。
 */
export function adoptLegacyOutdoorPlanForActivity(activityId: string, legacyProjectId: string,
  storage?: KeyValueStorage | null): boolean {
  const store = storage ?? safeDefaultStorage();
  const activity = activityId.trim(), legacy = legacyProjectId.trim();
  if (!store || !activity || !legacy || activity === legacy) return false;
  try {
    if (store.getItem(OUTDOOR_PLAN_ACTIVITY_ADOPTED_KEY)) return false;
    if (store.getItem(outdoorPlanStorageKey(activity))) return false;
    const source = readOutdoorProjectRecord(legacy, store);
    if (!source) return false;
    saveOutdoorProjectRecord({ ...source, projectId: activity, updatedAt: new Date().toISOString() }, store, false);
    store.setItem(OUTDOOR_PLAN_ACTIVITY_ADOPTED_KEY, activity);
    return true;
  } catch {
    return false;
  }
}

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
 * 「杭州市西湖区」全域概览中心，GCJ-02，source 'preset'（产品预置，不是实测）。
 * 参考区政府规划中的区境范围，取近似中心用于浏览，不代表已选定活动地点：
 * https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web1838/site/attach/0/d9db6d0699c441728895c8cedf7c7a2e.pdf
 * 用户重新选址（picker/lookup）后会被真实锚点覆盖。
 */
export const DEFAULT_OUTDOOR_PLAN_ANCHOR: PlanAnchor = {
  lng: 120.085,
  lat: 30.215,
  crs: 'gcj-02',
  source: 'preset',
};

/** 空白项目先看西湖区全域，选址或已有布置后使用各自的场地视角。 */
export const DEFAULT_OUTDOOR_OVERVIEW_ZOOM = 11;

/**
 * 起步规划：零边界起步（2026-11-11 用户拍板「新建项目先不要一上来就开一个场地边界」——
 * 起步矩形反而制造越界误报），其余实体为空。传 anchor（创建活动时选的地点）则带上地理锚点，
 * 2D 一打开就是该地点的地图；不传则落 DEFAULT_OUTDOOR_PLAN_ANCHOR（西湖区预置中心）——
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
