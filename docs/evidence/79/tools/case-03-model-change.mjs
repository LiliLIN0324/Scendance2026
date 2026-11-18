// #3 用例：有范围、已选设施，发明确小改 → 取候选前后对照
import fs from 'node:fs';
import { launch, skipGuide, chat, setupSite, planState, clickText, cloudSql, SITE } from './harness.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const OUT = 'docs/evidence/79/03';
fs.mkdirSync(OUT, { recursive: true });

const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case03.har' });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE };

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);
out.setup = await setupSite(page, { shot: `${OUT}/2026-11-19-site-ready.png` });

// 先出分区预览并应用，让画布上有分区/动线（=已选设施的前置状态）
await chat(page, '200 人市集，签到靠近入口，留出通道', { wait: 45000 });
await chat(page, '室外展览区和表演区', { wait: 45000 });
await page.screenshot({ path: `${OUT}/2026-11-19-before-change.png` });
out.beforeProposal = await planState(page);
const applyHit = await clickText(page, /确认并应用这一版|确认分区并预览/);
await page.waitForTimeout(16000);
await page.screenshot({ path: `${OUT}/2026-11-19-after-apply.png` });
out.applyHit = applyHit;
out.afterApply = await planState(page);

// 明确小改：主通道改走仁和路，别沿湖滨路
const mark = netlog.length;
await chat(page, '主通道改走场地北侧的仁和路，别沿湖滨路走', { wait: 60000 });
await page.screenshot({ path: `${OUT}/2026-11-19-after-route-change.png` });
out.afterChange = await planState(page);
out.taskText = await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 900));
out.calls = netlog.slice(mark).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => `${n.method} ${n.status}`);
out.sseTail = netlog.slice(mark).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => (n.body || '').slice(-1200));
out.writes = netlog.slice(mark).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
out.consoleErrors = consoleErrors.slice(0, 10);
out.cloud = await cloudSql(`select to_regclass('scene_private.outdoor_plans')::text as tbl`);

fs.writeFileSync(`${OUT}/2026-11-19-case03.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ before: out.beforeProposal, afterApply: out.afterApply, afterChange: out.afterChange, taskText: out.taskText, calls: out.calls, writes: out.writes }, null, 1));
await browser.close();
