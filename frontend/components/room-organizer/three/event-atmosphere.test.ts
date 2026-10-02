import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createEventAtmosphere, EVENT_ATMOSPHERE_TAG } from './event-atmosphere';

function setup() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.environmentIntensity = 0.65;
  const legacy = new THREE.DirectionalLight(0xffffff, 3);
  legacy.userData.type = 'light:directional';
  scene.add(legacy);
  const renderer = { toneMappingExposure: 1.15, shadowMap: { needsUpdate: false } } as Pick<THREE.WebGLRenderer, 'toneMappingExposure' | 'shadowMap'>;
  const atmosphere = createEventAtmosphere(THREE, scene, renderer);
  const settings = { lighting: 'warm' as const, width: 10, depth: 8, ceilingHeight: 3 };
  return { scene, legacy, renderer, atmosphere, settings };
}

describe('event atmosphere lifecycle', () => {
  it('uses actual colored light sources, with enough general fill to edit a night scene', () => {
    const { scene, legacy, renderer, atmosphere, settings } = setup();
    atmosphere.apply({ ...settings, lighting: 'cool' });
    const rig = scene.getObjectByName(EVENT_ATMOSPHERE_TAG)!;
    const spots = rig.children.filter((object): object is THREE.SpotLight => object instanceof THREE.SpotLight);
    expect(spots).toHaveLength(2);
    expect(spots[0].color.equals(spots[1].color)).toBe(false);
    expect(spots.every(light => light.intensity > 40 && light.target.parent === rig)).toBe(true);
    expect(rig.children.some(object => object instanceof THREE.PointLight && object.intensity > 20)).toBe(true);
    expect(rig.children.find(object => object instanceof THREE.HemisphereLight)).toMatchObject({ intensity: 0.72 });
    expect(scene.environmentIntensity).toBeGreaterThan(0.3);
    expect(renderer.toneMappingExposure).toBeGreaterThan(1);
    expect(legacy.visible).toBe(false);
    atmosphere.dispose();
  });

  it('switches all wire presets without accumulating lights or shadow maps', () => {
    const { scene, atmosphere, settings, renderer } = setup();
    atmosphere.apply(settings);
    const rig = scene.getObjectByName(EVENT_ATMOSPHERE_TAG)!;
    const initialObjects = [...rig.children];
    const initialBackground = scene.background;
    for (let i = 0; i < 20; i++) {
      atmosphere.apply({ ...settings, lighting: i % 2 === 0 ? 'cool' : 'neutral' });
    }
    expect(rig.children).toEqual(initialObjects);
    expect(scene.children.filter(object => object.name === EVENT_ATMOSPHERE_TAG)).toHaveLength(1);
    expect(scene.background).toBe(initialBackground);
    expect((scene.background as THREE.Color).getHex()).toBe(0xe9edf0);
    renderer.shadowMap.needsUpdate = false;
    expect(atmosphere.apply({ ...settings, lighting: 'neutral' })).toBe(false);
    expect(renderer.shadowMap.needsUpdate).toBe(false);
    atmosphere.dispose();
  });

  it('reasserts the saved atmosphere when legacy sky or lamps replace scene presentation', () => {
    const { scene, renderer, atmosphere, settings } = setup();
    atmosphere.apply(settings);
    const sky = new THREE.Texture();
    const disposeSky = vi.spyOn(sky, 'dispose');
    scene.background = sky;
    scene.environmentIntensity = 0.1;
    renderer.toneMappingExposure = 0.1;
    const lamp = new THREE.PointLight();
    lamp.userData.type = 'light:lamp';
    scene.add(lamp);
    atmosphere.apply(settings);
    expect(disposeSky).toHaveBeenCalledOnce();
    expect(lamp.visible).toBe(false);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect(scene.environmentIntensity).toBe(0.52);
    expect(renderer.toneMappingExposure).toBe(1.1);
    atmosphere.dispose();
    expect(lamp.visible).toBe(true);
  });

  it('disposes owned shadow resources exactly once and restores inherited state', () => {
    const { scene, legacy, renderer, atmosphere, settings } = setup();
    const originalBackground = scene.background;
    atmosphere.apply(settings);
    const rig = scene.getObjectByName(EVENT_ATMOSPHERE_TAG)!;
    const lightDisposals = rig.children
      .filter((object): object is THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight => object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight || object instanceof THREE.SpotLight)
      .map(light => vi.spyOn(light, 'dispose'));
    atmosphere.dispose();
    atmosphere.dispose();
    expect(lightDisposals).toHaveLength(4);
    for (const dispose of lightDisposals) expect(dispose).toHaveBeenCalledOnce();
    expect(scene.getObjectByName(EVENT_ATMOSPHERE_TAG)).toBeUndefined();
    expect(legacy.visible).toBe(true);
    expect(renderer.toneMappingExposure).toBe(1.15);
    expect(scene.environmentIntensity).toBe(0.65);
    expect(scene.background).toBe(originalBackground);
    expect(atmosphere.apply(settings)).toBe(false);
  });

  it('keeps furniture and unrelated model lights intact and outside atmosphere picking', () => {
    const { scene, atmosphere, settings } = setup();
    const furniture = new THREE.Group();
    const modelLight = new THREE.PointLight();
    furniture.add(modelLight);
    scene.add(furniture);
    atmosphere.apply(settings);
    expect(furniture.visible).toBe(true);
    expect(modelLight.visible).toBe(true);
    const hits: THREE.Intersection[] = [];
    scene.getObjectByName(EVENT_ATMOSPHERE_TAG)!.traverse(object => object.raycast(new THREE.Raycaster(), hits));
    expect(hits).toHaveLength(0);
    atmosphere.dispose();
    expect(furniture.parent).toBe(scene);
  });

  it('resizes placement and shadow coverage for venue changes without replacing its rig', () => {
    const { scene, atmosphere, settings } = setup();
    atmosphere.apply(settings);
    const rig = scene.getObjectByName(EVENT_ATMOSPHERE_TAG)!;
    const key = rig.children.find((object): object is THREE.DirectionalLight => object instanceof THREE.DirectionalLight)!;
    const beforeExtent = key.shadow.camera.right;
    atmosphere.apply({ ...settings, width: 40, depth: 30, ceilingHeight: 6 });
    expect(key.shadow.camera.right).toBeGreaterThan(beforeExtent);
    expect(rig.children.every(object => Number.isFinite(object.position.length()))).toBe(true);
    expect(scene.getObjectByName(EVENT_ATMOSPHERE_TAG)).toBe(rig);
    atmosphere.dispose();
  });
});
