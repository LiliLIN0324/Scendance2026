// #7 / #8 / #9 连跑 v2：预览 → 「等等」 → 新提案 → 双击应用 → 撤销 → 再应用
import fs from 'node:fs';
import { launch, skipGuide, chat, setupSite, driveToProposal, planState, clickText, waitForButton, cloudSql, SITE } from './harness.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const actor = session.user.id;
const D07 = 'docs/evidence/79/07', D08 = 'docs/evidence/79/08', D09 = 'docs/evidence/79/09';
for (const d of [D07, D08, D09]) fs.mkdirSync(d, { recursive: true });

const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case-07-08-09-v2.har' });
const steps = [];
let stepNo = 0;
const writes = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
const calls = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => `${n.method} ${n.status}`);

async function mark(name, extra = {}) {
  stepNo += 1;
  const rec = { step: stepNo, name, at: new Date().toISOString(), plan: await planState(page), ...extra };
  steps.push(rec);
  console.log(`\n===== [${stepNo}] ${name} =====`);
  console.log(JSON.stringify({ plan: rec.plan, ...extra }, null, 1).slice(0, 1500));
  return rec;
}
const cardText = () => page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 800));

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);

// 步骤 1：建场（地点 + 范围）
const setup = await setupSite(page, { shot: `${D07}/2026-11-19-v2-range-confirmed.png` });
await mark('建场完成（红线入画布）', { setup });

// 步骤 2：组合需求 → 推进到可应用预览
const m2 = netlog.length;
await chat(page, '200 人市集，签到靠近入口，留出通道', { wait: 40000 });
const drive1 = await driveToProposal(page, { shot: `${D07}/2026-11-19-v2-proposal-1.png` });
await mark('组合需求 → 出预览提案', { drive1, calls: calls(m2), writes: writes(m2), taskText: await cardText() });

// 步骤 3（#7）：待预览时说「等等」→ 旧票零写
const m3 = netlog.length;
await chat(page, '等等，先别动', { wait: 30000 });
await page.screenshot({ path: `${D07}/2026-11-19-v2-say-wait.png` });
await mark('#7 待预览时说「等等」', {
  taskText: await cardText(),
  proposalStillVisible: !!(await page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).count()),
  writes: writes(m3), writeCount: writes(m3).length, calls: calls(m3),
});

// 步骤 4：再要一次新提案
const m4 = netlog.length;
await chat(page, '200 人市集，签到靠近入口，留出通道', { wait: 40000 });
const drive2 = await driveToProposal(page, { shot: `${D07}/2026-11-19-v2-proposal-2.png` });
await mark('新提案', { drive2, calls: calls(m4), writes: writes(m4), taskText: await cardText() });

// 步骤 5（#8b）：双击确认（<300ms）→ 只应用一次
const m5 = netlog.length;
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
const beforeApply = await planState(page);
await applyBtn.click().catch((e) => console.log('click1', String(e).slice(0, 60)));
await applyBtn.click({ force: true, timeout: 2500 }).catch((e) => console.log('click2', String(e).slice(0, 60)));
await page.waitForTimeout(18000);
await page.screenshot({ path: `${D08}/2026-11-19-v2-double-click-apply.png` });
await mark('#8b 双击应用', { beforeApply, writes: writes(m5), writeCount: writes(m5).length, taskText: await cardText() });

// 步骤 6（#9）：撤销整批
const m6 = netlog.length;
const undoBtn = page.locator('[data-testid=plan-undo]').first();
const undoSeen = await undoBtn.count();
if (undoSeen) await undoBtn.click().catch(() => {});
await page.waitForTimeout(10000);
await page.screenshot({ path: `${D09}/2026-11-19-v2-after-undo.png` });
await mark('#9 撤销整批', { undoSeen, writes: writes(m6), taskText: await cardText() });

// 步骤 7（#9）：撤销后再应用一次
const m7 = netlog.length;
const again = await waitForButton(page, /确认并应用这一版|重试|出分区预览|批准并执行/, { timeout: 15000 });
if (again) await page.getByRole('button', { name: /确认并应用这一版|重试|出分区预览|批准并执行/ }).first().click().catch(() => {});
await page.waitForTimeout(20000);
await page.screenshot({ path: `${D09}/2026-11-19-v2-reapply.png` });
await mark('#9 撤销后再应用一次', { again, writes: writes(m7), taskText: await cardText() });

const bundle = {
  ranAt: new Date().toISOString(), account: session.user.email, actor, site: SITE,
  note: '每步的 writes 只统计对 supabase.co 的非 GET 请求；plan 为本机 localStorage 方案槽读数。',
  steps, consoleErrors: consoleErrors.slice(0, 30),
  cloud: await cloudSql(`select to_regclass('scene_private.outdoor_plans')::text as outdoor_plans_tbl`),
};
for (const d of [D07, D08, D09]) fs.writeFileSync(`${d}/2026-11-19-v2-chain-07-08-09.json`, JSON.stringify(bundle, null, 2));
console.log('\n===== 汇总 =====');
console.log(JSON.stringify(steps.map((s) => ({ step: s.step, name: s.name, writes: s.writeCount ?? s.writes?.length ?? 0 })), null, 1));
await browser.close();
