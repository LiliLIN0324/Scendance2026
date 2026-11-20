// Aholo 批次产物入库预处理（本地缓存阶段，不触碰 tracked 的 merged.json / labels）。
//
// 做什么：
//  1. 从 batch-manifest.json 取出在盘上有 model.glb 的条目；
//  2. 走 @gltf-transform/cli optimize（meshopt + WebP 贴图 + 可选削面）压到 --out；
//  3. 复测体积 / sha256 / 三角面 / 世界包围盒 / 结构门禁，写出草稿清单
//     tools/aholo/aholo-ingest-20261119.json，供后续人工审过再并入 incoming-extra。
//
// 用法（仓库根）：
//   node tools/aholo/ingest-prep.mjs --dry-run
//   node tools/aholo/ingest-prep.mjs --preset far
//   node tools/aholo/ingest-prep.mjs --preset hero --only aholo-20261119-floral-arch
//
// 门禁口径对齐 supabase/functions/_shared/models.ts 的 validateModel；静态目录
// （assets/library/）构建门禁见 scripts/build-model-library.mjs。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const fromDir = opt('from', '.cache/aholo/batch-20261119');
const outDir = opt('out', '.cache/aholo/ingest-20261119');
const manifestPath = opt('manifest', 'tools/aholo/batch-manifest.json');
const draftPath = opt('draft', 'tools/aholo/aholo-ingest-20261119.json');
const preset = opt('preset', 'far');
const textureSize = opt('texture-size', preset === 'hero' ? '2048' : '1024');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const cli = opt('cli', '@gltf-transform/cli@4.5.1');

if (preset !== 'hero' && preset !== 'far') {
  console.error(`未知预设 ${preset}；只支持 hero（不削面 / 2K）或 far（削面 / 1K）。`);
  process.exit(2);
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

function readGlbJson(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('不是 GLB');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error('缺少 JSON chunk');
  return JSON.parse(new TextDecoder()
    .decode(new Uint8Array(buffer.buffer, buffer.byteOffset + 20, jsonLength))
    .replace(/[\0\s]+$/, ''));
}

function nodeLocalMatrix(node) {
  if (node.matrix) return node.matrix;
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  const q = node.rotation ?? [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const rot = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
    t[0], t[1], t[2], 1,
  ];
  const scale = [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1];
  const mul = (a, b) => {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) {
      r[c * 4 + i] = a[i] * b[c * 4] + a[4 + i] * b[c * 4 + 1] + a[8 + i] * b[c * 4 + 2] + a[12 + i] * b[c * 4 + 3];
    }
    return r;
  };
  return mul(rot, scale);
}

function applyMat(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

function inspect(buffer, json, { useBounds = true } = {}) {
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
  const meta = {
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
    imageMimes: (json.images ?? []).map(i => i.mimeType ?? '(embedded)'),
  };
  if (!useBounds) return meta;

  // 包围盒只在未压缩原件上读：meshopt 量化后 POSITION accessor 的 min/max 可能失效，
  // 而 optimize 不改几何尺度，登记尺寸沿用原件即可。
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const walk = (nodeIdx, parentMat) => {
    const node = json.nodes?.[nodeIdx];
    if (!node) return;
    const mat = parentMat.map((v, i) => v * 0);
    const local = nodeLocalMatrix(node);
    for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) {
      mat[c * 4 + i] = parentMat[i] * local[c * 4] + parentMat[4 + i] * local[c * 4 + 1]
        + parentMat[8 + i] * local[c * 4 + 2] + parentMat[12 + i] * local[c * 4 + 3];
    }
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives ?? []) {
        const a = acc[prim.attributes?.POSITION];
        if (!a?.min || !a?.max) continue;
        for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) for (let cz = 0; cz < 2; cz++) {
          const p = [cx ? a.max[0] : a.min[0], cy ? a.max[1] : a.min[1], cz ? a.max[2] : a.min[2]];
          const w = applyMat(mat, p);
          for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], w[i]); max[i] = Math.max(max[i], w[i]); }
        }
      }
    }
    for (const child of node.children ?? []) walk(child, mat);
  };
  for (const n of json.scenes?.[0]?.nodes ?? []) walk(n, identity);

  const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    ...meta,
    boundsMin: min.map(v => +v.toFixed(4)),
    boundsMax: max.map(v => +v.toFixed(4)),
    width: +dims[0].toFixed(4), height: +dims[1].toFixed(4), depth: +dims[2].toFixed(4),
  };
}

// blockers：静态目录与云端登记都过不去的硬伤；notes：仅云端 validateModel 会拦、
// 静态随包目录可接受的差异（meshopt / webp / quantization 是现有人物库同款管线）。
function gates(meta, dims) {
  const problems = [];
  const notes = [];
  if (meta.bytes > 10 * 1024 * 1024) problems.push('超过本地 10MB 上限');
  if (meta.triangles < 1 || meta.triangles > 100_000) problems.push(`三角面 ${meta.triangles} 越界`);
  if (meta.primitives > 200) problems.push(`primitive ${meta.primitives} 越界`);
  if (meta.nodes > 500) problems.push(`节点 ${meta.nodes} 越界`);
  if (meta.materials > 64) problems.push(`材质 ${meta.materials} 越界`);
  if (meta.images > 32) problems.push(`贴图 ${meta.images} 越界`);
  if (meta.skins > 0) problems.push('含蒙皮（不支持）');
  if (meta.animations > 0) problems.push('含动画（不支持）');
  for (const d of [dims.width, dims.height, dims.depth]) {
    if (!Number.isFinite(d) || d <= 0) problems.push('包围盒无效');
    if (d > 50) problems.push('尺寸超过 50 米');
  }
  if (meta.extensionsRequired.length) notes.push(`云端登记需解 extensionsRequired: ${meta.extensionsRequired.join(',')}`);
  if (meta.imageMimes.some(m => m.includes('webp'))) notes.push('贴图为 WebP：云端 validateModel 只收 png/jpeg');
  return { problems, notes };
}

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

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = Array.isArray(manifest) ? manifest : (manifest.items ?? manifest.models ?? manifest.entries);
const onDisk = new Set(readdirSync(fromDir).filter(name => existsSync(join(fromDir, name, 'model.glb'))));
const rows = [];
mkdirSync(outDir, { recursive: true });

for (const entry of entries) {
  if (only && entry.slug !== only) continue;
  if (!onDisk.has(entry.slug)) continue;
  const src = join(fromDir, entry.slug, 'model.glb');
  const target = join(outDir, `${entry.slug}.glb`);
  const raw = readFileSync(src);
  const rawMeta = inspect(raw, readGlbJson(raw));
  const rawDims = { width: rawMeta.width, height: rawMeta.height, depth: rawMeta.depth };

  if (!dryRun) {
    if (!existsSync(target) || force) {
      const started = Date.now();
      runGltfTransform([
        'optimize', src, target,
        '--compress', 'meshopt',
        '--texture-compress', 'webp',
        '--texture-size', textureSize,
        ...(preset === 'hero' ? ['--simplify', 'false'] : []),
      ]);
      console.log(`${entry.slug} 压缩完成 ${Date.now() - started} ms`);
    } else {
      console.log(`${entry.slug} 已存在，跳过（--force 重压）`);
    }
    const out = readFileSync(target);
    const meta = inspect(out, readGlbJson(out), { useBounds: false });
    const dims = { ...rawDims };
    const { problems, notes } = gates(meta, dims);
    rows.push({
      slug: entry.slug,
      zh: entry.zh,
      bucket: entry.bucket,
      subcategory: entry.subcategory,
      prompt: entry.prompt,
      source: 'aholo-lux3d-batch-20261119',
      raw: { bytes: rawMeta.bytes, triangles: rawMeta.triangles, ...rawDims },
      compressed: { ...meta, ...dims },
      problems, notes,
    });
  } else {
    const { problems, notes } = gates(rawMeta, rawDims);
    rows.push({
      slug: entry.slug, zh: entry.zh, bucket: entry.bucket, subcategory: entry.subcategory,
      prompt: entry.prompt, source: 'aholo-lux3d-batch-20261119',
      raw: { bytes: rawMeta.bytes, triangles: rawMeta.triangles, ...rawDims },
      problems, notes,
    });
  }
}

const draft = {
  version: 1,
  generatedAt: new Date().toISOString(),
  preset, textureSize,
  note: '草稿清单：人工审过缩略图/朝向/落地后，再把 models 并入 assets/library/incoming-extra.json，并补 labels.zh.json 与 thumb/<slug>.webp。',
  models: rows,
};
writeFileSync(draftPath, JSON.stringify(draft, null, 2) + '\n');

for (const row of rows) {
  const c = row.compressed ?? row.raw;
  const size = `${c.width}×${c.height}×${c.depth}`;
  const flag = row.problems.length ? ` ⚠ ${row.problems.join('；')}` : (row.notes.length ? ` · ${row.notes.join('；')}` : ' ✓');
  const mb = (c.bytes / 1048576).toFixed(2);
  console.log(`${row.slug}  ${mb}MB  ${c.triangles}tri  ${size}${flag}`);
}
console.log(`\n草稿已写入 ${draftPath}（${rows.length} 条）`);
