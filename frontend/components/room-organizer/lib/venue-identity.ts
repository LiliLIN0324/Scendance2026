import { MAX_NAME_LENGTH } from './schema';
import type { RoomLayout } from './types';

/**
 * 落位只补场地身份，不动尺寸。
 *
 * 2026-11-22 用户拍板：点卡片落位只定位置，宽深仍须人工核验，不再开第二条
 * 「悄悄改场地」的路径。
 *
 * 但身份必须写回 `layout.venueScan`：导出、分享、发布闸门、项目清单
 * （`lib/project-manifest.ts`）、场尺基准（`lib/venue-scale-basis.ts`）读的都是它。
 * 只写本机环境偏好（`scendance:environment:v1`）的话，换浏览器、清缓存、
 * 换设备就只剩一张空白场地。
 *
 * 返回 `null` 表示不需要写（同一套已经记在布局里），调用方据此避免每拖一次
 * 位置就往撤销历史里多压一条。
 */
export function venueIdentityPatch(
  layout: RoomLayout,
  venue: Readonly<{ assetId: string; name?: string }>,
): RoomLayout | null {
  const assetId = typeof venue.assetId === 'string' ? venue.assetId.trim() : '';
  if (!assetId) return null;
  if (layout.venueScan?.assetId === assetId) return null;
  const trimmed = typeof venue.name === 'string' ? venue.name.trim() : '';
  // schema 允许空名，但空名在卡片与导出里都读不出是哪一场，退回资产号更诚实。
  const name = (trimmed || assetId).slice(0, MAX_NAME_LENGTH);
  return { ...layout, venueScan: { assetId, name } };
}
