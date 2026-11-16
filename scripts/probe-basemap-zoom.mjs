#!/usr/bin/env node
/**
 * 逐级探测各底图「真正有瓦片的最高级」，并与 lib/basemap-zoom-caps.ts 那张表比对。
 *
 * 背景：2D 画布 / 3D 贴地拼图 / 3D 瓦片金字塔共用一张上限表。换 key、续期、图源改版之后，
 * 上限会变，表现就是「放大到一定级别整屏灰」。这时候跑一条命令就知道该调到哪级：
 *
 *   node scripts/probe-basemap-zoom.mjs                      # 打生产，两点（杭州西湖 / 北京天安门）
 *   node scripts/probe-basemap-zoom.mjs --base http://127.0.0.1:3199   # 打本机 dev 代理
 *   node scripts/probe-basemap-zoom.mjs --apply              # 把实测上限写回常量表
 *   node scripts/probe-basemap-zoom.mjs --json out.json      # 另存原始结果
 *
 * Carto / 天地图走站点同源代理（key 在服务端），OSM / 高德直连官方瓦片。
 * 判定真图：HTTP 200 + 位图 + ≥2 KB + 不同探测点字节不同（两个城市点返回同一张图 = 静态占位）。
 * 网络不可达 / 整源都是占位的（如境外节点拉不到天地图）标成「跳过」，不算与表不一致。
 * 退出码：全部一致 → 0；有真实差异 → 1（可直接挂发布前自检）。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CAPS_FILE = path.join(REPO, 'frontend/components/room-organizer/lib/basemap-zoom-caps.ts');

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const has = name => args.includes(name);

const BASE = (flag('--base', 'https://scendance.lilicoding.space') || '').replace(/\/+$/, '');
const MIN_ZOOM = Number(flag('--min', '14'));
const MAX_ZOOM = Number(flag('--max', '21'));
const OUT = flag('--json', path.join('deliverables', 'basemap-zoom-probe.json'));
const APPLY = has('--apply');

/** 探测点：默认两个城市稠密区（避开大片水面，免得「真图但一块纯色」被误判成空瓦片）。 */
const DEFAULT_POINTS = [
  { name: '杭州西湖', lng: 120.148, lat: 30.246 },
  { name: '北京天安门', lng: 116.397, lat: 39.909 },
];

const explicitPoints = args
  .map((value, index) => (value === '--point' ? args[index + 1] : null))
  .filter(Boolean)
  .map(raw => {
    const [name, coord] = raw.split('=');
    const [lng, lat] = (coord ?? name).split(',').map(Number);
    return { name: coord ? name : `${lng},${lat}`, lng, lat };
  });
const POINTS = explicitPoints.length ? explicitPoints : DEFAULT_POINTS;

const SOURCES = [
  { id: 'osm', label: 'OSM 街道', kind: 'direct', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
  { id: 'carto-light', label: 'Carto 浅色', kind: 'carto', style: 'light' },
  { id: 'carto-dark', label: 'Carto 深色', kind: 'carto', style: 'dark' },
  { id: 'amap-satellite', label: '高德卫星', kind: 'direct', url: (z, x, y) => `https://webst01.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}` },
  { id: 'amap-streets', label: '高德街道', kind: 'direct', url: (z, x, y) => `https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=${x}&y=${y}&z=${z}` },
  { id: 'amap-streets-labels', label: '高德街道注记', kind: 'direct', url: (z, x, y) => `https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}` },
  { id: 'vec', label: '天地图矢量', kind: 'tdt', layer: 'vec_w' },
  { id: 'img', label: '天地图影像', kind: 'tdt', layer: 'img_w' },
];

function tileUrl(source, z, x, y) {
  if (source.kind === 'carto') return `${BASE}/api/carto-tiles?style=${source.style}&z=${z}&x=${x}&y=${y}`;
  if (source.kind === 'tdt') return `${BASE}/api/tdt-tiles?layer=${source.layer}&z=${z}&x=${x}&y=${y}`;
  return source.url(z, x, y);
}

/** 经纬度 → 瓦片坐标（Web 墨卡托）。 */
function tileCoords(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

/** 小于这个体积的位图一律当空瓦片（高德矢量 z19 是 100 多字节，纯水面也是几百字节）。 */
const EMPTY_MAX_BYTES = 2048;

/**
 * 单块瓦片判定：
 *   real        位图，体积正常（>2 KB），且同级的两个探测点字节不同
 *   empty       空瓦片 / 纯色（< 2 KB）
 *   placeholder 占位：SVG、X-Carto-Fallback / X-Tdt-Fallback，或两个城市点返回同一张图
 *   http        非 200
 *   error       超时 / 网络错
 */
async function probeTile(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'ScendanceBasemapProbe/1.0' },
    });
    if (!response.ok) return { verdict: 'http', detail: `HTTP ${response.status}`, hash: null };
    const fallback = response.headers.get('x-carto-fallback') ?? response.headers.get('x-tdt-fallback');
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (fallback) return { verdict: 'placeholder', detail: `fallback=${fallback} ${type} ${bytes.length}B`, hash };
    if (type.includes('svg')) return { verdict: 'placeholder', detail: `svg ${bytes.length}B`, hash };
    if (!type.startsWith('image/')) return { verdict: 'placeholder', detail: `type=${type || 'none'} ${bytes.length}B`, hash };
    if (bytes.length < EMPTY_MAX_BYTES) return { verdict: 'empty', detail: `bitmap ${bytes.length}B`, hash };
    return { verdict: 'real', detail: `bitmap ${bytes.length}B`, hash };
  } catch (error) {
    const detail = error?.name === 'TimeoutError' ? 'timeout' : String(error?.message ?? error);
    return { verdict: 'error', detail, hash: null };
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 直接读常量表源码里的对象（不 import TS 模块：frontend 的 package.json 不是 type:module，会刷一条重解析警告）。 */
async function readCaps() {
  const text = await readFile(CAPS_FILE, 'utf8');
  const start = text.indexOf('BASEMAP_NATIVE_MAX_ZOOM');
  const end = text.indexOf('} as const', start);
  const block = start >= 0 && end > start ? text.slice(start, end) : text;
  const caps = {};
  for (const match of block.matchAll(/([a-z][a-z-]*)['"]?\s*:\s*(\d+)/g)) caps[match[1]] = Number(match[2]);
  return caps;
}

async function main() {
  const caps = await readCaps();
  const results = [];

  for (const source of SOURCES) {
    const levels = [];
    let realMax = null;
    let firstBad = null;
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
      const tiles = [];
      for (const point of POINTS) {
        const { x, y } = tileCoords(point.lng, point.lat, z);
        tiles.push({ point: point.name, x, y, ...(await probeTile(tileUrl(source, z, x, y))) });
        await sleep(80);
      }
      // 静态图识别：两个城市点在同一级返回完全相同的字节，只可能是占位/水印图。
      const hashes = new Set(tiles.map(tile => tile.hash).filter(Boolean));
      if (tiles.length > 1 && hashes.size === 1) {
        for (const tile of tiles) {
          if (tile.verdict === 'real') {
            tile.verdict = 'placeholder';
            tile.detail = `${tile.detail} · 两点同图`;
          }
        }
      }
      const order = ['real', 'empty', 'placeholder', 'http', 'error'];
      const best = order.find(verdict => tiles.some(tile => tile.verdict === verdict));
      levels.push({ z, verdict: best, tiles });
      if (best === 'real') realMax = z;
      if (best !== 'real' && firstBad === null) {
        const sample = tiles.find(tile => tile.verdict === best) ?? tiles[0];
        firstBad = { z, verdict: best, detail: sample?.detail ?? '' };
      }
    }
    const unreachable = realMax === null;
    const reason = unreachable
      ? (levels.every(level => level.verdict === 'error') ? '网络不可达' : '整源都是占位/空瓦片')
      : null;
    results.push({ source: source.id, label: source.label, realMax, firstBad, table: caps[source.id], unreachable, reason, levels });
  }

  const rows = results.map(item => ({
    source: item.source,
    table: item.table,
    realMax: item.realMax,
    status: item.unreachable ? 'skip' : item.realMax === item.table ? 'ok' : 'diff',
    firstBad: item.firstBad ? `z${item.firstBad.z} ${item.firstBad.verdict} (${item.firstBad.detail})` : '—',
    reason: item.reason,
  }));

  const pad = (value, width) => String(value ?? '无').padEnd(width);
  console.log(`\n底图上限探测：${BASE}   z${MIN_ZOOM}–z${MAX_ZOOM}   ${POINTS.map(p => p.name).join(' / ')}\n`);
  console.log(`${pad('图源', 20)}${pad('实测', 8)}${pad('表内', 8)}${pad('结论', 10)}首级不可用`);
  for (const row of rows) {
    const verdict = row.status === 'ok' ? 'OK' : row.status === 'diff' ? '需调整' : `跳过（${row.reason}）`;
    console.log(`${pad(row.source, 20)}${pad(row.realMax, 8)}${pad(row.table, 8)}${pad(verdict, 10)}${row.firstBad}`);
  }

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ base: BASE, points: POINTS, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, generatedAt: new Date().toISOString(), rows, results }, null, 2));
  console.log(`\n原始结果：${OUT}`);

  const mismatches = rows.filter(row => row.status === 'diff');
  if (APPLY && mismatches.length) {
    let source = await readFile(CAPS_FILE, 'utf8');
    for (const row of mismatches) {
      if (row.realMax === null) continue;
      const pattern = new RegExp(`(['"]?${row.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*:\\s*)(\\d+)`);
      source = source.replace(pattern, `$1${row.realMax}`);
    }
    await writeFile(CAPS_FILE, source);
    console.log(`已写回常量表：${path.relative(REPO, CAPS_FILE)}（${mismatches.map(r => `${r.source}=${r.realMax}`).join(', ')}）`);
    return;
  }

  if (mismatches.length) {
    console.log(`\n${mismatches.length} 个图源与表不一致。加 --apply 写回，或手动改 ${path.relative(REPO, CAPS_FILE)}：`);
    for (const row of mismatches) console.log(`  ${row.source}: 表内 ${row.table} → 实测 ${row.realMax ?? '无真图'}`);
    process.exitCode = 1;
  } else {
    console.log('\n全部可探测图源与上限表一致。');
  }

  const skipped = rows.filter(row => row.status === 'skip');
  for (const row of skipped) {
    console.log(`跳过 ${row.source}：${row.reason}${row.source === 'vec' || row.source === 'img' ? '（天地图代理在境外节点常被 CloudWAF 拦，建议用 --base 打本机代理或浏览器直连核对）' : ''}`);
  }
}

await main();
