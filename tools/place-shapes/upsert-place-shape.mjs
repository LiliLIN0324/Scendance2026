#!/usr/bin/env node
/**
 * 把「人工描边」的场地轮廓写进 place_shapes 表，让它在产品里和 in77 一样：
 * 搜索地名 → 出描边（服务端 lookupPlaceStock 优先于 OSM 挖掘，命中即返回）。
 *
 * 为什么需要这个脚本：产品里能出描边的来源只有两处——OSM 面要素（`/api/place-shape`
 * 的 photon/Overpass 链路）与这张 place_shapes 表。西湖景区的酒店在 OSM 里几乎没有
 * 面数据（实测：花家山庄周边 1km 内 0 个有名要素；湖滨银泰 in77 有 8 个），
 * 所以只能由我们描一次、存进表里。表里存的是真实描边，不是占位矩形。
 *
 * 用法：
 *   node tools/place-shapes/upsert-place-shape.mjs                      # 预演，只打印将要写入什么
 *   node tools/place-shapes/upsert-place-shape.mjs --file x.json        # 指定数据文件
 *   node tools/place-shapes/upsert-place-shape.mjs --apply              # 真写库
 *   node tools/place-shapes/upsert-place-shape.mjs --apply --verify-only # 只回读校验线上
 *
 * 直接从产品导出的 GeoJSON 取边界（不用手抄点列）：
 *   node tools/place-shapes/upsert-place-shape.mjs \
 *     --from-geojson ~/Downloads/site-plan-2026-11-20.geojson --name "杭州花家山庄" --append
 *   --append 会把取到的边界写回 venues.json 对应场地，之后可 --apply。
 *
 * GeoJSON 口径：产品「导出 → GeoJSON」里 properties.kind=boundary 的 Polygon，
 * 坐标已是 [lng, lat] 且与锚点同基准（GCJ-02），首尾闭合会自动去掉重复点。
 *
 * 数据文件：见同目录 venues.json。polygon 用 GCJ-02 的 [lng, lat] 点列，首尾不必重复，
 * 与服务端输出同基准（SitePlanData.anchor 也是 GCJ-02）。
 *
 * 凭据只从环境变量或根 .env.local 读，不打印。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_SHAPE_URL = 'https://scendance-scene-planner-ewz.pages.dev/api/place-shape';

function parseArgs(argv) {
  const out = {
    apply: false,
    verifyOnly: false,
    append: false,
    file: resolve(ROOT, 'tools/place-shapes/venues.json'),
    geojson: '',
    name: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--verify-only') out.verifyOnly = true;
    else if (arg === '--append') out.append = true;
    else if (arg === '--file') out.file = resolve(process.cwd(), argv[++i] ?? '');
    else if (arg === '--from-geojson') out.geojson = resolve(process.cwd(), argv[++i] ?? '');
    else if (arg === '--name') out.name = String(argv[++i] ?? '').trim();
  }
  return out;
}

/**
 * 从产品导出的 GeoJSON 里取出用地边界：优先 properties.kind=boundary，
 * 否则取面积最大的 Polygon（导出里还有分区/墙体，不能误取小方块）。
 */
function boundaryFromGeoJson(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const features = Array.isArray(data?.features) ? data.features : [];
  const polygons = features.filter(feature => feature?.geometry?.type === 'Polygon' && Array.isArray(feature.geometry.coordinates?.[0]));
  if (polygons.length === 0) throw new Error('GeoJSON 里没有 Polygon：是不是没先画用地边界？');
  const boundary = polygons.find(feature => String(feature?.properties?.kind ?? '') === 'boundary');
  const ringOf = feature => (feature.geometry.coordinates[0] ?? [])
    .map(point => [Number(point?.[0]), Number(point?.[1])])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  const ring = ringOf(boundary ?? polygons.sort((a, b) => ringOf(b).length - ringOf(a).length)[0]);
  const first = ring[0]; const last = ring[ring.length - 1];
  const open = first && last && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  if (open.length < 3) throw new Error(`取到的边界只有 ${open.length} 个点，不够围成一块地`);
  return open;
}

/** 与服务端 normalizeShapeName 完全一致（functions/api/place-shape.ts）。 */
function normalizeShapeName(value) {
  return String(value ?? '').toLowerCase().replace(/[\s\u3000·．.,，()（）\-—_/]+/g, '');
}

function readEnvLocal() {
  const env = {};
  for (const name of ['.env.local', '.env']) {
    try {
      const text = readFileSync(resolve(ROOT, name), 'utf8');
      for (const line of text.split(/\r?\n/)) {
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
  const url = pick('SUPABASE_URL') || pick('NEXT_PUBLIC_SUPABASE_URL');
  const key = pick('SUPABASE_SERVICE_ROLE_KEY') || pick('NEXT_PUBLIC_SUPABASE_ANON_KEY') || pick('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  return { url: url ? url.replace(/\/$/, '') : '', key };
}

function meterBox(polygon) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const latMid = (north + south) / 2;
  return {
    bounds: [west, south, east, north],
    widthM: Math.round((east - west) * 111320 * Math.cos((latMid * Math.PI) / 180)),
    depthM: Math.round((north - south) * 110540),
  };
}

function validate(venue) {
  const name = String(venue.name ?? '').trim();
  if (!name) return '缺少 name';
  const polygon = Array.isArray(venue.polygon) ? venue.polygon : [];
  if (polygon.length < 3) return 'polygon 少于 3 点（还没描边？）';
  for (const point of polygon) {
    if (!Array.isArray(point) || point.length < 2) return 'polygon 点格式应为 [lng, lat]';
    const [lng, lat] = point.map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return 'polygon 点含非数字';
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return 'polygon 点超出经纬度范围';
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let data = null;

  // 路径 A：从产品导出的 GeoJSON 直接取边界，顺手写回 venues.json（--append）。
  if (args.geojson) {
    if (!args.name) throw new Error('--from-geojson 需要配 --name（场地名，与 venues.json 里一致）');
    const polygon = boundaryFromGeoJson(args.geojson);
    data = JSON.parse(readFileSync(args.file, 'utf8'));
    const venues = Array.isArray(data) ? data : data.venues;
    if (!Array.isArray(venues)) throw new Error('数据文件里没有 venues 数组');
    const target = venues.find(venue => normalizeShapeName(venue.name) === normalizeShapeName(args.name));
    if (!target) throw new Error(`venues.json 里没有「${args.name}」，先在文件里加一条（name/address/drawWhat）`);
    target.polygon = polygon.map(([lng, lat]) => [Number(lng.toFixed(7)), Number(lat.toFixed(7))]);
    if (args.append) {
      writeFileSync(args.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      console.log(`已写回 ${args.file}：${target.name} ${polygon.length} 点`);
    } else {
      console.log(`取到 ${target.name} 边界 ${polygon.length} 点（本次直接用，不落盘；要写回文件加 --append）`);
    }
  }

  data = data ?? JSON.parse(readFileSync(args.file, 'utf8'));
  const venues = Array.isArray(data) ? data : data.venues;
  if (!Array.isArray(venues)) throw new Error('数据文件里没有 venues 数组');

  const ready = [];
  for (const venue of venues) {
    const problem = validate(venue);
    const name = String(venue.name ?? '').trim();
    if (problem) {
      console.log(`跳过 ${name || '(无名)'}：${problem}`);
      continue;
    }
    const polygon = venue.polygon.map(([lng, lat]) => [Number(Number(lng).toFixed(6)), Number(Number(lat).toFixed(6))]);
    const { bounds, widthM, depthM } = meterBox(polygon);
    ready.push({
      row: {
        name,
        name_norm: normalizeShapeName(name),
        kind: 'area',
        polygon,
        bounds: bounds.map(value => Number(value.toFixed(6))),
      },
      near: `${((bounds[0] + bounds[2]) / 2).toFixed(6)},${((bounds[1] + bounds[3]) / 2).toFixed(6)}`,
      size: `${widthM}×${depthM} m`,
    });
  }

  if (ready.length === 0) {
    console.log('没有可写入的场地：先把 polygon 填上（在产品里画完边界后复制点列）。');
    return;
  }

  const { url, key } = credentials();
  if (!args.verifyOnly && (!url || !key)) {
    console.log('缺少 Supabase 凭据：请在环境变量或 .env.local 里配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY。');
    console.log(`本次本可写入 ${ready.length} 条：`);
    for (const item of ready) console.log(`  - ${item.row.name}  ${item.size}  ${item.row.polygon.length} 点  name_norm=${item.row.name_norm}`);
    process.exitCode = 1;
    return;
  }

  if (!args.apply && !args.verifyOnly) {
    console.log(`预演（不会写库）：${ready.length} 条`);
    for (const item of ready) {
      console.log(`  - ${item.row.name}  ${item.size}  ${item.row.polygon.length} 点`);
      console.log(`    name_norm=${item.row.name_norm}`);
      console.log(`    bounds=${JSON.stringify(item.row.bounds)}`);
    }
    console.log('\n确认无误后加 --apply 真正写入。');
    return;
  }

  if (args.apply) {
    for (const item of ready) {
      const endpoint = `${url}/rest/v1/place_shapes?on_conflict=name_norm`;
      const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      };
      let response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(item.row) });
      if (!response.ok && response.status === 409) {
        // 没有 name_norm 唯一索引时退回「先删同名再插」
        await fetch(`${url}/rest/v1/place_shapes?name_norm=eq.${encodeURIComponent(item.row.name_norm)}`, {
          method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        response = await fetch(`${url}/rest/v1/place_shapes`, { method: 'POST', headers, body: JSON.stringify(item.row) });
      }
      const text = await response.text();
      console.log(`${response.ok ? '写入' : '失败'} ${item.row.name} → ${response.status} ${text.slice(0, 160)}`);
    }
  }

  // 回读：走线上公开接口，确认产品侧真的能拿到描边（不是只看数据库）
  console.log('\n线上回读（/api/place-shape）：');
  for (const item of ready) {
    const probe = `${PUBLIC_SHAPE_URL}?name=${encodeURIComponent(item.row.name)}&near=${item.near}`;
    try {
      const response = await fetch(probe, { signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      const shape = body?.shape;
      console.log(`  ${item.row.name} → ${shape ? `有描边 ${shape.id} ${shape.polygon?.length ?? 0} 点` : '仍是 null'}`);
    } catch (error) {
      console.log(`  ${item.row.name} → 回读失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
