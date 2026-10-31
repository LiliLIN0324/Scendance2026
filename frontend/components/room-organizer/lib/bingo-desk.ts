/**
 * Bingo 桌上的待评条目。发出评审链接时记一笔，供左侧 Bingo 面板列出。
 * 收藏另存一份 id。回执仍走 review-return，这里不复制那份状态。
 */
export const BINGO_DESK_KEY = 'scendance.bingoDesk.v1';
export const BINGO_FAVORITE_KEY = 'scendance.bingoFavorites.v1';
const MAX_ENTRIES = 40;

export interface BingoDeskEntry {
  id: string;
  title: string;
  href: string;
  planKey: string;
  markedAt: string;
}

type DeskStore = Pick<Storage, 'getItem' | 'setItem'>;

export function readBingoReviews(storage: Pick<Storage, 'getItem'> | null): BingoDeskEntry[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(BINGO_DESK_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return [];
    const entries: BingoDeskEntry[] = [];
    for (const value of parsed) {
      const entry = parseEntry(value);
      if (entry) entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

export function rememberBingoReview(
  storage: DeskStore,
  input: { title: string; href: string; planKey: string; now?: Date; id?: string },
): BingoDeskEntry | null {
  const planKey = clip(input.planKey, 80);
  const href = clip(input.href, 2000);
  if (!planKey || !href.startsWith('/') && !href.startsWith('http')) return null;
  const entry: BingoDeskEntry = {
    id: input.id && clip(input.id, 80) ? clip(input.id, 80) : newId(),
    title: clip(input.title, 80) || '未命名活动',
    href,
    planKey,
    markedAt: (input.now ?? new Date()).toISOString(),
  };
  const rest = readBingoReviews(storage).filter(item => item.planKey !== entry.planKey);
  try {
    storage.setItem(BINGO_DESK_KEY, JSON.stringify([entry, ...rest].slice(0, MAX_ENTRIES)));
  } catch {
    return null;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('scendance-bingo'));
  return entry;
}

export function readBingoFavorites(storage: Pick<Storage, 'getItem'> | null): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(BINGO_FAVORITE_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80);
  } catch {
    return [];
  }
}

export function toggleBingoFavorite(storage: DeskStore, id: string): string[] {
  const key = clip(id, 80);
  if (!key) return readBingoFavorites(storage);
  const current = readBingoFavorites(storage);
  const next = current.includes(key) ? current.filter(item => item !== key) : [key, ...current].slice(0, MAX_ENTRIES);
  try {
    storage.setItem(BINGO_FAVORITE_KEY, JSON.stringify(next));
  } catch {
    return current;
  }
  return next;
}

function parseEntry(value: unknown): BingoDeskEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.href !== 'string' || typeof record.planKey !== 'string') return null;
  if (typeof record.markedAt !== 'string') return null;
  const id = clip(record.id, 80);
  const href = clip(record.href, 2000);
  const planKey = clip(record.planKey, 80);
  if (!id || !href || !planKey) return null;
  return {
    id,
    title: typeof record.title === 'string' && clip(record.title, 80) ? clip(record.title, 80) : '未命名活动',
    href,
    planKey,
    markedAt: record.markedAt,
  };
}

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

function newId(): string {
  return crypto.randomUUID();
}
