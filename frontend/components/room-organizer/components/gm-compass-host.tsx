import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  bearingAfterOrbit,
  bearingSeparation,
  coalesceAnimationFrame,
  easeOutCubic,
  normalizeBearing,
  prefersReducedRoseMotion,
  roseSpinDurationMs,
  shouldPublishBearing,
  shouldSampleBearing,
  shortestOrbitDelta,
} from '../lib/gm-compass-bearing';
import type { OutdoorPlan3DApi } from './outdoor-plan-3d';
import type { OutdoorPlanOverlayHandle } from './outdoor-plan-overlay';
import { GmCompass } from './gm-compass';

/** 宿主绘制次数。父级无关重渲不应让它增加。 */
export const gmCompassHostRenders = { count: 0 };

type RoseAnim = {
  raf: number;
  start: number | null;
  duration: number;
  totalDelta: number;
  applied: number;
  startBearing: number;
  onComplete?: () => void;
};

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
 * 点箭头或回正北时，地图和玫瑰图一起缓动，避免只转指针而对不齐。
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
  const animRef = useRef<RoseAnim | null>(null);
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

  const commitBearing = useCallback((next: number, force = false) => {
    const normalized = normalizeBearing(next);
    bearingRef.current = normalized;
    if (!force && !shouldPublishBearing(shownRef.current, normalized)) return;
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

  const applyOrbit = useCallback((delta: number) => {
    if (modeRef.current === '3d') plan3dRef.current?.orbitByDelta(delta);
    else overlayRef.current?.orbitByDelta(delta);
  }, [overlayRef, plan3dRef]);

  const stopAnim = useCallback((finish = false) => {
    const anim = animRef.current;
    if (!anim) return;
    if (anim.raf) cancelAnimationFrame(anim.raf);
    if (finish) {
      const rest = anim.totalDelta - anim.applied;
      if (rest) applyOrbit(rest);
      const after = readLive();
      commitBearing(after ?? bearingAfterOrbit(anim.startBearing, anim.totalDelta), true);
      anim.onComplete?.();
    }
    animRef.current = null;
  }, [applyOrbit, commitBearing, readLive]);

  const startOrbitAnim = useCallback((delta: number, onComplete?: () => void) => {
    if (!delta || !Number.isFinite(delta)) {
      onComplete?.();
      return;
    }
    const current = animRef.current;
    let totalDelta = delta;
    let startBearing = readLive() ?? bearingRef.current;
    if (current) {
      const remaining = current.totalDelta - current.applied;
      startBearing = readLive() ?? bearingAfterOrbit(current.startBearing, current.applied);
      totalDelta = remaining + delta;
      if (current.raf) cancelAnimationFrame(current.raf);
      animRef.current = null;
    }
    if (prefersReducedRoseMotion() || roseSpinDurationMs(totalDelta) === 0) {
      applyOrbit(totalDelta);
      const after = readLive();
      const followed = after !== null && bearingSeparation(startBearing, after) > 1e-4;
      commitBearing(followed ? after : bearingAfterOrbit(startBearing, totalDelta));
      onComplete?.();
      return;
    }
    const anim: RoseAnim = {
      raf: 0,
      start: null,
      duration: roseSpinDurationMs(totalDelta),
      totalDelta,
      applied: 0,
      startBearing,
      onComplete,
    };
    const tick = (now: number) => {
      const live = animRef.current;
      if (live !== anim) return;
      if (anim.start === null) anim.start = now;
      const t = Math.min(1, (now - anim.start) / Math.max(anim.duration, 1));
      const desired = anim.totalDelta * easeOutCubic(t);
      const inc = desired - anim.applied;
      if (inc) {
        applyOrbit(inc);
        anim.applied = desired;
      }
      if (t < 1) {
        const after = readLive();
        const followed = after !== null && bearingSeparation(anim.startBearing, after) > 1e-4;
        commitBearing(followed ? after : bearingAfterOrbit(anim.startBearing, desired));
        anim.raf = requestAnimationFrame(tick);
        return;
      }
      const target = bearingAfterOrbit(anim.startBearing, anim.totalDelta);
      const rest = anim.totalDelta - anim.applied;
      if (rest) applyOrbit(rest);
      anim.applied = anim.totalDelta;
      const after = readLive();
      if (after !== null) {
        const corr = shortestOrbitDelta(after, target);
        if (Math.abs(corr) > 1e-8) applyOrbit(corr);
      }
      commitBearing(target, true);
      animRef.current = null;
      anim.onComplete?.();
    };
    animRef.current = anim;
    anim.raf = requestAnimationFrame(tick);
  }, [applyOrbit, commitBearing, readLive]);

  const turn = useCallback((delta: number, coalesce = false) => {
    if (coalesce) {
      stopAnim(false);
      const before = readLive();
      applyOrbit(delta);
      const after = readLive();
      const followed = before !== null && after !== null && bearingSeparation(before, after) > 1e-4;
      const next = followed ? after : bearingAfterOrbit(bearingRef.current, delta);
      queueBearing(next);
      return;
    }
    startOrbitAnim(delta);
  }, [applyOrbit, queueBearing, readLive, startOrbitAnim, stopAnim]);

  useEffect(() => {
    if (!active) {
      stopAnim(false);
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
        if (!publishRafRef.current && !animRef.current) commitBearing(bearingRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    syncSlot();
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (publishRafRef.current) cancelAnimationFrame(publishRafRef.current);
      publishRafRef.current = 0;
      stopAnim(false);
      releaseSlot(slotRef.current);
      slotRef.current = null;
    };
  }, [active, commitBearing, overlayRef, plan3dRef, stopAnim, syncSlot]);

  useEffect(() => {
    if (!active) return;
    stopAnim(false);
    const next = readLive();
    if (next !== null) commitBearing(next);
  }, [active, mode, commitBearing, readLive, stopAnim]);

  const reset = useCallback(() => {
    const from = readLive() ?? bearingRef.current;
    const delta = shortestOrbitDelta(from, 0);
    const finish = () => {
      if (modeRef.current === '3d') plan3dRef.current?.resetNorth();
      else overlayRef.current?.resetNorth();
      const after = readLive();
      commitBearing(after ?? 0);
    };
    if (Math.abs(delta) < 1e-4) {
      finish();
      return;
    }
    startOrbitAnim(delta, finish);
  }, [commitBearing, overlayRef, plan3dRef, readLive, startOrbitAnim]);

  if (!active || !slot) return null;
  return createPortal(<GmCompass bearing={bearing} onOrbit={turn} onReset={reset} />, slot);
});
