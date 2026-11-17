import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'ms-playwright');
const exe = ['chromium-1254', 'chromium-1252', 'chromium-1234']
  .map(build => join(root, build, 'chrome-win64', 'chrome.exe'))
  .find(existsSync);

const BASE = process.env.SCENDANCE_BASE ?? 'http://localhost:3107';
const OUT = join(process.cwd(), '..', 'deliverables', 'verify');
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 200)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(2500);

const seeded = await page.evaluate(() => {
  const last = localStorage.getItem('scendance-outdoor-last-v1');
  if (!last) return null;
  const key = `scendance-outdoor-plan-v1:${last}`;
  const record = JSON.parse(localStorage.getItem(key) ?? 'null');
  if (!record?.plan) return null;
  const uuid = () => crypto.randomUUID();
  const chair = (name, x) => ({
    id: uuid(), templateId: 'chair', name, position: { x, y: 7 }, rotationDeg: 0,
    size: { width: 0.7, depth: 0.7 }, notes: '',
    modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145',
  });
  const plan = {
    ...record.plan,
    boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 14 }, { x: 0, y: 14 }],
    facilities: [chair('金属椅', 9.4), chair('深木椅', 10), chair('原样椅', 10.6)],
    workers: [],
    routes: [],
    zones: [],
  };
  return { key, record: { ...record, plan } };
});
if (!seeded) throw new Error('no project to seed');
await page.addInitScript(({ key, record }) => {
  try {
    if (sessionStorage.getItem('__priceBookSeed') === '1') return;
    sessionStorage.setItem('__priceBookSeed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(4500);

const skip = page.getByRole('button', { name: /跳过引导/ }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(500); }
let selected = false;
for (const [x, y] of [[990, 487], [970, 500], [1010, 500], [990, 470], [990, 505]]) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  if (await page.evaluate(() => !!document.querySelector('[aria-label="材质快改"]'))) { selected = true; break; }
}
console.log('selection opened:', selected);
if (!selected) { await browser.close(); process.exit(1); }

const readPlan = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.plan ?? null, seeded.key);

await page.getByRole('button', { name: '物料清单' }).first().click();
await page.waitForSelector('[aria-label="清单内容"]', { timeout: 10_000 });

const priceLabels = await page.evaluate(() =>
  [...document.querySelectorAll('input[aria-label^="单价-"]')].map(input => input.getAttribute('aria-label')));
console.log('price rows:', JSON.stringify(priceLabels));

const firstPrice = page.locator('input[aria-label^="单价-"]').first();
await firstPrice.fill('88');
await firstPrice.blur();
await page.waitForTimeout(900);

const facilities = (await readPlan()).facilities;
console.log('all same-model priced:', facilities.every(f => f.unitPrice === 88));
const bom = await page.evaluate(() => document.querySelector('[aria-label="清单内容"]')?.textContent ?? '');
console.log('bom total:', bom.match(/已定价金额[^\n]*/)?.[0] ?? null);
await page.screenshot({ path: join(OUT, '41-pricebook.png') });

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10_000 }),
  page.getByRole('button', { name: '导出 CSV' }).first().click(),
]);
const path = await download.path();
const csv = readFileSync(path, 'utf8');
console.log('csv header:', JSON.stringify(csv.split('\n')[0]));
console.log('csv total line:', JSON.stringify(csv.trim().split('\n').pop()));
console.log('csv has 88:', csv.includes(',88,'), '| 264:', csv.includes('264'));
await browser.close();
