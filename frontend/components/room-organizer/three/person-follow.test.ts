import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPersonAnim, advancePeopleAnimations } from './people-anim';
import { advancePersonFollow, personFollowTargetId, setPersonFollowTarget } from './person-follow';

/**
 * PEOPLE-04 后半：近景跟拍。用 bare spec 注册（真实 GLB 走查由 people-anim.test
 * 与浏览器 E2E 覆盖），手动挪 group.position 模拟行进——personFollowSample 读的
 * 就是 group.position，语义与路线推进等价。
 */

const scene = new THREE.Scene();
const STEP = 1 / 60;

class StubControls {
  target = new THREE.Vector3();
  updateCalls = 0;
  update(): boolean {
    this.updateCalls += 1;
    return false;
  }
}

function mountPerson(id: string, x = 2, z = 3, facing = 0): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = facing;
  scene.add(group);
  registerPersonAnim(group, {
    id,
    mixer: null,
    rig: null,
    clips: { idle: null, talk: null, walk: null },
    action: 'idle',
    paused: false,
    route: null,
  });
  advancePeopleAnimations(STEP); // 注册表认识这个 group（ mixer 为 null，位置不动）
  return group;
}

afterEach(() => {
  setPersonFollowTarget(null);
  scene.clear();
  advancePeopleAnimations(STEP); // 把脱离场景的实例摘干净
});

describe('advancePersonFollow', () => {
  it('does nothing when no follow target is set', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 8, 10);
    const controls = new StubControls();
    expect(advancePersonFollow(camera, controls, false)).toBe(false);
    expect(camera.position.x).toBe(10);
    expect(controls.updateCalls).toBe(0);
  });

  it('frames the person from behind on the first frame', () => {
    const group = mountPerson('p1', 2, 3, 0); // facing 0 = 朝 +Z，背后机位在 -Z 侧
    const camera = new THREE.PerspectiveCamera();
    const controls = new StubControls();
    setPersonFollowTarget('p1');

    expect(advancePersonFollow(camera, controls, false)).toBe(true);
    expect(camera.position.x).toBeCloseTo(2, 5);
    expect(camera.position.z).toBeCloseTo(3 - 3.5, 5);
    expect(camera.position.y).toBeCloseTo(3.0, 5);
    expect(controls.target.x).toBeCloseTo(2, 5);
    expect(controls.target.y).toBeCloseTo(1.2, 5);
    expect(controls.target.z).toBeCloseTo(3, 5);
    expect(controls.updateCalls).toBe(1);
    expect(personFollowTargetId()).toBe('p1');
    void group;
  });

  it('translates the camera with the person and keeps user controls intact', () => {
    const group = mountPerson('p1', 2, 3, Math.PI / 2);
    const camera = new THREE.PerspectiveCamera();
    const controls = new StubControls();
    setPersonFollowTarget('p1');
    advancePersonFollow(camera, controls, false);
    const framed = camera.position.clone();

    // 行进 0.5m：镜头同量平移（相对方位不变，用户旋转/缩放不被重置）。
    group.position.set(2.5, 0, 3);
    expect(advancePersonFollow(camera, controls, false)).toBe(true);
    expect(camera.position.x - framed.x).toBeCloseTo(0.5, 5);
    expect(camera.position.y).toBeCloseTo(framed.y, 5);
    expect(controls.target.x).toBeCloseTo(2.5, 5);

    // 人物停住：返回 false，整帧可以早退。
    expect(advancePersonFollow(camera, controls, false)).toBe(false);
  });

  it('ends automatically and fires onEnd exactly once when the person is removed', () => {
    const group = mountPerson('p1');
    const camera = new THREE.PerspectiveCamera();
    const controls = new StubControls();
    const onEnd = vi.fn();
    setPersonFollowTarget('p1', onEnd);
    advancePersonFollow(camera, controls, false);

    scene.remove(group);
    advancePeopleAnimations(STEP); // 注册表摘除
    expect(advancePersonFollow(camera, controls, false)).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(personFollowTargetId()).toBeNull();
    // 退出后再推进不再移动相机。
    const before = camera.position.clone();
    advancePersonFollow(camera, controls, false);
    expect(camera.position.equals(before)).toBe(true);
  });

  it('does not fire onEnd on a manual stop', () => {
    mountPerson('p1');
    const camera = new THREE.PerspectiveCamera();
    const onEnd = vi.fn();
    setPersonFollowTarget('p1', onEnd);
    advancePersonFollow(camera, new StubControls(), false);
    setPersonFollowTarget(null);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('freezes during walkthrough and re-frames from behind after it ends', () => {
    const group = mountPerson('p1', 2, 3, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 8, 10); // 漫游会把相机挪到别处
    const controls = new StubControls();
    setPersonFollowTarget('p1');
    advancePersonFollow(camera, controls, false);
    const framed = camera.position.clone(); // 进入帧的近景机位

    group.position.set(6, 0, 8);
    expect(advancePersonFollow(camera, controls, true)).toBe(false);
    expect(camera.position.equals(framed)).toBe(true); // 漫游期间镜头冻结不追人

    // 漫游结束：按新位置/朝向重新取近景机位，而不是把漫游期间的位移一次补上。
    expect(advancePersonFollow(camera, controls, false)).toBe(true);
    expect(camera.position.x).toBeCloseTo(6, 5);
    expect(camera.position.z).toBeCloseTo(8 - 3.5, 5);
  });

  it('re-frames when switching to another person', () => {
    mountPerson('p1', 2, 3, 0);
    mountPerson('p2', -4, 1, Math.PI);
    const camera = new THREE.PerspectiveCamera();
    const controls = new StubControls();
    setPersonFollowTarget('p1');
    advancePersonFollow(camera, controls, false);
    expect(camera.position.x).toBeCloseTo(2, 5);

    setPersonFollowTarget('p2'); // 切目标：机位重摆（facing π 朝 -Z，背后在 +Z 侧）
    expect(advancePersonFollow(camera, controls, false)).toBe(true);
    expect(camera.position.x).toBeCloseTo(-4, 5);
    expect(camera.position.z).toBeCloseTo(1 + 3.5, 5);
  });

  it('falls back to lookAt when there are no orbit controls', () => {
    mountPerson('p1', 2, 3, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 8, 10);
    setPersonFollowTarget('p1');

    expect(advancePersonFollow(camera, null, false)).toBe(true);
    // 机位摆背后且朝向胸口。
    expect(camera.position.x).toBeCloseTo(2, 5);
    expect(camera.position.z).toBeCloseTo(3 - 3.5, 5);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const toTarget = new THREE.Vector3(2, 1.2, 3).sub(camera.position).normalize();
    expect(dir.angleTo(toTarget)).toBeLessThan(1e-3);

    // 人物不动时 lookAt 分支不崩、返回 false。
    expect(advancePersonFollow(camera, null, false)).toBe(false);
  });
});
