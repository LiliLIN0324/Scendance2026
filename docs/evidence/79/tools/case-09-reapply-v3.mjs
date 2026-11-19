// #9 v3：真实浏览器 + 手画边界 + 撤销/再应用，经本机代理访问云端。
// 只用真实 UI 事件；不直接改 localStorage 伪造方案。
import fs from 'node:fs';
import {
  launch, skipGuide, chat, planState, waitForButton, driveToProposal,
  cloudFetch, outdoorPlanReadings, SITE,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session-v3.json', 'utf8'));
const OUT = 'docs/evidence/79/09/v3';
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true });
const out = {
  ranAt: new Date().toISOString(),
  account: session.user.email,
  actor: session.user.id,
  site: SITE,
  note: 'v3 修复了旧 setupSite 依赖；先两条组合需求，手画闭合红线，再重试出预览；writes 只统计 supabase.co 非 GET。',
  steps: [],
};
const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
const calls = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url))
  .map((n) => `${n.method} ${n.status}`);
const act = (plan) => {
  const k = Object.keys(plan || {}).find((x) => x.startsWith('scendance-outdoor-plan-v1:house-'));
  return k ? { slot: k, ...plan[k] } : plan;
};

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(1500);

const m1 = netlog.length;
await chat(page, '在杭州湖滨银泰in77做200人市集设计，签到靠近入口，留出通道', { wait: 50000 });
out.steps.push({ step: 1, name: '组合需求', calls: calls(m1), writes: writes(m1), plan: act(await planState(page)) });

const m2 = netlog.length;
await chat(page, '活动边界用银泰in77 A区东坡路一侧的室外广场，约40米×30米；入口用东坡路7号A区主入口；分区就按摊位区、舞台/表演区、签到服务区、观众区，不需要餐饮。请直接出可应用的场地预览。', { wait: 60000 });
out.steps.push({ step: 2, name: '补齐边界/入口/分区', calls: calls(m2), writes: writes(m2), plan: act(await planState(page)) });

const drawBtn = page.getByRole('button', { name: '在地图上手画活动范围' }).first();
if (!(await drawBtn.count())) throw new Error('手画活动范围入口没有出现');
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
await page.screenshot({ path: `${OUT}/2026-11-19-v3-boundary.png` });
const boundaryPlan = act(await planState(page));
out.steps.push({ step: 3, name: '手画闭合边界', plan: boundaryPlan });
fs.writeFileSync(`${OUT}/2026-11-19-case09-v3.partial.json`, JSON.stringify(out, null, 2));
if (!boundaryPlan?.counts?.boundary) throw new Error(`边界没有闭合：${JSON.stringify(boundaryPlan)}`);

const m3 = netlog.length;
const retry = page.getByRole('button', { name: '重试', exact: true }).first();
if (await retry.count()) await retry.click({ force: true }).catch(() => {});
else await chat(page, '边界已画好，请按刚才的分区出可应用预览。', { wait: 30000 });
await page.waitForTimeout(50000);
out.steps.push({ step: 4, name: '重试出预览', calls: calls(m3), writes: writes(m3), plan: act(await planState(page)) });

const m4 = netlog.length;
const drive = await driveToProposal(page, { shot: `${OUT}/2026-11-19-v3-proposal.png` });
out.drive = drive;
out.steps.push({ step: 5, name: '推进到可应用预览', calls: calls(m4), writes: writes(m4), plan: act(await planState(page)) });

const before = act(await planState(page));
const m5 = netlog.length;
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
if (!(await applyBtn.count())) throw new Error('可应用按钮未出现');
await applyBtn.click();
await page.waitForTimeout(18000);
await page.screenshot({ path: `${OUT}/2026-11-19-v3-applied.png` });
out.apply1 = { before, after: act(await planState(page)), writes: writes(m5) };

const m6 = netlog.length;
const undo = page.locator('[data-testid=plan-undo]').first();
if (await undo.count()) await undo.click().catch(() => {});
else {
  await page.locator('[aria-label="户外规划业务图层"]').first().click({ position: { x: 40, y: 40 }, force: true }).catch(() => {});
  await page.keyboard.press('Control+z');
}
await page.waitForTimeout(12000);
await page.screenshot({ path: `${OUT}/2026-11-19-v3-undone.png` });
out.undo = { after: act(await planState(page)), writes: writes(m6) };

const m7 = netlog.length;
const again = await waitForButton(page, /确认并应用这一版|重试|出分区预览|批准并执行/, { timeout: 15000 });
if (!again) await chat(page, '按同一版再应用一次。', { wait: 30000 });
const againBtn = page.getByRole('button', { name: /确认并应用这一版|重试|出分区预览|批准并执行/ }).first();
if (await againBtn.count()) await againBtn.click().catch(() => {});
await page.waitForTimeout(20000);
await page.screenshot({ path: `${OUT}/2026-11-19-v3-reapplied.png` });
out.reapply = { button: again, after: act(await planState(page)), writes: writes(m7) };

const cloud = await cloudFetch(session, '/outdoor-plans').catch((e) => ({ error: String(e).slice(0, 200) }));
out.cloud = { status: cloud.status, body: cloud.body };
out.cloudSql = await outdoorPlanReadings(session.user.id).catch((e) => ({ error: String(e).slice(0, 200) }));
out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-19-case09-v3.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  steps: out.steps.map(s => ({ step: s.step, name: s.name, plan: s.plan })),
  drive: out.drive,
  apply1: out.apply1,
  undo: out.undo,
  reapply: out.reapply,
  cloud: out.cloud,
  cloudSql: out.cloudSql,
}, null, 1));
await browser.close();
