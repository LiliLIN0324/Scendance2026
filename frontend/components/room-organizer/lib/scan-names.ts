/**
 * 实景扫描的显示名。
 *
 * 2026-11-19 用户：「线上可以看到这种莫名其妙的形式。改掉。没有其他和我的区分。这些都是我们的云资产」。
 * 历史导入把没名字的扫描存成「本机高斯 48245ba8」，云端登记又把它改写成「云端高斯 48245ba8」——
 * 前缀讲的是它从哪台机器来、后 8 位是资产号，两样都不该出现在给客户看的列表里。
 * 这里统一收口：占位名一律换成按落盘日期起的「实景扫描 11/08」，用户自己起的名字原样保留，
 * 也不再按「本机 / 云端」分家——库里的每一份都是我们的云资产。
 */

const ORIGIN = '(?:本机|云端|本地|云)';
const KIND = '(?:高斯|场景|扫描|实景)';
const HASH = '[0-9a-f]{6,}(?:[-\\s][0-9a-f]{2,})*';
/** 「本机高斯 48245ba8」「云端高斯 6645e211」「高斯 9587c51d」这类纯机器名。 */
const PLACEHOLDER = new RegExp(`^${ORIGIN}?\\s*${KIND}?\\s*${HASH}$`, 'i');
/** 「云端高斯 ⋯」这种带来源前缀的写法；只在前缀后紧跟类别词时去掉，免得误伤「云栖小镇」。 */
const ORIGIN_PREFIX = new RegExp(`^${ORIGIN}\\s*${KIND}\\s*`);
/** 由本模块按日期补出来的名字（同一天会撞车，列表里再加序号）。 */
const GENERATED_NAME = /^实景扫描(?:$|\s)/;

function dateName(savedAt?: number): string {
  return scanDayLabel(savedAt) ? `实景扫描 ${scanDayLabel(savedAt)}` : '实景扫描';
}

/** 落盘日期（月/日）；没有时间就返回空串，不编日期。 */
export function scanDayLabel(savedAt?: number): string {
  if (!savedAt || !Number.isFinite(savedAt)) return '';
  return new Date(savedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

/** 占位名换成日期名；有真名就只去掉来源前缀。 */
export function readableScanName(raw: string | undefined, savedAt?: number): string {
  const name = (raw ?? '').trim();
  if (!name || PLACEHOLDER.test(name)) return dateName(savedAt);
  const stripped = name.replace(ORIGIN_PREFIX, '').trim();
  if (!stripped || PLACEHOLDER.test(stripped)) return dateName(savedAt);
  return stripped;
}

/** 名字是不是由 readableScanName 补出来的日期名。 */
export function isGeneratedScanName(name: string): boolean {
  return GENERATED_NAME.test(name);
}

/** 同一天的两份扫描不撞车：第二份起加序号；用户自己起的名字不参与。 */
export function withScanNameOrdinal(name: string, seen: Map<string, number>): string {
  const count = (seen.get(name) ?? 0) + 1;
  seen.set(name, count);
  return count > 1 ? `${name} · ${count}` : name;
}
