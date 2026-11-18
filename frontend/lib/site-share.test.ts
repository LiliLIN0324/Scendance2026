import { describe, expect, it } from 'vitest';
import {
  encodeSiteSnapshot,
  readSiteSnapshotHash,
  siteArea,
  siteSnapshotErrorMessage,
  SITE_SNAPSHOT_HASH_PREFIX,
} from './site-share';
import type { SitePlanData } from '../../supabase/functions/_shared/site-plan';

const plan = {
  version: 1,
  title: '测试场地',
  anchor: { lng: 121.391448, lat: 28.62154, crs: 'gcj-02', source: 'preset' },
  boundary: [
    { x: -120, y: -90 },
    { x: 120, y: -90 },
    { x: 120, y: 90 },
    { x: -120, y: 90 },
  ],
  zones: [
    { id: 'stage', name: '主舞台', semantic: 'stage', color: '#2f6f4e', polygon: [{ x: -40, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }, { x: -40, y: 60 }] },
    { id: 'gate', name: '安检', semantic: 'checkin', polygon: [{ x: 60, y: -80 }, { x: 90, y: -80 }, { x: 90, y: -60 }, { x: 60, y: -60 }] },
  ],
} as unknown as SitePlanData;

async function linkHost(): Promise<string> {
  return 'http://localhost:3000/site';
}

/** 用同一套压缩口径手搓一条链接，模拟别人改过的快照。 */
async function forgeHash(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const stream = new Blob([bytes.buffer.slice(0) as ArrayBuffer]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of packed) binary += String.fromCharCode(byte);
  return `${SITE_SNAPSHOT_HASH_PREFIX}1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

describe('site share snapshot', () => {
  it('round-trips boundary, zones, anchor and zoom through the link', async () => {
    const { url, snapshot } = await encodeSiteSnapshot(plan, '台州国际博览中心', await linkHost(), { source: '案例' });
    expect(url.startsWith('http://localhost:3000/site#s2=1.')).toBe(true);
    expect(snapshot.zones).toHaveLength(2);

    const hash = url.slice(url.indexOf('#'));
    const result = await readSiteSnapshotHash(hash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.title).toBe('台州国际博览中心');
    expect(result.snapshot.anchor).toEqual({ lng: 121.391448, lat: 28.62154 });
    expect(result.snapshot.boundary).toEqual(plan.boundary);
    expect(result.snapshot.zones.map(zone => zone.name)).toEqual(['主舞台', '安检']);
    expect(result.snapshot.zones[0].color).toBe('#2f6f4e');
    expect(result.snapshot.zoom).toBeGreaterThan(12);
    expect(result.snapshot.zoom).toBeLessThanOrEqual(20);
    expect(result.snapshot.source).toBe('案例');
  });

  it('keeps a link short enough to paste in chat', async () => {
    const { url } = await encodeSiteSnapshot(plan, '台州国际博览中心', await linkHost());
    expect(url.length).toBeLessThan(1200);
  });

  it('refuses a plan without an anchor instead of guessing coordinates', async () => {
    const broken = { ...plan, anchor: undefined } as unknown as SitePlanData;
    await expect(encodeSiteSnapshot(broken, '缺锚点', await linkHost())).rejects.toThrow(/锚点/);
  });

  it('rejects forged links whose points leave the 5 km planning area', async () => {
    const hash = await forgeHash({
      version: 1,
      title: '越界',
      createdAt: '',
      anchor: { lng: 121.391448, lat: 28.62154 },
      zoom: 16,
      boundary: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 0, y: 10 }],
      zones: [],
    });
    const result = await readSiteSnapshotHash(hash);
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('reports unreadable for a truncated link', async () => {
    const { url } = await encodeSiteSnapshot(plan, '截断', await linkHost());
    const hash = url.slice(url.indexOf('#'), url.length - 24);
    const result = await readSiteSnapshotHash(hash);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(siteSnapshotErrorMessage(result.reason)).toMatch(/损坏|不完整/);
  });

  it('computes the boundary area in square metres', () => {
    expect(siteArea(plan.boundary)).toBe(240 * 180);
  });
});
