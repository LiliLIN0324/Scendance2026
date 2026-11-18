// #11 用例 · 旧云 Agent Run：用有旧 run 的账号打开一条历史 run
import fs from 'node:fs';
import { launch, skipGuide, cloudFetch, SITE } from './harness.mjs';

const session = JSON.parse(fs.readFileSync('.temp/oldrun-session.json', 'utf8'));
const OUT = 'docs/evidence/79/11';
fs.mkdirSync(OUT, { recursive: true });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE };

// API 读数：列出这个账号的项目与旧 run
out.projects = await cloudFetch(session, '/projects');
const projects = Array.isArray(out.projects.body) ? out.projects.body : [];
out.projectList = projects.map((p) => ({ id: p.id, name: p.name, revision: p.revision }));
for (const p of projects.slice(0, 3)) {
  const r = await cloudFetch(session, `/projects/${p.id}/agent-runs`);
  out[`agentRuns_${p.id}`] = { status: r.status, body: JSON.stringify(r.body).slice(0, 700) };
}

// 浏览器：打开账号菜单 → 方案列表 → 打开项目
const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case11-oldrun.har' });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(10000);
await skipGuide(page);
await page.getByRole('button', { name: /账户菜单/ }).first().click().catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/2026-11-19-account-menu.png` });
out.menuText = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((e) => /本机|方案|团队/.test(e.innerText || '') && (e.innerText || '').length < 900);
  return (el?.innerText || '').replace(/\s+/g, ' ').slice(0, 700);
});
out.menuButtons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => ({ t: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 34), a: b.getAttribute('aria-label') })).filter((b) => b.t && /打开|方案|活动|项目|刷新/.test(b.t + (b.a || ''))).slice(0, 20));

// 点开第一个云方案（若有）
const opened = await page.getByRole('button', { name: /打开|当前 · / }).first().click().then(() => 'clicked').catch(() => null);
out.openedProject = opened;
await page.waitForTimeout(9000);
await page.screenshot({ path: `${OUT}/2026-11-19-old-run-opened.png` });
out.afterOpenText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 900));
out.apiCalls = netlog.filter((n) => n.t === 'res' && /agent-runs|projects/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 110)}`);
out.consoleErrors = consoleErrors.slice(0, 10);

fs.writeFileSync(`${OUT}/2026-11-19-old-agent-run.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 3500));
await browser.close();
