/**
 * 第四轮走查：真实经典案例（Scotiabank replica，60 设施 / 4 条流线）+ 边界提示。
 *
 * 前一轮的 0% 已定位：注入草稿里的「隔断」被应用侧归一成 21×21 的方形占地，
 * 把进场点整个盖住，体检本身没错。这一轮改用仓库里的成熟案例（尺寸由模板决定，
 * 不会被归一成方形），看的才是体检真结论。
 *
 * 用法（仓库根）：node docs/evidence/walk-2026-11-18-round2/probe-walk4.mjs
 */
import { chromium } from '../../../frontend/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const EXE = process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const BASE = process.env.WALK_BASE ?? 'http://127.0.0.1:3233';
const PID = 'walk-verify-4';
const KEY = `scendance-outdoor-plan-v1:${PID}`;
const LAST_KEY = 'scendance-outdoor-last-v1';
const OUT_DIR = 'docs/evidence/walk-2026-11-18-round2';
mkdirSync(OUT_DIR, { recursive: true });

const log = (...args) => console.log('[walk4]', ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState(page) {
  return page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const dbg = window.__scendancePlan3dDebug;
    return {
      hud: text('[data-testid="outdoor-walk-hud"]'),
      audit: text('[data-testid="outdoor-walk-audit"]'),
      spot: document.querySelector('[data-testid="outdoor-walk-spot"]') !== null,
      view: text('[data-testid="outdoor-walk-view"]'),
      cam: dbg?.rig?.camPos ?? null,
      auditDebug: dbg?.audit ?? null,
    };
  });
}

async function main() {
  const plan = JSON.parse(readFileSync('.temp/scotiabank-case.json', 'utf8'));
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
  }, [KEY, LAST_KEY, JSON.stringify({ v: 1, projectId: PID, name: '经典案例走查', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), plan }), PID]);

  try {
    await page.goto(`${BASE}/?project=${PID}&mode=outdoor`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      if (await page.evaluate(() => document.querySelectorAll('button').length > 0)) break;
      await sleep(3000);
    }
    await sleep(2500);
    for (const name of ['跳过引导', '跳过', '开始体验']) {
      const btn = page.getByRole('button', { name }).first();
      if (await btn.count().catch(() => 0)) { await btn.click().catch(() => {}); await sleep(1200); break; }
    }
    const walkBtn = page.locator('#tool-walk').first();
    try {
      await walkBtn.click({ force: true, timeout: 20000 });
    } catch {
      await page.evaluate(() => document.querySelector('#tool-walk')?.click());
    }
    await sleep(3000);
    const free = page.getByRole('button', { name: '自由漫游' }).first();
    if (await free.count()) await free.click({ force: true }).catch(() => {});
    await page.waitForFunction(() => Boolean(window.__scendancePlan3dDebug), null, { timeout: 120000 });
    await sleep(1500);
    const canvas = page.locator('canvas').first();
    if (await canvas.count()) {
      const box = await canvas.boundingBox().catch(() => null);
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
      await sleep(900);
    }
    await sleep(1500);
    await page.screenshot({ path: `${OUT_DIR}/case-audit-1-entry.png` });
    const entry = await readState(page);
    log('ENTRY', JSON.stringify(entry));

    // 带 Shift 走，软渲染帧率低时也能尽快摸到边。
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyS');
    let boundaryHit = false;
    for (let i = 0; i < 30; i++) {
      await sleep(800);
      const state = await readState(page);
      if (state.hud && state.hud.includes('已到场地边界')) { boundaryHit = true; break; }
    }
    await page.keyboard.up('KeyS');
    await page.keyboard.up('ShiftLeft');
    await sleep(600);
    const after = await readState(page);
    await page.screenshot({ path: `${OUT_DIR}/case-audit-2-edge.png` });

    const results = {
      entry,
      after,
      boundaryHit,
      movedMeters: entry.cam && after.cam
        ? Math.hypot(after.cam[0] - entry.cam[0], after.cam[2] - entry.cam[2])
        : null,
      caseFacilities: plan.facilities.length,
      caseRoutes: plan.routes.length,
    };
    writeFileSync(`${OUT_DIR}/readings4.json`, JSON.stringify(results, null, 2));
    log('RESULT', JSON.stringify(results));
    log('DONE', `${OUT_DIR}/readings4.json`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => { console.error('[walk4] FAILED', err); process.exitCode = 1; });
