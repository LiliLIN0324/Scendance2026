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
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 500)));
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 500)); });
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
      { id: uuid(), templateId: 'chair', name: '折叠椅', position: { x: 10, y: 9 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', unitPrice: 88 },
      { id: uuid(), templateId: 'table', name: '圆桌', position: { x: 13, y: 9 }, rotationDeg: 0, size: { width: 1, depth: 1 }, notes: '' },
    ],
    workers: [], routes: [], zones: [],
  };
  return { key, record: { ...record, plan } };
});
if (!seeded) throw new Error('no project');
await page.addInitScript(({ key, record }) => {
  try {
    if (sessionStorage.getItem('__bomSeed') === '1') return;
    sessionStorage.setItem('__bomSeed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(4500);
const skip = page.getByRole('button', { name: /跳过引导/ }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(500); }
console.log('body:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 700));

let selected = false;
for (const [x, y] of [[990, 570], [970, 585], [1010, 585], [990, 555], [990, 600], [990, 487]]) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  if (await page.getByRole('button', { name: '物料清单' }).count()) { selected = true; break; }
}
console.log('selection opened:', selected);
if (!selected) { await page.screenshot({ path: join(OUT, '49-bom-debug.png') }); await browser.close(); process.exit(1); }

await page.getByRole('button', { name: '物料清单' }).first().click();
await page.waitForSelector('[aria-label="清单内容"]', { timeout: 10_000 });
const text = await page.evaluate(() => document.querySelector('[aria-label="清单内容"]')?.textContent ?? '');
console.log('has markdown pipe:', text.includes('|'));
console.log('headers:', await page.evaluate(() => [...document.querySelectorAll('[aria-label="清单内容"] th')].map(th => th.textContent?.trim())));
console.log('rows:', await page.evaluate(() => document.querySelectorAll('[aria-label="清单内容"] tbody tr').length));
console.log('footer:', await page.evaluate(() => document.querySelector('[aria-label="清单内容"]')?.lastElementChild?.textContent?.replace(/\s+/g, ' ').trim()));
await page.screenshot({ path: join(OUT, '49-bom-table.png') });
await browser.close();
