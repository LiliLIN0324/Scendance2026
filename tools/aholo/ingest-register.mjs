// Aholo 批次 14 件登记进静态随包库（目检通过后执行）。
//
// 做什么：
//  1. 校验缓存 GLB 的 sha256/字节与草稿清单一致，缩略图 RIFF/WEBP 魔数；
//  2. 复制 GLB → library/model/、webp → library/thumb/；
//  3. 把条目并入 incoming-extra.json（按 slug 去重覆盖，保留 repairs），
//     中文标签并入 labels.zh.json；
//  4. 不重建 merged.json——那一步由 scripts/build-model-library.mjs 统一跑门禁。
//
// 用法（仓库根）：
//   node tools/aholo/ingest-register.mjs --dry-run   # 只校验，不写库
//   node tools/aholo/ingest-register.mjs            # 复制并写清单
//
// 候选弱图（review verdict=hold）登记但带 blockedReason，面板过滤、暂不可放置。
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const LIB = path.join(ROOT_DIR, 'assets/library');
// 数据源：去 meshopt 重压产物的元数据（.cache/aholo/ingest-nomeshopt/meta.json）。
// 旧 .cache/aholo/ingest-20261119（meshopt）产物已废弃，目录门禁不收 meshopt。
const MANIFEST = path.join(ROOT_DIR, '.cache/aholo/ingest-nomeshopt/meta.json');
const REVIEW = path.join(ROOT_DIR, 'tools/aholo/thumb-review-20261119.json');
const GLB_DIR = path.join(ROOT_DIR, '.cache/aholo/ingest-nomeshopt');
const THUMB_DIR = path.join(ROOT_DIR, '.cache/aholo/thumbs');

const dryRun = process.argv.includes('--dry-run');

const BLOCKED_REASON = {
  'aholo-20261119-champagne-glass-tower': '候选弱图：透明杯在白底上辨识度不足，待重渲染后替换，暂不可放置。',
  'aholo-20261119-cold-fountain': '候选弱图：贴图含待清理的伪标签贴花，待回炉重生成后替换，暂不可放置。',
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const review = Object.fromEntries(
  JSON.parse(readFileSync(REVIEW, 'utf8')).items.map(i => [i.slug, i]),
);

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

const extraPath = path.join(LIB, 'incoming-extra.json');
const labelsPath = path.join(LIB, 'labels.zh.json');
const extra = JSON.parse(readFileSync(extraPath, 'utf8'));
const labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
extra.models = extra.models ?? [];
extra.repairs = extra.repairs ?? [];

const existing = new Map(extra.models.map(m => [m.slug, m]));
const added = [];
const errors = [];

for (const row of manifest.models) {
  const glbAbs = path.join(GLB_DIR, `${row.slug}.glb`);
  const thumbAbs = path.join(THUMB_DIR, `${row.slug}.webp`);
  if (!existsSync(glbAbs)) { errors.push(`${row.slug}: GLB 缺失`); continue; }
  if (!existsSync(thumbAbs)) { errors.push(`${row.slug}: 缩略图缺失`); continue; }

  const glb = readFileSync(glbAbs);
  const c = row.compressed;
  if (glb.length !== c.bytes) errors.push(`${row.slug}: 字节 ${glb.length} ≠ 清单 ${c.bytes}`);
  if (sha256(glb) !== c.sha256) errors.push(`${row.slug}: sha256 不一致`);

  const thumb = readFileSync(thumbAbs);
  if (thumb.toString('ascii', 0, 4) !== 'RIFF' || thumb.toString('ascii', 8, 12) !== 'WEBP') {
    errors.push(`${row.slug}: 缩略图不是 WEBP`);
  }

  const reviewItem = review[row.slug];
  const blockedReason = BLOCKED_REASON[row.slug] ?? (reviewItem?.verdict === 'hold' ? '候选弱图，待替换，暂不可放置。' : undefined);

  const entry = {
    slug: row.slug,
    name: `${row.zh} · Aholo 生成`,
    sourceFile: `aholo-lux3d-batch-20261119/${row.slug}.glb`,
    sourceCategory: row.subcategory,
    width: c.width,
    depth: c.depth,
    height: c.height,
    bytes: c.bytes,
    triangles: c.triangles,
    sha256: c.sha256,
    license: {
      slug: 'project-authored',
      name: '项目自创素材（Scendance Aholo 生成）',
      url: '',
      attributionRequired: false,
    },
    glb: `assets/library/model/${row.slug}.glb`,
    thumb: `assets/library/thumb/${row.slug}.webp`,
    keyword: 'aholo-generated',
    ...(blockedReason ? { blockedReason } : {}),
  };
  existing.set(row.slug, entry);
  added.push(entry);

  labels[row.slug] = { name: row.zh, bucket: row.bucket };

  if (!dryRun) {
    mkdirSync(path.join(LIB, 'model'), { recursive: true });
    mkdirSync(path.join(LIB, 'thumb'), { recursive: true });
    copyFileSync(glbAbs, path.join(LIB, 'model', `${row.slug}.glb`));
    copyFileSync(thumbAbs, path.join(LIB, 'thumb', `${row.slug}.webp`));
  }
}

if (errors.length) {
  console.error('门禁未通过：');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

if (!dryRun) {
  extra.models = [...existing.values()];
  writeFileSync(extraPath, JSON.stringify(extra, null, 2) + '\n');
  writeFileSync(labelsPath, JSON.stringify(labels, null, 2) + '\n');
}

const blocked = added.filter(a => a.blockedReason);
console.log(`${dryRun ? '[dry-run] ' : ''}登记 ${added.length} 件（候选弱图 ${blocked.length} 件不可放置）`);
for (const a of added) {
  console.log(`  ${a.blockedReason ? '⛔' : '✓'} ${a.slug}  ${a.bytes}B  ${a.triangles}tri  ${a.width}×${a.depth}×${a.height}`);
}
