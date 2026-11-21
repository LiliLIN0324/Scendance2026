// #8a 应用后刷新留存对照：真实浏览器 + 已刷新会话 + 代理。锚定边界 → 边界内入口 → 分区 zones=4 → 记刷新前本地全槽/云端 revision → page.reload → 记刷新后本地全槽/云端 revision，对照边界/分区/节点是否留存、revision 是否一致。不做撤销/重做。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, chat, waitForButton, driveToProposal,
  cloudFetch, planState, SITE, REF,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/08/v10';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: '8a：应用提案后刷新页面，对照刷新前后本地全槽 counts/planLen/last 指针与云端 revision；边界/分区/节点留存与 revision 一致性为取证目标。in-flight 竞态（PUT 未落库时刷新）本轮未刻意制造。',
  steps: [],
};

const readPlan = () => page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('scendance-outdoor-plan-v1:')) continue;
    try {
      const env = JSON.parse(localStorage.getItem(k));
      const p = env.plan || {};
      if ((p.boundary || []).length >= 3) return {
        slot: k, projectId: env.projectId, remoteActivityId: env.remoteActivityId ?? null,
        remoteRevision: typeof env.remoteRevision === 'number' ? env.remoteRevision : null,
        boundary: p.boundary, zones: p.zones || [], nodes: p.nodes || [],
        facilities: p.facilities || [], objects: p.objects || [], planLen: JSON.stringify(p).length,
      };
    } catch { /* skip */ }
  }
  return null;
});

const summarize = (plan) => plan ? {
  slot: plan.slot, projectId: plan.projectId, remoteActivityId: plan.remoteActivityId, remoteRevision: plan.remoteRevision,
  counts: { zones: plan.zones.length, boundary: plan.boundary.length, nodes: plan.nodes.length, facilities: plan.facilities.length, objects: plan.objects.length },
  zones: plan.zones.map((z) => ({ name: z.name, semantic: z.semantic, purpose: z.purpose ?? null })),
  nodes: plan.nodes.map((n) => ({ kind: n.kind, name: n.name, position: n.position })),
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

// 1. 锚定边界（守卫重试）
const m1 = netlog.length;
let anchorPlan = await readPlan();
if (!(anchorPlan?.boundary?.length >= 3)) { await anchorVenue('杭州湖滨银泰in77'); anchorPlan = await readPlan(); }
if (!(anchorPlan?.boundary?.length >= 3)) {
  out.steps.push({ step: 1, name: 'anchorVenue 锚定边界（失败守卫退出）', plan: summarize(anchorPlan), writes: writes(m1) });
  out.consoleErrors = consoleErrors.slice(0, 20);
  fs.writeFileSync(`${OUT}/2026-11-20-case08a-reload.json`, JSON.stringify(out, null, 2));
  console.log('ANCHOR_GUARD_FAIL', summarize(anchorPlan));
  await browser.close();
  process.exit(2);
}
out.steps.push({ step: 1, name: 'anchorVenue 锚定边界', plan: summarize(anchorPlan), writes: writes(m1) });
await cloudList('after-anchor');

// 2. 边界内入口节点
const m2 = netlog.length;
const railOutdoor = page.getByRole('button', { name: '户外规划' }).first();
if (await railOutdoor.count()) { await railOutdoor.click(); await page.waitForTimeout(3000); }
const subgroup = page.locator('[data-testid=catalog-subgroup-入口和通道图标]').first();
if (await subgroup.count()) { await subgroup.click(); await page.waitForTimeout(1500); }
const entryTool = page.locator('[data-testid=catalog-node-entry]').first();
if (await entryTool.count()) { await entryTool.click(); await page.waitForTimeout(1200); }
const canvasRect = await page.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')].map((c) => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.x, y: r.y }; }).filter((r) => r.w > 500);
  cs.sort((a, b) => b.w * b.h - a.w * a.h);
  return cs[0] ? { x: cs[0].x, y: cs[0].y, w: cs[0].w, h: cs[0].h } : null;
});
let entrancePlaced = null;
for (const [rx, ry] of [[0.62, 0.5], [0.58, 0.62], [0.68, 0.55], [0.55, 0.42]]) {
  if (!canvasRect) break;
  await page.mouse.click(canvasRect.x + canvasRect.w * rx, canvasRect.y + canvasRect.h * ry);
  await page.waitForTimeout(1500);
  const plan = await readPlan();
  const last = plan?.nodes[plan.nodes.length - 1];
  if (last) { entrancePlaced = { rx, ry, inRing: inRing(last.position, plan.boundary), node: { kind: last.kind, name: last.name, position: last.position } }; if (entrancePlaced.inRing) break; }
}
out.entrance = entrancePlaced;
out.steps.push({ step: 2, name: 'placeEntrance 边界内入口节点', entrance: entrancePlaced, plan: summarize(await readPlan()), writes: writes(m2) });
await cloudList('after-entrance');

// 3. 分区提案
const m3 = netlog.length;
const ZONE_ANSWERS = ['摊位区、舞台表演区、签到服务区、观众区', '200 人露天市集，先出分区框架，暂不摆桌椅'];
await chat(page, '200 人露天市集，分成摊位区、舞台表演区、签到服务区、观众区，先出分区框架，暂不摆桌椅。', { wait: 40000 });
const drive1 = await driveToProposal(page, { answers: ZONE_ANSWERS, shot: `${OUT}/2026-11-20-v10-proposal.png` });
out.steps.push({ step: 3, name: '分区需求 → 提案', drive1, plan: summarize(await readPlan()), writes: writes(m3) });
let rec = summarize(await readPlan());
if ((rec?.counts?.zones ?? 0) === 0) {
  const m3b = netlog.length;
  await chat(page, '分区按摊位区、舞台表演区、签到服务区、观众区来排，请出可应用的分区预览，先不摆桌椅。', { wait: 40000 });
  await driveToProposal(page, { answers: ZONE_ANSWERS }).catch(() => {});
  out.steps.push({ step: 4, name: '补分区用途再推', plan: summarize(await readPlan()), writes: writes(m3b) });
  rec = summarize(await readPlan());
}
await cloudList('before-reload');

// 刷新前快照
const beforeReload = { plan: summarize(await readPlan()), slots: await planState(page) };
await page.screenshot({ path: `${OUT}/2026-11-20-v10-before-reload.png` }).catch(() => {});
out.beforeReload = beforeReload;
fs.writeFileSync(`${OUT}/2026-11-20-case08a-reload.json`, JSON.stringify(out, null, 2));

// 4. 刷新页面
console.log('[reload] page.reload');
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(4000);

// 刷新后快照
const m4 = netlog.length;
const afterReload = { plan: summarize(await readPlan()), slots: await planState(page) };
await cloudList('after-reload');
await page.screenshot({ path: `${OUT}/2026-11-20-v10-after-reload.png` }).catch(() => {});
out.afterReload = afterReload;
out.afterReloadWrites = writes(m4);

// 对照
const b = beforeReload.plan, a = afterReload.plan;
out.comparison = {
  boundaryKept: b?.counts?.boundary === a?.counts?.boundary,
  zonesKept: b?.counts?.zones === a?.counts?.zones,
  nodesKept: b?.counts?.nodes === a?.counts?.nodes,
  planLenKept: b?.planLen === a?.planLen,
  revisionBefore: b?.remoteRevision,
  revisionAfter: a?.remoteRevision,
  revisionConsistent: b?.remoteRevision === a?.remoteRevision,
  slotBefore: b?.slot, slotAfter: a?.slot,
  slotConsistent: b?.slot === a?.slot,
};
out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case08a-reload.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ before: b, after: a, comparison: out.comparison }, null, 1));
await browser.close();
