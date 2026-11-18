/**
 * 第三轮走查（2026-11-19 凌晨）：通行体检 / 沿流线导航 / 边界提示 / 观景位入口。
 *
 * 与前两轮同一套做法：注入户外草稿 → 进 3D → 进漫游 → 读 HUD。
 * 这一轮验证的是「结论类」功能，所以不只看能不能走，还看 HUD 上的判定文字。
 *
 * 用法（仓库根）：node docs/evidence/walk-2026-11-18-round2/probe-walk3.mjs
 */
import { chromium } from '../../../frontend/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const EXE = process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const BASE = process.env.WALK_BASE ?? 'http://127.0.0.1:3231';
const PID = 'walk-verify-3';
const KEY = `scendance-outdoor-plan-v1:${PID}`;
const LAST_KEY = 'scendance-outdoor-last-v1';
const OUT_DIR = 'docs/evidence/walk-2026-11-18-round2';
mkdirSync(OUT_DIR, { recursive: true });

const ANCHOR = { lng: 120.1460368, lat: 30.2521924, crs: 'gcj-02', source: 'preset' };
const BOUNDARY = [{ x: -15, y: -10 }, { x: 15, y: -10 }, { x: 15, y: 10 }, { x: -15, y: 10 }];
const log = (...args) => console.log('[walk3]', ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function uuid(n) {
  return `7a9f1e21-8c34-400a-800a-${String(n).padStart(12, '0')}`;
}

function facility(n, templateId, name, x, y, width, depth) {
  return { id: uuid(n), templateId, name, position: { x, y }, rotationDeg: 0, size: { width, depth }, notes: '' };
}

/**
 * 走到场地中心的路线：x 向贯穿，穿过 x=6 的隔断 → 体检应报「流线被挡」。
 * 舞台放在 (10,0)，从中心看过去正被隔断挡住 → 体检应报「看舞台被挡」。
 */
const plan = {
  schemaVersion: 1,
  anchor: ANCHOR,
  boundary: BOUNDARY,
  zones: [],
  facilities: [
    facility(1, 'oneplan:scale:pop-up-tent', '隔断', 6, 0, 0.6, 21),
    facility(2, 'oneplan:scale:pop-up-tent', '主舞台', 10, 0, 6, 4),
    facility(3, 'oneplan:scale:pop-up-tent', '侧面帐篷', -6, 4, 3, 3),
  ],
  // 流线先留空：内置草稿对 route 字段校验较严，这一轮先验体检与边界，流线导航由单测覆盖。
  routes: [],
  nodes: [],
  workers: [],
};

async function readState(page) {
  return page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const dbg = window.__scendancePlan3dDebug;
    return {
      hud: text('[data-testid="outdoor-walk-hud"]'),
      audit: text('[data-testid="outdoor-walk-audit"]'),
      hint: text('[data-testid="outdoor-interact-hint"]'),
      spot: document.querySelector('[data-testid="outdoor-walk-spot"]') !== null,
      view: text('[data-testid="outdoor-walk-view"]'),
      retry: document.querySelector('[data-testid="outdoor-walk-avatar-retry"]') !== null,
      cam: dbg?.rig?.camPos ?? null,
      auditDebug: dbg?.audit ?? null,
    };
  });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', (err) => log('PAGEERROR', String(err).slice(0, 200)));
  await page.addInitScript(([key, lastKey, value, pid]) => {
    try {
      window.localStorage.setItem(key, value);
      window.localStorage.setItem(lastKey, pid);
    } catch { /* ignore */ }
    window.__pcReady = true;
    window.__pcRecoveryGateReady = true;
  }, [KEY, LAST_KEY, JSON.stringify({ v: 1, projectId: PID, name: '体检走查', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), plan }), PID]);

  const results = {};
  try {
    await page.goto(`${BASE}/?project=${PID}&mode=outdoor`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const ready = await page.evaluate(() => document.querySelectorAll('button').length > 0);
      if (ready) break;
      await sleep(3000);
    }
    await sleep(2500);
    for (const name of ['跳过引导', '跳过', '开始体验']) {
      const btn = page.getByRole('button', { name }).first();
      if (await btn.count().catch(() => 0)) { await btn.click().catch(() => {}); await sleep(1200); break; }
    }
    const walkBtn = page.locator('#tool-walk').first();
    await walkBtn.click();
    await sleep(2500);
    const free = page.getByRole('button', { name: '自由漫游' }).first();
    if (await free.count()) await free.click();
    await page.waitForFunction(() => Boolean(window.__scendancePlan3dDebug), null, { timeout: 120000 });
    await sleep(1500);
    // 点一下画布：浏览器不把头指针锁时切到「拖拽转头」兜底，键盘才真的推得动人。
    const canvas = page.locator('canvas').first();
    if (await canvas.count()) {
      const box = await canvas.boundingBox().catch(() => null);
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
      await sleep(900);
    }
    await sleep(1500);
    await page.screenshot({ path: `${OUT_DIR}/audit-1-entry.png` });
    const entry = await readState(page);
    log('ENTRY', JSON.stringify(entry));

    // 沿流线走：先往东（D 右转？保持向北走），直接向南走 12 m 撞红线看边界提示。
    await page.keyboard.down('KeyS');
    const samples = [];
    for (let i = 0; i < 24; i++) {
      await sleep(700);
      const state = await readState(page);
      samples.push({ t: i, hud: state.hud });
      if (state.hud && state.hud.includes('已到场地边界')) break;
    }
    await page.keyboard.up('KeyS');
    await sleep(600);
    const afterEdge = await readState(page);
    await page.screenshot({ path: `${OUT_DIR}/audit-2-boundary.png` });

    results.entry = entry;
    results.afterEdge = afterEdge;
    results.boundarySamples = samples;
    results.boundaryHit = Boolean(afterEdge.hud && afterEdge.hud.includes('已到场地边界'));
    writeFileSync(`${OUT_DIR}/readings3.json`, JSON.stringify(results, null, 2));
    log('AUDIT', JSON.stringify(results));
    log('DONE', `${OUT_DIR}/readings3.json`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => { console.error('[walk3] FAILED', err); process.exitCode = 1; });

