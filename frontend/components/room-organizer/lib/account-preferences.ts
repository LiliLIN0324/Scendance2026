import type { DisplayUnit } from './types';

/**
 * 本机界面偏好兜底。云端账号偏好未就绪（未登录、离线、回写失败）时，按账号 ID 分档存在本机；
 * 登录成功后由云端偏好覆盖并回写本机。工程底稿始终存米，这里只存展示偏好。
 */
export interface LocalPreferences {
  unit: DisplayUnit;
  showMeasurements: boolean;
}

const STORAGE_PREFIX = 'scendance.preferences.v1:';
export const DEFAULT_LOCAL_PREFERENCES: LocalPreferences = { unit: 'm', showMeasurements: true };

export function readLocalPreferences(userId: string | null | undefined): LocalPreferences {
  if (typeof window === 'undefined') return DEFAULT_LOCAL_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + (userId || 'guest'));
    if (!raw) return DEFAULT_LOCAL_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<LocalPreferences>;
    return {
      unit: parsed.unit === 'ft' ? 'ft' : 'm',
      showMeasurements: typeof parsed.showMeasurements === 'boolean' ? parsed.showMeasurements : true,
    };
  } catch {
    return DEFAULT_LOCAL_PREFERENCES;
  }
}

export function writeLocalPreferences(userId: string | null | undefined, prefs: LocalPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + (userId || 'guest'), JSON.stringify(prefs));
  } catch {
    // 隐私模式写不进就只留在当前会话，不影响画布。
  }
}
