// #5 地图部分覆盖探针：只拦地图瓦片（image 资源），保留地点检索 /api/amap-place 与云端 API；
// 观察部分瓦片失败时的界面提示、本机方案是否不变、是否产生云端写请求。
// 离线 reload 无 SW 壳已定性（见 offline-cache-probe.json），本探针只测「部分瓦片失败」。
// 瓦片域名来自 lib/tdt-probe.ts：autonavi(高德) / arcgisonline(Esri) / openstreetmap(OSM) /
// tianditu(天地图直连) / 同源 /api/tdt-tiles /api/carto-tiles。提示文案逐字，无提示就记「产品无降级提示」。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, cloudFetch, SITE, REF, planState,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/05';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const { browser, context, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

// 瓦片 host（公共图源）；同源代理按 pathname 匹配
const TILE_HOST_RE = /(autonavi\.com|arcgisonline\.com|openstreetmap\.org|tianditu\.gov\.cn)/i;
const TILE_PATH_RE = /\/api\/(tdt-tiles|carto-tiles)/i;

const out = {
  ranAt: new Date().toISOString(),
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: '两段式：A 段观察收集瓦片 host；B 段仅拦瓦片 image，放行 amap-place/supabase/同源静态。提示文案逐字，方案 counts 不变、云端写单独记账。',
  observedImageHosts: [],
  stages: [],
};

const imageHosts = new Set();
page.on('request', (req) => {
  if (req.resourceType() === 'image') {
    try { imageHosts.add(new URL(req.url()).host); } catch { /* ignore */ }
  }
});

function isTile(url) {
  try {
    const u = new URL(url);
    return TILE_HOST_RE.test(u.host) || TILE_PATH_RE.test(u.pathname);
  } catch { return false; }
}

async function readMapHints() {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const hits = text.split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => /地图|瓦片|路网|加载|失败|离线|暂无|提示|error/i.test(s))
      .slice(0, 12);
    const errEls = [...document.querySelectorAll('.sc-amap-error,[class*=error],[class*=fail]')]
      .filter((el) => el.getBoundingClientRect().width > 1)
      .map((el) => (el.innerText || '').trim().slice(0, 120));
    return { hintLines: hits, errorEls: errEls };
  });
}

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);

// ---------- A 段：观察（不拦截） ----------
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(8000);
out.observedImageHosts = [...imageHosts];
out.stages.push({
  stage: 'A-observe',
  mapHints: await readMapHints(),
  plan: await planState(page),
  writes: writes(0),
  imageHosts: [...imageHosts],
});
await page.screenshot({ path: `${OUT}/2026-11-20-case05-tile-A.png` }).catch(() => {});

// ---------- B 段：部分瓦片拦截 ----------
const blocked = [];
await context.route('**/*', (route) => {
  const req = route.request();
  const url = req.url();
  if (req.resourceType() === 'image' && isTile(url)) {
    blocked.push(url.replace(/^https?:\/\//, '').slice(0, 120));
    return route.fulfill({ status: 404, body: 'tile-blocked', contentType: 'text/plain' });
  }
  return route.continue();
});

const mB = netlog.length;
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(10000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(6000);

out.stages.push({
  stage: 'B-blocked-tiles',
  blockedCount: blocked.length,
  blockedSample: blocked.slice(0, 10),
  mapHints: await readMapHints(),
  plan: await planState(page),
  writes: writes(mB),
});
await page.screenshot({ path: `${OUT}/2026-11-20-case05-tile-B.png` }).catch(() => {});

// 云端只读旁证：带边界草稿 revision 可读（不写）
const list = await cloudFetch(session, '/outdoor-plans').catch((e) => ({ status: 'ERR', body: String(e).slice(0, 200) }));
out.cloudList = { status: list.status, listLen: Array.isArray(list.body) ? list.body.length : null };
out.consoleErrors = consoleErrors.slice(0, 20);

fs.writeFileSync(`${OUT}/2026-11-20-case05-tile-partial-probe.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ hosts: out.observedImageHosts, stages: out.stages.map((s) => ({ stage: s.stage, blockedCount: s.blockedCount, writes: s.writes, hints: s.mapHints?.hintLines })) }, null, 2));
await browser.close();
