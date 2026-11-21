// #9 v11 撤销聚焦探针：在已应用的 4 分区基线（A 方案 house-8z42f0xm）上，只做撤销/重做对照，
// 不重新走完整模型建场。聚焦点：每步 counts/planLen/remoteRevision、undo/redo disabled 布尔、
// 属性卡文案、云端 PUT/GET。栈帧 historyRef 不对外暴露；只能用 canUndo/canRedo（按钮 disabled）
// + DOM 旁证，不伪造栈计数。undo/redo 不可用只记录，不兜底 Ctrl+Z，不重发提案制造重复云端副本。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, cloudFetch, SITE, REF, planState,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/09/v11';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const A = { activityId: '3eb2bbdb-8e8f-4fb5-b0ee-060836ffaf94', local: 'house-8z42f0xm', revision: 14 };
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: 'v11：聚焦撤销栈旁证。只读真实 #tool-undo/#tool-redo disabled（canUndo/canRedo）与全槽 counts；无栈帧计数可报。无活动槽时 guard-fail，不强行建场、不兜底快捷键。',
  steps: [],
};

// 全槽枚举：找 boundary>=3 的活动槽（避免误取空白副槽）
async function readActivePlan() {
  const slots = await planState(page);
  let active = null;
  for (const [k, v] of Object.entries(slots)) {
    if (!k.startsWith('scendance-outdoor-plan-v1:')) continue;
    if (v.error) continue;
    if ((v.counts?.boundary ?? 0) >= 3) active = { slot: k, ...v };
  }
  return active;
}

const summarize = (plan) => plan ? {
  slot: plan.slot, projectId: plan.projectId, name: plan.name,
  remoteRevision: plan.remoteRevision ?? null,
  counts: plan.counts, planLen: plan.planLen,
} : null;

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}${n.body ? ' :: ' + String(n.body).slice(0, 160) : ''}`);

const planPuts = (from = 0) => netlog.slice(from)
  .filter((n) => /outdoor-plans/.test(n.url))
  .map((n) => ({ t: n.t, method: n.method, status: n.status, body: n.body ? String(n.body).slice(0, 300) : null }));

async function toolBar() {
  return page.evaluate(() => {
    const grab = (id) => {
      const b = document.getElementById(id);
      return b ? { exists: true, disabled: b.disabled, aria: b.getAttribute('aria-label'), tip: b.getAttribute('data-tip') ?? null, text: (b.innerText || '').trim() } : { exists: false };
    };
    const handle = document.querySelector('button.oc-dock-handle');
    const card = document.querySelector('[data-testid=outdoor-task-card]');
    const cardText = card ? (card.innerText || '').replace(/\s+/g, ' ').slice(0, 200) : null;
    return {
      dockHandle: handle ? { exists: true, aria: handle.getAttribute('aria-label') } : { exists: false },
      undo: grab('tool-undo'), redo: grab('tool-redo'), cardText,
    };
  });
}

async function openDock() {
  const h = page.locator('button.oc-dock-handle').first();
  if (await h.count()) { await h.click({ force: true }).catch(() => {}); await page.waitForTimeout(900); }
}

async function cloudList(label) {
  const r = await cloudFetch(session, '/outdoor-plans').catch((e) => ({ status: 'ERR', body: String(e).slice(0, 200) }));
  out[`cloud-${label}`] = { status: r.status, listLen: Array.isArray(r.body) ? r.body.length : null };
  console.log(`[cloud:${label}]`, r.status, out[`cloud-${label}`].listLen);
  return r;
}

async function clearOutdoorSlots() {
  await page.evaluate(() => {
    for (const k of [...Object.keys(localStorage)]) {
      if (k.startsWith('scendance-outdoor-plan-v1') || k === 'scendance-outdoor-last-v1') localStorage.removeItem(k);
    }
  });
}

// recover 弹层按「版本 N」文案匹配 A 行；按钮 outdoor-cloud-recover-open，兜底行内 button。
async function pickRecover(rev) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')]
    .map((r, i) => ({ i, text: (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) })));
  const idx = rows.findIndex((r) => r.text.includes(`版本 ${rev} `) || r.text.includes(`版本 ${rev}`));
  const picked = idx >= 0 ? await page.evaluate((i) => {
    const row = document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')[i];
    const btn = row?.querySelector('[data-testid=outdoor-cloud-recover-open]') ?? row?.querySelector('button');
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return { testid: btn.getAttribute('data-testid'), disabled: btn.disabled };
  }, idx).catch((e) => ({ error: String(e).slice(0, 200) })) : null;
  await page.waitForTimeout(12000);
  return { rows: rows.slice(0, 12), idx, rowText: idx >= 0 ? rows[idx]?.text : null, picked };
}

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(1500);

let active = await readActivePlan();

// 本机无活动槽：清槽重载触发 recover 弹层，按版本号 adopt A；匹配不到才 guard-fail，不编造 adopt。
if (!active) {
  const mAdopt = netlog.length;
  await clearOutdoorSlots();
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  await skipGuide(page).catch(() => {});
  await page.waitForTimeout(2000);
  out.recover = await pickRecover(A.revision);
  active = await readActivePlan();
  out.adopt = {
    target: A,
    after: summarize(active),
    writes: netlog.slice(mAdopt).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
      .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`),
  };
}

if (!active) {
  out.steps.push({ step: 1, name: 'guard: adopt 后仍无边界槽', plan: null, recover: out.recover, slots: await planState(page) });
  await cloudList('no-active');
  out.consoleErrors = consoleErrors.slice(0, 20);
  fs.writeFileSync(`${OUT}/2026-11-20-case09-v11-undo-probe.json`, JSON.stringify(out, null, 2));
  console.log('GUARD_FAIL: no active boundary slot after adopt');
  await browser.close();
  process.exit(2);
}

out.steps.push({ step: 1, name: 'baseline', plan: summarize(active) });
await cloudList('baseline');

await openDock();
const before = summarize(active);
const mUndo = netlog.length;
const toolBefore = await toolBar();
await page.screenshot({ path: `${OUT}/2026-11-20-v11-before-undo.png` }).catch(() => {});

// 第一次撤销
const undoBtn = page.locator('#tool-undo').first();
const undoExists = await undoBtn.count();
const undoDisabled = !undoExists || await undoBtn.isDisabled().catch(() => true);
let undoMethod = null;
let after1 = null;
if (undoExists && !undoDisabled) {
  undoMethod = 'button-#tool-undo';
  await undoBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(10000);
  active = await readActivePlan();
  after1 = summarize(active);
} else {
  undoMethod = undoDisabled ? 'disabled-or-missing(no-fallback)' : 'missing';
  after1 = summarize(active);
}
await page.screenshot({ path: `${OUT}/2026-11-20-v11-after-undo1.png` }).catch(() => {});
out.steps.push({ step: 2, name: 'undo-1', tool: toolBefore, method: undoMethod, after: after1, writes: writes(mUndo), puts: planPuts(mUndo) });
await cloudList('after-undo1');

// 第二次撤销（仅当仍可用且 counts 未回到空）
const mUndo2 = netlog.length;
let after2 = null;
const btn2 = page.locator('#tool-undo').first();
const stillEnabled = await btn2.count() && !(await btn2.isDisabled().catch(() => true));
if (stillEnabled && (after1?.counts?.zones ?? 0) > 0) {
  await btn2.click({ force: true }).catch(() => {});
  await page.waitForTimeout(10000);
  active = await readActivePlan();
  after2 = summarize(active);
} else {
  after2 = after1;
}
out.steps.push({ step: 3, name: 'undo-2', method: stillEnabled ? 'button-#tool-undo' : 'not-enabled', after: after2, writes: writes(mUndo2), puts: planPuts(mUndo2) });
await cloudList('after-undo2');

// 重做（若可用；不可用只记录）
const mRedo = netlog.length;
const toolBeforeRedo = await toolBar();
const redoBtn = page.locator('#tool-redo').first();
const redoExists = await redoBtn.count();
const redoDisabled = !redoExists || await redoBtn.isDisabled().catch(() => true);
let redoMethod = null;
let after3 = null;
if (redoExists && !redoDisabled) {
  redoMethod = 'button-#tool-redo';
  await redoBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(10000);
  active = await readActivePlan();
  after3 = summarize(active);
} else {
  redoMethod = 'redo-unavailable(no-resend)';
  after3 = after2;
}
await page.screenshot({ path: `${OUT}/2026-11-20-v11-after-redo.png` }).catch(() => {});
out.steps.push({ step: 4, name: 'redo', tool: toolBeforeRedo, method: redoMethod, after: after3, writes: writes(mRedo), puts: planPuts(mRedo) });
await cloudList('after-redo');

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case09-v11-undo-probe.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ steps: out.steps }, null, 1));
await browser.close();
