import { DIRECT_BASE, isLux3dLocalProxy } from './aholo-assets';
import { glbOutputOf } from './lux3d-import';

/**
 * 人物设计链服务封装（直连本机代理 3199）。
 * 链路四段：参考图（2D）→ 四视图（2D）→ 静态人形出模（复用 /image-to-3d）→ 绑骨 → 动作重定向。
 * 密钥只留在代理侧；代理没开就停在可读提示上，不提交、不编任务号。
 *
 * 动作名与前端动画消费口径对齐（three/people-model.ts 的 PEOPLE_CLIPS）：
 * 最终重定向产物必须带 Idle_Loop 与 Walk_Loop，现有加载器才播放得起来。
 */

/**
 * 预设动作清单（上游真实 id，已逐个实探）。
 * - `Idle_Loop` / `Walk_Loop` 是漫游 avatar 的必需剪辑；
 * - `Idle_Talking_Loop` 交谈、`Sitting_Idle_Loop` 坐姿循环为可选重定向项；
 * - 动作库**没有**坐下/起身过渡（`Stand_To_Sit`、`Sit_To_Stand` 均被上游拒绝），
 *   过渡由前端交叉淡入兜底，不要往这里加。
 * - 坐姿重定向产物内部剪辑名是 `animation_1`，归仓时由
 *   tools/aholo/build-sit-assets.mjs 改名成前端认的 `Sit_Idle_Loop`。
 */
export const CHARACTER_ANIMATION_PRESETS = [
  { id: 'Idle_Loop', label: '待机动画' },
  { id: 'Walk_Loop', label: '行走动画' },
  { id: 'Idle_Talking_Loop', label: '交谈动画' },
  { id: 'Sitting_Idle_Loop', label: '坐姿循环' },
] as const;

const MAX_PROMPT = 4000;
const MAX_ANIMATION_ID = 64;
const MAX_ANIMATIONS = 10;

export interface CharacterSubmitOptions {
  /** 测试里替掉全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 测试里强制当作直连通道已开或未开。正式界面不传。 */
  localProxy?: boolean;
}

export type CharacterTaskResult =
  | { ok: true; taskid: string; lane: 'direct' }
  | { ok: false; stub: boolean; message: string; outcome?: 'unknown' };

const NO_CHANNEL = '人物生成这次还不能提交。请先启动本机代理，再到这里设计角色。';
const UNKNOWN_SUBMIT = '直连提交结果暂时无法确认，可能已创建任务或产生费用。请先查看生成任务记录并核对，再决定是否重新提交。';

function taskIdOf(body: unknown): string {
  const row = body as { taskid?: unknown; error?: unknown } | null;
  if (row && typeof row.error === 'string' && row.error) throw new Error(row.error);
  const taskid = String(row?.taskid ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskid)) throw new Error('接口没返回有效任务号。');
  return taskid;
}

function trimPrompt(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} 需要一段文字描述。`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`先填写${field}。`);
  if (trimmed.length > MAX_PROMPT) throw new Error(`${field} 过长，请精简到 ${MAX_PROMPT} 字以内。`);
  return trimmed;
}

function httpsModelUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.startsWith('https://')) {
    throw new Error(`${field} 必须是公网 HTTPS 模型地址。`);
  }
  return value;
}

function animationIdsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ANIMATIONS) {
    throw new Error(`动作清单需要 1..${MAX_ANIMATIONS} 条。`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim() || item.length > MAX_ANIMATION_ID) {
      throw new Error(`第 ${index + 1} 条动作无效。`);
    }
    return item.trim();
  });
}

interface DirectRoute {
  path: string;
  payload: Record<string, unknown>;
}

async function submitDirect(route: DirectRoute, options: CharacterSubmitOptions): Promise<CharacterTaskResult> {
  if (!(options.localProxy ?? isLux3dLocalProxy())) {
    return { ok: false, stub: true, message: NO_CHANNEL };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${DIRECT_BASE}${route.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route.payload),
      credentials: 'omit',
    });
  } catch {
    return { ok: false, stub: false, outcome: 'unknown', message: UNKNOWN_SUBMIT };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, stub: false, outcome: 'unknown', message: UNKNOWN_SUBMIT };
  }
  try {
    return { ok: true, taskid: taskIdOf(body), lane: 'direct' };
  } catch (error) {
    return {
      ok: false,
      stub: false,
      outcome: 'unknown',
      message: error instanceof Error && error.message.includes('任务号') ? error.message : UNKNOWN_SUBMIT,
    };
  }
}

/** 第一步：文字描述 → 多模态参考图（2D 形象稿）。 */
export async function submitCharacterReference(
  prompt: string,
  options: CharacterSubmitOptions = {},
): Promise<CharacterTaskResult> {
  let trimmed: string;
  try {
    trimmed = trimPrompt(prompt, '角色描述');
  } catch (error) {
    return { ok: false, stub: false, message: error instanceof Error ? error.message : '角色描述无效。' };
  }
  return submitDirect({ path: '/ref-image', payload: { prompt: trimmed } }, options);
}

/** 第二步：参考图 → 四视图（正/侧/背/侧 一致性 2D 图）。 */
export async function submitCharacterFourView(
  imageDataUrl: string,
  prompt: string | undefined,
  options: CharacterSubmitOptions = {},
): Promise<CharacterTaskResult> {
  if (!imageDataUrl.startsWith('data:image/')) {
    return { ok: false, stub: false, message: '请先选一张 PNG 或 JPEG 参考图。' };
  }
  const payload: Record<string, unknown> = { img: imageDataUrl };
  if (typeof prompt === 'string' && prompt.trim()) {
    try {
      payload.prompt = trimPrompt(prompt, '补充描述');
    } catch (error) {
      return { ok: false, stub: false, message: error instanceof Error ? error.message : '补充描述无效。' };
    }
  }
  return submitDirect({ path: '/four-view', payload }, options);
}

/** 第四步：静态人形 GLB（公网地址）→ 绑骨，输出带骨 GLB。 */
export async function submitCharacterRig(
  modelUrl: string,
  options: CharacterSubmitOptions = {},
): Promise<CharacterTaskResult> {
  let trimmed: string;
  try {
    trimmed = httpsModelUrl(modelUrl, '模型地址');
  } catch (error) {
    return { ok: false, stub: false, message: error instanceof Error ? error.message : '模型地址无效。' };
  }
  return submitDirect({ path: '/rig', payload: { modelUrl: trimmed } }, options);
}

/** 第五步：带骨 GLB + 动作清单 → 动作重定向，输出带动画 GLB。 */
export async function submitCharacterRetarget(
  rigModelUrl: string,
  animationIds: string[],
  options: CharacterSubmitOptions = {},
): Promise<CharacterTaskResult> {
  let modelUrl: string;
  let animations: string[];
  try {
    modelUrl = httpsModelUrl(rigModelUrl, '带骨模型地址');
    animations = animationIdsOf(animationIds);
  } catch (error) {
    return { ok: false, stub: false, message: error instanceof Error ? error.message : '入参无效。' };
  }
  return submitDirect({ path: '/retarget', payload: { rigModelUrl: modelUrl, animationIds: animations } }, options);
}

/** 参考图 / 四视图产物：挑第一张可预览的图片地址。 */
export function imageOutputOf(outputs: string[]): string | undefined {
  return outputs.find(output => {
    try {
      return /\.(png|jpe?g)$/i.test(new URL(output).pathname);
    } catch {
      return false;
    }
  });
}

/** 静态人形 / 绑骨 / 重定向产物：挑第一个 GLB（判定与物件出件一致）。 */
export function modelOutputOf(outputs: string[]): string | undefined {
  return glbOutputOf(outputs);
}
