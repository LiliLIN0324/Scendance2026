/**
 * 分享链接快照编解码（H5-b）——纯函数，无 DOM。
 *
 * 本地演示形态：快照经 URL `#snapshot=<base64url JSON>` 传递（无后端时可完整走通
 * 「生成链接 → 打开只读页」闭环）；生产接线归 B（快照表+token 撤销失效），
 * 页面消费的 SitePlanSnapshot 契约与生产一致。
 */

import { sitePlanSnapshotSchema, type SitePlanSnapshot } from '../../../../supabase/functions/_shared/site-plan';

/** base64url 编码（URL 片段安全，无 +/=）。 */
export function encodeSnapshot(snapshot: SitePlanSnapshot): string {
  const json = JSON.stringify(snapshot);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 宽容解码：损坏/非法载荷返回 null（分享页如实展示「已失效」）。 */
export function decodeSnapshot(encoded: string): SitePlanSnapshot | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = sitePlanSnapshotSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 从 hash（`#snapshot=...`）读取；无匹配返回 null。 */
export function readSnapshotFromHash(hash: string): SitePlanSnapshot | null {
  const match = hash.match(/#snapshot=([A-Za-z0-9\-_]+)/);
  if (!match) return null;
  return decodeSnapshot(match[1]);
}

/** 生成本地分享链接（当前 origin + 路径 + hash）。 */
export function buildShareLink(snapshot: SitePlanSnapshot, origin = '', pathname = '/plan-share'): string {
  return `${origin}${pathname}#snapshot=${encodeSnapshot(snapshot)}`;
}