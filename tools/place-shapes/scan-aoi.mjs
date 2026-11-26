#!/usr/bin/env node
/**
 * Geofabrik「-free.shp」离线包探针（无依赖）。
 *
 * 目的：不接网络、不加 npm 依赖，先回答三个问题——
 *   ① 这一层有多少带名字的面；② 面积量级对不对；③ 我们要的场地在不在里面。
 *
 * 输入：Geofabrik 解压目录（WGS-84 / EPSG:4326，DBF 多为 UTF-8）。
 * 输出：stdout 报告 + 可选 `--json <file>` 落一份候选清单（WGS-84 原始坐标，不做转换）。
 *
 * 用法：
 *   node tools/place-shapes/scan-aoi.mjs --dir AOI/zhejiang-260116-free.shp --layer landuse
 *   node tools/place-shapes/scan-aoi.mjs --dir ... --layer buildings --name 青山湖
 *   node tools/place-shapes/scan-aoi.mjs --dir ... --all --json .temp/aoi-scan.json
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/* ---------------- DBF ---------------- */

/** 既可传路径，也可直接传已解压的 Buffer（zip 直读用）。 */
const toBuffer = (src) => (Buffer.isBuffer(src) ? src : readFileSync(src));

export function readDbf(file) {
  const buf = toBuffer(file);
  const numRecords = buf.readUInt32LE(4);
  const headerSize = buf.readUInt16LE(8);
  const recordSize = buf.readUInt16LE(10);
  const fields = [];
  for (let off = 32; off + 32 <= headerSize; off += 32) {
    if (buf[off] === 0x0d) break;
    const name = buf.toString('latin1', off, off + 11).replace(/\0.*$/, '').trim();
    if (!name) break;
    fields.push({ name, type: String.fromCharCode(buf[off + 11]), length: buf[off + 16], decimals: buf[off + 17] });
  }
  const records = [];
  for (let i = 0; i < numRecords; i++) {
    let off = headerSize + i * recordSize;
    if (off + recordSize > buf.length) break;
    if (buf[off] === 0x2a) continue; // deleted
    off += 1;
    const row = {};
    for (const f of fields) {
      const raw = buf.toString('utf8', off, off + f.length);
      off += f.length;
      row[f.name] = f.type === 'N' || f.type === 'F' ? Number(raw.trim() || 'NaN') : raw.trim();
    }
    records.push(row);
  }
  return { fields, records };
}

/* ---------------- SHP（只取面） ---------------- */

const POLYGON_TYPES = new Set([5, 15, 25]);
const POINT_TYPES = new Set([1, 11, 21]);

export function readShp(file) {
  const buf = toBuffer(file);
  const shapeType = buf.readInt32LE(32);
  const out = [];
  let off = 100;
  while (off + 8 <= buf.length) {
    // 记录号从 1 开始，与 DBF 行号（从 0 开始）一一对应；用记录号对齐比用数组下标稳。
    const rec = buf.readInt32BE(off);
    const contentWords = buf.readInt32BE(off + 4);
    const contentStart = off + 8;
    const contentEnd = contentStart + contentWords * 2;
    if (contentWords <= 0 || contentEnd > buf.length) break;
    const type = buf.readInt32LE(contentStart);
    if (POINT_TYPES.has(type)) {
      out.push({ rec, type, rings: [], point: [buf.readDoubleLE(contentStart + 4), buf.readDoubleLE(contentStart + 12)] });
    } else if (POLYGON_TYPES.has(type)) {
      let p = contentStart + 4 + 32; // shapeType + bbox
      const numParts = buf.readInt32LE(p); p += 4;
      const numPoints = buf.readInt32LE(p); p += 4;
      const parts = [];
      for (let i = 0; i < numParts; i++) { parts.push(buf.readInt32LE(p)); p += 4; }
      const pts = [];
      for (let i = 0; i < numPoints; i++) { pts.push([buf.readDoubleLE(p), buf.readDoubleLE(p + 8)]); p += 16; }
      const rings = [];
      for (let i = 0; i < parts.length; i++) {
        const start = parts[i];
        const end = i + 1 < parts.length ? parts[i + 1] : numPoints;
        if (end - start >= 3) rings.push(pts.slice(start, end));
      }
      if (rings.length) out.push({ rec, type, rings });
    }
    off = contentEnd;
  }
  return { shapeType, features: out };
}

/* ---------------- 几何小工具 ---------------- */

/** 鞋带公式，米制近似（等距圆柱）。 */
export function ringAreaM2(ring) {
  if (!ring || ring.length < 4) return 0;
  const lat0 = ring[0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  const ky = 110540;
  let twice = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    twice += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky);
  }
  return Math.abs(twice) / 2;
}

/** 面里最大的环当外轮廓（忽略内洞与多部件的小块）。 */
export function largestRing(rings) {
  let best = null; let bestArea = 0;
  for (const ring of rings) {
    const area = ringAreaM2(ring);
    if (area > bestArea) { best = ring; bestArea = area; }
  }
  return best ? { ring: best, areaM2: bestArea } : null;
}

export function ringBounds(ring) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const [lng, lat] of ring) {
    w = Math.min(w, lng); e = Math.max(e, lng);
    s = Math.min(s, lat); n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

/** 自交检测（O(n²)，只用于过滤明显坏几何；顶点数先抽稀到 ≤400）。 */
export function isSimple(ring) {
  const pts = ring.slice(0, -1);
  if (pts.length < 3) return false;
  if (new Set(pts.map((p) => `${p[0]},${p[1]}`)).size !== pts.length) return false;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const n = pts.length;
  if (n > 400) return true; // 太大不逐对判，交给下游抽稀后再判
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = pts[i]; const b = pts[(i + 1) % n]; const c = pts[j]; const d = pts[(j + 1) % n];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
    }
  }
  return true;
}

/* ---------------- 层定义 ---------------- */

/** Geofabrik 层 → 我们关心的名字字段与面积门槛（m²）。 */
const LAYERS = {
  buildings: { file: 'gis_osm_buildings_a_free_1', minArea: 200, maxArea: 2e5 },
  landuse: { file: 'gis_osm_landuse_a_free_1', minArea: 500, maxArea: 3e6 },
  natural: { file: 'gis_osm_natural_a_free_1', minArea: 500, maxArea: 3e6 },
  places: { file: 'gis_osm_places_a_free_1', minArea: 500, maxArea: 3e6 },
  pois: { file: 'gis_osm_pois_a_free_1', minArea: 500, maxArea: 3e6 },
  water: { file: 'gis_osm_water_a_free_1', minArea: 500, maxArea: 3e6 },
  traffic: { file: 'gis_osm_traffic_a_free_1', minArea: 200, maxArea: 1e6 },
};

function scanLayer(dir, layerKey, nameFilter) {
  const def = LAYERS[layerKey];
  const shp = readShp(join(dir, `${def.file}.shp`));
  const dbf = readDbf(join(dir, `${def.file}.dbf`));
  const n = Math.min(shp.features.length, dbf.records.length);
  const stats = { layer: layerKey, total: n, named: 0, candidates: [], types: {} };
  const wanted = nameFilter ? nameFilter.toLowerCase() : null;
  for (let i = 0; i < n; i++) {
    const row = dbf.records[i];
    const name = String(row.name ?? '').trim();
    const fclass = String(row.fclass ?? row.type ?? '').trim();
    if (fclass) stats.types[fclass] = (stats.types[fclass] ?? 0) + 1;
    if (!name) continue;
    stats.named++;
    if (wanted && !name.toLowerCase().includes(wanted)) continue;
    const big = largestRing(shp.features[i].rings);
    if (!big) continue;
    const ok = big.areaM2 >= def.minArea && big.areaM2 <= def.maxArea && isSimple(big.ring);
    if (wanted || ok) {
      stats.candidates.push({
        layer: layerKey,
        name,
        fclass,
        areaM2: Math.round(big.areaM2),
        points: big.ring.length,
        simple: isSimple(big.ring),
        inRange: ok,
        bounds: ringBounds(big.ring).map((v) => Number(v.toFixed(6))),
      });
    }
  }
  return stats;
}

/* ---------------- CLI ---------------- */

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = arg('--dir');
  if (!dir) {
    console.error('用法：node tools/place-shapes/scan-aoi.mjs --dir <Geofabrik 解压目录> [--layer landuse] [--name 青山湖] [--all] [--json out.json]');
    process.exit(2);
  }
  const name = arg('--name');
  const all = process.argv.includes('--all');
  const keys = all ? Object.keys(LAYERS) : [arg('--layer', 'landuse')];
  const results = [];
  for (const key of keys) {
    if (!LAYERS[key]) { console.error(`未知层：${key}`); process.exit(2); }
    const stats = scanLayer(dir, key, name);
    results.push(stats);
    const inRange = stats.candidates.filter((c) => c.inRange);
    console.log(`\n== ${key} (${basename(LAYERS[key].file)}) ==`);
    console.log(`记录 ${stats.total}｜带名 ${stats.named}｜过门槛 ${inRange.length}｜列出 ${stats.candidates.length}`);
    const topTypes = Object.entries(stats.types).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => `${k}:${v}`).join(' ');
    if (topTypes) console.log(`fclass 前八：${topTypes}`);
    for (const c of stats.candidates.slice(0, 25)) {
      const flag = c.inRange ? 'OK ' : '—  ';
      console.log(`  ${flag} ${c.name} [${c.fclass || '?'}] ${c.areaM2.toLocaleString()} m² ${c.points}pt simple=${c.simple} bounds=${c.bounds.join(',')}`);
    }
    if (stats.candidates.length > 25) console.log(`  …另有 ${stats.candidates.length - 25} 条`);
  }
  const out = arg('--json');
  if (out) { writeFileSync(out, JSON.stringify(results, null, 1)); console.log(`\n已写 ${out}`); }
}