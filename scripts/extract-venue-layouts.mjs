import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * 把自有场地档案抽成结构化布局（2026-11-18）。
 *
 * 原则：**只抽文件里真有的几何，不补、不猜尺寸**。抽取不到的东西（人数、分区语义、
 * 物料类型）宁可留空并写进 caveats，也不填一个看起来合理的值。
 *
 * 覆盖 5 份来源：2 份 DXF（墙线 + 家具多段线 + 文字标注）、2 份 GeoJSON（WGS84
 * 真实经纬，前后两版）、1 份本地草稿交付 JSON（米制、场地中心为原点）。
 */

const root = process.cwd();
const archiveDir = path.join(root, 'deliverables', '幕景中国研究资料包_2026-11-18', '04_场地档案与演练');
const outDir = path.join(root, 'data', 'agent-corpus', 'venue-layouts');

const SOURCES = [
  { id: 'NINGBO-FUWUQU', name: '宁波货博会 · 服务区平面', type: 'dxf', file: '幕景宁波货博会_匿名服务区平面.dxf' },
  { id: 'HANGZHOU2-FIRST', name: '杭博二期 · 首层示意', type: 'dxf', file: '幕景杭博二期_匿名首层示意.dxf' },
  { id: 'YANGUAN-BEFORE', name: '盐官潮乐之城 · 布置前', type: 'geojson', file: '盐官潮乐之城_设计资料包/salt-layout-before.geojson' },
  { id: 'YANGUAN-AFTER', name: '盐官潮乐之城 · 布置后', type: 'geojson', file: '盐官潮乐之城_设计资料包/salt-layout-after.geojson' },
  { id: 'WUZHEN-AB', name: '乌镇 AB 馆 · 双空间布置', type: 'draft-json', file: '幕景乌镇AB馆_匿名双空间布置.json' },
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------
// DXF：按「0 组码 = 实体开始」切分，只取 ENTITIES 段
// ---------------------------------------------------------------------------

function decodeDxfText(value) {
  return value.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseDxf(text) {
  const lines = text.split(/\r?\n/);
  const entities = [];
  let index = lines.findIndex((line) => line.trim() === 'ENTITIES');
  if (index < 0) return entities;
  const end = lines.findIndex((line, at) => at > index && line.trim() === 'ENDSEC');
  const limit = end < 0 ? lines.length : end;

  let current = null;
  for (let i = index + 1; i < limit - 1; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1] ?? '';
    if (code === '0') {
      if (current) entities.push(current);
      current = { type: value.trim(), pairs: [] };
    } else if (current) {
      current.pairs.push({ code, value: value.trim() });
    }
  }
  if (current) entities.push(current);
  return entities;
}

function polylineVertices(entity) {
  const vertices = [];
  let pendingX = null;
  for (const pair of entity.pairs) {
    if (pair.code === '10') pendingX = Number(pair.value);
    if (pair.code === '20' && pendingX !== null) {
      vertices.push({ x: pendingX, y: Number(pair.value) });
      pendingX = null;
    }
  }
  return vertices;
}

function layerOf(entity) {
  return entity.pairs.find((pair) => pair.code === '8')?.value ?? '0';
}

function closedFlag(entity) {
  const flag = Number(entity.pairs.find((pair) => pair.code === '70')?.value ?? 0);
  return (flag & 1) === 1;
}

function bboxOf(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function areaOf(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function diagOf(box) {
  return Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
}

function extractDxf(text) {
  const entities = parseDxf(text);
  const texts = entities
    .filter((entity) => entity.type === 'TEXT' || entity.type === 'MTEXT')
    .map((entity) => {
      const x = Number(entity.pairs.find((pair) => pair.code === '10')?.value ?? 0);
      const y = Number(entity.pairs.find((pair) => pair.code === '20')?.value ?? 0);
      const raw = entity.pairs.find((pair) => pair.code === '1')?.value ?? '';
      return { text: decodeDxfText(raw), point: { x, y }, layer: layerOf(entity) };
    })
    .filter((item) => item.text.length > 0);

  const polylines = entities
    .filter((entity) => entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE')
    .map((entity) => ({ vertices: polylineVertices(entity), closed: closedFlag(entity), layer: layerOf(entity) }))
    .filter((item) => item.vertices.length >= 3);

  const wallPolys = polylines.filter((item) => item.layer.toUpperCase().includes('WALL'));
  const furniturePolys = polylines.filter((item) => !item.layer.toUpperCase().includes('WALL'));

  const boundaryPolygon = wallPolys.sort((a, b) => areaOf(b.vertices) - areaOf(a.vertices))[0]?.vertices ?? null;

  const facilities = furniturePolys.map((poly, index) => {
    const box = bboxOf(poly.vertices);
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const nearest = texts
      .map((item) => ({ ...item, distance: distance(item.point, center) }))
      .sort((a, b) => a.distance - b.distance)[0];
    const labelled = nearest && nearest.distance <= Math.max(1.5, diagOf(box));
    const name = labelled ? nearest.text : `未标注物料 ${index + 1}`;
    return {
      id: `F-${String(index + 1).padStart(2, '0')}`,
      templateId: mapNameToTemplate(name),
      name,
      position: { x: round2(center.x), y: round2(center.y) },
      rotationDeg: 0,
      size: { width: round2(box.maxX - box.minX), depth: round2(box.maxY - box.minY) },
      provenance: {
        source: 'dxf-polyline',
        layer: poly.layer,
        nameFrom: labelled ? `TEXT@${round2(nearest.point.x)},${round2(nearest.point.y)}` : null,
      },
    };
  });

  return {
    boundaryPolygon,
    facilities,
    zones: [],
    labels: texts.map((item) => ({ name: item.text, point: item.point, layer: item.layer })),
    caveats: [
      'DXF 只有墙线与家具轮廓，没有物料类型、数量与朝向语义；类型按名称关键字推断。',
      'DXF 没有人数、分区语义与出入口；观众密度、首排退距这类判据无法在此场地计算。',
    ],
  };
}

function mapNameToTemplate(name) {
  if (/桌|台/.test(name)) return 'table-1.2x0.6';
  if (/椅|凳/.test(name)) return 'chair-0.5x0.5';
  if (/展架|展板|架/.test(name)) return 'display-rack';
  if (/绿植|花/.test(name)) return 'plant-0.4x0.4';
  if (/签到/.test(name)) return 'sign-desk';
  return 'unclassified-item';
}

// ---------------------------------------------------------------------------
// GeoJSON：WGS84 经纬 → 本地米（等距圆柱近似）
// ---------------------------------------------------------------------------

function projectLngLat(lng, lat, origin) {
  const metersPerDegLat = 110540;
  const metersPerDegLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return { x: round2((lng - origin.lng) * metersPerDegLng), y: round2((lat - origin.lat) * metersPerDegLat) };
}

function extractGeoJson(text, origin) {
  const collection = JSON.parse(text);
  const facilities = [];
  const zones = [];
  const labels = [];
  const routes = [];
  const points = [];

  for (const feature of collection.features ?? []) {
    const properties = feature.properties ?? {};
    const geometry = feature.geometry ?? {};
    const kind = properties.kind;
    if (geometry.type === 'Point') {
      const [lng, lat] = geometry.coordinates;
      const point = projectLngLat(lng, lat, origin);
      points.push(point);
      if (kind === 'item') {
        facilities.push({
          id: `F-${String(facilities.length + 1).padStart(2, '0')}`,
          templateId: /导视|标识/.test(properties.name ?? '') ? 'signage-board' : 'unclassified-item',
          name: properties.name ?? '未命名物料',
          position: point,
          rotationDeg: Number(properties.angle ?? 0),
          size: { width: Number(properties.width ?? 0), depth: Number(properties.depth ?? 0) },
          provenance: { source: 'geojson-point', featureId: feature.id, status: properties.status ?? null },
        });
      } else {
        labels.push({ name: properties.name ?? '未命名标注', point, status: properties.status ?? null });
      }
    } else if (geometry.type === 'Polygon') {
      const ring = (geometry.coordinates[0] ?? []).map(([lng, lat]) => projectLngLat(lng, lat, origin));
      ring.forEach((point) => points.push(point));
      if (ring.length >= 4) {
        zones.push({
          id: `Z-${String(zones.length + 1).padStart(2, '0')}`,
          // 语义不从名字硬猜：签到区不是 audience/stage，硬映射会让判据算错。
          semantic: 'unknown',
          name: properties.name ?? '未命名区域',
          polygon: ring,
          provenance: { source: 'geojson-polygon', featureId: feature.id, kind },
        });
      }
    } else if (geometry.type === 'LineString') {
      const line = geometry.coordinates.map(([lng, lat]) => projectLngLat(lng, lat, origin));
      line.forEach((point) => points.push(point));
      routes.push({ name: properties.name ?? '未命名线', points: line, featureId: feature.id });
    }
  }

  const boundaryPolygon = points.length
    ? [
        { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) },
        { x: Math.max(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) },
        { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) },
        { x: Math.min(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) },
      ]
    : null;

  return {
    boundaryPolygon,
    facilities,
    zones,
    labels,
    routes,
    caveats: [
      'GeoJSON 是「策划演示」状态的布置，不是竣工图；边界由所有要素外接框推出，不是场地红线。',
      '区域语义保持 unknown：签到等候区不等于观众区，硬映射会让密度判据算错。',
      '没有人数、没有物料数量清单，判断不了容量；导视牌只有 0.7×0.5 m。',
    ],
  };
}

// ---------------------------------------------------------------------------
// 本地草稿交付 JSON：米制、场地中心为原点
// ---------------------------------------------------------------------------

function extractDraftJson(text) {
  const payload = JSON.parse(text);
  const floor = payload.layout?.floors?.[0];
  const width = Number(payload.layout?.width ?? 0);
  const height = Number(payload.layout?.height ?? 0);
  const facilities = (floor?.items ?? []).map((item, index) => ({
    id: item.id ?? `F-${index + 1}`,
    templateId: `draft:${item.type ?? 'unknown'}`,
    name: item.name ?? item.type ?? '未命名',
    position: { x: round2(item.position?.x ?? 0), y: round2(item.position?.z ?? 0) },
    rotationDeg: Math.round(((Number(item.rotation ?? 0) * 180) / Math.PI) * 10) / 10,
    size: { width: Number(item.width ?? 0), depth: Number(item.depth ?? 0) },
    provenance: { source: 'draft-json-item', type: item.type ?? null, category: item.category ?? null },
  }));
  return {
    boundaryPolygon:
      width > 0 && height > 0
        ? [
            { x: -width / 2, y: -height / 2 },
            { x: width / 2, y: -height / 2 },
            { x: width / 2, y: height / 2 },
            { x: -width / 2, y: height / 2 },
          ]
        : null,
    facilities,
    zones: [],
    labels: [],
    caveats: [
      `这是本地草稿（state=${payload.state ?? 'unknown'}），不是已核方案；场地 ${width}×${height} m 属室内工作坊量级。`,
      '草稿格式只记录物料与坐标，没有人数、分区语义与出入口。',
    ],
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// 执行器：跑一遍，看真实档案能支撑多少判据
// ---------------------------------------------------------------------------

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

const layouts = [];
for (const source of SOURCES) {
  const absolute = path.join(archiveDir, source.file);
  const buffer = readFileSync(absolute);
  const text = buffer.toString('utf8');
  let extracted;
  if (source.type === 'dxf') extracted = extractDxf(text);
  else if (source.type === 'geojson') {
    const polygons = [...text.matchAll(/\[\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)\s*\]/g)].map((match) => ({
      lng: Number(match[1]),
      lat: Number(match[2]),
    }));
    const origin = {
      lng: polygons.reduce((sum, item) => sum + item.lng, 0) / polygons.length,
      lat: polygons.reduce((sum, item) => sum + item.lat, 0) / polygons.length,
    };
    extracted = extractGeoJson(text, origin);
    extracted.coordinateTransform = {
      kind: 'equirectangular',
      origin,
      metersPerDegLat: 110540,
      metersPerDegLng: Number((111320 * Math.cos((origin.lat * Math.PI) / 180)).toFixed(1)),
    };
  } else extracted = extractDraftJson(text);

  const layout = {
    facilities: extracted.facilities,
    zones: extracted.zones,
    boundary: extracted.boundaryPolygon ?? undefined,
  };
  const evaluation = evaluateLayout(layout, rules);
  const counts = { pass: 0, violation: 0, skipped: 0, unsupported: 0 };
  for (const receipt of evaluation.receipts) counts[receipt.status] += 1;
  const skippedReasons = {};
  for (const receipt of evaluation.receipts.filter((item) => item.status === 'skipped')) {
    const key = receipt.reason ?? 'unknown';
    skippedReasons[key] = (skippedReasons[key] ?? 0) + 1;
  }

  layouts.push({
    id: source.id,
    name: source.name,
    sourceType: source.type,
    source: {
      path: path.relative(root, absolute).replace(/\\/g, '/'),
      bytes: statSync(absolute).size,
      sha256: sha256(buffer),
    },
    boundarySource:
      source.type === 'dxf'
        ? 'walls-polyline（图层 WALLS 的闭合多段线，不是用地红线）'
        : source.type === 'geojson'
          ? 'bbox-of-features（所有要素外接框）'
          : 'layout-envelope（草稿的 width×height 范围）',
    coordinateTransform: extracted.coordinateTransform ?? { kind: 'local-meters', origin: 'file' },
    layout,
    labels: extracted.labels ?? [],
    routes: extracted.routes ?? [],
    counts: {
      facilities: layout.facilities.length,
      zones: (layout.zones ?? []).length,
      boundaryVertices: layout.boundary?.length ?? 0,
      labels: (extracted.labels ?? []).length,
      routes: (extracted.routes ?? []).length,
    },
    evaluation: {
      totals: counts,
      computed: evaluation.receipts
        .filter((item) => item.status === 'pass' || item.status === 'violation')
        .map((item) => ({ ruleId: item.ruleId, status: item.status, actual: item.actual, expected: item.expected })),
      skippedReasons,
    },
    caveats: extracted.caveats,
  });
}

const payload = {
  schemaVersion: 1,
  generatedAt: '2026-11-18',
  generator: 'scripts/extract-venue-layouts.mjs',
  policy:
    '只抽文件里真有的几何：DXF 取墙线与家具轮廓，GeoJSON 做 WGS84→米投影，草稿 JSON 直取坐标。抽取不到的人数、分区语义、物料清单留空并写进 caveats，不补不猜。',
  rulesTotal: rules.length,
  layouts,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'layouts.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const header = ['id', 'source_type', 'facilities', 'zones', 'boundary_vertices', 'labels', 'pass', 'violation', 'skipped', 'unsupported'];
const rows = layouts.map((item) => [
  item.id,
  item.sourceType,
  item.counts.facilities,
  item.counts.zones,
  item.counts.boundaryVertices,
  item.counts.labels,
  item.evaluation.totals.pass,
  item.evaluation.totals.violation,
  item.evaluation.totals.skipped,
  item.evaluation.totals.unsupported,
]);
writeFileSync(
  path.join(outDir, 'coverage.csv'),
  `${[header, ...rows].map((row) => row.join(',')).join('\n')}\n`,
  'utf8',
);

console.log(`venue-layouts: ${layouts.length} 份`);
for (const item of layouts) {
  const c = item.evaluation.totals;
  console.log(
    `${item.id.padEnd(18)} ${item.sourceType.padEnd(11)} 设施 ${String(item.counts.facilities).padStart(2)} 区 ${item.counts.zones} 标注 ${String(item.counts.labels).padStart(2)} | pass ${c.pass} violation ${c.violation} skipped ${c.skipped} unsupported ${c.unsupported}`,
  );
  if (item.evaluation.computed.length > 0) {
    for (const row of item.evaluation.computed) console.log(`   · ${row.ruleId} ${row.status}：${row.actual}`);
  }
}
