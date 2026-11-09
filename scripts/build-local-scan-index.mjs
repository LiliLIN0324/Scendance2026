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
//   - 有 lod-meta 的条目会带上 forwardBox，应用侧换算真实尺度。
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'aholo');
const manifestPath = join(root, 'data', 'local-scans.json');
const lodDir = join(root, 'frontend', 'public', 'scans');
const outputPath = join(root, 'frontend', 'components', 'room-organizer', 'lib', 'local-scan-index.json');

/** lod-meta 里的 files[0] 是原资产地址，能反查资产号；forwardBox 是米制真实尺度来源。 */
async function readLodBoxes() {
  const boxes = new Map();
  if (!existsSync(lodDir)) return boxes;
  for (const entry of await readdir(lodDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(lodDir, entry.name, 'lod-meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      const source = String(meta?.files?.[0] ?? '');
      const assetId = /\/asset\/([0-9a-f-]{36})\.(?:spz|ply)$/i.exec(source)?.[1];
      if (!assetId || !meta?.forwardBox) continue;
      boxes.set(assetId, meta.forwardBox);
    } catch {
      /* 坏档只丢这一条，不影响整轮生成。 */
    }
  }
  return boxes;
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const scans = Array.isArray(manifest?.scans) ? manifest.scans : [];
const boxes = await readLodBoxes();
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
  entries.push({
    assetId,
    kind,
    name,
    bytes: info.size,
    savedAt: Math.round(info.mtimeMs),
    ...(boxes.has(assetId) ? { forwardBox: boxes.get(assetId) } : {}),
  });
}

entries.sort((a, b) => b.savedAt - a.savedAt);
await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');

process.stdout.write(`本机扫描索引：${entries.length} 条 → ${outputPath}\n`);
if (missing.length) {
  process.stderr.write(`本机没有这些文件，已跳过 ${missing.length} 条：${missing.join(', ')}\n`);
}
