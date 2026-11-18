/**
 * 户外漫游 W1/W2/W3 真机走查脚本（一次性验收工具，不进仓）。
 *
 * 做法：
 * - 往本机 localStorage 注入一份「走查场景」户外草稿（矩形红线 30×20 m，不给 designScope，
 *   这样漫游的进场点是场地中心而不是场外镜头位）；
 * - 打开 http://127.0.0.1:3210/?project=walk-verify&mode=outdoor，进 3D → 进漫游；
 * - 用页面里已有的本机验收桥 `window.__scendancePlan3dDebug` 读玩家位姿（第一人称下
 *   相机位 == 玩家位）、近邻条目与 E 提示；
 * - 用真实按键（W/A/S/D/E）驱动，读数落 JSON + 截图落 PNG。
 *
 * 用法：node .tmp-walk-verify.mjs probe|w1|w2|w3|all
 */
import { chromium } from './frontend/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const EXE = process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const BASE = 'http://127.0.0.1:3220';
const PID = 'walk-verify';
const KEY = `scendance-outdoor-plan-v1:${PID}`;
const LAST_KEY = 'scendance-outdoor-last-v1';
const OUT_DIR = '.tmp-walk-evidence';
mkdirSync(OUT_DIR, { recursive: true });

const ANCHOR = { lng: 120.1460368, lat: 30.2521924, crs: 'gcj-02', source: 'preset' };
// 矩形红线：x 东 ±15 m、y 北 ±10 m。场地中心 = (0,0)，世界系 = (ENU x, −ENU y)。
const BOUNDARY = [{ x: -15, y: -10 }, { x: 15, y: -10 }, { x: 15, y: 10 }, { x: -15, y: 10 }];

const log = (...args) => console.log('[walk]', ...args);

function uuid(n) {
  return `7a9f1e21-8c34-400a-800a-${String(n).padStart(12, '0')}`;
}

function buildPlan({ facilities = [], workers = [] }) {
  return {
    schemaVersion: 1,
    anchor: ANCHOR,
    boundary: BOUNDARY,
    zones: [],
    facilities,
    routes: [],
    nodes: [],
    workers,
  };
}

function facility(n, templateId, name, x, y, width, depth) {
  return {
    id: uuid(n), templateId, name, position: { x, y }, rotationDeg: 0,
    size: { width, depth }, notes: '',
  };
}

function worker(n, role, count, x, y) {
  return { id: uuid(100 + n), role, count, position: { x, y }, notes: '' };
}

function envelope(plan) {
  const now = new Date().toISOString();
  return { v: 1, projectId: PID, name: '走查场景', createdAt: now, updatedAt: now, plan };
}

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms));
}

/** 读页面里的本机验收桥 + DOM 提示。 */
async function readState(page) {
  return page.evaluate(() => {
    const dbg = window.__scendancePlan3dDebug;
    const text = sel => document.querySelector(sel)?.textContent?.trim() ?? null;
    return {
      camPos: dbg?.rig?.camPos ?? null,
      near: dbg?.interact?.near ?? null,
      entries: dbg?.interact?.entries ?? null,
      entryCount: dbg?.interact?.size ?? null,
      hint: text('[data-testid="outdoor-interact-hint"]'),
      line: text('[data-testid="outdoor-interact-line"]'),
      hud: text('[data-testid="outdoor-walk-hud"]'),
    };
  });
}

/** 打开一个带指定场景的页面，并进到漫游态。 */
async function openWalkPage(browser, plan, label) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', err => log('PAGEERROR', String(err).slice(0, 200)));
  page.on('console', msg => {
    if (msg.type() === 'error') log('CONSOLE', msg.text().slice(0, 200));
  });
  page.on('response', res => {
    if (res.status() >= 400) log('HTTP', res.status(), res.url().slice(-90));
  });
  await page.addInitScript(([key, lastKey, value]) => {
    try {
      window.localStorage.setItem(key, value);
      window.localStorage.setItem(lastKey, 'walk-verify');
    } catch (err) { /* 忽略 */ }
    // dev 布局里有个 20 秒看门狗：编辑器没在 20 秒内置好 __pcReady 就整页重载。
    // 本机 CPU 满载、编辑器 chunk 编译慢，于是无限重载、永远停在启动骨架。
    window.__pcReady = true;
    window.__pcRecoveryGateReady = true;
  }, [KEY, LAST_KEY, JSON.stringify(envelope(plan))]);

  await page.goto(`${BASE}/?project=${PID}&mode=outdoor`, { waitUntil: 'domcontentloaded', timeout: 180000 });

  // 等编辑器真就绪：以「页面出现按钮」为信号（启动骨架阶段没有任何 button）。
  const deadline = Date.now() + 360000;
  let ready = false;
  while (Date.now() < deadline) {
    const info = await page.evaluate(() => ({
      buttons: document.querySelectorAll('button').length,
      text: (document.body.innerText || '').slice(0, 100).replace(/\n+/g, ' | '),
    }));
    if (info.buttons > 0) { ready = true; break; }
    await sleep(3000);
  }
  log('BOOTED', ready);
  if (!ready) {
    const body = (await page.locator('body').innerText()).slice(0, 600).replace(/\n+/g, ' | ');
    log('BODY', body);
    await page.screenshot({ path: `${OUT_DIR}/failed-boot-${label}.png` }).catch(() => {});
    throw new Error('编辑器没就绪');
  }
  await sleep(2500);

  // 引导页：能跳就跳。
  for (const name of ['跳过引导', '跳过', '开始体验']) {
    const btn = page.getByRole('button', { name }).first();
    if (await btn.count().catch(() => 0)) { await btn.click().catch(() => {}); await sleep(1500); break; }
  }

  // 进漫游：右轨「第一人称漫游」→ 角色选择框 → 「自由漫游」。
  const walkBtn = page.locator('#tool-walk').first();
  let entered = false;
  if (await walkBtn.count()) {
    await walkBtn.click().catch(err => log('walk btn click err', err.message));
    await sleep(2500);
    const free = page.getByRole('button', { name: '自由漫游' }).first();
    if (await free.count()) { await free.click().catch(() => {}); entered = true; }
  }
  if (!entered) {
    const alt = page.getByRole('button', { name: /第一人称漫游|进入漫游|漫游/ }).first();
    if (await alt.count()) {
      await alt.click().catch(() => {});
      await sleep(2500);
      const free = page.getByRole('button', { name: '自由漫游' }).first();
      if (await free.count()) { await free.click().catch(() => {}); entered = true; }
    }
  }
  if (!entered) {
    const buttons = await page.getByRole('button').evaluateAll(bs => bs
      .map(b => ({ id: b.id || null, label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24) }))
      .filter(b => b.label || b.id).slice(0, 60));
    log('BUTTONS', JSON.stringify(buttons));
    const body = (await page.locator('body').innerText()).slice(0, 800).replace(/\n+/g, ' | ');
    log('BODY', body);
    await page.screenshot({ path: `${OUT_DIR}/failed-${label}.png` }).catch(() => {});
    throw new Error(`没能进漫游（${label}）`);
  }

  // 等 3D 场景与验收桥就位。
  await page.waitForFunction(() => Boolean(window.__scendancePlan3dDebug), null, { timeout: 120000 });
  await sleep(1500);

  // 点一下画布：触发指针锁或退到拖拽兜底，两种都能走。
  const canvas = page.locator('canvas').first();
  if (await canvas.count()) {
    const box = await canvas.boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    await sleep(600);
  }

  const state = await readState(page);
  log('ENTERED', label, JSON.stringify(state));
  return { context, page, state };
}

/** 按住一组键，中途反复采样；一旦连续两次采样没动，就认为「顶住了」。 */
async function walkUntilStable(page, keys, { maxMs = 60000, sampleMs = 700, stillEps = 0.02 } = {}) {
  for (const key of keys) await page.keyboard.down(key);
  const samples = [];
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(sampleMs);
    const state = await readState(page);
    const pos = state.camPos ? { x: state.camPos[0], z: state.camPos[2], y: state.camPos[1] } : null;
    const moved = last && pos ? Math.hypot(pos.x - last.x, pos.z - last.z) : null;
    samples.push({ t: Math.round((Date.now() - t0) / 100) / 10, ...pos, moved });
    if (moved !== null && moved < stillEps) break;
    if (last) last = pos;
    else if (pos) last = pos;
  }
  for (const key of keys) await page.keyboard.up(key);
  await sleep(400);
  return { samples, state: await readState(page) };
}

/** 固定时长按住一组键并连续采样（用来确认「顶住了」与「短走一段」）。 */
async function holdAndSample(page, keys, { ms = 1000, sampleMs = 400 } = {}) {
  for (const key of keys) await page.keyboard.down(key);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(sampleMs);
    const state = await readState(page);
    const pos = state.camPos ? { x: state.camPos[0], z: state.camPos[2], y: state.camPos[1] } : null;
    const prev = samples.at(-1);
    const moved = prev && pos ? Math.hypot(pos.x - prev.x, pos.z - prev.z) : null;
    samples.push({ t: Math.round((Date.now() - t0) / 100) / 10, ...pos, moved });
  }
  for (const key of keys) await page.keyboard.up(key);
  await sleep(400);
  return { samples, state: await readState(page) };
}

/** ENU 米 → 世界系（x 东、z = −北），场地中心在原点时两者同原点。 */
function enuToWorld(x, y) {
  return { x, z: -y };
}

/** 世界系 → ENU。 */
function worldToEnu(x, z) {
  return { x, y: -z };
}

/** 沿 forward 方向摆物件（forward 是世界系单位向量）。 */
function alongForward(origin, forward, distance) {
  const world = { x: origin.x + forward.x * distance, z: origin.z + forward.z * distance };
  return worldToEnu(world.x, world.z);
}

/** 点到轴对齐盒（世界系）的间隙；负数表示在盒内。 */
function gapToBox(pos, center, halfW, halfD) {
  const dx = Math.abs(pos.x - center.x) - halfW;
  const dz = Math.abs(pos.z - center.z) - halfD;
  if (dx <= 0 && dz <= 0) return -Math.min(-dx, -dz);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
}

async function run() {
  const mode = process.argv[2] || 'all';
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const results = { mode, startedAt: new Date().toISOString(), scenarios: {} };

  try {
    // ── 探测：量出进场点与前进方向 ────────────────────────────────────────
    let probe = null;
    if (mode === 'probe' || mode === 'all') {
      const { context, page } = await openWalkPage(browser, buildPlan({}), 'probe');
      const p0 = await readState(page);
      const walked = await walkUntilStable(page, ['KeyW'], { maxMs: 3000, sampleMs: 600 });
      const a = p0.camPos, b = walked.state.camPos;
      const dx = (b?.[0] ?? 0) - (a?.[0] ?? 0);
      const dz = (b?.[2] ?? 0) - (a?.[2] ?? 0);
      const len = Math.hypot(dx, dz);
      probe = {
        spawn: { x: a?.[0] ?? null, z: a?.[2] ?? null, y: a?.[1] ?? null },
        afterWalk: { x: b?.[0] ?? null, z: b?.[2] ?? null, y: b?.[1] ?? null },
        forward: len > 0.001 ? { x: dx / len, z: dz / len } : null,
        moved: len,
        samples: walked.samples,
      };
      log('PROBE', JSON.stringify({ ...probe, samples: undefined }));
      await page.screenshot({ path: `${OUT_DIR}/probe.png` });
      results.scenarios.probe = probe;
      await context.close();
    }

    if (mode === 'probe') { writeFileSync(`${OUT_DIR}/readings.json`, JSON.stringify(results, null, 2)); return; }
    if (!probe) throw new Error('需要 probe 读数（先跑 probe）');

    const origin = { x: probe.spawn.x, z: probe.spawn.z };
    const forward = probe.forward ?? { x: 0, z: -1 };

    // ── W1：帐篷挡人 + 沿面滑走 ───────────────────────────────────────────
    if (mode === 'w1' || mode === 'all') {
      const tentEnu = alongForward(origin, forward, 3);
      const plan = buildPlan({
        facilities: [facility(1, 'tent-3x3', '测试帐篷', tentEnu.x, tentEnu.y, 3, 3)],
      });
      const { context, page } = await openWalkPage(browser, plan, 'w1');
      const start = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/w1-0-start.png` });
      const walk = await walkUntilStable(page, ['KeyW'], { maxMs: 40000 });
      const blocked = walk.state;
      await page.screenshot({ path: `${OUT_DIR}/w1-1-blocked.png` });
      // 继续压住 3 秒：应当一动不动（证明是「顶住了」，不是恰好停了一下）。
      const still = await holdAndSample(page, ['KeyW'], { ms: 3000, sampleMs: 700 });
      // 退一步对照：按 S 能退开 → 位置确实是被帐篷挡住的，不是卡死。
      const back = await holdAndSample(page, ['KeyS'], { ms: 1200, sampleMs: 600 });
      // 再压回去：应当又停在同一个面上。
      const again = await walkUntilStable(page, ['KeyW'], { maxMs: 20000 });
      const reblocked = again.state;
      // 沿面滑走：W+D 应当贴着帐篷面横向挪，而不是卡在原地。
      const slide = await holdAndSample(page, ['KeyW', 'KeyD'], { ms: 4000, sampleMs: 700 });
      const slid = slide.state;
      await page.screenshot({ path: `${OUT_DIR}/w1-2-slide.png` });
      const tentWorld = enuToWorld(tentEnu.x, tentEnu.y);
      const w1 = {
        tentEnu, tentWorld,
        spawn: start.camPos,
        blockedAt: blocked.camPos,
        reblockedAt: reblocked.camPos,
        backedTo: back.state.camPos,
        slidAt: slid.camPos,
        samples: walk.samples,
        stillSamples: still.samples,
        backSamples: back.samples,
        reblockedSamples: again.samples,
        slideSamples: slide.samples,
        gapToTent: {
          blocked: blocked.camPos ? gapToBox({ x: blocked.camPos[0], z: blocked.camPos[2] }, tentWorld, 1.5, 1.5) : null,
          reblocked: reblocked.camPos ? gapToBox({ x: reblocked.camPos[0], z: reblocked.camPos[2] }, tentWorld, 1.5, 1.5) : null,
          slid: slid.camPos ? gapToBox({ x: slid.camPos[0], z: slid.camPos[2] }, tentWorld, 1.5, 1.5) : null,
        },
        advance: blocked.camPos && start.camPos
          ? Math.hypot(blocked.camPos[0] - start.camPos[0], blocked.camPos[2] - start.camPos[2])
          : null,
        backedBy: back.state.camPos && blocked.camPos
          ? Math.hypot(back.state.camPos[0] - blocked.camPos[0], back.state.camPos[2] - blocked.camPos[2])
          : null,
        lateral: slid.camPos && blocked.camPos ? Math.abs(slid.camPos[0] - blocked.camPos[0]) : null,
        insideSite: blocked.camPos
          ? { x: Math.abs(blocked.camPos[0]) <= 15, z: Math.abs(blocked.camPos[2]) <= 10 }
          : null,
      };
      log('W1', JSON.stringify(w1));
      results.scenarios.w1 = w1;
      await context.close();
    }

    // ── W2：走近椅子按 E 坐下，再按 W 起身 ───────────────────────────────
    if (mode === 'w2' || mode === 'all') {
      const chairEnu = alongForward(origin, forward, 1.8);
      const plan = buildPlan({
        facilities: [facility(2, 'oneplan:icon:evacuation-chair', '疏散椅', chairEnu.x, chairEnu.y, 0.6, 0.7)],
      });
      const { context, page } = await openWalkPage(browser, plan, 'w2');
      const start = await readState(page);
      // 只短走一段：椅子与岗位都不挡路，走过头就够不着了（近邻半径 2.2 m）。
      const walk = await holdAndSample(page, ['KeyW'], { ms: 500, sampleMs: 250 });
      const nearState = walk.state;
      await page.screenshot({ path: `${OUT_DIR}/w2-1-near.png` });
      await page.keyboard.press('KeyE');
      await sleep(1500);
      const seated = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/w2-2-seated.png` });
      await page.keyboard.down('KeyW');
      await sleep(300);
      await page.keyboard.up('KeyW');
      await sleep(1500);
      const stood = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/w2-3-stood.png` });
      const chairWorld = enuToWorld(chairEnu.x, chairEnu.y);
      const w2 = {
        chairEnu, chairWorld,
        spawn: start.camPos,
        nearAt: nearState.camPos,
        nearId: nearState.near,
        hintBeforeE: nearState.hint,
        seatedAt: seated.camPos,
        hintAfterE: seated.hint,
        lineAfterE: seated.line,
        stoodAt: stood.camPos,
        hintAfterStand: stood.hint,
        eyeDrop: start.camPos && seated.camPos ? start.camPos[1] - seated.camPos[1] : null,
        distanceToChair: nearState.camPos
          ? Math.hypot(nearState.camPos[0] - chairWorld.x, nearState.camPos[2] - chairWorld.z)
          : null,
      };
      log('W2', JSON.stringify(w2));
      results.scenarios.w2 = w2;
      await context.close();
    }

    // ── W3：走近保安按 E 出短台词，再按 E 收起 ───────────────────────────
    if (mode === 'w3' || mode === 'all') {
      const guardEnu = alongForward(origin, forward, 1.8);
      const plan = buildPlan({
        workers: [worker(1, '保安', 1, guardEnu.x, guardEnu.y)],
      });
      const { context, page } = await openWalkPage(browser, plan, 'w3');
      const start = await readState(page);
      const walk = await holdAndSample(page, ['KeyW'], { ms: 500, sampleMs: 250 });
      const nearState = walk.state;
      await page.screenshot({ path: `${OUT_DIR}/w3-1-near.png` });
      await page.keyboard.press('KeyE');
      await sleep(1500);
      const spoke = await readState(page);
      await page.screenshot({ path: `${OUT_DIR}/w3-2-line.png` });
      await page.keyboard.press('KeyE');
      await sleep(1500);
      const closed = await readState(page);
      const w3 = {
        guardEnu,
        spawn: start.camPos,
        nearAt: nearState.camPos,
        nearId: nearState.near,
        hintBeforeE: nearState.hint,
        lineAfterE: spoke.line,
        hintAfterE: spoke.hint,
        lineAfterSecondE: closed.line,
        entries: nearState.entries,
      };
      log('W3', JSON.stringify(w3));
      results.scenarios.w3 = w3;
      await context.close();
    }
  } finally {
    writeFileSync(`${OUT_DIR}/readings-${mode}.json`, JSON.stringify(results, null, 2));
    await browser.close();
    log('DONE', mode);
  }
}

run().catch(err => {
  console.error('[walk] FAILED', err);
  process.exitCode = 1;
});
