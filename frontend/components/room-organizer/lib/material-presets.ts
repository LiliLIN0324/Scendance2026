/**
 * 材质快改预设（2026-11-17）。
 *
 * 用户诉求是「木质 → 其他材质」，不是重做模型。做法与成熟编辑器一致：
 * 只改 PBR 参数、保留原贴图（color 与贴图相乘，等于给木纹换色调），
 * 需要「纯色金属」时再把贴图去掉——这一版先做前者，风险最低。
 *
 * 纯数据 + 纯函数，零 three 依赖，便于单测与 Agent 复用。
 */

export interface MaterialPreset {
  id: string;
  label: string;
  /** 与贴图相乘的基色；`original` 不参与替换。 */
  tint: string;
  roughness: number;
  metalness: number;
  /** 有值才转半透明（玻璃）。 */
  opacity?: number;
}

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  { id: 'original', label: '原样', tint: '#ffffff', roughness: 0.8, metalness: 0 },
  { id: 'oak', label: '浅木', tint: '#d9b98c', roughness: 0.72, metalness: 0.02 },
  { id: 'walnut', label: '深木', tint: '#6f4a33', roughness: 0.7, metalness: 0.03 },
  { id: 'metal', label: '黑金属', tint: '#3a3f45', roughness: 0.38, metalness: 0.85 },
  { id: 'steel', label: '拉丝钢', tint: '#c8cdd4', roughness: 0.3, metalness: 0.95 },
  { id: 'fabric', label: '布艺', tint: '#8d939b', roughness: 0.95, metalness: 0 },
  { id: 'glass', label: '玻璃', tint: '#cfe4ea', roughness: 0.1, metalness: 0.05, opacity: 0.45 },
];

const BY_ID = new Map(MATERIAL_PRESETS.map(preset => [preset.id, preset]));

export function materialPreset(id: string | undefined | null): MaterialPreset | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/** 是否是可落盘的预设 id（写方案前校验，避免脏值进库）。 */
export function isMaterialPresetId(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id);
}

/** 归一：不认识的值一律回 `original`，绝不把脏值带到 3D。 */
export function normalizeMaterialPreset(id: string | undefined | null): string {
  return isMaterialPresetId(id) ? id : 'original';
}

export function materialPresetLabel(id: string | undefined | null): string {
  return materialPreset(id)?.label ?? '原样';
}
