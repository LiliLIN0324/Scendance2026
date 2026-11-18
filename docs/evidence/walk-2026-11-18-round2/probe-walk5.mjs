/**
 * 第五轮走查：经典案例体检复测 + 小场地边界提示。
 *
 * - `case`：Scotiabank replica（60 设施 / 4 条流线），只读体检结论，验证「贴红线的流线不再误报最窄」。
 * - `edge`：8×6 m 小场地，从中心往南走 3 m 即到边，验证 HUD「已到场地边界」。
 *
 * 用法（仓库根）：node docs/evidence/walk-2026-11-18-round2/probe-walk5.mjs
 */
import { chromium } from '../../../frontend/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const EXE = process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const BASE = process.env.WALK_BASE ?? 'http://127.0.0.1:3233';
const OUT_DIR = 'docs/evidence/walk-2026-11-18-round2';
mkdirSync(OUT_DIR, { recursive: true });
const log = (...args) => console.log('[walk5]', ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ANCHOR = { lng: 120.1460368, lat: 30.2521924, crs: 'gcj-02', source: 'preset' };

function uuid(n) {
  return `7a9f1e21-8c34-400a-800a-${String(n).padStart(12, '0')}`;
}

async function readState(page) {
  return page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const dbg = window.__scendancePlan3dDebug;
    return {
      hud: text('[data-testid="outdoor-walk-hud"]'),
      audit: text('[data-testid="outdoor-walk-audit"]'),
      cam: dbg?.rig?.camPos ?? null,
      auditDebug: dbg?.audit ?? null,
    };
  });
}

async function openWalk(page, pid, plan) {
  const key = `scendance-outdoor-plan-v1:${pid}`;
  await page.addInitScript(([k, value]) => {
    try {
      window.localStorage.setItem(k, value);
      window.localStorage.setItem('scendance-outdoor-last-v1', 'walk-verify-5');
    } catch { /* ignore */ }
    window.__pcReady = true;
    window.__pcRecoveryGateReady = true;
  }, [key, JSON.stringify({ v: 1, projectId: pid, name: '走查五', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), plan })]);
  await page.goto(`${BASE}/?project=${pid}&mode=outdoor`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => document.querySelectorAll('button').length > 0)) break;
    await sleep(3000);
  }
  await sleep(2500);
  for (const name of ['跳过引导', '跳过', '开始体验']) {
    const btn = page.getByRole('button', { name }).first();
    if (await btn.count().catch(() => 0)) { await btn.click().catch(() => {}); await sleep(1200); break; }
  }
  try {
    await page.locator('#tool-walk').first().click({ force: true, timeout: 20000 });
  } catch {
    await page.evaluate(() => document.querySelector('#tool-walk')?.click());
  }
  await sleep(2500);
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
  await sleep(1200);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const results = {};
  try {
    // ── 经典案例：只读体检 ────────────────────────────────────────────────
    {
      const casePlan = JSON.parse(readFileSync('.temp/scotiabank-case.json', 'utf8'));
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' });
      const page = await context.newPage();
      await openWalk(page, 'walk-verify-5-case', casePlan);
      results.case = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/case-audit-3-final.png` });
      log('CASE', JSON.stringify({ audit: results.case.audit, dbg: results.case.auditDebug && {
        areaM2: results.case.auditDebug.areaM2,
        ratio: results.case.auditDebug.ratio,
        blockedRoutes: results.case.auditDebug.blockedRoutes,
        firstBlocker: results.case.auditDebug.firstBlocker,
        blockedAtM: results.case.auditDebug.blockedAtM,
        narrowestRouteWidthM: results.case.auditDebug.narrowestRouteWidthM,
        sightline: results.case.auditDebug.sightline,
      } }));
      await context.close();
    }

    // ── 小场地：边界提示 ──────────────────────────────────────────────────
    {
      const plan = {
        schemaVersion: 1,
        anchor: ANCHOR,
        boundary: [{ x: -4, y: -3 }, { x: 4, y: -3 }, { x: 4, y: 3 }, { x: -4, y: 3 }],
        zones: [],
        facilities: [
          { id: uuid(91), templateId: 'oneplan:scale:pop-up-tent', name: '角落帐篷', position: { x: -3, y: 2 }, rotationDeg: 0, size: { width: 1.5, depth: 1.5 }, notes: '' },
        ],
        routes: [],
        nodes: [],
        workers: [],
      };
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' });
      const page = await context.newPage();
      await openWalk(page, 'walk-verify-5-edge', plan);
      const entry = await readState(page);
      await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('KeyS');
      let hitAt = null;
      for (let i = 0; i < 30; i++) {
        await sleep(800);
        const state = await readState(page);
        if (state.hud && state.hud.includes('已到场地边界')) { hitAt = i; break; }
      }
      await page.keyboard.up('KeyS');
      await page.keyboard.up('ShiftLeft');
      await sleep(500);
      const after = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/edge-1-boundary.png` });
      results.edge = { entry, after, hitAt };
      log('EDGE', JSON.stringify({ boundaryHit: hitAt !== null, hitAt, cam: after.cam, hud: after.hud }));
      await context.close();
    }

    writeFileSync(`${OUT_DIR}/readings5.json`, JSON.stringify(results, null, 2));
    log('DONE', `${OUT_DIR}/readings5.json`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error('[walk5] FAILED', err); process.exitCode = 1; });
