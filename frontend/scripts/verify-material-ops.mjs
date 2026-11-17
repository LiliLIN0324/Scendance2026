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
    if (sessionStorage.getItem('__opsSeed') === '1') return;
    sessionStorage.setItem('__opsSeed', '1');
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
await page.screenshot({ path: join(OUT, '38-debug.png') });
console.log('debug text:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 260).replace(/\n/g, ' | ')));
console.log('debug facilities:', await page.evaluate(key => (JSON.parse(localStorage.getItem(key) ?? 'null')?.plan?.facilities ?? []).length, seeded.key));
if (!selected) { await browser.close(); process.exit(1); }
await page.waitForTimeout(500);

const readPlan = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.plan ?? null, seeded.key);

// ① 物料清单
await page.getByRole('button', { name: '物料清单' }).first().click();
await page.waitForSelector('[aria-label="清单内容"]', { timeout: 10_000 });
const bom = await page.evaluate(() => document.querySelector('[aria-label="清单内容"]')?.textContent ?? '');
console.log('bom lines:', bom.split('\n').length);
console.log('bom has 3 items:', bom.includes('合计 3 件'));
console.log('bom marks unpriced:', bom.includes('未定价'), '| no currency:', !/[¥￥]|元/.test(bom));
console.log('bom excerpt:', JSON.stringify(bom.slice(0, 120)));

// ② 套装：6 组洽谈，4 人一桌
const input = page.getByLabel('一句话布置或改材质').first();
await input.fill('6 组洽谈，4 人一桌，留 2 米通道');
await input.press('Enter');
let plan = null;
for (let i = 0; i < 25; i += 1) {
  await page.waitForTimeout(1000);
  plan = await readPlan();
  if ((plan?.facilities?.length ?? 0) >= 33) break;
}
const added = (plan?.facilities ?? []).slice(3);
const tables = added.filter(f => f.templateId === 'table');
const chairs = added.filter(f => f.templateId === 'chair');
console.log('added:', added.length, 'tables:', tables.length, 'chairs:', chairs.length);
const inside = p => p.x > 0 && p.x < 20 && p.y > 0 && p.y < 14;
console.log('all inside boundary:', added.every(f => inside(f.position)));
console.log('message:', await page.evaluate(() => document.body.innerText.match(/已排桌[^\n]*/)?.[0] ?? null));
console.log('table sample:', JSON.stringify(tables.slice(0, 2).map(f => ({ name: f.name, x: f.position.x, y: f.position.y }))));
await page.screenshot({ path: join(OUT, '37-suite.png') });
await browser.close();
