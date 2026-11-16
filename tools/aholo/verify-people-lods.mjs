// 两档 LOD 对照校验：原始 vs hero vs far。
//
// 验收标准（不满足就是压坏了，必须重压，不能硬传）：
//   hero：三角面、关节数、clip 名与原始**完全一致**（只允许贴图格式/体积变化）
//   far ：关节数、clip 名一致；三角面 ≤ 原始（可以削，但不能削没）
//
// 用法：node tools/aholo/verify-people-lods.mjs --src .cache/aholo --hero .cache/aholo/hero --far .cache/aholo/far
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const srcDir = option('src', '.cache/aholo');
const heroDir = option('hero', '.cache/aholo/hero');
const farDir = option('far', '.cache/aholo/far');

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

function readGlb(path) {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error(`${path} 不是 GLB`);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error(`${path} 缺少 JSON chunk`);
  const json = JSON.parse(new TextDecoder()
    .decode(new Uint8Array(buffer.buffer, buffer.byteOffset + 20, jsonLength))
    .replace(/[\0\s]+$/, ''));
  const accessors = json.accessors ?? [];
  const triangles = (json.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives ?? []).reduce((inner, primitive) => {
    const indexAccessor = primitive.indices !== undefined ? accessors[primitive.indices] : undefined;
    if (indexAccessor?.count) return inner + Math.floor(indexAccessor.count / 3);
    return inner + Math.floor((accessors[primitive.attributes?.POSITION]?.count ?? 0) / 3);
  }, 0), 0);
  const skins = json.skins ?? [];
  return {
    bytes: buffer.byteLength,
    triangles,
    joints: skins.length ? (skins[0].joints ?? []).length : 0,
    clips: (json.animations ?? []).map(animation => animation.name ?? '(unnamed)').sort(),
    required: json.extensionsRequired ?? [],
  };
}

const listGlb = dir => (existsSync(dir) ? readdirSync(dir).filter(name => name.toLowerCase().endsWith('.glb')) : []).sort();
const assetIds = listGlb(srcDir).map(name => name.slice(0, -4));

const problems = [];
const rows = [];
for (const assetId of assetIds) {
  const src = join(srcDir, `${assetId}.glb`);
  const heroPath = join(heroDir, `${assetId}.glb`);
  const farPath = join(farDir, `${assetId}.glb`);
  const base = readGlb(src);
  const hero = existsSync(heroPath) ? readGlb(heroPath) : null;
  const far = existsSync(farPath) ? readGlb(farPath) : null;

  if (!hero) problems.push(`${assetId}: 缺 hero 档`);
  if (!far) problems.push(`${assetId}: 缺 far 档`);
  if (hero) {
    if (hero.triangles !== base.triangles) problems.push(`${assetId}: hero 三角面 ${hero.triangles} ≠ 原始 ${base.triangles}（削面了）`);
    if (hero.joints !== base.joints) problems.push(`${assetId}: hero 关节 ${hero.joints} ≠ 原始 ${base.joints}`);
    if (hero.clips.join('|') !== base.clips.join('|')) problems.push(`${assetId}: hero clip [${hero.clips}] ≠ 原始 [${base.clips}]`);
    if (!hero.required.includes('EXT_meshopt_compression')) problems.push(`${assetId}: hero 未使用 meshopt（没压）`);
  }
  if (far) {
    if (far.joints !== base.joints) problems.push(`${assetId}: far 关节 ${far.joints} ≠ 原始 ${base.joints}`);
    if (far.clips.join('|') !== base.clips.join('|')) problems.push(`${assetId}: far clip [${far.clips}] ≠ 原始 [${base.clips}]`);
    if (far.triangles > base.triangles) problems.push(`${assetId}: far 三角面 ${far.triangles} > 原始 ${base.triangles}`);
  }
  rows.push({
    assetId: assetId.slice(0, 8) + '…' + assetId.slice(-4),
    srcMb: +(base.bytes / 1048576).toFixed(2),
    heroMb: hero ? +(hero.bytes / 1048576).toFixed(2) : 0,
    farMb: far ? +(far.bytes / 1048576).toFixed(2) : 0,
    tris: base.triangles,
    heroTris: hero?.triangles ?? 0,
    farTris: far?.triangles ?? 0,
    joints: base.joints,
    clips: base.clips.length,
  });
}

console.log(`资产 ${assetIds.length} 个`);
for (const row of rows) {
  console.log(`  ${row.assetId}  ${row.srcMb} → hero ${row.heroMb} MB / far ${row.farMb} MB · 三角面 ${row.tris}→${row.heroTris}/${row.farTris} · ${row.joints} 关节 · ${row.clips} clip`);
}

const sum = key => rows.reduce((total, row) => total + row[key], 0);
console.log(`\n合计：原始 ${sum('srcMb').toFixed(1)} MB → hero ${sum('heroMb').toFixed(1)} MB / far ${sum('farMb').toFixed(1)} MB`);

if (problems.length) {
  console.error(`\n校验失败 ${problems.length} 项：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`校验通过：${assetIds.length} 个资产的骨架与 clip 全部一致，hero 零削面。`);
}
