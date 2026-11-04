import type * as ThreeNS from 'three';
import type { SceneLighting } from './scene-lighting';
import {
  LOOK_PRESETS as PRESETS,
  makeBackdropTexture,
  placeAccentLight,
  placeKeyLight,
  placeWashLights,
  resolveLook,
  type EventLighting,
} from './render-look';

export type { EventLighting };
type ThreeModule = typeof import('three');
type AtmosphereRenderer = Pick<ThreeNS.WebGLRenderer, 'toneMappingExposure' | 'shadowMap'>;

export interface EventAtmosphereOptions {
  lighting: EventLighting;
  width: number;
  depth: number;
  ceilingHeight: number;
  /** 实拍场景匹配出来的光照：有值时压过预设的曝光与三盏主灯。 */
  sceneLighting?: SceneLighting;
}

export interface EventAtmosphere {
  /** Reassert the saved presentation after the legacy time-of-day effect. */
  apply(options: EventAtmosphereOptions): boolean;
  dispose(): void;
}

export const EVENT_ATMOSPHERE_TAG = 'event-atmosphere';

// 预设与背景渐变纹理都来自 render-look.ts：编辑器、查看器、导出共用一份，
// 这里只负责把它们装进场景并处理遗留天空/灯具的隐藏与还原。

function dimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100) : fallback;
}

/**
 * One reusable rig per editor scene. None of its objects are furniture or
 * pointer targets. Only the inherited time-of-day lights are hidden, so a
 * model's own emissive materials and unrelated scene objects stay intact.
 */
export function createEventAtmosphere(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  renderer: AtmosphereRenderer
): EventAtmosphere {
  const rig = new THREE.Group();
  rig.name = EVENT_ATMOSPHERE_TAG;
  rig.userData.type = EVENT_ATMOSPHERE_TAG;
  const hemisphere = new THREE.HemisphereLight();
  const ambient = new THREE.AmbientLight();
  const key = new THREE.DirectionalLight();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.035;
  key.shadow.camera.near = 0.1;
  const spots = [new THREE.SpotLight(), new THREE.SpotLight()] as const;
  const accent = new THREE.PointLight();
  // The directional key owns the only additional shadow map. Colored wash
  // lights do not need three extra shadow passes on a laptop or mobile GPU.
  for (const light of spots) {
    light.angle = Math.PI / 3.1;
    light.penumbra = 0.8;
    light.decay = 2;
    rig.add(light, light.target);
  }
  rig.add(hemisphere, ambient, key, key.target, accent);
  rig.traverse(object => { object.raycast = () => {}; });
  scene.add(rig);

  // The rig's own backdrop texture; rebuilt when the preset changes and
  // disposed with the rig. A gradient keeps the depth a flat colour loses.
  let backgroundTexture: ThreeNS.DataTexture | null = null;
  const inheritedBackground = scene.background;
  // Legacy sky textures are replaced, not kept as an invisible GPU resource.
  // A neutral color is sufficient when this editor-owned rig is unmounted.
  const restoreBackground = inheritedBackground && 'isTexture' in inheritedBackground
    ? new THREE.Color(0xe9edf0)
    : inheritedBackground;
  const priorExposure = renderer.toneMappingExposure;
  const priorEnvironment = scene.environmentIntensity;
  const hidden = new Map<ThreeNS.Object3D, boolean>();
  let previousSignature = '';
  let previousPreset: (typeof PRESETS)[EventLighting] | null = null;
  // 实际写进渲染器的曝光/环境强度：退出时要按这两个值判断还原，
  // 不能用预设值，否则实拍匹配调过曝光后会还不了原。
  let appliedExposure: number | null = null;
  let appliedEnvironment: number | null = null;
  let disposed = false;

  function apply(options: EventAtmosphereOptions): boolean {
    if (disposed) return false;
    const { lighting } = options;
    const preset = PRESETS[lighting] ?? PRESETS.neutral;
    const matched = options.sceneLighting;
    const width = dimension(options.width, 10);
    const depth = dimension(options.depth, 8);
    const height = Math.max(2, Math.min(dimension(options.ceilingHeight, 3), 12));
    const look = resolveLook(lighting, matched);
    const exposure = look.exposure;
    const environment = look.environment;
    // 实拍匹配参数也算进签名，否则改曝光/换场景不会触发重设。
    const matchKey = matched
      ? `${matched.exposure}/${matched.envIntensity}/${matched.ambient.color}/${matched.hemisphere.sky}/${matched.hemisphere.ground}/${matched.sun.color}`
      : 'auto';
    const signature = `${lighting}:${width}:${depth}:${height}:${matchKey}`;
    let changed = signature !== previousSignature;

    // The old lighting effect may install a new sky texture or lamp after
    // loading a project. Release that texture immediately and reassert this
    // rig without recreating its lights, targets or shadow resources.
    if (!backgroundTexture || previousPreset !== preset) {
      if (backgroundTexture) backgroundTexture.dispose();
      backgroundTexture = makeBackdropTexture(THREE, preset.skyZenith, preset.background);
    }
    if (scene.background !== backgroundTexture) {
      if (scene.background && 'isTexture' in scene.background) scene.background.dispose();
      scene.background = backgroundTexture;
      changed = true;
    }
    for (const object of scene.children) {
      const tag: unknown = object.userData.type;
      if (typeof tag !== 'string' || (!tag.startsWith('light:') && !tag.startsWith('sky:'))) continue;
      if (!hidden.has(object)) hidden.set(object, object.visible);
      if (object.visible) changed = true;
      object.visible = false;
    }
    // Drop objects removed by the legacy effect so moving lamps cannot make
    // this bookkeeping retain an unbounded collection of dead scene nodes.
    for (const node of hidden.keys()) if (!node.parent) hidden.delete(node);

    if (scene.environmentIntensity !== environment || renderer.toneMappingExposure !== exposure) changed = true;
    scene.environmentIntensity = environment;
    renderer.toneMappingExposure = exposure;
    appliedExposure = exposure;
    appliedEnvironment = environment;

    if (signature !== previousSignature) {
      hemisphere.color.setHex(look.sky);
      hemisphere.groundColor.setHex(look.ground);
      hemisphere.intensity = look.hemisphere;
      ambient.color.setHex(look.ambientColor);
      ambient.intensity = look.ambient;
      key.color.setHex(look.keyColor);
      key.intensity = look.key;
      placeKeyLight(key, width, depth, height);

      for (const [index, light] of spots.entries()) {
        light.color.setHex(look.spotColors[index] ?? look.spotColors[0]);
        light.intensity = look.spotStrength * height * height;
      }
      placeWashLights(spots, width, depth, height);
      accent.color.setHex(look.accentColor);
      accent.intensity = look.accentStrength * height * height;
      accent.decay = 2;
      placeAccentLight(accent, width, depth, height);
      previousSignature = signature;
      previousPreset = preset;
    }
    if (changed) renderer.shadowMap.needsUpdate = true;
    return changed;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene.remove(rig);
    for (const [object, visible] of hidden) if (object.parent) object.visible = visible;
    hidden.clear();
    for (const light of [key, ...spots, accent]) light.dispose();
    // Do not overwrite a replacement scene presentation installed by someone
    // else between this rig's final apply and cleanup.
    if (scene.background === backgroundTexture) scene.background = restoreBackground;
    if (backgroundTexture) { backgroundTexture.dispose(); backgroundTexture = null; }
    if (appliedExposure !== null && renderer.toneMappingExposure === appliedExposure) renderer.toneMappingExposure = priorExposure;
    if (appliedEnvironment !== null && scene.environmentIntensity === appliedEnvironment) scene.environmentIntensity = priorEnvironment;
    renderer.shadowMap.needsUpdate = true;
  }

  return { apply, dispose };
}
