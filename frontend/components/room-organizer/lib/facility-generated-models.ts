/**
 * V-5b/c（2026-11-13）：设施「生成/导入 3D 模型」的会话注册表与任务链接。
 *
 * 三块职责，全部只依赖 localStorage + 模块态（不引 react/three，plan-facility-models
 * 的「纯 lib」纪律靠这条保持；重依赖只在轮询发生时动态进包）：
 * 1. 生成模型注册表：生成完/导入完的模型变成 FacilityModelCandidate 形状的候选，
 *    回填属性卡候选首位；3D 侧 loadFacilityModelOverride 按 slug 从这里兜底解析。
 * 2. staged 链接：画布属性卡点「生成一个」时记一条「这炉生成是给哪个设施的」，
 *    左栏 MaterialCreateCell 直连提交成功那一刻消费掉，落成 taskid↔facility 链接。
 *    10 分钟新鲜期：staged 之后用户去物料库自己另起一炉，不该错挂到旧设施上。
 * 3. resolve：画布属性卡按 15s 轮询任务详情，完成后 loadAholoCatalogItem 落盘入库
 *    （幂等：物料库轮询先到也复用同一份本机资产），注册候选 + 删链接。
 *    待取回卡片（material-generate pending）的生命周期仍归物料库轮询管，这里不碰。
 */

/** 本机导入的 GLB（缓存键 `local-glb:*`）只在本会话有效，不持久化。 */
export interface GeneratedFacilityModel {
  projectId?: string;
  /** `generated:<taskid>`（生成）或 `generated:<local-glb key>`（导入）。 */
  slug: string;
  name: string;
  /** 可直接给 GLTFLoader 的地址；生成件是本机落盘的稳定地址，导入件是会话缓存键。 */
  glbUrl: string;
  /** 米制实测尺寸（GLB 包围盒量出来的），用于按 2D 占地缩放。 */
  width: number;
  depth: number;
  height: number;
  facilityId: string;
  facilityName: string;
  createdAt: number;
  sessionOnly?: boolean;
}

const REGISTRY_KEY = 'scendance:facility-generated-models';
const REGISTRY_LIMIT = 2000; // 与单份计划设施上限一致，不在第21个模型时悄悄丢已选模型。

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** 持久化只收 http(s) 稳定地址的生成件；会话键（local-glb:*）进不了盘，重载自然失效。 */
function isPersistedModel(value: unknown): value is GeneratedFacilityModel {
  const model = value as GeneratedFacilityModel;
  return Boolean(model)
    && typeof model.slug === 'string' && model.slug.startsWith('generated:')
    && typeof model.name === 'string' && Boolean(model.name)
    && typeof model.glbUrl === 'string' && isHttpUrl(model.glbUrl)
    && [model.width, model.depth, model.height].every(
      size => typeof size === 'number' && Number.isFinite(size) && size > 0,
    )
    && typeof model.facilityId === 'string' && Boolean(model.facilityId)
    && typeof model.facilityName === 'string'
    && typeof model.createdAt === 'number' && Number.isFinite(model.createdAt);
}

function readRegistry(): GeneratedFacilityModel[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw: unknown = JSON.parse(store.getItem(REGISTRY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isPersistedModel).slice(0, REGISTRY_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeRegistry(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(REGISTRY_KEY, JSON.stringify(
      models.filter(item => !item.sessionOnly && isHttpUrl(item.glbUrl)).slice(0, REGISTRY_LIMIT),
    ));
  } catch {
    /* 存不下只丢持久化候选，会话内照常用。 */
  }
}

let models: GeneratedFacilityModel[] = readRegistry();
let registryRevision = 0;
const registryListeners = new Set<() => void>();

function emitRegistry(): void {
  registryRevision += 1;
  for (const listener of [...registryListeners]) listener();
}

/** 订阅口：画布属性卡用 useSyncExternalStore 挂 revision，注册变化时候选网格实时重排。 */
export function subscribeGeneratedFacilityModels(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => { registryListeners.delete(listener); };
}

export function getGeneratedFacilityModelsRevision(): number {
  return registryRevision;
}

/** 新生成的排最前（候选回填首位）；指定 facilityId 时只给该设施的。 */
export function listGeneratedFacilityModels(facilityId?: string, projectId?: string): GeneratedFacilityModel[] {
  const all = models.filter(model => !projectId || !model.projectId || model.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  return facilityId ? all.filter(model => model.facilityId === facilityId) : all;
}

/** 3D 侧按 slug 兜底解析（loadFacilityModelOverride 的第一优先级）。 */
export function findGeneratedFacilityModel(slug: string): GeneratedFacilityModel | null {
  return models.find(model => model.slug === slug) ?? null;
}

export function registerGeneratedFacilityModel(model: GeneratedFacilityModel): void {
  // 同 slug 重注册（重复导入/重复轮询）就地替换；上限截断丢最旧。
  models = [model, ...models.filter(item => item.slug !== model.slug)].slice(0, REGISTRY_LIMIT);
  writeRegistry();
  emitRegistry();
}

export function clearGeneratedFacilityModelsForTests(): void {
  models = [];
  stagedLink = null;
  links = readLinks();
  writeRegistry();
  emitRegistry();
  emitLinks();
}

// ---------------------------------------------------------------------------
// staged 链接：画布属性卡点「生成一个」→ 左栏生成框提交成功 → taskid↔facility 链接
// ---------------------------------------------------------------------------

export interface StagedFacilityGenerateLink {
  facilityId: string;
  facilityName: string;
  stagedAt: number;
}

const LINK_FRESH_MS = 10 * 60 * 1000;

let stagedLink: StagedFacilityGenerateLink | null = null;

export function recordFacilityGenerateLink(input: { facilityId: string; facilityName: string }): void {
  const facilityId = input.facilityId.trim();
  if (!facilityId) return;
  stagedLink = { facilityId, facilityName: input.facilityName.trim() || '所选设施', stagedAt: Date.now() };
}

/**
 * 直连提交成功那一刻由 MaterialCreateCell 调用：把 staged 链接落成持久化的
 * taskid↔facility 链接，等画布轮询取件。过期/没有 staged 返回 false（不挂错设施）。
 */
export function consumeFacilityGenerateLink(taskid: string, name: string): boolean {
  const staged = stagedLink;
  stagedLink = null;
  if (!staged || !taskid || Date.now() - staged.stagedAt > LINK_FRESH_MS) return false;
  const link: FacilityGenerateLink = {
    taskid,
    facilityId: staged.facilityId,
    facilityName: staged.facilityName,
    name: name.trim() || staged.facilityName,
    submittedAt: Date.now(),
  };
  links = [link, ...links.filter(item => item.taskid !== taskid)].slice(0, LINKS_LIMIT);
  writeLinks();
  emitLinks();
  return true;
}

// ---------------------------------------------------------------------------
// 持久化链接表：轮询按 taskid 找设施；直连成功消费，终态失败留存核对记录
// ---------------------------------------------------------------------------

export interface FacilityGenerateLink {
  /** Original project association captured before dispatch (legacy links may omit). */
  projectId?: string;
  taskid: string;
  facilityId: string;
  facilityName: string;
  /** 候选回填时用的名字（生成框里那份原话/图片名）。 */
  name: string;
  submittedAt: number;
  lane?: 'direct' | 'cloud';
  /** Verified terminal job, retained for fee/history traceability (not proof of refund). */
  terminal?: { status: string; message: string; checkedAt: number };
}

const LINKS_KEY = 'scendance:facility-generate-links';
const LINKS_LIMIT = 2000; // 云模型刷新需要任务身份重新授权，不能把已选模型的链接挤掉。
/** 与 lux3d-import 的任务号校验同口径（那边没导出，这里同规格复制）。 */
const LINK_TASKID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isPersistedLink(value: unknown): value is FacilityGenerateLink {
  const link = value as FacilityGenerateLink;
  return Boolean(link)
    && typeof link.taskid === 'string' && LINK_TASKID_PATTERN.test(link.taskid)
    && typeof link.facilityId === 'string' && Boolean(link.facilityId)
    && typeof link.facilityName === 'string'
    && typeof link.name === 'string' && Boolean(link.name)
    && typeof link.submittedAt === 'number' && Number.isFinite(link.submittedAt)
    && (!link.terminal || (['failed', 'rejected', '4', '6', 'completed_without_glb', 'completed_unusable'].includes(link.terminal.status) && typeof link.terminal.message === 'string' && Number.isFinite(link.terminal.checkedAt)));
}

function readLinks(): FacilityGenerateLink[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw: unknown = JSON.parse(store.getItem(LINKS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isPersistedLink).slice(0, LINKS_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeLinks(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LINKS_KEY, JSON.stringify(links.slice(0, LINKS_LIMIT)));
  } catch {
    /* 存不下只丢链接；待取回卡片还在物料库，用户仍可手动回填。 */
  }
}

let links: FacilityGenerateLink[] = readLinks();
let linksRevision = 0;
const linksListeners = new Set<() => void>();

function emitLinks(): void {
  linksRevision += 1;
  for (const listener of [...linksListeners]) listener();
}

export function subscribeFacilityGenerateLinks(listener: () => void): () => void {
  linksListeners.add(listener);
  return () => { linksListeners.delete(listener); };
}

export function getFacilityGenerateLinksRevision(): number {
  return linksRevision;
}

export function listFacilityGenerateLinks(facilityId?: string, projectId?: string): FacilityGenerateLink[] {
  const all = links.filter(link => !projectId || !link.projectId || link.projectId === projectId).sort((a, b) => b.submittedAt - a.submittedAt);
  return facilityId ? all.filter(link => link.facilityId === facilityId) : all;
}

export function markFacilityGenerateTerminal(taskid: string, status: string, message: string): void {
  const link = links.find(item => item.taskid === taskid);
  if (!link || link.terminal || !['failed', 'rejected', '4', '6', 'completed_without_glb', 'completed_unusable'].includes(status)) return;
  links = links.map(item => item.taskid === taskid ? { ...item, terminal: { status, message, checkedAt: Date.now() } } : item);
  writeLinks(); emitLinks();
}

function removeFacilityGenerateLink(taskid: string): void {
  const next = links.filter(link => link.taskid !== taskid);
  if (next.length === links.length) return;
  links = next;
  writeLinks();
  emitLinks();
}

/** 户外原位生成：以提交当刻捕获的设施身份绑定，绝不消费全局 staged 链接。 */
export function attachFacilityGenerateTask(input: FacilityGenerateLink): boolean {
  if (!isPersistedLink(input)) return false;
  const terminal = links.find(item => item.taskid === input.taskid)?.terminal;
  links = [{ ...input, ...(terminal ? { terminal } : {}) }, ...links.filter(item => item.taskid !== input.taskid)].slice(0, LINKS_LIMIT);
  writeLinks();
  emitLinks();
  return true;
}

// ---------------------------------------------------------------------------
// resolve：一轮轮询 = 查任务详情 → 完成就落盘入库 + 注册候选
// ---------------------------------------------------------------------------

/** 与 lib/lux3d-import.ts 的 LUX3D_TASK_POLL_MS 同节奏（不静态引它，保纯 lib）。 */
export const FACILITY_GENERATE_POLL_MS = 15_000;

export interface FacilityGenerateResolveOptions {
  /** 测试里替掉全局 fetch（透传给 fetchLux3dTask）。 */
  fetchImpl?: typeof fetch;
  cloud?: {
    getGenerationJob(id: string): Promise<{ state: string; asset_id: string | null }>;
    authorizeAsset(id: string): Promise<{ url: string; name: string }>;
  };
}


export type FacilityGenerateResolveResult =
  | { state: 'pending'; message: string }
  | { state: 'imported'; model: GeneratedFacilityModel }
  | { state: 'failed'; message: string };

export async function resolveFacilityGenerateLink(
  taskid: string,
  options: FacilityGenerateResolveOptions = {},
): Promise<FacilityGenerateResolveResult> {
  const link = links.find(item => item.taskid === taskid);
  if (!link) return { state: 'failed', message: '这条生成任务已失效，请重新生成。' };
  if (link.terminal) return { state: 'failed', message: link.terminal.message };

  if (link.lane === 'cloud') {
    const existing = findGeneratedFacilityModel(`generated:${taskid}`);
    if (existing) return { state: 'imported', model: existing };
    if (!options.cloud) return { state: 'pending', message: '请连接原云项目后取回模型。' };
    try {
      const job = await options.cloud.getGenerationJob(taskid);
      if (job.state === 'submit_unknown') return { state: 'pending', message: '提交结果未知，请先核对任务记录与费用，不要重复生成。' };
      if (['failed', 'rejected'].includes(job.state)) {
        markFacilityGenerateTerminal(taskid, job.state, '云任务未成功，请核对生成记录与费用；不会自动重发。');
        return { state: 'failed', message: '云任务未成功，请核对生成记录与费用；不会自动重发。' };
      }
      if (!['ready', 'added'].includes(job.state) || !job.asset_id) return { state: 'pending', message: `云端生成中 · ${job.state}` };
      const asset = await options.cloud.authorizeAsset(job.asset_id);
      const { ensureGlbAsset, getGlbAssetState } = await import('../three/glb-assets');
      await ensureGlbAsset(job.asset_id, asset.url);
      const state = getGlbAssetState(job.asset_id);
      if (state?.status !== 'ready' || !state.dimensions) return { state: 'pending', message: '模型已完成，正在读取尺寸…' };
      const model: GeneratedFacilityModel = {
        slug: `generated:${taskid}`, name: link.name, glbUrl: asset.url,
        ...state.dimensions, ...(link.projectId ? { projectId: link.projectId } : {}), facilityId: link.facilityId, facilityName: link.facilityName,
        createdAt: Date.now(), sessionOnly: true,
      };
      // 云端签名 URL 有效期有限：不把它当永久公开地址落盘。
      registerGeneratedFacilityModel(model);
      // 保留持久化任务身份，刷新后重新授权 URL；当前会话由上面的 registry 快返止轮询。
      return { state: 'imported', model };
    } catch (error) {
      return { state: 'pending', message: error instanceof Error ? error.message : '云模型暂未取回，请稍后重试。' };
    }
  }

  // 动态引：本模块被 plan-facility-models（纯 lib）静态引用，three/重依赖只在轮询时进包。
  const [{ fetchLux3dTask, glbOutputOf }, { loadAholoCatalogItem }] = await Promise.all([
    import('./lux3d-import'),
    import('./aholo-model-placement'),
  ]);

  let detail;
  try {
    detail = await fetchLux3dTask(taskid, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {});
  } catch (error) {
    // 网络抖动按可重试 pending 处理：链接保留，下一轮轮询再试。
    return { state: 'pending', message: error instanceof Error ? error.message : '取回任务失败，请稍后重试。' };
  }
  if (detail.status === 0 || detail.status === 1) {
    return {
      state: 'pending',
      message: detail.progress === undefined
        ? detail.statusLabel
        : `${detail.statusLabel} ${Math.round(detail.progress)}%`,
    };
  }
  if (detail.status === 4 || detail.status === 6) {
    markFacilityGenerateTerminal(taskid, String(detail.status), `${detail.statusLabel}；请核对费用，再显式确认新一轮。`);
    return { state: 'failed', message: `${detail.statusLabel}；请核对费用，再显式确认新一轮。` };
  }

  if (detail.status !== 3) return { state: 'pending', message: '任务状态尚不能核对为终态，保留原任务。' };
  const glbUrl = glbOutputOf(detail.outputs);
  if (!glbUrl) {
    markFacilityGenerateTerminal(taskid, 'completed_without_glb', '任务已完成，但产物里没有 GLB 模型。');
    return { state: 'failed', message: '任务已完成，但产物里没有 GLB 模型。' };
  }

  try {
    const item = await loadAholoCatalogItem({ url: glbUrl, name: link.name, taskid });
    const model: GeneratedFacilityModel = {
      slug: `generated:${taskid}`,
      name: link.name,
      glbUrl: item.glbUrl ?? glbUrl,
      width: item.width,
      depth: item.depth,
      height: item.height,
      ...(link.projectId ? { projectId: link.projectId } : {}), facilityId: link.facilityId,
      facilityName: link.facilityName,
      createdAt: Date.now(),
    };
    registerGeneratedFacilityModel(model);
    removeFacilityGenerateLink(taskid);
    return { state: 'imported', model };
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型入库失败，请重试。';
    // 代理暂时连不上保留链接（与 lux3d-import 的可重试口径一致）；模型本身有问题则留存终态关联，不再轮询。
    if (/代理|超时|稍后/.test(message)) return { state: 'pending', message };
    markFacilityGenerateTerminal(taskid, 'completed_unusable', message);
    return { state: 'failed', message };
  }
}
