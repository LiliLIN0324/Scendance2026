import type * as ThreeNS from 'three';
import type { SceneLighting } from './scene-lighting';

type ThreeModule = typeof import('three');

/**
 * 编辑器 3D 视图、只读分享查看器、导出 PNG 共用的唯一色彩/光照档案。
 *
 * 以前三处各自写死一套：编辑器是 ACES + 渐变天空 + 半球/环境光，
 * 查看器是 NoToneMapping + 纯色底 + 白半球光，于是同一套家具在编辑器里
 * 饱和通透、在查看器和导出的 PNG 里发灰。现在参数只在这里定义一次，
 * 三处都从这里读：改曝光或色温只改这一个文件。
 */

export type EventLighting = 'neutral' | 'warm' | 'cool';

export interface LookPreset {
  /** 背景渐变的地平线色。 */
  readonly background: number;
  /** 背景渐变的天顶色（比地平线深，才有纵深）。 */
  readonly skyZenith: number;
  readonly sky: number;
  readonly ground: number;
  readonly key: number;
  readonly keyIntensity: number;
  readonly hemisphere: number;
  readonly ambient: number;
  readonly spots: readonly [number, number];
  readonly spotStrength: number;
  readonly accent: number;
  readonly accentStrength: number;
  readonly environment: number;
  readonly exposure: number;
}

/** 三套预设是同一色彩管线下仅有的差异：色温与亮度档位。 */
export const LOOK_PRESETS: Record<EventLighting, LookPreset> = {
  neutral: {
    background: 0xe9edf0, skyZenith: 0xb9d2ea, sky: 0xe7f1ff, ground: 0xd8d7d2,
    key: 0xfff4de, keyIntensity: 2.1, hemisphere: 1.35, ambient: 0.18,
    spots: [0xffedda, 0xe2efff], spotStrength: 1.8,
    accent: 0xffedd5, accentStrength: 0.5, environment: 0.7, exposure: 1.05,
  },
  warm: {
    background: 0xf7f3e8, skyZenith: 0xc9dcf2, sky: 0xffdfb0, ground: 0xbfa383,
    key: 0xffd09a, keyIntensity: 1.55, hemisphere: 1.05, ambient: 0.22,
    spots: [0xffbc79, 0xffdfb5], spotStrength: 3.4,
    accent: 0xffa767, accentStrength: 1.8, environment: 0.52, exposure: 1.1,
  },
  cool: {
    background: 0x1d2440, skyZenith: 0x0e1226, sky: 0xa3bfff, ground: 0x947eac,
    key: 0xd1ddff, keyIntensity: 0.72, hemisphere: 0.72, ambient: 0.28,
    spots: [0x8496ff, 0xe894ff], spotStrength: 5.4,
    accent: 0xffc38a, accentStrength: 2.6, environment: 0.35, exposure: 1.18,
  },
} as const;

/**
 * 没有显式选择灯光时的默认色温。编辑器、查看器、导出都读这一个值：
 * 否则编辑器默认 warm、查看器默认 neutral，同一套家具在两处会差一档色温。
 */
export const DEFAULT_EVENT_LIGHTING: EventLighting = 'warm';

/** 首帧的基准曝光/环境强度：取 neutral 预设值，使事件光照架挂载前后不跳色。 */
export const BASE_EXPOSURE = LOOK_PRESETS.neutral.exposure;
export const BASE_ENVIRONMENT_INTENSITY = LOOK_PRESETS.neutral.environment;

/** 三处共享的阴影设置；查看器不再用已废弃的 PCFSoftShadowMap。 */
export const SHADOW_LOOK = Object.freeze({
  type: 'pcf',
  mapSize: 2048,
  bias: -0.00025,
  normalBias: 0.035,
});

/**
 * 把预设（可选地被实拍场景匹配结果覆盖）摊平成一组可直接写进灯与渲染器的数字。
 * `matched` 只替换亮度/色温相关项，背景渐变仍按预设走。
 */
export interface ResolvedLook {
  readonly exposure: number;
  readonly environment: number;
  readonly background: number;
  readonly skyZenith: number;
  readonly sky: number;
  readonly ground: number;
  readonly hemisphere: number;
  readonly ambientColor: number;
  readonly ambient: number;
  readonly keyColor: number;
  readonly key: number;
  readonly spotColors: readonly [number, number];
  readonly spotStrength: number;
  readonly accentColor: number;
  readonly accentStrength: number;
}

export function resolveLook(
  lighting: EventLighting,
  matched?: SceneLighting | null
): ResolvedLook {
  const preset = LOOK_PRESETS[lighting] ?? LOOK_PRESETS.neutral;
  if (!matched) {
    return {
      exposure: preset.exposure,
      environment: preset.environment,
      background: preset.background,
      skyZenith: preset.skyZenith,
      sky: preset.sky,
      ground: preset.ground,
      hemisphere: preset.hemisphere,
      ambientColor: preset.sky,
      ambient: preset.ambient,
      keyColor: preset.key,
      key: preset.keyIntensity,
      spotColors: preset.spots,
      spotStrength: preset.spotStrength,
      accentColor: preset.accent,
      accentStrength: preset.accentStrength,
    };
  }
  return {
    exposure: matched.exposure,
    environment: matched.envIntensity,
    background: preset.background,
    skyZenith: preset.skyZenith,
    sky: matched.hemisphere.sky,
    ground: matched.hemisphere.ground,
    hemisphere: matched.hemisphere.intensity,
    ambientColor: matched.ambient.color,
    ambient: matched.ambient.intensity,
    keyColor: matched.sun.color,
    key: matched.sun.intensity,
    spotColors: preset.spots,
    // 实拍照片已经定义了色温，再叠人工色光就假：匹配时关掉色光。
    spotStrength: 0,
    accentColor: preset.accent,
    accentStrength: 0,
  };
}

type LookRenderer = Pick<
  ThreeNS.WebGLRenderer,
  'outputColorSpace' | 'toneMapping' | 'toneMappingExposure' | 'shadowMap'
>;

/**
 * 唯一允许设置渲染器色彩管线的地方。三处调用后行为一致：
 * ACES 色调映射 + sRGB 输出 + 共享阴影类型。
 */
export function applyRendererLook(THREE: ThreeModule, renderer: LookRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = BASE_EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

/**
 * 1×256 竖向天顶→地平线渐变 DataTexture。纯字节构造，浏览器里画面一致，
 * 也不依赖 canvas，方便单测。
 * WebGL 纹理从底部开始（buffer 上传忽略 flipY），所以第 0 行是地平线。
 */
export function makeBackdropTexture(
  THREE: ThreeModule,
  zenith: number,
  horizon: number
): ThreeNS.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * 4);
  for (let y = 0; y < size; y++) {
    const t = 1 - y / (size - 1);
    // 地平线在下三分之一处多留一点，辉光落在真正读得到纵深的地面线上。
    const blend = t < 0.65 ? (t / 0.65) * 0.7 : 0.7 + ((t - 0.65) / 0.35) * 0.3;
    const mixed = mixPresetHex(zenith, horizon, blend);
    data[y * 4] = (mixed >> 16) & 0xff;
    data[y * 4 + 1] = (mixed >> 8) & 0xff;
    data[y * 4 + 2] = mixed & 0xff;
    data[y * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 1, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function mixPresetHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t);
  return (ch(ar, br) << 16) | (ch(ag, bg) << 8) | ch(ab, bb);
}

/** 主光位置：编辑器与查看器都用这一个，避免两侧明暗方向相反。 */
export function placeKeyLight(
  key: ThreeNS.DirectionalLight,
  width: number,
  depth: number,
  height: number
): void {
  key.position.set(width * 0.4, Math.max(height * 2.4, width * 0.75), depth * 0.3);
  key.target.position.set(0, 0, 0);
  const extent = Math.max(width, depth) * 0.7 + 2;
  Object.assign(key.shadow.camera, {
    left: -extent, right: extent, top: extent, bottom: -extent,
    far: Math.max(60, extent * 5),
  });
  key.shadow.camera.updateProjectionMatrix();
}

/** 两盏色光的机位：左右各一盏，略高于人眼，打向地面内侧。 */
export function placeWashLights(
  spots: readonly [ThreeNS.SpotLight, ThreeNS.SpotLight],
  width: number,
  depth: number,
  height: number
): void {
  for (const [index, light] of spots.entries()) {
    const direction = index === 0 ? -1 : 1;
    light.position.set(direction * width * 0.34, height * 0.94, -depth * 0.32);
    light.target.position.set(direction * width * 0.16, 0, depth * 0.13);
    light.distance = Math.max(width, depth, height) * 2;
  }
}

/** 暖色点光机位：正前方柱前，作为最后一层补色。 */
export function placeAccentLight(
  accent: ThreeNS.PointLight,
  width: number,
  depth: number,
  height: number
): void {
  accent.position.set(0, height * 0.62, depth * 0.32);
  accent.distance = Math.max(width, depth, height) * 1.5;
}
