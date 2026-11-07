import { type BuilderContext, cornerPositions, material, mesh } from '../builder-utils';
import { PEOPLE_CLIPS, clonePerson, findClip, getPeopleModel } from '../people-model';
import { personIsAnimated, registerPersonAnim } from '../people-anim';
import { FIGURE_HEIGHT, buildHumanFigure } from './human-figure';
import type * as ThreeNS from 'three';

export function buildPerson(ctx: BuilderContext): ThreeNS.Group {
  return buildRiggedPerson(ctx) ?? buildProceduralPerson(ctx);
}

/**
 * The rigged mannequin. Null until people.glb has loaded — the scene rebuilds
 * furniture once it has (see usePeopleModel).
 *
 * Plain persons stay a still idle pose exactly as before (mixer sampled once,
 * then dropped — stopping would restore the T-pose). Persons with a route or
 * an explicit action keep their mixer alive in the people-anim registry, so
 * they animate and walk without being reset by furniture rebuilds.
 */
function buildRiggedPerson({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group | null {
  const people = getPeopleModel();
  const idle = people && findClip(people, PEOPLE_CLIPS.idle);
  if (!people || !idle) return null;
  const person = clonePerson(THREE, people, {
    body: baseColor,
    joints: hasCollision ? 0x7f1d1d : 0x3a3f47,
    opacity,
  });
  person.scale.setScalar(item.height / people.height);
  const group = new THREE.Group();
  group.add(person);
  if (personIsAnimated(item.walkRoute, item.personAction, item.personPaused)) {
    registerPersonAnim(group, {
      id: item.id,
      mixer: new THREE.AnimationMixer(person),
      rig: null,
      clips: {
        idle,
        talk: findClip(people, PEOPLE_CLIPS.talk),
        walk: findClip(people, PEOPLE_CLIPS.walk),
      },
      action: item.personAction ?? 'idle',
      paused: item.personPaused === true,
      route: item.walkRoute ?? null,
    });
    return group;
  }
  // Sample the idle clip once to leave the skeleton in a relaxed stance. The
  // mixer is dropped rather than stopped: stopping restores the T-pose.
  const mixer = new THREE.AnimationMixer(person);
  mixer.clipAction(idle).play();
  mixer.update(0.6);
  return group;
}

function buildProceduralPerson({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  // The item colour dresses the figure; skin, trousers, shoes and hair are fixed.
  const { group: figure, rig } = buildHumanFigure(THREE, {
    top: material(THREE, baseColor, hasCollision, opacity, { roughness: 0.8 }),
    skin: material(THREE, 0xd9a787, hasCollision, opacity, { roughness: 0.65 }),
    bottom: material(THREE, 0x2f3542, hasCollision, opacity, { roughness: 0.85 }),
    shoes: material(THREE, 0x1c1c1c, hasCollision, opacity, { roughness: 0.6 }),
    hair: material(THREE, 0x3b2a20, hasCollision, opacity, { roughness: 0.9 }),
  });
  // Scale uniformly from height so a resized person stays in proportion.
  figure.scale.setScalar(item.height / FIGURE_HEIGHT);
  const group = new THREE.Group();
  group.add(figure);
  // 程序化兜底同样支持路线行走：模型没加载时用关节摆动代替 clip（ PEOPLE-04 不空转）。
  if (personIsAnimated(item.walkRoute, item.personAction, item.personPaused)) {
    registerPersonAnim(group, {
      id: item.id,
      mixer: null,
      rig,
      clips: { idle: null, talk: null, walk: null },
      action: item.personAction ?? 'idle',
      paused: item.personPaused === true,
      route: item.walkRoute ?? null,
    });
  }
  return group;
}

export function buildPet({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const furMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.85 });
  const noseMat = material(THREE, 0x1b1b1b, hasCollision, opacity, { roughness: 0.6 });

  // Body
  const body = mesh(
    THREE,
    new THREE.SphereGeometry(item.width * 0.45, 14, 12),
    furMat
  );
  body.scale.set(1, 0.7, 1.6);
  body.position.y = item.height * 0.55;
  group.add(body);

  // Head
  const head = mesh(THREE, new THREE.SphereGeometry(item.width * 0.32, 14, 12), furMat);
  head.position.set(0, item.height * 0.8, -item.depth * 0.9);
  group.add(head);

  // Nose
  const nose = mesh(THREE, new THREE.SphereGeometry(item.width * 0.06, 8, 8), noseMat);
  nose.position.set(0, item.height * 0.75, -item.depth * 1.25);
  group.add(nose);

  // Ears
  const earGeo = new THREE.ConeGeometry(item.width * 0.1, item.height * 0.25, 10);
  for (const dx of [-1, 1]) {
    const ear = mesh(THREE, earGeo, furMat);
    ear.position.set(dx * item.width * 0.18, item.height * 1.05, -item.depth * 0.9);
    ear.rotation.z = dx * 0.2;
    group.add(ear);
  }

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.04, 0.05, item.height * 0.45, 8);
  for (const [x, y, z] of cornerPositions(item.width * 0.25, item.height * 0.225, item.depth * 0.55)) {
    const leg = mesh(THREE, legGeo, furMat);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  // Tail
  const tail = mesh(THREE, new THREE.CylinderGeometry(0.03, 0.05, item.depth * 0.7, 8), furMat);
  tail.position.set(0, item.height * 0.7, item.depth * 0.95);
  tail.rotation.x = -Math.PI / 3;
  group.add(tail);

  return group;
}
