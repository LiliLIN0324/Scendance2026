import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Original manifests remain provenance records; this is the one editor catalogue.
const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const [online, local, legacy, incoming, labels, registered, receipts] = await Promise.all([
  read('assets/library/online.json'), read('assets/library/catalogue.json'),
  read('assets/catalogue.json'), read('assets/library/model200.json'),
  read('assets/library/labels.zh.json'), read('assets/library/asset-ids.json'), read('assets/library/registered.json'),
]);
const categories = {
  seating: '座椅沙发', tables: '桌台柜台', exhibition: '摊位展陈', stage: '舞台设施',
  audio: '音响乐器', lighting: '灯光照明', signage: '标识导视', people: '人物角色',
  storage: '收纳容器', logistics: '后勤设施', tools: '工具设备', sports: '运动器材',
  plants: '绿植景观', structure: '建筑结构', digital: '数码设备', decor: '装饰陈设',
  food: '餐饮用品', vehicles: '交通载具', scenes: '完整场景',
};
const original = [
  ...online.models.map(m => ({ ...m, cdnUrl: m.glb, source: 'website-online' })),
  ...local.models.map(m => ({ ...m, width: m.sizeMeters[0], depth: m.sizeMeters[1], height: m.sizeMeters[2], page: m.pageUrl, source: 'website-local' })),
  ...legacy.assets.map(m => ({ ...m, name: m.title, glb: m.localPath, width: m.sizeMeters[0], depth: m.sizeMeters[2], height: m.sizeMeters[1], page: m.sourceUrl, source: 'website-legacy' })),
];
const rows = new Map();
for (const model of original) {
  const previous = rows.get(model.slug);
  if (previous && previous.sha256 !== model.sha256) throw new Error(`Conflicting original model: ${model.slug}`);
  rows.set(model.slug, { ...model, ...previous, sources: [...(previous?.sources ?? []), model.source] });
}
const replacements = [];
for (const model of incoming.models) {
  const previous = rows.get(model.slug);
  if (previous) replacements.push({ slug: model.slug, identicalAfterRepair: model.sha256 === previous.sha256 });
  // New files win, but a cloud identity belongs only to its exact registered bytes.
  const assetId = previous?.sha256 === model.sha256 ? previous.assetId : undefined;
  rows.set(model.slug, { ...model, ...(assetId ? { assetId } : {}), sources: [...(previous?.sources ?? []), 'model200'] });
}
const models = [];
const byHash = new Map();
const duplicates = [];
const aliases = Object.fromEntries(Object.entries(registered).filter(([url]) => !url.startsWith('/showcase/assets/library/model/')));
for (const row of rows.values()) {
  const label = labels[row.slug];
  if (!label || !/[\u4e00-\u9fff]/u.test(label.name) || !categories[label.bucket]) throw new Error(`Missing Chinese classification: ${row.slug}`);
  const path = `assets/library/model/${row.slug}.glb`;
  if (row.source === 'website-legacy' && !incoming.models.some(m => m.slug === row.slug)) {
    await copyFile(new URL(row.glb, root), new URL(path, root));
  }
  const bytes = await readFile(new URL(path, root));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== row.sha256 || bytes.length !== row.bytes) throw new Error(`Model bytes changed: ${row.slug}`);
  const thumb = `assets/library/thumb/${row.slug}.webp`;
  const image = await readFile(new URL(thumb, root));
  if (image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`Invalid preview: ${row.slug}`);
  const glb = `/showcase/${path}`;
  const receipt = receipts[row.slug];
  if (receipt && receipt.sha256 !== sha256) throw new Error(`Registration bytes changed: ${row.slug}`);
  const assetId = row.assetId ?? receipt?.assetId ?? (original.find(m => m.sha256 === sha256)?.assetId);
  const previous = byHash.get(sha256);
  if (previous) {
    previous.sources = [...new Set([...previous.sources, ...row.sources])];
    previous.aliases.push(row.slug);
    duplicates.push({ slug: row.slug, canonicalSlug: previous.slug, sha256 });
    if (assetId && previous.assetId && assetId !== previous.assetId) throw new Error(`Conflicting cloud identities: ${row.slug}`);
    if (assetId) { previous.assetId = assetId; aliases[previous.glb] = assetId; aliases[glb] = assetId; }
    continue;
  }
  if (assetId) aliases[glb] = assetId;
  const model = {
    slug: row.slug, name: label.name, originalName: row.name, bucket: label.bucket,
    subcategory: categories[label.bucket], width: row.width, depth: row.depth, height: row.height,
    bytes: bytes.length, triangles: row.triangles, glb, thumb: `/showcase/${thumb}`,
    page: row.page, cdnUrl: row.cdnUrl, sha256, license: 'CC0-1.0',
    sources: row.sources, aliases: [], ...(assetId ? { assetId } : {}),
    ...(row.blockedReason ? { blockedReason: row.blockedReason } : {}),
  };
  if (![model.width, model.depth, model.height].every(n => Number.isFinite(n) && n > 0 && n <= 50)) throw new Error(`Invalid dimensions: ${row.slug}`);
  models.push(model);
  byHash.set(sha256, model);
}
const buckets = Object.entries(categories).map(([key, label]) => ({ key, label, count: models.filter(m => m.bucket === key).length })).filter(b => b.count);
const result = {
  version: 1, provider: '3dassets.dev', license: 'CC0-1.0', count: models.length,
  placeableCount: models.filter(m => !m.blockedReason).length,
  registeredCount: models.filter(m => m.assetId).length,
  totalBytes: models.reduce((n, m) => n + m.bytes, 0), buckets, models,
};
await writeFile(new URL('assets/library/merged.json', root), JSON.stringify(result, null, 2) + '\n');
await writeFile(new URL('assets/library/asset-labels.zh.json', root), JSON.stringify(Object.fromEntries(models.filter(m => m.assetId).map(m => [m.assetId, m.name])), null, 2) + '\n');
await writeFile(new URL('assets/library/asset-ids.json', root), JSON.stringify(aliases, null, 2) + '\n');
await writeFile(new URL('assets/library/merge-report.json', root), JSON.stringify({
  sourceCounts: { websiteOnline: online.models.length, websiteLocal: local.models.length, websiteLegacy: legacy.assets.length, model200: incoming.models.length },
  count: result.count, placeableCount: result.placeableCount, registeredCount: result.registeredCount,
  replacements, duplicates, repairs: incoming.repairs,
  blocked: models.filter(m => m.blockedReason).map(m => ({ slug: m.slug, name: m.name, reason: m.blockedReason })),
}, null, 2) + '\n');
console.log(JSON.stringify({ count: result.count, placeableCount: result.placeableCount, registeredCount: result.registeredCount, totalBytes: result.totalBytes, buckets }));
