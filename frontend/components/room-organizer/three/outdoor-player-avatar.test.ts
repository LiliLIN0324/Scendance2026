import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  OUTDOOR_PLAYER_AVATAR_BASE_Y,
  createOutdoorPlayerAvatar,
  createOutdoorPlayerAvatarSlot,
  outdoorPlayerPresentation,
  type OutdoorPlayerAvatarActor,
  type OutdoorPlayerAvatarFrame,
  type OutdoorPlayerAvatarRole,
} from './outdoor-player-avatar';

const role: OutdoorPlayerAvatarRole = {
  assetId: 'walk-role-test',
  glbUrl: '/people/test.glb',
  name: '测试角色',
};

function fakeActor(options: { sit?: boolean; headY?: number } = {}): OutdoorPlayerAvatarActor {
  const { sit = true, headY = 1.05 } = options;
  const group = new THREE.Group();
  if (headY > 0) {
    const head = new THREE.Object3D();
    head.name = 'Head';
    head.position.y = headY;
    group.add(head);
  }
  const mixer = new THREE.AnimationMixer(group);
  const clip = (name: string) => mixer.clipAction(new THREE.AnimationClip(name, 1, []));
  return {
    group,
    mixer,
    idle: clip('Idle_Loop'),
    walk: clip('Walk_Loop'),
    sit: sit ? clip('Sit_Idle_Loop') : null,
  };
}

function frame(overrides: Partial<OutdoorPlayerAvatarFrame> = {}): OutdoorPlayerAvatarFrame {
  return {
    x: 2,
    y: 1.6,
    z: -3,
    yaw: 0.4,
    moving: false,
    thirdPerson: true,
    delta: 0.016,
    ...overrides,
  };
}

describe('outdoor player avatar controller', () => {
  it('returns null and leaves the scene untouched when loading fails', async () => {
    const scene = new THREE.Scene();
    const fail = await createOutdoorPlayerAvatar({ scene, role, load: async () => null });
    expect(fail).toBeNull();
    expect(scene.children).toEqual([]);

    const throwFail = await createOutdoorPlayerAvatar({
      scene,
      role,
      load: async () => { throw new Error('network'); },
    });
    expect(throwFail).toBeNull();
    expect(scene.children).toEqual([]);
  });

  it('mounts idle, follows the frame and hides in first person', async () => {
    const scene = new THREE.Scene();
    const actor = fakeActor();
    const handle = await createOutdoorPlayerAvatar({
      scene,
      role,
      load: async () => actor,
    });
    expect(handle).not.toBeNull();
    expect(scene.children).toContain(actor.group);
    expect(handle!.state()).toMatchObject({ visible: false, seated: false, action: 'idle' });

    handle!.setFrame(frame());
    expect(handle!.group.position.toArray()).toEqual([2, OUTDOOR_PLAYER_AVATAR_BASE_Y, -3]);
    expect(handle!.group.rotation.y).toBeCloseTo(0.4);
    expect(handle!.state()).toMatchObject({ visible: true, seated: false, action: 'idle' });

    handle!.setFrame(frame({ thirdPerson: false }));
    expect(handle!.state().visible).toBe(false);
  });

  it('switches idle and walk when moving changes', async () => {
    const scene = new THREE.Scene();
    const actor = fakeActor();
    const handle = (await createOutdoorPlayerAvatar({ scene, role, load: async () => actor }))!;

    handle.setFrame(frame({ moving: true }));
    expect(handle.state().action).toBe('walk');
    handle.setFrame(frame({ moving: false }));
    expect(handle.state().action).toBe('idle');
  });

  it('sits on the seat eye height and returns to standing', async () => {
    const scene = new THREE.Scene();
    const actor = fakeActor({ headY: 1.05 });
    const handle = (await createOutdoorPlayerAvatar({ scene, role, load: async () => actor }))!;

    handle.setFrame(frame({ y: 1.2, seated: true }));
    expect(handle.state()).toMatchObject({ seated: true, action: 'sit', moving: false });
    // 0.052 基准 + (1.2 坐姿眼高 - 1.05 坐姿头高)
    expect(handle.state().y).toBeCloseTo(OUTDOOR_PLAYER_AVATAR_BASE_Y + 0.15);

    handle.setFrame(frame({ y: 1.6 }));
    expect(handle.state()).toMatchObject({ seated: false, action: 'idle' });
    expect(handle.state().y).toBeCloseTo(OUTDOOR_PLAYER_AVATAR_BASE_Y);
  });

  it('stays standing when the asset has no sit clip', async () => {
    const scene = new THREE.Scene();
    const actor = fakeActor({ sit: false });
    const handle = (await createOutdoorPlayerAvatar({ scene, role, load: async () => actor }))!;

    handle.setFrame(frame({ y: 1.2, seated: true }));
    expect(handle.state()).toMatchObject({ seated: false, action: 'idle' });
    expect(handle.state().y).toBeCloseTo(OUTDOOR_PLAYER_AVATAR_BASE_Y);
  });

  it('mounts a new role after the previous controller is disposed', async () => {
    const scene = new THREE.Scene();
    const loaded: string[] = [];
    const load = async (nextRole: OutdoorPlayerAvatarRole) => {
      loaded.push(nextRole.assetId);
      return fakeActor();
    };

    const first = (await createOutdoorPlayerAvatar({ scene, role, load }))!;
    expect(scene.children).toHaveLength(1);
    first.dispose();
    expect(scene.children).toHaveLength(0);

    const nextRole = { ...role, assetId: 'walk-role-next', name: '下一个角色' };
    const second = (await createOutdoorPlayerAvatar({ scene, role: nextRole, load }))!;
    expect(loaded).toEqual(['walk-role-test', 'walk-role-next']);
    expect(scene.children).toHaveLength(1);
    expect(second.state().action).toBe('idle');
    second.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('stops the mixer and removes the owned model on dispose', async () => {
    const scene = new THREE.Scene();
    const actor = fakeActor();
    const stop = vi.spyOn(actor.mixer, 'stopAllAction');
    const uncache = vi.spyOn(actor.mixer, 'uncacheRoot');
    const handle = (await createOutdoorPlayerAvatar({ scene, role, load: async () => actor }))!;

    handle.dispose();
    expect(stop).toHaveBeenCalled();
    expect(uncache).toHaveBeenCalledWith(actor.group);
    expect(scene.children).not.toContain(actor.group);
    expect(actor.group.visible).toBe(false);
    expect(() => handle.setFrame(frame())).not.toThrow();
  });
});

describe('outdoor player avatar presentation (B2.4a)', () => {
  it('shows nothing when walk is off or an NPC is controlled', () => {
    expect(outdoorPlayerPresentation({ walkEnabled: false, thirdPerson: true, controlled: false, hasGlb: true }))
      .toEqual({ showPlayer: false, showGlb: false, showCapsule: false });
    expect(outdoorPlayerPresentation({ walkEnabled: true, thirdPerson: true, controlled: true, hasGlb: true }))
      .toEqual({ showPlayer: false, showGlb: false, showCapsule: false });
  });

  it('hides the player in first person and bird view', () => {
    // 第一人称与鸟瞰在 hook 里都写 thirdPerson=false，玩家模型一律不出现。
    expect(outdoorPlayerPresentation({ walkEnabled: true, thirdPerson: false, controlled: false, hasGlb: true }))
      .toEqual({ showPlayer: false, showGlb: false, showCapsule: false });
  });

  it('shows the GLB only in third person and never draws a capsule on top', () => {
    expect(outdoorPlayerPresentation({ walkEnabled: true, thirdPerson: true, controlled: false, hasGlb: true }))
      .toEqual({ showPlayer: true, showGlb: true, showCapsule: false });
  });

  it('keeps the capsule fallback while the GLB is loading, failed or missing', () => {
    expect(outdoorPlayerPresentation({ walkEnabled: true, thirdPerson: true, controlled: false, hasGlb: false }))
      .toEqual({ showPlayer: true, showGlb: false, showCapsule: true });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type PendingActor = {
  promise: Promise<OutdoorPlayerAvatarActor | null>;
  resolve: (value: OutdoorPlayerAvatarActor | null) => void;
};

const flush = () => new Promise<void>((done) => { setTimeout(done, 0); });

describe('outdoor player avatar slot lifecycle (E7b)', () => {
  it('starts preloading immediately when a role is set, before any walk frame', async () => {
    const scene = new THREE.Scene();
    const loaded: string[] = [];
    const slot = createOutdoorPlayerAvatarSlot({
      scene,
      load: async (nextRole) => {
        loaded.push(nextRole.assetId);
        return fakeActor();
      },
    });

    expect(slot.status).toBe('empty');
    expect(slot.handle()).toBeNull();
    slot.setRole(role);
    // 预加载发生在挂槽的同一拍，不依赖 walkEnabled / 第三人称帧。
    expect(loaded).toEqual([role.assetId]);
    expect(slot.status).toBe('loading');

    await flush();
    expect(slot.status).toBe('ready');
    expect(slot.handle()).not.toBeNull();
    expect(scene.children).toHaveLength(1);
    slot.dispose();
  });

  it('drops a late result when the role changes quickly (no stacking)', async () => {
    const scene = new THREE.Scene();
    const pending = new Map<string, PendingActor>();
    const slot = createOutdoorPlayerAvatarSlot({
      scene,
      load: (nextRole) => {
        const entry = deferred<OutdoorPlayerAvatarActor | null>();
        pending.set(nextRole.assetId, entry);
        return entry.promise;
      },
    });

    const nextRole = { ...role, assetId: 'walk-role-next', name: '下一个角色' };
    const nextActor = fakeActor();
    slot.setRole(role);
    slot.setRole(nextRole);
    pending.get(nextRole.assetId)!.resolve(nextActor);
    await flush();
    expect(slot.status).toBe('ready');
    expect(slot.handle()?.group).toBe(nextActor.group);
    expect(scene.children).toEqual([nextActor.group]);

    // 旧角色的加载晚到：不能进场景，也不能顶掉新角色。
    const staleActor = fakeActor();
    pending.get(role.assetId)!.resolve(staleActor);
    await flush();
    expect(slot.handle()?.group).toBe(nextActor.group);
    expect(scene.children).toEqual([nextActor.group]);
    expect(staleActor.group.parent).toBeNull();
    slot.dispose();
  });

  it('disposes the current model before mounting the next role', async () => {
    const scene = new THREE.Scene();
    const firstActor = fakeActor();
    const nextActor = fakeActor();
    const actors = [firstActor, nextActor];
    const slot = createOutdoorPlayerAvatarSlot({ scene, load: async () => actors.shift() ?? null });

    slot.setRole(role);
    await flush();
    expect(scene.children).toEqual([firstActor.group]);

    slot.setRole({ ...role, assetId: 'walk-role-next', name: '下一个角色' });
    // setRole 同步释放旧实例，加载中不叠两个身体。
    expect(scene.children).toEqual([]);
    expect(slot.status).toBe('loading');

    await flush();
    expect(scene.children).toEqual([nextActor.group]);
    slot.dispose();
  });

  it('reports failed and leaves the scene untouched when loading fails', async () => {
    const scene = new THREE.Scene();
    const slot = createOutdoorPlayerAvatarSlot({ scene, load: async () => null });

    slot.setRole(role);
    await flush();
    expect(slot.status).toBe('failed');
    expect(slot.handle()).toBeNull();
    expect(scene.children).toEqual([]);
    slot.dispose();
  });

  it('releases a late result after dispose and ignores frames', async () => {
    const scene = new THREE.Scene();
    const pending = deferred<OutdoorPlayerAvatarActor | null>();
    const slot = createOutdoorPlayerAvatarSlot({ scene, load: () => pending.promise });

    slot.setRole(role);
    slot.dispose();
    expect(slot.status).toBe('empty');

    const lateActor = fakeActor();
    pending.resolve(lateActor);
    await flush();
    expect(scene.children).toEqual([]);
    expect(lateActor.group.parent).toBeNull();
    expect(() => slot.setFrame(frame())).not.toThrow();
  });

  it('clears the model when the role is removed', async () => {
    const scene = new THREE.Scene();
    const actor = fakeActor();
    const slot = createOutdoorPlayerAvatarSlot({ scene, load: async () => actor });

    slot.setRole(role);
    await flush();
    expect(scene.children).toEqual([actor.group]);
    slot.setRole(null);
    expect(slot.status).toBe('empty');
    expect(slot.handle()).toBeNull();
    expect(scene.children).toEqual([]);
    slot.dispose();
  });

  it('forwards frames to the mounted controller', async () => {
    const scene = new THREE.Scene();
    const actor = fakeActor();
    const slot = createOutdoorPlayerAvatarSlot({ scene, load: async () => actor });

    slot.setFrame(frame()); // 尚未加载：静默忽略
    slot.setRole(role);
    await flush();
    slot.setFrame(frame({ thirdPerson: true, moving: true }));
    expect(slot.handle()?.state()).toMatchObject({ visible: true, action: 'walk' });
    slot.dispose();
  });
});
