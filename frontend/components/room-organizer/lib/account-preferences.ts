import { parseLengthPrecisionM, type LengthPrecisionM } from '../../../../supabase/functions/_shared/plan-editor';
import type { DisplayUnit } from './types';

/**
 * 本机界面偏好兜底。云端账号偏好未就绪（未登录、离线、回写失败）时，按账号 ID 分档存在本机；
 * 登录成功后由云端已有的键覆盖，缺的键留本机值。工程底稿始终存米，这里只存展示与吸附偏好。
 */
export interface LocalPreferences {
  unit: DisplayUnit;
  showMeasurements: boolean;
  /** 长度读数按这个米制步长取整后再换算。0.01 即两位小数。 */
  lengthPrecisionM: LengthPrecisionM;
  snapToGrid: boolean;
  snapToWall: boolean;
  snapToItems: boolean;
}

const STORAGE_PREFIX = 'scendance.preferences.v1:';
export const DEFAULT_LOCAL_PREFERENCES: LocalPreferences = {
  unit: 'm',
  showMeasurements: true,
  lengthPrecisionM: 0.01,
  snapToGrid: false,
  snapToWall: false,
  snapToItems: false,
};

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function preferencesFromPartial(value: Partial<LocalPreferences> | null | undefined, fallback: LocalPreferences = DEFAULT_LOCAL_PREFERENCES): LocalPreferences {
  return {
    unit: value?.unit === 'ft' ? 'ft' : value?.unit === 'm' ? 'm' : fallback.unit,
    showMeasurements: booleanOr(value?.showMeasurements, fallback.showMeasurements),
    lengthPrecisionM: parseLengthPrecisionM(value?.lengthPrecisionM) ?? fallback.lengthPrecisionM,
    snapToGrid: booleanOr(value?.snapToGrid, fallback.snapToGrid),
    snapToWall: booleanOr(value?.snapToWall, fallback.snapToWall),
    snapToItems: booleanOr(value?.snapToItems, fallback.snapToItems),
  };
}

/**
 * 云端缺键回退本机，不回退产品默认。否则这台机器刚打开的吸附，会被一份旧云端记录清掉。
 */
export function mergeRemotePreferences(local: LocalPreferences, remote: Partial<LocalPreferences> | null | undefined): LocalPreferences {
  if (!remote) return local;
  return {
    unit: remote.unit === 'ft' || remote.unit === 'm' ? remote.unit : local.unit,
    showMeasurements: typeof remote.showMeasurements === 'boolean' ? remote.showMeasurements : local.showMeasurements,
    lengthPrecisionM: parseLengthPrecisionM(remote.lengthPrecisionM) ?? local.lengthPrecisionM,
    snapToGrid: typeof remote.snapToGrid === 'boolean' ? remote.snapToGrid : local.snapToGrid,
    snapToWall: typeof remote.snapToWall === 'boolean' ? remote.snapToWall : local.snapToWall,
    snapToItems: typeof remote.snapToItems === 'boolean' ? remote.snapToItems : local.snapToItems,
  };
}

export function readLocalPreferences(userId: string | null | undefined): LocalPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_LOCAL_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + (userId || 'guest'));
    if (!raw) return { ...DEFAULT_LOCAL_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<LocalPreferences>;
    return preferencesFromPartial(parsed);
  } catch {
    return { ...DEFAULT_LOCAL_PREFERENCES };
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
