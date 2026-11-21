// #11 UI 路径：账户菜单 → 所有方案 → 项目墙列卡片 → 匹配旧 Agent Run 名 → 双击进入读 URL/本机槽；
// 再开「导出效果图」选项弹窗记录选项（不下载、不存 PDF）。未命中/不可进入如实记录。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SITE, REF, BASE, launch, skipGuide, dismissCloudRecover, planState, cloudFetch } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.temp/real-session-v6.json'), 'utf8'));
const OUT = 'docs/evidence/79/11';
fs.mkdirSync(OUT, { recursive: true });
const BYPASS = 'scendance-scene-planner-ewz.pages.dev,*.pages.dev,localhost,127.0.0.1';
const OLD_RUN_KEYS = ['自动验证', '确认循环', '周末共创', '工作坊', 'Flow C', '直径测试'];

const out = { ranAt: new Date().toISOString(), identity: { email: session.user.email, id: session.user.id }, site: SITE, ref: REF, steps: [] };
const { browser, page, netlog, consoleErrors } = await launch({ session, headless: true, proxyBypass: BYPASS });

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await dismissCloudRecover(page).catch(() => {});
await page.waitForTimeout(2000);

// 1) 打开账户菜单 → 所有方案
const trigger = page.locator('[aria-label="账户菜单"],.sc-cloud-trigger').first();
out.menuTrigger = await trigger.count() > 0;
if (out.menuTrigger) {
  await trigger.click().catch(() => {});
  await page.waitForTimeout(1000);
  const all = page.getByRole('menuitem', { name: '所有方案' }).first();
  out.allProjectsMenuItem = await all.count() > 0;
  if (out.allProjectsMenuItem) {
    await all.click().catch(() => {});
    await page.waitForTimeout(6000);
  }
}

// 2) 项目墙卡片
const cards = await page.evaluate(() => [...document.querySelectorAll('.sc-file-card')].map((c) => {
  const btn = c.querySelector('.sc-file-hit');
  return {
    name: (c.querySelector('strong')?.innerText || '').trim(),
    state: (c.querySelector('.sc-file-state')?.innerText || '').trim(),
    small: (c.querySelector('small')?.innerText || '').trim(),
    aria: btn?.getAttribute('aria-label') || null,
    disabled: btn?.disabled ?? null,
  };
}));
out.projectWall = { dialogOpen: await page.locator('[aria-label="账户中心"],.sc-account-dialog').count() > 0, cards };
out.oldRunMatches = cards.filter((c) => OLD_RUN_KEYS.some((k) => c.name.includes(k) || c.small.includes(k)));
await page.screenshot({ path: `${OUT}/2026-11-20-v11-project-wall.png` }).catch(() => {});

// 3) 双击命中的旧 run 卡片（只取第一张）
if (out.oldRunMatches.length) {
  const target = out.oldRunMatches[0];
  const btn = page.locator('.sc-file-card').filter({ hasText: target.name }).locator('.sc-file-hit').first();
  const m0 = netlog.length;
  await btn.dblclick().catch(() => {});
  await page.waitForTimeout(8000);
  out.afterOpen = {
    url: page.url(),
    plan: await planState(page).catch(() => null),
    writes: netlog.slice(m0).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
      .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 80)}`),
  };
  await page.screenshot({ path: `${OUT}/2026-11-20-v11-old-run-open.png` }).catch(() => {});
}

// 4) 导出效果图选项弹窗（不下载）
await dismissCloudRecover(page).catch(() => {});
const exportBtn = page.getByRole('button', { name: '导出效果图' }).first();
out.exportButton = await exportBtn.count() > 0;
if (out.exportButton) {
  await exportBtn.click().catch(() => {});
  await page.waitForTimeout(1500);
  const dialog = page.getByRole('dialog', { name: '导出效果图选项' }).first();
  out.exportDialog = await dialog.count() > 0;
  if (out.exportDialog) {
    out.exportOptions = await dialog.evaluate((d) => ({
      text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
      buttons: [...d.querySelectorAll('button')].map((b) => ({ t: (b.innerText || '').trim().slice(0, 40), d: b.disabled === true })),
    }));
  }
  await page.screenshot({ path: `${OUT}/2026-11-20-v11-export-dialog.png` }).catch(() => {});
}

out.consoleErrors = consoleErrors.slice(0, 20);
fs.writeFileSync(`${OUT}/2026-11-20-case11-ui-probe.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  menuTrigger: out.menuTrigger, allProjectsMenuItem: out.allProjectsMenuItem,
  cardCount: cards.length, cards: cards.map((c) => c.name),
  oldRunMatches: out.oldRunMatches.map((c) => c.name),
  exportButton: out.exportButton, exportDialog: out.exportDialog,
  afterOpenUrl: out.afterOpen?.url,
}, null, 1));
await browser.close();
