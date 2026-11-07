import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPerson } from './builders/builders-people';
import {
  advancePeopleAnimations,
  personAnimIds,
  personIsAnimated,
  personOdometer,
  registerPersonAnim,
  setPersonWalkContext,
} from './people-anim';
import { type PeopleModel, preparePeopleModel, setPeopleModelForTests } from './people-model';
import type { FurnitureItem, WalkRoute } from '../lib/types';

let model: PeopleModel | null = null;
async function loadAsset(): Promise<PeopleModel> {
  if (model) return model;
  const bytes = readFileSync(fileURLToPath(new URL('../assets/people.glb', import.meta.url)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  model = preparePeopleModel(THREE, gltf.scene, gltf.animations, cloneSkinned);
  return model;
}

const scene = new THREE.Scene();
const adult: FurnitureItem = {
  id: 'p1',
  type: 'person',
  name: 'Adult',
  width: 0.5,
  depth: 0.3,
  height: 1.75,
  color: '#8FA3BF',
  position: { x: 4, z: 4 },
} as FurnitureItem;

const loopRoute: WalkRoute = {
  points: [
    { x: 2, z: 2 },
    { x: 5, z: 2 },
    { x: 5, z: 5 },
    { x: 2, z: 5 },
  ],
};

const STEP = 1 / 60;
function tick(seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) advancePeopleAnimations(STEP);
}

function buildAndMount(item: FurnitureItem): THREE.Group {
  const group = buildPerson({ THREE, item, hasCollision: false, baseColor: item.color, opacity: 1 });
  scene.add(group);
  return group;
}

afterEach(() => {
  scene.clear();
  setPersonWalkContext(null);
  advancePeopleAnimations(STEP); // 清空场景后走一帧，注册表把脱离的实例摘干净
});

describe('personIsAnimated', () => {
  it('opts in only for routed, action-changed or paused persons', () => {
    expect(personIsAnimated(loopRoute, undefined, undefined)).toBe(true);
    expect(personIsAnimated({ points: [{ x: 0, z: 0 }] }, undefined, undefined)).toBe(false);
    expect(personIsAnimated(undefined, 'talk', undefined)).toBe(true);
    expect(personIsAnimated(undefined, 'walk', undefined)).toBe(true);
    expect(personIsAnimated(undefined, 'idle', undefined)).toBe(false);
    expect(personIsAnimated(undefined, undefined, true)).toBe(true);
    expect(personIsAnimated(undefined, undefined, undefined)).toBe(false);
  });
});

describe('rigged person animation registry', () => {
  it('keeps plain persons out of the registry (static mannequin, as before)', async () => {
    setPeopleModelForTests(await loadAsset());
    buildAndMount(adult);
    expect(personAnimIds()).toEqual([]);
    expect(advancePeopleAnimations(STEP)).toBe(0);
  });

  it('walks a routed person away from its anchor and records the odometer', async () => {
    setPeopleModelForTests(await loadAsset());
    const group = buildAndMount({ ...adult, walkRoute: loopRoute });
    setPersonWalkContext({
      bounds: { minX: -9.7, minZ: -9.7, maxX: 9.7, maxZ: 9.7 },
    });
    expect(personAnimIds()).toEqual(['p1']);
    expect(advancePeopleAnimations(STEP)).toBe(1);
    // 锚点在 (4,4)，路线起点 (2,2)：第一帧就该被路线接管，而不是停在锚点。
    expect(group.position.x).toBeCloseTo(loopRoute.points[0]!.x, 1);
    expect(group.position.z).toBeCloseTo(loopRoute.points[0]!.z, 1);
    tick(3);
    const odometer = personOdometer('p1');
    expect(odometer).not.toBeNull();
    // 3 s ≈ 3.15 m（1.05 m/s），扣掉首个路点的停留。
    expect(odometer!.travelled).toBeGreaterThan(2.4);
    expect(odometer!.travelled).toBeLessThan(3.4);
    // 留在路线包围盒内，不越界。
    expect(group.position.x).toBeGreaterThanOrEqual(2 - 0.3);
    expect(group.position.z).toBeGreaterThanOrEqual(2 - 0.3);
  });

  it('keeps the walk going across a furniture rebuild (no reset to the route start)', async () => {
    setPeopleModelForTests(await loadAsset());
    // 停留会吞掉重建后的行程预算：这条路线全程不停，方便对账。
    const item = { ...adult, walkRoute: { ...loopRoute, pauseMs: 0 } };
    const first = buildAndMount(item);
    tick(2);
    const before = { x: first.position.x, z: first.position.z, travelled: personOdometer('p1')!.travelled };
    expect(before.travelled).toBeGreaterThan(1.5);

    // 家具层重建：同 id 重注册，新 group 接着旧进度走。
    const second = buildAndMount(item);
    expect(second).not.toBe(first);
    advancePeopleAnimations(STEP);
    expect(Math.hypot(second.position.x - before.x, second.position.z - before.z)).toBeLessThan(0.2);
    tick(2);
    expect(personOdometer('p1')!.travelled).toBeGreaterThan(before.travelled + 1.8);
  });

  it('freezes a paused person and resumes where it stopped', async () => {
    setPeopleModelForTests(await loadAsset());
    const group = buildAndMount({ ...adult, walkRoute: loopRoute });
    tick(1.5);
    const stoppedAt = { x: group.position.x, z: group.position.z };
    const travelled = personOdometer('p1')!.travelled;

    const frozen = buildAndMount({ ...adult, walkRoute: loopRoute, personPaused: true });
    tick(1);
    expect(frozen.position.x).toBeCloseTo(stoppedAt.x, 2);
    expect(frozen.position.z).toBeCloseTo(stoppedAt.z, 2);
    expect(personOdometer('p1')!.travelled).toBeCloseTo(travelled, 3);

    const resumed = buildAndMount({ ...adult, walkRoute: loopRoute });
    tick(1);
    expect(personOdometer('p1')!.travelled).toBeGreaterThan(travelled + 0.8);
    expect(Math.hypot(resumed.position.x - stoppedAt.x, resumed.position.z - stoppedAt.z)).toBeGreaterThan(0.8);
  });

  it('drops the entry once the group leaves the scene (item removed)', async () => {
    setPeopleModelForTests(await loadAsset());
    const group = buildAndMount({ ...adult, walkRoute: loopRoute });
    expect(advancePeopleAnimations(STEP)).toBe(1);
    scene.remove(group);
    expect(advancePeopleAnimations(STEP)).toBe(0);
    expect(personAnimIds()).toEqual([]);
  });

  it('registers the procedural fallback so routes work before people.glb lands', () => {
    setPeopleModelForTests(null);
    const group = buildAndMount({ ...adult, walkRoute: loopRoute });
    expect(personAnimIds()).toEqual(['p1']);
    expect(advancePeopleAnimations(STEP)).toBe(1);
    tick(2);
    expect(Math.hypot(group.position.x - 2, group.position.z - 2)).toBeGreaterThan(1);
  });
});

// registerPersonAnim 直接调用冒烟：builder 之外的使用方（未来 NPC 化）也能挂表。
describe('registerPersonAnim', () => {
  it('accepts a bare spec and prunes on detach', () => {
    const root = new THREE.Group();
    scene.add(root);
    registerPersonAnim(root, {
      id: 'bare',
      mixer: new THREE.AnimationMixer(root),
      rig: null,
      clips: { idle: null, talk: null, walk: null },
      action: 'idle',
      paused: false,
      route: null,
    });
    expect(personAnimIds()).toContain('bare');
    scene.remove(root);
    advancePeopleAnimations(STEP);
    expect(personAnimIds()).not.toContain('bare');
  });
});
