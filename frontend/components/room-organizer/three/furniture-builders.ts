import { mountBand } from '../lib/mount-band';
import { type BuilderContext, type FurnitureBuilder, type ThreeModule, buildFallback } from './builder-utils';
import { isWallHung } from '../lib/mount-band';
import { isWallMounted } from '../lib/opening-snap';

import { buildToilet, buildBathtub, buildShower } from './builders/builders-bathroom';
import { buildBed, buildNightstand, buildDresser } from './builders/builders-bedroom';
import {
  buildRug, buildPainting, buildVase, buildMirror, buildCurtains,
  buildWallShelf, buildWallClock, buildCandles, buildBooksStack,
} from './builders/builders-decor';
import { buildTV, buildComputer, buildWiFi, buildRouter, buildCCTV, buildSecurityCamera } from './builders/builders-electronics';
import { buildFridge, buildStove, buildSink, buildCounter } from './builders/builders-kitchen';
import { buildLamp, buildPendantLight, buildLamppost } from './builders/builders-lighting';
import {
  buildFence, buildPool, buildBbq, buildMailbox, buildBirdbath,
  buildSteppingStone, buildGardenBench, buildPicnicTable, buildPond,
} from './builders/builders-outdoor';
import { buildPerson, buildPet } from './builders/builders-people';
import {
  buildPlant, buildFlowerpot, buildTree, buildPineTree, buildBush,
  buildHedge, buildFlowerBed, buildTulips, buildSunflower, buildRoseBush,
} from './builders/builders-plants';
import { buildChair, buildArmchair, buildBench, buildSofa } from './builders/builders-seating';
import { buildBookshelf, buildCabinet } from './builders/builders-storage';
import { buildDoor, buildWindow, buildStairs } from './builders/builders-structure';
import { buildTableOrDesk } from './builders/builders-tables';
import { createCachedGlbModel, getGlbAssetState, glbAssetKey } from './glb-assets';
import type { FurnitureItem } from '../lib/types';

const BUILDERS: Record<string, FurnitureBuilder> = {
  bed: buildBed,
  chair: buildChair,
  'dining-chair': buildChair,
  armchair: buildArmchair,
  bench: buildBench,
  sofa: buildSofa,
  table: buildTableOrDesk,
  'dining-table': buildTableOrDesk,
  'coffee-table': buildTableOrDesk,
  'side-table': buildTableOrDesk,
  desk: buildTableOrDesk,
  bookshelf: buildBookshelf,
  cabinet: buildCabinet,
  wardrobe: buildCabinet,
  dresser: buildDresser,
  lamp: buildLamp,
  'floor-lamp': buildLamp,
  plant: buildPlant,
  flowerpot: buildFlowerpot,
  tree: buildTree,
  tv: buildTV,
  computer: buildComputer,
  nightstand: buildNightstand,
  wifi: buildWiFi,
  router: buildRouter,
  cctv: buildCCTV,
  'security-camera': buildSecurityCamera,
  fridge: buildFridge,
  stove: buildStove,
  dishwasher: buildCabinet,
  'kitchen-sink': buildSink,
  'bathroom-sink': buildSink,
  counter: buildCounter,
  toilet: buildToilet,
  bathtub: buildBathtub,
  shower: buildShower,
  rug: buildRug,
  painting: buildPainting,
  vase: buildVase,
  mirror: buildMirror,
  curtains: buildCurtains,
  'pendant-light': buildPendantLight,
  'wall-shelf': buildWallShelf,
  'wall-clock': buildWallClock,
  candles: buildCandles,
  books: buildBooksStack,
  fence: buildFence,
  pool: buildPool,
  'pine-tree': buildPineTree,
  bush: buildBush,
  hedge: buildHedge,
  flowerbed: buildFlowerBed,
  tulips: buildTulips,
  sunflower: buildSunflower,
  'rose-bush': buildRoseBush,
  bbq: buildBbq,
  mailbox: buildMailbox,
  birdbath: buildBirdbath,
  lamppost: buildLamppost,
  'stepping-stone': buildSteppingStone,
  'garden-bench': buildGardenBench,
  'picnic-table': buildPicnicTable,
  pond: buildPond,
  person: buildPerson,
  pet: buildPet,
  stairs: buildStairs,
  door: buildDoor,
  window: buildWindow,
};

export function createFurnitureModel(
  THREE: ThreeModule,
  item: FurnitureItem,
  hasCollision: boolean
): ReturnType<FurnitureBuilder> {
  if (item.type === 'glb-asset' || item.assetId || item.glbUrl) {
    const loaded = createCachedGlbModel(item);
    if (loaded) return loaded;
    const key = glbAssetKey(item);
    const state = key ? getGlbAssetState(key) : { status: 'error' as const };
    const placeholder = buildFallback({ THREE, item, hasCollision: false,
      baseColor: state.status === 'error' ? '#b94c4c' : '#b5a87b', opacity: 0.45 });
    placeholder.userData.glbStatus = state.status;
    placeholder.name = state.status === 'error' ? '模型加载失败（占位）' : '模型待加载（占位）';
    return withElevation(item, fitToDeclared(THREE, item, placeholder));
  }
  const ctx: BuilderContext = {
    THREE,
    item,
    hasCollision,
    baseColor: hasCollision ? 0xff0000 : item.color,
    opacity: hasCollision ? 0.7 : 1.0,
  };
  const builder = BUILDERS[item.type] ?? buildFallback;
  return withElevation(item, fitToDeclared(THREE, item, builder(ctx)));
}

/**
 * 把建好的模型对回目录里的标称尺寸：宽 / 深 / 高各按比例收放，
 * 水平居中；站地物件的底面落到 y=0，挂墙 / 门窗保持自己的基准高度。
 * 这样一来「1 m 就是 1 m」不是靠 builder 自觉，而是每次建模都强制对表。
 */
function fitToDeclared(THREE: ThreeModule, item: FurnitureItem, model: ReturnType<FurnitureBuilder>): ReturnType<FurnitureBuilder> {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(n => Number.isFinite(n) && n > 1e-6)) return model;
  const center = box.getCenter(new THREE.Vector3());
  const sx = item.width > 0 ? item.width / size.x : 1;
  const sz = item.depth > 0 ? item.depth / size.z : 1;
  // 标称高度只是「板厚 / 水深」的几类，模型里含摆件或水面，硬压会变形；
  // 它们的尺寸误差由各自 builder 负责，这里只对齐水平占地。
  const sy = item.height > 0 && !HEIGHT_FIT_EXEMPT.has(item.type) ? item.height / size.y : 1;
  const groundItem = !isWallHung(item.type) && !isWallMounted(item.type) && item.type !== 'pendant-light';
  const targetBottom = groundItem ? 0 : box.min.y;
  const needsFit =
    Math.abs(sx - 1) > 0.005 ||
    Math.abs(sy - 1) > 0.005 ||
    Math.abs(sz - 1) > 0.005 ||
    Math.abs(center.x) > 0.001 ||
    Math.abs(center.z) > 0.001 ||
    Math.abs(targetBottom - box.min.y) > 0.001;
  if (!needsFit) return model;
  const wrapper = new THREE.Group();
  wrapper.userData.fitToDeclared = true;
  wrapper.scale.set(sx, sy, sz);
  wrapper.position.set(-center.x * sx, targetBottom - box.min.y * sy, -center.z * sz);
  wrapper.add(model);
  return wrapper;
}

/** 标称高度不是整体外廓的类型（挂墙板的摆件、池塘的水面）。 */
const HEIGHT_FIT_EXEMPT = new Set(['wall-shelf', 'pond']);

/** Match GLB instances: meshes carry their elevation, the outer group stays on the floor. */
function withElevation(item: FurnitureItem, model: ReturnType<FurnitureBuilder>): ReturnType<FurnitureBuilder> {
  if (item.elevation !== undefined) {
    const { elevation, ...grounded } = item;
    const offset = elevation - mountBand(grounded).bottom;
    for (const child of model.children) child.position.y += offset;
  }
  return model;
}
