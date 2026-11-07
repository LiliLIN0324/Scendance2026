import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { contentFingerprintOfLayout, snapshotIdFor } from './delivery-version';
import { zipStore, type ZipEntry } from './delivery-zip';
import {
  buildDeliveryPackage,
  classifyDeliveryFailure,
  DeliveryArtifactError,
  type DeliveryCapture,
  type DeliveryPackageIdentity,
  type DeliveryPackageResult,
} from './delivery-package';
import { deliveryArtifactPath, DELIVERY_ARTIFACTS } from './delivery-package-spec';
import type { RoomLayout } from './types';

/** 1×1 透明 PNG；capture 的真实输出也是 PNG data URL。 */
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ORIGIN = 'https://scendance.example';
const HERO_PATHS = ['01-效果图/效果图-01.png', '01-效果图/效果图-02.png', '01-效果图/效果图-03.png'];

interface ReadEntry { path: string; data: Uint8Array }

function readZip(bytes: Uint8Array): ReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0; index--) {
    if (view.getUint32(index, true) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ReadEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('central header mismatch');
    const flags = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!(flags & 0x0800)) throw new Error('UTF-8 flag missing');
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('local header mismatch');
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const size = view.getUint32(local + 18, true);
    const start = local + 30 + localName + localExtra;
    entries.push({ path, data: bytes.slice(start, start + size) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function identityOf(layout: RoomLayout, deliveryVersion = 'v1.0'): Promise<DeliveryPackageIdentity> {
  const contentFingerprint = await contentFingerprintOfLayout(layout);
  return { deliveryVersion, snapshotId: snapshotIdFor(contentFingerprint), contentFingerprint, status: 'confirmed' };
}

/** 后端场景校验要求物件 id 是 UUID。 */
const uid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function furnishedLayout(overrides: Partial<RoomLayout> = {}): RoomLayout {
  const floor = makeFloor({
    id: 'f1', name: '1F',
    items: [
      makeItem({ id: uid(1), name: '圆桌', width: 1.8, depth: 1.8, position: { x: 0, z: 0 } }),
      makeItem({ id: uid(2), name: '竹椅', position: { x: 2, z: 0 } }),
    ],
  });
  const layout = makeLayout({ id: 'project-1', name: '西湖会客厅', floors: [floor], ...overrides });
  // 有屋顶的方案会被后端当作「未接入云端的建筑结构」拒绝，交付夹具统一去掉。
  delete layout.roof;
  return layout;
}

async function build(layout: RoomLayout, extra: Partial<Parameters<typeof buildDeliveryPackage>[0]> = {}): Promise<DeliveryPackageResult> {
  const identity = await identityOf(layout, extra.identity?.deliveryVersion);
  return buildDeliveryPackage({
    layout,
    identity,
    generatedAt: '2026-11-08T10:00:00.000Z',
    confirmedAt: '2026-11-08T09:00:00.000Z',
    shareOrigin: ORIGIN,
    captureImage: async () => PNG_DATA_URL,
    wait: async () => undefined,
    ...extra,
  });
}

function zipPaths(result: DeliveryPackageResult): string[] {
  return readZip(result.zip).map((entry) => entry.path.slice(result.root.length + 1));
}

function missingKey(result: DeliveryPackageResult): string[] {
  return result.missing.map((entry) => `${entry.kind}:${entry.code}`);
}

describe('delivery zip writer', () => {
  it('roundtrips UTF-8 paths and bytes, with the UTF-8 flag set', () => {
    const entries: ZipEntry[] = [
      { path: '幕景_西湖_v1.0/01-效果图/效果图-01.png', data: new Uint8Array([1, 2, 3]) },
      { path: '幕景_西湖_v1.0/README.txt', data: new TextEncoder().encode('hi') },
    ];
    const read = readZip(zipStore(entries));
    expect(read.map((entry) => entry.path)).toEqual(entries.map((entry) => entry.path));
    expect(Array.from(read[0]!.data)).toEqual([1, 2, 3]);
    expect(new TextDecoder().decode(read[1]!.data)).toBe('hi');
  });

  it('produces identical bytes for identical input (fixed 1980 timestamp)', () => {
    const entries: ZipEntry[] = [{ path: 'a.txt', data: new TextEncoder().encode('x') }];
    expect(Array.from(zipStore(entries))).toEqual(Array.from(zipStore(entries)));
  });

  it('refuses duplicate and unsafe paths', () => {
    const data = new Uint8Array([0]);
    expect(() => zipStore([{ path: 'a', data }, { path: 'a', data }])).toThrow('重复');
    expect(() => zipStore([{ path: '/abs', data }])).toThrow('不合法');
    expect(() => zipStore([{ path: '../escape', data }])).toThrow('不合法');
  });
});

describe('delivery package acceptance fixtures (10/10)', () => {
  it('F01 complete single floor: eight entries, status complete, no manual renaming', async () => {
    const result = await build(furnishedLayout());
    expect(result.root).toBe('幕景_西湖会客厅_v1.0');
    expect(result.fileName).toBe('幕景_西湖会客厅_v1.0.zip');
    expect(zipPaths(result)).toEqual([
      ...HERO_PATHS,
      '02-平面图/平面-1F.dxf',
      '03-物料清单/物料清单.csv',
      '04-分享/分享链接.txt',
      'manifest.json',
      'README.txt',
    ]);
    expect(result.manifest.status).toBe('complete');
    expect(result.missing).toEqual([]);
    expect(result.shareUrl).toContain('/review/#layout=2.');
    // 0 次人工改名：每个路径都能由规格函数复现。
    const expected = DELIVERY_ARTIFACTS.flatMap((spec) =>
      Array.from({ length: spec.count }, (_, index) => deliveryArtifactPath(spec, index + 1, spec.kind === 'floor' ? '1F' : undefined)));
    expect([...zipPaths(result)].sort()).toEqual([...expected].sort());
  });

  it('F02 sanitizes project and floor names without dropping them', async () => {
    const layout = furnishedLayout({
      name: ' Hall D5 / 东厅 ',
      floors: [makeFloor({ id: 'f1', name: 'B1 夹层', items: [makeItem({ id: uid(3), name: '桌' })] })],
    });
    const result = await build(layout);
    expect(result.root).toBe('幕景_Hall_D5_东厅_v1.0');
    expect(zipPaths(result)).toContain('02-平面图/平面-B1_夹层.dxf');
    expect(result.manifest.status).toBe('complete');
  });

  it('F03 no floor: plan and materials both report no-floor, the rest still ships', async () => {
    const result = await build(furnishedLayout({ floors: [] }));
    expect(result.manifest.status).toBe('incomplete');
    expect(missingKey(result)).toEqual(['floor:no-floor', 'materials:no-floor']);
    expect(zipPaths(result)).not.toContain('02-平面图/平面-1F.dxf');
    expect(result.manifest.files).toHaveLength(5);
  });

  it('F04 complete-scene preset: scene-derived artifacts fail, heroes and link still ship', async () => {
    const result = await build(furnishedLayout({ scenePreset: 'gym' }));
    expect(missingKey(result).sort()).toEqual(['floor:preset-unsupported', 'materials:preset-unsupported']);
    expect(result.manifest.status).toBe('incomplete');
    expect(zipPaths(result)).toEqual(expect.arrayContaining([...HERO_PATHS, '04-分享/分享链接.txt']));
    expect(result.manifest.share?.url).toContain('/review/#layout=2.');
    expect(result.retries).toEqual([]);
  });

  it('F05 entrance extension: plan and materials fail with entrance-unsupported', async () => {
    const result = await build(furnishedLayout({ entrance: { width: 1.2, depth: 0.9 } }));
    expect(missingKey(result).sort()).toEqual(['floor:entrance-unsupported', 'materials:entrance-unsupported']);
  });

  it('F06 one view captures nothing: only that hero is missing', async () => {
    const capture: DeliveryCapture = async (view) => (view === 'top' ? null : PNG_DATA_URL);
    const result = await build(furnishedLayout(), { captureImage: capture });
    expect(missingKey(result)).toEqual(['hero:render-failed']);
    expect(result.missing[0]!.detail).toContain('俯视');
    expect(zipPaths(result)).toContain('01-效果图/效果图-01.png');
    expect(zipPaths(result)).not.toContain('01-效果图/效果图-02.png');
  });

  it('F07 transient capture failure is retried once and then succeeds', async () => {
    let calls = 0;
    const waits: number[] = [];
    const capture: DeliveryCapture = async () => {
      calls++;
      if (calls === 1) throw new Error('timeout while painting');
      return PNG_DATA_URL;
    };
    const result = await build(furnishedLayout(), {
      captureImage: capture,
      wait: async (ms) => { waits.push(ms); },
    });
    expect(result.manifest.status).toBe('complete');
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0]).toMatchObject({ path: '01-效果图/效果图-01.png', attempt: 1, code: 'timeout', waitedMs: 1000 });
    expect(result.attempts['01-效果图/效果图-01.png']).toBe(2);
    expect(waits).toEqual([1000]);
  });

  it('F08 share link over budget: share fails, package stays incomplete and share is null', async () => {
    // 50 件高熵备注把离线链接推过 12,000 字符预算；场景本身仍可交付。
    const random = new Uint8Array(375);
    const items = Array.from({ length: 50 }, (_, index) => {
      crypto.getRandomValues(random);
      return makeItem({
        id: uid(100 + index), name: `桌 ${index}`,
        notes: btoa(String.fromCharCode(...random)),
        position: { x: (index % 10) - 5, z: Math.floor(index / 10) - 2 },
      });
    });
    const layout = furnishedLayout({ name: '大厅', floors: [makeFloor({ id: 'f1', name: '1F', items })] });
    const result = await build(layout);
    expect(missingKey(result)).toEqual(['share:share-over-budget']);
    expect(result.manifest.share).toBeNull();
    expect(result.retries).toEqual([]);
  });

  it('F09 multi-floor: scene-derived artifacts fail with preset-unsupported', async () => {
    const result = await build(furnishedLayout({
      floors: [makeFloor({ id: 'f1', name: '1F' }), makeFloor({ id: 'f2', name: '2F' })],
    }));
    expect(missingKey(result).sort()).toEqual(['floor:preset-unsupported', 'materials:preset-unsupported']);
    expect(result.manifest.status).toBe('incomplete');
  });

  it('F10 a broken identity is refused before any rendering', async () => {
    let rendered = 0;
    await expect(buildDeliveryPackage({
      layout: furnishedLayout(),
      identity: { deliveryVersion: 'v1.0', snapshotId: '0123456789abcdef', contentFingerprint: 'f'.repeat(64), status: 'confirmed' },
      generatedAt: '2026-11-08T10:00:00.000Z',
      shareOrigin: ORIGIN,
      captureImage: async () => { rendered++; return PNG_DATA_URL; },
      wait: async () => undefined,
    })).rejects.toThrow('当前方案与确认版不一致');
    expect(rendered).toBe(0);
  });
});

describe('delivery package identity and reproducibility', () => {
  it('binds manifest, file names and the share link to the same snapshot', async () => {
    const layout = furnishedLayout();
    const result = await build(layout);
    const manifest = result.manifest;
    const entries = readZip(result.zip);
    const share = new TextDecoder().decode(entries.find((entry) => entry.path.endsWith('分享链接.txt'))!.data);
    const materialsBytes = entries.find((entry) => entry.path.endsWith('物料清单.csv'))!.data;
    const materials = new TextDecoder().decode(materialsBytes);
    expect(manifest.snapshotId).toBe((await identityOf(layout)).snapshotId);
    expect(manifest.deliveryVersion).toBe('v1.0');
    expect(manifest.share?.url).toContain(manifest.snapshotId ? '/review/#layout=2.' : '');
    expect(share).toContain(manifest.snapshotId);
    expect(share).toContain(manifest.share!.url);
    // 物料 CSV 保留 BOM，交付编号列写快照号。
    expect([materialsBytes[0], materialsBytes[1], materialsBytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(materials).toContain(manifest.snapshotId!);
    // manifest.files 不包含 manifest 自己，但包含 README 且 sha256 对得上。
    expect(manifest.files.map((file) => file.path)).not.toContain('manifest.json');
    const readme = entries.find((entry) => entry.path.endsWith('README.txt'))!;
    const readmeEntry = manifest.files.find((file) => file.kind === 'readme')!;
    expect(readmeEntry.bytes).toBe(readme.data.length);
    expect(readmeEntry.sha256).toHaveLength(64);
    expect(new TextDecoder().decode(readme.data)).toContain('04-分享/');
  });

  it('repacking the same version changes only generatedAt', async () => {
    const layout = furnishedLayout();
    const first = await build(layout);
    const second = await build(layout, { generatedAt: '2026-11-09T18:30:00.000Z' });
    const firstEntries = new Map(readZip(first.zip).map((entry) => [entry.path, entry.data]));
    const secondEntries = new Map(readZip(second.zip).map((entry) => [entry.path, entry.data]));
    expect([...firstEntries.keys()]).toEqual([...secondEntries.keys()]);
    for (const [path, data] of firstEntries) {
      const other = secondEntries.get(path)!;
      if (path.endsWith('manifest.json')) {
        expect(Array.from(data)).not.toEqual(Array.from(other));
      } else {
        expect(Array.from(data)).toEqual(Array.from(other));
      }
    }
    const normalize = (manifest: typeof first.manifest) => ({ ...manifest, generatedAt: 'fixed' });
    expect(normalize(first.manifest)).toEqual(normalize(second.manifest));
  });

  it('builds byte-identical zips when generatedAt matches', async () => {
    const layout = furnishedLayout();
    const first = await build(layout);
    const second = await build(layout);
    expect(Array.from(first.zip)).toEqual(Array.from(second.zip));
  });

  it('reuses successful artifacts instead of re-rendering them', async () => {
    const layout = furnishedLayout();
    const first = await build(layout);
    const reuse = new Map(first.files.map((file) => [file.path, { sha256: file.sha256, bytes: file.bytes }]));
    let renders = 0;
    const second = await buildDeliveryPackage({
      layout,
      identity: await identityOf(layout),
      generatedAt: '2026-11-09T18:30:00.000Z',
      confirmedAt: '2026-11-08T09:00:00.000Z',
      shareOrigin: ORIGIN,
      captureImage: async () => { renders++; return PNG_DATA_URL; },
      reuse,
      wait: async () => undefined,
    });
    expect(renders).toBe(0);
    expect(second.attempts['01-效果图/效果图-01.png']).toBe(0);
    expect(second.manifest.status).toBe('complete');
    expect(second.manifest.files.filter((file) => file.kind === 'hero').map((file) => file.sha256))
      .toEqual(first.manifest.files.filter((file) => file.kind === 'hero').map((file) => file.sha256));
  });
});

describe('delivery failure classification', () => {
  it('maps known messages to the frozen codes', () => {
    expect(classifyDeliveryFailure(new DeliveryArtifactError('no-floor', 'x')).code).toBe('no-floor');
    expect(classifyDeliveryFailure(new Error('完整场景预设暂不支持交付导出')).code).toBe('preset-unsupported');
    expect(classifyDeliveryFailure(new Error('当前交付不支持本地建筑入口扩展')).code).toBe('entrance-unsupported');
    expect(classifyDeliveryFailure(new Error('当前云端版暂不支持保存多层方案。')).code).toBe('preset-unsupported');
    expect(classifyDeliveryFailure(new Error('timeout while rendering')).code).toBe('timeout');
    expect(classifyDeliveryFailure(new Error('Failed to fetch')).code).toBe('network');
    expect(classifyDeliveryFailure(new Error('“桌子”模型尚未就绪，未导出占位物件。')).code).toBe('asset-fetch');
    expect(classifyDeliveryFailure(new Error('something odd')).code).toBe('render-failed');
  });
});
