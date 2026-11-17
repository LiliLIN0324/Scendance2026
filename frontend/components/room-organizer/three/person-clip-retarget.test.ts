import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  buildWaveClip,
  mixamoNamesFor,
  normalizeBoneName,
} from './person-clip-retarget';

describe('骨架重定向命名', () => {
  it('去前缀 / 去点 / 统一小写', () => {
    expect(normalizeBoneName('mixamorig:LeftArm')).toBe('leftarm');
    expect(normalizeBoneName('DEF-upper_arm.L')).toBe('upperarml');
    expect(normalizeBoneName('DEF-spine.001')).toBe('spine001');
  });

  it('Mixamo 部位与指节能映射到 Rigify', () => {
    const names = mixamoNamesFor([
      'mixamorig:Hips',
      'mixamorig:Spine',
      'mixamorig:Spine1',
      'mixamorig:LeftArm',
      'mixamorig:LeftForeArm',
      'mixamorig:RightUpLeg',
      'mixamorig:RightToeBase',
      'mixamorig:LeftHandThumb1',
      'mixamorig:RightHandPinky3',
    ]);
    expect(names).toEqual({
      'mixamorig:Hips': 'DEF-hips',
      'mixamorig:Spine': 'DEF-spine.001',
      'mixamorig:Spine1': 'DEF-spine.002',
      'mixamorig:LeftArm': 'DEF-upper_arm.L',
      'mixamorig:LeftForeArm': 'DEF-forearm.L',
      'mixamorig:RightUpLeg': 'DEF-thigh.R',
      'mixamorig:RightToeBase': 'DEF-toe.R',
      'mixamorig:LeftHandThumb1': 'DEF-thumb.01.L',
      'mixamorig:RightHandPinky3': 'DEF-f_pinky.03.R',
    });
  });

  it('不认识的骨名不硬凑', () => {
    expect(mixamoNamesFor(['mixamorig:WeaponSocket'])).toEqual({});
  });
});

function rig() {
  const root = new THREE.Group();
  const upper = new THREE.Bone();
  upper.name = 'mixamorig:RightArm';
  const forearm = new THREE.Bone();
  forearm.name = 'mixamorig:RightForeArm';
  upper.add(forearm);
  const hand = new THREE.Bone();
  hand.name = 'mixamorig:RightHand';
  forearm.add(hand);
  root.add(upper);
  return { root, upper, forearm, hand };
}

describe('程序化挥手', () => {
  it('生成右臂三节的关键帧，时长与循环对得上', () => {
    const { root, upper, forearm, hand } = rig();
    const clip = buildWaveClip(root, { duration: 2 });
    expect(clip).not.toBeNull();
    expect(clip!.name).toBe('Wave_Loop');
    expect(clip!.duration).toBe(2);
    expect(clip!.tracks).toHaveLength(3);
    const names = clip!.tracks.map(track => track.name);
    expect(names).toEqual(expect.arrayContaining([
      `${upper.name}.quaternion`,
      `${forearm.name}.quaternion`,
      `${hand.name}.quaternion`,
    ]));
  });

  it('关键帧真的在动：中途姿态不等于静止姿态', () => {
    const { root, upper } = rig();
    const rest = upper.quaternion.clone();
    const clip = buildWaveClip(root, { duration: 2 })!;
    const track = clip.tracks.find(item => item.name === `${upper.name}.quaternion`)!;
    const mid = new THREE.Quaternion(
      track.values[12], track.values[13], track.values[14], track.values[15],
    );
    expect(mid.angleTo(rest)).toBeGreaterThan(0.05);
  });

  it('找不到右臂骨时返回空，不造空片段', () => {
    expect(buildWaveClip(new THREE.Group())).toBeNull();
  });
});

describe('真人骨架上的挥手（people.glb）', () => {
  async function loadPeople() {
    const bytes = readFileSync(fileURLToPath(new URL('../assets/people.glb', import.meta.url)));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new GLTFLoader().parseAsync(buffer, '');
  }

  it('把手抬到肩以上，并真的来回摆；首尾回到静止', async () => {
    const gltf = await loadPeople();
    // GLTFLoader 会改写骨名里的点号，这里用归一后的名字找，不依赖原始拼写。
    const findBone = (normalized: string): THREE.Bone | null => {
      let found: THREE.Bone | null = null;
      gltf.scene.traverse(node => {
        const bone = node as THREE.Bone;
        if (!found && bone.isBone && normalizeBoneName(bone.name) === normalized) found = bone;
      });
      return found;
    };
    const hand = findBone('handr')!;
    const shoulder = findBone('upperarmr')!;
    expect(hand).toBeTruthy();
    expect(shoulder).toBeTruthy();
    const clip = buildWaveClip(gltf.scene);
    expect(clip).not.toBeNull();
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip!).play();

    const at = (time: number) => {
      mixer.setTime(time);
      gltf.scene.updateMatrixWorld(true);
      return hand.getWorldPosition(new THREE.Vector3());
    };

    const rest = at(0);
    const shoulderPos = shoulder.getWorldPosition(new THREE.Vector3());
    const armLength = rest.distanceTo(shoulderPos);
    expect(armLength).toBeGreaterThan(0);

    const raised = at(1.0);
    // 手必须高于肩（抬起来），而不是贴身乱转。
    expect(raised.y - shoulderPos.y).toBeGreaterThan(0.1 * armLength);

    // 两个时刻的手位置要有可量测的位移（在摆，不是定住）。
    const a = at(1.05);
    const b = at(1.25);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.03 * armLength);

    // 收尾回到静止，循环播放不跳帧。
    const end = at(clip!.duration);
    expect(end.distanceTo(rest)).toBeLessThan(0.02 * armLength);
  });
});
