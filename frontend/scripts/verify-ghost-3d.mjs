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
  const plan = {
    ...record.plan,
    boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 14 }, { x: 0, y: 14 }],
    facilities: [
      { id: crypto.randomUUID(), templateId: 'stage-platform-8x6', name: '主舞台', position: { x: 10, y: 2.5 }, rotationDeg: 0, size: { width: 8, depth: 3 }, notes: '' },
      { id: crypto.randomUUID(), templateId: 'chair', name: '金属椅', position: { x: 10, y: 9 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145' },
    ],
    workers: [], routes: [], zones: [],
  };
  return { key, record: { ...record, plan } };
});
if (!seeded) throw new Error('no project');
await page.addInitScript(({ key, record }) => {
  try {
    if (sessionStorage.getItem('__ghostSeed') === '1') return;
    sessionStorage.setItem('__ghostSeed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(4500);
const skip = page.getByRole('button', { name: /跳过引导/ }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(500); }

let selected = false;
for (const [x, y] of [[990, 570], [970, 585], [1010, 585], [990, 555], [990, 600], [990, 487]]) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  if (await page.getByLabel('一句话布置或改材质').count()) { selected = true; break; }
}
console.log('selection opened:', selected);
if (!selected) { await page.screenshot({ path: join(OUT, '48-debug.png') }); await browser.close(); process.exit(1); }

const input = page.getByLabel('一句话布置或改材质').first();
await input.fill('8 个摊位，留 2.4 米通道');
await input.press('Enter');
await page.waitForSelector('[aria-label="落位预览"]', { timeout: 30_000 });
console.log('preview:', await page.evaluate(() => document.querySelector('[aria-label="落位预览"]')?.textContent?.trim() ?? ''));

const toggle = page.locator('#tool-view-toggle');
await toggle.click();
await page.waitForFunction(() => document.querySelector('#tool-view-toggle')?.getAttribute('aria-pressed') === 'true', null, { timeout: 30_000 });
await page.waitForTimeout(8000);
const fit = page.getByRole('button', { name: /定位到设计范围|回到框选场地/ }).first();
if (await fit.count()) { await fit.click().catch(() => {}); await page.waitForTimeout(2500); }
await page.screenshot({ path: join(OUT, '48-ghost-3d.png') });
console.log('pressed:', await page.getAttribute('#tool-view-toggle', 'aria-pressed'));
await browser.close();
