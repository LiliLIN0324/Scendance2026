// #9 v9：真实浏览器 + 已刷新登录会话 + 代理。锚定边界（带边界守卫重试）→ 边界内入口节点 → 分区预览 → 退出放置模式 → 真实 #tool-undo/#tool-redo 撤销与重做 → 云端 revision 同轮对照。只用真实 UI；撤销钮禁用就如实记录，不伪造 Ctrl+Z 回退。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, chat, waitForButton, driveToProposal,
  cloudFetch, SITE, REF,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/09/v9';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: 'v9：会话已刷新；锚定后做边界守卫（boundary<3 重试一次）；answers 对齐市集四分区；撤销/重做走真实 #tool-undo/#tool-redo，先 Esc 退出放置模式；按钮禁用如实记录不兜底。',
  steps: [],
};

const readPlan = () => page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('scendance-outdoor-plan-v1:')) continue;
    try {
      const env = JSON.parse(localStorage.getItem(k));
      const p = env.plan || {};
      if ((p.boundary || []).length >= 3) return {
        slot: k, projectId: env.projectId, name: env.name,
        remoteActivityId: env.remoteActivityId ?? null,
        remoteRevision: typeof env.remoteRevision === 'number' ? env.remoteRevision : null,
        boundary: p.boundary, zones: p.zones || [], nodes: p.nodes || [],
        facilities: p.facilities || [], objects: p.objects || [],
        planLen: JSON.stringify(p).length,
      };
    } catch { /* skip */ }
  }
  return null;
});

const summarize = (plan) => plan ? {
  slot: plan.slot, projectId: plan.projectId, remoteActivityId: plan.remoteActivityId, remoteRevision: plan.remoteRevision,
  counts: { zones: plan.zones.length, boundary: plan.boundary.length, nodes: plan.nodes.length, facilities: plan.facilities.length, objects: plan.objects.length },
  zones: plan.zones.map((z) => ({ id: z.id, name: z.name, semantic: z.semantic, purpose: z.purpose ?? null })),
  nodes: plan.nodes.map((n) => ({ kind: n.kind, name: n.name, verification: n.verification ?? null, position: n.position })),
  planLen: plan.planLen,
} : null;

const inRing = (pt, ring) => {
  if (!pt || !ring?.length) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a.y > pt.y) !== (b.y > pt.y)) && (pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-9) + a.x)) inside = !inside;
  }
  return inside;
};

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}${n.body ? ' :: ' + String(n.body).slice(0, 160) : ''}`);

const planPuts = (from = 0) => netlog.slice(from)
  .filter((n) => /outdoor-plans/.test(n.url))
  .map((n) => ({ t: n.t, method: n.method, status: n.status, body: n.body ? String(n.body).slice(0, 300) : null }));

const toolBar = () => page.evaluate(() => {
  const grab = (id) => {
    const b = document.getElementById(id);
    return b ? { exists: true, disabled: b.disabled, aria: b.getAttribute('aria-label'), tip: b.getAttribute('data-tip') ?? null, text: (b.innerText || '').trim() } : { exists: false };
  };
  const hint = document.body.innerText.match(/当前：[^\n]*/)?.[0] ?? null;
  return { undo: grab('tool-undo'), redo: grab('tool-redo'), hint };
});

const cloudList = async (label) => {
  const r = await cloudFetch(session, '/outdoor-plans').catch((e) => ({ status: 'ERR', body: String(e).slice(0, 200) }));
  const plan = await readPlan();
  const slot = plan?.slot?.split(':')[1];
  const me = Array.isArray(r.body) ? r.body.find((x) => x.localActivityId === slot) : null;
  out[`cloud-${label}`] = { status: r.status, current: me ?? null, listLen: Array.isArray(r.body) ? r.body.length : null };
  console.log(`[cloud:${label}]`, r.status, JSON.stringify(me ?? null));
  return r;
};

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(1500);
const ns = page.getByRole('button', { name: /新会话/ }).first();
if (await ns.count()) { await ns.click().catch(() => {}); await page.waitForTimeout(3000); await dismissCloudRecover(page); }

async function anchorVenue(keyword) {
  await dismissCloudRecover(page);
  await chat(page, `先找${keyword}，核对本次可用的活动范围`, { wait: 9000 });
  const card = page.locator('.ap-venue-card').first();
  await card.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const opt = card.locator('.ap-option-row').first();
  if (await opt.count()) { await opt.click(); await page.waitForTimeout(3000); }
  const confirmBtn = page.getByRole('button', { name: /就定这个场地/ }).first();
  if (await confirmBtn.count()) await confirmBtn.click();
  await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 90000, requireEnabled: true });
  const rangeBtn = page.getByRole('button', { name: /确认并应用这一版/ }).first();
  if (await rangeBtn.count()) await rangeBtn.click().catch(() => {});
  await page.waitForTimeout(13000);
}

// 步骤 1：锚定场地（边界守卫：boundary<3 重试一次）
const m1 = netlog.length;
let anchorPlan = await readPlan();
let anchorRetry = 0;
if (!(anchorPlan?.boundary?.length >= 3)) {
  anchorRetry = 1;
  await anchorVenue('杭州湖滨银泰in77');
  anchorPlan = await readPlan();
}
if (!(anchorPlan?.boundary?.length >= 3)) {
  // 边界未锚定：如实落盘并退出，不继续无效链路。
  out.steps.push({ step: 1, name: 'anchorVenue 锚定边界（失败守卫退出）', plan: summarize(anchorPlan), retry: anchorRetry, writes: writes(m1) });
  await cloudList('after-anchor');
  out.consoleErrors = consoleErrors.slice(0, 20);
  fs.writeFileSync(`${OUT}/2026-11-20-case09-v9.json`, JSON.stringify(out, null, 2));
  console.log('ANCHOR_GUARD_FAIL', summarize(anchorPlan));
  await browser.close();
  process.exit(2);
}
out.steps.push({ step: 1, name: 'anchorVenue 锚定边界', plan: summarize(anchorPlan), retry: anchorRetry, writes: writes(m1) });
await cloudList('after-anchor');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v9.json`, JSON.stringify(out, null, 2));

// 步骤 2：放边界内入口节点
const m2 = netlog.length;
const railOutdoor = page.getByRole('button', { name: '户外规划' }).first();
if (await railOutdoor.count()) { await railOutdoor.click(); await page.waitForTimeout(3000); }
const subgroup = page.locator('[data-testid=catalog-subgroup-入口和通道图标]').first();
if (await subgroup.count()) { await subgroup.click(); await page.waitForTimeout(1500); }
const entryTool = page.locator('[data-testid=catalog-node-entry]').first();
const entranceTrace = { toolCount: await entryTool.count() };
if (await entryTool.count()) { await entryTool.click(); await page.waitForTimeout(1200); }
const canvasRect = await page.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')].map((c) => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.x, y: r.y }; }).filter((r) => r.w > 500);
  cs.sort((a, b) => b.w * b.h - a.w * a.h);
  return cs[0] ? { x: cs[0].x, y: cs[0].y, w: cs[0].w, h: cs[0].h } : null;
});
entranceTrace.canvasRect = canvasRect;
let entrancePlaced = null;
for (const [rx, ry] of [[0.62, 0.5], [0.58, 0.62], [0.68, 0.55], [0.55, 0.42]]) {
  if (!canvasRect) break;
  await page.mouse.click(canvasRect.x + canvasRect.w * rx, canvasRect.y + canvasRect.h * ry);
  await page.waitForTimeout(1500);
  const plan = await readPlan();
  const last = plan?.nodes[plan.nodes.length - 1];
  if (last) {
    entrancePlaced = { rx, ry, node: { kind: last.kind, name: last.name, verification: last.verification ?? null, position: last.position }, inRing: inRing(last.position, plan.boundary) };
    console.log('[entrance]', JSON.stringify(entrancePlaced));
    if (entrancePlaced.inRing) break;
  }
}
out.entrance = entrancePlaced;
out.steps.push({ step: 2, name: 'placeEntrance 边界内入口节点', entrance: entrancePlaced, plan: summarize(await readPlan()), writes: writes(m2) });
await cloudList('after-entrance');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v9.json`, JSON.stringify(out, null, 2));

// 步骤 3：推分区提案
const m3 = netlog.length;
const ZONE_ANSWERS = ['摊位区、舞台表演区、签到服务区、观众区', '200 人露天市集，先出分区框架，暂不摆桌椅'];
await chat(page, '200 人露天市集，分成摊位区、舞台表演区、签到服务区、观众区，先出分区框架，暂不摆桌椅。', { wait: 40000 });
const drive1 = await driveToProposal(page, { answers: ZONE_ANSWERS, shot: `${OUT}/2026-11-20-v9-proposal-1.png` });
out.steps.push({ step: 3, name: '分区需求 → 提案', drive1, plan: summarize(await readPlan()), writes: writes(m3) });
let rec = summarize(await readPlan());
if ((rec?.counts?.zones ?? 0) === 0) {
  const m3b = netlog.length;
  await chat(page, '分区按摊位区、舞台表演区、签到服务区、观众区来排，请出可应用的分区预览，先不摆桌椅。', { wait: 40000 });
  const drive2 = await driveToProposal(page, { answers: ZONE_ANSWERS, shot: `${OUT}/2026-11-20-v9-proposal-2.png` });
  out.steps.push({ step: 4, name: '补分区用途再推', drive2, plan: summarize(await readPlan()), writes: writes(m3b) });
  rec = summarize(await readPlan());
}
await cloudList('before-apply');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v9.json`, JSON.stringify(out, null, 2));

// 退出放置/草稿模式
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.locator('canvas').first().click({ position: { x: 120, y: 120 }, force: true }).catch(() => {});
await page.waitForTimeout(500);

// 应用（确认卡；提案若已在本地 plan，此步可能无新写，如实记录）
const before = summarize(await readPlan());
const m4 = netlog.length;
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
if (await applyBtn.count()) { await applyBtn.click(); await page.waitForTimeout(18000); } else { out.apply1 = { skipped: '可应用按钮未出现' }; }
await page.screenshot({ path: `${OUT}/2026-11-20-v9-applied.png` }).catch(() => {});
out.apply1 = { before, after: summarize(await readPlan()), writes: writes(m4), puts: planPuts(m4) };
await cloudList('after-apply');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v9.json`, JSON.stringify(out, null, 2));

// 撤销：真实 #tool-undo；禁用则如实记 disabled，不兜底伪造回退
const m5 = netlog.length;
const toolBeforeUndo = await toolBar();
let undoMethod = null;
const undoBtn = page.locator('#tool-undo').first();
const undoExists = await undoBtn.count();
const undoDisabled = !undoExists || await undoBtn.isDisabled().catch(() => true);
let afterUndo = null;
if (undoExists && !undoDisabled) {
  await undoBtn.click({ force: true }).catch(() => {});
  undoMethod = 'button-#tool-undo';
  await page.waitForTimeout(12000);
  afterUndo = summarize(await readPlan());
  if ((afterUndo?.counts?.zones ?? 0) > 0) {
    const b2 = page.locator('#tool-undo').first();
    if (await b2.count() && !(await b2.isDisabled().catch(() => true))) {
      await b2.click({ force: true }).catch(() => {});
      await page.waitForTimeout(10000);
      undoMethod += '+2nd';
      afterUndo = summarize(await readPlan());
    }
  }
} else {
  undoMethod = undoDisabled ? 'disabled-or-missing(no-fallback)' : 'missing';
  afterUndo = summarize(await readPlan());
}
await page.screenshot({ path: `${OUT}/2026-11-20-v9-undone.png` }).catch(() => {});
out.undo = { tool: toolBeforeUndo, button: { exists: undoExists, disabled: undoDisabled }, method: undoMethod, after: afterUndo, writes: writes(m5), puts: planPuts(m5) };
await cloudList('after-undo');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v9.json`, JSON.stringify(out, null, 2));

// 重做：优先 #tool-redo 复原；不可用再重发提案
const m6 = netlog.length;
const toolBeforeRedo = await toolBar();
let redoMethod = null;
const redoBtn = page.locator('#tool-redo').first();
const redoExists = await redoBtn.count();
const redoDisabled = !redoExists || await redoBtn.isDisabled().catch(() => true);
let afterRedo = null;
if (redoExists && !redoDisabled) {
  await redoBtn.click({ force: true }).catch(() => {});
  redoMethod = 'button-#tool-redo';
  await page.waitForTimeout(12000);
  afterRedo = summarize(await readPlan());
} else {
  redoMethod = 'redo-unavailable;resend-proposal';
  await chat(page, '按同一版再应用一次：摊位区、舞台表演区、签到服务区、观众区。', { wait: 30000 });
  await driveToProposal(page, { answers: ZONE_ANSWERS, shot: `${OUT}/2026-11-20-v9-reapplied.png` }).catch(() => {});
  afterRedo = summarize(await readPlan());
}
await page.screenshot({ path: `${OUT}/2026-11-20-v9-reapplied.png` }).catch(() => {});
out.reapply = { tool: toolBeforeRedo, button: { exists: redoExists, disabled: redoDisabled }, method: redoMethod, after: afterRedo, writes: writes(m6), puts: planPuts(m6) };
await cloudList('after-reapply');

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case09-v9.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  steps: out.steps.map((s) => ({ step: s.step, name: s.name, plan: s.plan })),
  apply1: out.apply1, undo: out.undo, reapply: out.reapply,
}, null, 1));
await browser.close();
