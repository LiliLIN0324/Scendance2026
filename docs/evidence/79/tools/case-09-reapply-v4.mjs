// #9 v4：真实浏览器 + 新匿名会话 + 代理通道，apply→undo→reapply，逐次抓 PUT body 与云端 revision 对照。
// 只用真实 UI 事件；不直接改 localStorage 伪造方案。
// 复用 harness-proxy.mjs（newGuestSession / launch 代理感知）。
import fs from 'node:fs';
import {
  launch, skipGuide, chat, planState, waitForButton, driveToProposal,
  cloudFetch, newGuestSession, SITE, REF,
} from './harness-proxy.mjs';

const session = await newGuestSession();
const OUT = 'docs/evidence/79/09/v4';
fs.mkdirSync(OUT, { recursive: true });

const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const out = {
  ranAt: new Date().toISOString(),
  account: session.user.email,
  actor: session.user.id,
  site: SITE,
  ref: REF,
  note: 'v4：新匿名会话（不读旧 session 文件）；逐次记录 PUT /outdoor-plans 请求 body（activityId/localActivityId/baseRevision）与云端 list revision；撤销先点画布移焦点，再点 plan-undo 按钮，未回退再 Ctrl+Z。',
  steps: [],
};

// 本机记录（含云端回写身份）读数
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
        counts: {
          zones: (p.zones || []).length, boundary: (p.boundary || []).length,
          facilities: (p.facilities || []).length, objects: (p.objects || []).length,
        },
        planLen: JSON.stringify(p).length,
      };
    } catch (e) { res[k] = { error: String(e) }; }
  }
  res['scendance-outdoor-last-v1'] = localStorage.getItem('scendance-outdoor-last-v1');
  return res;
});

const act = (plan) => {
  const k = Object.keys(plan || {}).find((x) => x.startsWith('scendance-outdoor-plan-v1:house-') || x.includes('house-'));
  return k ? { slot: k, ...plan[k] } : plan;
};

// 某段之后的云端写（非 GET，supabase.co），附请求 body 关键字段
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
await page.waitForTimeout(1500);
await cloudList('initial');

const m1 = netlog.length;
await chat(page, '在杭州湖滨银泰in77做200人市集设计，签到靠近入口，留出通道', { wait: 50000 });
out.steps.push({ step: 1, name: '组合需求', writes: writes(m1), plan: act(await readRecord()) });

const m2 = netlog.length;
await chat(page, '活动边界用银泰in77 A区东坡路一侧的室外广场，约40米×30米；入口用东坡路7号A区主入口；分区就按摊位区、舞台/表演区、签到服务区、观众区，不需要餐饮。请直接出可应用的场地预览。', { wait: 60000 });
out.steps.push({ step: 2, name: '补齐边界/入口/分区', writes: writes(m2), plan: act(await readRecord()) });

// 手画闭合边界
const drawBtn = page.getByRole('button', { name: '在地图上手画活动范围' }).first();
if (await drawBtn.count()) {
  await drawBtn.click({ force: true });
  await page.waitForTimeout(1800);
  for (const [x, y] of [[980, 480], [1020, 480], [1020, 520], [980, 520], [980, 480]]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(600);
  }
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(3000);
  const finish = page.getByRole('button', { name: /完成\s*[（(]\s*4\s*点/ }).first();
  if (await finish.count()) await finish.click({ force: true }).catch(() => {});
  await page.waitForTimeout(3000);
}
await page.screenshot({ path: `${OUT}/2026-11-20-v4-boundary.png` }).catch(() => {});
out.steps.push({ step: 3, name: '手画闭合边界', plan: act(await readRecord()) });
fs.writeFileSync(`${OUT}/2026-11-20-case09-v4.partial.json`, JSON.stringify(out, null, 2));

const m3 = netlog.length;
const retry = page.getByRole('button', { name: '重试', exact: true }).first();
if (await retry.count()) await retry.click({ force: true }).catch(() => {});
else await chat(page, '边界已画好，请按刚才的分区出可应用预览。', { wait: 30000 });
await page.waitForTimeout(50000);
out.steps.push({ step: 4, name: '重试出预览', writes: writes(m3), plan: act(await readRecord()) });

const m4 = netlog.length;
const drive = await driveToProposal(page, { shot: `${OUT}/2026-11-20-v4-proposal.png` });
out.drive = drive;
out.steps.push({ step: 5, name: '推进到可应用预览', writes: writes(m4), plan: act(await readRecord()) });

// 应用前云端基线
await cloudList('before-apply');

const before = act(await readRecord());
const m5 = netlog.length;
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
if (await applyBtn.count()) {
  await applyBtn.click();
  await page.waitForTimeout(18000);
} else {
  out.apply1 = { skipped: '可应用按钮未出现' };
}
await page.screenshot({ path: `${OUT}/2026-11-20-v4-applied.png` }).catch(() => {});
out.apply1 = { before, after: act(await readRecord()), writes: writes(m5), puts: planPuts(m5) };
await cloudList('after-apply');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v4.partial.json`, JSON.stringify(out, null, 2));

// 撤销：读按钮态 → 点画布空白移焦点 → 点撤销按钮 → 未回退再 Ctrl+Z
const undoState = await page.evaluate(() => {
  const b = document.querySelector('[data-testid=plan-undo]');
  return { exists: !!b, disabled: b?.disabled ?? null, label: b?.getAttribute('aria-label') ?? null };
});
const m6 = netlog.length;
// 点画布空白处，把焦点从输入框移走
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
// 若按钮撤销未回退（counts 仍与应用后一致），再试一次 Ctrl+Z
const beforeUndoCounts = out.apply1?.after?.counts;
if (beforeUndoCounts && JSON.stringify(afterUndo.counts) === JSON.stringify(beforeUndoCounts)) {
  await page.keyboard.press('Control+z').catch(() => {});
  await page.waitForTimeout(8000);
  undoMethod += '+ctrl-z-fallback';
}
await page.screenshot({ path: `${OUT}/2026-11-20-v4-undone.png` }).catch(() => {});
out.undo = { button: undoState, method: undoMethod, after: afterUndo, writes: writes(m6), puts: planPuts(m6) };
await cloudList('after-undo');
fs.writeFileSync(`${OUT}/2026-11-20-case09-v4.partial.json`, JSON.stringify(out, null, 2));

// 再应用
const m7 = netlog.length;
const again = await waitForButton(page, /确认并应用这一版|重试|出分区预览|批准并执行/, { timeout: 15000 });
if (!again) await chat(page, '按同一版再应用一次。', { wait: 30000 });
const againBtn = page.getByRole('button', { name: /确认并应用这一版|重试|出分区预览|批准并执行/ }).first();
if (await againBtn.count()) await againBtn.click().catch(() => {});
await page.waitForTimeout(20000);
await page.screenshot({ path: `${OUT}/2026-11-20-v4-reapplied.png` }).catch(() => {});
out.reapply = { button: again, after: act(await readRecord()), writes: writes(m7), puts: planPuts(m7) };
await cloudList('after-reapply');

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case09-v4.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  steps: out.steps.map((s) => ({ step: s.step, name: s.name, plan: s.plan })),
  apply1: out.apply1, undo: out.undo, reapply: out.reapply,
  cloudInitial: out['cloud-initial'], cloudAfterApply: out['cloud-after-apply'],
  cloudAfterUndo: out['cloud-after-undo'], cloudAfterReapply: out['cloud-after-reapply'],
}, null, 1));
await browser.close();
