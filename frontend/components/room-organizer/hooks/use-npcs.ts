import { useEffect, useRef } from 'react';
import {
  CROWD_MAX,
  createCrowdWalkers,
  crowdColliders,
  planCrowdRoute,
  stepCrowdWalker,
  type CrowdVenue,
  type CrowdWalker,
} from '../lib/crowd-route';
import { disposeObject } from '../three/builder-utils';
import { type HumanFigureRig, buildHumanFigure, poseWalk } from '../three/builders/human-figure';
import type { FurnitureItem, InteriorWall } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const NPC_TAG = 'npc';
const NO_ITEMS: readonly FurnitureItem[] = [];
const NO_WALLS: readonly InteriorWall[] = [];

interface NpcState {
  group: ThreeNS.Group;
  walker: CrowdWalker;
  rig: HumanFigureRig;
}

export interface UseNpcsOptions {
  enabled: boolean;
  count?: number;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  roomWidth: number;
  roomDepth: number;
  /** Y-offset to plant the NPCs on the active floor. */
  floorY: number;
  /** Placed furniture and partitions the crowd walks around. Same solids as walkthrough. */
  items?: readonly FurnitureItem[];
  interiorWalls?: readonly InteriorWall[];
  /** Scene-space venue polygon (SW origin). Omitted → the rectangular footprint. */
  polygon?: readonly { x: number; z: number }[];
  /** Main-entrance opening id. When it matches a door, the crowd files in from that door. */
  mainEntranceId?: string;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate?: () => void;
  /**
   * Recompute the static shadow map. NPCs cast shadows, so while they're
   * actually walking their shadows must keep updating — but only then.
   */
  requestShadowUpdate?: () => void;
}

/**
 * Atmosphere preview: up to three coloured figures walk a route inside the
 * venue. This is not the first-person walkthrough — that camera stays on
 * PointerLock / WASD and is never moved from here.
 *
 * With a main entrance they start just inside that door and file in. Otherwise
 * they walk the free cells of the footprint. Limb swing only plays while a
 * figure actually translates, so a pause is a stand, not an in-place cycle.
 */
export function useNpcs(options: UseNpcsOptions): void {
  const {
    enabled, count = CROWD_MAX, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY,
    items = NO_ITEMS, interiorWalls = NO_WALLS, polygon, mainEntranceId, invalidate, requestShadowUpdate,
  } = options;
  const stateRef = useRef<NpcState[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;
    if (roomWidth <= 0.4 || roomDepth <= 0.4) return undefined;

    const venue: CrowdVenue = {
      roomWidth,
      roomDepth,
      items,
      interiorWalls,
      ...(polygon && polygon.length >= 3 ? { polygon } : {}),
      ...(mainEntranceId ? { mainEntranceId } : {}),
    };
    const plan = planCrowdRoute(venue);
    const colliders = crowdColliders(venue);
    const walkers = createCrowdWalkers(plan, count, colliders);
    const npcs: NpcState[] = walkers.map((walker, index) => createNpc(THREE, scene, floorY, index, walker));
    stateRef.current = npcs;
    invalidate?.();

    let rafId = 0;
    let lastTime = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      let moved = false;
      for (const npc of stateRef.current) {
        const stepped = stepCrowdWalker(npc.walker, plan, colliders, delta);
        npc.group.position.x = npc.walker.x;
        npc.group.position.z = npc.walker.z;
        npc.group.rotation.y = npc.walker.facing;
        if (stepped) {
          poseWalk(npc.rig, npc.walker.phase, 1);
          npc.group.position.y = floorY + Math.abs(Math.cos(npc.walker.phase)) * 0.025;
          moved = true;
        } else {
          poseWalk(npc.rig, 0, 0);
          npc.group.position.y = floorY;
        }
      }
      if (moved) {
        requestShadowUpdate?.();
        invalidate?.();
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      for (const npc of stateRef.current) {
        scene.remove(npc.group);
        disposeObject(npc.group);
      }
      stateRef.current = [];
      // Nothing else consumes showNpcs, so without an explicit repaint (and a
      // shadow-map refresh — walkers cast) the removed NPCs stay painted in
      // the last frame until something unrelated invalidates (#119).
      requestShadowUpdate?.();
      invalidate?.();
    };
  }, [enabled, count, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, roomWidth, roomDepth, floorY, items, interiorWalls, polygon, mainEntranceId]);
}

function createNpc(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  floorY: number,
  index: number,
  walker: CrowdWalker,
): NpcState {
  const palette = [0xc62828, 0x2e7d32, 0x1565c0, 0xf9a825, 0x6a1b9a];
  const hairPalette = [0x2b1d14, 0x5a3825, 0x1a1a1a, 0x8d6e4a, 0x3b2a20];
  const skinPalette = [0xe0ac8a, 0xc68863, 0x8d5a3b, 0xf1c7a5, 0xa8714f];
  const pick = (list: number[]) => list[index % list.length] ?? list[0]!;
  const heightScale = 0.94 + ((index * 37) % 11) / 100;

  const figure = buildHumanFigure(THREE, {
    top: new THREE.MeshStandardMaterial({ color: pick(palette), roughness: 0.8 }),
    skin: new THREE.MeshStandardMaterial({ color: skinPalette[(index * 2) % skinPalette.length] ?? 0xe0ac8a, roughness: 0.65 }),
    bottom: new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.85 }),
    shoes: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 }),
    hair: new THREE.MeshStandardMaterial({ color: pick(hairPalette), roughness: 0.9 }),
  });
  const group = figure.group;
  group.scale.setScalar(heightScale);
  group.userData.type = NPC_TAG;
  group.position.set(walker.x, floorY, walker.z);
  group.rotation.y = walker.facing;
  scene.add(group);

  return { group, walker, rig: figure.rig };
}
