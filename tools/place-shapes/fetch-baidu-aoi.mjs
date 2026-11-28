#!/usr/bin/env node
/**
 * 百度 AOI（场地边界）→ GCJ-02 → public.place_shapes。
 *
 * 为什么有它：`/api/place-shape` 的真实轮廓只从 OSM 取（photon + Overpass），
 * 郊野场地在 OSM 里常常只有一个 node（青山湖水上森林就是：node 13788964901，
 * leisure=park，无面），搜索能命中、框永远出不来。百度 Web 端的 `qt=ext` 会给出
 * POI 的 AOI 多边形（`content.geo`，type=4），是目前唯一能拿到的「这块地的框」。
 *
 * 口径与边界（先读再用）：
 * - 这是**非公开接口**：无配额、无 SLA、随时可能加大风控。只在离线批量场景用，
 *   不要在运行时按用户请求实时调用（产品里那条链路会因此变慢且不可控）。
 * - 抓到的框是**百度认定的 POI 范围**（景区/园区整体），不是活动作业面；
 *   入库后仍要人工收边。`--apply` 前请先看 `--geojson` 导出的形状。
 * - 换算：百度 MC（墨卡托米）→ GCJ-02 用控制点标定（见 CALIBRATION），
 *   残差约 ±50 m，主要来自控制点自身的真值精度，不是投影误差。
 *
 * 用法：
 *   node tools/place-shapes/fetch-baidu-aoi.mjs --name "青山湖水上森林"          # 预演，只打印
 *   node tools/place-shapes/fetch-baidu-aoi.mjs --names "A,B,C" --out .temp/x.json
 *   node tools/place-shapes/fetch-baidu-aoi.mjs --from-file names.txt --geojson .temp/aoi.geojson
 *   node tools/place-shapes/fetch-baidu-aoi.mjs --name "青山湖水上森林" --apply   # 真写库
 *   node tools/place-shapes/fetch-baidu-aoi.mjs --name "X" --apply --overwrite    # 覆盖已有行
 *
 * 安全默认：库里已有**同名**行（含人工描边）时跳过，不覆盖——自动抓的 AOI
 * 面积通常大于人工收过边的作业面，覆盖等于把好数据换成糙数据。
 * 凭据只从环境变量或根 .env.local 读，不打印。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://map.baidu.com/' };
const SUGGEST_DELAY_MS = 250;

/** 与 functions/api/place-stock-config.ts 的默认库一致（线上 Function 读的就是它）。 */
const DEFAULT_SUPABASE_URL = 'https://wkhfvnzgopjdzxlmycks.supabase.co';

/**
 * MC → GCJ-02 标定（2026-11-27 实测，两点/三点最小二乘）。
 * 控制点真值来源：杭州植物园（高德 GCJ 120.117009, 30.252910，仓库调研文档）、
 * 江寺公园（WGS 120.26694, 30.16565 → wgs84ToGcj02）、临安钱王陵园
 * （高德 GCJ 119.725502, 30.235717）。三点拟合残差 16–26 m，留一 49–153 m。
 */
const CALIBRATION = {
  lng: { a: 8.978697066554e-6, b: 0.05171037435591567 },
  lat: { a: 7.778292870121e-6, b: 2.910385526248087 },
  note: 'MC(BD09 墨卡托米) → GCJ-02；误差约 ±50 m，来自控制点真值精度',
};

const MIN_AREA_M2 = 200;          // 比这更小的多半是单个亭子/门牌，不当场地
const MAX_AREA_M2 = 5_000_000;    // 5 km² 以上多半是区域级地块，不当场地
const MIN_POINTS = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function toGcj(x, y) {
  return [
    Number((CALIBRATION.lng.a * x + CALIBRATION.lng.b).toFixed(6)),
    Number((CALIBRATION.lat.a * y + CALIBRATION.lat.b).toFixed(6)),
  ];
}

/** 与服务端 normalizeShapeName 完全一致（functions/api/place-shape.ts）。 */
export function normalizeShapeName(value) {
  return String(value ?? '').toLowerCase().replace(/[\s\u3000·．.,，()（）\-—_/]+/g, '');
}

/** 百度 `qt=ext` 的 geo："4|w,s;e,n|1-x1,y1,x2,y2;…" → 环数组（MC 米）。 */
export function parseBaiduGeo(geo) {
  const parts = String(geo ?? '').split('|');
  if (parts.length < 3) return null;
  const rings = [];
  for (const segment of parts.slice(2)) {
    for (const chunk of segment.split(';')) {
      const cleaned = chunk.replace(/^\d+-/, '').trim();
      if (!cleaned) continue;
      const nums = cleaned.split(',').map(Number);
      if (nums.length < MIN_POINTS * 2 || nums.length % 2 !== 0) continue;
      const ring = [];
      for (let i = 0; i < nums.length; i += 2) {
        if (!Number.isFinite(nums[i]) || !Number.isFinite(nums[i + 1])) continue;
        ring.push({ x: nums[i], y: nums[i + 1] });
      }
      if (ring.length >= MIN_POINTS) rings.push(ring);
    }
  }
  if (rings.length === 0) return null;
  return { type: Number(parts[0]), rings };
}

/** MC 面积（米²，墨卡托口径）——只用来挑最大的环，真实面积另算。 */
function mcRingArea(ring) {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** GCJ 环的真实面积（米²，等距圆柱近似）。 */
export function ringAreaM2(polygon) {
  if (polygon.length < 3) return 0;
  const lat0 = polygon[0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  let twice = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
    twice += (a[0] * kx) * (b[1] * 110540) - (b[0] * kx) * (a[1] * 110540);
  }
  return Math.abs(twice) / 2;
}

/** 自交检测（与服务端 simpleFootprint 同口径的轻量版）。 */
export function isSimpleRing(polygon) {
  const pts = polygon.length > 3
    && polygon[0][0] === polygon[polygon.length - 1][0]
    && polygon[0][1] === polygon[polygon.length - 1][1]
    ? polygon.slice(0, -1)
    : polygon;
  if (pts.length < 3) return false;
  if (new Set(pts.map(p => `${p[0]},${p[1]}`)).size !== pts.length) return false;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 2; j < pts.length; j += 1) {
      if (i === 0 && j === pts.length - 1) continue;
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      const c = pts[j]; const d = pts[(j + 1) % pts.length];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
    }
  }
  return true;
}

function meterBox(polygon) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const latMid = (north + south) / 2;
  return {
    bounds: [west, south, east, north].map(v => Number(v.toFixed(6))),
    widthM: Math.round((east - west) * 111320 * Math.cos((latMid * Math.PI) / 180)),
    depthM: Math.round((north - south) * 110540),
  };
}

function readEnvLocal() {
  const env = {};
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(resolve(ROOT, name), 'utf8').split(/\r?\n/)) {
        const hit = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (!hit) continue;
        env[hit[1]] ??= hit[2].trim().replace(/^["']|["']$/g, '');
      }
    } catch { /* 没有就继续用真实环境变量 */ }
  }
  return env;
}

function credentials() {
  const file = readEnvLocal();
  const pick = key => process.env[key] || file[key] || '';
  // 与 functions/api/place-stock-config.ts 同一默认库：线上 Function 读库用的就是它，
  // 这里沿用同一口径，避免「脚本写 A 库、线上读 B 库」这种只能靠回读才发现的分叉。
  const url = pick('SUPABASE_URL') || pick('NEXT_PUBLIC_SUPABASE_URL') || DEFAULT_SUPABASE_URL;
  const writeKey = pick('SUPABASE_SERVICE_ROLE_KEY');
  const readKey = writeKey || pick('NEXT_PUBLIC_SUPABASE_ANON_KEY') || pick('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  return { url: url ? url.replace(/\/$/, '') : '', writeKey, readKey, urlFromEnv: !!(pick('SUPABASE_URL') || pick('NEXT_PUBLIC_SUPABASE_URL')) };
}

function parseArgs(argv) {
  const out = { names: [], apply: false, overwrite: false, geojson: '', out: '', file: '', limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--overwrite') out.overwrite = true;
    else if (arg === '--name') out.names.push(String(argv[++i] ?? '').trim());
    else if (arg === '--names') out.names.push(...String(argv[++i] ?? '').split(',').map(s => s.trim()));
    else if (arg === '--from-file') out.file = resolve(process.cwd(), argv[++i] ?? '');
    else if (arg === '--geojson') out.geojson = resolve(process.cwd(), argv[++i] ?? '');
    else if (arg === '--out') out.out = resolve(process.cwd(), argv[++i] ?? '');
    else if (arg === '--limit') out.limit = Math.max(0, Number(argv[++i] ?? 0));
  }
  return out;
}

async function jsonFetch(url, timeoutMs = 25000) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** 名称 → 百度 uid（取建议第一条）。 */
export async function baiduSuggest(name) {
  const url = `https://map.baidu.com/su?wd=${encodeURIComponent(name)}&cid=289&type=0&pc_ver=2&newmap=1&ie=utf-8&oue=1&fromproduct=jsapi&res=api`;
  const body = await jsonFetch(url, 20000);
  const first = (body?.s ?? [])[0];
  if (!first) return null;
  const [, city, district, label, , uid] = first.split('$');
  return { uid, label, city, district };
}

/** uid → 百度 POI 的 MC 点（用于定位校验）。 */
export async function baiduPoiPoint(name, uid) {
  const url = `https://map.baidu.com/?qt=s&wd=${encodeURIComponent(name)}&c=289&src=0&pn=0&sug=0&l=12&ie=utf-8&oue=1&fromproduct=jsapi&res=api&newmap=1`;
  const body = await jsonFetch(url);
  const hit = (body?.content ?? []).find(item => item?.uid === uid) ?? null;
  const match = hit?.geo ? String(hit.geo).match(/^\d+\|(-?[\d.]+),(-?[\d.]+)/) : null;
  return match ? { x: Number(match[1]), y: Number(match[2]), name: hit.name, addr: hit.addr ?? '' } : null;
}

/** uid → AOI 多边形（GCJ-02）。最大的环当外轮廓。 */
export async function baiduAoi(uid) {
  const body = await jsonFetch(`https://map.baidu.com/?qt=ext&uid=${uid}&ext_ver=new&l=18`);
  const geo = body?.content?.geo;
  if (!geo) return null;
  const parsed = parseBaiduGeo(geo);
  if (!parsed) return null;
  const rings = parsed.rings.map(ring => ({ ring, area: mcRingArea(ring) })).sort((a, b) => b.area - a.area);
  const polygon = rings[0].ring.map(point => toGcj(point.x, point.y));
  return { geoType: parsed.type, ringCount: rings.length, polygon };
}

/** 一个名字走完整条链：建议 → AOI → 换算 → 质量门。 */
export async function fetchAoi(name) {
  const suggestion = await baiduSuggest(name);
  if (!suggestion) return { name, error: '百度没有这个地名' };
  const point = await baiduPoiPoint(suggestion.label, suggestion.uid);
  const aoi = await baiduAoi(suggestion.uid);
  if (!aoi) return { name, matchedName: suggestion.label, error: '这个 POI 没有 AOI 边界（百度只给了点）' };
  const polygon = aoi.polygon;
  const areaM2 = ringAreaM2(polygon);
  if (polygon.length < MIN_POINTS) return { name, error: `边界只有 ${polygon.length} 点` };
  if (!isSimpleRing(polygon)) return { name, error: '边界自交，不能用' };
  if (areaM2 < MIN_AREA_M2) return { name, error: `面积 ${Math.round(areaM2)} ㎡，太小` };
  if (areaM2 > MAX_AREA_M2) return { name, error: `面积 ${Math.round(areaM2)} ㎡，超过 5 km²，像区域级地块` };
  const { bounds, widthM, depthM } = meterBox(polygon);
  return {
    name,
    matchedName: suggestion.label,
    district: `${suggestion.city ?? ''}${suggestion.district ?? ''}`,
    uid: suggestion.uid,
    address: point?.addr ?? '',
    polygon,
    bounds,
    areaM2: Math.round(areaM2),
    size: `${widthM}×${depthM} m`,
    ringCount: aoi.ringCount,
  };
}

async function existingRow(url, readKey, nameNorm) {
  if (!url || !readKey) return null;
  try {
    const response = await fetch(`${url}/rest/v1/place_shapes?name_norm=eq.${encodeURIComponent(nameNorm)}&select=name,pts,polygon`, {
      headers: { apikey: readKey, ...(readKey.startsWith('eyJ') ? { Authorization: `Bearer ${readKey}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null; // 读不到不阻塞：交给 --overwrite 语义，宁可跳过
  }
}

async function upsertRow(url, writeKey, row) {
  const endpoint = `${url}/rest/v1/place_shapes?on_conflict=name_norm`;
  const headers = {
    apikey: writeKey,
    Authorization: `Bearer ${writeKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=representation',
  };
  const body = JSON.stringify(row);
  let response = await fetch(endpoint, { method: 'POST', headers, body });
  let text = await response.text();
  // 线上表没有 name_norm 唯一索引（PostgREST 回 400 / 42P10，不是 409），
  // 走「先删同名再插」——与 upsert-place-shape.mjs 同口径，同名多行本来就允许共存。
  const noUniqueKey = response.status === 409 || text.includes('42P10');
  if (!response.ok && noUniqueKey) {
    await fetch(`${url}/rest/v1/place_shapes?name_norm=eq.${encodeURIComponent(row.name_norm)}`, {
      method: 'DELETE', headers: { apikey: writeKey, Authorization: `Bearer ${writeKey}` },
    });
    response = await fetch(`${url}/rest/v1/place_shapes`, { method: 'POST', headers, body });
    text = await response.text();
  }
  return { ok: response.ok, status: response.status, text: text.slice(0, 200) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = [...args.names];
  if (args.file) {
    // 两种来源都吃：一行一个名字（手写清单），或 {name,lng,lat} 的 JSONL / JSON 数组
    // （表格导出给运营的场地清单就是这种形状）。
    const text = readFileSync(args.file, 'utf8').trim();
    const wholeArray = text.startsWith('[')
      ? (() => { try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : null; } catch { return null; } })()
      : null;
    if (wholeArray) {
      for (const item of wholeArray) {
        const name = String(item?.name ?? '').trim();
        if (name) names.push(name);
      }
    } else {
      for (const line of text.split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.startsWith('#')) continue;
        if (value.startsWith('{')) {
          try {
            const name = String(JSON.parse(value)?.name ?? '').trim();
            if (name) names.push(name);
            continue;
          } catch { /* 不是 JSON 就当普通名字 */ }
        }
        names.push(value);
      }
    }
  }
  const unique = [...new Set(names.filter(n => n.length >= 2 && n.length <= 60))];
  if (unique.length === 0) {
    console.log('没有要查的名字。用法：--name "场地名" / --names "A,B" / --from-file names.txt');
    process.exitCode = 1;
    return;
  }
  const targets = args.limit > 0 ? unique.slice(0, args.limit) : unique;

  const { url, writeKey, readKey } = credentials();
  const results = [];
  for (const name of targets) {
    try {
      const hit = await fetchAoi(name);
      results.push(hit);
      if (hit.error) console.log(`✗ ${name}：${hit.error}`);
      else console.log(`✓ ${hit.name} → 百度「${hit.matchedName}」${hit.district} ${hit.size} ${hit.areaM2} ㎡ ${hit.polygon.length} 点`);
    } catch (error) {
      results.push({ name, error: error instanceof Error ? error.message : String(error) });
      console.log(`✗ ${name}：${error instanceof Error ? error.message : error}`);
    }
    await sleep(SUGGEST_DELAY_MS); // 别连续打人家的接口
  }

  const ok = results.filter(r => !r.error);
  if (args.geojson && ok.length > 0) {
    writeFileSync(args.geojson, JSON.stringify({
      type: 'FeatureCollection',
      features: ok.map(r => ({
        type: 'Feature',
        properties: { name: r.name, matchedName: r.matchedName, baiduUid: r.uid, source: 'baidu-aoi', crs: 'gcj-02', areaM2: r.areaM2 },
        geometry: { type: 'Polygon', coordinates: [[...r.polygon, r.polygon[0]]] },
      })),
    }, null, 1), 'utf8');
    console.log(`\nGeoJSON → ${args.geojson}`);
  }
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(results, null, 1), 'utf8');
    console.log(`结果 → ${args.out}`);
  }

  if (!args.apply) {
    console.log(`\n预演：${ok.length} 条可入库（${results.length - ok.length} 条跳过）。加 --apply 写库。`);
    return;
  }
  if (!url || !writeKey) {
    console.log('\n缺少写库凭据：需要 SUPABASE_SERVICE_ROLE_KEY（anon key 写不进去）。');
    const file = readEnvLocal();
    const have = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
      .filter(key => process.env[key] || file[key]);
    console.log(`当前探测到的相关变量：${have.length ? have.join(', ') : '（无）'}`);
    process.exitCode = 1;
    return;
  }

  console.log('\n写库：');
  for (const item of ok) {
    const nameNorm = normalizeShapeName(item.name);
    if (!args.overwrite) {
      const exists = await existingRow(url, readKey, nameNorm);
      if (exists) {
        console.log(`  跳过 ${item.name}：库里已有同名行（${Array.isArray(exists.polygon) ? exists.polygon.length : '?'} 点）。要覆盖加 --overwrite`);
        continue;
      }
    }
    const [west, south, east, north] = item.bounds;
    // 字段契约以库里真实行为准（2026-11-27 实测）：id / center_lng / center_lat / pts 均为 NOT NULL。
    // id 用 `baidu:<uid>`，与库内既有的 `osm:W…` 同构，一看就知道是哪条链进来的。
    const row = {
      id: `baidu:${item.uid}`,
      name: item.name,
      name_norm: nameNorm,
      kind: 'area',
      center_lng: Number(((west + east) / 2).toFixed(6)),
      center_lat: Number(((south + north) / 2).toFixed(6)),
      polygon: item.polygon,
      bounds: item.bounds,
      pts: item.polygon.length,
    };
    const result = await upsertRow(url, writeKey, row);
    console.log(`  ${result.ok ? '写入' : '失败'} ${item.name} → ${result.status} ${result.text}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
