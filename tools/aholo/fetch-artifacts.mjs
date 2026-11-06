#!/usr/bin/env node
// 产物拉取：按 job.json 里的 href 下载 ply/spz/scale.json，流式打印真实字节与耗时。
// 用法：node tools/aholo/fetch-artifacts.mjs --out docs/evidence/aholo/scan-tearoom-130 [--only spz,ply]
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClient, scanKey } from './lib/web-scan.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const OUT = resolve(arg('--out', 'docs/evidence/aholo/scan-tearoom-130'));
const ONLY = new Set(arg('--only', '').split(',').filter(Boolean).map(value => value.trim()));
const DIR = join(OUT, 'artifacts');

const client = createClient({ key: scanKey() });

async function main() {
  await mkdir(DIR, { recursive: true });
  const job = JSON.parse(await readFile(join(OUT, 'job.json'), 'utf8'));
  const artifacts = (job.artifacts ?? []).filter(artifact => !ONLY.size || ONLY.has(artifact.format));
  for (const artifact of artifacts) {
    const target = join(DIR, artifact.name);
    const started = Date.now();
    const response = await fetch(artifact.href.startsWith('http') ? artifact.href : new URL(artifact.href, 'https://studio.aholo3d.cn').toString(), {
      headers: { Authorization: `Bearer ${process.env.AHOLO_SCAN_KEY}` },
    });
    if (!response.ok || !response.body) throw new Error(`${artifact.name} HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    const chunks = [];
    let received = 0;
    let lastLog = 0;
    for await (const chunk of response.body) {
      chunks.push(Buffer.from(chunk));
      received += chunk.length;
      if (Date.now() - lastLog > 3000) {
        lastLog = Date.now();
        const mb = (received / 1048576).toFixed(1);
        console.log(`  ${artifact.name} ${mb}${total ? `/${(total / 1048576).toFixed(1)}` : ''} MB`);
      }
    }
    const bytes = Buffer.concat(chunks);
    await writeFile(`${target}.part`, bytes);
    await rename(`${target}.part`, target);
    console.log(`${artifact.name} ${bytes.length} bytes · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const listed = (job.artifacts ?? []).map(artifact => artifact.name);
  console.log(`产物清单: ${listed.join(', ')}`);
  if (!listed.some(name => /lod-meta|lod-\d+\.spz/.test(name))) {
    console.log('API 未提供 lod-meta.json / lod-N.spz；LOD 由 tools/aholo/make-lod.mjs 从 scene.spz 本地派生。');
  }
}

main().catch(error => { console.error('[fetch][FAIL]', error.message); process.exit(1); });
