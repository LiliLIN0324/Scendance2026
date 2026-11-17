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
await page.waitForTimeout(5000);

const toggles = await page.evaluate(() => [...document.querySelectorAll('button,[role=button]')]
  .map(n => (n.getAttribute('aria-label') || n.textContent || '').replace(/\s+/g, ' ').trim())
  .filter(t => /3D|三维|视角|漫游|视图/.test(t)));
console.log('toggles:', JSON.stringify(toggles));

// 造方案：16×12 边界 + 两把椅子 + 两个 worker（uuid 由页面生成）。
const injected = await page.evaluate(() => {
  const last = localStorage.getItem('scendance-outdoor-last-v1');
  if (!last) return { ok: false, reason: 'no project' };
  const key = `scendance-outdoor-plan-v1:${last}`;
  const record = JSON.parse(localStorage.getItem(key) ?? 'null');
  if (!record?.plan) return { ok: false, reason: 'no plan' };
  const uuid = () => crypto.randomUUID();
  const plan = {
    ...record.plan,
    boundary: [
      { x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 12 }, { x: 0, y: 12 },
    ],
    facilities: [
      {
        id: uuid(), templateId: 'chair', name: '木质餐椅',
        position: { x: 5, y: 5 }, rotationDeg: 0, size: { width: 0.6, depth: 0.6 }, notes: '',
        modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145',
      },
      {
        id: uuid(), templateId: 'chair', name: '木质餐椅', position: { x: 7, y: 5 },
        rotationDeg: 0, size: { width: 0.6, depth: 0.6 }, notes: '',
        modelOverride: 'caravan-park-and-campsite-camping-chair-390fe145',
      },
    ],
    workers: [
      { id: uuid(), role: '演员', count: 2, position: { x: 4, y: 8 }, notes: '' },
      { id: uuid(), role: '志愿者', count: 2, position: { x: 11, y: 7 }, notes: '' },
    ],
    routes: [],
    zones: [],
  };
  localStorage.setItem(key, JSON.stringify({ ...record, plan }));
  return { ok: true, projectId: last, facilities: plan.facilities.length, workers: plan.workers.length };
});
console.log('injected:', injected);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: join(OUT, '20-plan-2d.png') });

const after = await page.evaluate(() => {
  const last = localStorage.getItem('scendance-outdoor-last-v1');
  const record = JSON.parse(localStorage.getItem(`scendance-outdoor-plan-v1:${last}`) ?? 'null');
  return {
    facilities: record?.plan?.facilities?.length ?? -1,
    workers: record?.plan?.workers?.length ?? -1,
    boundary: record?.plan?.boundary?.length ?? -1,
    bodyHasChair: document.body.innerText.includes('木质餐椅'),
  };
});
console.log('after reload:', after);

const toggle = page.getByRole('button', { name: /3D|三维/ }).first();
console.log('3D toggle count:', await page.getByRole('button', { name: /3D|三维/ }).count());
if (await toggle.count()) {
  await toggle.click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: join(OUT, '21-plan-3d.png') });
  // 遮挡时 rAF 会停：连拍强制出帧。
  for (let i = 0; i < 4; i += 1) await page.screenshot({ path: join(OUT, `22-3d-frame-${i}.png`) });
  const read = () => page.evaluate(() => ({
    walk: typeof window.__peopleWalkStates === 'function' ? window.__peopleWalkStates() : null,
    actions: typeof window.__personActionStates === 'function' ? window.__personActionStates() : null,
  }));
  const before = await read();
  // 遮挡时 rAF 会停：连拍强制出帧。
  for (let i = 0; i < 10; i += 1) {
    await page.screenshot({ path: join(OUT, `22-3d-frame-${i}.png`) });
    await page.waitForTimeout(400);
  }
  const after = await read();
  const moved = (before.walk ?? []).map(person => {
    const next = (after.walk ?? []).find(item => item.id === person.id);
    return {
      id: person.id,
      from: [Number(person.x.toFixed(2)), Number(person.z.toFixed(2))],
      to: next ? [Number(next.x.toFixed(2)), Number(next.z.toFixed(2))] : null,
      delta: next ? Number(Math.hypot(next.x - person.x, next.z - person.z).toFixed(2)) : null,
    };
  });
  console.log('moved:', JSON.stringify(moved, null, 2));
  console.log('sitting:', JSON.stringify((after.actions ?? []).filter(a => a.sitting), null, 2));
  console.log('clips:', JSON.stringify((after.actions ?? []).map(a => ({ id: a.id, current: a.current, clips: a.hasClips })), null, 2));
} else {
  console.log('no 3D toggle found; screenshot kept');
}

await browser.close();
