import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export type EventLighting = NonNullable<RoomLayout['backendLighting']>;
type ThreeModule = typeof import('three');
type AtmosphereRenderer = Pick<ThreeNS.WebGLRenderer, 'toneMappingExposure' | 'shadowMap'>;

export interface EventAtmosphereOptions {
  lighting: EventLighting;
  width: number;
  depth: number;
  ceilingHeight: number;
}

export interface EventAtmosphere {
  /** Reassert the saved presentation after the legacy time-of-day effect. */
  apply(options: EventAtmosphereOptions): boolean;
  dispose(): void;
}

export const EVENT_ATMOSPHERE_TAG = 'event-atmosphere';

// Wire values are the backend's existing neutral / warm / cool enum. These
// presets change actual scene illumination; no CSS filter or external HDR.
const PRESETS = {
  neutral: {
    background: 0xe9edf0, sky: 0xe7f1ff, ground: 0xd8c5ac,
    key: 0xfff4de, keyIntensity: 2.1, hemisphere: 1.35, ambient: 0.18,
    spots: [0xffedda, 0xe2efff], spotStrength: 1.8,
    accent: 0xffedd5, accentStrength: 0.5, environment: 0.7, exposure: 1.05,
  },
  warm: {
    background: 0xe4d9cc, sky: 0xffdfb0, ground: 0xbfa383,
    key: 0xffd09a, keyIntensity: 1.55, hemisphere: 1.05, ambient: 0.22,
    spots: [0xffbc79, 0xffdfb5], spotStrength: 3.4,
    accent: 0xffa767, accentStrength: 1.8, environment: 0.52, exposure: 1.1,
  },
  cool: {
    background: 0x171b30, sky: 0xa3bfff, ground: 0x947eac,
    key: 0xd1ddff, keyIntensity: 0.72, hemisphere: 0.72, ambient: 0.28,
    spots: [0x8496ff, 0xe894ff], spotStrength: 5.4,
    accent: 0xffc38a, accentStrength: 2.6, environment: 0.35, exposure: 1.18,
  },
} as const satisfies Record<EventLighting, unknown>;

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

  const background = new THREE.Color();
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
  let disposed = false;

  function apply(options: EventAtmosphereOptions): boolean {
    if (disposed) return false;
    const { lighting } = options;
    const preset = PRESETS[lighting];
    const width = dimension(options.width, 10);
    const depth = dimension(options.depth, 8);
    const height = Math.max(2, Math.min(dimension(options.ceilingHeight, 3), 12));
    const signature = `${lighting}:${width}:${depth}:${height}`;
    let changed = signature !== previousSignature;

    // The old lighting effect may install a new sky texture or lamp after
    // loading a project. Release that texture immediately and reassert this
    // rig without recreating its lights, targets or shadow resources.
    if (scene.background !== background) {
      if (scene.background && 'isTexture' in scene.background) scene.background.dispose();
      scene.background = background;
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
    for (const object of hidden.keys()) if (!object.parent) hidden.delete(object);

    if (scene.environmentIntensity !== preset.environment || renderer.toneMappingExposure !== preset.exposure) changed = true;
    scene.environmentIntensity = preset.environment;
    renderer.toneMappingExposure = preset.exposure;

    if (signature !== previousSignature) {
      background.setHex(preset.background);
      hemisphere.color.setHex(preset.sky);
      hemisphere.groundColor.setHex(preset.ground);
      hemisphere.intensity = preset.hemisphere;
      ambient.color.setHex(preset.sky);
      ambient.intensity = preset.ambient;
      key.color.setHex(preset.key);
      key.intensity = preset.keyIntensity;
      key.position.set(width * 0.4, Math.max(height * 2.4, width * 0.75), depth * 0.3);
      key.target.position.set(0, 0, 0);
      const extent = Math.max(width, depth) * 0.7 + 2;
      Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: Math.max(60, extent * 5) });
      key.shadow.camera.updateProjectionMatrix();

      for (const [index, light] of spots.entries()) {
        const direction = index === 0 ? -1 : 1;
        light.color.setHex(preset.spots[index]);
        light.position.set(direction * width * 0.34, height * 0.94, -depth * 0.32);
        light.target.position.set(direction * width * 0.16, 0, depth * 0.13);
        light.distance = Math.max(width, depth, height) * 2;
        light.intensity = preset.spotStrength * height * height;
      }
      accent.color.setHex(preset.accent);
      accent.position.set(0, height * 0.62, depth * 0.32);
      accent.distance = Math.max(width, depth, height) * 1.5;
      accent.intensity = preset.accentStrength * height * height;
      accent.decay = 2;
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
    if (scene.background === background) scene.background = restoreBackground;
    if (previousPreset && renderer.toneMappingExposure === previousPreset.exposure) renderer.toneMappingExposure = priorExposure;
    if (previousPreset && scene.environmentIntensity === previousPreset.environment) scene.environmentIntensity = priorEnvironment;
    renderer.shadowMap.needsUpdate = true;
  }

  return { apply, dispose };
}
