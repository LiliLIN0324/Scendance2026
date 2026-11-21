// #4 v7：新匿名会话 + 空白草稿，无范围先发设计句，再改人数。
// 判据：第一条 action=ask 中性追问、留存 guests/zones、不挂范围红卡；第二条纯人数 revise 不误发红卡。
import fs from 'node:fs';
import {
  launch, newGuestSession, readEnv, skipGuide, chat, planState,
  dismissCloudRecover, chatText, summary, writeEvidence, SITE,
} from './harness-proxy.mjs';

const OUT = 'docs/evidence/79/04';
const NB = '地图上还没有可核对的活动边界';
const PROXY_BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';

const env = readEnv();
const session = await newGuestSession(env);
const out = {
  ranAt: new Date().toISOString(),
  account: session.user?.email ?? null,
  sessionUser: session.user?.id ?? null,
  site: SITE,
};

const { browser, page, netlog, consoleErrors } = await launch({ session, proxyBypass: PROXY_BYPASS });
const act = (plan) => {
  const k = Object.keys(plan || {}).find((x) => x.startsWith('scendance-outdoor-plan-v1:house-'));
  return k ? { slot: k, ...plan[k] } : plan;
};
const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 110)}`);
const redCard = async () => (await chatText(page)).includes(NB);
const flowBrief = () => page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('scendance:outdoor-flow:')) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      out[k] = { stage: s.stage, brief: s.brief ? { guests: s.brief.guests, event: s.brief.event, zones: s.brief.zones, itemCount: s.brief.items?.length } : null };
    } catch (e) { out[k] = { error: String(e) }; }
  }
  return out;
});

try {
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  await skipGuide(page).catch(() => {});
  await dismissCloudRecover(page).catch(() => {});
  out.initial = act(await planState(page));

  const m1 = netlog.length;
  await chat(page, '做200人发布会，签到台放西侧入口，留出通道', { wait: 45000 });
  out.turn1 = {
    taskText: await chatText(page),
    summary: await summary(page),
    plan: act(await planState(page)),
    writes: writes(m1),
    redCard: await redCard(),
    flow: await flowBrief(),
  };
  await page.screenshot({ path: `${OUT}/2026-11-20-v7-turn1-design.png` }).catch(() => {});

  const m2 = netlog.length;
  await chat(page, '人数改为 150 人，保持现有分区。', { wait: 45000 });
  out.turn2 = {
    taskText: await chatText(page),
    summary: await summary(page),
    plan: act(await planState(page)),
    writes: writes(m2),
    redCard: await redCard(),
    flow: await flowBrief(),
  };
  await page.screenshot({ path: `${OUT}/2026-11-20-v7-turn2-headcount.png` }).catch(() => {});

  out.writes = writes();
  out.ok = true;
} catch (error) {
  out.ok = false;
  out.error = String(error?.stack || error).slice(0, 1500);
  out.taskText = await chatText(page).catch(() => null);
  await page.screenshot({ path: `${OUT}/2026-11-20-v7-failure.png` }).catch(() => {});
} finally {
  out.consoleErrors = consoleErrors.slice(0, 10);
  writeEvidence(4, '2026-11-20-case04-v7-blank.json', out);
  console.log(JSON.stringify(out, null, 1).slice(0, 9000));
  await browser.close();
}
