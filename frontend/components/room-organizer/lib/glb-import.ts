import { GLB_MAX_FILE_BYTES } from './glb-limits';
import type { GlbUnit, GlbUpAxis } from './glb-normalize';

/**
 * 本机 GLB 导入的纯规则：先在这里判文件，再交给 three/glb-assets 解析。
 * 失败一律返回一句能照着改的话，不返回空字符串、不静默吞掉。
 */

/** 导入模型的缓存键前缀：只在本机这一次编辑里生效，不进线上资产链路。 */
export const LOCAL_GLB_KEY_PREFIX = 'local-glb:';

export function localGlbKey(id: string): string {
  return `${LOCAL_GLB_KEY_PREFIX}${id}`;
}

/** 会话内一次性的新缓存键（crypto.randomUUID 优先，回退时间戳 36 进制）。 */
export function newLocalGlbKey(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36);
  return localGlbKey(random);
}

export const NOT_GLB_MESSAGE = '只支持单文件 .glb；.gltf 常带外部贴图或 .bin，导入后无法独立打开。';
export const EMPTY_GLB_MESSAGE = '文件是空的，没有可导入的模型。';
export const TOO_LARGE_GLB_MESSAGE = 'GLB 超过 10 MB，请先在建模软件里压缩或减面后再导入。';

export interface LocalGlbPick {
  name: string;
  size: number;
}

/** 选文件当刻就能判的失败原因；返回 null 才继续读字节。 */
export function validateLocalGlbPick(file: LocalGlbPick): string | null {
  if (!file.name.toLowerCase().endsWith('.glb')) return NOT_GLB_MESSAGE;
  if (file.size === 0) return EMPTY_GLB_MESSAGE;
  if (file.size > GLB_MAX_FILE_BYTES) return TOO_LARGE_GLB_MESSAGE;
  return null;
}

/** 去掉目录与扩展名，留给物料卡一个能读的名字。 */
export function importDisplayName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? '').trim();
  const name = base.replace(/\.glb$/i, '').trim();
  return name || '本机模型';
}

export interface ImportBriefInput {
  width: number;
  depth: number;
  height: number;
  unit: GlbUnit;
  upAxis: GlbUpAxis;
}

function meters(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2)} m`;
}

/** 导入成功后给人的一行说明：尺寸、源单位、轴向是否被改过。 */
export function importBrief(asset: ImportBriefInput): string {
  const size = `${meters(asset.width)} × ${meters(asset.depth)} × ${meters(asset.height)}`;
  const unit = asset.unit === 'cm' ? '源单位厘米 ×0.01' : '源单位米';
  const axis = asset.upAxis === 'z' ? 'Z-up 已转 Y-up' : 'Y-up 原样';
  return `${size} · ${unit} · ${axis}`;
}
