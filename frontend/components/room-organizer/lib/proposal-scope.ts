import { itemSignature } from './provenance';
import type { FurnitureItem, RoomLayout } from './types';

/**
 * Fields a proposal may never rewrite. Venue tools and cloud/template loads
 * carry their own origin and are not proposals, so they stay exempt.
 */
const LOCKED_LAYOUT_KEYS = [
  'id',
  'width',
  'height',
  'scenePreset',
  'backendVenue',
  'backendSceneV2',
  'entrance',
  'roof',
  'terrain',
  'frontage',
  'neighbours',
  'floorPlanImage',
  'floorPlanOpacity',
  'floorPlanFitMode',
  'satelliteGroundRef',
  'mapGroundPolygon',
  'mapLngLat',
  'mapGroundFrame',
] as const;

const LOCKED_FLOOR_KEYS = ['id', 'height', 'interiorWalls'] as const;

export type ProposalScopeCode = 'VENUE_LOCKED' | 'STRUCTURE_ITEM_LOCKED';

export interface ProposalScopeViolation {
  code: ProposalScopeCode;
  message: string;
  objectIds: string[];
}

function field(layout: RoomLayout, key: string): unknown {
  return (layout as unknown as Record<string, unknown>)[key];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function isFixedInstance(item: FurnitureItem): boolean {
  return item.locked === true
    || item.venueEntranceId !== undefined
    || item.structuralOpeningId !== undefined
    || item.structuralColumnId !== undefined
    || item.glbNode !== undefined;
}

/**
 * Two-phase apply guard: a proposal may rearrange material instances but it
 * cannot move the venue, its storeys, its walls, or the items that hold the
 * building together. Anything outside that scope is refused before apply.
 */
export function proposalScopeViolations(current: RoomLayout, next: RoomLayout): ProposalScopeViolation[] {
  const issues: ProposalScopeViolation[] = [];
  const layoutChanged = LOCKED_LAYOUT_KEYS.some(key => stable(field(current, key)) !== stable(field(next, key)));
  const floorsChanged = current.floors.length !== next.floors.length
    || current.floors.some((floor, index) => {
      const candidate = next.floors[index];
      return !candidate || LOCKED_FLOOR_KEYS.some(key => stable((floor as unknown as Record<string, unknown>)[key]) !== stable((candidate as unknown as Record<string, unknown>)[key]));
    });
  if (layoutChanged || floorsChanged) {
    issues.push({
      code: 'VENUE_LOCKED',
      message: '助手方案不能改写场地尺寸、屋顶/地形/入口、楼层或内墙；请先用场地工具确认这些改动。',
      objectIds: [],
    });
  }

  const nextItems = new Map(next.floors.flatMap(floor => floor.items).map(item => [item.id, item]));
  const fixed = current.floors.flatMap(floor => floor.items).filter(isFixedInstance);
  const broken = fixed.filter(item => {
    const candidate = nextItems.get(item.id);
    return !candidate || itemSignature(candidate) !== itemSignature(item);
  });
  if (broken.length > 0) {
    issues.push({
      code: 'STRUCTURE_ITEM_LOCKED',
      message: `助手方案不能移动、替换或删除锁定/结构物件：${broken.slice(0, 3).map(item => item.name).join('、')}${broken.length > 3 ? ' 等' : ''}。`,
      objectIds: broken.map(item => item.id),
    });
  }
  return issues;
}
