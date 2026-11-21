// #9 v12 撤销聚焦探针（H1/H2 区分）：走 v10 完整链路锚定→入口→分区提案→当轮应用，
// 在应用后/撤销即刻/撤销落定/重做后四个时点读全槽指纹 + undo/redo 按钮态，并挂
// localStorage 写入时序钩子，记录 outdoor 槽每次写入的 counts/planLen/zoneNames。
// 目的：区分 H1 栈帧同态（prev 本身已含 zones4，撤销弹回同态）与 H2 回灌覆盖
// （undo 置 prev 后被外层 props/state 覆盖回 next）。栈帧 historyRef 不对外暴露，
// 只能用 canUndo/canRedo 布尔 + 槽指纹 + 写入时序旁证，不伪造栈计数。
// 守卫：anchor 失败退出；提案 zones=0 不硬凑；undo/redo 禁用如实记录，不兜底 Ctrl+Z，
// redo 不可用不重发提案制造重复云端副本。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, chat, waitForButton, driveToProposal,
  cloudFetch, SITE, REF,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v7.json'), 'utf8'));
const OUT = 'docs/evidence/79/09/v13';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

// localStorage 写入时序钩子：记录 outdoor 槽每次 setItem 的快照指纹。
await page.addInitScript(() => {
  window.__slotLog = [];
  const origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    if (String(key).startsWith('scendance-outdoor-plan-v1:')) {
      try {
        const env = JSON.parse(value);
        const p = env.plan || {};
        window.__slotLog.push({
          t: Date.now(),
          key,
          projectId: env.projectId ?? null,
          zones: (p.zones || []).length,
          boundary: (p.boundary || []).length,
          nodes: (p.nodes || []).length,
          routes: (p.routes || []).length,
          facilities: (p.facilities || []).length,
          planLen: JSON.stringify(p).length,
          zoneNames: (p.zones || []).map((z) => z.name ?? z.semantic ?? null),
        });
      } catch { /* ignore */ }
    }
    return origSet(key, value);
  };
});

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: 'v12：当轮应用入栈后聚焦撤销/重做。四时点槽指纹 + 按钮态 + 写入时序，区分 H1 栈帧同态 / H2 回灌覆盖；栈帧不暴露，不伪造计数。',
  timeline: [],
};

async function readActivePlan() {
  return page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('scendance-outdoor-plan-v1:')) continue;
      try {
        const env = JSON.parse(localStorage.getItem(k));
        const p = env.plan || {};
        if ((p.boundary || []).length >= 3) {
          return {
            slot: k, projectId: env.projectId, name: env.name,
            remoteActivityId: env.remoteActivityId ?? null,
            remoteRevision: typeof env.remoteRevision === 'number' ? env.remoteRevision : null,
            boundary: p.boundary, zones: p.zones || [], nodes: p.nodes || [],
            routes: p.routes || [], facilities: p.facilities || [],
            planLen: JSON.stringify(p).length,
            zoneNames: (p.zones || []).map((z) => z.name ?? z.semantic ?? null),
          };
        }
      } catch { /* skip */ }
    }
    return null;
  });
}

const fingerprint = (plan) => plan ? {
  slot: plan.slot, projectId: plan.projectId, name: plan.name,
  remoteActivityId: plan.remoteActivityId ?? null, remoteRevision: plan.remoteRevision ?? null,
  counts: {
    zones: plan.zones.length, boundary: plan.boundary.length, nodes: plan.nodes.length,
    routes: plan.routes.length, facilities: plan.facilities.length,
  },
  planLen: plan.planLen, zoneNames: plan.zoneNames,
} : null;

async function slotLogTail(n = 30) {
  return page.evaluate((count) => (window.__slotLog ?? []).slice(-count), n);
}

async function toolBar() {
  return page.evaluate(() => {
    const grab = (id) => {
      const b = document.getElementById(id);
      return b ? { exists: true, disabled: b.disabled, aria: b.getAttribute('aria-label'), tip: b.getAttribute('data-tip') ?? null } : { exists: false };
    };
    const handle = document.querySelector('button.oc-dock-handle');
    return {
      dockHandle: handle ? { exists: true, aria: handle.getAttribute('aria-label') } : { exists: false },
      undo: grab('tool-undo'), redo: grab('tool-redo'),
    };
  });
}

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET')
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}${n.body ? ' :: ' + String(n.body).slice(0, 160) : ''}`);

// 撤销/重做段全量响应（含失败端点 URL，便于归属 #8 那条 500）
const allRes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res')
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 110)}`);

async function cloudList(label) {
  const r = await cloudFetch(session, '/outdoor-plans').catch((e) => ({ status: 'ERR', body: String(e).slice(0, 200) }));
  out[`cloud-${label}`] = { status: r.status, listLen: Array.isArray(r.body) ? r.body.length : null };
  return r;
}

async function snapshot(label) {
  const active = await readActivePlan();
  const row = { label, at: new Date().toISOString(), plan: fingerprint(active), tool: await toolBar(), slotLog: await slotLogTail(20) };
  out.timeline.push(row);
  console.log(`[${label}]`, JSON.stringify(row.plan?.counts ?? null), JSON.stringify(row.tool?.undo), JSON.stringify(row.tool?.redo));
  return active;
}

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(1500);
const ns = page.getByRole('button', { name: /新会话/ }).first();
if (await ns.count()) { await ns.click().catch(() => {}); await page.waitForTimeout(3000); await dismissCloudRecover(page); }

async function anchorVenue(keyword) {
  await dismissCloudRecover(page);
  await chat(page, `先找${keyword}，核对本次可用的活动范围`, { wait: 12000 });
  await page.screenshot({ path: `${OUT}/v13-anchor-1-chat.png` }).catch(() => {});
  const card = page.locator('.ap-venue-card[aria-label="场地确认"]').first();
  await card.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}/v13-anchor-2-card.png` }).catch(() => {});
  const opt = card.locator('.ap-option-row').first();
  if (await opt.count()) {
    await opt.click({ force: true }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  // 选项预览完成后才出现「就定这个场地（…）」主按钮，等其可用再点。
  const picked = await waitForButton(page, /就定这个场地/, { timeout: 30000, requireEnabled: true });
  if (picked) {
    await page.getByRole('button', { name: /就定这个场地/ }).first().click({ force: true }).catch(() => {});
  }
  await page.screenshot({ path: `${OUT}/v13-anchor-3-confirm.png` }).catch(() => {});
  // 边界查找最多约 85 秒；等范围确认卡可用。
  await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 90000, requireEnabled: true });
  const rangeBtn = page.getByRole('button', { name: /确认并应用这一版/ }).first();
  if (await rangeBtn.count()) await rangeBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(13000);
  await page.screenshot({ path: `${OUT}/v13-anchor-4-range.png` }).catch(() => {});
}

// 步骤 1：锚定边界
const m1 = netlog.length;
let anchorPlan = await readActivePlan();
if (!(anchorPlan?.boundary?.length >= 3)) {
  await anchorVenue('杭州湖滨银泰in77');
  anchorPlan = await readActivePlan();
}
if (!(anchorPlan?.boundary?.length >= 3)) {
  out.guard = 'anchor-fail';
  out.guardText = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => null);
  await page.screenshot({ path: `${OUT}/v13-anchor-guard.png` }).catch(() => {});
  out.timeline.push({ label: 'anchor-guard-fail', plan: fingerprint(anchorPlan), writes: writes(m1) });
  await cloudList('after-anchor');
  out.consoleErrors = consoleErrors.slice(0, 20);
  fs.writeFileSync(`${OUT}/2026-11-21-case09-v13-undo-focus.json`, JSON.stringify(out, null, 2));
  console.log('ANCHOR_GUARD_FAIL', fingerprint(anchorPlan));
  await browser.close();
  process.exit(2);
}
await snapshot('after-anchor');
await cloudList('after-anchor');

// 步骤 2：边界内入口节点
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
const inRing = (pt, ring) => {
  if (!pt || !ring?.length) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a.y > pt.y) !== (b.y > pt.y)) && (pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-9) + a.x)) inside = !inside;
  }
  return inside;
};
let entrancePlaced = null;
if (canvasRect) {
  for (const [rx, ry] of [[0.62, 0.5], [0.58, 0.62], [0.68, 0.55], [0.55, 0.42]]) {
    await page.mouse.click(canvasRect.x + canvasRect.w * rx, canvasRect.y + canvasRect.h * ry);
    await page.waitForTimeout(1500);
    const plan = await readActivePlan();
    const last = plan?.nodes?.[plan.nodes.length - 1];
    if (last) { entrancePlaced = { rx, ry, inRing: inRing(last.position, anchorPlan.boundary) }; if (entrancePlaced.inRing) break; }
  }
}
out.entrance = entrancePlaced;
await snapshot('after-entrance');
await cloudList('after-entrance');

// 步骤 3：分区提案
const m3 = netlog.length;
const ZONE_ANSWERS = ['摊位区、舞台表演区、签到服务区、观众区', '200 人露天市集，先出分区框架，暂不摆桌椅'];
await chat(page, '200 人露天市集，分成摊位区、舞台表演区、签到服务区、观众区，先出分区框架，暂不摆桌椅。', { wait: 40000 });
const drive1 = await driveToProposal(page, { answers: ZONE_ANSWERS, shot: `${OUT}/2026-11-21-v13-proposal.png` });
out.drive1 = drive1;
let rec = await readActivePlan();
if ((rec?.zones?.length ?? 0) === 0) {
  await chat(page, '分区按摊位区、舞台表演区、签到服务区、观众区来排，请出可应用的分区预览，先不摆桌椅。', { wait: 40000 });
  const drive2 = await driveToProposal(page, { answers: ZONE_ANSWERS });
  out.drive2 = drive2;
  rec = await readActivePlan();
}
await snapshot('after-proposal');
await cloudList('before-apply');

// 应用确认卡
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.locator('canvas').first().click({ position: { x: 120, y: 120 }, force: true }).catch(() => {});
await page.waitForTimeout(500);

const m4 = netlog.length;
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
if (await applyBtn.count()) { await applyBtn.click(); await page.waitForTimeout(18000); } else { out.apply1 = { skipped: '可应用按钮未出现' }; }
await page.screenshot({ path: `${OUT}/2026-11-21-v13-applied.png` }).catch(() => {});
const afterApply = await snapshot('after-apply');
out.apply1 = { after: fingerprint(afterApply), writes: writes(m4) };
await cloudList('after-apply');
fs.writeFileSync(`${OUT}/2026-11-21-case09-v13-undo-focus.json`, JSON.stringify(out, null, 2));

// 展开工具条 → 撤销（即刻 + 落定两个时点）
const openDock = async () => {
  const h = page.locator('button.oc-dock-handle').first();
  if (await h.count()) { await h.click({ force: true }).catch(() => {}); await page.waitForTimeout(900); }
};
await openDock();

const m5 = netlog.length;
const toolBeforeUndo = await toolBar();
const undoBtn = page.locator('#tool-undo').first();
const undoExists = await undoBtn.count();
const undoDisabled = !undoExists || await undoBtn.isDisabled().catch(() => true);
let undoMethod = null;
if (undoExists && !undoDisabled) {
  undoMethod = 'button-#tool-undo';
  await undoBtn.click({ force: true }).catch(() => {});
  // 即刻时点：不等 autosave debounce，看槽是否短暂回到空态
  await page.waitForTimeout(250);
  await snapshot('undo-immediate');
  await page.waitForTimeout(11000);
  await snapshot('undo-settled');
  // 仍有分区且撤销仍可用时第二次
  const still = await readActivePlan();
  const btn2 = page.locator('#tool-undo').first();
  if ((still?.zones?.length ?? 0) > 0 && await btn2.count() && !(await btn2.isDisabled().catch(() => true))) {
    await btn2.click({ force: true }).catch(() => {});
    undoMethod += '+2nd';
    await page.waitForTimeout(250);
    await snapshot('undo-2-immediate');
    await page.waitForTimeout(11000);
    await snapshot('undo-2-settled');
  }
} else {
  undoMethod = undoDisabled ? 'disabled-or-missing(no-fallback)' : 'missing';
  await snapshot('undo-blocked');
}
out.undo = { tool: toolBeforeUndo, button: { exists: undoExists, disabled: undoDisabled }, method: undoMethod, writes: writes(m5), allRes: allRes(m5) };
await page.screenshot({ path: `${OUT}/2026-11-21-v13-undone.png` }).catch(() => {});
await cloudList('after-undo');
fs.writeFileSync(`${OUT}/2026-11-21-case09-v13-undo-focus.json`, JSON.stringify(out, null, 2));

// 重做（不可用只记录，不重发提案）
const m6 = netlog.length;
const toolBeforeRedo = await toolBar();
const redoBtn = page.locator('#tool-redo').first();
const redoExists = await redoBtn.count();
const redoDisabled = !redoExists || await redoBtn.isDisabled().catch(() => true);
let redoMethod = null;
if (redoExists && !redoDisabled) {
  redoMethod = 'button-#tool-redo';
  await redoBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(250);
  await snapshot('redo-immediate');
  await page.waitForTimeout(11000);
  await snapshot('redo-settled');
} else {
  redoMethod = 'redo-unavailable(no-resend)';
  await snapshot('redo-blocked');
}
out.reapply = { tool: toolBeforeRedo, button: { exists: redoExists, disabled: redoDisabled }, method: redoMethod, writes: writes(m6), allRes: allRes(m6) };
await page.screenshot({ path: `${OUT}/2026-11-21-v13-reapplied.png` }).catch(() => {});
await cloudList('after-reapply');

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-21-case09-v13-undo-focus.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ timeline: out.timeline.map((t) => ({ label: t.label, counts: t.plan?.counts, undo: t.tool?.undo?.disabled, redo: t.tool?.redo?.disabled })), undo: out.undo?.method, reapply: out.reapply?.method }, null, 1));
await browser.close();
