// #4 v3：无范围设计句 → 手画边界 → 改人数/预算；只记录真实 UI 与网络回执。
import fs from 'node:fs';
import { launch, skipGuide, chat, planState, dismissCloudRecover, SITE } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session-v4.json', 'utf8'));
const OUT = 'docs/evidence/79/04';
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case04-v3.har' });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE, steps: [] };
const act = (plan) => {
  const k = Object.keys(plan || {}).find((x) => x.startsWith('scendance-outdoor-plan-v1:house-'));
  return k ? { slot: k, ...plan[k] } : plan;
};
const writes = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
const calls = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => `${n.method} ${n.status}`);
const taskText = () => page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || document.body.innerText).replace(/\s+/g, ' ').slice(0, 1200));

try {
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  await skipGuide(page).catch(() => {});
  await dismissCloudRecover(page);

  const m1 = netlog.length;
  await chat(page, '做一场 200 人的市集，签到靠近入口，留出通道', { wait: 30000 });
  out.firstHalf = { taskText: await taskText(), calls: calls(m1), writes: writes(m1), plan: act(await planState(page)) };
  await page.screenshot({ path: `${OUT}/2026-11-19-no-range-first-sentence-v3.png` });

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
  out.boundary = act(await planState(page));
  await page.screenshot({ path: `${OUT}/2026-11-19-boundary-before-change.png` });
  if (!out.boundary?.counts?.boundary) throw new Error(`边界没有闭合：${JSON.stringify(out.boundary)}`);

  const m2 = netlog.length;
  await chat(page, '改成 150 人', { wait: 45000 });
  out.changeHeadcount = { taskText: await taskText(), calls: calls(m2), writes: writes(m2), plan: act(await planState(page)) };
  await page.screenshot({ path: `${OUT}/2026-11-19-change-headcount-v3.png` });

  const m3 = netlog.length;
  await chat(page, '预算改成 20 万', { wait: 45000 });
  out.changeBudget = { taskText: await taskText(), calls: calls(m3), writes: writes(m3), plan: act(await planState(page)) };
  await page.screenshot({ path: `${OUT}/2026-11-19-change-budget-v3.png` });

  out.writes = writes();
  out.consoleErrors = consoleErrors.slice(0, 10);
  out.ok = true;
} catch (error) {
  out.ok = false;
  out.error = String(error?.stack || error).slice(0, 1500);
  out.taskText = await taskText().catch(() => null);
  out.plan = act(await planState(page).catch(() => null));
  await page.screenshot({ path: `${OUT}/2026-11-19-case04-v3-failure.png` }).catch(() => {});
} finally {
  out.consoleErrors ??= consoleErrors.slice(0, 10);
  fs.writeFileSync(`${OUT}/2026-11-19-case04-v3.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1).slice(0, 8000));
  await browser.close();
}
