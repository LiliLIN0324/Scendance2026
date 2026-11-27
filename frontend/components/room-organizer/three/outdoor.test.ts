import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LOT_MARGIN, LOT_TO_PAVEMENT, PAVEMENT_DEPTH, ROAD_DEPTH } from '../lib/site';
import { applyOutdoorWeather, outdoorGroundColor, setOutdoorVisible } from './outdoor';

const WIDTH = 8;
const DEPTH = 8;
const outdoor = (scene: THREE.Scene) => scene.children.filter((obj) => obj.userData.type === 'outdoor');

const groundMesh = (scene: THREE.Scene) =>
  outdoor(scene).find((obj) => obj.userData.role === 'ground') as THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshStandardMaterial
  >;
const planeMeshes = (scene: THREE.Scene) =>
  outdoor(scene).filter(
    (obj) => obj instanceof THREE.Mesh && !(obj instanceof THREE.InstancedMesh) && obj.geometry instanceof THREE.PlaneGeometry
  );
const groups = (scene: THREE.Scene) => outdoor(scene).filter((obj) => obj instanceof THREE.Group);
const instanced = (scene: THREE.Scene) => outdoor(scene).filter((obj) => obj instanceof THREE.InstancedMesh);

const cylinderTopRadius = (mesh: THREE.InstancedMesh): number | undefined =>
  (mesh.geometry as THREE.CylinderGeometry).parameters?.radiusTop;
const sphereRadius = (mesh: THREE.InstancedMesh): number | undefined =>
  (mesh.geometry as THREE.SphereGeometry).parameters?.radius;

describe('flat lot baseline (T1 shell retirement)', () => {
  it('builds a flat grass plane at ground datum, with no slope or excavation mesh', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);

    const grass = groundMesh(scene);
    expect(grass.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(grass.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(grass.position.y).toBeCloseTo(-0.05);

    // The only plane meshes are grass, sidewalk and road — no sloped terrain or cut-earth face.
    expect(planeMeshes(scene)).toHaveLength(3);
  });

  it('keeps the outdoor landscaping: tufts, sidewalk, road, dashes, stones, trees, shrubs, flowers', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);

    const meshes = instanced(scene);
    // Grass tufts (0.18 sphere), road dashes (1.2 × 0.18 plane), stepping stones (0.32 cylinder),
    // shrubs (0.45 sphere), flower blossoms (0.07 sphere) and stems (0.012 cylinder).
    expect(meshes.some((m) => sphereRadius(m) === 0.18)).toBe(true);
    expect(meshes.some((m) => m.geometry instanceof THREE.PlaneGeometry)).toBe(true);
    expect(meshes.some((m) => cylinderTopRadius(m) === 0.32)).toBe(true);
    expect(meshes.some((m) => sphereRadius(m) === 0.45)).toBe(true);
    expect(meshes.some((m) => sphereRadius(m) === 0.07)).toBe(true);
    expect(meshes.some((m) => cylinderTopRadius(m) === 0.012)).toBe(true);

    expect(groups(scene).length).toBeGreaterThan(0);
  });

  it('spawns no roof, neighbour-house or entrance-porch shell meshes', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);

    const tags = outdoor(scene).map((obj) => obj.userData.type);
    expect(tags).not.toContain('roof');
    expect(tags).not.toContain('neighbour');
    // The old porch reveals were tagged with the north wall id; the lot adds none.
    expect(outdoor(scene).some((obj) => obj.userData.wallId === 'north')).toBe(false);
  });

  it('keeps a flat datum lot: trees sit on datum, garden frontage stays fixed', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);

    const grass = groundMesh(scene);
    expect(grass.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(outdoor(scene).some((obj) => obj.userData.type === 'roof' || obj.userData.type === 'neighbour')).toBe(false);

    // Trees sit on the datum, not lifted onto a slope.
    for (const tree of groups(scene)) {
      expect(tree.position.y).toBeCloseTo(0);
    }

    // Garden frontage is fixed: stepping stones and front flowers are still planted.
    const meshes = instanced(scene);
    expect(meshes.some((m) => cylinderTopRadius(m) === 0.32)).toBe(true);
    expect(meshes.some((m) => sphereRadius(m) === 0.07)).toBe(true);

    // Road sits past the lot with a front garden, not flush to the front wall.
    const halfD = DEPTH / 2;
    const roadOffset = halfD + LOT_MARGIN + LOT_TO_PAVEMENT;
    const roadZ = -(roadOffset + PAVEMENT_DEPTH + ROAD_DEPTH / 2);
    const road = planeMeshes(scene)
      .filter((p) => p.position.z < 0)
      .reduce((a, b) => (b.position.z < a.position.z ? b : a));
    expect(road.position.z).toBeCloseTo(roadZ);
  });
});

describe('weather ground tint (#189)', () => {
  const grass = (scene: THREE.Scene) => groundMesh(scene);
  const roadColor = (scene: THREE.Scene) => ((road(scene) as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex();
  const luma = (hex: number) => ((hex >> 16) & 0xff) + ((hex >> 8) & 0xff) + (hex & 0xff);

  function road(scene: THREE.Scene): THREE.Object3D {
    return planeMeshes(scene).filter((p) => p.position.z < 0).reduce((a, b) => (b.position.z < a.position.z ? b : a));
  }

  it('the lot is built with the untouched grass colour by default', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    expect(grass(scene).material.color.getHex()).toBe(0x7cb04a);
    expect(outdoorGroundColor('clear')).toBe(0x7cb04a);
  });

  it('snow lightens the grass, rain darkens it, clear restores it', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    applyOutdoorWeather(scene, 'snow');
    expect(grass(scene).material.color.getHex()).toBe(outdoorGroundColor('snow'));
    expect(luma(outdoorGroundColor('snow'))).toBeGreaterThan(luma(outdoorGroundColor('clear')));
    applyOutdoorWeather(scene, 'rain');
    expect(luma(grass(scene).material.color.getHex())).toBeLessThan(luma(outdoorGroundColor('clear')));
    applyOutdoorWeather(scene, 'clear');
    expect(grass(scene).material.color.getHex()).toBe(0x7cb04a);
  });

  it('a lot rebuilt after the weather was set comes back tinted (the lighting effect does not re-run)', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    applyOutdoorWeather(scene, 'snow');
    setOutdoorVisible(THREE, scene, true, WIDTH + 2, DEPTH);
    expect(grass(scene).material.color.getHex()).toBe(outdoorGroundColor('snow'));
  });

  it('tints the grass only, never the road', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    const before = roadColor(scene);
    applyOutdoorWeather(scene, 'snow');
    expect(roadColor(scene)).toBe(before);
  });
});
