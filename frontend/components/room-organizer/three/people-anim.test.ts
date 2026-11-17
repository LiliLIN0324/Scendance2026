import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPerson, buildProceduralPerson } from './builders/builders-people';
import {
  advancePeopleAnimations,
  personAnimIds,
  personIsAnimated,
  personOdometer,
  personRoamState,
  personWalkStates,
  registerPersonAnim,
  setPersonSeatContext,
  setPersonWalkContext,
  setPersonZoneContext,
  subscribePersonRoam,
  takePersonControl,
  workerRoamState,
} from './people-anim';
import { type PeopleModel, preparePeopleModel, setPeopleModelForTests } from './people-model';
import type { SeatAnchor } from '../lib/person-behavior';
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
  setPersonWalkContext(null, 'outdoor');
  setPersonSeatContext(null);
  setPersonSeatContext(null, 'outdoor');
  setPersonZoneContext(null);
  setPersonZoneContext(null, 'outdoor');
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
  it('allows taking over the lightweight figure before its model arrives and keeps control through upgrade', () => {
    const route = { ...loopRoute, pauseMs: 0 };
    const group = buildProceduralPerson({
      THREE, item: { ...adult, walkRoute: route }, hasCollision: false, baseColor: adult.color, opacity: 1,
    }, true);
    scene.add(group);
    expect(group.getObjectsByProperty('isMesh', true).length).toBeGreaterThan(5);
    const control = takePersonControl(adult.id, group)!;
    group.position.set(3, 0, 4);
    control.setMoving(true);
    registerPersonAnim(group, {
      id: adult.id, mixer: new THREE.AnimationMixer(group), rig: null,
      clips: { idle: null, walk: null, talk: null }, route, action: 'idle', paused: false,
    });
    tick(0.5);
    expect(group.position.toArray()).toEqual([3, 0, 4]);
    control.release();
    expect(group.position.toArray()).toEqual([2, 0, 2]);
    tick(0.5);
    expect(personOdometer(adult.id)?.travelled).toBeGreaterThan(0);
  });

  it('freezes only the selected patrol and resumes its original route after release', async () => {
    setPeopleModelForTests(await loadAsset());
    const route = { ...loopRoute, pauseMs: 0 };
    const selected = buildAndMount({ ...adult, walkRoute: route });
    buildAndMount({ ...adult, id: 'p2', walkRoute: route });
    tick(1);
    const priorPosition = selected.position.clone();
    const priorDistance = personOdometer('p1')!.travelled;

    const control = takePersonControl('p1', selected)!;
    control.setMoving(true);
    selected.position.x += 2;
    tick(1);
    expect(selected.position.x).toBeCloseTo(priorPosition.x + 2);
    expect(personOdometer('p1')!.travelled).toBe(priorDistance);
    expect(personOdometer('p2')!.travelled).toBeGreaterThan(priorDistance);

    control.release();
    expect(selected.position.toArray()).toEqual(priorPosition.toArray());
    tick(1);
    expect(personOdometer('p1')!.travelled).toBeGreaterThan(priorDistance);
  });

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

// B1：自主落座。程序化小人没有 Sit_Idle_Loop，走 poseSit + 髋高反算。
describe('自主落座（沿流线走到椅子坐下）', () => {
  const straight: WalkRoute = { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], loop: false, pauseMs: 0 };
  const chair: SeatAnchor = {
    id: 'chair-1', x: 3, z: 0, approach: { x: 3, z: 0 }, facing: 0, seatHeight: 0.45,
  };

  function mount(id: string): THREE.Group {
    const group = buildProceduralPerson({
      THREE, item: { ...adult, id, walkRoute: straight }, hasCollision: false, baseColor: adult.color, opacity: 1,
    }, true);
    scene.add(group);
    return group;
  }

  it('walks off the line to the chair, sits, then returns to the route', () => {
    setPeopleModelForTests(null);
    const group = mount('p1');
    setPersonSeatContext({ seats: [chair] });

    tick(4);
    const seated = personWalkStates().find((state) => state.id === 'p1')!;
    expect(seated.seatPhase).toBe('seated');
    expect(seated.seatId).toBe('chair-1');
    expect(group.position.x).toBeCloseTo(3, 2);
    expect(group.position.z).toBeCloseTo(0, 2);
    // 坐姿摆位：髋 0.9 m 落到 0.45 m 座面 → 整个人下沉 0.45 m。
    expect(group.position.y).toBeLessThan(-0.3);

    advancePeopleAnimations(80); // 停留到点 → 起身
    tick(1);                     // 走回离开点，交还基准流线
    const back = personWalkStates().find((state) => state.id === 'p1')!;
    expect(back.seatPhase).toBe('none');
    expect(group.position.y).toBeCloseTo(0, 3);
    tick(2);
    expect(personOdometer('p1')!.travelled).toBeGreaterThan(1.5);
  });

  it('gives one chair to one person', () => {
    setPeopleModelForTests(null);
    mount('p1');
    mount('p2');
    setPersonSeatContext({ seats: [chair] });
    tick(4);
    const states = personWalkStates();
    expect(states.filter((state) => state.seatPhase === 'seated')).toHaveLength(1);
    expect(states.find((state) => state.seatId === 'chair-1')).not.toBeUndefined();
  });

  it('keeps walking past the chair when no seat context is injected', () => {
    setPeopleModelForTests(null);
    mount('p1');
    tick(4);
    expect(personWalkStates().every((state) => state.seatPhase === 'none')).toBe(true);
    expect(personWalkStates()[0]!.x).toBeGreaterThan(4);
  });

  it('does not walk to a chair it cannot reach in a straight line', () => {
    setPeopleModelForTests(null);
    mount('p1');
    setPersonWalkContext({
      colliders: [{ cx: 1.5, cz: 0, hw: 0.6, hd: 3, ax: 1, az: 0, bx: 0, bz: 1, aabbHalfW: 0.6, aabbHalfD: 3, outdoor: false }],
      bounds: { minX: -9.7, minZ: -9.7, maxX: 9.7, maxZ: 9.7 },
    });
    setPersonSeatContext({ seats: [chair] });
    tick(4);
    expect(personWalkStates()[0]!.seatPhase).toBe('none');
  });
});

// B2：分区漫游。流线从区外穿进区内时，人拐进去走一段再回原线。
describe('分区漫游（进区 → 区内走动 → 回线）', () => {
  const loop: WalkRoute = { points: [{ x: -8, z: 0 }, { x: 8, z: 0 }], loop: true, pauseMs: 0 };
  const zone = {
    id: 'zone-a',
    polygon: [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }],
  };

  function mount(id: string): THREE.Group {
    const group = buildProceduralPerson({
      THREE, item: { ...adult, id, walkRoute: loop }, hasCollision: false, baseColor: adult.color, opacity: 1,
    }, true);
    scene.add(group);
    return group;
  }

  it('detours into the zone, wanders, then rejoins the line without resetting the odometer', () => {
    setPeopleModelForTests(null);
    const group = mount('p1'); // p1 第 0 圈命中进区判定（确定性 hash）
    setPersonZoneContext({ zones: [zone] });

    const seen = new Set<string>();
    let travelledAtEntry = 0;
    let rejoined = false;
    for (let i = 0; i < 400 && !rejoined; i += 1) {
      advancePeopleAnimations(0.5);
      const state = personWalkStates()[0]!;
      seen.add(state.seatPhase);
      if (state.seatPhase === 'zone' && travelledAtEntry === 0) {
        travelledAtEntry = personOdometer('p1')!.travelled;
      }
      if (seen.has('zone') && state.seatPhase === 'none') rejoined = true;
    }

    expect(seen.has('toZone')).toBe(true);
    expect(seen.has('zone')).toBe(true);
    expect(seen.has('rejoin')).toBe(true);
    expect(rejoined).toBe(true);
    const back = personWalkStates()[0]!;
    expect(back.zoneId).toBeNull();
    // 回线后位置在流线上（z≈0），不是从区里凭空瞬移回起点。
    expect(Math.abs(group.position.z)).toBeLessThan(0.2);
    expect(group.position.x).toBeGreaterThan(-2.5);
    // 里程与圈数接着算：进区前已走的 3 m 多不能因换线而归零。
    const odometer = personOdometer('p1')!;
    expect(odometer.travelled).toBeGreaterThanOrEqual(travelledAtEntry);
    expect(odometer.travelled).toBeGreaterThan(3);
  });

  it('walks straight through when no zone context is injected', () => {
    setPeopleModelForTests(null);
    mount('p1');
    tick(6);
    expect(personWalkStates()[0]!.seatPhase).toBe('none');
    expect(personWalkStates()[0]!.x).toBeGreaterThan(-2);
  });

  it('rejoins the route when the zone disappears mid-visit', () => {
    setPeopleModelForTests(null);
    const group = mount('p1');
    setPersonZoneContext({ zones: [zone] });

    for (let i = 0; i < 80 && personWalkStates()[0]!.seatPhase !== 'zone'; i += 1) {
      advancePeopleAnimations(0.5);
    }
    expect(personWalkStates()[0]!.seatPhase).toBe('zone');

    // 分区被删：不能把人留在已经没有分区的坐标里。
    setPersonZoneContext(null);
    for (let i = 0; i < 200 && personWalkStates()[0]!.seatPhase !== 'none'; i += 1) {
      advancePeopleAnimations(0.5);
    }
    const state = personWalkStates()[0]!;
    expect(state.seatPhase).toBe('none');
    expect(state.zoneId).toBeNull();
    expect(Math.abs(group.position.z)).toBeLessThan(0.2);
  });

  it('reports the roam state to the 2D layer and notifies only on real changes', () => {
    setPeopleModelForTests(null);
    mount('w1#0');
    const seen: string[] = [];
    const off = subscribePersonRoam(() => seen.push(personRoamState('w1#0') ?? 'gone'));
    setPersonZoneContext({ zones: [zone] });

    for (let i = 0; i < 80 && personRoamState('w1#0') !== 'zone'; i += 1) {
      advancePeopleAnimations(0.5);
    }
    expect(personRoamState('w1#0')).toBe('zone');
    expect(workerRoamState('w1', 1)).toBe('zone');
    // 没有实例的岗位与 id 不编状态，画布就不会画出无主状态环。
    expect(workerRoamState('nobody', 3)).toBeNull();
    expect(personRoamState('missing')).toBeNull();

    // 退订后不再回调（画布卸载不留悬挂重绘）。
    off();
    const before = seen.length;
    advancePeopleAnimations(2);
    expect(seen.length).toBe(before);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('marks a seated person as seated for the 2D layer', () => {
    setPeopleModelForTests(null);
    const chair: SeatAnchor = {
      id: 'chair-2', x: 0, z: 0.3, approach: { x: 0, z: 0.3 }, facing: Math.PI, seatHeight: 0.45,
    };
    mount('w2#0');
    setPersonSeatContext({ seats: [chair] });

    tick(12);
    expect(personRoamState('w2#0')).toBe('seated');
    expect(workerRoamState('w2', 1)).toBe('seated');
  });
});

// 行走上下文按 owner 分开：两套 3D 同挂时各用自己那套碰撞盒与围栏。
describe('行走上下文按 owner 分开', () => {
  const straight: WalkRoute = { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], loop: false, pauseMs: 0 };

  function mount(id: string): THREE.Group {
    const group = buildProceduralPerson({
      THREE, item: { ...adult, id, walkRoute: straight }, hasCollision: false, baseColor: adult.color, opacity: 1,
    }, true);
    scene.add(group);
    return group;
  }

  it('uses the owner-specific context instead of the last injected one', () => {
    setPeopleModelForTests(null);
    const group = mount('owner#0');
    // 故意把室外（窄围栏）后注入：旧实现会让室内人物也吃到 maxX=2。
    setPersonWalkContext({ bounds: { minX: -9, minZ: -9, maxX: 9, maxZ: 9 } }, 'local');
    setPersonWalkContext({ bounds: { minX: -9, minZ: -9, maxX: 2, maxZ: 9 } }, 'outdoor');

    for (let i = 0; i < 180; i += 1) advancePeopleAnimations(1 / 60, scene, 'local');
    expect(group.position.x).toBeGreaterThan(3);

    // 同一个人换到 outdoor 那套：被夹在 x ≤ 2（不再借 local 的宽围栏）。
    for (let i = 0; i < 180; i += 1) advancePeopleAnimations(1 / 60, scene, 'outdoor');
    expect(group.position.x).toBeLessThanOrEqual(2.05);
  });

  it('falls back to no collision when that owner never injected a context', () => {
    setPeopleModelForTests(null);
    const group = mount('owner#1');
    setPersonWalkContext({ bounds: { minX: -9, minZ: -9, maxX: 2, maxZ: 9 } }, 'outdoor');

    for (let i = 0; i < 180; i += 1) advancePeopleAnimations(1 / 60, scene, 'local');
    // local 没有注入过：不避障、不夹取，而不是借 outdoor 的围栏。
    expect(group.position.x).toBeGreaterThan(3);
  });
});

// 座位 / 分区上下文与行走上下文同一口径：谁注入谁生效，不跨 owner 借用。
describe('座位与分区上下文按 owner 分开', () => {
  const straight: WalkRoute = { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], loop: false, pauseMs: 0 };
  const chair: SeatAnchor = {
    id: 'chair-owner', x: 3, z: 0, approach: { x: 3, z: 0 }, facing: 0, seatHeight: 0.45,
  };
  const zone = {
    id: 'zone-owner',
    polygon: [{ x: 4, z: -2 }, { x: 8, z: -2 }, { x: 8, z: 2 }, { x: 4, z: 2 }],
  };

  function mount(id: string): THREE.Group {
    const group = buildProceduralPerson({
      THREE, item: { ...adult, id, walkRoute: straight }, hasCollision: false, baseColor: adult.color, opacity: 1,
    }, true);
    scene.add(group);
    return group;
  }

  function advance(seconds: number, owner: string): void {
    for (let i = 0; i < Math.round(seconds / STEP); i += 1) advancePeopleAnimations(STEP, scene, owner);
  }

  it('only lets the owning scene sit on its chairs', () => {
    setPeopleModelForTests(null);
    mount('seat#0');
    setPersonSeatContext({ seats: [chair] }, 'outdoor');

    // local 没有座位：直接走过去，不会去坐 outdoor 的椅子。
    advance(4, 'local');
    expect(personWalkStates()[0]!.seatPhase).toBe('none');
    expect(personWalkStates()[0]!.x).toBeGreaterThan(4);
  });

  it('still seats the owning scene (户外链路的真实调用方式)', () => {
    setPeopleModelForTests(null);
    mount('seat#1');
    setPersonSeatContext({ seats: [chair] }, 'outdoor');

    advance(4, 'outdoor');
    expect(personWalkStates()[0]!.seatPhase).toBe('seated');
    expect(personWalkStates()[0]!.seatId).toBe('chair-owner');
  });

  it('only lets the owning scene enter its zones', () => {
    setPeopleModelForTests(null);
    const group = mount('zone#0');
    setPersonZoneContext({ zones: [zone] }, 'outdoor');

    advance(10, 'local');
    const state = personWalkStates()[0]!;
    expect(state.seatPhase).toBe('none');
    expect(state.zoneId).toBeNull();
    expect(group.position.x).toBeGreaterThan(8);
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
