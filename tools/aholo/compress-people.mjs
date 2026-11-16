// 人物 GLB 批压缩：meshopt + KHR_mesh_quantization + WebP 贴图 + 动画重采样。
// 2026-11-16 接手（#131）：修 Windows + Node 20+ 的 spawn EINVAL，并增加两档预设。
//
// 用法：
//   node tools/aholo/compress-people.mjs --out .cache/aholo/compressed                 # 默认 far 档，压 .cache/aholo 下 >10 MB 的人物
//   node tools/aholo/compress-people.mjs --out DIR --preset hero --id <assetId>        # 近景/主角：不削面 + 2K 贴图
//   node tools/aholo/compress-people.mjs --out DIR --preset far  --id <assetId>        # 远景/群众：削面 + 1K 贴图
//   node tools/aholo/compress-people.mjs --out DIR --texture-size 512                  # 覆盖贴图尺寸
//
// 两档的差别只有一个：hero 关掉 `--simplify`（保留原始三角面）并把贴图提到 2048。
// 实测「原皮很傻」主要来自 simplify 削面 + 1K 贴图，而不是 meshopt（它无损）。
//
// 产物仍是标准 GLB；前端 glb-assets.ts 已挂 MeshoptDecoder，未压缩资产照常可读。
// 上云后同步 R2 people/<assetId>.glb，并按实测体积下调 LOCAL_WALK_MAX_FILE_BYTES。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const ids = args.reduce((list, value, index) => (value === '--id' && args[index + 1] ? [...list, args[index + 1]] : list), []);
const outDir = option('out', '.cache/aholo/compressed');
const srcDir = option('from', '.cache/aholo');
const preset = option('preset', 'far');
const textureSize = option('texture-size', preset === 'hero' ? '2048' : '1024');
const minBytes = Number(option('min-mb', '10')) * 1024 * 1024;
const cli = option('cli', '@gltf-transform/cli@4.5.1');
const dryRun = args.includes('--dry-run');

if (preset !== 'hero' && preset !== 'far') {
  console.error(`未知预设 ${preset}；只支持 hero（近景，不削面）或 far（远景，削面）。`);
  process.exit(2);
}

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

/**
 * 用 `node <npm-cli.js> exec` 拉起 CLI，而不是直接 spawn `npx.cmd`：
 * Node 20+ 起在 Windows 上禁止不带 shell 启动 .cmd，会抛 EINVAL（本机 Node 26 实测）。
 * 走 node 自己执行 npm-cli.js 既跨平台，也不必给整串参数做 shell 转义（路径含中文/空格）。
 */
function runGltfTransform(cliArgs) {
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(npmCli)) {
    execFileSync(process.execPath, [npmCli, 'exec', '--yes', '--', cli, ...cliArgs], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    return;
  }
  // 兜底：非标准安装找不到 npm-cli.js 时退回 shell（Node 20+ 必须显式 shell: true）。
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', cli, ...cliArgs], {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  });
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
  runGltfTransform([
    'optimize', file, target,
    '--compress', 'meshopt',
    '--texture-compress', 'webp',
    '--texture-size', textureSize,
    // hero：保留原始拓扑，只做无损压缩 + 高清贴图。
    ...(preset === 'hero' ? ['--simplify', 'false'] : []),
  ]);
  const after = statSync(target).size;
  rows.push({ file: basename(file), before, after, saved: +(1 - after / before).toFixed(4), ms: Date.now() - started });
}

for (const row of rows) {
  const mb = bytes => (bytes / 1048576).toFixed(2);
  console.log(row.after === null
    ? `${row.file}  ${mb(row.before)} MB  → (dry-run, preset=${preset}, texture=${textureSize})`
    : `${row.file}  ${mb(row.before)} MB → ${mb(row.after)} MB  (−${(row.saved * 100).toFixed(1)}%, ${row.ms} ms, preset=${preset})  → ${join(outDir, row.file)}`);
}
const totalBefore = rows.reduce((sum, row) => sum + row.before, 0);
const totalAfter = rows.reduce((sum, row) => sum + (row.after ?? row.before), 0);
if (rows.every(row => row.after !== null)) {
  console.log(`合计 ${(totalBefore / 1048576).toFixed(1)} MB → ${(totalAfter / 1048576).toFixed(1)} MB（−${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%，preset=${preset}）`);
}
