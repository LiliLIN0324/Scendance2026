import { iconModelSlugs } from './icon-model-links';
import type { LibraryEntry } from './oneplan-library';
import type { OneplanStickerDescriptor } from './oneplan-stickers';

/** Only show a sticker when this GLB is explicitly linked to it in the object library. */
export function planStickerForModel(
  model: { slug: string },
  entries: readonly LibraryEntry[],
): OneplanStickerDescriptor | null {
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
  return match?.sticker ?? null;
}
