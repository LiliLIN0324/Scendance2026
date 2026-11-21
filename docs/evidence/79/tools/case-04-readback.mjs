// #4 带已确认边界草稿的同轮浏览器写读对照：adopt A 既有云端快照（3eb2…/house-8z42f0xm），
// 浏览器全槽 counts/分区名/planLen/last 指针 vs 直连 GET /outdoor-plans/<activityId> 逐项对照。
// 不依赖模型回合；只验既有带边界草稿在浏览器读回与云端一致。不代签、不升 pass。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, SITE, REF, launch, skipGuide, dismissCloudRecover, cloudFetch, planState,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/04';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const A = { activityId: '3eb2bbdb-8e8f-4fb5-b0ee-060836ffaf94', local: 'house-8z42f0xm' };

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: '#4 带边界草稿同轮写读对照：浏览器 adopt A 后读回全槽，与直连 GET 云端快照逐项对照 counts/分区名/planLen。revision 差为 adopt 后例行副本同步（已知机制），对照 counts 不串即可。',
  steps: [],
};

// ---------- 1. 直连云端基线 ----------
const baseCloud = await cloudFetch(session, `/outdoor-plans/${A.activityId}`)
  .catch((e) => ({ status: 'ERR', body: String(e).slice(0, 200) }));
const basePlan = baseCloud.body?.plan ?? baseCloud.body ?? {};
const cloudSummary = (plan) => plan ? {
  counts: {
    zones: (plan.zones || []).length,
    boundary: (plan.boundary || []).length,
    nodes: (plan.nodes || []).length,
    routes: (plan.routes || []).length,
    entrances: (plan.entrances || []).length,
  },
  zoneNames: (plan.zones || []).map((z) => z.name).filter(Boolean),
  planLen: JSON.stringify(plan).length,
} : null;
out.cloudBefore = {
  status: baseCloud.status,
  found: baseCloud.body?.found ?? null,
  revision: baseCloud.body?.revision ?? null,
  summary: cloudSummary(basePlan),
};
console.log('[cloud-before]', baseCloud.status, 'rev=', baseCloud.body?.revision, JSON.stringify(out.cloudBefore.summary));

// ---------- 2. 浏览器 ----------
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

async function readActiveSlot() {
  const slots = await page.evaluate(() => {
    const res = {};
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('scendance-outdoor-plan-v1:')) continue;
      try {
        const env = JSON.parse(localStorage.getItem(k));
        const p = env.plan || {};
        res[k] = {
          projectId: env.projectId ?? null,
          remoteActivityId: env.remoteActivityId ?? null,
          remoteRevision: typeof env.remoteRevision === 'number' ? env.remoteRevision : null,
          counts: {
            zones: (p.zones || []).length, boundary: (p.boundary || []).length,
            nodes: (p.nodes || []).length, routes: (p.routes || []).length,
            entrances: (p.entrances || []).length,
          },
          zoneNames: (p.zones || []).map((z) => z.name).filter(Boolean),
          planLen: JSON.stringify(p).length,
        };
      } catch (e) { res[k] = { error: String(e) }; }
    }
    res['scendance-outdoor-last-v1'] = localStorage.getItem('scendance-outdoor-last-v1');
    return res;
  });
  let active = null;
  for (const [k, v] of Object.entries(slots)) {
    if (!k.startsWith('scendance-outdoor-plan-v1:')) continue;
    if (v.error) continue;
    if ((v.counts?.boundary ?? 0) >= 3) active = { slot: k, ...v };
  }
  return { active, allSlots: slots };
}

async function clearOutdoorSlots() {
  await page.evaluate(() => {
    for (const k of [...Object.keys(localStorage)]) {
      if (k.startsWith('scendance-outdoor-plan-v1') || k === 'scendance-outdoor-last-v1') localStorage.removeItem(k);
    }
  });
}

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}${n.body ? ' :: ' + String(n.body).slice(0, 120) : ''}`);

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);

let { active } = await readActiveSlot();
const mAdopt = netlog.length;

async function waitRecoverRows(timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')].length);
    if (rows) return rows;
    await page.waitForTimeout(1000);
  }
  return 0;
}

if (!active) {
  await clearOutdoorSlots();
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  await skipGuide(page).catch(() => {});
  await page.waitForTimeout(2000);
  await waitRecoverRows();

  const list = await cloudFetch(session, '/outdoor-plans').catch(() => ({ body: [] }));
  const aRow = (Array.isArray(list.body) ? list.body : []).find((x) => (x.activityId ?? x.activity_id) === A.activityId);
  const aRev = aRow?.revision ?? null;
  out.recoverListLen = Array.isArray(list.body) ? list.body.length : null;
  out.recoverTargetRevision = aRev;

  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')]
    .map((r, i) => ({ i, text: (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) })));
  out.recoverRows = rows.slice(0, 12);
  let idx = aRev != null ? rows.findIndex((r) => r.text.includes(`版本 ${aRev} `)) : -1;
  if (idx < 0) idx = rows.findIndex((r) => r.text.includes('摊位区'));
  out.picked = idx >= 0 ? await page.evaluate((i) => {
    const row = document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')[i];
    const btn = row?.querySelector('[data-testid=outdoor-cloud-recover-open]') ?? row?.querySelector('button');
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return { testid: btn.getAttribute('data-testid'), disabled: btn.disabled };
  }, idx).catch((e) => ({ error: String(e).slice(0, 200) })) : null;
  await page.waitForTimeout(12000);
  ({ active } = await readActiveSlot());
}

out.adopt = {
  target: A,
  browser: active,
  writes: writes(mAdopt),
};

if (!active) {
  out.steps.push({ step: 1, name: 'guard: adopt 后仍无边界槽', browser: null });
  out.consoleErrors = consoleErrors.slice(0, 20);
  fs.writeFileSync(`${OUT}/2026-11-21-case04-readback.json`, JSON.stringify(out, null, 2));
  console.log('GUARD_FAIL: no active boundary slot');
  await browser.close();
  process.exit(2);
}

// ---------- 3. 同轮再直连读云端（adopt 后例行副本可能 +1） ----------
const afterCloud = await cloudFetch(session, `/outdoor-plans/${A.activityId}`)
  .catch((e) => ({ status: 'ERR', body: String(e).slice(0, 200) }));
const afterPlan = afterCloud.body?.plan ?? afterCloud.body ?? {};
out.cloudAfter = {
  status: afterCloud.status,
  found: afterCloud.body?.found ?? null,
  revision: afterCloud.body?.revision ?? null,
  summary: cloudSummary(afterPlan),
};

// ---------- 4. 对照 ----------
const b = active;
const c = out.cloudAfter.summary ?? out.cloudBefore.summary;
const eqSet = (a, z) => Array.isArray(a) && Array.isArray(z) && a.length === z.length && a.every((x) => z.includes(x));
out.comparison = {
  remoteActivityIdMatches: b.remoteActivityId === A.activityId,
  zonesMatch: b.counts.zones === c?.counts.zones,
  boundaryMatch: b.counts.boundary === c?.counts.boundary,
  nodesMatch: b.counts.nodes === c?.counts.nodes,
  zoneNamesMatch: eqSet(b.zoneNames, c?.zoneNames),
  planLenMatch: b.planLen === c?.planLen,
  browser: b,
  cloud: c,
  revisionBrowser: b.remoteRevision,
  revisionCloud: out.cloudAfter.revision,
};
out.steps.push({ step: 1, name: 'readback 对照', comparison: out.comparison });
out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-21-case04-readback.json`, JSON.stringify(out, null, 2));
console.log('[comparison]', JSON.stringify(out.comparison, null, 1));
await browser.close();
