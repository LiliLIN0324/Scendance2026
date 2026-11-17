/**
 * 人物片段重定向（2026-11-17）。
 *
 * 现实：crowd 模型是 Mixamo 骨架（`mixamorig:*`，52 骨），只有 Idle/Walk；
 * 摆置人物用的 `people.glb` 是 Rigify 骨架（`DEF-*`，53 骨），带交谈片段。
 * 成熟做法就是重定向：three 官方 `SkeletonUtils.retargetClip`，给一张
 * 「目标骨 → 源骨」的名字表即可跨骨架搬运动画。
 *
 * 本模块只做三件事，全部可单测：
 * 1. `mixamoNamesFor()`：按目标骨名生成 Rigify→Mixamo 映射（按部位与指节编号）；
 * 2. `retargetFromRig()`：把源片段搬到目标骨架，保留片段名与时长；
 * 3. `buildWaveClip()`：没有现成挥手素材时的程序化兜底（相对静止姿势叠加）。
 *
 * 说明：程序化挥手只保证「抬臂 + 摆小臂」的循环，不等同于美术级 Wave；
 * 有 CC0 素材后走 1、2 两步替换即可，调用方无需改。
 */

import * as THREE from 'three';
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** 名字归一：去前缀、去点、小写。`DEF-upper_arm.L` → `upperarml`。 */
export function normalizeBoneName(name: string): string {
  return name
    .replace(/^mixamorig:?/i, '')
    .replace(/^DEF-/i, '')
    .replace(/[.\s_-]/g, '')
    .toLowerCase();
}

/** Mixamo 部位（归一后）→ Rigify 真实骨名（含标点）。 */
const LIMB_MAP: Readonly<Record<string, string>> = {
  hips: 'DEF-hips',
  spine: 'DEF-spine.001',
  spine1: 'DEF-spine.002',
  spine2: 'DEF-spine.003',
  neck: 'DEF-neck',
  head: 'DEF-head',
  leftshoulder: 'DEF-shoulder.L',
  leftarm: 'DEF-upper_arm.L',
  leftforearm: 'DEF-forearm.L',
  lefthand: 'DEF-hand.L',
  rightshoulder: 'DEF-shoulder.R',
  rightarm: 'DEF-upper_arm.R',
  rightforearm: 'DEF-forearm.R',
  righthand: 'DEF-hand.R',
  leftupleg: 'DEF-thigh.L',
  leftleg: 'DEF-shin.L',
  leftfoot: 'DEF-foot.L',
  lefttoebase: 'DEF-toe.L',
  rightupleg: 'DEF-thigh.R',
  rightleg: 'DEF-shin.R',
  rightfoot: 'DEF-foot.R',
  righttoebase: 'DEF-toe.R',
};

const FINGER = /^(left|right)hand(thumb|index|middle|ring|pinky)([123])$/;

/**
 * 目标骨名（Mixamo）→ 源骨名（Rigify）。
 * 只返回目标里真实存在的骨，缺的指节不补，避免 retarget 里空转。
 */
export function mixamoNamesFor(targetBones: readonly string[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const bone of targetBones) {
    const key = normalizeBoneName(bone);
    const limb = LIMB_MAP[key];
    if (limb) {
      names[bone] = limb;
      continue;
    }
    const finger = FINGER.exec(key);
    if (finger) {
      const side = finger[1] === 'left' ? 'L' : 'R';
      const part = finger[2] === 'thumb' ? 'thumb' : `f_${finger[2]}`;
      names[bone] = `DEF-${part}.0${finger[3]}.${side}`;
    }
  }
  return names;
}

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse(node => {
    if (!found && (node as THREE.SkinnedMesh).isSkinnedMesh) found = node as THREE.SkinnedMesh;
  });
  return found;
}

/**
 * 把源片段重定向到目标骨架。名字表留空时自动按 Mixamo→Rigify 生成。
 * 返回新片段（不改源片段）；任一侧没有蒙皮网格则返回 null。
 */
export function retargetFromRig(
  targetRoot: THREE.Object3D,
  sourceRoot: THREE.Object3D,
  clip: THREE.AnimationClip,
  options: { names?: Record<string, string>; hip?: string } = {},
): THREE.AnimationClip | null {
  const target = findSkinned(targetRoot);
  const source = findSkinned(sourceRoot);
  if (!target || !source) return null;
  const names = options.names ?? mixamoNamesFor(target.skeleton.bones.map(bone => bone.name));
  const hip = options.hip ?? target.skeleton.bones.find(bone => /hips/i.test(bone.name))?.name;
  const converted = retargetClip(target, source, clip, {
    names,
    ...(hip ? { hip } : {}),
    fps: 30,
    useFirstFramePosition: false,
  });
  converted.name = clip.name;
  return converted;
}

const retargetCache = new Map<string, THREE.AnimationClip>();

/**
 * 带缓存的重定向：同一骨架 + 同一片段只算一次（人群几十人时这一步很贵）。
 * 骨架签名取骨名序列，角色共用骨架时直接复用。
 */
export function retargetFromRigCached(
  targetRoot: THREE.Object3D,
  sourceRoot: THREE.Object3D,
  clip: THREE.AnimationClip,
  options: { names?: Record<string, string>; hip?: string } = {},
): THREE.AnimationClip | null {
  const target = findSkinned(targetRoot);
  if (!target) return null;
  const signature = `${clip.uuid}|${target.skeleton.bones.map(bone => bone.name).join(',')}`;
  const cached = retargetCache.get(signature);
  if (cached) return cached;
  const converted = retargetFromRig(targetRoot, sourceRoot, clip, options);
  if (converted) retargetCache.set(signature, converted);
  return converted;
}

/** 测试/换素材时清缓存。 */
export function clearRetargetCache(): void {
  retargetCache.clear();
}

/** 右臂三节（骨名归一后匹配 Rigify / Mixamo 两种叫法）。
 *  不强制 `isBone`：不同加载器/clone 路径下骨骼可能是普通 Object3D，按名字命中即可。
 */
function rightArmChain(
  root: THREE.Object3D,
): { upper: THREE.Object3D; forearm: THREE.Object3D; hand: THREE.Object3D | null } | null {
  const wanted = {
    upper: /^(rightarm|upperarmr)$/,
    forearm: /^(rightforearm|forearmr)$/,
    hand: /^(righthand|handr)$/,
  };
  const found: Partial<Record<keyof typeof wanted, THREE.Object3D>> = {};
  root.traverse(node => {
    const name = normalizeBoneName(node.name);
    for (const key of Object.keys(wanted) as (keyof typeof wanted)[]) {
      if (!found[key] && wanted[key].test(name)) found[key] = node;
    }
  });
  if (!found.upper || !found.forearm) return null;
  return { upper: found.upper, forearm: found.forearm, hand: found.hand ?? null };
}

const smoothstep = (value: number): number => {
  const k = Math.min(1, Math.max(0, value));
  return k * k * (3 - 2 * k);
};

/**
 * 程序化挥手 v2（2026-11-17）：不猜骨骼局部轴，在**世界坐标**里抬臂。
 *
 * 取每根骨父级的世界朝向 P 与静止局部旋转 q；想要的世界增量 D 先换算成
 * 局部增量 P⁻¹·D·P，再乘回 q。抬臂方向按手在 +X / −X 哪一侧决定，
 * 所以 Rigify 与 Mixamo 两套骨架都能用，且不会因为 roll 不同而抬错方向。
 *
 * 节拍：0.4 s 抬臂 → 1.35 s 摆小臂（三个来回）→ 0.4 s 放下 → 收住，
 * 首尾都是静止姿态，循环播放不跳帧。
 */
export function buildWaveClip(
  root: THREE.Object3D,
  options: { duration?: number; name?: string } = {},
): THREE.AnimationClip | null {
  const chain = rightArmChain(root);
  if (!chain) return null;
  const duration = options.duration ?? 2.4;
  root.updateMatrixWorld(true);
  const bones = [chain.upper, chain.forearm, ...(chain.hand ? [chain.hand] : [])];
  const rest = bones.map(bone => bone.quaternion.clone());
  const parentWorld = bones.map(bone =>
    bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
  );
  const handWorld = (chain.hand ?? chain.forearm).getWorldPosition(new THREE.Vector3());
  // 手在 −X 侧就往 −X 抬；在 +X 侧就往 +X 抬。
  const side = handWorld.x < 0 ? -1 : 1;
  const samples = 36;
  const times: number[] = [];
  const values = bones.map(() => new Float64Array((samples + 1) * 4));
  for (let i = 0; i <= samples; i += 1) {
    const t = (duration * i) / samples;
    let raise = 0;
    let elbow = 0;
    let wrist = 0;
    if (t < 0.4) {
      const k = smoothstep(t / 0.4);
      raise = k;
      elbow = 0.32 * k;
    } else if (t < 1.75) {
      raise = 1;
      const phase = (t - 0.4) * Math.PI * 3.2;
      elbow = 0.5 + 0.34 * Math.sin(phase);
      wrist = 0.22 * Math.sin(phase + 0.6);
    } else if (t < 2.15) {
      const k = smoothstep((t - 1.75) / 0.4);
      raise = 1 - k;
      elbow = 0.5 * (1 - k);
    }
    times.push(t);
    const deltas = [
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18 * raise, 0, side * 1.25 * raise, 'XYZ')),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * elbow, 'XYZ')),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * wrist, 'XYZ')),
    ];
    bones.forEach((_bone, index) => {
      const localDelta = parentWorld[index]!.clone().invert()
        .multiply(deltas[index]!)
        .multiply(parentWorld[index]!);
      const q = localDelta.multiply(rest[index]!);
      values[index]!.set([q.x, q.y, q.z, q.w], i * 4);
    });
  }
  const tracks = bones.map((bone, index) =>
    new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values[index]!),
  );
  return new THREE.AnimationClip(options.name ?? 'Wave_Loop', duration, tracks);
}
