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
    if (sessionStorage.getItem('__onelineSeed') === '1') return;
    sessionStorage.setItem('__onelineSeed', '1');
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

const input = page.getByLabel('一句话布置或改材质').first();
console.log('input present:', await input.count());

// ① 材质语言：全部换深木
await input.fill('全部换深木');
await input.press('Enter');
await page.waitForTimeout(900);
const afterMaterial = await page.evaluate(key => {
  const record = JSON.parse(localStorage.getItem(key) ?? 'null');
  return (record?.plan?.facilities ?? []).map(f => ({ name: f.name, preset: f.materialPreset ?? null }));
}, seeded.key);
console.log('after material:', JSON.stringify(afterMaterial));
console.log('message:', await page.evaluate(() => document.body.innerText.match(/已把[^\n]*/)?.[0] ?? null));

// ② 一句话布置：30 人观礼要能坐，留 2 米通道
await input.fill('30 人观礼要能坐，留 2 米通道');
await input.press('Enter');
let arranged = null;
for (let i = 0; i < 30; i += 1) {
  await page.waitForTimeout(1000);
  arranged = await page.evaluate(key => {
    const record = JSON.parse(localStorage.getItem(key) ?? 'null');
    const facilities = record?.plan?.facilities ?? [];
    return facilities.length > 3 ? facilities : null;
  }, seeded.key);
  if (arranged) break;
}
console.log('facility count:', arranged?.length ?? 'timeout');
if (arranged) {
  const added = arranged.slice(3);
  const boundary = [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 10 }, { x: 0, y: 10 }];
  const inside = p => {
    let hit = false;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i, i += 1) {
      const a = boundary[i], b = boundary[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  console.log('added sample:', JSON.stringify(added.slice(0, 3).map(f => ({ x: f.position.x, y: f.position.y, slug: f.modelOverride, preset: f.materialPreset ?? null }))));
  console.log('all inside boundary:', added.every(f => inside(f.position)));
  console.log('distinct sizes:', JSON.stringify([...new Set(added.map(f => `${f.size.width}x${f.size.depth}`))]));
}
console.log('message2:', await page.evaluate(() => document.body.innerText.match(/已按需求[^\n]*/)?.[0] ?? null));
await page.screenshot({ path: join(OUT, '33-oneline-2d.png') });
await browser.close();
