// 把 Aholo 批次 raw 原件重压成「目录门禁可接受」的格式（去 meshopt）。
//
// 背景：静态随包目录的校验门禁 scripts/library-model.ts 的 extensionsRequired
// 白名单只放行 KHR_mesh_quantization 与 EXT_texture_webp；现有库 976 件均不带
// EXT_meshopt_compression。上一版 ingest-prep.mjs 用 `--compress meshopt` 压出的
// 产物在目录门禁下会抛 UNSUPPORTED_MODEL_FEATURE。本脚本改走 `--compress quantize`，
// 保留 WebP 贴图与 far 档削面，几何尺度不变（登记尺寸沿用 raw 包围盒）。
//
// 用法（仓库根）：
//   node tools/aholo/recompress-nomeshopt.mjs            # 批量重压 + 预检
//   node tools/aholo/recompress-nomeshopt.mjs --only <slug>
//   node tools/aholo/recompress-nomeshopt.mjs --force   # 覆盖已存在产物
//
// 产物：.cache/aholo/ingest-nomeshopt/<slug>.glb + meta.json（供 ingest-register 读取）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const fromDir = join(ROOT, opt('from', '.cache/aholo/batch-20261119'));
const outDir = join(ROOT, opt('out', '.cache/aholo/ingest-nomeshopt'));
const manifestPath = join(ROOT, opt('manifest', 'tools/aholo/aholo-ingest-20261119.json'));
const metaPath = join(outDir, 'meta.json');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const force = args.includes('--force');
const cli = opt('cli', '@gltf-transform/cli@4.5.1');

const ALLOWED_REQUIRED = new Set(['KHR_mesh_quantization', 'EXT_texture_webp']);
const MAX_BYTES = 10 * 1024 * 1024;

function runGltfTransform(cliArgs) {
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(npmCli)) {
    execFileSync(process.execPath, [npmCli, 'exec', '--yes', '--', cli, ...cliArgs], { stdio: ['ignore', 'ignore', 'inherit'] });
    return;
  }
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', cli, ...cliArgs], {
    stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32',
  });
}

function readGlbJson(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('不是 GLB');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('缺少 JSON chunk');
  return JSON.parse(new TextDecoder()
    .decode(new Uint8Array(buffer.buffer, buffer.byteOffset + 20, jsonLength))
    .replace(/[\0\s]+$/, ''));
}

function inspect(buffer, json) {
  const acc = json.accessors ?? [];
  let triangles = 0;
  let primitives = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      primitives++;
      const idx = prim.indices !== undefined ? acc[prim.indices] : undefined;
      const pos = acc[prim.attributes?.POSITION];
      triangles += Math.floor((idx?.count ?? pos?.count ?? 0) / 3);
    }
  }
  return {
    bytes: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    triangles,
    primitives,
    nodes: json.nodes?.length ?? 0,
    materials: json.materials?.length ?? 0,
    images: json.images?.length ?? 0,
    skins: json.skins?.length ?? 0,
    animations: json.animations?.length ?? 0,
    extensionsRequired: json.extensionsRequired ?? [],
    extensionsUsed: json.extensionsUsed ?? [],
    imageMimes: (json.images ?? []).map((i) => i.mimeType ?? '(embedded)'),
  };
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = manifest.models ?? manifest;
mkdirSync(outDir, { recursive: true });

const rows = [];
for (const entry of entries) {
  if (only && entry.slug !== only) continue;
  const src = join(fromDir, entry.slug, 'model.glb');
  const target = join(outDir, `${entry.slug}.glb`);
  if (!existsSync(src)) {
    rows.push({ slug: entry.slug, problems: ['raw 原件缺失'] });
    continue;
  }
  if (!existsSync(target) || force) {
    const started = Date.now();
    runGltfTransform([
      'optimize', src, target,
      '--compress', 'quantize',
      '--texture-compress', 'webp',
      '--texture-size', String(manifest.textureSize ?? '1024'),
      '--simplify', 'true',
    ]);
    console.log(`${entry.slug} 重压完成 ${Date.now() - started} ms`);
  } else {
    console.log(`${entry.slug} 已存在，跳过（--force 重压）`);
  }

  const problems = [];
  const out = readFileSync(target);
  const meta = inspect(out, readGlbJson(out));
  // 登记尺寸沿用 raw 包围盒：optimize/simplify 不改几何尺度。
  const dims = { width: entry.raw.width, height: entry.raw.height, depth: entry.raw.depth };

  const badRequired = meta.extensionsRequired.filter((e) => !ALLOWED_REQUIRED.has(e));
  if (badRequired.length) problems.push(`extensionsRequired 越界: ${badRequired.join(',')}`);
  if (meta.bytes > MAX_BYTES) problems.push(`超过本地 10MB 上限`);
  if (meta.triangles < 1 || meta.triangles > 150_000) problems.push(`三角面 ${meta.triangles} 越界`);
  if (meta.primitives > 350) problems.push(`primitive ${meta.primitives} 越界`);
  if (meta.nodes > 500) problems.push(`节点 ${meta.nodes} 越界`);
  if (meta.materials > 64) problems.push(`材质 ${meta.materials} 越界`);
  if (meta.images > 32) problems.push(`贴图 ${meta.images} 越界`);
  if (meta.skins > 0) problems.push('含蒙皮（不支持）');
  if (meta.animations > 0) problems.push('含动画（不支持）');

  rows.push({
    slug: entry.slug,
    zh: entry.zh,
    bucket: entry.bucket,
    subcategory: entry.subcategory,
    prompt: entry.prompt,
    source: entry.source,
    compressed: { ...meta, ...dims },
    problems,
  });
}

const metaDoc = {
  version: 1,
  generatedAt: new Date().toISOString(),
  preset: 'far',
  textureSize: manifest.textureSize ?? '1024',
  compress: 'quantize',
  note: '去 meshopt 重压产物：extensionsRequired 仅 KHR_mesh_quantization / EXT_texture_webp，对齐静态目录门禁。尺寸沿用 raw 包围盒。',
  models: rows,
};
writeFileSync(metaPath, JSON.stringify(metaDoc, null, 2) + '\n');

for (const row of rows) {
  const c = row.compressed;
  const size = c ? `${c.width}×${c.height}×${c.depth}` : '-';
  const flag = row.problems.length ? ` ⚠ ${row.problems.join('；')}` : ' ✓';
  const mb = c ? (c.bytes / 1048576).toFixed(2) : '-';
  console.log(`${row.slug}  ${mb}MB  ${c?.triangles ?? '-'}tri  ${size}${flag}`);
}
console.log(`\n元数据已写入 ${metaPath}（${rows.length} 条）`);
if (rows.some((r) => r.problems.length)) process.exit(1);
