import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const linksPath = 'assets/library/icon-model-links.json';
const [links, catalogue, originals, manifest, packFile] = await Promise.all([
  read(linksPath),
  read('assets/library/merged.json'),
  read('assets/library/incoming-icon-original.json'),
  read('frontend/public/oneplan-icons/manifest.json'),
  read('frontend/public/oneplan-icons/packs.json'),
]);

// Existing links are curated choices. Newly authored props fill empty slots.
const icons = { ...links.icons };
const variants = { ...links.variants };
const originalSlugs = new Set();
for (const model of originals.models) {
  if (model.variantOf) {
    variants[model.variantOf] = [...new Set([...(variants[model.variantOf] ?? []), model.slug])];
    originalSlugs.add(model.slug);
    continue;
  }
  icons[model.iconSlug] ??= model.slug;
  originalSlugs.add(model.slug);
}
const equivalentIcons = {
  'camera-jimmy': 'camera-crane',
  'water-refill-point': 'water-refill-station',
};
for (const icon of Object.keys(icons)) {
  const counterpart = equivalentIcons[icon] ?? (icon.endsWith('-rotated') ? icon.slice(0, -8) : '');
  if (counterpart && !variants[icon] && variants[counterpart] && icons[icon] === icons[counterpart]) {
    variants[icon] = variants[counterpart];
  }
}

const catalogueBySlug = new Map(catalogue.models.filter(model => !model.blockedReason)
  .flatMap(model => [model.slug, ...model.aliases].map(slug => [slug, model])));
const models = {};
function registerModel(slug, icon) {
  const model = catalogueBySlug.get(slug);
  if (!model) throw new Error(`Icon ${icon} references unavailable model ${slug}`);
  const { name, width, depth, height } = model;
  const trueScale = originalSlugs.has(slug) || links.models[slug]?.trueScale || models[model.slug]?.trueScale;
  models[model.slug] = { name, width, depth, height, ...(trueScale ? { trueScale: true } : {}) };
  return model.slug;
}
for (const [icon, slug] of Object.entries(icons)) {
  icons[icon] = registerModel(slug, icon);
}
for (const [icon, slugs] of Object.entries(variants)) {
  if (!Object.hasOwn(icons, icon)) throw new Error(`Unknown variant icon ${icon}`);
  const related = [...new Set(slugs.map(slug => registerModel(slug, icon)))].filter(slug => slug !== icons[icon]);
  if (related.length > 4) throw new Error(`Icon ${icon} has more than five candidates`);
  if (related.length) variants[icon] = related;
  else delete variants[icon];
}

const required = new Set(manifest.assets.filter(asset => asset.kind === 'icon' || asset.kind === 'scale-fg')
  .map(asset => asset.slug));
const packs = {};
for (const pack of packFile.packs) {
  for (const item of pack.items) {
    if (item.generic || (item.kind !== 'icon' && item.kind !== 'scale')) continue;
    required.add(item.asset_slug);
    if (Object.hasOwn(icons, item.asset_slug)) packs[`pack:${pack.id}:${item.id}`] = item.asset_slug;
  }
}
const missing = [...required].filter(slug => !Object.hasOwn(icons, slug));
if (missing.length) throw new Error(`Missing 3D links: ${missing.join(', ')}`);

function section(records) {
  return Object.entries(records).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n');
}

const sections = Object.entries({ icons, variants, packs, models }).map(([key, records]) =>
  `  "${key}": {\n${section(records)}\n  }`);
await writeFile(new URL(linksPath, root), `{\n${sections.join(',\n')}\n}\n`);
console.log(`Resolved ${required.size} library objects and ${Object.keys(packs).length} pack entries.`);
