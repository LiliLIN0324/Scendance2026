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
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 240)));

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
    boundary: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 10 }, { x: 0, y: 10 }],
    facilities: [
      { id: uuid(), templateId: 'chair', name: '金属椅', position: { x: 4, y: 4 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145', materialPreset: 'steel' },
      { id: uuid(), templateId: 'chair', name: '深木椅', position: { x: 7, y: 4 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145', materialPreset: 'walnut' },
      { id: uuid(), templateId: 'chair', name: '原样椅', position: { x: 10, y: 4 }, rotationDeg: 0, size: { width: 0.7, depth: 0.7 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145' },
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
    if (sessionStorage.getItem('__materialSeed') === '1') return;
    sessionStorage.setItem('__materialSeed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: join(OUT, '30-material-2d.png') });

// 关掉首运引导（否则属性卡被遮住），再点选一把椅子读材质色块。
const skip = page.getByRole('button', { name: /跳过引导/ }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(600); }
await page.mouse.click(990, 530);
await page.waitForTimeout(800);
const selectedChips = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="材质快改"]');
  if (!group) return null;
  return [...group.querySelectorAll('button')].map(b => ({ label: b.textContent?.trim(), pressed: b.getAttribute('aria-pressed') }));
});
console.log('chips after click:', JSON.stringify(selectedChips));

const toggle = page.getByRole('button', { name: /3D|三维/ }).first();
await toggle.click();
await page.waitForTimeout(9000);
for (let i = 0; i < 8; i += 1) {
  await page.screenshot({ path: join(OUT, `31-material-3d-${i}.png`) });
  await page.waitForTimeout(300);
}
console.log('screenshots done');

// 回到 2D 选中一把椅子，读属性卡色块数量。
const back = page.getByRole('button', { name: /2D|平面/ }).first();
if (await back.count()) { await back.click(); await page.waitForTimeout(1200); }
const facilityText = await page.evaluate(() => document.body.innerText.includes('金属椅'));
console.log('2D shows chair name:', facilityText);
const chipState = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="材质快改"]');
  if (!group) return null;
  return [...group.querySelectorAll('button')].map(b => ({ label: b.textContent?.trim(), pressed: b.getAttribute('aria-pressed') }));
});
console.log('chips:', JSON.stringify(chipState));
await page.screenshot({ path: join(OUT, '32-material-panel.png') });
await browser.close();
