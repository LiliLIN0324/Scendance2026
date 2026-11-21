// #4 v7 登录态内存旁证探针：空白无范围序列两轮，读 brief / sessions / bodies 三类槽，
// 对照 activeId 是否落进 brief.byId、抽取字段是否回填，判定首句落在哪条不写分支。
// 证据件只记 user id/email 与槽摘要，不写 access/refresh 令牌。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, chat, SITE, REF, planState,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v7.json'), 'utf8'));
const OUT = 'docs/evidence/79/04';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const MEMORY_FIELDS = ['event', 'headcount', 'headcountMode', 'allGuestsSeated', 'venueIO', 'zoneNeeds', 'pendingBasicFacts', 'unresolvedActivityNeeds', 'layoutMode', 'eventIntent'];

async function sendChat(text, wait = 25000) {
  await dismissCloudRecover(page);
  const ta = page.locator('textarea').first();
  await ta.fill(text);
  await ta.press('Enter');
  await page.waitForTimeout(wait);
}

const out = {
  ranAt: new Date().toISOString(),
  case: 4,
  scenario: '登录态 · 空白无范围 · 首句设计句 + 人数变更 · 三类槽内存旁证',
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  stages: [],
};

async function readAssistantStorage() {
  return page.evaluate((FIELDS) => {
    const pick = (m) => {
      if (!m || typeof m !== 'object') return null;
      const acc = {};
      for (const f of FIELDS) if (f in m) acc[f] = m[f];
      return acc;
    };
    const scopes = {};
    let activeId = null;
    let briefKeys = [];
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('scendance.assistant-')) continue;
      let raw;
      try { raw = JSON.parse(localStorage.getItem(k)); } catch (e) { scopes[k] = { error: String(e) }; continue; }
      const rec = { key: k };
      if (raw && raw.activeId !== undefined) {
        activeId = raw.activeId;
        rec.activeId = raw.activeId;
        rec.sessions = (raw.sessions || []).map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }));
      } else if (raw && raw.byId && k.includes('brief-memory')) {
        briefKeys = Object.keys(raw.byId || {});
        rec.memory = Object.fromEntries(Object.entries(raw.byId || {}).map(([id, m]) => [id, pick(m)]));
      } else if (raw && raw.byId) {
        rec.bodies = Object.fromEntries(Object.entries(raw.byId || {}).map(([id, arr]) => [id, (arr || []).map((b) => ({ role: b.role, text: (b.text || '').slice(0, 160), warn: b.warn || null, alertStamp: b.alertStamp || null }))]));
      } else {
        rec.raw = raw;
      }
      scopes[k] = rec;
    }
    return { scopes, activeId, briefKeys, activeInBrief: activeId ? briefKeys.includes(activeId) : null };
  }, MEMORY_FIELDS);
}

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);

async function bodyHints() {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    return text.split(/\n+/).map((s) => s.trim())
      .filter((s) => /人数|headcount|范围|场地|继续|请先|确认|分区|通道|入口|留下|留着/.test(s)).slice(0, 12);
  });
}

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(1500);

out.baseline = { storage: await readAssistantStorage(), plan: await planState(page) };

const m1 = netlog.length;
await sendChat('做 200 人发布会，签到台放西侧入口，留出通道', 25000);
out.stages.push({
  stage: 'first-design-sentence',
  storage: await readAssistantStorage(),
  plan: await planState(page),
  writes: writes(m1),
  bodyHints: await bodyHints(),
});

const m2 = netlog.length;
await sendChat('人数改 150，保持现有分区', 20000);
out.stages.push({
  stage: 'headcount-change',
  storage: await readAssistantStorage(),
  plan: await planState(page),
  writes: writes(m2),
  bodyHints: await bodyHints(),
});

out.consoleErrors = consoleErrors.slice(0, 20);
const file = `${OUT}/2026-11-21-case04-memory-v7.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.stages.map((s) => ({
  stage: s.stage,
  activeId: s.storage.activeId,
  briefKeys: s.storage.briefKeys,
  activeInBrief: s.storage.activeInBrief,
  plan: s.plan,
  writes: s.writes,
  bodyHints: s.bodyHints,
})), null, 2));
await browser.close();
