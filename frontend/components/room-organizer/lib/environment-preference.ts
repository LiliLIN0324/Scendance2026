/**
 * 本场环境是按项目记住的观感层：不写进场景文件，也不参与云端保存，
 * 只用本机这条偏好让同一个项目下次打开时自动挂回同一片点云。
 * 资产号来自随站点发布的样例或本机取回的环境包，名字只用于抽屉里的那行说明。
 */
export interface StoredEnvironment {
  assetId: string;
  name: string;
}

const STORAGE_KEY = 'scendance:environment:v1';
const MAX_ENTRIES = 200;

function isStoredEnvironment(value: unknown): value is StoredEnvironment {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.assetId === 'string' && entry.assetId.length > 0 && entry.assetId.length <= 120 &&
    typeof entry.name === 'string' && entry.name.length <= 120;
}

function readAll(): Record<string, StoredEnvironment> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isStoredEnvironment(value)));
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, StoredEnvironment>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 配额满了只是这次记不住环境，画布照常挂，不打断编辑。
  }
}

export function environmentPreferenceKey(layoutId: string | undefined): string {
  return layoutId ?? 'draft';
}

export function readEnvironment(layoutId: string | undefined): StoredEnvironment | null {
  return readAll()[environmentPreferenceKey(layoutId)] ?? null;
}

export function writeEnvironment(layoutId: string | undefined, value: StoredEnvironment): void {
  const all = readAll();
  const key = environmentPreferenceKey(layoutId);
  const entries = { ...all, [key]: value };
  const keys = Object.keys(entries);
  if (keys.length > MAX_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[stale];
  }
  writeAll(entries);
}

export function clearEnvironment(layoutId: string | undefined): void {
  const all = readAll();
  const key = environmentPreferenceKey(layoutId);
  if (!(key in all)) return;
  delete all[key];
  writeAll(all);
}
