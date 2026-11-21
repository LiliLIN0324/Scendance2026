// #9 v7：真实浏览器 + v6 有效登录会话 + 代理。锚定边界 → 画布放边界内入口节点 → 分区预览 → 应用/撤销/再应用 → 云端 revision 同轮对照。只用真实 UI 事件。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, chat, planState, waitForButton, driveToProposal,
  cloudFetch, SITE, REF,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/09/v7';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: 'v7：登录会话 + 真实 UI 事件；锚定边界后经素材库 catalog-node-entry 在边界内放入口节点（射线法验 inRing），再推分区预览；apply→undo→reapply 同轮抓 counts/writes/云端 revision。',
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

// 步骤 1：锚定场地
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

const m1 = netlog.length;
await anchorVenue('杭州湖滨银泰in77');
out.steps.push({ step: 1, name: 'anchorVenue 锚定边界', plan: summarize(await readPlan()), writes: writes(m1) });
await cloudList('after-anchor');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v7.json`, JSON.stringify(out, null, 2));

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
out.entrance = entranceTrace;
out.steps.push({ step: 2, name: 'placeEntrance 边界内入口节点', entrance: entrancePlaced, plan: summarize(await readPlan()), writes: writes(m2) });
await cloudList('after-entrance');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v7.json`, JSON.stringify(out, null, 2));

// 步骤 3：回聊天给分区需求，推提案
const m3 = netlog.length;
await chat(page, '200 人露天市集，分成摊位区、舞台表演区、签到服务区、观众区，先出分区框架，暂不摆桌椅。', { wait: 40000 });
const drive1 = await driveToProposal(page, {
  answers: ['摊位区、舞台表演区、签到服务区、观众区', '200 人露天市集，先出分区框架，暂不摆桌椅'],
  shot: `${OUT}/2026-11-20-v7-proposal-1.png`,
});
out.steps.push({ step: 3, name: '分区需求 → 提案', drive1, plan: summarize(await readPlan()), writes: writes(m3) });
let rec = summarize(await readPlan());
if ((rec?.counts?.zones ?? 0) === 0) {
  const m3b = netlog.length;
  await chat(page, '分区按摊位区、舞台表演区、签到服务区、观众区来排，请出可应用的分区预览，先不摆桌椅。', { wait: 40000 });
  const drive2 = await driveToProposal(page, { shot: `${OUT}/2026-11-20-v7-proposal-2.png` });
  out.steps.push({ step: 4, name: '补分区用途再推', drive2, plan: summarize(await readPlan()), writes: writes(m3b) });
  rec = summarize(await readPlan());
}
await cloudList('before-apply');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v7.json`, JSON.stringify(out, null, 2));

// 应用
const before = summarize(await readPlan());
const m4 = netlog.length;
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
if (await applyBtn.count()) { await applyBtn.click(); await page.waitForTimeout(18000); } else { out.apply1 = { skipped: '可应用按钮未出现' }; }
await page.screenshot({ path: `${OUT}/2026-11-20-v7-applied.png` }).catch(() => {});
out.apply1 = { before, after: summarize(await readPlan()), writes: writes(m4), puts: planPuts(m4) };
await cloudList('after-apply');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v7.json`, JSON.stringify(out, null, 2));

// 撤销
const undoState = await page.evaluate(() => {
  const b = document.querySelector('[data-testid=plan-undo]');
  return { exists: !!b, disabled: b?.disabled ?? null, label: b?.getAttribute('aria-label') ?? null };
});
const m5 = netlog.length;
await page.locator('[aria-label="户外规划业务图层"], canvas').first().click({ position: { x: 40, y: 40 }, force: true }).catch(() => {});
await page.waitForTimeout(400);
const undoBtn = page.locator('[data-testid=plan-undo]').first();
let undoMethod = null;
if (await undoBtn.count() && !(await undoBtn.isDisabled().catch(() => true))) { await undoBtn.click({ force: true }).catch(() => {}); undoMethod = 'button'; }
else { await page.keyboard.press('Control+z'); undoMethod = 'ctrl-z'; }
await page.waitForTimeout(12000);
const afterUndo = summarize(await readPlan());
const beforeUndoCounts = out.apply1?.after?.counts;
if (beforeUndoCounts && JSON.stringify(afterUndo.counts) === JSON.stringify(beforeUndoCounts)) {
  await page.keyboard.press('Control+z').catch(() => {}); await page.waitForTimeout(8000); undoMethod += '+ctrl-z-fallback';
}
await page.screenshot({ path: `${OUT}/2026-11-20-v7-undone.png` }).catch(() => {});
out.undo = { button: undoState, method: undoMethod, after: afterUndo, writes: writes(m5), puts: planPuts(m5) };
await cloudList('after-undo');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v7.json`, JSON.stringify(out, null, 2));

// 再应用
const m6 = netlog.length;
const again = await waitForButton(page, /确认并应用这一版|重试|出分区预览|批准并执行/, { timeout: 15000 });
if (!again) await chat(page, '按同一版再应用一次。', { wait: 30000 });
const againBtn = page.getByRole('button', { name: /确认并应用这一版|重试|出分区预览|批准并执行/ }).first();
if (await againBtn.count()) await againBtn.click().catch(() => {});
await page.waitForTimeout(20000);
await page.screenshot({ path: `${OUT}/2026-11-20-v7-reapplied.png` }).catch(() => {});
out.reapply = { button: again, after: summarize(await readPlan()), writes: writes(m6), puts: planPuts(m6) };
await cloudList('after-reapply');

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case09-v7.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  steps: out.steps.map((s) => ({ step: s.step, name: s.name, plan: s.plan })),
  apply1: out.apply1, undo: out.undo, reapply: out.reapply,
}, null, 1));
await browser.close();
