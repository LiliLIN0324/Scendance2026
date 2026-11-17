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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', m => { if (m.type() === 'error' || /retarget|Crowd|wave/i.test(m.text())) console.log('[console]', m.text().slice(0, 240)); });

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
    boundary: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }],
    facilities: [],
    workers: [{ id: uuid(), role: '演员', count: 2, position: { x: 5, y: 4 }, notes: '' }],
    routes: [],
    zones: [],
  };
  return { key, record: { ...record, plan } };
});
if (!seeded) throw new Error('no project');
await page.addInitScript(({ key, record }) => {
  try {
    if (sessionStorage.getItem('__waveSeed') === '1') return;
    sessionStorage.setItem('__waveSeed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(4000);
const skip = page.getByRole('button', { name: /跳过引导/ }).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(500); }

const toggle = page.getByRole('button', { name: /3D|三维/ }).first();
await toggle.click();
await page.waitForTimeout(9000);
for (let i = 0; i < 6; i += 1) { await page.screenshot({ path: join(OUT, `40-wave-pre-${i}.png`) }); await page.waitForTimeout(250); }

const before = await page.evaluate(() => (window.__personActionStates?.() ?? []).map(a => ({ id: a.id, current: a.current, wave: a.hasClips?.wave })));
console.log('before:', JSON.stringify(before));
console.log('crowdWave:', JSON.stringify(await page.evaluate(() => window.__crowdWave ?? null)));
const walk = await page.evaluate(() => window.__peopleWalkStates?.() ?? []);
console.log('walk:', JSON.stringify(walk.map(w => ({ id: w.id, x: Number(w.x.toFixed(2)), z: Number(w.z.toFixed(2)), follower: w.hasFollower }))));

const target = (before[0] && walk.find(w => w.id === before[0].id)) || walk[0];
if (target) {
  const hit = await page.evaluate(({ x, z }) => window.__setPersonAction?.({ x, z }, 'wave', 1000), { x: target.x, z: target.z });
  console.log('wave hit:', hit);
  await page.waitForTimeout(700);
  for (let i = 0; i < 5; i += 1) { await page.screenshot({ path: join(OUT, `41-wave-${i}.png`) }); await page.waitForTimeout(260); }
  const after = await page.evaluate(() => (window.__personActionStates?.() ?? []).map(a => ({ id: a.id, current: a.current })));
  console.log('after:', JSON.stringify(after));
}
await browser.close();
