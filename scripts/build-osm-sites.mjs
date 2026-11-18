import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * 用 OSM 真实建筑轮廓造「可判场地」（2026-11-18）。
 *
 * 输入是 Overpass 导出的原始 JSON（data/agent-corpus/sites/raw/*.json），
 * 不是实时请求——网络拉取与数据加工分开，拉到什么就加工什么，可复现。
 *
 * 输出两份：
 * 1) sites/<id>.json：建筑轮廓、外接框、面积、原点与投影参数、ODbL 归属；
 * 2) sites/<id>-check.json：把真实建筑当 obstacles、把已有真实坐标布局当 facilities，
 *    跑一遍执行器，记录哪些判据第一次有了真实数据可算。
 */

const root = process.cwd();
const sitesDir = path.join(root, 'data', 'agent-corpus', 'sites');
const rawDir = path.join(sitesDir, 'raw');

/** 场地配置：原点必须与已有真实坐标布局一致，否则两套坐标不能叠。 */
const SITES = [
  {
    id: 'yanguan',
    name: '盐官潮乐之城 · 签到接驳区（OSM 建筑轮廓）',
    raw: 'yanguan-overpass.json',
    radiusM: 120,
    endpoint: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    query: '[out:json][timeout:60];(way["building"](around:120,30.4122558,120.5368897););out geom;',
    origin: { lng: 120.53691316952109, lat: 30.41230517388013, metersPerDegLat: 110540, metersPerDegLng: 96002.9 },
    layoutRef: { file: 'data/agent-corpus/venue-layouts/layouts.json', id: 'YANGUAN-AFTER' },
  },
];

function project(lng, lat, origin) {
  return {
    x: round2((lng - origin.lng) * origin.metersPerDegLng),
    y: round2((lat - origin.lat) * origin.metersPerDegLat),
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function ringArea(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function closeRing(points) {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) return points;
  return [...points, { ...first }];
}

function loadEvaluator() {
  const tempDir = path.join(root, '.temp', 'agent-corpus-runtime');
  mkdirSync(tempDir, { recursive: true });
  const require = createRequire(import.meta.url);
  const tsModule = require('typescript');
  const transpile = (file) => {
    const source = readFileSync(path.join(root, 'frontend', 'lib', 'agent-corpus', file), 'utf8');
    const output = tsModule.transpileModule(source, {
      compilerOptions: { module: tsModule.ModuleKind.ESNext, target: tsModule.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText;
    const target = path.join(tempDir, file.replace(/\.ts$/, '.mjs'));
    writeFileSync(target, output.replace(/from '\.\/geometry'/g, "from './geometry.mjs'"), 'utf8');
    return target;
  };
  transpile('geometry.ts');
  return import(pathToFileURL(transpile('evaluate.ts')).href);
}

const { evaluateLayout } = await loadEvaluator();
const rules = JSON.parse(readFileSync(path.join(root, 'data', 'agent-corpus', 'layout-assertions.json'), 'utf8')).rules;

mkdirSync(sitesDir, { recursive: true });

for (const site of SITES) {
  const rawPath = path.join(rawDir, site.raw);
  // PowerShell 5.1 写的 UTF-8 会带 BOM，先剥掉再解析。
  const rawText = readFileSync(rawPath, 'utf8').replace(/^\uFEFF/, '');
  const raw = JSON.parse(rawText);
  const overpassCopyright = raw.osm3s?.copyright ?? '';
  if (!/openstreetmap\.org/.test(overpassCopyright) || !/ODbL/.test(overpassCopyright)) {
    throw new Error(`来源声明缺失或不是 ODbL：${site.raw}；不得输出无归属的 OSM 数据`);
  }

  const buildings = (raw.elements ?? [])
    .filter((element) => element.type === 'way' && Array.isArray(element.geometry))
    .map((element) => {
      const polygon = closeRing(element.geometry.map((point) => project(point.lon, point.lat, site.origin)));
      const xs = polygon.map((point) => point.x);
      const ys = polygon.map((point) => point.y);
      return {
        osmId: element.id,
        osmType: element.type,
        tags: element.tags ?? {},
        polygon,
        bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
        areaM2: round2(ringArea(polygon)),
      };
    })
    .filter((building) => building.polygon.length >= 4 && building.areaM2 > 0);

  const allXs = buildings.flatMap((building) => building.polygon.map((point) => point.x));
  const allYs = buildings.flatMap((building) => building.polygon.map((point) => point.y));
  const payload = {
    schemaVersion: 1,
    generatedAt: '2026-11-18',
    generator: 'scripts/build-osm-sites.mjs',
    site: { id: site.id, name: site.name },
    license: {
      name: 'ODbL 1.0',
      attribution: '© OpenStreetMap contributors',
      source: 'https://www.openstreetmap.org',
      notice: '建筑轮廓来自 OSM，按 ODbL 使用；再分发需保留归属与相同许可。',
    },
    query: {
      endpoint: site.endpoint,
      query: site.query,
      radiusM: site.radiusM,
      osmBaseTimestamp: raw.osm3s?.timestamp_osm_base ?? null,
      rawFile: `data/agent-corpus/sites/raw/${site.raw}`,
    },
    origin: { ...site.origin, kind: 'equirectangular' },
    buildings,
    stats: {
      buildingCount: buildings.length,
      totalFootprintM2: round2(buildings.reduce((sum, building) => sum + building.areaM2, 0)),
      extentM: buildings.length
        ? { width: round2(Math.max(...allXs) - Math.min(...allXs)), height: round2(Math.max(...allYs) - Math.min(...allYs)) }
        : null,
    },
  };
  writeFileSync(path.join(sitesDir, `${site.id}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  // 真实坐标布局 + 真实建筑 → 跑一遍
  const layoutFile = path.join(root, site.layoutRef.file);
  const layouts = JSON.parse(readFileSync(layoutFile, 'utf8')).layouts;
  const source = layouts.find((item) => item.id === site.layoutRef.id);
  if (!source) throw new Error(`找不到布局：${site.layoutRef.id}`);

  const layout = {
    facilities: source.layout.facilities,
    zones: source.layout.zones,
    nodes: source.layout.nodes,
    boundary: source.layout.boundary,
    obstacles: buildings.map((building) => ({
      id: `osm-way-${building.osmId}`,
      kind: 'building',
      name: building.tags.name ?? `OSM 建筑 ${building.osmId}`,
      polygon: building.polygon,
    })),
  };

  const evaluation = evaluateLayout(layout, rules);
  const counts = { pass: 0, violation: 0, skipped: 0, unsupported: 0 };
  for (const receipt of evaluation.receipts) counts[receipt.status] += 1;
  const computed = evaluation.receipts
    .filter((receipt) => receipt.status === 'pass' || receipt.status === 'violation')
    .map((receipt) => ({
      ruleId: receipt.ruleId,
      status: receipt.status,
      actual: receipt.actual,
      expected: receipt.expected,
      objectIds: receipt.objectIds,
    }));

  const check = {
    schemaVersion: 1,
    generatedAt: '2026-11-18',
    generator: 'scripts/build-osm-sites.mjs',
    siteId: site.id,
    layoutRef: site.layoutRef,
    inputs: {
      facilities: layout.facilities.length,
      zones: (layout.zones ?? []).length,
      buildings: buildings.length,
      coordinateSystem: 'local-meters（与 venue-layouts 同一原点）',
      facilityProvenance: '来自盐官 GeoJSON 的真实经纬（策划演示状态）',
      obstacleProvenance: '来自 OSM 建筑轮廓（ODbL）',
    },
    counts,
    computed,
    note:
      computed.length === 0
        ? '仍然没有判据可算：检查设施与建筑是否落在同一坐标系。'
        : '首次有判据在真实数据上算出结果；这是判据可执行性的证据，不是对场地的合规认定。',
  };
  writeFileSync(path.join(sitesDir, `${site.id}-check.json`), `${JSON.stringify(check, null, 2)}\n`, 'utf8');

  console.log(`${site.id}: 建筑 ${buildings.length} 栋，占地 ${payload.stats.totalFootprintM2} ㎡`);
  console.log(`  执行器：pass ${counts.pass} / violation ${counts.violation} / skipped ${counts.skipped} / unsupported ${counts.unsupported}`);
  for (const row of computed) console.log(`  · ${row.ruleId} ${row.status}：${row.actual}（要求 ${row.expected}）`);
}

const produced = readdirSync(sitesDir).filter((file) => file.endsWith('.json'));
console.log(`sites 产物：${produced.join(', ')}`);
