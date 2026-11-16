/**
 * 资产 LOD 选择与体积守卫（2026-11-16 #133）。
 *
 * 参考做法（成熟案例，2026-11-16 核对）：
 * - three.js `THREE.LOD` 的默认 `autoUpdate` 用的是「距离」而不是屏幕占比，但它提供
 *   `LOD.setAutoUpdate(false)` + 由业务挑档的口子；游戏与编辑器普遍改用**屏幕占比**
 *   （projected size）而不是纯距离，因为同一距离下大车与小人占的像素差很多。
 * - React Three Fiber / drei 的 `<Detailed>` 同理：按相机距离切换 visible。
 * 所以这里不复制 three 的距离阈值，而是要求调用方传 `screenFraction`（0–1，屏幕高度占比），
 * 阈值做成常量便于统一调参。
 *
 * 纪律：非法输入不崩、不返回不存在的档位；缺档就退到能用的最近一档，
 * 一档都没有返回 null，让调用方明确处理「这个资产没有 LOD」。
 */

import type { PeopleAssetLod } from './asset-manifest';

/** 屏幕占比阈值：≥18% 用最精细，≥6% 用中档，其余最粗。 */
export const LOD_SCREEN_FRACTION_THRESHOLDS: readonly number[] = Object.freeze([0.18, 0.06]);

/**
 * 按屏幕占比挑档位序号（0 = 最精细）。
 * - `screenFraction` 为 NaN/负数 → 当作「看不见」，返回最粗档；
 * - 未声明 LOD（levels 为空）→ 返回 0（沿用主资产，不额外降级）；
 * - 只在**实际存在的档位**里挑：存在 LOD0/LOD2 而没有 LOD1 时，中档返回 LOD2 而非 LOD1。
 */
export function pickAssetLodLevel(input: {
  readonly screenFraction: number;
  readonly levels: readonly Pick<PeopleAssetLod, 'level'>[];
}): number {
  const { screenFraction, levels } = input;
  const available = levels.map((level) => level.level).sort((a, b) => a - b);
  if (available.length === 0) return 0;
  const coarsest = available[available.length - 1]!;
  if (!Number.isFinite(screenFraction) || screenFraction <= 0) return coarsest;
  const wanted = screenFraction >= LOD_SCREEN_FRACTION_THRESHOLDS[0]!
    ? 0
    : screenFraction >= LOD_SCREEN_FRACTION_THRESHOLDS[1]!
      ? 1
      : 2;
  // 挑「不粗于 wanted」的最粗一档；没有更细的就退到最粗。
  const eligible = available.filter((level) => level >= wanted);
  return eligible.length > 0 ? Math.min(...eligible) : coarsest;
}

/** 资产类别：只影响守卫文案，不改变判定逻辑。 */
export type AssetLimitKind = 'walk' | 'facility' | 'vehicle';

const KIND_LABEL: Record<AssetLimitKind, string> = {
  walk: '人物',
  facility: '设施',
  vehicle: '车辆',
};

/**
 * 体积守卫。上限由调用方注入（当前 `lib/glb-limits.ts` 的 48 MB，替换压缩资产后收到 8 MB），
 * 这样「换资产 + 收阈值」只需要改一处配置，不用回来改逻辑。
 *
 * 注意：**超限只拒绝、不降级**。拿一个 40 MB 的老资产硬解，会把真机内存和首帧一起拖垮；
 * 拒绝后由上层显示「待补模型」，这才是可诊断的失败。
 */
export function shouldRejectAsset(input: {
  readonly kind: AssetLimitKind;
  readonly bytes: number;
  readonly limitBytes: number;
}): { readonly reject: boolean; readonly reason?: string } {
  const { kind, bytes, limitBytes } = input;
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { reject: true, reason: `${KIND_LABEL[kind]}资产大小非法（${String(bytes)} 字节）` };
  }
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
    return { reject: true, reason: `${KIND_LABEL[kind]}资产上限配置非法（${String(limitBytes)} 字节）` };
  }
  if (bytes > limitBytes) {
    const sizeMb = (bytes / (1024 * 1024)).toFixed(1);
    const limitMb = (limitBytes / (1024 * 1024)).toFixed(1);
    return {
      reject: true,
      reason: `${KIND_LABEL[kind]}资产 ${sizeMb} MB 超过上限 ${limitMb} MB（${bytes} > ${limitBytes} 字节）`,
    };
  }
  return { reject: false };
}
