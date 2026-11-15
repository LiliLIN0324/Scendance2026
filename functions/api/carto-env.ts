/**
 * Carto Basemaps（Pages 运行时）：key 只留在服务端环境变量，浏览器一律走 /api/carto-tiles 同源代理。
 *
 * 为什么不再用 NEXT_PUBLIC_CARTO_KEY 编译期内联：Next 静态导出（output: 'export'）把
 * NEXT_PUBLIC_* 烤进 JS，而 Cloudflare Pages 的构建镜像不注入项目环境变量 ⇒ 每次 CI 重建
 * 都会静默产出无 key 包。Carto 2026-09-23 起强制 key，且无 key 的请求仍然回 HTTP 200，
 * 内容是「API KEY REQUIRED」灰底水印图 —— 底图看上去就是「断了」。
 * 改成运行时代理后，换 key / 续期只改 Pages 环境变量，不用重新构建前端包。
 */

export interface CartoServerEnv {
  /** 推荐名：Pages 项目 → Settings → Environment variables（运行时），不是 Build command。 */
  CARTO_KEY?: string;
  /** 兼容别名：部分项目把底图 key 叫 API key；与 CARTO_KEY 同义。 */
  CARTO_API_KEY?: string;
  /** 兼容旧名：只在没人配 CARTO_KEY 时兜底；不要写进构建命令指望它进浏览器。 */
  NEXT_PUBLIC_CARTO_KEY?: string;
}

export function cartoKeyFromEnv(env: CartoServerEnv): string {
  return (env.CARTO_KEY ?? '').trim()
    || (env.CARTO_API_KEY ?? '').trim()
    || (env.NEXT_PUBLIC_CARTO_KEY ?? '').trim();
}

/** 只报「哪个名字有值」，绝不回值：用来区分「变量没生效」与「变量名不对/加错环境」。 */
export function cartoKeyNamesPresent(env: CartoServerEnv): Record<'CARTO_KEY' | 'CARTO_API_KEY' | 'NEXT_PUBLIC_CARTO_KEY', boolean> {
  return {
    CARTO_KEY: Boolean((env.CARTO_KEY ?? '').trim()),
    CARTO_API_KEY: Boolean((env.CARTO_API_KEY ?? '').trim()),
    NEXT_PUBLIC_CARTO_KEY: Boolean((env.NEXT_PUBLIC_CARTO_KEY ?? '').trim()),
  };
}

/** Carto 只有浅色 / 深色两档底图，style 直接拼进上游路径 `{style}_all`。 */
export const CARTO_TILE_STYLES = ['light', 'dark'] as const;
export type CartoTileStyle = (typeof CARTO_TILE_STYLES)[number];

export function isCartoTileStyle(raw: string | null | undefined): raw is CartoTileStyle {
  return !!raw && (CARTO_TILE_STYLES as readonly string[]).includes(raw);
}

/** Carto 原生支持到 z21（再往里由画布 overzoom 拉伸，见 outdoor-plan-canvas 的 mapMaxZoomFor）。 */
export const CARTO_TILE_MAX_ZOOM = 21;

/**
 * 瓦片坐标校验：z 0–21，x/y 落在 [0, 2^z)。
 * 空串 / 非数字一律拒绝（`Number(null) === 0`，不先挡会把缺参当成 0/0/0 合法瓦片）。
 */
export function parseCartoTileCoord(
  zRaw: string | null,
  xRaw: string | null,
  yRaw: string | null,
): { z: number; x: number; y: number } | null {
  if (zRaw === null || xRaw === null || yRaw === null) return null;
  if (!/^\d{1,2}$/.test(zRaw) || !/^\d{1,10}$/.test(xRaw) || !/^\d{1,10}$/.test(yRaw)) return null;
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (z > CARTO_TILE_MAX_ZOOM) return null;
  const span = 2 ** z;
  if (x >= span || y >= span) return null;
  return { z, x, y };
}

/** Carto 单瓦片上游 URL。key 只在服务端拼接，永不回给浏览器。 */
export function cartoTileUrl(style: CartoTileStyle, z: number, x: number, y: number, key: string): string {
  const url = new URL(`https://a.basemaps.cartocdn.com/${style}_all/${z}/${x}/${y}.png`);
  url.searchParams.set('key', key);
  return url.toString();
}

export type CartoWatermarkHashes = Readonly<Record<CartoTileStyle, readonly string[]>>;

/**
 * Carto 对「无 key / key 失效」的瓦片回 HTTP 200 + 同一张灰底水印图（"API KEY REQUIRED"）。
 * 2026-11-16 实测：同风格跨 z12 / z15 字节完全一致（light 2049 B、dark 2513 B）。
 * 按 SHA-256 识别：宁可回占位块并带上 `X-Carto-Fallback`，也不把水印当底图静默降级。
 */
export const CARTO_WATERMARK_SHA256: CartoWatermarkHashes = {
  light: ['69be4aecf9f814ba45d585801a5aa41e79b16fc88eafec5b1954a9f06a69e6be'],
  dark: ['cc3f31364a735d9a8179af36b3db7617cdff8bdb0248654ebcc3df91607abedc'],
};

/** 水印图固定 2–3 KB；超过这个尺寸的响应不必再哈希。 */
const WATERMARK_MAX_BYTES = 16 * 1024;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function isCartoWatermark(
  bytes: ArrayBuffer,
  style: CartoTileStyle,
  hashes: CartoWatermarkHashes = CARTO_WATERMARK_SHA256,
): Promise<boolean> {
  if (bytes.byteLength > WATERMARK_MAX_BYTES) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return hashes[style].includes(toHex(digest));
}
