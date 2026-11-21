// #11 纯室内态既有导出控件对照：清掉户外方案槽后 reload，进入既有室内编辑器（outdoor=null），
// 核对室内右轨导出面板 #tool-export（视角/画质/机位册）与分享面板导出条目；
// 室内态不应出现户外专属的 物料清单 CSV / 场地范围 GeoJSON / 演示稿 PDF 三枚入口。
// 只对照既有功能、不发展室内、不下载二进制、不点导出 CTA。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, SITE, REF, launch, skipGuide, dismissCloudRecover, planState,
} from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/11';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';

const out = {
  ranAt: new Date().toISOString(),
  actor: session.user.id,
  identity: { email: session.user.email, id: session.user.id },
  site: SITE, ref: REF,
  note: '#11 纯室内态既有导出控件对照：清户外槽 reload 后读右轨 #tool-export 面板条目与分享面板导出条目；核对户外专属三枚入口（物料清单/场地范围文件/演示稿）在室内态不渲染。不下载。',
  steps: [],
};

const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});

// 清户外槽，强制回到纯室内态
await page.evaluate(() => {
  for (const k of [...Object.keys(localStorage)]) {
    if (k.startsWith('scendance-outdoor-plan-v1') || k === 'scendance-outdoor-last-v1') localStorage.removeItem(k);
  }
});
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page).catch(() => {});
await page.waitForTimeout(2500);

// 1. 右轨控件快照
const rail = await page.evaluate(() => {
  const outdoorSlots = Object.keys(localStorage).filter((k) => k.startsWith('scendance-outdoor-plan-v1:')).length;
  const probe = (id) => {
    const el = document.getElementById(id);
    return el ? { exists: true, disabled: el.disabled === true, visible: (el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1), label: el.getAttribute('aria-label') || el.getAttribute('data-tip') || null } : { exists: false };
  };
  return {
    outdoorSlots,
    lastPointer: localStorage.getItem('scendance-outdoor-last-v1'),
    tools: {
      export: probe('tool-export'), undo: probe('tool-undo'), redo: probe('tool-redo'),
      share: probe('tool-share'), walk: probe('tool-walk'), zoomOut: probe('tool-zoom-out'), zoomIn: probe('tool-zoom-in'),
    },
  };
});
out.rail = rail;
out.steps.push({ step: 1, name: 'rail-state-after-clear', rail });
await page.screenshot({ path: `${OUT}/2026-11-21-case11-indoor-rail.png` }).catch(() => {});

// 2. 室内导出面板 #tool-export-panel
const exportBtn = page.locator('#tool-export').first();
if (await exportBtn.count()) {
  await exportBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1000);
  out.exportPanel = await page.evaluate(() => {
    const panel = document.getElementById('tool-export-panel');
    if (!panel) return { panelExists: false };
    const buttons = [...panel.querySelectorAll('button')].map((b) => ({
      label: (b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText || '').trim().slice(0, 60),
      disabled: b.disabled === true,
      pressed: b.getAttribute('aria-pressed'),
    }));
    const cta = panel.querySelector('.sc-export-cta');
    return { panelExists: true, buttons, cta: cta ? cta.innerText.trim() : null };
  });
  await page.screenshot({ path: `${OUT}/2026-11-21-case11-indoor-export-panel.png` }).catch(() => {});
} else {
  out.exportPanel = { panelExists: false, reason: '#tool-export 按钮不存在' };
}
out.steps.push({ step: 2, name: 'export-panel', exportPanel: out.exportPanel });

// 3. 分享面板导出条目
const shareBtn = page.locator('#tool-share').first();
if (await shareBtn.count()) {
  await shareBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1200);
  const tabExport = page.locator('#share-tab-export').first();
  if (await tabExport.count()) await tabExport.click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  out.sharePanel = await page.evaluate(() => {
    const menu = document.getElementById('tool-share-menu');
    const tabs = [...document.querySelectorAll('[id^=share-tab-]')].map((t) => ({ id: t.id, label: (t.innerText || t.getAttribute('aria-label') || '').trim() }));
    const entries = [...document.querySelectorAll('.sc-share-export')].map((b) => ({
      testid: b.closest('li')?.getAttribute('data-testid') || null,
      label: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 60),
      disabled: b.disabled === true,
    }));
    return { menuExists: !!menu, tabs, entries };
  });
  await page.screenshot({ path: `${OUT}/2026-11-21-case11-indoor-share.png` }).catch(() => {});
} else {
  out.sharePanel = { menuExists: false, reason: '#tool-share 不存在' };
}
out.steps.push({ step: 3, name: 'share-export-entries', sharePanel: out.sharePanel });

// 4. 对照判定
const entries = out.sharePanel?.entries ?? [];
const entryIds = entries.map((e) => e.testid);
out.comparison = {
  indoorEditing: rail.tools.undo.exists && !rail.outdoorSlots,
  outdoorCsvPresent: entryIds.includes('export-row-materials'),
  outdoorGeoJsonPresent: entryIds.includes('export-row-site'),
  outdoorDeckPdfPresent: entryIds.includes('export-row-deck'),
  renderEntryPresent: entryIds.includes('export-row-render'),
  entryIds,
};
out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-21-case11-indoor-controls.json`, JSON.stringify(out, null, 2));
console.log('[comparison]', JSON.stringify(out.comparison, null, 1));
console.log('[rail]', JSON.stringify(rail.tools, null, 1));
await browser.close();
