/**
 * SC-16 四件套验收（docs/24 1-1～1-6 的可自动部分）。
 *
 * 十个「可交付」夹具任务（不是失败夹具，F01–F10 在 delivery-package.test.ts）
 * 逐个走确认版 → 打包 → 解包 → 量 DXF → 复算 CSV → 读分享链接，把
 * 「10/10、0 人工改名、同版四件套一致」变成可复跑的断言。
 *
 * 证据：设置 DELIVERY_ACCEPTANCE_OUT=<json 路径> 时，本文件会把逐任务读数写出去；
 * 默认不写盘，门禁里只做断言。
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  contentFingerprintOfLayout,
  DELIVERY_VERSION_STORAGE_KEY,
  snapshotIdFor,
} from './delivery-version';
import {
  buildDeliveryPackage,
  type DeliveryPackageIdentity,
  type DeliveryPackageResult,
} from './delivery-package';
import { DELIVERY_ARTIFACTS, deliveryArtifactPath, deliveryPackageRoot } from './delivery-package-spec';
import { readShareHash } from './share';
import type { RoomLayout } from './types';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ORIGIN = 'https://scendance.example';
const CONFIRMED_AT = '2026-11-08T09:00:00.000Z';
const GENERATED_AT = '2026-11-08T10:00:00.000Z';
const TEN_MINUTES_MS = 10 * 60 * 1000;

interface TaskSpec {
  name: string;
  floorName: string;
  width: number;
  height: number;
  door: { width: number; x: number };
  window: { width: number; x: number };
  table: { name: string; width: number; depth: number; x: number; z: number };
  chair: { name: string; width: number; depth: number; x: number; z: number };
}

/** 十种场地尺寸 / 楼层名 / 项目名；门窗和两件家具的已知尺寸用来量 DXF。 */
const TASKS: readonly TaskSpec[] = [
  { name: '西湖会客厅', floorName: '1F', width: 12, height: 8,
    door: { width: 1.2, x: -2 }, window: { width: 2.4, x: 2 },
    table: { name: '圆桌', width: 1.8, depth: 1.8, x: -3, z: 3 },
    chair: { name: '竹椅', width: 0.6, depth: 0.6, x: 1.5, z: 3 } },
  { name: ' Hall D5 / 东厅 ', floorName: '1F', width: 18, height: 10,
    door: { width: 1.5, x: 0 }, window: { width: 3.6, x: -3 },
    table: { name: '长桌', width: 2.4, depth: 1.2, x: -4, z: 4 },
    chair: { name: '折叠椅', width: 0.5, depth: 0.5, x: 2, z: 4 } },
  { name: '湖畔茶亭', floorName: 'B1 夹层', width: 9.5, height: 7.2,
    door: { width: 0.9, x: 1 }, window: { width: 1.8, x: -1 },
    table: { name: '茶桌', width: 1.2, depth: 1.2, x: -2, z: 2.5 },
    chair: { name: '矮凳', width: 0.55, depth: 0.55, x: 2.5, z: 2.5 } },
  { name: '展厅 A', floorName: '1F', width: 24, height: 16,
    door: { width: 1.8, x: -4 }, window: { width: 4.8, x: 4 },
    table: { name: '展台', width: 3, depth: 1.5, x: -6, z: 6 },
    chair: { name: '解说椅', width: 0.6, depth: 0.6, x: 5, z: 6 } },
  { name: '东岸露台', floorName: '1F', width: 10, height: 7,
    door: { width: 1, x: -1 }, window: { width: 2, x: 1 },
    table: { name: '露台桌', width: 1.6, depth: 1.6, x: -2.5, z: 2 },
    chair: { name: '藤椅', width: 0.5, depth: 0.5, x: 2, z: 2 } },
  { name: '宋韵雅集', floorName: '1F', width: 14, height: 9,
    door: { width: 1.2, x: 3 }, window: { width: 2.8, x: -3 },
    table: { name: '书案', width: 1.8, depth: 0.9, x: -3, z: 3 },
    chair: { name: '圈椅', width: 0.6, depth: 0.6, x: 3, z: 3 } },
  { name: '断桥市集', floorName: '1F', width: 20, height: 12,
    door: { width: 1.6, x: 0 }, window: { width: 3, x: 5 },
    table: { name: '摊位桌', width: 2.4, depth: 1.2, x: -5, z: 4 },
    chair: { name: '市集凳', width: 0.5, depth: 0.5, x: 3, z: 4 } },
  { name: '南山书房', floorName: '2F', width: 8, height: 6,
    door: { width: 1, x: 1 }, window: { width: 1.5, x: -1 },
    table: { name: '阅读桌', width: 1.2, depth: 0.8, x: -1.5, z: 2 },
    chair: { name: '木椅', width: 0.5, depth: 0.5, x: 1.5, z: 2 } },
  { name: '湖心亭', floorName: '1F', width: 11, height: 11,
    door: { width: 1.2, x: -3 }, window: { width: 2.2, x: 3 },
    table: { name: '石桌', width: 1.8, depth: 1.8, x: -3, z: 3 },
    chair: { name: '石凳', width: 0.6, depth: 0.6, x: 2, z: 3 } },
  { name: '西泠印社', floorName: '1F', width: 16, height: 13,
    door: { width: 1.4, x: 2 }, window: { width: 3.2, x: -2 },
    table: { name: '拓印台', width: 2, depth: 1, x: -4, z: 5 },
    chair: { name: '工作凳', width: 0.55, depth: 0.55, x: 3, z: 5 } },
];

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);
afterAll(() => vi.unstubAllGlobals());

const uid = (task: number, item: number) =>
  `00000000-0000-4000-8000-${String(task * 10 + item).padStart(12, '0')}`;

function layoutOf(spec: TaskSpec, task: number): RoomLayout {
  const items = [
    makeItem({ id: uid(task, 1), type: 'door', name: '主入口门', width: spec.door.width, depth: 0.12,
      height: 2.2, materialId: 'partition', position: { x: spec.door.x, z: 0 }, rotation: 0 }),
    makeItem({ id: uid(task, 2), type: 'window', name: '北窗', width: spec.window.width, depth: 0.12,
      height: 1.5, materialId: 'partition', position: { x: spec.window.x, z: spec.height }, rotation: 0 }),
    makeItem({ id: uid(task, 3), type: 'table', name: spec.table.name, width: spec.table.width,
      depth: spec.table.depth, height: 0.75, materialId: 'table',
      position: { x: spec.table.x, z: spec.table.z }, rotation: 0 }),
    makeItem({ id: uid(task, 4), type: 'chair', name: spec.chair.name, width: spec.chair.width,
      depth: spec.chair.depth, height: 0.9, materialId: 'chair',
      position: { x: spec.chair.x, z: spec.chair.z }, rotation: 0 }),
  ];
  const layout = makeLayout({
    id: `project-${task}`,
    name: spec.name,
    width: spec.width,
    height: spec.height,
    floors: [makeFloor({ id: 'f1', name: spec.floorName, items })],
  });
  // 屋顶会被后端当作未接入云端的建筑结构拒绝；交付夹具统一去掉。
  delete layout.roof;
  return layout;
}

function expectedPaths(spec: TaskSpec): string[] {
  return DELIVERY_ARTIFACTS.slice(0, 4).flatMap((artifact) =>
    Array.from({ length: artifact.count }, (_, index) =>
      deliveryArtifactPath(artifact, index + 1, artifact.kind === 'floor' ? spec.floorName : undefined)));
}

interface DxfEntity { type: string; pairs: Array<[number, string]> }
const pairValue = (entity: DxfEntity, code: number): string | null =>
  entity.pairs.find(([candidate]) => candidate === code)?.[1] ?? null;
const pairNumber = (entity: DxfEntity, code: number): number =>
  Number(pairValue(entity, code) ?? NaN);
const layerOf = (entity: DxfEntity): string => pairValue(entity, 8) ?? '';
const pointsOf = (entity: DxfEntity): Array<[number, number]> => {
  const points: Array<[number, number]> = [];
  for (let index = 0; index < entity.pairs.length - 1; index++) {
    if (entity.pairs[index]![0] === 10 && entity.pairs[index + 1]![0] === 20) {
      points.push([Number(entity.pairs[index]![1]), Number(entity.pairs[index + 1]![1])]);
    }
  }
  return points;
};

function parseDxf(text: string): DxfEntity[] {
  const lines = text.split('\n');
  const entities: DxfEntity[] = [];
  let current: DxfEntity | null = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]);
    const value = lines[index + 1] ?? '';
    if (code === 0) {
      current = { type: value.trim(), pairs: [] };
      entities.push(current);
    } else {
      current?.pairs.push([code, value]);
    }
  }
  return entities;
}

interface DxfReading {
  unitsMetres: boolean;
  width: number;
  depth: number;
  doorWidth: number;
  windowWidth: number;
  gap: number;
  dimensionLabels: number;
  hasFloorTitle: boolean;
}

function readDxf(text: string): DxfReading {
  const entities = parseDxf(text);
  const walls = entities.find((entity) => entity.type === 'LWPOLYLINE' && layerOf(entity) === 'WALLS');
  if (!walls) throw new Error('DXF 缺外墙折线');
  const points = pointsOf(walls);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const furniture = entities
    .filter((entity) => entity.type === 'LWPOLYLINE' && layerOf(entity) === 'FURNITURE')
    .map((entity) => {
      const corners = pointsOf(entity);
      const fxs = corners.map(([x]) => x);
      const fys = corners.map(([, y]) => y);
      return { minX: Math.min(...fxs), maxX: Math.max(...fxs), minY: Math.min(...fys), maxY: Math.max(...fys) };
    })
    .sort((left, right) => left.minX - right.minX);
  const door = entities.find((entity) => entity.type === 'ARC' && layerOf(entity) === 'DOORS');
  const windows = entities.filter((entity) => entity.type === 'LINE' && layerOf(entity) === 'WINDOWS');
  if (furniture.length < 2) throw new Error('DXF 家具折线不足两条');
  if (!door) throw new Error('DXF 缺门弧');
  if (!windows[0]) throw new Error('DXF 缺窗线');
  // 窗线前两条是 0.25 m 窗垛标记，长线才是窗宽；取最长一条即可避开标记。
  const windowWidth = Math.max(...windows.map((line) => Math.hypot(
    pairNumber(line, 11) - pairNumber(line, 10),
    pairNumber(line, 21) - pairNumber(line, 20),
  )));
  return {
    unitsMetres: /\$INSUNITS\n70\n6/.test(text),
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
    doorWidth: pairNumber(door, 40),
    windowWidth,
    gap: furniture[1]!.minX - furniture[0]!.maxX,
    dimensionLabels: entities.filter((entity) => entity.type === 'TEXT' && layerOf(entity) === 'DIMENSIONS').length,
    hasFloorTitle: entities.some((entity) =>
      entity.type === 'TEXT' && layerOf(entity) === 'ROOMS' && (pairValue(entity, 1) ?? '').includes(' - ')),
  };
}

function parseCsv(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') { field += '"'; index++; } else { quoted = false; }
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r') { /* skip */ }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

interface TaskReading {
  task: number;
  name: string;
  root: string;
  status: string;
  files: number;
  zipBytes: number;
  durationMs: number;
  snapshotId: string;
  shareUrlLength: number;
  shareVerified: boolean;
  csvRows: number;
  csvQuantity: number;
  itemCount: number;
  dxf: DxfReading | null;
  error: string | null;
}

const readings: TaskReading[] = [];

async function runTask(spec: TaskSpec, task: number): Promise<TaskReading> {
  const layout = layoutOf(spec, task);
  const contentFingerprint = await contentFingerprintOfLayout(layout);
  const identity: DeliveryPackageIdentity = {
    deliveryVersion: 'v1.0',
    snapshotId: snapshotIdFor(contentFingerprint),
    contentFingerprint,
    status: 'confirmed',
  };
  // 模拟「确认这一版」留下的侧车记录：分享链接里的身份才会是 confirmed。
  storage.setItem(DELIVERY_VERSION_STORAGE_KEY, JSON.stringify([{
    projectKey: layout.id,
    deliveryVersion: identity.deliveryVersion,
    snapshotId: identity.snapshotId,
    contentFingerprint,
    layoutName: layout.name,
    confirmedAt: CONFIRMED_AT,
  }]));

  const started = performance.now();
  const result: DeliveryPackageResult = await buildDeliveryPackage({
    layout,
    identity,
    generatedAt: GENERATED_AT,
    confirmedAt: CONFIRMED_AT,
    shareOrigin: ORIGIN,
    captureImage: async () => PNG_DATA_URL,
    wait: async () => undefined,
  });
  const durationMs = performance.now() - started;

  const byPath = new Map(result.files.map((file) => [file.path, file]));
  const dxfBytes = byPath.get(deliveryArtifactPath(DELIVERY_ARTIFACTS[1]!, 1, spec.floorName));
  const csvBytes = byPath.get('03-物料清单/物料清单.csv');
  if (!dxfBytes || !csvBytes) throw new Error('包内缺 DXF 或物料清单');
  const dxf = readDxf(new TextDecoder().decode(dxfBytes.bytes));
  const csv = parseCsv(new TextDecoder().decode(csvBytes.bytes));
  const csvRows = csv.slice(1);
  const csvQuantity = csvRows.reduce((sum, row) => sum + Number(row[8] ?? 0), 0);
  const share = result.shareUrl ? await readShareHash(new URL(result.shareUrl).hash) : null;
  let shareVerified = false;
  if (share && share.ok && share.identity) {
    shareVerified = share.identity.verified
      && share.identity.snapshotId === identity.snapshotId
      && share.identity.deliveryVersion === identity.deliveryVersion
      && share.identity.status === 'confirmed';
  }

  const reading: TaskReading = {
    task,
    name: spec.name,
    root: result.root,
    status: result.manifest.status,
    files: result.files.length,
    zipBytes: result.zip.length,
    durationMs: Math.round(durationMs),
    snapshotId: result.manifest.snapshotId,
    shareUrlLength: result.shareUrl?.length ?? 0,
    shareVerified,
    csvRows: csvRows.length,
    csvQuantity,
    itemCount: layout.floors[0]!.items.length,
    dxf,
    error: null,
  };

  // 每任务都按 docs/24 的通过线查一遍；soft 让十个任务的结果都能落进证据。
  expect.soft(result.manifest.status, `任务 ${task} 状态`).toBe('complete');
  expect.soft(result.missing, `任务 ${task} 缺件`).toEqual([]);
  expect.soft(result.files.length, `任务 ${task} 文件数`).toBe(8);
  expect.soft(result.root, `任务 ${task} 包根`).toBe(deliveryPackageRoot(spec.name, 'v1.0'));
  const actualPaths = result.files.map((file) => file.path);
  expect.soft(actualPaths, `任务 ${task} 路径（0 人工改名）`)
    .toEqual([...expectedPaths(spec), 'manifest.json', 'README.txt']);
  for (const path of actualPaths) {
    expect.soft(path, `任务 ${task} 路径不得含非法字符`).not.toMatch(/[\\:*?"<>|\s]/);
  }
  expect.soft(result.manifest.snapshotId, `任务 ${task} 快照号`).toBe(identity.snapshotId);
  expect.soft(result.manifest.deliveryVersion, `任务 ${task} 版本号`).toBe('v1.0');
  expect.soft(result.manifest.share?.url.includes('/review/#layout=2.'), `任务 ${task} 分享链接`).toBe(true);
  expect.soft(shareVerified, `任务 ${task} 分享身份与包一致`).toBe(true);
  expect.soft(dxf.unitsMetres, `任务 ${task} DXF 单位`).toBe(true);
  // 五处已知尺寸：外墙长、外墙深、门宽、窗宽、两件家具之间的通道。
  expect.soft(dxf.width, `任务 ${task} 墙长`).toBeCloseTo(spec.width, 2);
  expect.soft(dxf.depth, `任务 ${task} 墙深`).toBeCloseTo(spec.height, 2);
  expect.soft(dxf.doorWidth, `任务 ${task} 门宽`).toBeCloseTo(spec.door.width, 2);
  expect.soft(dxf.windowWidth, `任务 ${task} 窗宽`).toBeCloseTo(spec.window.width, 2);
  const expectedGap = (spec.chair.x - spec.chair.width / 2) - (spec.table.x + spec.table.width / 2);
  expect.soft(dxf.gap, `任务 ${task} 通道`).toBeCloseTo(expectedGap, 2);
  expect.soft(dxf.dimensionLabels, `任务 ${task} 尺寸标注`).toBe(2);
  expect.soft(dxf.hasFloorTitle, `任务 ${task} 图名`).toBe(true);
  expect.soft(csvRows.length, `任务 ${task} 物料行数`).toBe(layout.floors[0]!.items.length);
  expect.soft(csvQuantity, `任务 ${task} 物料合计`).toBe(layout.floors[0]!.items.length);
  for (const row of csvRows) {
    expect.soft(Number(row[8]), `任务 ${task} 每行数量`).toBeGreaterThan(0);
    expect.soft(row[14], `任务 ${task} 交付编号`).toBe(identity.snapshotId);
    expect.soft(row[15], `任务 ${task} 生成时间`).toBe(CONFIRMED_AT);
  }
  return reading;
}

describe('SC-16 four-piece acceptance (10 deliverable fixtures)', () => {
  it('builds ten complete packages with the four pieces bound to one version', async () => {
    for (const [index, spec] of TASKS.entries()) {
      try {
        readings.push(await runTask(spec, index + 1));
      } catch (error) {
        readings.push({
          task: index + 1, name: spec.name, root: '', status: 'error', files: 0, zipBytes: 0,
          durationMs: 0, snapshotId: '', shareUrlLength: 0, shareVerified: false, csvRows: 0,
          csvQuantity: 0, itemCount: 0, dxf: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    expect(readings).toHaveLength(10);
    expect(readings.filter((reading) => reading.error)).toEqual([]);
    expect(readings.map((reading) => reading.status)).toEqual(Array(10).fill('complete'));
    expect(new Set(readings.map((reading) => reading.root)).size).toBe(10);
  });

  it('stays inside the ten-minute budget for ten tasks', () => {
    const totalMs = readings.reduce((sum, reading) => sum + reading.durationMs, 0);
    // 夹具的 capture 是注入的，不含真实渲染；这条只证明打包链路本身不拖时间。
    expect(totalMs).toBeLessThan(TEN_MINUTES_MS);
    expect(readings.every((reading) => reading.durationMs < TEN_MINUTES_MS)).toBe(true);
  });

  afterAll(() => {
    const out = process.env.DELIVERY_ACCEPTANCE_OUT;
    if (!out || readings.length === 0) return;
    const path = resolve(out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      origin: ORIGIN,
      confirmedAt: CONFIRMED_AT,
      tasks: readings,
      totals: {
        tasks: readings.length,
        complete: readings.filter((reading) => reading.status === 'complete').length,
        durationMs: readings.reduce((sum, reading) => sum + reading.durationMs, 0),
        zipBytes: readings.reduce((sum, reading) => sum + reading.zipBytes, 0),
      },
    }, null, 2)}\n`, 'utf8');
  });
});
