import type { ScannedVenue } from './venue-scans';

/**
 * 场景库对话能直接做的事：拍一场、生成一场、照片重建、把本机扫描加进本场。
 * 认不出来的句子一律交给主 Agent（brief 抽取 + 真模型），这里不自己瞎猜。
 */
export type SceneIntent =
  | { kind: 'capture' }
  | { kind: 'generate' }
  | { kind: 'reconstruct' }
  | { kind: 'add-scans'; venues: ScannedVenue[] }
  | { kind: 'agent' };

/** 「加入」这类动词单独出现不算数（加两把椅子是加物料），必须同时说得出是哪一场。 */
const ADD_VERBS = ['加入', '加进', '加到', '添加', '加进来', '换上', '引入'];

/** 归一化：空格与分隔符都不算，名字怎么打都认得出同一场。 */
function normalize(text: string): string {
  return text.replace(/[\s·・.,，。、:：]/g, '').toLowerCase();
}

export function matchSceneIntent(text: string, scans: readonly ScannedVenue[]): SceneIntent {
  const flat = normalize(text);
  if (!flat) return { kind: 'agent' };
  if (flat.includes('重建')) return { kind: 'reconstruct' };
  if (flat.includes('生成')) return { kind: 'generate' };
  if (/拍摄|采集|实拍|拍一段|拍场地/.test(flat)) return { kind: 'capture' };
  if (ADD_VERBS.some(verb => flat.includes(verb))) {
    if (/全部|所有|每场|每个|都加/.test(flat) && scans.length) {
      return { kind: 'add-scans', venues: [...scans] };
    }
    const hits = scans.filter(venue => {
      const name = normalize(venue.name);
      const short = venue.assetId.replace(/-/g, '').slice(0, 8).toLowerCase();
      return name.length > 1 && (flat.includes(name) || flat.includes(short));
    });
    if (hits.length) return { kind: 'add-scans', venues: hits };
  }
  return { kind: 'agent' };
}
