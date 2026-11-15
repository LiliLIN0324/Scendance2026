/**
 * 从 3dassets.dev（CC0 1.0）补真实模型进统一模型库。
 *
 * 为什么需要它：素材库 500+ 图标里有大量「家具 / 摊位 / 围挡 / 道具」类图标没有对应 3D 模型，
 * 靠关键词把伞塞给帐篷只是权宜；用户要的是真素材（2026-11-15）。
 *
 * 两种模式：
 *  - 默认：抓 `CURATED` 里人工审过的 slug（新模型一律走这里，避免抓到不相干的零件）；
 *  - `--discover`：按关键词探索候选（只打印，不入库）。
 *
 * 产物：
 *  - assets/library/model/<slug>.glb、assets/library/thumb/<slug>.webp
 *  - assets/library/incoming-extra.json（与 model200.json 同构）
 *  - assets/library/labels.zh.json 追加中文名 + 分类（只补缺，不覆盖已有）
 *
 * 质量闸门：只收 CC0、三角形 ≤ 60k、文件 ≤ 2.5 MB、单边 ≤ 20 m（挡掉整场景/地形块）。
 * 尺寸取平台 meta 的真实包围盒：glTF 是 Y-up，X→宽、Z→深、Y→高（与既有目录轴序一致）。
 *
 * 用法：
 *   node scripts/fetch-open-models.mjs --dry         # 只看会抓什么
 *   node scripts/fetch-open-models.mjs               # 真抓
 *   node scripts/fetch-open-models.mjs --discover --keyword "picnic bench"
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dry: { type: 'boolean', default: false },
    discover: { type: 'boolean', default: false },
    keyword: { type: 'string' },
  },
});

const API = 'https://3dassets.dev/api/assets';
const CDN = 'https://cdn.3dassets.dev/';
const root = new URL('../', import.meta.url);
const extraPath = new URL('assets/library/incoming-extra.json', root);
const labelsPath = new URL('assets/library/labels.zh.json', root);

/**
 * 人工审过的补库清单（2026-11-15）：真实 CC0 家具/摊位/围挡/道具，只补素材库确实缺口
 * 且语义能一句对上的族。第三列是 build-model-library.mjs 的分类键。
 * 刻意不收：厨房内嵌件、登月/外星球场景、玻璃房构件、车辆配件、纯标牌图案——
 * 它们是别的场景的零件，搬进活动场地库只会让用户挑到不相干的东西。
 */
const CURATED = [
  ['street-food-market-and-food-trucks-picnic-bench-0f446ae7', '野餐长椅', 'seating'],
  ['retail-store-fixtures-and-mall-back-to-back-bench-8640042d', '背靠背长椅', 'seating'],
  ['office-lobby-and-facilities-visitor-sofa-three-seat-0919a142', '访客沙发（三人）', 'seating'],
  ['cozy-home-interiors-sofa-three-seat-8d2d33f9', '布艺沙发（三人）', 'seating'],
  ['care-home-and-day-room-high-back-armchair-green-a759c0d7', '高背扶手椅', 'seating'],
  ['office-lobby-and-facilities-lobby-armchair-b7009456', '大堂扶手椅', 'seating'],
  ['izakaya-alley-and-ramen-shop-folding-chair-dbe1ca77', '折叠椅', 'seating'],
  ['caravan-park-and-campsite-camping-chair-390fe145', '野营折叠椅', 'seating'],
  ['bakery-and-cafe-bar-stool-counter-ec2e9883', '吧台高脚凳', 'seating'],
  ['bakery-and-cafe-cafe-table-4-person-bf74a9a9', '四人咖啡桌', 'tables'],
  ['city-park-and-playground-picnic-table-97b71a11', '木质野餐桌', 'tables'],
  ['village-hall-and-community-events-trestle-table-6cb6b682', '折叠长桌', 'tables'],
  ['hotel-and-resort-operations-poolside-table-and-parasol-2a52833a', '池畔桌配遮阳伞', 'tables'],
  ['street-food-market-and-food-trucks-stall-counter-modul-2f352fdb', '摊位台面模块', 'exhibition'],
  ['street-food-market-and-food-trucks-bar-stall-with-taps-34a0fc7b', '带龙头吧台摊位', 'exhibition'],
  ['airport-terminal-and-ground-operations-self-service-ki-70dc7b17', '自助服务亭', 'exhibition'],
  ['fast-food-and-drive-thru-self-order-kiosk-floor-272961e1', '自助点单机', 'digital'],
  ['armoured-column-and-field-camp-command-tent-5c85fae1', '指挥帐篷', 'structure'],
  ['beach-surf-and-paddle-kit-pop-up-changing-tent-5762c0fa', '快开更衣帐篷', 'structure'],
  ['theatre-stage-and-backstage-stage-deck-module-5173fe61', '舞台台面模块', 'stage'],
  ['indian-bazaar-street-and-temple-potted-plant-group-f4a7cda5', '盆栽组合', 'plants'],
  ['izakaya-alley-and-ramen-shop-potted-plant-in-can-ca363621', '罐栽植物', 'plants'],
  ['botanical-glasshouse-and-palm-house-botanical-glasshou-c857c466', '方形木质棕榈花箱', 'plants'],
  ['greek-island-village-and-harbour-stone-planter-5303d8e8', '石花箱', 'plants'],
  ['car-park-and-road-vehicle-fleet-entry-barrier-7cb4f555', '道闸（抬杆）', 'logistics'],
  ['beach-surf-and-paddle-kit-dune-fence-run-cf3f7f77', '沙丘栅栏', 'structure'],
  ['airport-terminal-and-ground-operations-perimeter-fence-f8a14e9f', '周界围栏', 'structure'],
  ['hero-shooter-harbour-payload-quay-bollard-f41b9701', '铸铁隔离柱', 'structure'],
  ['motorway-services-and-truck-park-traffic-cone-338a0889', '交通锥', 'logistics'],
  ['lawn-mowing-simulator-kit-barbecue-with-lid-2af11b0a', '带盖烧烤炉', 'food'],
  ['beach-surf-and-paddle-kit-cooler-box-3c6c2b15', '保温箱', 'food'],
  ['theme-park-rides-and-coasters-theme-park-rides-and-coa-024387cb', '冰淇淋亭', 'food'],
  ['street-food-market-and-food-trucks-ice-cream-van-6da2c4e2', '冰淇淋车', 'vehicles'],
  ['bakery-and-cafe-espresso-machine-2-group-60882cf3', '双头咖啡机', 'food'],
  ['nightclub-and-dj-booth-beer-tap-font-7c18dba3', '四头啤酒龙头', 'food'],
  ['computers-and-desk-gadgets-speaker-bookshelf-90b50703', '书架音箱', 'audio'],
  ['cinema-multiplex-and-foyer-wall-speaker-on-mount-ac24c00d', '壁挂环绕音箱', 'audio'],
  ['hot-air-balloon-festival-event-floodlight-mast-fcfa3f16', '活动投光灯塔', 'lighting'],
  ['football-soccer-club-grounds-floodlight-mast-282b2db3', '四灯投光灯塔', 'lighting'],
  ['wedding-and-chapel-kit-lantern-post-c06e501d', '花园灯柱', 'lighting'],
  ['restaurant-kitchen-and-dining-hand-wash-basin-8a6818d3', '洗手盆（按压龙头）', 'logistics'],
  ['japanese-school-and-city-street-water-fountain-41607d12', '直饮水机', 'logistics'],
  ['halloween-slasher-street-metal-trash-can-7b4be17a', '金属垃圾桶', 'logistics'],
  ['theme-park-rides-and-coasters-theme-park-rides-and-coa-486efc8a', '分类回收桶', 'logistics'],
  ['caravan-park-and-campsite-bin-and-recycling-store-beed8b68', '垃圾与回收房', 'logistics'],
  ['motorcycle-racing-and-street-bikes-trackside-bike-rack-dd2988a6', '四位置自行车架', 'sports'],
  ['gym-and-fitness-studio-locker-bank-open-door-bd2cea7d', '六门储物柜', 'storage'],
  ['office-lobby-and-facilities-staff-locker-bank-aaf13317', '员工储物柜', 'storage'],
  ['hardware-store-and-diy-warehouse-tool-box-00f4820f', '工具箱', 'tools'],
  ['car-factory-production-line-pallet-with-parts-crates-631a2a1a', '托盘带周转箱', 'logistics'],
  ['hot-air-balloon-festival-balloon-basket-trolley-a25aabce', '手推车', 'logistics'],
  ['vertical-farm-and-hydroponics-tower-vertical-farm-and--6e684ade', '平板推车', 'logistics'],
];

const MAX_BYTES = 2_500_000;
const MAX_TRIANGLES = 60_000;
const MAX_SIDE_M = 20;

const round = (n) => Math.round(n * 1e6) / 1e6;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
}

async function binary(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

const merged = JSON.parse(await readFile(new URL('assets/library/merged.json', root), 'utf8'));
const existing = new Set((merged.models ?? []).map((model) => model.slug));
let extra = { models: [], repairs: [] };
try {
  extra = JSON.parse(await readFile(extraPath, 'utf8'));
} catch {
  /* 首次运行没有这个文件。 */
}
const taken = new Set([...existing, ...extra.models.map((model) => model.slug)]);

function measurement(doc) {
  const box = doc.stats?.boundingBox;
  if (!box?.min || !box?.max) return null;
  const width = box.max[0] - box.min[0];
  const depth = box.max[2] - box.min[2];
  const height = box.max[1] - box.min[1];
  if (![width, depth, height].every((n) => Number.isFinite(n) && n > 0.05 && n <= MAX_SIDE_M)) return null;
  return { width: round(width), depth: round(depth), height: round(height) };
}

function acceptable(doc) {
  if (doc?.license?.slug !== 'cc0-1.0') return false;
  if (!doc.files?.publishedKey || !doc.thumbnail?.thumbKey) return false;
  const stats = doc.stats ?? {};
  if (!(stats.triangles > 0) || stats.triangles > MAX_TRIANGLES) return false;
  if (!(stats.fileSize > 0) || stats.fileSize > MAX_BYTES) return false;
  return true;
}

if (values.discover) {
  const keyword = values.keyword ?? 'bench';
  const payload = await json(
    // `search` 参数在这个站上被忽略（永远返回默认列表），必须用 where[title][like]。
    `${API}?where[title][like]=${encodeURIComponent(keyword)}&limit=20&sort=-downloads`,
  );
  for (const doc of payload.docs ?? []) {
    console.log(`${doc.slug}\t${doc.title}\t${doc.stats?.triangles}\t${doc.stats?.fileSize}`);
  }
  process.exit(0);
}

const picked = [];
for (const [slug, nameZh, bucket] of CURATED) {
  if (taken.has(slug)) {
    console.log(`skip (already in library): ${slug}`);
    continue;
  }
  const payload = await json(`${API}?where[slug][equals]=${encodeURIComponent(slug)}&limit=1`);
  const doc = (payload.docs ?? [])[0];
  if (!doc) {
    console.warn(`missing upstream: ${slug}`);
    continue;
  }
  if (!acceptable(doc)) {
    console.warn(`rejected by quality gate: ${slug} (tri=${doc.stats?.triangles} bytes=${doc.stats?.fileSize} license=${doc.license?.slug})`);
    continue;
  }
  const size = measurement(doc);
  if (!size) {
    console.warn(`rejected by size gate: ${slug}`);
    continue;
  }
  picked.push({ doc, nameZh, bucket, ...size });
}

console.log(`picked ${picked.length} models`);
if (values.dry) {
  console.log(picked.map((p) => `${p.doc.slug}\t${p.nameZh}\t${p.width}×${p.depth}×${p.height}`).join('\n'));
  process.exit(0);
}

await mkdir(new URL('assets/library/model/', root), { recursive: true });
await mkdir(new URL('assets/library/thumb/', root), { recursive: true });

for (const item of picked) {
  const { doc } = item;
  const glbUrl = `${CDN}${doc.files.publishedKey}`;
  const thumbUrl = `${CDN}${doc.thumbnail.thumbKey}`;
  const [glb, thumb] = await Promise.all([binary(glbUrl), binary(thumbUrl)]);
  if (glb.length !== doc.stats.fileSize) console.warn(`size mismatch ${doc.slug}: ${glb.length} vs ${doc.stats.fileSize}`);
  if (thumb.length < 20) throw new Error(`thumb download failed: ${doc.slug}`);
  await writeFile(new URL(`assets/library/model/${doc.slug}.glb`, root), glb);
  await writeFile(new URL(`assets/library/thumb/${doc.slug}.webp`, root), thumb);
  extra.models.push({
    slug: doc.slug,
    name: doc.title,
    sourceFile: doc.files.publishedKey.replace(/^assets\//, ''),
    sourceCategory: doc.category?.slug ?? 'open-extra',
    width: item.width,
    depth: item.depth,
    height: item.height,
    bytes: glb.length,
    triangles: doc.stats.triangles,
    sha256: sha256(glb),
    cdnUrl: glbUrl,
    page: `https://3dassets.dev/assets/${doc.slug}`,
    license: {
      slug: 'cc0-1.0',
      name: 'CC0 1.0 Universal',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attributionRequired: false,
    },
    glb: `assets/library/model/${doc.slug}.glb`,
    thumb: `assets/library/thumb/${doc.slug}.webp`,
    keyword: 'curated',
  });
  process.stdout.write('.');
}

await writeFile(extraPath, JSON.stringify(extra, null, 2) + '\n');

// 中文名/分类只补缺，不覆盖既有条目：labels.zh.json 是人工维护的真源。
const labels = JSON.parse(await readFile(labelsPath, 'utf8'));
let added = 0;
for (const item of picked) {
  if (labels[item.doc.slug]) continue;
  labels[item.doc.slug] = { name: item.nameZh, bucket: item.bucket };
  added += 1;
}
await writeFile(labelsPath, JSON.stringify(labels, null, 2) + '\n');
console.log(`\nwrote ${picked.length} models (labels +${added}) to incoming-extra.json`);
