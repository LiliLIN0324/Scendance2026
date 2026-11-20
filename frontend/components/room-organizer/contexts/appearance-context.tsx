'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import {
  readAppearanceMode,
  resolveAppearance,
  systemPrefersDark,
  writeAppearanceMode,
  type AppearanceMode,
  type ResolvedAppearance,
} from '../lib/appearance';

export interface AppearanceContextValue {
  /** 用户选择的档位：跟随系统 / 浅色 / 深色。 */
  readonly mode: AppearanceMode;
  /** 解析后的实际明度。 */
  readonly resolved: ResolvedAppearance;
  readonly isDark: boolean;
  /** 切换档位并落本机；不回写云端偏好。 */
  readonly setMode: (mode: AppearanceMode) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within an AppearanceProvider');
  return ctx;
}

/** 面板在缺少 Provider 的测试壳 / 独立挂载下取用；返回 null 时外观降级浅色。 */
export function useAppearanceOptional(): AppearanceContextValue | null {
  return useContext(AppearanceContext);
}

/** 挂在 <body> 上的暗色标记；设置对话框 portal 到 body，靠这个 class 一起进暗色作用域。 */
export const APPEARANCE_BODY_DARK_CLASS = 'is-theme-dark';

export function AppearanceProvider({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setModeState] = useState<AppearanceMode>(() => readAppearanceMode());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // 跟随系统档：订阅 OS 明度变化；显式浅色 / 深色时不依赖这个回调。
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveAppearance(mode, systemDark);
  const isDark = resolved === 'dark';

  const setMode = (next: AppearanceMode) => {
    writeAppearanceMode(next);
    setModeState(next);
  };

  // 编辑器 chunk 为客户端加载，首帧前在 useLayoutEffect 同步 body class，避免闪烁；
  // 卸载时移除标记，营销页 / 登录页不残留暗色。
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle(APPEARANCE_BODY_DARK_CLASS, isDark);
    return () => {
      document.body.classList.remove(APPEARANCE_BODY_DARK_CLASS);
    };
  }, [isDark]);

  const value = useMemo<AppearanceContextValue>(
    () => ({ mode, resolved, isDark, setMode }),
    [mode, resolved, isDark],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
