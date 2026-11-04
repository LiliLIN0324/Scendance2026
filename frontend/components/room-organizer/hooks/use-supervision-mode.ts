'use client';

/**
 * 第 8 批 Y2：监督三档开关。
 *
 * - strict   严格：每件写入都确认（每步写入前弹确认）。
 * - checkpoint 关键节点（默认）：现状——预览→确认，不在每件写时打断。
 * - auto     自动：指纹门无冲突直放，有冲突才弹（复用现有 preview-guard / layout-fingerprint）。
 *
 * 选择持久化到 localStorage key `scendance.supervision.mode`，跨标签页同步。
 */
import { useCallback, useEffect, useState } from 'react';

export type SupervisionMode = 'strict' | 'checkpoint' | 'auto';

export const SUPERVISION_STORAGE_KEY = 'scendance.supervision.mode';

export const SUPERVISION_MODES: ReadonlyArray<{ value: SupervisionMode; label: string; hint: string }> = [
  { value: 'strict', label: '严格', hint: '每件家具摆放前都会问你' },
  { value: 'checkpoint', label: '关键节点', hint: '在计划步骤和大范围改动前询问' },
  { value: 'auto', label: '自动', hint: '无冲突直接放置，有冲突才问你' },
];

const VALID: ReadonlySet<string> = new Set(SUPERVISION_MODES.map(m => m.value));

function readStored(): SupervisionMode {
  if (typeof window === 'undefined') return 'checkpoint';
  try {
    const raw = window.localStorage.getItem(SUPERVISION_STORAGE_KEY);
    if (raw && VALID.has(raw)) return raw as SupervisionMode;
  } catch {
    /* 无痕模式：回到默认档。 */
  }
  return 'checkpoint';
}

function writeStored(mode: SupervisionMode): void {
  try {
    window.localStorage.setItem(SUPERVISION_STORAGE_KEY, mode);
  } catch {
    /* 配额满：内存里改了就算，不落盘。 */
  }
}

/**
 * 读 / 写监督档。
 * - 初始值从 localStorage 取，默认 'checkpoint'。
 * - 切换档位时写回 localStorage 并广播。
 * - 监听 storage 事件，跨标签页同步。
 */
export function useSupervisionMode(): readonly [SupervisionMode, (next: SupervisionMode) => void] {
  const [mode, setModeState] = useState<SupervisionMode>(readStored);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== SUPERVISION_STORAGE_KEY) return;
      const next = event.newValue;
      if (next && VALID.has(next)) setModeState(next as SupervisionMode);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setMode = useCallback((next: SupervisionMode) => {
    setModeState(next);
    writeStored(next);
  }, []);

  return [mode, setMode] as const;
}
