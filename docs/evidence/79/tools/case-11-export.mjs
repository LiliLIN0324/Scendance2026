// #11 户外方案态效果图导出探针：adopt A 基线（zones4/边界12/入口1/2589B）后，
// 核对右轨选项弹窗 #tool-export 在户外态是否存在（源码 !outdoorEditing 隐藏），
// 再走分享面板「导出 → 效果图」条目，监听浏览器 download，记下载文件名/类型与同窗云端写；
// 不保存二进制到证据目录（download 落 .temp，证据只记文件名/大小/计数）。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, launch, skipGuide, dismissCloudRecover, cloudFetch, SITE, REF, planState,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/11';
fs.mkdirSync(OUT, { recursive: true });
const TEMP = path.join(ROOT, '.temp');
fs.mkdirSync(TEMP, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const A = { activityId: '3eb2bbdb-8e8f-4fb5-b0ee-060836ffaf94', local: 'house-8z42f0xm', revision: 14 };

const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: '户外方案态：核对 #tool-export 选项弹窗是否渲染；分享面板导出条目；效果图 download 帧 + 同窗云端写旁证。不存二进制。',
  steps: [],
};

async function readActivePlan() {
  const slots = await planState(page);
  let active = null;
  for (const [k, v] of Object.entries(slots)) {
    if (!k.startsWith('scendance-outdoor-plan-v1:')) continue;
    if (v.error) continue;
    if ((v.counts?.boundary ?? 0) >= 3) active = { slot: k, ...v };
  }
  return active;
}

const summarize = (plan) => plan ? {
  slot: plan.slot, projectId: plan.projectId, name: plan.name,
  counts: plan.counts, planLen: plan.planLen,
} : null;

const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);

async function clearOutdoorSlots() {
  await page.evaluate(() => {
    for (const k of [...Object.keys(localStorage)]) {
      if (k.startsWith('scendance-outdoor-plan-v1') || k === 'scendance-outdoor-last-v1') localStorage.removeItem(k);
    }
  });
}

async function pickRecover(rev) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')]
    .map((r, i) => ({ i, text: (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) })));
  const idx = rows.findIndex((r) => r.text.includes(`版本 ${rev} `) || r.text.includes(`版本 ${rev}`));
  const picked = idx >= 0 ? await page.evaluate((i) => {
    const row = document.querySelectorAll('[data-testid=outdoor-cloud-recover-row]')[i];
    const btn = row?.querySelector('[data-testid=outdoor-cloud-recover-open]') ?? row?.querySelector('button');
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return { testid: btn.getAttribute('data-testid'), disabled: btn.disabled };
  }, idx).catch((e) => ({ error: String(e).slice(0, 200) })) : null;
  await page.waitForTimeout(12000);
  return { rows: rows.slice(0, 12), idx, rowText: idx >= 0 ? rows[idx]?.text : null, picked };
}

// ---------- adopt A ----------
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page);
await page.waitForTimeout(1500);

let active = await readActivePlan();
if (!active) {
  const mAdopt = netlog.length;
  await clearOutdoorSlots();
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  await skipGuide(page).catch(() => {});
  await page.waitForTimeout(2000);
  out.recover = await pickRecover(A.revision);
  active = await readActivePlan();
  out.adopt = {
    target: A,
    after: summarize(active),
    writes: netlog.slice(mAdopt).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
      .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`),
  };
}

if (!active) {
  out.steps.push({ step: 1, name: 'guard: adopt 后仍无边界槽', plan: null });
  out.consoleErrors = consoleErrors.slice(0, 20);
  fs.writeFileSync(`${OUT}/2026-11-20-case11-export-png.json`, JSON.stringify(out, null, 2));
  console.log('GUARD_FAIL: no active boundary slot after adopt');
  await browser.close();
  process.exit(2);
}

out.steps.push({ step: 1, name: 'baseline', plan: summarize(active) });
const list = await cloudFetch(session, '/outdoor-plans').catch((e) => ({ status: 'ERR', body: String(e).slice(0, 200) }));
out.cloudList = { status: list.status, listLen: Array.isArray(list.body) ? list.body.length : null };

// ---------- 右轨选项弹窗在户外态是否渲染 ----------
const exportState = await page.evaluate(() => {
  const btn = document.getElementById('tool-export');
  const panel = document.getElementById('tool-export-panel');
  const share = document.getElementById('tool-share');
  return {
    exportButtonExists: !!btn,
    exportButtonDisabled: btn ? btn.disabled : null,
    exportPanelExists: !!panel,
    shareButtonExists: !!share,
  };
});
out.steps.push({ step: 2, name: 'rail-export-state', state: exportState });
await page.screenshot({ path: `${OUT}/2026-11-20-case11-rail-state.png` }).catch(() => {});

// ---------- 分享面板 → 导出 tab ----------
const downloads = [];
page.on('download', async (dl) => {
  const suggested = dl.suggestedFilename();
  let size = null;
  try {
    const savePath = path.join(TEMP, `case11-${suggested}`);
    await dl.saveAs(savePath);
    size = fs.existsSync(savePath) ? fs.statSync(savePath).size : null;
  } catch (e) { size = `save-error:${String(e).slice(0, 80)}`; }
  downloads.push({ suggestedFilename: suggested, sizeBytes: size, kind: dl.url().startsWith('data:') ? dl.url().slice(0, 32) : 'remote' });
});

const mShare = netlog.length;
const shareBtn = page.locator('#tool-share').first();
if (await shareBtn.count()) {
  await shareBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1200);
}
const tabExport = page.locator('#share-tab-export').first();
if (await tabExport.count()) {
  await tabExport.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1000);
}
const exportEntries = await page.evaluate(() => [...document.querySelectorAll('.sc-share-export')]
  .map((b) => ({ label: (b.innerText || '').trim(), disabled: b.disabled === true })));
out.steps.push({ step: 3, name: 'share-export-entries', entries: exportEntries, panelOpen: await page.locator('#tool-share-menu').count() });
await page.screenshot({ path: `${OUT}/2026-11-20-case11-share-export.png` }).catch(() => {});

// ---------- 点「效果图」 ----------
const mExport = netlog.length;
const renderBtn = page.locator('.sc-share-export', { hasText: '效果图' }).first();
let renderMethod = 'missing';
if (await renderBtn.count()) {
  renderMethod = 'button-.sc-share-export[效果图]';
  await renderBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(4000);
}
out.steps.push({
  step: 4, name: 'render-effect-image', method: renderMethod,
  downloads, writes: writes(mExport), plan: summarize(await readActivePlan()),
});
await page.screenshot({ path: `${OUT}/2026-11-20-case11-after-render.png` }).catch(() => {});

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case11-export-png.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ steps: out.steps, cloudList: out.cloudList, downloads }, null, 1));
await browser.close();
