/**
 * 人物资产清单（2026-11-16 #133）。
 *
 * 为什么需要它：GLB 从 41 MB 压到 2.5 MB 之后，「哪个资产多大、hash 是什么、有没有 LOD」
 * 不能再靠散落在各处的常量猜。清单是**唯一事实来源**，同时承担两件事：
 * 1. 缓存键带 hash —— 资产换了、hash 变了，旧缓存自动失效，不会出现「压缩了但还是老模型」；
 * 2. 体积守卫的输入 —— 上限与实测体积放在一起比较，才能在上云前后安全切换阈值。
 *
 * 纪律：解析**不抛异常**（返回 ok/error），未知字段忽略（向前兼容），
 * 缺关键字段不猜默认值（宁可拒绝，也不要拿 0 字节当合法资产）。
 */

/** 单个 LOD 档位。level 0 = 最精细。 */
export interface PeopleAssetLod {
  readonly level: number;
  readonly url: string;
  readonly bytes: number;
}

export interface PeopleAssetEntry {
  /** 文件字节数（压缩后）。 */
  readonly bytes: number;
  /** 内容 hash（用于缓存失效；空字符串视为无效）。 */
  readonly hash: string;
  /** 可选多档 LOD，按 level 升序理解，但解析时按值校验，不依赖顺序。 */
  readonly lods?: readonly PeopleAssetLod[];
}

export interface PeopleAssetManifest {
  readonly version: 1;
  readonly assets: Readonly<Record<string, PeopleAssetEntry>>;
}

export type ManifestParseResult =
  | { readonly ok: true; readonly manifest: PeopleAssetManifest }
  | { readonly ok: false; readonly error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * 解析清单。`version` 只接受 1（未来升版要显式改这里，避免旧代码静默读新结构）。
 * 失败原因写成人能直接贴进工单的句子。
 */
export function parsePeopleAssetManifest(input: unknown): ManifestParseResult {
  if (!isRecord(input)) return { ok: false, error: '清单必须是对象' };
  if (input.version !== 1) {
    return { ok: false, error: `清单版本不支持：${String(input.version)}（只认 1）` };
  }
  const rawAssets = input.assets;
  if (!isRecord(rawAssets)) return { ok: false, error: '清单缺少 assets 对象' };
  const assets: Record<string, PeopleAssetEntry> = {};
  for (const [assetId, rawEntry] of Object.entries(rawAssets)) {
    if (!isNonEmptyString(assetId)) return { ok: false, error: '存在空的 assetId' };
    if (!isRecord(rawEntry)) return { ok: false, error: `资产 ${assetId} 不是对象` };
    if (!isPositiveInt(rawEntry.bytes)) {
      return { ok: false, error: `资产 ${assetId} 的 bytes 必须是正整数` };
    }
    if (!isNonEmptyString(rawEntry.hash)) {
      return { ok: false, error: `资产 ${assetId} 缺少 hash（无 hash 无法做缓存失效）` };
    }
    let lods: PeopleAssetLod[] | undefined;
    if (rawEntry.lods !== undefined) {
      if (!Array.isArray(rawEntry.lods)) {
        return { ok: false, error: `资产 ${assetId} 的 lods 必须是数组` };
      }
      const levels = new Set<number>();
      lods = [];
      for (const rawLod of rawEntry.lods) {
        if (!isRecord(rawLod)) return { ok: false, error: `资产 ${assetId} 存在非对象 LOD` };
        const level = rawLod.level;
        if (typeof level !== 'number' || !Number.isInteger(level) || level < 0) {
          return { ok: false, error: `资产 ${assetId} 的 LOD level 必须是非负整数` };
        }
        if (levels.has(level)) {
          return { ok: false, error: `资产 ${assetId} 的 LOD level ${level} 重复` };
        }
        if (!isNonEmptyString(rawLod.url)) {
          return { ok: false, error: `资产 ${assetId} 的 LOD ${level} 缺少 url` };
        }
        if (!isPositiveInt(rawLod.bytes)) {
          return { ok: false, error: `资产 ${assetId} 的 LOD ${level} bytes 必须是正整数` };
        }
        levels.add(level);
        lods.push({ level, url: rawLod.url, bytes: rawLod.bytes });
      }
      lods.sort((a, b) => a.level - b.level);
    }
    assets[assetId] = lods ? { bytes: rawEntry.bytes, hash: rawEntry.hash, lods } : { bytes: rawEntry.bytes, hash: rawEntry.hash };
  }
  return { ok: true, manifest: { version: 1, assets } };
}

/**
 * 取「不高于请求档位」的最细一档：请求 LOD0 但只有 LOD1 时给 LOD1（能看就好），
 * 反过来请求 LOD2 时不给 LOD0（省带宽）。一档都没有返回 null —— 不虚构档位。
 */
export function resolvePeopleAssetLod(
  entry: Pick<PeopleAssetEntry, 'lods'>,
  requestedLevel: number,
): PeopleAssetLod | null {
  const lods = entry.lods;
  if (!lods || lods.length === 0) return null;
  const wanted = Number.isFinite(requestedLevel) ? Math.max(0, Math.floor(requestedLevel)) : 0;
  const eligible = lods.filter((lod) => lod.level >= wanted);
  if (eligible.length > 0) {
    return eligible.reduce((best, lod) => (lod.level < best.level ? lod : best));
  }
  // 请求比所有档位都粗：退到最粗一档，而不是不给模型。
  return lods.reduce((best, lod) => (lod.level > best.level ? lod : best));
}

/**
 * 缓存键：`assetId:hash`。hash 为空返回 null —— 调用方必须当作「不可缓存」处理，
 * 否则会出现「换了资产还命中旧缓存」这种最难排查的问题。
 */
export function assetCacheKey(assetId: string, entry: Pick<PeopleAssetEntry, 'hash'>): string | null {
  if (!isNonEmptyString(assetId)) return null;
  if (!isNonEmptyString(entry.hash)) return null;
  return `${assetId}:${entry.hash}`;
}
