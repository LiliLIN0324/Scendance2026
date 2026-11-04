/**
 * 实测地形 / 布置的数值审计。
 *
 * 这份代码只量、不改：给定目录里的真实尺寸，把 3D 模型建出来，
 * 读出它在世界坐标里的包围盒，算出「底面离地」「渲染尺寸 vs 标称尺寸」
 * 「物件互相穿插」「出墙」四类偏差。测试与离线测量脚本都读它，
 * 同一个数字在浏览器里和命令行里必须一致。
 */
import * as THREE from 'three';
import { FURNITURE_CATALOG } from '../lib/constants';
import { hasCollisions } from '../lib/geometry';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { isWallHung, mountBand } from '../lib/mount-band';
import { isWallMounted } from '../lib/opening-snap';
import { createFurnitureModel } from './furniture-builders';
import type { CatalogItem, FloorLayout, FurnitureItem, RoomLayout } from '../lib/types';

/** 场地内不站在地面上的类型：挂墙装饰、门窗 / 摄像机、吊灯。 */
const NON_FLOOR_TYPES = new Set(['pendant-light']);

/** 标称高度不是整体外廓的类型：挂墙板的「高」是板厚，池塘的「高」是水体深。 */
const HEIGHT_SUB_DIMENSION = new Set(['wall-shelf', 'pond']);

export interface ModelMeasurement {
  type: string;
  name: string;
  /** 包围盒底面（世界 Y，地面为 0）。 */
  bottomY: number;
  /** 包围盒顶面（世界 Y）。 */
  topY: number;
  widthX: number;
  depthZ: number;
  heightY: number;
  /** 目录标称尺寸，米。 */
  declared: { width: number; depth: number; height: number };
  /** 底面与地面（或其挂墙/吊顶基准）的偏差，米。 */
  groundError: number;
  /** 渲染尺寸相对标称宽/深/高的最大偏差，百分比。 */
  scaleErrorPct: number;
  /** 标称高度只是组合件里的一部分（挂墙板板厚 / 池塘水体），高度不参与比例判定。 */
  heightSubDimension: boolean;
  /** 该类物件是否应当贴地（挂墙 / 门窗 / 吊灯不参与落地判定）。 */
  floorItem: boolean;
}

/**
 * 把一件物件的模型建出来并量它的世界包围盒。
 * 物件按编辑器的实际摆放方式放在 (0,0,0)，不带楼层抬升。
 */
export function measureModel(item: FurnitureItem): ModelMeasurement {
  return measureFromModel(createFurnitureModel(THREE, item, false), item);
}

/** 量一个已经建好的模型，供「改前 / 改后」共用同一套口径。 */
export function measureFromModel(model: THREE.Object3D, item: FurnitureItem): ModelMeasurement {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const floorItem = !isWallHung(item.type) && !isWallMounted(item.type) && !NON_FLOOR_TYPES.has(item.type);
  const expectedBottom = floorItem ? 0 : mountBand(item).bottom;
  const heightSubDimension = HEIGHT_SUB_DIMENSION.has(item.type);
  const scaleErrorPct = Math.max(
    percentError(size.x, item.width),
    percentError(size.z, item.depth),
    heightSubDimension ? 0 : percentError(size.y, item.height)
  );
  return {
    type: item.type,
    name: item.name,
    bottomY: round(box.min.y, 4),
    topY: round(box.max.y, 4),
    widthX: round(size.x, 4),
    depthZ: round(size.z, 4),
    heightY: round(size.y, 4),
    declared: { width: item.width, depth: item.depth, height: item.height },
    groundError: round(Math.abs(box.min.y - expectedBottom), 4),
    scaleErrorPct: round(scaleErrorPct, 2),
    heightSubDimension,
    floorItem,
  };
}

export interface AuditThresholds {
  /** 底面贴地允许误差，米。 */
  groundM: number;
  /** 尺寸允许误差，百分比。 */
  scalePct: number;
}

export const ACCEPTANCE: AuditThresholds = { groundM: 0.01, scalePct: 2 };

export function auditCatalog(thresholds: AuditThresholds = ACCEPTANCE): ModelMeasurement[] {
  return FURNITURE_CATALOG.map(item => measureModel({ ...item, id: `audit-${item.type}`, position: { x: 0, z: 0 }, rotation: 0 } as FurnitureItem))
    .filter(m => m.groundError > thresholds.groundM || m.scaleErrorPct > thresholds.scalePct)
    .sort((a, b) => b.scaleErrorPct - a.scaleErrorPct);
}

export interface LayoutAudit {
  name: string;
  itemCount: number;
  /** 互相穿插的物件对数。 */
  overlaps: number;
  /** 插进墙里 / 越界的物件数。 */
  outOfBounds: number;
  /** 每一对穿插的具体物件，便于定位。 */
  pairs: string[];
}

/** 逐件跑与编辑器同一套 hasCollisions，量现有布置的穿插量。 */
export function auditFloor(name: string, floor: FloorLayout, layout: Pick<RoomLayout, 'width' | 'height'>): LayoutAudit {
  const pairs: string[] = [];
  let outOfBounds = 0;
  for (const item of floor.items) {
    const collision = hasCollisions(item, floor.items, layout.width, layout.height, {
      interiorWalls: floor.interiorWalls ?? [],
    });
    if (!collision) continue;
    const another = floor.items.some(
      other => other.id !== item.id && hasCollisions(item, [other], layout.width, layout.height, {
        interiorWalls: floor.interiorWalls ?? [],
      })
    );
    if (another) {
      const partner = floor.items.find(
        other => other.id !== item.id && hasCollisions(item, [other], layout.width, layout.height, {
          interiorWalls: floor.interiorWalls ?? [],
        })
      );
      if (partner) pairs.push(`${item.name} (${item.type}) ↔ ${partner.name} (${partner.type})`);
    } else {
      outOfBounds += 1;
    }
  }
  return {
    name,
    itemCount: floor.items.length,
    overlaps: pairs.length,
    outOfBounds,
    pairs: dedupePairs(pairs),
  };
}

export function auditInitialLayout(): LayoutAudit[] {
  return INITIAL_LAYOUT.floors.map(floor => auditFloor(floor.name, floor, INITIAL_LAYOUT));
}

/**
 * 改前基线：把建模时套上的「对表包装」暂时还原成恒等变换，量同一件模型
 * 在修好之前的样子。只用于报告前后对比，不参与验收。
 */
export function measureRawModel(item: FurnitureItem): ModelMeasurement {
  const model = createFurnitureModel(THREE, item, false);
  if (!model.userData.fitToDeclared) return measureFromModel(model, item);
  const wrapper = model;
  const scale = wrapper.scale.clone();
  const position = wrapper.position.clone();
  wrapper.scale.set(1, 1, 1);
  wrapper.position.set(0, 0, 0);
  wrapper.updateMatrixWorld(true);
  const raw = measureFromModel(wrapper, item);
  wrapper.scale.copy(scale);
  wrapper.position.copy(position);
  wrapper.updateMatrixWorld(true);
  return raw;
}

/** 一件物件用模型量出的「底面原点偏移」：底面在原点时为 0，中心原点时为半高。 */
export function modelBaseOffset(item: FurnitureItem): number {
  const model = createFurnitureModel(THREE, item, false);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  return round(-box.min.y, 4);
}

function percentError(actual: number, declared: number): number {
  if (!(declared > 0) || !Number.isFinite(actual)) return 0;
  return Math.abs(actual / declared - 1) * 100;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dedupePairs(pairs: readonly string[]): string[] {
  return [...new Set(pairs)];
}

/** 目录条目 → 审计用的物件对象（位置在原点）。 */
export function catalogToItem(catalog: CatalogItem): FurnitureItem {
  return { ...catalog, id: `audit-${catalog.type}`, position: { x: 0, z: 0 }, rotation: 0 } as FurnitureItem;
}
