// #1 v8：空白项目 + 组合需求 + 地图手画范围 + 分区用途（经代理）
import fs from 'node:fs';
import { launch, skipGuide, chat, planState, dismissCloudRecover, outdoorPlanReadings, SITE } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session-v4.json', 'utf8'));
const OUT = 'docs/evidence/79/01';
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case01-v8.har' });
const out = { ranAt: new Date().toISOString(), account: session.user.email, actor: session.user.id, site: SITE };
const act = (plan) => {
  const k = Object.keys(plan || {}).find((x) => x.startsWith('scendance-outdoor-plan-v1:house-'));
  return k ? { slot: k, ...plan[k] } : plan;
};
const writes = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
const taskText = () => page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || document.body.innerText).replace(/\s+/g, ' ').slice(0, 1400));
const cloudFor = async (plan) => {
  const slot = plan?.slot || Object.keys(plan || {}).find((k) => k.startsWith('scendance-outdoor-plan-v1:house-'));
  const localId = slot ? slot.split(':').pop() : null;
  const readings = await outdoorPlanReadings(session.user.id);
  return { localId, readings: readings.available ? readings.list.filter((r) => r.local_activity_id === localId) : readings };
};

try {
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  await skipGuide(page).catch(() => {});
  await dismissCloudRecover(page);

  out.blank = act(await planState(page));
  await page.screenshot({ path: `${OUT}/2026-11-19-v8-blank.png` });

  const m1 = netlog.length;
  await chat(page, '在杭州湖滨银泰in77做200人发布会，户外广场30×20米，签到台放西侧入口，留出通道', { wait: 35000 });
  out.composite = { taskText: await taskText(), calls: netlog.slice(m1).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => `${n.method} ${n.status}`), writes: writes(m1), plan: act(await planState(page)) };
  await page.screenshot({ path: `${OUT}/2026-11-19-v8-composite.png` });

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
  out.boundaryCloud = await cloudFor(out.boundary);
  await page.screenshot({ path: `${OUT}/2026-11-19-v8-boundary.png` });
  if (!out.boundary?.counts?.boundary) throw new Error(`边界没有闭合：${JSON.stringify(out.boundary)}`);

  const m2 = netlog.length;
  await chat(page, '室外展览区和表演区', { wait: 50000 });
  out.zoneUse = { taskText: await taskText(), calls: netlog.slice(m2).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => `${n.method} ${n.status}`), writes: writes(m2), plan: act(await planState(page)) };
  await page.screenshot({ path: `${OUT}/2026-11-19-v8-zones.png` });

  // 若还停在分区预览入口，点一下“生成分区预览/出分区预览”，不伪造提案。
  if (!out.zoneUse.plan?.counts?.zones) {
    const gen = page.getByRole('button', { name: /生成分区预览|出分区预览/ }).first();
    if (await gen.count()) {
      await gen.click().catch(() => {});
      await page.waitForTimeout(25000);
      out.zoneUse.afterGen = { taskText: await taskText(), plan: act(await planState(page)), writes: writes(m2) };
      await page.screenshot({ path: `${OUT}/2026-11-19-v8-zones-after-gen.png` });
    }
  }
  out.final = act(await planState(page));
  out.finalCloud = await cloudFor(out.final);
  out.writes = writes();
  out.consoleErrors = consoleErrors.slice(0, 10);
  out.ok = true;
} catch (error) {
  out.ok = false;
  out.error = String(error?.stack || error).slice(0, 1800);
  out.taskText = await taskText().catch(() => null);
  out.final = act(await planState(page).catch(() => null));
  await page.screenshot({ path: `${OUT}/2026-11-19-v8-failure.png` }).catch(() => {});
} finally {
  fs.writeFileSync(`${OUT}/2026-11-19-case01-v8.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1).slice(0, 9000));
  await browser.close();
}