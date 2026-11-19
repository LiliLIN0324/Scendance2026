#!/usr/bin/env node
// 本机扫描索引生成器：把 data/local-scans.json 的人工清单与 .cache/aholo 里的真实文件对账，
// 生成前端用的 local-scan-index.json。
//
// 为什么要有这一步：浏览器里的资产注册表（localStorage 的 scendance:aholo-assets）按来源隔离，
// 换浏览器、换域名（127.0.0.1 ↔ localhost）就看不到已登记的扫描。文件才是本机的事实，
// 索引把「文件在不在、大小多少、什么时候落盘」固定下来，应用据此重新登记。
//
// 用法：node scripts/build-local-scan-index.mjs
//   - 文件没了的条目会被跳过，并在 stderr 提示；不会写进空条目。
//   - 有 lod-meta 的条目会带上 forwardBox（应用侧换算真实尺度）与 lodUrl
//     （预览按相机距离换档）。只带 forwardBox 不带 lodUrl 时，LOD 派生好了也用不上
//     ——登记断点就在这里。
//   - 清单里的 removed（已删资产号墓碑）原样透传进索引：应用打开面板时按它
//     从浏览器注册表退掉历史登记，已删扫描不能靠旧注册表复活。
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'aholo');
const manifestPath = join(root, 'data', 'local-scans.json');
const lodDir = join(root, 'frontend', 'public', 'scans');
const outputPath = join(root, 'frontend', 'components', 'room-organizer', 'lib', 'local-scan-index.json');

/** 目录名必须是 URL 安全字符：与 aholo-assets 的 lodUrl 规则同源，中文名进不了地址。 */
const LOD_DIR_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;

/**
 * 从 lod-meta 的 files[0] 反查资产号。
 *
 * 第 0 档有两种写法：代理/远端的绝对地址（`.../asset/<id>.spz`，make-lod 的
 * `--level0-url` 产物）或同目录文件名（`<id>.spz`）。两种都认，否则「有 LOD 也挂不上」。
 */
function assetIdFromLodSource(source) {
  const name = String(source ?? '').trim();
  return /\/asset\/([0-9a-f-]{36})\.(?:spz|ply)$/i.exec(name)?.[1]
    ?? /^([0-9a-f-]{36})\.(?:spz|ply)$/i.exec(name)?.[1];
}

/** 每个资产号对应哪份 lod-meta：forwardBox 换算尺度，lodUrl 让预览按距离换档。 */
async function readLodIndex() {
  const found = new Map();
  if (!existsSync(lodDir)) return found;
  for (const entry of await readdir(lodDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !LOD_DIR_PATTERN.test(entry.name)) continue;
    // 测试夹具目录（tearoom-lod-test 这类）不参与反查：它可能是拿别的场切的，
    // 一旦写进索引就会把同资产的真目录盖掉，尺度也跟着变。
    if (/test/i.test(entry.name)) continue;
    const metaPath = join(lodDir, entry.name, 'lod-meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      // 单档 meta 等于没有 LOD：预览侧同样要求 ≥2 档。
      if (!Array.isArray(meta?.files) || meta.files.length < 2) continue;
      const assetId = assetIdFromLodSource(meta?.files?.[0]);
      if (!assetId) continue;
      // 先到先得（readdir 按名字排序）：同一资产多份 LOD 时结果可预测，并留一条提示。
      if (found.has(assetId)) {
        process.stderr.write(`同一个资产号有两份 LOD，保留 ${found.get(assetId).lodUrl}，忽略 ${entry.name}\n`);
        continue;
      }
      found.set(assetId, {
        lodUrl: `/scans/${entry.name}/lod-meta.json`,
        ...(meta?.forwardBox ? { forwardBox: meta.forwardBox } : {}),
      });
    } catch {
      /* 坏档只丢这一条，不影响整轮生成。 */
    }
  }
  return found;
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const scans = Array.isArray(manifest?.scans) ? manifest.scans : [];
const lods = await readLodIndex();
const entries = [];
const missing = [];

for (const scan of scans) {
  const { assetId, kind, name } = scan;
  if (!assetId || !kind || !name) continue;
  const filePath = join(cacheDir, `${assetId}.${kind}`);
  if (!existsSync(filePath)) {
    missing.push(`${assetId}.${kind}`);
    continue;
  }
  const info = await stat(filePath);
  const lod = lods.get(assetId);
  entries.push({
    assetId,
    kind,
    name,
    bytes: info.size,
    savedAt: Math.round(info.mtimeMs),
    ...(lod?.forwardBox ? { forwardBox: lod.forwardBox } : {}),
    ...(lod ? { lodUrl: lod.lodUrl } : {}),
  });
}

entries.sort((a, b) => b.savedAt - a.savedAt);
// 墓碑只收像资产号的字符串：手滑写错时宁可不透传，也别让应用去退掉不存在的条目。
const removed = Array.isArray(manifest?.removed)
  ? manifest.removed.filter((id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
  : [];
await writeFile(outputPath, `${JSON.stringify({ scans: entries, removed }, null, 2)}\n`, 'utf8');

process.stdout.write(`本机扫描索引：${entries.length} 条（removed ${removed.length}）→ ${outputPath}\n`);
if (missing.length) {
  process.stderr.write(`本机没有这些文件，已跳过 ${missing.length} 条：${missing.join(', ')}\n`);
}
