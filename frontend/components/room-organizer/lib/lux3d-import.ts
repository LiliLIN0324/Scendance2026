import { aholoAssetUrl, DIRECT_BASE, findAholoAssetByTask, isLux3dLocalProxy } from './aholo-assets';
import { loadAholoCatalogItem } from './aholo-model-placement';
import { listPendingMaterials, removePendingMaterial, type PendingMaterial } from './material-generate';
import type { CatalogItem } from './types';

/**
 * Lux3D 出件之后的最后一段：用户在物料生成里点了提交，任务号先留在本地；
 * 这里轮询 /task，拿到可下载的 GLB 就直接走 importAholoAsset 落盘入库，
 * 不再要求用户「下载 → 转换 → 再上传」。
 *
 * 代理端点：GET {DIRECT_BASE}/task?taskid=…（status 3=完成，4=失败，6=取消），
 * 产物是 https 签名 URL，需要 .glb 后缀才能当物件模型。
 */

export const LUX3D_TASK_POLL_MS = 15_000;
const taskIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

export type Lux3dTaskStatus = 0 | 1 | 3 | 4 | 6;

export interface Lux3dTaskDetail {
  status: Lux3dTaskStatus;
  statusLabel: string;
  outputs: string[];
  progress?: number;
}

export type Lux3dImportOutcome =
  | { state: 'imported'; item: CatalogItem }
  | { state: 'pending'; message: string }
  | { state: 'failed'; message: string; retryable?: boolean };

export type Lux3dBatchOutcome = Lux3dImportOutcome | { state: 'empty' };

interface ImportOptions {
  fetchImpl?: typeof fetch;
  localProxy?: boolean;
}

const STATUS_LABEL: Record<Lux3dTaskStatus, string> = {
  0: '排队中',
  1: '生成中',
  3: '已完成',
  4: '生成失败',
  6: '已取消',
};

function isStatus(value: unknown): value is Lux3dTaskStatus {
  return value === 0 || value === 1 || value === 3 || value === 4 || value === 6;
}

/** 物料卡的 id 是 `pending:<taskid>`；不是这个形状就不归取回链路管。 */
export function pendingTaskId(card: Pick<PendingMaterial, 'id'>): string | undefined {
  if (!card.id.startsWith('pending:')) return undefined;
  const taskid = card.id.slice('pending:'.length);
  return taskIdPattern.test(taskid) ? taskid : undefined;
}

export async function fetchLux3dTask(taskid: string, options: ImportOptions = {}): Promise<Lux3dTaskDetail> {
  if (!taskIdPattern.test(taskid)) throw new Error('任务号格式无效，无法取回模型。');
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${DIRECT_BASE}/task?taskid=${encodeURIComponent(taskid)}`, { credentials: 'omit' });
  } catch {
    throw new Error('连不上生成通道（本机 3199 或 NEXT_PUBLIC_LUX3D_DIRECT_URL）。本地先运行：node tools/aholo/lux3d-dev-proxy.mjs');
  }
  if (!response.ok) throw new Error(`取回任务失败（HTTP ${response.status}），请稍后重试。`);
  const body = (await response.json().catch(() => null)) as {
    status?: unknown;
    outputs?: unknown;
    progress?: unknown;
  } | null;
  if (!body || !isStatus(body.status)) throw new Error('任务详情格式无效，无法取回模型。');
  return {
    status: body.status,
    statusLabel: STATUS_LABEL[body.status],
    outputs: Array.isArray(body.outputs) ? body.outputs.filter((url): url is string => typeof url === 'string') : [],
    ...(typeof body.progress === 'number' && Number.isFinite(body.progress) ? { progress: body.progress } : {}),
  };
}

/** 产物里挑第一个真正的 .glb；COS 签名链带查询串，只看 pathname。 */
export function glbOutputOf(outputs: string[]): string | undefined {
  return outputs.find(output => {
    try {
      return /\.glb$/i.test(new URL(output).pathname);
    } catch {
      return false;
    }
  });
}

/** 一条待取回任务的取件结果：完成就落盘入库，没完成就保留卡片等下一轮。 */
export async function importPendingMaterial(cardId: string, options: ImportOptions = {}): Promise<Lux3dImportOutcome> {
  if (!(options.localProxy ?? isLux3dLocalProxy())) {
    return { state: 'failed', message: '当前环境没有直连生成通道。线上生成请在登录云项目后提交，服务端会把 GLB 归档好并自动放进画布；本地可启动 tools/aholo/lux3d-dev-proxy.mjs 或配置 NEXT_PUBLIC_LUX3D_DIRECT_URL。' };
  }
  const card = listPendingMaterials().find(item => item.id === cardId);
  const taskid = card ? pendingTaskId(card) : undefined;
  if (!card || !taskid) return { state: 'failed', message: '这条生成任务已失效，请重新生成。' };

  let detail: Lux3dTaskDetail;
  try {
    detail = await fetchLux3dTask(taskid, options);
  } catch (error) {
    // 网络抖动就保留卡片，下一轮轮询再试；格式错误同理不值得删任务。
    return { state: 'failed', message: error instanceof Error ? error.message : '取回任务失败，请稍后重试。', retryable: true };
  }

  if (detail.status === 0 || detail.status === 1) {
    return {
      state: 'pending',
      message: detail.progress === undefined
        ? `${detail.statusLabel}，完成后会自动放进物料库`
        : `${detail.statusLabel} ${Math.round(detail.progress)}%，完成后会自动放进物料库`,
    };
  }
  if (detail.status === 4 || detail.status === 6) {
    removePendingMaterial(cardId);
    return { state: 'failed', message: `${detail.statusLabel}，请回到生成入口重试。` };
  }

  const glbUrl = glbOutputOf(detail.outputs);
  if (!glbUrl) {
    removePendingMaterial(cardId);
    return { state: 'failed', message: '任务已完成，但产物里没有 GLB 模型。' };
  }

  try {
    const cached = findAholoAssetByTask(taskid);
    const item = await loadAholoCatalogItem({
      url: aholoAssetUrl(cached) ?? glbUrl,
      name: card.name,
      taskid,
    });
    removePendingMaterial(cardId);
    return { state: 'imported', item };
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型入库失败，请重试。';
    // 代理暂时连不上时保留任务；模型本身有问题就不留垃圾卡片。
    const retryable = message.includes('代理') || message.includes('超时') || message.includes('稍后');
    if (!retryable) removePendingMaterial(cardId);
    return { state: 'failed', message, retryable };
  }
}

/**
 * 「取回最新生成」：从最新提交的任务往回试，第一件完成的就入库。
 * 全部仍在生成时返回 pending，物料卡继续保留。
 */
export async function importLatestPendingMaterials(options: ImportOptions = {}): Promise<Lux3dBatchOutcome> {
  if (!(options.localProxy ?? isLux3dLocalProxy())) {
    return { state: 'failed', message: '当前环境没有直连生成通道。线上生成请在登录云项目后提交，服务端会把 GLB 归档好并自动放进画布。' };
  }
  const tasks = listPendingMaterials()
    .filter(card => pendingTaskId(card))
    .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
  if (!tasks.length) return { state: 'empty' };

  let pendingMessage = '';
  for (const card of tasks) {
    const result = await importPendingMaterial(card.id, options);
    if (result.state === 'imported') return result;
    if (result.state === 'pending') pendingMessage = result.message;
    else if (result.retryable) pendingMessage = result.message;
  }
  return pendingMessage
    ? { state: 'pending', message: pendingMessage }
    : { state: 'failed', message: '没有可用的生成结果，待取回任务已清理。' };
}
