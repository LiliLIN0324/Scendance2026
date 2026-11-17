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
      { id: uuid(), templateId: 'stage-platform-8x6', name: '主舞台', position: { x: 10, y: 2.5 }, rotationDeg: 0, size: { width: 8, depth: 3 }, notes: '' },
      { id: uuid(), templateId: 'chair', name: '金属椅', position: { x: 10, y: 9 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145' },
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
    if (sessionStorage.getItem('__v8Seed') === '1') return;
    sessionStorage.setItem('__v8Seed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(4500);
const skip = page.getByRole('button', { name: /跳过引导/ }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(500); }

const readPlan = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.plan ?? null, seeded.key);

// ① 选中椅子 → 设置角色
let selected = false;
for (const [x, y] of [[990, 570], [970, 585], [1010, 585], [990, 555], [990, 600], [990, 487]]) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  if (await page.getByLabel('设施角色').count()) { selected = true; break; }
}
console.log('selection opened:', selected);
if (!selected) { await page.screenshot({ path: join(OUT, '46-role-debug.png') }); await browser.close(); process.exit(1); }
await page.getByLabel('设施角色').first().selectOption('service');
await page.waitForTimeout(600);
let plan = await readPlan();
const chair = plan.facilities.find(f => f.name === '金属椅');
console.log('role saved:', chair?.role ?? null);

// ② 单侧摊位：预览 → 3D 幽灵 → 落库
const input = page.getByLabel('一句话布置或改材质').first();
await input.fill('6 个摊位，单侧一排，留 2.2 米通道');
await input.press('Enter');
await page.waitForSelector('[aria-label="落位预览"]', { timeout: 30_000 });
console.log('preview:', await page.evaluate(() => document.querySelector('[aria-label="落位预览"]')?.textContent?.trim() ?? ''));
console.log('message:', await page.evaluate(() => document.body.innerText.match(/预览：摊位[^\n]*/)?.[0] ?? null));
await page.screenshot({ path: join(OUT, '46-stalls-single.png') });

const toggle = page.locator('#tool-view-toggle');
await toggle.click();
await page.waitForFunction(() => document.querySelector('#tool-view-toggle')?.getAttribute('aria-pressed') === 'true', null, { timeout: 30_000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: join(OUT, '46-ghost-3d.png') });
await toggle.click();
await page.waitForTimeout(1800);

await page.getByRole('button', { name: '落库' }).first().click();
await page.waitForTimeout(1200);
plan = await readPlan();
const stalls = plan.facilities.filter(f => f.templateId === 'booth-2x2');
console.log('stalls:', stalls.length,
  'single column:', new Set(stalls.map(f => f.position.x.toFixed(2))).size === 1,
  'face aisle:', stalls.every(f => f.rotationDeg === 90));

// ③ 报价单抬头
await page.getByRole('button', { name: '物料清单' }).first().click();
await page.waitForSelector('[aria-label="清单内容"]', { timeout: 10_000 });
await page.getByLabel('报价单-项目名').fill('秋季发布会');
await page.getByLabel('报价单-客户').fill('星河品牌部');
await page.getByLabel('报价单-有效期').fill('2026-12-31');
await page.getByLabel('报价单-报价人').fill('幕景策划');
await page.screenshot({ path: join(OUT, '47-quote-meta.png') });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20_000 }),
  page.getByRole('button', { name: '导出报价单' }).first().click(),
]);
const file = join(OUT, '47-quote.html');
await download.saveAs(file);
const html = readFileSync(file, 'utf8');
console.log('quote project:', html.includes('秋季发布会'));
console.log('quote client:', html.includes('客户：星河品牌部'));
console.log('quote validity:', html.includes('有效期至：2026-12-31'));
console.log('quote author:', html.includes('报价人：幕景策划'));
await browser.close();
