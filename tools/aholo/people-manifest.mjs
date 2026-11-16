// 生成人物资产清单（people-manifest.json），供前端 parsePeopleAssetManifest 消费。
//
// 路径约定（刻意保持向后兼容）：
//   LOD0 / hero → people/<assetId>.glb      （覆盖现有 URL，老客户端不改也能拿到高清压缩版）
//   LOD1 / far  → people/lod1/<assetId>.glb （新路径，只给按档位取模型的调用方）
//
// hash 用文件内容的 sha256：资产换了 hash 就变，前端缓存键随之失效。
// bytes 一律用**压缩后**的真实字节数，前端据此比较体积阈值。
//
// 用法：
//   node tools/aholo/people-manifest.mjs --hero .cache/aholo/hero --far .cache/aholo/far
//   node tools/aholo/people-manifest.mjs --hero DIR --out .cache/aholo/people-manifest.json --base https://pub-xxx.r2.dev
//   node tools/aholo/people-manifest.mjs --check .cache/aholo/people-manifest.json   # 只校验已有清单
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_BASE = 'https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev';
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const heroDir = option('hero', '.cache/aholo/hero');
const farDir = option('far', '.cache/aholo/far');
const outFile = option('out', '.cache/aholo/people-manifest.json');
const base = option('base', DEFAULT_BASE).replace(/\/+$/, '');
const checkTarget = args.includes('--check') ? args[args.indexOf('--check') + 1] : null;

/** 目录里的 <assetId>.glb → Map<assetId, path>；找不到目录就当没有这一档。 */
function collect(dir) {
  const map = new Map();
  if (!dir || !existsSync(dir)) return map;
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.glb')) continue;
    map.set(name.slice(0, -4), join(dir, name));
  }
  return map;
}

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const bytes = path => statSync(path).size;
const peopleUrl = assetId => `${base}/people/${assetId}.glb`;
const farUrl = assetId => `${base}/people/lod1/${assetId}.glb`;

/** 清单不变式：与前端 parsePeopleAssetManifest 的拒绝条件保持同一条线。 */
function validate(manifest) {
  const problems = [];
  if (manifest.version !== 1) problems.push(`version 必须是 1，实际 ${manifest.version}`);
  const assets = manifest.assets ?? {};
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) problems.push('assets 必须是对象');
  for (const [assetId, entry] of Object.entries(assets)) {
    if (!assetId.trim()) problems.push('存在空 assetId');
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) problems.push(`${assetId}: bytes 必须是正整数`);
    if (!entry.hash?.trim()) problems.push(`${assetId}: 缺少 hash`);
    if (entry.lods !== undefined) {
      const levels = new Set();
      for (const lod of entry.lods) {
        if (!Number.isInteger(lod.level) || lod.level < 0) problems.push(`${assetId}: LOD level 非法`);
        if (levels.has(lod.level)) problems.push(`${assetId}: LOD level ${lod.level} 重复`);
        levels.add(lod.level);
        if (!lod.url?.trim()) problems.push(`${assetId}: LOD ${lod.level} 缺少 url`);
        if (!Number.isInteger(lod.bytes) || lod.bytes <= 0) problems.push(`${assetId}: LOD ${lod.level} bytes 非法`);
      }
    }
  }
  return problems;
}

if (checkTarget) {
  if (!existsSync(checkTarget)) {
    console.error(`清单不存在：${checkTarget}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(checkTarget, 'utf8'));
  const problems = validate(manifest);
  if (problems.length) {
    console.error(`清单校验失败（${problems.length} 项）：`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const count = Object.keys(manifest.assets ?? {}).length;
  console.log(`清单校验通过：${count} 个资产，version=${manifest.version}`);
  process.exit(0);
}

const hero = collect(heroDir);
const far = collect(farDir);
const assetIds = [...new Set([...hero.keys(), ...far.keys()])].sort();
if (!assetIds.length) {
  console.error(`两档目录都没有 GLB（hero=${heroDir}，far=${farDir}）。先跑 compress-people.mjs。`);
  process.exit(1);
}

const assets = {};
for (const assetId of assetIds) {
  const lods = [];
  const heroPath = hero.get(assetId);
  const farPath = far.get(assetId);
  // level 0 优先取 hero；只有 far 时把它当唯一档位（不虚构不存在的档）。
  if (heroPath) lods.push({ level: 0, url: peopleUrl(assetId), bytes: bytes(heroPath) });
  if (farPath) lods.push({ level: 1, url: farUrl(assetId), bytes: bytes(farPath) });
  const anchor = heroPath ?? farPath;
  assets[assetId] = {
    bytes: bytes(anchor),
    hash: sha256(anchor),
    ...(lods.length > 1 ? { lods } : {}),
  };
}

const manifest = { version: 1, assets };
const problems = validate(manifest);
if (problems.length) {
  console.error('生成的清单不合规：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

mkdirSync(dirname(resolve(outFile)), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`清单已写入 ${outFile}：${assetIds.length} 个资产`);
for (const assetId of assetIds) {
  const entry = assets[assetId];
  const tiers = entry.lods ? entry.lods.map(lod => `LOD${lod.level} ${(lod.bytes / 1048576).toFixed(2)} MB`).join(' + ') : `${(entry.bytes / 1048576).toFixed(2)} MB`;
  console.log(`  ${assetId}  ${tiers}  hash=${entry.hash.slice(0, 12)}…`);
}
