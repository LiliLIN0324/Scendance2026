/**
 * 户外漫游第二轮走查（2026-11-18 夜）：相机防穿 / 化身加载兜底 / 真实椅子 GLB / 真实经典案例。
 *
 * 与第一轮同一套做法：注入本机户外草稿 → 进 3D → 进漫游 → 真实键盘驱动，
 * 读数取页面里的本机验收桥 `window.__scendancePlan3dDebug`（第一人称下相机位 == 玩家位）。
 *
 * 用法（仓库根）：node docs/evidence/walk-2026-11-18-round2/probe-walk2.mjs case|cam|chair|all
 */
import { chromium } from '../../../frontend/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const EXE = process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const BASE = process.env.WALK_BASE ?? 'http://127.0.0.1:3230';
const PID = 'walk-verify-2';
const KEY = `scendance-outdoor-plan-v1:${PID}`;
const LAST_KEY = 'scendance-outdoor-last-v1';
const OUT_DIR = 'docs/evidence/walk-2026-11-18-round2';
mkdirSync(OUT_DIR, { recursive: true });

const ANCHOR = { lng: 120.1460368, lat: 30.2521924, crs: 'gcj-02', source: 'preset' };
const BOUNDARY = [{ x: -15, y: -10 }, { x: 15, y: -10 }, { x: 15, y: 10 }, { x: -15, y: 10 }];

const log = (...args) => console.log('[walk2]', ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function uuid(n) {
  return `7a9f1e21-8c34-400a-800a-${String(n).padStart(12, '0')}`;
}

function buildPlan({ facilities = [], workers = [] }) {
  return { schemaVersion: 1, anchor: ANCHOR, boundary: BOUNDARY, zones: [], facilities, routes: [], nodes: [], workers };
}

function facility(n, templateId, name, x, y, width, depth) {
  return { id: uuid(n), templateId, name, position: { x, y }, rotationDeg: 0, size: { width, depth }, notes: '' };
}

function envelope(plan, name) {
  const now = new Date().toISOString();
  return { v: 1, projectId: PID, name, createdAt: now, updatedAt: now, plan };
}

/** 读验收桥 + 提示条 + 漫游 HUD。 */
async function readState(page) {
  return page.evaluate(() => {
    const dbg = window.__scendancePlan3dDebug;
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const hud = text('[data-testid="outdoor-walk-hud"]');
    return {
      camPos: dbg?.rig?.camPos ?? null,
      target: dbg?.rig?.target ?? null,
      near: dbg?.interact?.near ?? null,
      hint: text('[data-testid="outdoor-interact-hint"]'),
      line: text('[data-testid="outdoor-interact-line"]'),
      hud,
      view: text('[data-testid="outdoor-walk-view"]'),
      retry: document.querySelector('[data-testid="outdoor-walk-avatar-retry"]') !== null,
    };
  });
}

async function openWalkPage(browser, plan, label) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', (err) => log('PAGEERROR', String(err).slice(0, 200)));
  page.on('console', (msg) => { if (msg.type() === 'error') log('CONSOLE', msg.text().slice(0, 200)); });
  page.on('response', (res) => { if (res.status() >= 400) log('HTTP', res.status(), res.url().slice(-80)); });
  await page.addInitScript(([key, lastKey, value, pid]) => {
    try {
      window.localStorage.setItem(key, value);
      window.localStorage.setItem(lastKey, pid);
    } catch { /* 忽略 */ }
    // dev 布局的 20 s 看门狗：编辑器没就绪就整页重载，本机软渲染下会无限重载。
    window.__pcReady = true;
    window.__pcRecoveryGateReady = true;
  }, [KEY, LAST_KEY, JSON.stringify(envelope(plan, label)), PID]);

  await page.goto(`${BASE}/?project=${PID}&mode=outdoor`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const deadline = Date.now() + 360000;
  let ready = false;
  while (Date.now() < deadline) {
    const info = await page.evaluate(() => ({ buttons: document.querySelectorAll('button').length, text: (document.body.innerText || '').slice(0, 80) }));
    if (info.buttons > 0) { ready = true; break; }
    await sleep(3000);
  }
  log('BOOTED', ready);
  if (!ready) {
    await page.screenshot({ path: `${OUT_DIR}/failed-boot-${label}.png` }).catch(() => {});
    throw new Error(`编辑器没就绪（${label}）`);
  }
  await sleep(2500);
  for (const name of ['跳过引导', '跳过', '开始体验']) {
    const btn = page.getByRole('button', { name }).first();
    if (await btn.count().catch(() => 0)) { await btn.click().catch(() => {}); await sleep(1500); break; }
  }
  const walkBtn = page.locator('#tool-walk').first();
  let entered = false;
  if (await walkBtn.count()) {
    await walkBtn.click().catch((err) => log('walk btn err', err.message));
    await sleep(2500);
    const free = page.getByRole('button', { name: '自由漫游' }).first();
    if (await free.count()) { await free.click().catch(() => {}); entered = true; }
  }
  if (!entered) throw new Error(`没能进漫游（${label}）`);
  await page.waitForFunction(() => Boolean(window.__scendancePlan3dDebug), null, { timeout: 120000 });
  await sleep(1500);
  const canvas = page.locator('canvas').first();
  if (await canvas.count()) {
    const box = await canvas.boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    await sleep(600);
  }
  log('ENTERED', label, JSON.stringify(await readState(page)));
  return { context, page };
}

/** 切到第三人称（第一人称 → 下一档就是 third）。
 *  直接派发 window 的 F5 keydown：HUD 容器 pointer-events 为 none，点按钮在
 *  headless 里会落空；应用自己的快捷键监听就在 window 上（room-organizer.tsx）。 */
async function toThirdPerson(page) {
  let now = (await readState(page)).view;
  if (now && now.includes('第三人称')) return now;
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', code: 'F5', bubbles: true }));
    });
    await sleep(1400);
    now = (await readState(page)).view;
    if (now && now.includes('第三人称')) return now;
  }
  return now;
}

async function holdAndSample(page, keys, { ms = 1000, sampleMs = 400 } = {}) {
  for (const key of keys) await page.keyboard.down(key);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(sampleMs);
    const state = await readState(page);
    samples.push({
      t: Math.round((Date.now() - t0) / 100) / 10,
      cam: state.camPos,
      player: state.camPos,
    });
  }
  for (const key of keys) await page.keyboard.up(key);
  await sleep(400);
  return { samples, state: await readState(page) };
}

/** 点是否落在某个轴对齐盒子内（世界系，按占位尺寸，不旋转）。 */
function insideBox(point, center, halfW, halfD) {
  return Math.abs(point.x - center.x) <= halfW && Math.abs(point.z - center.z) <= halfD;
}

async function main() {
  const mode = process.argv[2] || 'all';
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const results = { mode, startedAt: new Date().toISOString(), base: BASE, scenarios: {} };

  try {
    // ── 相机防穿：帐篷放在玩家正后方 2 m，第三人称后拉 4 m 会撞进去 ──────────
    if (mode === 'cam' || mode === 'all') {
      const plan = buildPlan({ facilities: [facility(11, 'tent-3x3', '背后帐篷', 0, -2, 3, 3)] });
      const { context, page } = await openWalkPage(browser, plan, 'cam');
      const first = await readState(page);
      const view = await toThirdPerson(page);
      await page.screenshot({ path: `${OUT_DIR}/cam-1-third.png` });
      const third = await readState(page);
      await holdAndSample(page, ['KeyW'], { ms: 1200, sampleMs: 500 });
      const afterWalk = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/cam-2-walked.png` });
      // 帐篷中心世界 (0, +2)、半边 1.5 → z ∈ [0.5, 3.5]
      const cam = third.camPos ? { x: third.camPos[0], z: third.camPos[2] } : null;
      results.scenarios.cam = {
        viewSwitchedTo: view,
        firstPerson: first,
        thirdPerson: third,
        afterWalk,
        tentBehind: { center: { x: 0, z: 2 }, halfW: 1.5, halfD: 1.5 },
        cameraInsideTent: cam ? insideBox(cam, { x: 0, z: 2 }, 1.5, 1.5) : null,
        cameraZ: cam?.z ?? null,
      };
      log('CAM', JSON.stringify(results.scenarios.cam));
      await context.close();
    }

    // ── 化身加载兜底：每 2 s 采一次 HUD，看 10 s 软超时是否真生效、之后是否自动换上 ──
    if (mode === 'wait' || mode === 'all') {
      const plan = buildPlan({ facilities: [] });
      const { context, page } = await openWalkPage(browser, plan, 'wait');
      await toThirdPerson(page);
      const samples = [];
      const t0 = Date.now();
      for (let i = 0; i < 18; i++) {
        const state = await readState(page);
        samples.push({ t: Math.round((Date.now() - t0) / 1000), hud: state.hud, retry: state.retry });
        if (i === 6) await page.screenshot({ path: `${OUT_DIR}/wait-1-early.png` });
        if (i === 11) await page.screenshot({ path: `${OUT_DIR}/wait-2-timeout.png` });
        await sleep(2000);
      }
      await page.screenshot({ path: `${OUT_DIR}/wait-3-late.png` });
      results.scenarios.wait = { samples };
      log('WAIT', JSON.stringify(samples));
      await context.close();
    }

    // ── 真实椅子 GLB：可坐判定走 slug，模型走物料库 GLB ────────────────────
    if (mode === 'chair' || mode === 'all') {
      const chair = facility(12, 'office-lobby-and-facilities-canteen-stacking-chair-3440c7d8', '可叠放座椅', 0, -1.8, 0.46, 0.51);
      const plan = buildPlan({ facilities: [chair] });
      const { context, page } = await openWalkPage(browser, plan, 'chair');
      const hud1s = await readState(page);
      await holdAndSample(page, ['KeyW'], { ms: 500, sampleMs: 250 });
      const nearState = await readState(page);
      await toThirdPerson(page);
      await page.screenshot({ path: `${OUT_DIR}/chair-1-near.png` });
      await page.keyboard.press('KeyE');
      await sleep(1800);
      const seated = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/chair-2-seated.png` });
      const seatedHud = seated.hud;
      await page.keyboard.down('KeyW');
      await sleep(700);
      await page.keyboard.up('KeyW');
      await sleep(600);
      const stood = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/chair-3-stood.png` });
      results.scenarios.chair = {
        hudAtEntry: hud1s.hud,
        near: nearState.near,
        hintBeforeSit: nearState.hint,
        seatedAt: seated.camPos,
        hintWhileSeated: seated.hint,
        seatedHud,
        stoodAt: stood.camPos,
        hintAfterStand: stood.hint,
      };
      log('CHAIR', JSON.stringify(results.scenarios.chair));
      await context.close();
    }

    // ── 真实经典案例（Scotiabank replica）：不注入自造矩形，直接载入案例规划 ──
    if (mode === 'case' || mode === 'all') {
      const casePlan = JSON.parse(readFileSync('.temp/scotiabank-case.json', 'utf8'));
      const { context, page } = await openWalkPage(browser, casePlan, 'case');
      const entry = await readState(page);
      await toThirdPerson(page);
      await page.screenshot({ path: `${OUT_DIR}/case-1-third.png` });
      const third = await readState(page);
      const walk = await holdAndSample(page, ['KeyW'], { ms: 3000, sampleMs: 700 });
      await page.screenshot({ path: `${OUT_DIR}/case-2-walked.png` });
      const after = await readState(page);
      // 案例里有 15 顶 pop-up-tent（3×3），检查相机没钻进任何一顶
      const tents = casePlan.facilities
        .filter((f) => f.templateId === 'oneplan:scale:pop-up-tent')
        .map((f) => ({ x: f.position.x, z: -f.position.y, halfW: (f.size?.width ?? 3) / 2, halfD: (f.size?.depth ?? 3) / 2 }));
      const camPoints = [third.camPos, after.camPos, walk.state.camPos].filter(Boolean).map((p) => ({ x: p[0], z: p[2] }));
      results.scenarios.case = {
        caseName: casePlan.name ?? 'Scotiabank replica',
        facilityCount: casePlan.facilities.length,
        boundaryPoints: casePlan.boundary.length,
        entry,
        thirdPerson: third,
        afterWalk: after,
        cameraInsideAnyTent: camPoints.some((p) => tents.some((t) => insideBox(p, t, t.halfW, t.halfD))),
        movedMeters: entry.camPos && after.camPos
          ? Math.hypot(after.camPos[0] - entry.camPos[0], after.camPos[2] - entry.camPos[2])
          : null,
      };
      log('CASE', JSON.stringify(results.scenarios.case));
      await context.close();
    }

    writeFileSync(`${OUT_DIR}/readings2.json`, JSON.stringify(results, null, 2));
    log('DONE', `${OUT_DIR}/readings2.json`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error('[walk2] FAILED', err); process.exitCode = 1; });
