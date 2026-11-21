import { safeGetItem, safeSetItem } from './safe-storage';

/** 外观模式：跟随系统 / 浅色 / 深色。「跟随底图」不进本期（见 docs/plans/2026-11-19-editor-appearance-mode.md）。 */
export type AppearanceMode = 'system' | 'light' | 'dark';

/** 解析后的实际明度，供 CSS 作用域与画布外 chrome 判断使用。 */
export type ResolvedAppearance = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'scendance.appearance.v1';

export const DEFAULT_APPEARANCE_MODE: AppearanceMode = 'system';

const APPEARANCE_MODES: readonly AppearanceMode[] = ['system', 'light', 'dark'];

/** 菜单展示顺序：跟随系统 / 浅色 / 深色。 */
export const APPEARANCE_MODE_ORDER: readonly AppearanceMode[] = APPEARANCE_MODES;

/** 三档中文标签，账户菜单与其他入口共用。 */
export const APPEARANCE_LABELS: Record<AppearanceMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

/** 把存储里的任意值收窄到合法三档；非法 / 缺失回到跟随系统。 */
export function parseAppearanceMode(value: string | null | undefined): AppearanceMode {
  return APPEARANCE_MODES.includes(value as AppearanceMode) ? (value as AppearanceMode) : DEFAULT_APPEARANCE_MODE;
}

/** 读取本机外观偏好；未登录 / 隐私模式读不到时回到默认档。 */
export function readAppearanceMode(storage?: Storage): AppearanceMode {
  return parseAppearanceMode(safeGetItem(APPEARANCE_STORAGE_KEY, storage));
}

/** 写本机外观偏好；写不进（隐私模式）时只留在当前会话，不挡画布。 */
export function writeAppearanceMode(mode: AppearanceMode, storage?: Storage): void {
  safeSetItem(APPEARANCE_STORAGE_KEY, mode, storage);
}

/** 三档解析：浅色 / 深色直接命中；跟随系统按系统明度走。 */
export function resolveAppearance(mode: AppearanceMode, systemDark: boolean): ResolvedAppearance {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

/** 系统当前是否为深色方案；SSR / 无 matchMedia 环境按浅色兜底。 */
export function systemPrefersDark(media?: MediaQueryList): boolean {
  if (media) return media.matches;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
