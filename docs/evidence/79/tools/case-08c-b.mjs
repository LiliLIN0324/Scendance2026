// #8c B 对照：空设备 adopt B（78b5f886 / house-vb5f3okg, rev3, zones0/边界12/入口1/909B）
// → 核对 B 槽不写 A 四分区指纹；清本机槽重载 → 再 adopt A（3eb2…/house-8z42f0xm, rev12, zones4/2589）
// → 核对 A 留存四分区；云端两份快照直连旁证分槽独立。同上下文热切换入口当前 UI 不存在（台账 gap 已记）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SITE, REF, BASE, launch, skipGuide, planState, cloudFetch } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/08/v11';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const A = { activityId: '3eb2bbdb-8e8f-4fb5-b0ee-060836ffaf94', local: 'house-8z42f0xm', revision: 12 };
const B = { activityId: '78b5f886-337a-4326-bac7-a1415b50a67d', local: 'house-vb5f3okg', revision: 3 };
const A_ZONES = ['摊位区', '舞台表演区', '签到服务区', '观众区'];

const detail = (page) => page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('scendance-outdoor-plan-v1')) continue;
    try {
      const env = JSON.parse(localStorage.getItem(k));
      const p = env.plan || {};
      out[k] = {
        projectId: env.projectId ?? null,
        remoteActivityId: env.remoteActivityId ?? null,
        remoteRevision: typeof env.remoteRevision === 'number' ? env.remoteRevision : null,
        counts: { zones: (p.zones || []).length, boundary: (p.boundary || []).length, nodes: (p.nodes || []).length },
        zoneNames: (p.zones || []).map((z) => z.name),
        planLen: JSON.stringify(p).length,
      };
    } catch (e) { out[k] = { error: String(e) }; }
  }
  out['scendance-outdoor-last-v1'] = localStorage.getItem('scendance-outdoor-last-v1');
  return out;
});

async function pickRecover(page, rev, label) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')]
    .map((r, i) => ({ i, text: (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) })));
  const idx = rows.findIndex((r) => r.text.includes(`版本 ${rev} `));
  const picked = idx >= 0 ? await page.evaluate((i) => {
    const row = document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')[i];
    const btn = row?.querySelector('[data-testid=outdoor-cloud-recover-open]') ?? row?.querySelector('button');
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return { testid: btn.getAttribute('data-testid'), disabled: btn.disabled };
  }, idx).catch((e) => ({ error: String(e).slice(0, 200) })) : null;
  await page.waitForTimeout(12000);
  return { label, rows: rows.slice(0, 12), idx, rowText: idx >= 0 ? rows[idx]?.text : null, picked };
}

const out = { ranAt: new Date().toISOString(), identity: { email: session.user.email, id: session.user.id }, site: SITE, ref: REF, note: '8c B 对照：adopt B → 清槽重载 → adopt A；云端快照旁证。', steps: [] };

// 云端两份快照（直连旁证）
for (const [tag, act] of [['A', A], ['B', B]]) {
  const one = await cloudFetch(session, `/outdoor-plans/${act.activityId}`).catch((e) => ({ status: 'ERR', body: String(e).slice(0, 120) }));
  const plan = one.body?.plan ?? one.body ?? {};
  out[`cloud_${tag}`] = {
    status: one.status, found: one.body?.found ?? null, revision: one.body?.revision ?? null,
    counts: { zones: (plan.zones || []).length, boundary: (plan.boundary || []).length, nodes: (plan.nodes || []).length, planLen: JSON.stringify(plan).length },
    zoneNames: (plan.zones || []).map((z) => z.name),
  };
}

const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

// —— 第一段：adopt B ——
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);
const mB = netlog.length;
out.steps.push(await pickRecover(page, B.revision, 'adopt-B'));
out.afterB = { detail: await detail(page), state: await planState(page) };
out.afterB.writes = netlog.slice(mB).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
out.afterB.bHasAZones = A_ZONES.every((z) => JSON.stringify(out.afterB.detail).includes(z));
await page.screenshot({ path: `${OUT}/2026-11-20-v11-after-b.png` }).catch(() => {});

// —— 清本机槽，重载，弹层因 fresh 再现 ——
await page.evaluate(() => {
  for (const k of [...Object.keys(localStorage)]) {
    if (k.startsWith('scendance-outdoor-plan-v1') || k === 'scendance-outdoor-last-v1') localStorage.removeItem(k);
  }
});
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);

// —— 第二段：adopt A ——
const mA = netlog.length;
out.steps.push(await pickRecover(page, A.revision, 'adopt-A'));
out.afterA = { detail: await detail(page), state: await planState(page) };
out.afterA.writes = netlog.slice(mA).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
out.afterA.aHasAZones = A_ZONES.every((z) => JSON.stringify(out.afterA.detail).includes(z));
await page.screenshot({ path: `${OUT}/2026-11-20-v11-after-a-reopen.png` }).catch(() => {});

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case08c-b.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  cloudA: out.cloud_A, cloudB: out.cloud_B,
  afterB: { detail: out.afterB.detail, bHasAZones: out.afterB.bHasAZones },
  afterA: { detail: out.afterA.detail, aHasAZones: out.afterA.aHasAZones },
}, null, 1));
await browser.close();
