/**
 * M6-Density 层：单旋钮 0..1 控制「松 → 密」三档布局密度。
 *
 * 纯函数模块，只产出 DensitySpec（间距 / 装饰密度 / 候选丰富度）与中文人话文案。
 * 不接 UI、不碰 Three.js、不引入新依赖。
 */

/** 密度旋钮展开后的三个具体量。 */
export interface DensitySpec {
  /** 家具之间的目标净距（米）：d=0 时 1.8m（松），d=1 时 0.9m（密）。 */
  spacingMeters: number;
  /** 每 10 平米的装饰件数量：d=0 时 2，d=1 时 12。 */
  decorCountPer10sqm: number;
  /** AI 每次提议的候选变体数：d=0 时 3，d=1 时 8。 */
  candidateVariety: number;
}

/** 把 [0,1] 的密度旋钮线性映射到 DensitySpec；越界截断到 [0,1]。 */
export function densityToSpec(d: number): DensitySpec {
  const clamped = Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : 0;
  return {
    spacingMeters: 1.8 - 0.9 * clamped,
    decorCountPer10sqm: 2 + 10 * clamped,
    candidateVariety: 3 + 5 * clamped,
  };
}

/** 三档中文文案：< 0.34 松，[0.34, 0.67) 适中，>= 0.67 密。 */
export function describeDensity(d: number): string {
  const c = Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : 0;
  if (c < 0.34) return '松';
  if (c < 0.67) return '适中';
  return '密';
}
