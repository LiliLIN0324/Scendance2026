import { DIRECT_BASE, isLux3dLocalProxy } from './aholo-assets';

/**
 * 物料库「＋」的两条生成入口。只打已经存在的 Aholo 路径（文生 /text-to-3d、图生 /image-to-3d）。
 * 密钥留在本机代理里；代理没开就停在说明上，不提交、不编一把钥匙。
 */
export type MaterialGenerateInput =
  | { kind: 'text'; prompt: string }
  | { kind: 'image'; imageDataUrl: string };

export type MaterialGenerateResult =
  | { ok: true; taskid: string; kind: 'text' | 'image' }
  | { ok: false; stub: boolean; message: string };

const TEXT_STUB = '本机代理没开，描述生成不会提交，也不会扣额度。代理开了之后，同一条会打 /text-to-3d。';
const IMAGE_STUB = '本机代理没开，图片生成不会提交，也不会扣额度。代理开了之后，同一条会打 /image-to-3d（Aholo Lux3D）。';

export interface MaterialGenerateOptions {
  /** 测试里替掉全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 测试里强制当作代理已开或未开。正式界面不传。 */
  localProxy?: boolean;
}

function taskIdOf(body: unknown): string {
  const row = body as { taskid?: unknown; error?: unknown };
  if (row && typeof row.error === 'string' && row.error) throw new Error(row.error);
  const taskid = String(row?.taskid ?? '');
  if (!/^\d+$/.test(taskid)) throw new Error('接口没返回有效任务号。');
  return taskid;
}

export async function submitMaterialGenerate(input: MaterialGenerateInput, options: MaterialGenerateOptions = {}): Promise<MaterialGenerateResult> {
  const local = options.localProxy ?? isLux3dLocalProxy();
  if (!local) return { ok: false, stub: true, message: input.kind === 'text' ? TEXT_STUB : IMAGE_STUB };
  const prompt = input.kind === 'text' ? input.prompt.trim() : '';
  if (input.kind === 'text' && !prompt) return { ok: false, stub: false, message: '先写一句要生成的物料。' };
  if (input.kind === 'image' && !input.imageDataUrl.startsWith('data:image/')) return { ok: false, stub: false, message: '请选择一张 PNG 或 JPEG。' };
  const fetchImpl = options.fetchImpl ?? fetch;
  const path = input.kind === 'text' ? '/text-to-3d' : '/image-to-3d';
  const payload = input.kind === 'text' ? { prompt } : { img: input.imageDataUrl };
  try {
    const response = await fetchImpl(`${DIRECT_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `提交没成功（HTTP ${response.status}），没有确认扣费。`;
      return { ok: false, stub: false, message };
    }
    return { ok: true, taskid: taskIdOf(body), kind: input.kind };
  } catch (failure) {
    return { ok: false, stub: false, message: failure instanceof Error ? failure.message : '提交没成功，没有确认扣费。' };
  }
}
