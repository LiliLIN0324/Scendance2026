import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  bearingAfterOrbit,
  bearingSeparation,
  coalesceAnimationFrame,
  normalizeBearing,
  shouldPublishBearing,
  shouldSampleBearing,
} from '../lib/gm-compass-bearing';
import type { OutdoorPlan3DApi } from './outdoor-plan-3d';
import type { OutdoorPlanOverlayHandle } from './outdoor-plan-overlay';
import { GmCompass } from './gm-compass';

/** 宿主绘制次数。父级无关重渲不应让它增加。 */
export const gmCompassHostRenders = { count: 0 };

function releaseSlot(node: HTMLElement | null): void {
  if (!node) return;
  node.classList.remove('is-gm-rose');
  const native = node.querySelector<HTMLElement>('#tool-compass');
  native?.removeAttribute('aria-hidden');
  native?.removeAttribute('tabindex');
}

/**
 * 把圆形罗盘挂进右下角工具簇已有的 `.oc-gm-compass-wrap`。
 * 原来的指北针按钮留在 DOM 里（测试与无障碍名仍能找到），视觉与点击交给这一枚。
 * 方位按固定间隔采样；拖动增量先加到相机上，React 只在下一帧发布一次。
 * 点箭头时若相机已经跟着动了，玫瑰图用相机的实时方位，不用上次采样的旧值。
 */
export const GmCompassHost = memo(function GmCompassHost({
  active,
  mode,
  plan3dRef,
  overlayRef,
}: {
  active: boolean;
  mode: '2d' | '3d';
  plan3dRef: RefObject<OutdoorPlan3DApi | null>;
  overlayRef: RefObject<OutdoorPlanOverlayHandle | null>;
}): JSX.Element | null {
  gmCompassHostRenders.count += 1;
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [bearing, setBearing] = useState(0);
  const slotRef = useRef<HTMLElement | null>(null);
  const bearingRef = useRef(0);
  const shownRef = useRef(0);
  const publishRafRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const syncSlot = useCallback(() => {
    const next = document.querySelector<HTMLElement>('.oc-gm-compass-wrap');
    if (next === slotRef.current) return;
    releaseSlot(slotRef.current);
    slotRef.current = next;
    if (next) {
      next.classList.add('is-gm-rose');
      const native = next.querySelector<HTMLElement>('#tool-compass');
      if (native) {
        native.setAttribute('aria-hidden', 'true');
        native.tabIndex = -1;
      }
    }
    setSlot(next);
  }, []);

  const commitBearing = useCallback((next: number) => {
    const normalized = normalizeBearing(next);
    bearingRef.current = normalized;
    if (!shouldPublishBearing(shownRef.current, normalized)) return;
    shownRef.current = normalized;
    setBearing(normalized);
  }, []);

  const queueBearing = useCallback((next: number) => {
    bearingRef.current = normalizeBearing(next);
    publishRafRef.current = coalesceAnimationFrame(
      publishRafRef.current,
      (callback) => requestAnimationFrame(() => {
        publishRafRef.current = 0;
        callback();
      }),
      () => { commitBearing(bearingRef.current); },
    );
  }, [commitBearing]);

  const readLive = useCallback((): number | null => {
    const api = modeRef.current === '3d' ? plan3dRef.current : overlayRef.current;
    if (!api) return null;
    const next = api.getBearing();
    return Number.isFinite(next) ? next : null;
  }, [overlayRef, plan3dRef]);

  const turn = useCallback((delta: number, coalesce = false) => {
    const before = readLive();
    if (modeRef.current === '3d') plan3dRef.current?.orbitByDelta(delta);
    else overlayRef.current?.orbitByDelta(delta);
    const after = readLive();
    const followed = before !== null && after !== null && bearingSeparation(before, after) > 1e-4;
    const next = followed ? after : bearingAfterOrbit(bearingRef.current, delta);
    if (coalesce) queueBearing(next);
    else commitBearing(next);
  }, [commitBearing, overlayRef, plan3dRef, queueBearing, readLive]);

  useEffect(() => {
    if (!active) {
      releaseSlot(slotRef.current);
      slotRef.current = null;
      setSlot(null);
      return undefined;
    }
    let raf = 0;
    let lastSample = Number.NEGATIVE_INFINITY;
    const readBearing = (): number => {
      const next = modeRef.current === '3d'
        ? plan3dRef.current?.getBearing() ?? 0
        : overlayRef.current?.getBearing() ?? 0;
      return Number.isFinite(next) ? next : bearingRef.current;
    };
    const tick = (now: number) => {
      if (shouldSampleBearing(now, lastSample)) {
        lastSample = now;
        syncSlot();
        bearingRef.current = normalizeBearing(readBearing());
        if (!publishRafRef.current) commitBearing(bearingRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    syncSlot();
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (publishRafRef.current) cancelAnimationFrame(publishRafRef.current);
      publishRafRef.current = 0;
      releaseSlot(slotRef.current);
      slotRef.current = null;
    };
  }, [active, commitBearing, overlayRef, plan3dRef, syncSlot]);

  useEffect(() => {
    if (!active) return;
    const next = readLive();
    if (next !== null) commitBearing(next);
  }, [active, mode, commitBearing, readLive]);

  const reset = useCallback(() => {
    if (modeRef.current === '3d') plan3dRef.current?.resetNorth();
    else overlayRef.current?.resetNorth();
    const after = readLive();
    commitBearing(after ?? 0);
  }, [commitBearing, overlayRef, plan3dRef, readLive]);

  if (!active || !slot) return null;
  return createPortal(<GmCompass bearing={bearing} onOrbit={turn} onReset={reset} />, slot);
});
