import type { StudioSettings } from '../../../../supabase/functions/_shared/plan-editor';

/** 新建活动时同步读取最近一次拉到的团队默认。拉不到就当没有，不挡画布。 */
let cached: { studioId: string; settings: StudioSettings } | null = null;
const listeners = new Set<() => void>();

export function rememberStudioSettings(studioId: string, settings: StudioSettings): void {
  cached = { studioId, settings };
  for (const listener of listeners) listener();
}

export function readStudioSettingsCache(studioId?: string): StudioSettings | null {
  if (!cached) return null;
  if (studioId && cached.studioId !== studioId) return null;
  return cached.settings;
}

export function subscribeStudioSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
