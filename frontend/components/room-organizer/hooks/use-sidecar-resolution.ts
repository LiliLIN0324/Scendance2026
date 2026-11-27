'use client';

import { useEffect, useRef, useState } from 'react';
import { resolveSidecarRef, type SidecarKind } from '../../../lib/sidecar-records';

/**
 * D6-2 读侧解析：plan 引用 → 独立侧车记录，空 ref 回落旧整包（只读）。
 *
 * 三态（对齐 `resolveSidecarRef`）：
 * - `pending`：首次进入、异步解析尚未回；
 * - `record`：ref 命中独立记录，`data` 为记录资料；
 * - `fallback-legacy`：ref 为空 / 匿名项目，直接用传入的旧整包字段，**不碰 IDB、不回写**；
 * - `missing`：ref 存在但记录找不到 / 属别的项目；`data` 置空，由上层标待核，不拿当前最新记录顶替。
 *
 * 旧整包仅作打开时的展示兜底；回落分支不触发任何 layout 整包回写。
 */
export type SidecarResolutionStatus = 'pending' | 'record' | 'fallback-legacy' | 'missing';

export interface SidecarResolution<T> {
  status: SidecarResolutionStatus;
  data: T | undefined;
}

export function useSidecarResolution<T>(input: {
  projectId: string;
  kind: SidecarKind;
  refId?: string | undefined;
  legacyFallback?: T | undefined;
}): SidecarResolution<T> {
  const { projectId, kind, refId, legacyFallback } = input;
  // legacy 兜底走 ref 跟随最新传入值，避免对象引用变化触发重复解析。
  const legacyRef = useRef<T | undefined>(input.legacyFallback);
  legacyRef.current = input.legacyFallback;
  const [state, setState] = useState<SidecarResolution<T>>({ status: 'pending', data: input.legacyFallback as T | undefined });

  useEffect(() => {
    let alive = true;
    const scopeId = projectId.trim();
    const reference = refId?.trim();
    // 匿名/空项目或空 ref：同步回落旧整包，不进 IDB；兜底值变化时跟随刷新。
    if (!scopeId || !reference) {
      setState({ status: 'fallback-legacy', data: legacyRef.current });
      return;
    }
    void (async () => {
      try {
        const result = await resolveSidecarRef({
          projectId: scopeId,
          kind,
          refId: reference,
          // fallback-legacy 原样透传兜底值，类型由调用方泛型收窄。
          legacyFallback: legacyRef.current as never,
        });
        if (!alive) return;
        if (result.status === 'missing') setState({ status: 'missing', data: undefined });
        else setState({ status: result.status, data: result.data as T | undefined });
      } catch {
        // 读取异常不顶替当前记录，回落旧整包只读展示。
        if (alive) setState({ status: 'fallback-legacy', data: legacyRef.current });
      }
    })();
    return () => { alive = false; };
  }, [projectId, kind, refId, legacyFallback]);

  return state;
}
