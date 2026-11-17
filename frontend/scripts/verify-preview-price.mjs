import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'ms-playwright');
const exe = ['chromium-1254', 'chromium-1252', 'chromium-1234']
  .map(build => join(root, build, 'chrome-win64', 'chrome.exe'))
  .find(existsSync);

const BASE = process.env.SCENDANCE_BASE ?? 'http://localhost:3107';
const OUT = join(process.cwd(), '..', 'deliverables', 'verify');
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
      { id: uuid(), templateId: 'table', name: '长桌', position: { x: 10, y: 7 }, rotationDeg: 0, size: { width: 4, depth: 4 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145', materialPreset: 'walnut' },
      { id: uuid(), templateId: 'chair', name: '金属椅', position: { x: 7, y: 7 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145', materialPreset: 'steel' },
      { id: uuid(), templateId: 'chair', name: '原样椅', position: { x: 13, y: 7 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145' },
    ],
    workers: [],
    routes: [],
    zones: [],
  };
  return { key, record: { ...record, plan } };
});
if (!seeded) throw new Error('no project to seed');
await page.addInitScript(({ key, record }) => {
  try {
    if (sessionStorage.getItem('__previewSeed') === '1') return;
    sessionStorage.setItem('__previewSeed', '1');
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

// ① 单价 + 清单金额
const price = page.getByLabel('单价（元）').first();
await price.fill('120');
await price.blur();
await page.waitForTimeout(600);
const priced = (await readPlan()).facilities.find(f => f.price !== undefined || f.unitPrice !== undefined);
console.log('unitPrice saved:', JSON.stringify(priced?.unitPrice ?? null));
await page.getByRole('button', { name: '物料清单' }).first().click();
await page.waitForSelector('[aria-label="清单内容"]', { timeout: 10_000 });
const bom = await page.evaluate(() => document.querySelector('[aria-label="清单内容"]')?.textContent ?? '');
console.log('bom has ¥120:', bom.includes('¥120'), '| totals:', bom.includes('已定价金额 ¥120'));

// ② 预览：候选先画幽灵，不落库
const input = page.getByLabel('一句话布置或改材质').first();
await input.fill('30 人观礼要能坐，留 2 米通道');
await input.press('Enter');
await page.waitForSelector('[aria-label="候选方案"]', { timeout: 30_000 });
const options = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="候选方案"]');
  return [...group.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(t => t && t !== '取消');
});
console.log('options:', JSON.stringify(options));
const beforePreview = (await readPlan()).facilities.length;
await page.getByRole('button', { name: options[0], exact: true }).first().click();
await page.waitForTimeout(800);
const previewState = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="落位预览"]');
  return group ? group.textContent?.trim() : null;
});
const duringPreview = (await readPlan()).facilities.length;
console.log('preview bar:', JSON.stringify(previewState));
console.log('plan untouched during preview:', duringPreview === beforePreview, `(${beforePreview} → ${duringPreview})`);
await page.screenshot({ path: join(OUT, '39-preview.png') });

await page.getByRole('button', { name: '落库' }).first().click();
await page.waitForTimeout(1200);
const afterCommit = (await readPlan()).facilities.length;
console.log('committed count:', afterCommit);
console.log('message:', await page.evaluate(() => document.body.innerText.match(/已落库[^\n]*/)?.[0] ?? null));
await page.screenshot({ path: join(OUT, '40-committed.png') });

// ③ 套装预览：不落库，取消后数量不变
await input.fill('2 组洽谈，4 人一桌');
await input.press('Enter');
await page.waitForSelector('[aria-label="落位预览"]', { timeout: 30_000 });
const suitePreview = await page.evaluate(() => document.querySelector('[aria-label="落位预览"]')?.textContent?.trim() ?? '');
console.log('suite preview:', JSON.stringify(suitePreview));
const duringSuite = (await readPlan()).facilities.length;
await page.getByRole('button', { name: '取消' }).first().click();
await page.waitForTimeout(600);
const afterCancel = (await readPlan()).facilities.length;
console.log('suite preview did not commit:', duringSuite === afterCommit && afterCancel === afterCommit);
await browser.close();
