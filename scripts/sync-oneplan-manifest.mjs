#!/usr/bin/env node
/**
 * 运行期清单生成器（方案 C）。
 *
 * 背景：`docs/oneplan-icons/manifest.audit.json` 是完整台账，逐条记着每个素材的
 * `source_url` / `bytes` / `sha256`——这是审计用的，不应该随产物发到公网。
 * 但画布运行时要读 `/oneplan-icons/manifest.json` 来列物件库（name/category/path/viewBox），
 * 所以 public 下保留一份**只含运行字段**的清单，由本脚本从台账生成。
 *
 * 用法：node scripts/sync-oneplan-manifest.mjs
 * 幂等：重复跑结果一致；台账更新后再跑一次即可。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const auditPath = path.join(repo, 'docs/oneplan-icons/manifest.audit.json');
const runtimePath = path.join(repo, 'frontend/public/oneplan-icons/manifest.json');

/** 画布真正用到的字段；台账里的 source_url / sha256 / bytes / 探测统计一律不进来。 */
const RUNTIME_FIELDS = ['path', 'kind', 'slug', 'name_zh', 'name_en', 'category_zh', 'category_en', 'viewBox'];

const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
const source = Array.isArray(audit.assets) ? audit.assets : [];

const assets = source.map(asset => {
  const picked = {};
  for (const field of RUNTIME_FIELDS) {
    if (asset[field] !== undefined) picked[field] = asset[field];
  }
  return picked;
});

const counts = assets.reduce((acc, asset) => {
  acc[asset.kind] = (acc[asset.kind] ?? 0) + 1;
  return acc;
}, {});

const runtime = {
  note: '运行期清单：由 docs/oneplan-icons/manifest.audit.json 生成，只保留画布需要的字段；来源与校验信息留在仓库 docs，不随产物发布。',
  counts: { total: assets.length, ...counts },
  assets,
};

writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
console.log(`manifest: ${assets.length} 条 → ${path.relative(repo, runtimePath).replace(/\\/g, '/')}`);
