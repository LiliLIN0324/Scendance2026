// #4 用例：无范围先发设计句，再改预算或人数
// 前半段：零模型请求、只给唯一下一步；后半段：定场后改人数/预算，看是否被采纳。
import fs from 'node:fs';
import { launch, skipGuide, chat, setupSite, planState, clickText, SITE } from './harness.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const OUT = 'docs/evidence/79/04';
fs.mkdirSync(OUT, { recursive: true });

const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case04.har' });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE };

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);

// ── 前半段：无范围先发设计句
const m1 = netlog.length;
await chat(page, '做一场 200 人的市集，签到靠近入口，留出通道', { wait: 25000 });
await page.screenshot({ path: `${OUT}/2026-11-19-no-range-first-sentence.png` });
out.firstHalf = {
  taskText: await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 700)),
  apiCalls: netlog.slice(m1).filter((n) => n.t === 'res' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`),
  assistantCalls: netlog.slice(m1).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).length,
  plan: await planState(page),
};

// ── 后半段：定场后改人数
out.setup = await setupSite(page, { shot: `${OUT}/2026-11-19-site-ready.png` });
const m2 = netlog.length;
await chat(page, '改成 150 人', { wait: 45000 });
await page.screenshot({ path: `${OUT}/2026-11-19-change-headcount.png` });
out.changeHeadcount = {
  taskText: await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 700)),
  apiCalls: netlog.slice(m2).filter((n) => n.t === 'res' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`),
  assistantCalls: netlog.slice(m2).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).length,
  plan: await planState(page),
};

// 预算口径：再发一句预算
const m3 = netlog.length;
await chat(page, '预算改成 20 万', { wait: 45000 });
await page.screenshot({ path: `${OUT}/2026-11-19-change-budget.png` });
out.changeBudget = {
  taskText: await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 700)),
  apiCalls: netlog.slice(m3).filter((n) => n.t === 'res' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`),
  plan: await planState(page),
};
out.consoleErrors = consoleErrors.slice(0, 10);

fs.writeFileSync(`${OUT}/2026-11-19-case04.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
await browser.close();
