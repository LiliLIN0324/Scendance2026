/**
 * 走路动画的行为不变量（2026-11-16 #132）。
 *
 * 背景：角色 GLB 的 Walk_Loop 自带每循环约 1.29 个模型单位的前进位移，路线/WASD 也在推人物，
 * 两者叠加会在动画回到首帧时把模型往回拉（真机实测的抖动）。`inPlaceWalkClip` 负责剥掉
 * 这段位移、保留抬腿与上下起伏；本文件把「剥得干净」与「剥完不再漂」锁死。
 *
 * 全部用合成 AnimationClip，不依赖 GLB 资产、不联网。
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { inPlaceWalkClip } from './glb-assets';
import { clampWalkTimeScale } from './people-anim';
import { PERSON_WALK_SPEED_MPS } from '../lib/person-route';

const TIMES = [0, 0.5, 1];

/** 走路 clip：髋部 x 累计前移 1.29，y 有起伏；另带一条不该被动的脊柱轨道与旋转轨道。 */
function walkingClip(driftX = 1.29): THREE.AnimationClip {
  const hips = new THREE.VectorKeyframeTrack(
    'mixamorigHips.position',
    TIMES,
    [0, 1.0, 0, driftX / 2, 1.05, 0, driftX, 1.0, 0],
  );
  const spine = new THREE.VectorKeyframeTrack(
    'mixamorigSpine.position',
    TIMES,
    [0, 1.2, 0, 0, 1.2, 0, 0, 1.2, 0],
  );
  const quat = new THREE.QuaternionKeyframeTrack(
    'mixamorigHips.quaternion',
    TIMES,
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  );
  return new THREE.AnimationClip('Walk_Loop', 1, [hips, spine, quat]);
}

describe('inPlaceWalkClip（剥离根位移）', () => {
  it('首尾水平位移归零，纵向起伏与名称/时长原样保留', () => {
    const clip = walkingClip();
    const inPlace = inPlaceWalkClip(clip);
    const track = inPlace.tracks[0] as THREE.VectorKeyframeTrack;
    const values = Array.from(track.values);
    expect(values[0]).toBeCloseTo(0, 6);
    expect(values[6]).toBeCloseTo(0, 6); // 最后一帧 x
    // y 逐帧不变（步态起伏不能被抹平）
    expect(values[1]).toBeCloseTo(1.0, 6);
    expect(values[4]).toBeCloseTo(1.05, 6);
    expect(values[7]).toBeCloseTo(1.0, 6);
    expect(inPlace.name).toBe('Walk_Loop');
    expect(inPlace.duration).toBe(1);
  });

  it('不改动原始 clip 的数据（克隆而非就地改写）', () => {
    const clip = walkingClip();
    inPlaceWalkClip(clip);
    const original = clip.tracks[0] as THREE.VectorKeyframeTrack;
    expect(original.values[6]).toBeCloseTo(1.29, 6);
  });

  it('非髋部轨道原样保留（同引用），不误伤脊柱/旋转', () => {
    const clip = walkingClip();
    const inPlace = inPlaceWalkClip(clip);
    expect(inPlace.tracks[1]).toBe(clip.tracks[1]);
    expect(inPlace.tracks[2]).toBe(clip.tracks[2]);
  });

  it('重复调用返回同一实例（WeakMap 生效，不重复克隆）', () => {
    const clip = walkingClip();
    expect(inPlaceWalkClip(clip)).toBe(inPlaceWalkClip(clip));
  });

  it('没有水平位移的 clip 原样返回（引用相等）', () => {
    const clip = walkingClip(0);
    expect(inPlaceWalkClip(clip)).toBe(clip);
  });

  it('边界：单帧 / 零时长 / 非三维轨道都不抛错', () => {
    const single = new THREE.AnimationClip('Walk_Loop', 1, [
      new THREE.VectorKeyframeTrack('Hips.position', [0], [0, 1, 0]),
    ]);
    expect(inPlaceWalkClip(single)).toBe(single);

    const zero = new THREE.AnimationClip('Walk_Loop', 0, [
      new THREE.VectorKeyframeTrack('Hips.position', [0, 0], [0, 1, 0, 1, 1, 0]),
    ]);
    expect(inPlaceWalkClip(zero)).toBe(zero);

    const quatOnly = new THREE.AnimationClip('Walk_Loop', 1, [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', TIMES, [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    expect(inPlaceWalkClip(quatOnly)).toBe(quatOnly);
  });
});

describe('剥完之后的循环净位移（回归：不再被动画往回拉）', () => {
  /** 用 mixer 跑满一个循环，返回髋部世界坐标的水平增量。 */
  function runOneLoop(clip: THREE.AnimationClip): number {
    const root = new THREE.Object3D();
    const hips = new THREE.Object3D();
    hips.name = 'mixamorigHips';
    root.add(hips);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.update(0);
    const startX = hips.position.x;
    // 关键：在循环末尾取样。正好 update(duration) 会回绕到首帧，位移归零，看起来「没漂」。
    mixer.update(clip.duration * 0.999);
    const deltaX = hips.position.x - startX;
    mixer.uncacheRoot(root);
    return deltaX;
  }

  it('对照：原始 clip 一个循环确实前移约 1.29（证明这条测试有意义）', () => {
    expect(runOneLoop(walkingClip())).toBeCloseTo(1.29, 2);
  });

  it('处理后：一个循环水平净位移 < 1e-3 m', () => {
    expect(Math.abs(runOneLoop(inPlaceWalkClip(walkingClip())))).toBeLessThan(1e-3);
  });
});

describe('clampWalkTimeScale（速度 coupling）', () => {
  it('自然步速 1.05 m/s 时 timeScale ≈ 1（步幅与位移同源）', () => {
    expect(clampWalkTimeScale(PERSON_WALK_SPEED_MPS)).toBeCloseTo(1, 6);
  });

  it('0.5× / 1× / 1.5× 单调递增', () => {
    const slow = clampWalkTimeScale(PERSON_WALK_SPEED_MPS * 0.5);
    const normal = clampWalkTimeScale(PERSON_WALK_SPEED_MPS);
    const fast = clampWalkTimeScale(PERSON_WALK_SPEED_MPS * 1.5);
    expect(slow).toBeLessThan(normal);
    expect(normal).toBeLessThan(fast);
  });

  it('夹在 0.5–2.5：过慢不过分拖沓、过快不出现滑步鬼畜', () => {
    expect(clampWalkTimeScale(0.01)).toBe(0.5);
    expect(clampWalkTimeScale(100)).toBe(2.5);
    expect(clampWalkTimeScale(Number.NaN)).toBe(0.5);
  });
});
