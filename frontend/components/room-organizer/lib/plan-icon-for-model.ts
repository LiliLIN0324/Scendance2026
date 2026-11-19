import { iconModelSlugs } from './icon-model-links';
import type { LibraryEntry } from './oneplan-library';
import type { OneplanStickerDescriptor } from './oneplan-stickers';

/**
 * 这颗 GLB 唯一命中的物件库条目；没有登记就返回 null（卡片不画角标）。
 *
 * 卡片需要两样东西：贴纸（画什么）和主题色（角标染成物料的颜色），
 * 所以这里把命中的条目整条交出去，`planStickerForModel` 只是取它的 sticker。
 */
export function planEntryForModel(
  model: { slug: string },
  entries: readonly LibraryEntry[],
): LibraryEntry | null {
  let match: LibraryEntry | undefined;
  let bestScore = -1;
  for (const entry of entries) {
    if (entry.slug.endsWith('-rotated')) continue;
    const index = iconModelSlugs(entry.slug, entry.kind).indexOf(model.slug);
    if (index === -1) continue;
    const score = (index === 0 ? 2 : 0) + (entry.kind === 'scale' ? 1 : 0);
    if (score > bestScore) {
      match = entry;
      bestScore = score;
    }
  }
  return match ?? null;
}

/** Only show a sticker when this GLB is explicitly linked to it in the object library. */
export function planStickerForModel(
  model: { slug: string },
  entries: readonly LibraryEntry[],
): OneplanStickerDescriptor | null {
  return planEntryForModel(model, entries)?.sticker ?? null;
}
