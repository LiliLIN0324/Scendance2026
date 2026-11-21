// #3 路线小改前后对照：adopt A（house-8z42f0xm / 3eb2…，已 zones4/边界12/入口1）做基线，
// 发明确路线小改句「主通道改走场地北侧…」，观察模型是否回路线候选/预览，读前后 zones/routes/planLen 与云端 revision。
// 模型不出候选如实记 blocked，不伪造前后对照。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SITE, REF, BASE, launch, skipGuide, dismissCloudRecover, planState, cloudFetch, chat, summary, chatText, waitForButton } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/03';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const A = { activityId: '3eb2bbdb-8e8f-4fb5-b0ee-060836ffaf94', local: 'house-8z42f0xm' };
const TURN = '主通道改走场地北侧，别沿湖滨路走，留一条宽通道连通两个出入口。';

const detail = (page) => page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('scendance-outdoor-plan-v1')) continue;
    try {
      const env = JSON.parse(localStorage.getItem(k));
      const p = env.plan || {};
      out[k] = {
        remoteActivityId: env.remoteActivityId ?? null, remoteRevision: env.remoteRevision ?? null,
        counts: { zones: (p.zones || []).length, boundary: (p.boundary || []).length, nodes: (p.nodes || []).length, routes: (p.routes || []).length },
        routeCount: (p.routes || []).length, planLen: JSON.stringify(p).length,
      };
    } catch (e) { out[k] = { error: String(e) }; }
  }
  out.last = localStorage.getItem('scendance-outdoor-last-v1');
  return out;
});

const out = { ranAt: new Date().toISOString(), identity: { email: session.user.email, id: session.user.id }, site: SITE, ref: REF, turn: TURN, steps: [] };
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

// 云端基线 revision
const baseCloud = await cloudFetch(session, `/outdoor-plans/${A.activityId}`).catch((e) => ({ status: 'ERR', body: String(e).slice(0, 120) }));
const basePlan = baseCloud.body?.plan ?? baseCloud.body ?? {};
out.cloudBefore = { status: baseCloud.status, found: baseCloud.body?.found ?? null, revision: baseCloud.body?.revision ?? null, counts: { zones: (basePlan.zones || []).length, boundary: (basePlan.boundary || []).length, nodes: (basePlan.nodes || []).length, routes: (basePlan.routes || []).length, planLen: JSON.stringify(basePlan).length } };

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);

// recover adopt A：先取云端 list 找 A revision，按「版本 N」匹配行
const list = await cloudFetch(session, '/outdoor-plans').catch(() => ({ body: [] }));
const aRow = (Array.isArray(list.body) ? list.body : []).find((x) => (x.activityId ?? x.activity_id) === A.activityId);
const aRev = aRow?.revision ?? null;
out.aCloudRevision = aRev;

const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')]
  .map((r, i) => ({ i, text: (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) })));
out.recoverRows = rows.slice(0, 12);
let idx = aRev != null ? rows.findIndex((r) => r.text.includes(`版本 ${aRev} `)) : -1;
if (idx < 0) idx = rows.findIndex((r) => r.text.includes('摊位区') || true);
out.picked = idx >= 0 ? await page.evaluate((i) => {
  const row = document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')[i];
  const btn = row?.querySelector('[data-testid=outdoor-cloud-recover-open]') ?? row?.querySelector('button');
  if (!btn) return null;
  btn.scrollIntoView({ block: 'center' }); btn.click();
  return { testid: btn.getAttribute('data-testid'), disabled: btn.disabled, row: (row.innerText || '').replace(/\s+/g, ' ').slice(0, 100) };
}, idx).catch((e) => ({ error: String(e).slice(0, 200) })) : null;
await page.waitForTimeout(12000);
await dismissCloudRecover(page).catch(() => {});

out.localBaseline = { detail: await detail(page), state: await planState(page) };

// 发路线小改句
const m0 = netlog.length;
out.chatSent = await chat(page, TURN, { wait: 30000 }).then(() => true).catch((e) => ({ error: String(e).slice(0, 160) }));
out.afterTurn = {
  text: await chatText(page).catch(() => null),
  summary: await summary(page).catch(() => null),
  detail: await detail(page),
};
out.afterTurn.writes = netlog.slice(m0).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 80)}`);
out.afterTurn.modelCalls = netlog.slice(m0).filter((n) => /assistant\/chat|conversation-api/.test(n.url))
  .map((n) => `${n.t} ${n.method} ${n.status ?? ''} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 60)}`);

// 云端复核
const afterCloud = await cloudFetch(session, `/outdoor-plans/${A.activityId}`).catch((e) => ({ status: 'ERR', body: String(e).slice(0, 120) }));
const afterPlan = afterCloud.body?.plan ?? afterCloud.body ?? {};
out.cloudAfter = { status: afterCloud.status, found: afterCloud.body?.found ?? null, revision: afterCloud.body?.revision ?? null, counts: { zones: (afterPlan.zones || []).length, boundary: (afterPlan.boundary || []).length, nodes: (afterPlan.nodes || []).length, routes: (afterPlan.routes || []).length, planLen: JSON.stringify(afterPlan).length } };
out.consoleErrors = consoleErrors.slice(0, 20);
await page.screenshot({ path: `${OUT}/2026-11-20-v3-route-turn.png` }).catch(() => {});

fs.writeFileSync(`${OUT}/2026-11-20-case03-route-turn.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ cloudBefore: out.cloudBefore, picked: out.picked, afterText: String(out.afterTurn.text).slice(0, 200), afterDetail: out.afterTurn.detail, cloudAfter: out.cloudAfter, writes: out.afterTurn.writes, modelCalls: out.afterTurn.modelCalls }, null, 1));
await browser.close();
