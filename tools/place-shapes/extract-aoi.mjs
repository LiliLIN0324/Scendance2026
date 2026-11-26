#!/usr/bin/env node
/**
 * Geofabrik 省份包（zip 或已解压目录）→ place_shapes 导入包（GCJ-02、带 aliases、无依赖）。
 *
 * 可以直接吃 `*-free.shp.zip`，不用先解压，也不引任何依赖（见 zip-read.mjs）。
 * 多个省可以一次跑，合并成一份包；`source` 保留每个省的包名与快照时间戳。
 *
 * 两层产物：
 *   venues[]  每个几何一条，带 tier / aliases / area / 是否噪声
 *   rows[]    按 name_norm 展开的入库行（与 public.place_shapes 字段对齐）
 *
 * 一名字一行：`place_shapes` 没有 aliases 列，`lookupPlaceStock` 也只按 name_norm 查。
 * 所以别名展开成多行、共享同一份 polygon，`canonical_name` 指回原场地。
 *
 * 去重按「名字 + ~1km 网格」而不是只按名字：跨城同名（人民公园、万达广场）
 * 必须各留各的，交给服务端按 near 选，不能在全国包里互相覆盖。
 *
 * 用法：
 *   node tools/place-shapes/extract-aoi.mjs --zip AOI/2026/202602/zhejiang-260210-free.shp.zip
 *   node tools/place-shapes/extract-aoi.mjs --zip a.zip --zip b.zip --zip c.zip --out .temp/x.json
 *   node tools/place-shapes/extract-aoi.mjs --dir AOI/zhejiang-260116-free.shp
 */
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { wgs84ToGcj02 } from '../../functions/api/geo-gcj.ts';
import { readDbf, readShp, ringAreaM2, isSimple } from './scan-aoi.mjs';
import { openZip, snapshotFromReadme } from './zip-read.mjs';

/*
 * 分四层，语义不同，不能混：
 *   lawn           草坪级：可以直接当「可摆活动的场地」候选
 *   estate         园区级：整个酒店/景区/园区，先立壳再让用户圈
 *   building       单体建筑：室内场地或「该地名只以建筑存在」的兜底
 *   building-large 大型单体：体育场/会展中心主体
 */
const KEEP = {
  landuse: {
    file: 'gis_osm_landuse_a_free_1',
    classes: ['park', 'grass', 'forest', 'commercial', 'retail', 'recreation_ground'],
    bands: [['lawn', 500, 50_000], ['estate', 50_000, 1_000_000]],
  },
  /* 水面：西湖（relation 2308774，natural=water / water=lake，约 6.4 km²）这类地标湖
   * 之前整层没收，所以搜「西湖」永远只能走网上现查。
   * 上限给到 10 km²：西湖、东钱湖能进；太湖（约 2,338 km²）、洞头湾这类仍排除。 */
  water: {
    file: 'gis_osm_water_a_free_1',
    classes: ['water', 'reservoir', 'wetland', 'riverbank'],
    bands: [['lawn', 500, 50_000], ['estate', 50_000, 2_000_000], ['water', 2_000_000, 10_000_000]],
  },
  /* 自然地类（沙滩、灌丛、林地…）：露营/草坪类场地的补充来源。 */
  natural: {
    file: 'gis_osm_natural_a_free_1',
    classes: ['beach', 'sand', 'scrub', 'heath', 'wood', 'grassland'],
    bands: [['lawn', 500, 50_000], ['estate', 50_000, 1_000_000]],
  },
  pois: {
    file: 'gis_osm_pois_a_free_1',
    classes: ['hotel', 'park', 'mall', 'museum', 'attraction', 'stadium', 'theatre', 'zoo', 'theme_park', 'water_park'],
    bands: [['lawn', 500, 50_000], ['estate', 50_000, 1_000_000]],
  },
  places: {
    file: 'gis_osm_places_a_free_1',
    classes: ['island', 'locality', 'suburb', 'quarter', 'neighbourhood'],
    bands: [['lawn', 500, 50_000], ['estate', 50_000, 1_000_000]],
  },
  buildings: {
    file: 'gis_osm_buildings_a_free_1',
    classes: ['building'],
    bands: [['building', 300, 20_000], ['building-large', 20_000, 200_000]],
  },
};

/** 只有点、没有面的 POI。Geofabrik 的点层没有面积，这里按场地量级拟一个方框。
 *  这不是实测轮廓，是“先给个能用的框”的降级值，所以单独分 tier，事后能区分。
 *  尺寸按“盖一场婚礼需要落下的东西”定：
 *    landmark 120m（景区/地标广场，要留出仪式区+宾客区）
 *    venue    70m（酒店/场馆/商场，室内厅或门前广场一张标准桌阵的量级）
 */
const POINT_BUFFER = { landmark: 120, venue: 70 };
const POINT_CLASSES = {
  attraction: 'landmark', viewpoint: 'landmark', park: 'landmark', garden: 'landmark',
  zoo: 'landmark', theme_park: 'landmark', water_park: 'landmark', stadium: 'landmark',
  sports_centre: 'landmark', monument: 'landmark', memorial: 'landmark', artwork: 'landmark',
  camp_site: 'landmark', picnic_site: 'landmark', marina: 'landmark',
  hotel: 'venue', guesthouse: 'venue', hostel: 'venue', chalet: 'venue', motel: 'venue',
  museum: 'venue', theatre: 'venue', cinema: 'venue', mall: 'venue', department_store: 'venue',
  exhibition_centre: 'venue', convention_centre: 'venue', community_centre: 'venue', arts_centre: 'venue',
};

/** 同名去重优先级：水面/草坪 > 园区 > 大型单体 > 单体 > 点降级。 */
const TIER_RANK = { lawn: 4, water: 4, estate: 3, 'building-large': 2, building: 1, 'point-buffer': 0 };

const CITY_PREFIX = /^(?:杭州市|杭州|浙江省|浙江)/u;
/** 与 functions/api/place-shape.ts 的 SAME_PLACE_SUFFIXES 同口径：改一处要同步另一处。 */
const SAME_PLACE_SUFFIXES = [
  '主楼', '大楼', '分楼', '新楼', '主馆', '分馆', '展馆', '馆', '店', '分店', '门店', '中心', '广场', '园区', '景区',
];
/** 楼栋/配套噪声：不外抛，只打标。带场馆语义的名字（公园/广场/酒店…）不算噪声。 */
const NOISE_PATTERN = /^(?:[0-9]+[号栋幢舍]|[0-9]+舍|[A-Za-z]?[0-9]+栋)|号楼|幢|单元|车库|门卫|配电|泵房|厕所|垃圾|变电/;
const VENUE_MARKER = /公园|广场|酒店|饭店|宾馆|山庄|度假|中心|会展|博览|体育馆|博物馆|美术馆|展馆|剧院|剧场/;
/** 通用名：不指向具体场地，搜到了也用不了（用户点名要滤的这批）。“XX大学食堂”同样是食堂，所以不锚定。 */
const GENERIC_NAME = /食堂|行政楼|综合楼|宿舍|教学楼|中国石化|中国石油|加油站/;
/** 纯英文通用词：hotel / restaurant 这种整名就是类别，不是地名。 */
const GENERIC_EN_NAME = /^(?:hotel|restaurant|cafe|shop|store|supermarket|school|hospital|park|mall|bank|office)$/i;

const SIMPLIFY_TOL_M = 3;
const MAX_POINTS = 64; // SitePlanData.boundary 上限 64 点（site-plan.ts planBoundarySchema）
const MAX_ALIASES = 4;

export function normalizeName(value) {
  return String(value ?? '').toLowerCase().replace(/[\s\u3000·．.,，()（）\-—_/]+/g, '');
}

/**
 * 别名：整名 / 去城市前缀 / 去一个白名单后缀 / 分隔符分段。
 * 只用与 samePlaceRank 同一个后缀白名单，否则生成的别名自己就匹配不上。
 */
export function nameAliases(name) {
  const out = new Set();
  const push = (value) => { const v = String(value ?? '').trim(); if (v.length >= 2) out.add(v); };
  push(name);
  const noCity = String(name ?? '').replace(CITY_PREFIX, '');
  push(noCity);
  for (const suffix of SAME_PLACE_SUFFIXES) {
    // 单字后缀（馆/店）不能拿来删：“杭州君悦酒店” 会变成 “杭州君悦酒”。
    // 白名单本身要与服务端同口径（samePlaceRank 用），差别只在这里不剥单字。
    if (suffix.length < 2) continue;
    for (const base of [name, noCity]) {
      const cut = base.length - suffix.length;
      if (cut >= 3 && base.endsWith(suffix)) push(base.slice(0, cut));
    }
  }
  for (const seg of String(name ?? '').split(/[-·\s]+/)) push(seg);
  return [...out].sort((a, b) => b.length - a.length).slice(0, MAX_ALIASES);
}

function toMeters(ring) {
  const lat0 = ring[0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  return ring.map(([lng, lat]) => ({ x: lng * kx, y: lat * 110540 }));
}

/** Douglas-Peucker，闭环保留首尾。 */
export function simplify(ring, tolerance = SIMPLIFY_TOL_M) {
  if (ring.length < 5) return ring;
  const pts = toMeters(ring);
  const keep = new Array(ring.length).fill(false);
  keep[0] = true; keep[ring.length - 1] = true;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const ax = pts[a].x; const ay = pts[a].y;
    const dx = pts[b].x - ax; const dy = pts[b].y - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let maxD = -1; let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i].x - ax) * dx + (pts[i].y - ay) * dy) / len2));
      const ex = ax + dx * t - pts[i].x; const ey = ay + dy * t - pts[i].y;
      const d = Math.hypot(ex, ey);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tolerance) { keep[maxI] = true; stack.push([a, maxI], [maxI, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}

function stride(ring, max = MAX_POINTS) {
  if (ring.length <= max) return ring;
  const step = Math.ceil(ring.length / max);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

function boundsOf(ring) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const [lng, lat] of ring) {
    w = Math.min(w, lng); e = Math.max(e, lng);
    s = Math.min(s, lat); n = Math.max(n, lat);
  }
  return [w, s, e, n].map((v) => Number(v.toFixed(6)));
}

function outerRing(rings) {
  let best = null; let area = 0;
  for (const ring of rings) {
    const a = ringAreaM2(ring);
    if (a > area) { best = ring; area = a; }
  }
  return best ? { ring: best, areaM2: area } : null;
}

/** 别名本身也可能是垃圾：名字够干净不代表拆出来的段干净。
 *  “上海新体育广场 / 主格生活广场 1号楼” 会拆出 “1号楼”，纯数字名会拆出 “11”。 */
function isJunkAlias(alias) {
  const s = String(alias ?? '').trim();
  if (s.length < 2) return true;
  if (/^[0-9]+$/.test(s)) return true;
  if (NOISE_PATTERN.test(s) && !VENUE_MARKER.test(s)) return true;
  if (GENERIC_NAME.test(s) || GENERIC_EN_NAME.test(s)) return true;
  if (s.replace(/[^\u4e00-\u9fa5A-Za-z]/g, '').length < 2) return true;
  return false;
}

/* ---------------- 提取（数据源无关：路径或 zip 都给一个 read(name)） ---------------- */

const DEBUG_LAYERS = process.argv.includes('--debug-layers');
// 增量补层用：--layers water,natural 只跑这几层，输出可直接当“新增行”去导（已导的 29.7 万行不用重跑）。
const ONLY_LAYERS = (() => {
  const arg = process.argv.find(item => item.startsWith('--layers='));
  if (!arg) return null;
  const picked = arg.slice('--layers='.length).split(',').map(s => s.trim()).filter(Boolean);
  return picked.length ? new Set(picked) : null;
})();
// 排查“某个地点明明在包里却没入库”：--trace-name=西湖 逐步打出被哪道门卡下。
const TRACE_NAME = (process.argv.find(item => item.startsWith('--trace-name=')) ?? '').slice('--trace-name='.length) || null;

function pickFrom(read, source, bufferOverride = null) {
  const venues = [];
  const missing = [];
  for (const [layer, def] of Object.entries(KEEP)) {
    if (ONLY_LAYERS && !ONLY_LAYERS.has(layer)) continue;
    const shpBuf = read(`${def.file}.shp`);
    const dbfBuf = read(`${def.file}.dbf`);
    if (!shpBuf || !dbfBuf) { missing.push(layer); continue; }
    const shp = readShp(shpBuf);
    const dbf = readDbf(dbfBuf);
    const hist = {};
    for (const geo of shp.features) {
      const rec = dbf.records[geo.rec - 1];
      if (!rec) continue;
      const name = String(rec.name ?? '').trim();
      const fclass = String(rec.fclass ?? '').trim();
      if (!name) continue;
      // 图层名与 fclass 取值是按 Geofabrik 标准结构写的；--debug-layers 把实际取值打出来，
      // 第一次跑就能看出有没有写错（写错的类别静默跳过，不报错）。
      if (DEBUG_LAYERS) hist[fclass] = (hist[fclass] ?? 0) + 1;
      if (!def.classes.includes(fclass)) { if (TRACE_NAME && name.includes(TRACE_NAME)) console.log(`  [trace] ${layer}｜${name}：fclass ${fclass} 不在收的类别里`); continue; }
      const outer = outerRing(geo.rings);
      if (!outer) { if (TRACE_NAME && name.includes(TRACE_NAME)) console.log(`  [trace] ${layer}｜${name}：没有外环`); continue; }
      const band = def.bands.find(([, min, max]) => outer.areaM2 >= min && outer.areaM2 <= max);
      if (!band) { if (TRACE_NAME && name.includes(TRACE_NAME)) console.log(`  [trace] ${layer}｜${name}：面积 ${Math.round(outer.areaM2)} m² 不在档位里（环数 ${geo.rings.length}）`); continue; }
      const gcj = outer.ring.map(([lng, lat]) => {
        const g = wgs84ToGcj02(lng, lat);
        return [Number(g.lng.toFixed(6)), Number(g.lat.toFixed(6))];
      });
      // 自交重试：西湖这种岸线（1588 点、含 34 个岛）压到 64 点会自己穿过自己，
      // 自交的多边形在画布上会花屏。逐级降点（64 / 32 / 16）再试，仍不行才丢。
      let polygon = null;
      for (const [cap, tol] of [[MAX_POINTS, SIMPLIFY_TOL_M], [32, SIMPLIFY_TOL_M * 2], [16, SIMPLIFY_TOL_M * 4]]) {
        const simplified = stride(simplify(gcj, tol), cap);
        const closed = simplified[0][0] === simplified[simplified.length - 1][0]
          && simplified[0][1] === simplified[simplified.length - 1][1];
        const candidate = closed ? simplified.slice(0, -1) : simplified;
        if (candidate.length >= 3 && isSimple([...candidate, candidate[0]])) {
          polygon = candidate;
          break;
        }
      }
      if (!polygon) { if (TRACE_NAME && name.includes(TRACE_NAME)) console.log(`  [trace] ${layer}｜${name}：降点到 16 仍自交，丢弃`); continue; }
      venues.push({
        id: `osm:W${rec.osm_id || `${layer}-${geo.rec}`}`,
        name,
        kind: 'area',
        tier: band[0],
        fclass,
        // 建筑的 type 是 OSM building=* 的值（hotel / exhibition_centre / sports_hall…），比名字更准。
        venue_type: String(rec.type ?? '').trim(),
        area_m2: Math.round(outer.areaM2),
        noise: NOISE_PATTERN.test(name) && !VENUE_MARKER.test(name),
        polygon,
        bounds: boundsOf(polygon),
        aliases: nameAliases(name),
        source,
      });
    }
    if (DEBUG_LAYERS) {
      const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([k, v]) => `${k} ${v}`).join('｜');
      console.log(`  [${layer}] 有名字 ${Object.values(hist).reduce((a, b) => a + b, 0)}｜${top || '（无）'}`);
    }
  }

  // 点层：只收有场馆语义的 fclass，按尺寸拟一个方框。
  // 增量补层（--layers=water,natural）时默认不跑点层：4 万多行点降级已经在库里，重导会整批重复。
  const wantPoints = !ONLY_LAYERS || ONLY_LAYERS.has('points');
  const ptShp = wantPoints ? read('gis_osm_pois_free_1.shp') : null;
  const ptDbf = wantPoints ? read('gis_osm_pois_free_1.dbf') : null;
  if (!wantPoints) { /* 只要面层，点层跳过 */ } else if (!ptShp || !ptDbf) { missing.push('pois_point'); } else {
    const shp = readShp(ptShp);
    const dbf = readDbf(ptDbf);
    for (const geo of shp.features) {
      if (!geo.point) continue;
      const rec = dbf.records[geo.rec - 1];
      if (!rec) continue;
      const name = String(rec.name ?? '').trim();
      const fclass = String(rec.fclass ?? '').trim();
      const bucket = POINT_CLASSES[fclass];
      if (!name || !bucket) continue;
      const size = bufferOverride ?? POINT_BUFFER[bucket];
      const g = wgs84ToGcj02(geo.point[0], geo.point[1]);
      const half = size / 2;
      const dLat = half / 110540;
      const dLng = half / (111320 * Math.cos((g.lat * Math.PI) / 180));
      const polygon = [
        [Number((g.lng - dLng).toFixed(6)), Number((g.lat - dLat).toFixed(6))],
        [Number((g.lng + dLng).toFixed(6)), Number((g.lat - dLat).toFixed(6))],
        [Number((g.lng + dLng).toFixed(6)), Number((g.lat + dLat).toFixed(6))],
        [Number((g.lng - dLng).toFixed(6)), Number((g.lat + dLat).toFixed(6))],
      ];
      venues.push({
        id: `osm:N${rec.osm_id || `pois-${geo.rec}`}`,
        name,
        kind: 'area',
        tier: 'point-buffer',
        fclass,
        venue_type: fclass,
        area_m2: size * size,
        buffer_m: size,
        noise: NOISE_PATTERN.test(name) && !VENUE_MARKER.test(name),
        polygon,
        bounds: boundsOf(polygon),
        aliases: nameAliases(name),
        source,
      });
    }
  }
  return { venues, missing };
}

function pickFromDir(dir) {
  const source = `osm:geofabrik:${basename(dir)}`;
  return pickFrom((name) => {
    try { return readFileSync(join(dir, name)); } catch { return null; }
  }, source);
}

function pickFromZip(file, bufferOverride = null) {
  const zip = openZip(file);
  const source = `osm:geofabrik:${basename(file, '.zip')}`;
  const snapshot = snapshotFromReadme(zip.readText('README'));
  const { venues, missing } = pickFrom((name) => zip.read(name), source, bufferOverride);
  return { venues, missing, source, snapshot };
}

/* ---------------- 展开成入库行 ---------------- */

/** ~1km 网格：同城同名算重复，跨城同名各留一份。 */
function gridOf(bounds) {
  const cx = (bounds[0] + bounds[2]) / 2;
  const cy = (bounds[1] + bounds[3]) / 2;
  return `${Math.round(cx * 100)},${Math.round(cy * 100)}`;
}

function expandRows(venues) {
  const best = new Map();
  const usedIds = new Set();
  for (const venue of venues) {
    const cell = gridOf(venue.bounds);
    for (const alias of venue.aliases) {
      const nameNorm = normalizeName(alias);
      if (!nameNorm) continue;
      const id = alias === venue.name ? venue.id : `${venue.id}#${nameNorm}`;
      if (isJunkAlias(alias)) continue;
      if (usedIds.has(id)) continue;
      const row = {
        id,
        name: alias,
        name_norm: nameNorm,
        kind: 'area',
        polygon: venue.polygon,
        bounds: venue.bounds,
        // 与 place_shapes 实际列对齐（tools/aholo/lux3d-dev-proxy.mjs 的 writePlaceStock 同口径）。
        center_lng: Number(((venue.bounds[0] + venue.bounds[2]) / 2).toFixed(6)),
        center_lat: Number(((venue.bounds[1] + venue.bounds[3]) / 2).toFixed(6)),
        pts: venue.polygon.length,
        tier: venue.tier,
        area_m2: venue.area_m2,
        source: venue.source,
        canonical_name: venue.name,
      };
      const key = `${nameNorm}@${cell}`;
      const prev = best.get(key);
      if (!prev) { best.set(key, row); usedIds.add(id); continue; }
      const rank = TIER_RANK[row.tier] ?? 0;
      const prevRank = TIER_RANK[prev.tier] ?? 0;
      if (rank > prevRank || (rank === prevRank && row.area_m2 > prev.area_m2)) {
        usedIds.delete(prev.id);
        best.set(key, row);
        usedIds.add(id);
      }
    }
  }
  return [...best.values()];
}

/* ---------------- CLI ---------------- */

function argAll(flag) {
  const out = [];
  process.argv.forEach((value, i) => { if (value === flag && i + 1 < process.argv.length) out.push(process.argv[i + 1]); });
  return out;
}

function arg(flag, fallback = null) {
  return argAll(flag)[0] ?? fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const zips = argAll('--zip');
  const dirs = argAll('--dir');
  if (zips.length === 0 && dirs.length === 0) {
    console.error('用法：node tools/place-shapes/extract-aoi.mjs --zip <a.zip> [--zip b.zip ...] [--dir <解压目录>] [--out file.json]');
    process.exit(2);
  }
  const keepNoise = process.argv.includes('--keep-noise');
  const bufferOverride = arg('--point-buffer') ? Number(arg('--point-buffer')) : null;
  // GCJ-02 的偏移只覆盖大陆：港澳台照搬会偏 ~500m，默认排除。
  const skipNonMainland = !process.argv.includes('--include-non-mainland');
  const NON_MAINLAND = /(?:hong-kong|macau|taiwan)/i;
  if (bufferOverride !== null && !(bufferOverride > 0)) {
    console.error('--point-buffer 要给正数（米）');
    process.exit(2);
  }
  const sources = [];
  const venues = [];
  for (const file of zips) {
    if (skipNonMainland && NON_MAINLAND.test(basename(file))) { console.log(`· ${basename(file)}｜跳过（非大陆，GCJ-02 不适用）`); continue; }
    const result = pickFromZip(file, bufferOverride);
    sources.push({ archive: basename(file), snapshot: result.snapshot, venues: result.venues.length, missingLayers: result.missing });
    venues.push(...result.venues);
    console.log(`· ${basename(file)}｜快照 ${result.snapshot ?? '未知'}｜几何 ${result.venues.length}${result.missing.length ? `｜缺层 ${result.missing.join(',')}` : ''}`);
  }
  for (const dir of dirs) {
    const result = pickFromDir(dir);
    sources.push({ archive: basename(dir), snapshot: null, venues: result.venues.length, missingLayers: result.missing });
    venues.push(...result.venues);
    console.log(`· ${basename(dir)}（已解压）｜几何 ${result.venues.length}${result.missing.length ? `｜缺层 ${result.missing.join(',')}` : ''}`);
  }

  const rows = expandRows(keepNoise ? venues : venues.filter((v) => !v.noise));
  const tiers = {};
  for (const v of venues) tiers[v.tier] = (tiers[v.tier] ?? 0) + 1;
  const cellsByName = new Map();
  for (const row of rows) {
    if (!cellsByName.has(row.name_norm)) cellsByName.set(row.name_norm, new Set());
    cellsByName.get(row.name_norm).add(gridOf(row.bounds));
  }
  const multiCity = [...cellsByName.values()].filter((cells) => cells.size > 1).length;
  const aliased = venues.reduce((sum, v) => sum + v.aliases.length, 0) - venues.length;
  const noisy = venues.filter((v) => v.noise).length;

  console.log(`\n来源 ${sources.length} 个｜几何 ${venues.length} 条｜入库行 ${rows.length} 条`);
  console.log(`分层 ${Object.entries(tiers).map(([k, v]) => `${k} ${v}`).join('｜')}`);
  console.log(`别名多出 ${aliased}｜同名折叠 ${venues.length + aliased - rows.length}｜跨城同名 ${multiCity} 个名字`);
  const maxPts = rows.reduce((m, r) => (r.pts > m ? r.pts : m), 0);
  console.log(`标噪声 ${noisy} 个几何${keepNoise ? '（已保留入库）' : '（默认不入库，加 --keep-noise 可带上）'}｜最大顶点 ${maxPts}｜ID 唯一 ${new Set(rows.map((r) => r.id)).size === rows.length}`);

  const out = arg('--out', '.temp/aoi-import.json');
  const base = out.replace(/\.json$/i, '');
  const jsonl = `${base}.place_shapes.jsonl`;
  const summaryPath = `${base}.summary.json`;
  // PostgREST 批量插入用：一行一条，只留 place_shapes 实际列。
  // tier / area_m2 / canonical_name 是本包自带的审阅字段，入库前必须剥掉，否则 PostgREST 会因为未知列报错。
  const tableColumns = ({ id, name, name_norm, kind, polygon, bounds, center_lng, center_lat, pts }) =>
    ({ id, name, name_norm, kind, polygon, bounds, center_lng, center_lat, pts });

  // 全国量级（几十万行）不一次拼成一个大字符串，按块写。
  const fd = openSync(jsonl, 'w');
  const CHUNK = 2000;
  let chunk = [];
  for (const row of rows) {
    chunk.push(JSON.stringify(tableColumns(row)));
    if (chunk.length >= CHUNK) { writeSync(fd, `${chunk.join('\n')}\n`); chunk = []; }
  }
  if (chunk.length) writeSync(fd, chunk.join('\n'));
  closeSync(fd);
  console.log(`已写 ${jsonl}（${rows.length} 行）`);

  writeFileSync(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    crs: 'gcj-02',
    license: 'ODbL-1.0',
    sources,
    pointBuffer: { default: POINT_BUFFER, override: bufferOverride },
    counts: {
      sources: sources.length, venues: venues.length, rows: rows.length, tiers, noisy,
      multiCityNames: multiCity, maxPts,
    },
  }, null, 2));
  console.log(`已写 ${summaryPath}`);

  // 审阅包带全量几何，体积约为 jsonl 的 2.7 倍；全国跑时不默认生成。
  if (process.argv.includes('--review')) {
    writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), sources, crs: 'gcj-02', license: 'ODbL-1.0', venues, rows }));
    console.log(`已写 ${out}（审阅包）`);
  }
}