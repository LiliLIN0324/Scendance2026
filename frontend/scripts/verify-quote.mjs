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
  const plan = {
    ...record.plan,
    boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 14 }, { x: 0, y: 14 }],
    facilities: [
      { id: uuid(), templateId: 'chair', name: '金属椅', position: { x: 10, y: 7 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145' },
    ],
    workers: [],
    routes: [],
    zones: [],
    priceBook: {},
  };
  return { key, record: { ...record, plan } };
});
if (!seeded) throw new Error('no project to seed');
await page.addInitScript(({ key, record }) => {
  try {
    if (sessionStorage.getItem('__quoteSeed') === '1') return;
    sessionStorage.setItem('__quoteSeed', '1');
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
const input = page.getByLabel('一句话布置或改材质').first();

// 第一次布置
await input.fill('30 人观礼要能坐，留 2 米通道');
await input.press('Enter');
await page.waitForSelector('[aria-label="候选方案"]', { timeout: 30_000 });
const optionName = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="候选方案"]');
  return [...group.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(t => t && t !== '取消')[0];
});
await page.getByRole('button', { name: optionName, exact: true }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: '落库' }).first().click();
await page.waitForTimeout(1000);
console.log('first commit:', (await readPlan()).facilities.length);

// 按型号定价
await page.getByRole('button', { name: '物料清单' }).first().click();
await page.waitForSelector('[aria-label="清单内容"]', { timeout: 10_000 });
const labels = await page.evaluate(() =>
  [...document.querySelectorAll('input[aria-label^="单价-"]')].map(input => input.getAttribute('aria-label')));
console.log('price labels:', JSON.stringify(labels));
const target = labels.find(label => label?.includes('折叠')) ?? labels[0];
const priceInput = page.getByLabel(target, { exact: true }).first();
await priceInput.fill('88');
await priceInput.blur();
await page.waitForTimeout(900);
const book = (await readPlan()).priceBook ?? {};
console.log('priceBook:', JSON.stringify(book));
console.log('priced count:', (await readPlan()).facilities.filter(f => f.unitPrice === 88).length);

// 第二次布置：同款应自动带价
await input.fill('30 人观礼要能坐，留 2 米通道');
await input.press('Enter');
await page.waitForSelector('[aria-label="候选方案"]', { timeout: 30_000 });
const optionName2 = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="候选方案"]');
  return [...group.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(t => t && t !== '取消')[0];
});
await page.getByRole('button', { name: optionName2, exact: true }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: '落库' }).first().click();
await page.waitForTimeout(1200);
const after = (await readPlan()).facilities;
const fresh = after.slice(31);
console.log('second commit total:', after.length, '| fresh inherit price:', fresh.length > 0 && fresh.every(f => f.unitPrice === 88));

// 报价单导出
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15_000 }),
  page.getByRole('button', { name: '导出报价单' }).first().click(),
]).catch(() => [null]);
if (download) {
  const html = readFileSync(await download.path(), 'utf8');
  console.log('quote html bytes:', html.length);
  console.log('quote has totals:', /¥\s?[\d.]+/.test(html), '| unpriced note:', html.includes('未定价'));
  console.log('quote title:', html.match(/<h1>([^<]+)</)?.[1] ?? null);
} else {
  console.log('quote download missing');
}
await page.screenshot({ path: join(OUT, '42-quote.png') });
await browser.close();
