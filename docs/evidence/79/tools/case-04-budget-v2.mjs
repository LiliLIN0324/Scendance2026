// #4 v2：无范围先发设计句 → 定场 → 改人数/预算
import fs from 'node:fs';
import { launch, skipGuide, chat, planState, SITE, dismissCloudRecover, waitForButton } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session-v4.json', 'utf8'));
const OUT = 'docs/evidence/79/04';
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case04-v2.har' });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE, steps: [] };

async function taskText() {
  return page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || document.body.innerText).replace(/\s+/g, ' ').slice(0, 900));
}

try {
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  await skipGuide(page);
  await dismissCloudRecover(page);

  const m1 = netlog.length;
  await chat(page, '做一场 200 人的市集，签到靠近入口，留出通道', { wait: 25000 });
  await page.screenshot({ path: `${OUT}/2026-11-19-no-range-first-sentence.png` });
  out.firstHalf = {
    taskText: await taskText(),
    apiCalls: netlog.slice(m1).filter((n) => n.t === 'res' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status}`),
    plan: await planState(page),
  };

  // 新包的搜索入口：任务卡「搜索地点」→ 左上角胶囊输入框；等 8s 让 POI 候选出现。
  await dismissCloudRecover(page);
  const card = page.getByRole('button', { name: /^搜索地点$/ }).first();
  if (await card.count()) await card.click();
  await page.waitForTimeout(500);
  const field = page.locator('.sc-plan-place-search-field').first();
  if (await field.count()) await field.click();
  const input = page.locator('[data-testid=plan-place-search-input], [data-testid=outdoor-place-search-input]').first();
  await input.fill('杭州湖滨银泰in77');
  await page.waitForTimeout(9000);
  const options = page.locator('.sc-plan-place-search-option');
  out.search = { count: await options.count(), texts: await options.allInnerTexts().catch(() => []) };
  if (!(await options.count())) throw new Error('搜索候选为空');
  await options.first().click();
  await page.waitForTimeout(7000);
  const gen = page.getByRole('button', { name: /生成户外场地|就定这个场地/ }).first();
  out.venueButton = await gen.innerText().catch(() => null);
  if (await gen.count()) {
    for (let i = 0; i < 20 && await gen.isDisabled().catch(() => true); i += 1) await page.waitForTimeout(1000);
    await gen.click().catch(() => {});
    await page.waitForTimeout(18000);
  }
  const range = await waitForButton(page, /确认并应用这一版/, { timeout: 20000, requireEnabled: true });
  out.rangeButton = range;
  if (range) await page.getByRole('button', { name: /确认并应用这一版/ }).first().click().catch(() => {});
  await page.waitForTimeout(15000);
  out.siteReady = await planState(page);
  await page.screenshot({ path: `${OUT}/2026-11-19-site-ready.png` });

  const m2 = netlog.length;
  await chat(page, '改成 150 人', { wait: 45000 });
  await page.screenshot({ path: `${OUT}/2026-11-19-change-headcount.png` });
  out.changeHeadcount = {
    taskText: await taskText(),
    apiCalls: netlog.slice(m2).filter((n) => n.t === 'res' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status}`),
    plan: await planState(page),
  };

  const m3 = netlog.length;
  await chat(page, '预算改成 20 万', { wait: 45000 });
  await page.screenshot({ path: `${OUT}/2026-11-19-change-budget.png` });
  out.changeBudget = {
    taskText: await taskText(),
    apiCalls: netlog.slice(m3).filter((n) => n.t === 'res' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status}`),
    plan: await planState(page),
  };
  out.calls = netlog.filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => `${n.method} ${n.status}`);
  out.writes = netlog.filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
  out.consoleErrors = consoleErrors.slice(0, 10);
  out.ok = true;
} catch (error) {
  out.ok = false;
  out.error = String(error?.stack || error).slice(0, 2000);
  out.taskText = await taskText().catch(() => null);
  out.plan = await planState(page).catch(() => null);
  await page.screenshot({ path: `${OUT}/2026-11-19-case04-v2-failure.png` }).catch(() => {});
} finally {
  out.consoleErrors ??= consoleErrors.slice(0, 10);
  fs.writeFileSync(`${OUT}/2026-11-19-case04-v2.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1).slice(0, 7000));
  await browser.close();
}
