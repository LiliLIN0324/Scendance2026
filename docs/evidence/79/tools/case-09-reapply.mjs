// #9 用例 · v2：撤销整批 → 再要一次提案 → 再应用一次
import fs from 'node:fs';
import { launch, skipGuide, chat, setupSite, driveToProposal, planState, waitForButton, SITE } from './harness.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const OUT = 'docs/evidence/79/09';
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case09-v2.har' });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE };
const writes = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
const act = (plan) => {
  const k = Object.keys(plan || {}).find((x) => x.startsWith('scendance-outdoor-plan-v1:house-') && !x.includes('default'));
  return k ? { slot: k, counts: plan[k].counts, planLen: plan[k].planLen } : plan;
};

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);
out.setup = act(await setupSite(page, { shot: `${OUT}/2026-11-19-v2-site.png` }));

// 第一次：出提案 → 应用
const m1 = netlog.length;
await chat(page, '200 人市集，签到靠近入口，留出通道', { wait: 40000 });
const d1 = await driveToProposal(page, { shot: `${OUT}/2026-11-19-v2-proposal-1.png` });
const b1 = await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 10000 });
if (b1) await page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first().click().catch(() => {});
await page.waitForTimeout(18000);
await page.screenshot({ path: `${OUT}/2026-11-19-v2-applied-1.png` });
out.apply1 = { drive: d1, button: b1, plan: act(await planState(page)), writes: writes(m1) };
console.log('第一次应用:', JSON.stringify(out.apply1.plan));

// 撤销整批（画布 Ctrl+Z）
const m2 = netlog.length;
await page.locator('[aria-label="户外规划业务图层"]').first().click({ position: { x: 40, y: 40 }, force: true }).catch(() => {});
await page.waitForTimeout(800);
await page.keyboard.press('Control+z');
await page.waitForTimeout(12000);
await page.screenshot({ path: `${OUT}/2026-11-19-v2-undone.png` });
out.undo = { plan: act(await planState(page)), writes: writes(m2) };
console.log('撤销后:', JSON.stringify(out.undo.plan), '写:', JSON.stringify(out.undo.writes));

// 再要一次同样的话 → 新提案 → 再应用一次
const m3 = netlog.length;
await chat(page, '200 人市集，签到靠近入口，留出通道', { wait: 40000 });
const d2 = await driveToProposal(page, { shot: `${OUT}/2026-11-19-v2-proposal-2.png` });
const b2 = await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 10000 });
if (b2) await page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first().click().catch(() => {});
await page.waitForTimeout(20000);
await page.screenshot({ path: `${OUT}/2026-11-19-v2-reapplied.png` });
out.reapply = { drive: d2, button: b2, plan: act(await planState(page)), writes: writes(m3) };
console.log('再应用后:', JSON.stringify(out.reapply.plan), '写:', JSON.stringify(out.reapply.writes));

out.consoleErrors = consoleErrors.slice(0, 12);
fs.writeFileSync(`${OUT}/2026-11-19-case09-v2.json`, JSON.stringify(out, null, 2));
console.log('\n=== 汇总 ===');
console.log(JSON.stringify({ apply1: out.apply1.plan, undo: out.undo.plan, reapply: out.reapply.plan, writes: { a1: out.apply1.writes, u: out.undo.writes, a2: out.reapply.writes } }, null, 1));
await browser.close();
