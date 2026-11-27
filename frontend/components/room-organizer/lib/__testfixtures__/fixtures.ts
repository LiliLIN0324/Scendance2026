import type { CatalogItem, FloorLayout, FurnitureItem, RoomLayout, RoomZone, ViewSettings } from '../types';
import type { LegacyLayoutGround } from '../legacy-ground';
import { rectToZoneRing, type ZoneRect } from '../zones';

/** Build a valid FurnitureItem with sane defaults; override any field. */
export function makeItem(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return {
    id: 'item-1',
    type: 'chair',
    name: 'Chair',
    width: 1,
    depth: 1,
    height: 1,
    color: '#ffffff',
    icon: '🪑',
    position: { x: 0, z: 0 },
    rotation: 0,
    ...overrides,
  };
}

/** `makeItem()` without a position: an item that is not placed on the floor. */
export function makeUnplacedItem(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  const { position: _unplaced, ...item } = makeItem(overrides);
  return item;
}

/** Build a valid RoomZone ring. `rect` expands to a four-corner ring; pass `polygon` for an arbitrary ring. */
export function makeZone(
  overrides: Partial<Omit<RoomZone, 'polygon'>> & { rect?: ZoneRect; polygon?: RoomZone['polygon'] } = {}
): RoomZone {
  const { rect, polygon, ...rest } = overrides;
  return {
    id: 'zone-1',
    name: 'Zone 1',
    color: '#3b82f6',
    polygon: polygon ?? rectToZoneRing(rect ?? { x: -1, z: -1, w: 2, d: 2 })!,
    ...rest,
  };
}

/** Build a valid CatalogItem (no id/position/rotation). */
export function makeCatalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    type: 'chair',
    name: 'Chair',
    width: 1,
    depth: 1,
    height: 1,
    color: '#ffffff',
    icon: '🪑',
    price: 100,
    category: 'seating',
    ...overrides,
  };
}

export function makeFloor(overrides: Partial<FloorLayout> = {}): FloorLayout {
  return {
    id: 'ground',
    name: 'Ground Floor',
    floorColor: '#c9a57d',
    items: [],
    ...overrides,
  };
}

export function makeLayout(overrides: Partial<RoomLayout> & LegacyLayoutGround = {}): RoomLayout {
  return {
    name: 'My Home',
    width: 8,
    height: 8,
    floors: [makeFloor()],
    roof: { style: 'gable', color: '#5d3a23' },
    ...overrides,
  };
}

/** The editor's initial view settings, with overrides. */
export function makeViewSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return {
    view2D: false,
    showMeasurements: true,
    lengthUnit: 'm',
    showWiFiSignals: true,
    snapToGrid: false,
    snapToWall: false,
    snapToItems: false,
    floorPlan3DEffect: false,
    timeOfDay: 12,
    weather: 'clear',
    showOutdoor: true,
    showAllFloors: false,
    wallDisplay: 'cutaway',
    selectMode: true,
    measurementMode: false,
    soundsEnabled: false,
    drawZoneMode: false,
    showHeatmap: false,
    showItemLabels: false,
    ...overrides,
  };
}
