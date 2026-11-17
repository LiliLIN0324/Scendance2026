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
    if (sessionStorage.getItem('__arrangeV1Seed') === '1') return;
    sessionStorage.setItem('__arrangeV1Seed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(4500);

const skip = page.getByRole('button', { name: /跳过引导/ }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(500); }
await page.mouse.click(990, 530);
await page.waitForTimeout(800);

const readPlan = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.plan ?? null, seeded.key);
const before = await readPlan();
const selectedId = await page.evaluate(() => window.__planSelection?.() ?? null);
console.log('selected:', selectedId);

// ① 换一款：同能力同尺寸带
await page.getByRole('button', { name: '换一款' }).first().click();
await page.waitForTimeout(3500);
const swapNames = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="换款候选"]');
  if (!group) return null;
  return [...group.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(t => t && t !== '换一款' && t !== '找同款…');
});
console.log('swap candidates:', JSON.stringify(swapNames));
if (swapNames?.length) {
  await page.getByRole('button', { name: swapNames[0], exact: true }).first().click();
  await page.waitForTimeout(800);
}
const afterSwap = await readPlan();
console.log('facilities after swap:', JSON.stringify(afterSwap.facilities.map(f => ({ id: f.id.slice(0, 6), name: f.name, slug: f.modelOverride, size: f.size }))));
const swapped = afterSwap.facilities.find(f => {
  const origin = before.facilities.find(item => item.id === f.id);
  return origin && origin.modelOverride !== f.modelOverride;
}) ?? afterSwap.facilities[0];
const original = before.facilities.find(f => f.id === swapped.id);
console.log('swapped:', JSON.stringify({ name: swapped.name, slug: swapped.modelOverride, size: swapped.size }));
console.log('position kept:', original.position.x === swapped.position.x && original.position.y === swapped.position.y);
console.log('rotation kept:', original.rotationDeg === swapped.rotationDeg);
await page.screenshot({ path: join(OUT, '35-swap.png') });

// ② 一句话布置：先给 3 个候选，再落库
const input = page.getByLabel('一句话布置或改材质').first();
await input.fill('30 人观礼要能坐，留 2 米通道');
await input.press('Enter');
await page.waitForSelector('[aria-label="候选方案"]', { timeout: 30_000 });
const options = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="候选方案"]');
  return [...group.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(t => t && t !== '取消');
});
console.log('arrange options:', JSON.stringify(options));
await page.screenshot({ path: join(OUT, '34-arrange-options.png') });
const chosen = options[0];
await page.getByRole('button', { name: chosen, exact: true }).first().click();
await page.waitForTimeout(1200);
const arranged = await readPlan();
const added = arranged.facilities.slice(3);
console.log('committed:', added.length, 'slug:', added[0]?.modelOverride);
console.log('all same as chosen:', added.every(f => f.name === chosen));
const inside = p => p.x > 0 && p.x < 14 && p.y > 0 && p.y < 10;
console.log('all inside boundary:', added.every(f => inside(f.position)));
await page.screenshot({ path: join(OUT, '36-arrange-committed.png') });
await browser.close();
