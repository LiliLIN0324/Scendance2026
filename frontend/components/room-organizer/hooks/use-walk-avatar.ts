import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildPerson } from '../three/builders/builders-people';
import { createWalkAvatar, disposeOwnedModel, ensureGlbAsset } from '../three/glb-assets';
import type { FurnitureItem } from '../lib/types';

type WalkFrame = { x: number; y: number; z: number; yaw: number; moving: boolean; thirdPerson: boolean; delta: number };

export function useWalkAvatar(enabled: boolean, url: string, sceneRef: React.RefObject<THREE.Scene | null>, label = '角色') {
  const actors = useRef<{ avatar: NonNullable<ReturnType<typeof createWalkAvatar>>; visitor: THREE.Group; spawned: boolean; moving: boolean } | null>(null);
  const nearRef = useRef(false);
  const [near, setNear] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const scene = sceneRef.current;
    if (!scene) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setNear(false);
    setGreeted(false);
    nearRef.current = false;
    void ensureGlbAsset(url, url).then(() => {
      if (cancelled) return;
      setLoading(false);
      const person: FurnitureItem = { id: 'walk-avatar', type: 'person', name: label, glbUrl: url,
        width: 0.55, depth: 0.45, height: 1.65, color: '#ffffff', icon: '◇', price: 0, category: 'decor' };
      const avatar = createWalkAvatar(person);
      if (!avatar) throw new Error(`${label}模型缺少站立或步行动画。`);
      const visitor = buildPerson({ THREE, item: { ...person, id: 'walk-visitor', name: '游客' },
        baseColor: 0x315f79, hasCollision: false, opacity: 1 });
      avatar.idle.play();
      avatar.group.visible = false;
      visitor.visible = false;
      actors.current = { avatar, visitor, spawned: false, moving: false };
      scene.add(avatar.group, visitor);
    }).catch(reason => {
      if (cancelled) return;
      setLoading(false);
      setError(reason instanceof Error ? reason.message : `${label}加载失败`);
    });
    return () => {
      cancelled = true;
      const current = actors.current;
      actors.current = null;
      if (!current) return;
      current.avatar.mixer.stopAllAction();
      current.avatar.mixer.uncacheRoot(current.avatar.group);
      current.avatar.group.removeFromParent();
      current.visitor.removeFromParent();
      disposeOwnedModel(current.avatar.group);
      disposeOwnedModel(current.visitor);
    };
  }, [enabled, url, label, sceneRef, attempt]);

  function frame(value: WalkFrame) {
    const current = actors.current;
    const scene = sceneRef.current;
    if (!current || !scene) return;
    const { avatar, visitor } = current;
    const x = value.x - scene.position.x;
    const y = value.y - scene.position.y - 1.6;
    const z = value.z - scene.position.z;
    avatar.group.position.set(x, y, z);
    avatar.group.rotation.y = value.yaw;
    avatar.group.visible = value.thirdPerson;
    if (!current.spawned) {
      current.spawned = true;
      visitor.position.set(x + Math.sin(value.yaw) * 2.1, y, z + Math.cos(value.yaw) * 2.1);
      visitor.visible = true;
    }
    visitor.rotation.y = Math.atan2(x - visitor.position.x, z - visitor.position.z);
    if (current.moving !== value.moving) {
      current.moving = value.moving;
      const next = value.moving ? avatar.walk : avatar.idle;
      const previous = value.moving ? avatar.idle : avatar.walk;
      next.reset().play().crossFadeFrom(previous, 0.16, false);
    }
    avatar.mixer.update(value.delta);
    const nearby = Math.hypot(x - visitor.position.x, z - visitor.position.z) < 1.55;
    if (nearRef.current !== nearby) {
      nearRef.current = nearby;
      setNear(nearby);
      if (!nearby) setGreeted(false);
    }
  }

  return {
    frame, near, greeted, loading, error,
    greet: () => { if (nearRef.current) setGreeted(true); },
    retry: () => setAttempt(value => value + 1),
  };
}
