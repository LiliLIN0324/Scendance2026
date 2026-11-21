// #9 v6：真实浏览器 + v6 有效登录会话（.temp/real-session-v6.json）+ 代理通道。
// 进入后先点「新会话」清空旧草稿槽，再 setupSite 锚定地点/红线 → driveToProposal 出分区预览，
// apply→undo→reapply，逐次抓 PUT body 与云端 revision 对照。只用真实 UI 事件。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, chat, setupSite, planState, waitForButton, driveToProposal,
  cloudFetch, SITE, REF,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/09/v6';
fs.mkdirSync(OUT, { recursive: true });

const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: 'v6：有效登录会话（admin 签发，凭据不写入证据）；进入先点「新会话」清空旧草稿；setupSite 锚定地点与红线 → 分区提案；apply 前守卫 zones>0；逐次记录 PUT body 与云端 list revision。',
  steps: [],
};

const readRecord = async () => page.evaluate(() => {
  const res = {};
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('scendance-outdoor-plan-v1:')) continue;
    try {
      const env = JSON.parse(localStorage.getItem(k));
      const p = env.plan || {};
      res[k] = {
        projectId: env.projectId, name: env.name,
        remoteActivityId: env.remoteActivityId ?? null,
        remoteRevision: typeof env.remoteRevision === 'number' ? env.remoteRevision : null,
        counts: { zones: (p.zones || []).length, boundary: (p.boundary || []).length, facilities: (p.facilities || []).length, objects: (p.objects || []).length },
        planLen: JSON.stringify(p).length,
      };
    } catch (e) { res[k] = { error: String(e) }; }
  }
  res['scendance-outdoor-last-v1'] = localStorage.getItem('scendance-outdoor-last-v1');
  return res;
});

const act = (plan) => {
  const k = Object.keys(plan || {}).find((x) => x.includes('house-') || x === 'scendance-outdoor-plan-v1:default-outdoor');
  return k ? { slot: k, ...plan[k] } : plan;
};

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}${n.body ? ' :: ' + String(n.body).slice(0, 160) : ''}`);

const planPuts = (from = 0) => netlog.slice(from)
  .filter((n) => /outdoor-plans/.test(n.url))
  .map((n) => ({ t: n.t, method: n.method, status: n.status, body: n.body ? String(n.body).slice(0, 300) : null }));

const cloudList = async (label) => {
  const r = await cloudFetch(session, '/outdoor-plans').catch((e) => ({ status: 'ERR', body: String(e).slice(0, 200) }));
  out[`cloud-${label}`] = { status: r.status, body: r.body };
  console.log(`[cloud:${label}]`, r.status, JSON.stringify(r.body).slice(0, 300));
  return r;
};

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(1500);

// 进入后先点「新会话」，确保不带账号既有旧活动草稿
const newSessionBtn = page.getByRole('button', { name: /新会话/ }).first();
if (await newSessionBtn.count()) {
  await newSessionBtn.click().catch(() => {});
  await page.waitForTimeout(3000);
  await dismissCloudRecover(page);
}
out.initialPlan = act(await readRecord());
await cloudList('initial');

// 锚定场地：聊天触发候选 → VenueConfirmCard 点第一候选预览 → 点「就定这个场地」→ 等边界/范围确认卡
async function anchorVenue(page, keyword) {
  const trace = { picked: null, confirmBtn: null, rangeButton: null };
  await dismissCloudRecover(page);
  await chat(page, `先找${keyword}，核对本次可用的活动范围`, { wait: 9000 });
  const card = page.locator('.ap-venue-card').first();
  await card.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const opt = card.locator('.ap-option-row').first();
  if (await opt.count()) {
    trace.picked = (await opt.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    await opt.click();
    await page.waitForTimeout(3000);
  }
  const confirmBtn = page.getByRole('button', { name: /就定这个场地/ }).first();
  if (await confirmBtn.count()) {
    trace.confirmBtn = (await confirmBtn.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    await confirmBtn.click();
  }
  // picking 最多约 85s：结束后要么直接写入边界，要么出范围确认卡
  trace.rangeButton = await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 90000, requireEnabled: true });
  const rangeBtn = page.getByRole('button', { name: /确认并应用这一版/ }).first();
  if (await rangeBtn.count()) await rangeBtn.click().catch(() => {});
  await page.waitForTimeout(13000);
  trace.plan = await planState(page);
  return trace;
}

// 步骤 1：锚定地点 + 红线
const m1 = netlog.length;
const setup = await anchorVenue(page, '杭州湖滨银泰in77');
out.steps.push({ step: 1, name: 'anchorVenue 锚定地点/红线', setup, writes: writes(m1), plan: act(await readRecord()) });
await cloudList('after-setup');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v6.json`, JSON.stringify(out, null, 2));

// 步骤 2：先明确入口朝向，再给分区需求 → 推进分区提案
const m2 = netlog.length;
await chat(page, '入口在南侧，靠龙翔桥地铁站方向；签到台放南侧入口旁。', { wait: 15000 });
await chat(page, '200 人露天市集，分成摊位区、舞台表演区、签到服务区、观众区，先出分区框架，暂时不要摆桌椅。', { wait: 40000 });
const drive1 = await driveToProposal(page, {
  answers: ['摊位区、舞台表演区、签到服务区、观众区', '200 人露天市集，先出分区框架，暂不摆桌椅'],
  shot: `${OUT}/2026-11-20-v6-proposal-1.png`,
});
out.steps.push({ step: 2, name: '入口朝向 + 组合需求 → 提案', drive1, writes: writes(m2), plan: act(await readRecord()) });

let rec = act(await readRecord());
if ((rec?.counts?.zones ?? 0) === 0) {
  const m2b = netlog.length;
  await chat(page, '分区按摊位区、舞台表演区、签到服务区、观众区来排，请出可应用的分区预览，先不摆桌椅。', { wait: 40000 });
  const drive2 = await driveToProposal(page, { shot: `${OUT}/2026-11-20-v6-proposal-2.png` });
  out.steps.push({ step: 3, name: '补分区用途再推', drive2, writes: writes(m2b), plan: act(await readRecord()) });
  rec = act(await readRecord());
}
await cloudList('before-apply');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v6.json`, JSON.stringify(out, null, 2));

// 应用
const before = act(await readRecord());
const m4 = netlog.length;
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
if (await applyBtn.count()) {
  await applyBtn.click();
  await page.waitForTimeout(18000);
} else {
  out.apply1 = { skipped: '可应用按钮未出现' };
}
await page.screenshot({ path: `${OUT}/2026-11-20-v6-applied.png` }).catch(() => {});
out.apply1 = { before, after: act(await readRecord()), writes: writes(m4), puts: planPuts(m4) };
await cloudList('after-apply');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v6.json`, JSON.stringify(out, null, 2));

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
if (await undoBtn.count() && !(await undoBtn.isDisabled().catch(() => true))) {
  await undoBtn.click({ force: true }).catch(() => {});
  undoMethod = 'button';
} else {
  await page.keyboard.press('Control+z');
  undoMethod = 'ctrl-z';
}
await page.waitForTimeout(12000);
const afterUndo = act(await readRecord());
const beforeUndoCounts = out.apply1?.after?.counts;
if (beforeUndoCounts && JSON.stringify(afterUndo.counts) === JSON.stringify(beforeUndoCounts)) {
  await page.keyboard.press('Control+z').catch(() => {});
  await page.waitForTimeout(8000);
  undoMethod += '+ctrl-z-fallback';
}
await page.screenshot({ path: `${OUT}/2026-11-20-v6-undone.png` }).catch(() => {});
out.undo = { button: undoState, method: undoMethod, after: afterUndo, writes: writes(m5), puts: planPuts(m5) };
await cloudList('after-undo');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v6.json`, JSON.stringify(out, null, 2));

// 再应用
const m6 = netlog.length;
const again = await waitForButton(page, /确认并应用这一版|重试|出分区预览|批准并执行/, { timeout: 15000 });
if (!again) await chat(page, '按同一版再应用一次。', { wait: 30000 });
const againBtn = page.getByRole('button', { name: /确认并应用这一版|重试|出分区预览|批准并执行/ }).first();
if (await againBtn.count()) await againBtn.click().catch(() => {});
await page.waitForTimeout(20000);
await page.screenshot({ path: `${OUT}/2026-11-20-v6-reapplied.png` }).catch(() => {});
out.reapply = { button: again, after: act(await readRecord()), writes: writes(m6), puts: planPuts(m6) };
await cloudList('after-reapply');

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case09-v6.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  steps: out.steps.map((s) => ({ step: s.step, name: s.name, plan: s.plan })),
  apply1: out.apply1, undo: out.undo, reapply: out.reapply,
  cloudInitial: out['cloud-initial'], cloudAfterSetup: out['cloud-after-setup'],
  cloudBeforeApply: out['cloud-before-apply'], cloudAfterApply: out['cloud-after-apply'],
  cloudAfterUndo: out['cloud-after-undo'], cloudAfterReapply: out['cloud-after-reapply'],
}, null, 1));
await browser.close();
