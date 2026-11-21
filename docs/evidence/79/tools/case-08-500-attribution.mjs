// #8 补录：旧证据 1 条 500 未留存端点归属。本探针 adopt A 一次（例行副本 PUT 200，与历史同口径），
// 全量记账所有 >=400 响应（不过滤域名，区分 resourceType，GET 也读 body 摘要），定位 500 归属。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SITE, REF, cloudFetch, launch, skipGuide, planState } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/08/v12';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const A = { activityId: '3eb2bbdb-8e8f-4fb5-b0ee-060836ffaf94' };

const bad = [];
const apiSeen = new Set();

const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

page.on('response', async (res) => {
  const url = res.url();
  const method = res.request().method();
  const rtype = res.request().resourceType();
  const rec = { method, status: res.status(), rtype, url: url.replace(/([?&](token|apikey|access_token)=)[^&]+/gi, '$1***').replace(/https:\/\/[^/]+/, '') };
  if (/scene-api|supabase\.co/.test(url)) apiSeen.add(`${method} ${res.status()} ${rec.url}`);
  if (res.status() >= 400) {
    let body = null;
    if (['xhr', 'fetch'].includes(rtype)) {
      try { body = (await res.text()).slice(0, 400); } catch { body = '<unreadable>'; }
    }
    bad.push({ ...rec, body });
  }
});

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});

// 等找回弹层 row 出现
let rows = [];
for (let i = 0; i < 20; i += 1) {
  rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')]
    .map((r, k) => ({ k, text: (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100) })));
  if (rows.length) break;
  await page.waitForTimeout(1500);
}

// 直连读 A 当前 revision，按「版本 N」匹配行
const one = await cloudFetch(session, `/outdoor-plans/${A.activityId}`).catch((e) => ({ status: 'ERR', body: String(e).slice(0, 120) }));
const aRevision = one.body?.revision ?? null;
const hit = rows.find((r) => aRevision != null && r.text.includes(`版本 ${aRevision} `)) ?? rows[0] ?? null;

let adopt = null;
if (hit) {
  adopt = await page.evaluate((idx) => {
    const row = document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')[idx];
    const btn = row?.querySelector('[data-testid=outdoor-cloud-recover-open]') ?? row?.querySelector('button');
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return { testid: btn.getAttribute('data-testid'), disabled: btn.disabled };
  }, hit.k).catch((e) => ({ error: String(e).slice(0, 200) }));
  await page.waitForTimeout(12000);
}

const out = {
  ranAt: new Date().toISOString(),
  identity: { email: session.user.email, id: session.user.id },
  ref: REF,
  note: '500 端点归属补录；adopt A 一次。',
  cloudA: { status: one.status, revision: aRevision, found: one.body?.found ?? null },
  recoverRows: rows.slice(0, 14),
  adopted: hit ? { rowText: hit.text, pick: adopt } : null,
  badResponses: bad,
  apiEndpoints: [...apiSeen],
  planState: await planState(page),
  consoleErrors: consoleErrors.slice(0, 20),
  netlog500: netlog.filter((n) => n.t === 'res' && n.status >= 500).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '')}`),
};

fs.writeFileSync(`${OUT}/2026-11-20-case08-500-attribution.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ rows: rows.length, aRevision, adopted: out.adopted, bad: bad.map((b) => `${b.method} ${b.status} ${b.rtype} ${b.url}`) }, null, 1).slice(0, 3000));
await browser.close();
