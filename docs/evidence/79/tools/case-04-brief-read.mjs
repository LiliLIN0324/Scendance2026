// #4 本机 brief 读数探针：不依赖 React 内部 state，直接读持久化槽。
// 三类槽（均按 project scope 分键，见 lib/assistant-sessions.ts / assistant-session-bodies.ts / assistant-brief-memory.ts）：
//   索引  scendance.assistant-sessions.v1[.scope.<pid>]  { activeId, sessions:[{id,title}] }
//   气泡  scendance.assistant-session-bodies.v1[.scope.<pid>] { byId:{sid:[{role,text,warn,alertStamp}]} }
//   brief scendance.assistant-brief-memory.v1[.scope.<pid>]  { byId:{sid:{event,headcount,headcountMode,venueIO,zoneNeeds,...}} }
// 核对首句设计句留存的 headcount/event/zoneNeeds，第二条人数变更是否误拦、plan 是否被破坏。
// 只存键名与摘要值，长句截断，不伪造 turnId。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, chat, SITE, REF, planState,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/04';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const out = {
  ranAt: new Date().toISOString(),
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: '枚举 scendance.assistant-* 三类槽，按 activeId 关联 brief-memory 字段；对照 planState 与云端写。',
  stages: [],
};

const MEMORY_FIELDS = ['event', 'headcount', 'headcountMode', 'allGuestsSeated', 'venueIO', 'zoneNeeds', 'pendingBasicFacts', 'unresolvedActivityNeeds', 'layoutMode', 'eventIntent'];

async function readAssistantStorage() {
  return page.evaluate((FIELDS) => {
    const pick = (m) => {
      if (!m || typeof m !== 'object') return null;
      const acc = {};
      for (const f of FIELDS) if (f in m) acc[f] = m[f];
      return acc;
    };
    const scopes = {};
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('scendance.assistant-')) continue;
      let raw;
      try { raw = JSON.parse(localStorage.getItem(k)); } catch (e) { scopes[k] = { error: String(e) }; continue; }
      const rec = { key: k };
      if (raw && raw.activeId !== undefined) {
        rec.activeId = raw.activeId;
        rec.sessions = (raw.sessions || []).map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }));
      } else if (raw && raw.byId && k.includes('brief-memory')) {
        rec.memory = Object.fromEntries(Object.entries(raw.byId || {}).map(([id, m]) => [id, pick(m)]));
      } else if (raw && raw.byId) {
        rec.bodies = Object.fromEntries(Object.entries(raw.byId || {}).map(([id, arr]) => [id, (arr || []).map((b) => ({ role: b.role, text: (b.text || '').slice(0, 160), warn: b.warn || null, alertStamp: b.alertStamp || null }))]));
      } else {
        rec.raw = raw;
      }
      scopes[k] = rec;
    }
    return scopes;
  }, MEMORY_FIELDS);
}

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);

async function bodyHints() {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const hits = text.split(/\n+/).map((s) => s.trim())
      .filter((s) => /人数|headcount|范围|场地|继续|请先|确认|分区|通道|入口/.test(s)).slice(0, 12);
    return hits;
  });
}

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(1500);

// 阶段 1：首句设计句
const m1 = netlog.length;
await chat(page, '做 200 人发布会，签到台放西侧入口，留出通道', { wait: 25000 });
out.stages.push({
  stage: 'first-design-sentence',
  storage: await readAssistantStorage(),
  plan: await planState(page),
  writes: writes(m1),
  bodyHints: await bodyHints(),
});

// 阶段 2：人数变更
const m2 = netlog.length;
await chat(page, '人数改 150，保持现有分区', { wait: 20000 });
out.stages.push({
  stage: 'headcount-change',
  storage: await readAssistantStorage(),
  plan: await planState(page),
  writes: writes(m2),
  bodyHints: await bodyHints(),
});

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case04-brief-read.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.stages.map((s) => ({ stage: s.stage, plan: s.plan, writes: s.writes, bodyHints: s.bodyHints, storage: s.storage })), null, 2));
await browser.close();
