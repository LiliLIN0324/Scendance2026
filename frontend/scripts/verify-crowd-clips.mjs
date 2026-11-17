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
page.on('console', m => { if (m.type() === 'error' || /retarget|Crowd/i.test(m.text())) console.log('[console]', m.text().slice(0, 240)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(3000);

// 只在导航前种一次，避免页面自动保存的竞态把注入方案冲掉。
const seeded = await page.evaluate(() => {
  const last = localStorage.getItem('scendance-outdoor-last-v1');
  if (!last) return null;
  const key = `scendance-outdoor-plan-v1:${last}`;
  const record = JSON.parse(localStorage.getItem(key) ?? 'null');
  if (!record?.plan) return null;
  const uuid = () => crypto.randomUUID();
  const plan = {
    ...record.plan,
    boundary: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 12 }, { x: 0, y: 12 }],
    facilities: [
      { id: uuid(), templateId: 'chair', name: '木质餐椅', position: { x: 5, y: 5 }, rotationDeg: 0, size: { width: 0.6, depth: 0.6 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145' },
      { id: uuid(), templateId: 'chair', name: '木质餐椅', position: { x: 7, y: 5 }, rotationDeg: 0, size: { width: 0.6, depth: 0.6 }, notes: '', modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145' },
    ],
    workers: [
      { id: uuid(), role: '演员', count: 2, position: { x: 4, y: 8 }, notes: '' },
      { id: uuid(), role: '志愿者', count: 2, position: { x: 11, y: 7 }, notes: '' },
    ],
    routes: [],
    zones: [],
  };
  return { key, record: { ...record, plan } };
});
if (!seeded) throw new Error('no project to seed');
await page.addInitScript(({ key, record }) => {
  try {
    if (sessionStorage.getItem('__crowdSeed') === '1') return;
    sessionStorage.setItem('__crowdSeed', '1');
    localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore */ }
}, seeded);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(6000);

const after = await page.evaluate(() => {
  const last = localStorage.getItem('scendance-outdoor-last-v1');
  const record = JSON.parse(localStorage.getItem(`scendance-outdoor-plan-v1:${last}`) ?? 'null');
  return {
    facilities: record?.plan?.facilities?.length ?? -1,
    workers: record?.plan?.workers?.length ?? -1,
    boundary: record?.plan?.boundary?.length ?? -1,
  };
});
console.log('after seed:', JSON.stringify(after));
if (after.workers < 1) throw new Error('seed lost');

const toggle = page.getByRole('button', { name: /3D|三维/ }).first();
if (!(await toggle.count())) throw new Error('no 3D toggle');
await toggle.click();
await page.waitForTimeout(9000);
for (let i = 0; i < 12; i += 1) {
  await page.screenshot({ path: join(OUT, `23-crowd-${i}.png`) });
  await page.waitForTimeout(350);
}

const read = () => page.evaluate(() => ({
  actions: typeof window.__personActionStates === 'function' ? window.__personActionStates() : null,
  walk: typeof window.__peopleWalkStates === 'function' ? window.__peopleWalkStates() : null,
}));
const state = await read();
const clips = (state.actions ?? []).map(a => ({ id: a.id, current: a.current, clips: a.hasClips, sitting: a.sitting }));
console.log('crowd:', JSON.stringify(clips, null, 2));

// 把挥手打到最近一个静止 crowd（座位上的两人），确认动作可播。
const first = (state.walk ?? []).find(w => !w.hasFollower) ?? (state.walk ?? [])[0];
if (first && (await page.evaluate(() => typeof window.__setPersonAction)) === 'function') {
  const hit = await page.evaluate(({ x, z }) => window.__setPersonAction?.({ x, z }, 'wave', 1000), { x: first.x, z: first.z });
  console.log('wave target:', hit);
  await page.waitForTimeout(1200);
  for (let i = 0; i < 4; i += 1) {
    await page.screenshot({ path: join(OUT, `24-wave-${i}.png`) });
    await page.waitForTimeout(300);
  }
  const waved = await page.evaluate(() => (window.__personActionStates?.() ?? []).map(a => ({ id: a.id, current: a.current })));
  console.log('after wave:', JSON.stringify(waved));
}
console.log('walk:', JSON.stringify((state.walk ?? []).map(w => ({ id: w.id, travelled: Number(w.travelled.toFixed(2)), hasFollower: w.hasFollower, attached: w.attached })), null, 2));
await page.screenshot({ path: join(OUT, '23-crowd-final.png') });
await browser.close();
