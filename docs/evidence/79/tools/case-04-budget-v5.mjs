// #4 v5：从 v4 已保存的云端草稿继续，补人数/预算终态。
import fs from 'node:fs';
import { launch, skipGuide, chat, planState, dismissCloudRecover, SITE } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session-v4.json', 'utf8'));
const OUT = 'docs/evidence/79/04';
const { browser, page, netlog, consoleErrors } = await launch({ session });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE };
const act = (plan) => {
  const k = Object.keys(plan || {}).find((x) => x.startsWith('scendance-outdoor-plan-v1:house-'));
  return k ? { slot: k, ...plan[k] } : plan;
};
const writes = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
const taskText = () => page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || document.body.innerText).replace(/\s+/g, ' ').slice(0, 1400));

try {
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  await skipGuide(page).catch(() => {});
  // 云端恢复卡：打开最新一行（v4 刚写入的 house-qko3r251）。
  const open = page.getByRole('button', { name: '打开' }).first();
  out.openCount = await open.count();
  // 云端恢复列表：选 v4 那一行（17:48，版本 3），不能点首行——首行是刚打开页面新建的空活动。
  out.openTarget = await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')]
      .find((r) => (r.innerText || '').includes('17:48'));
    if (!row) return null;
    const text = (row.innerText || '').replace(/\s+/g, ' ').slice(0, 120);
    row.querySelector('[data-testid=outdoor-cloud-recover-open]')?.click();
    return text;
  });
  if (!out.openTarget) throw new Error('云端列表没有找到 17:48 的 v4 草稿');
  await page.waitForTimeout(9000);
  out.opened = act(await planState(page));
  await page.screenshot({ path: `${OUT}/2026-11-19-v5-opened.png` });
  if (out.opened?.slot !== 'scendance-outdoor-plan-v1:house-qko3r251') {
    throw new Error(`打开的不是 v4 草稿：${JSON.stringify(out.opened?.slot)}`);
  }

  const m1 = netlog.length;
  await chat(page, '人数改为 150 人，保持现有分区。', { wait: 45000 });
  out.changeHeadcount = { taskText: await taskText(), writes: writes(m1), plan: act(await planState(page)) };
  await page.screenshot({ path: `${OUT}/2026-11-19-v5-headcount.png` });

  const m2 = netlog.length;
  await chat(page, '整体活动总预算 20 万。', { wait: 45000 });
  out.changeBudget = { taskText: await taskText(), writes: writes(m2), plan: act(await planState(page)) };
  await page.screenshot({ path: `${OUT}/2026-11-19-v5-budget.png` });
  out.writes = writes();
  out.ok = true;
} catch (error) {
  out.ok = false;
  out.error = String(error?.stack || error).slice(0, 1500);
  out.taskText = await taskText().catch(() => null);
  await page.screenshot({ path: `${OUT}/2026-11-19-v5-failure.png` }).catch(() => {});
} finally {
  out.consoleErrors = consoleErrors.slice(0, 10);
  fs.writeFileSync(`${OUT}/2026-11-19-case04-v5.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1).slice(0, 8000));
  await browser.close();
}
