import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type * as ThreeNS from 'three';
import {
  resolveSceneLighting,
  setSceneLightingOverride,
  type SceneLighting,
  type SceneLightingRecord,
} from '../three/scene-lighting';
import { createSceneLightingHud } from '../three/scene-lighting-hud';

export type UseSceneLightingParams = Readonly<{
  /** 点云已就绪且当前展示的就是它：只有这时才按实拍光照匹配。 */
  enabled: boolean;
  assetId: string;
  isReady: boolean;
  rendererRef: MutableRefObject<ThreeNS.WebGLRenderer | null>;
  invalidate(): void;
}>;

export type SceneLightingState = Readonly<{
  /** 实际交给渲染器的配置（曝光已含人工覆盖）。null = 不匹配，沿用预设光照。 */
  sceneLighting: SceneLighting | null;
  referenceExposure: number;
  override: number;
}>;

/**
 * 场景光照匹配的 React 胶水层：
 * - 按资产号解析取样 → 推导 → 交给 EventAtmosphere 覆盖主灯光与色调映射；
 * - 取样与推导只在切场景 / 点云重载时发生一次，窗口尺寸变化、每帧渲染都不重算；
 * - 左下角 ⓘ 浮层只提供曝光微调，覆盖值按场景持久化。
 */
export function useSceneLighting({
  enabled,
  assetId,
  isReady,
  rendererRef,
  invalidate,
}: UseSceneLightingParams): SceneLightingState {
  const [record, setRecord] = useState<SceneLightingRecord | null>(null);
  const [override, setOverride] = useState(1);
  const hudRef = useRef<ReturnType<typeof createSceneLightingHud> | null>(null);

  const recordRef = useRef<SceneLightingRecord | null>(null);
  recordRef.current = record;
  const overrideRef = useRef(1);
  overrideRef.current = override;
  const assetRef = useRef('');
  assetRef.current = assetId;
  const enabledRef = useRef(false);
  enabledRef.current = enabled;
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  const nudge = useCallback((delta: number) => {
    if (!enabledRef.current) return;
    const id = assetRef.current;
    const next = Math.min(2, Math.max(0.5, overrideRef.current + delta));
    if (Math.abs(next - overrideRef.current) < 0.001) return;
    overrideRef.current = next;
    setOverride(next);
    if (id) setSceneLightingOverride(id, next);
    invalidateRef.current();
  }, []);

  const reset = useCallback(() => {
    if (!enabledRef.current) return;
    overrideRef.current = 1;
    setOverride(1);
    const id = assetRef.current;
    if (id) setSceneLightingOverride(id, 1);
    invalidateRef.current();
  }, []);

  // 切场景 / 点云就绪时解析一次：命中样本缓存或持久化记录，不参与逐帧渲染。
  useEffect(() => {
    if (!enabled || !assetId) {
      setRecord(null);
      setOverride(1);
      return;
    }
    const resolved = resolveSceneLighting(assetId);
    setRecord(resolved);
    setOverride(resolved?.override ?? 1);
  }, [enabled, assetId]);

  useEffect(() => {
    if (!isReady) return undefined;
    const host = rendererRef.current?.domElement.parentElement;
    if (!host) return undefined;
    const hud = createSceneLightingHud(host, { onExposure: nudge, onReset: reset });
    hudRef.current = hud;
    const current = recordRef.current;
    hud.update({
      visible: enabledRef.current && current !== null,
      reference: current?.lighting.exposure ?? 1,
      override: overrideRef.current,
      perceived: current?.sample.perceived ?? 0,
      kelvin: current?.lighting.kelvin ?? 0,
    });
    return () => {
      hud.dispose();
      if (hudRef.current === hud) hudRef.current = null;
    };
  }, [isReady, rendererRef, nudge, reset]);

  useEffect(() => {
    hudRef.current?.update({
      visible: enabled && record !== null,
      reference: record?.lighting.exposure ?? 1,
      override,
      perceived: record?.sample.perceived ?? 0,
      kelvin: record?.lighting.kelvin ?? 0,
    });
  }, [enabled, record, override, isReady]);

  const sceneLighting = useMemo<SceneLighting | null>(() => {
    if (!record) return null;
    return { ...record.lighting, exposure: record.lighting.exposure * override };
  }, [record, override]);

  return {
    sceneLighting,
    referenceExposure: record?.lighting.exposure ?? 1,
    override,
  };
}
