// 人物 GLB 批压缩：meshopt + KHR_mesh_quantization + WebP 贴图 + 动画重采样。
// 试点实测：41–45 MB → 2.4–2.7 MB（约 −94%），骨骼/两个 clip/贴图均保留，真浏览器 glError=0。
//
// 用法：
//   node tools/aholo/compress-people.mjs --out .cache/aholo/compressed            # 压 .cache/aholo 下所有 >10 MB 人物
//   node tools/aholo/compress-people.mjs --out DIR --id <assetId> [--id ...]      # 只压指定资产
//   node tools/aholo/compress-people.mjs --out DIR --texture-size 512             # 贴图再降一档
//
// 产物仍是标准 GLB；前端 glb-assets.ts 已挂 MeshoptDecoder，未压缩资产照常可读。
// 上云后记得同步 R2 people/<assetId>.glb，并按需下调 LOCAL_WALK_MAX_FILE_BYTES。
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const ids = args.reduce((list, value, index) => (value === '--id' && args[index + 1] ? [...list, args[index + 1]] : list), []);
const outDir = option('out', '.cache/aholo/compressed');
const srcDir = option('from', '.cache/aholo');
const textureSize = option('texture-size', '1024');
const minBytes = Number(option('min-mb', '10')) * 1024 * 1024;
const cli = option('cli', '@gltf-transform/cli@4.5.1');
const dryRun = args.includes('--dry-run');

const files = ids.length
  ? ids.map(id => join(srcDir, `${id}.glb`))
  : readdirSync(srcDir)
      .filter(name => name.toLowerCase().endsWith('.glb'))
      .map(name => join(srcDir, name))
      .filter(path => statSync(path).size >= minBytes);

if (!files.length) {
  console.error(`没有找到待压缩的 GLB（来源 ${srcDir}，门槛 ${minBytes / 1048576} MB）。`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const rows = [];
for (const file of files) {
  const before = statSync(file).size;
  const target = join(outDir, basename(file));
  if (dryRun) {
    rows.push({ file: basename(file), before, after: null, note: 'dry-run' });
    continue;
  }
  const started = Date.now();
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    '--yes', cli, 'optimize', file, target,
    '--compress', 'meshopt',
    '--texture-compress', 'webp',
    '--texture-size', textureSize,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  const after = statSync(target).size;
  rows.push({ file: basename(file), before, after, saved: +(1 - after / before).toFixed(4), ms: Date.now() - started });
}

for (const row of rows) {
  const mb = bytes => (bytes / 1048576).toFixed(2);
  console.log(row.after === null
    ? `${row.file}  ${mb(row.before)} MB  → (dry-run)`
    : `${row.file}  ${mb(row.before)} MB → ${mb(row.after)} MB  (−${(row.saved * 100).toFixed(1)}%, ${row.ms} ms)  → ${join(outDir, row.file)}`);
}
const totalBefore = rows.reduce((sum, row) => sum + row.before, 0);
const totalAfter = rows.reduce((sum, row) => sum + (row.after ?? row.before), 0);
if (rows.every(row => row.after !== null)) {
  console.log(`合计 ${(totalBefore / 1048576).toFixed(1)} MB → ${(totalAfter / 1048576).toFixed(1)} MB（−${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%）`);
}
