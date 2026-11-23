/**
 * P4-d：二维平面选过的底图，三维地面跟着用同一张（用户 m02033）。
 *
 * 平面画布与三维场景不共享 React 状态（一个在覆盖层、一个在场景 effect 里），
 * 所以这里放一个极小的模块级偏好：平面切了底图就写进来，三维贴地时读出来。
 * 记下的是底图选择（地图 / 卫星 / 浅色 / 纸面）和该选择的唯一图源 id。
 * 旧的全球卫星、天地图、Carto 深色、OSM 在读出时收成这一个 id，不再另铺一套瓦片。
 */

import {
  BASEMAP_STYLE_STORAGE_KEY,
  canonicalPlanGroundSource,
  isWorkbenchImageryStyle,
  styleFromProvider,
  WORKBENCH_BASEMAP_SOURCE,
  type WorkbenchBasemapStyle,
  type WorkbenchImageryStyle,
} from './basemap-style';
import type { PlanGroundSource } from './plan-ground-capture';

const STORAGE_KEY = 'scendance-plan-basemap-source-v1';

export const PLAN_GROUND_SOURCES: readonly PlanGroundSource[] = [
  'osm',
  'carto-light',
  'carto-dark',
  'amap-satellite',
  'amap-streets',
  'amap-streets-labels',
  'esri-satellite',
];

export function isPlanGroundSource(value: unknown): value is PlanGroundSource {
  return typeof value === 'string' && (PLAN_GROUND_SOURCES as readonly string[]).includes(value);
}

let cached: PlanGroundSource | null = null;

const listeners = new Set<() => void>();

/**
 * 订阅图源偏好变化（主舞台 GeoGround effect 用 useSyncExternalStore 消费）。
 * 返回退订函数。
 */
export function subscribePlanGroundSource(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readStyleKey(): WorkbenchImageryStyle | null {
  try {
    const stored = globalThis.localStorage?.getItem(BASEMAP_STYLE_STORAGE_KEY);
    return isWorkbenchImageryStyle(stored) ? stored : null;
  } catch {
    return null;
  }
}

function persistStyleKey(style: WorkbenchImageryStyle): void {
  try {
    globalThis.localStorage?.setItem(BASEMAP_STYLE_STORAGE_KEY, style);
  } catch {
    // 存不下就算了，本会话内仍然生效。
  }
}

function persistProvider(source: PlanGroundSource): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, source);
  } catch {
    // 存不下就算了，本会话内仍然生效。
  }
}

export function readPlanGroundSource(): PlanGroundSource {
  if (cached) return cached;
  // 已记下的选择优先于旧的图源 id。否则「卫星」仍可能从 esri-satellite 读出来，
  // 和评审页按同一种选择解析出的高德卫星不是一张图。
  const styled = readStyleKey();
  if (styled) {
    cached = WORKBENCH_BASEMAP_SOURCE[styled];
    persistProvider(cached);
    return cached;
  }
  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  // 缺省用高德街道：高德瓦片是 GCJ-02 网格、与场地锚点同坐标系，
  // 不需 key 且带 CORS 头（见 tdt-probe.ts）。
  const canonical = isPlanGroundSource(stored) ? canonicalPlanGroundSource(stored) : 'amap-streets';
  cached = canonical;
  persistProvider(canonical);
  persistStyleKey(styleFromProvider(canonical));
  return canonical;
}

export function writePlanGroundSource(value: string | null | undefined): void {
  if (!isPlanGroundSource(value)) return;
  // 全球卫星 / Carto 深色 / OSM 等旧 id 收成该选择的唯一源，避免再记成第二种卫星。
  const canonical = canonicalPlanGroundSource(value);
  const changed = cached !== canonical;
  cached = canonical;
  persistProvider(canonical);
  persistStyleKey(styleFromProvider(canonical));
  if (changed) listeners.forEach((listener) => listener());
}

/**
 * 当前记下的底图选择。纸面看地面形态；否则看选择键，没有键时从（已收束的）图源 id 归类。
 * 评审链接和工作台图层都该读这个，而不是各自猜图源。
 */
export function readRecordedBasemapStyle(): WorkbenchBasemapStyle {
  if (readPlanGroundMode() === 'paper') return 'paper';
  return readStyleKey() ?? styleFromProvider(readPlanGroundSource());
}

/** 把一种选择写进偏好：纸面只改形态；其余三种同时写下唯一图源 id。 */
export function writeRecordedBasemapStyle(style: WorkbenchBasemapStyle): void {
  if (style === 'paper') {
    writePlanGroundMode('paper');
    return;
  }
  persistStyleKey(style);
  writePlanGroundMode('map');
  writePlanGroundSource(WORKBENCH_BASEMAP_SOURCE[style]);
}

/** 测试用：丢掉图源与形态的模块级缓存（localStorage 由用例自己清）。 */
export function resetPlanBasemapSourceCacheForTest(): void {
  cached = null;
  cachedMode = null;
}

/* ---------------- 地面形态（docs/46 V-P1）：真地图 / 纸面（虚拟场地） ---------------- */

/**
 * 2026-11-17 docs/46 V-P1：地面形态偏好——`map` = 铺图源瓦片，`paper` = 纸面（虚拟场地）。
 * 与图源同一套模块级 store 口径：2D 覆盖层的「纸面」开关写进来，3D 地面（主舞台
 * GeoGround / 户外接管 OutdoorPlan3D）经 useSyncExternalStore 订阅——纸面态不铺瓦片，
 * 落素面地面。独立 key：图源切换不改变形态，形态切换不改图源。
 */

const MODE_STORAGE_KEY = 'scendance-plan-ground-mode-v1';

export type PlanGroundMode = 'map' | 'paper';

export const PLAN_GROUND_MODES: readonly PlanGroundMode[] = ['map', 'paper'];

export function isPlanGroundMode(value: unknown): value is PlanGroundMode {
  return value === 'map' || value === 'paper';
}

let cachedMode: PlanGroundMode | null = null;

const modeListeners = new Set<() => void>();

export function subscribePlanGroundMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

export function readPlanGroundMode(): PlanGroundMode {
  if (cachedMode) return cachedMode;
  try {
    const stored = globalThis.localStorage?.getItem(MODE_STORAGE_KEY);
    if (isPlanGroundMode(stored)) {
      cachedMode = stored;
      return stored;
    }
  } catch {
    // 隐私模式 / 无 localStorage 时用缺省。
  }
  cachedMode = 'map';
  return 'map';
}

export function writePlanGroundMode(value: string | null | undefined): void {
  if (!isPlanGroundMode(value)) return;
  const changed = cachedMode !== value;
  cachedMode = value;
  try {
    globalThis.localStorage?.setItem(MODE_STORAGE_KEY, value);
  } catch {
    // 存不下就算了，本会话内仍然生效。
  }
  if (changed) modeListeners.forEach((listener) => listener());
}