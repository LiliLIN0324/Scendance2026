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
    if (sessionStorage.getItem('__stageSeed') === '1') return;
    sessionStorage.setItem('__stageSeed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(4500);

const skip = page.getByRole('button', { name: /跳过引导/ }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(500); }

// 选中一把椅子打开属性卡（舞台 1-4m，椅子在 9m，点靠下的位置）
let selected = false;
for (const [x, y] of [[990, 570], [970, 585], [1010, 585], [990, 555], [990, 600], [990, 487]]) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  if (await page.evaluate(() => !!document.querySelector('[aria-label="材质快改"]'))) { selected = true; break; }
}
console.log('selection opened:', selected);
if (!selected) { await page.screenshot({ path: join(OUT, '45-stage-debug.png') }); await browser.close(); process.exit(1); }

const readPlan = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.plan ?? null, seeded.key);
const input = page.getByLabel('一句话布置或改材质').first();
await input.fill('30 人观礼要能坐，留 2 米通道');
await input.press('Enter');
await page.waitForSelector('[aria-label="落位预览"]', { timeout: 30_000 });
console.log('preview:', await page.evaluate(() => document.querySelector('[aria-label="落位预览"]')?.textContent?.trim() ?? ''));
console.log('message:', await page.evaluate(() => document.body.innerText.match(/预览：观礼区[^\n]*/)?.[0] ?? null));
await page.screenshot({ path: join(OUT, '45-stage.png') });

await page.getByRole('button', { name: '落库' }).first().click();
await page.waitForTimeout(1200);
const plan = await readPlan();
const seats = plan.facilities.slice(2);
const stage = plan.facilities[0];
const stageBottom = stage.position.y + stage.size.depth / 2;
console.log('seats:', seats.length);
console.log('all face stage (180):', seats.every(seat => seat.rotationDeg === 180));
const front = Math.min(...seats.map(seat => seat.position.y - seat.size.depth / 2));
console.log('front clearance:', (front - stageBottom).toFixed(2), '>= 2:', front - stageBottom >= 2);
console.log('all behind stage:', seats.every(seat => seat.position.y > stageBottom));
await browser.close();
