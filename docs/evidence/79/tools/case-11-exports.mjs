// #11 用例：导出四种格式 + 图面墙线 + 旧云 Agent Run
// 逐个点导出入口，捕获下载文件名/字节数/魔数，逐项记证据。
import fs from 'node:fs';
import path from 'node:path';
import { launch, skipGuide, chat, clickText, planState, SITE } from './harness.mjs';

const sessionFile = process.argv[2] || '.temp/real-session.json';
const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
const OUT = 'docs/evidence/79/11';
const FILES = path.join(OUT, '2026-11-19-files');
fs.mkdirSync(FILES, { recursive: true });

const { browser, context, page, netlog, consoleErrors } = await launch({ session });
const downloads = [];
page.on('download', async (d) => {
  const name = d.suggestedFilename();
  const target = path.join(FILES, name);
  try {
    await d.saveAs(target);
    const buf = fs.readFileSync(target);
    downloads.push({ name, bytes: buf.length, head: buf.subarray(0, 12).toString('latin1').replace(/[^\x20-\x7e]/g, '.') });
    console.log(`⬇ 下载 ${name} ${buf.length}B`);
  } catch (e) { downloads.push({ name, error: String(e).slice(0, 120) }); }
});

const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE, exports: [] };

// 打开户外规划并建场，让画布有内容
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);
await page.getByRole('button', { name: '搜索地点', exact: true }).first().click().catch(() => {});
await page.waitForTimeout(800);
const input = page.locator('[data-testid=outdoor-place-search-input]').first();
await input.click();
await input.fill('杭州 IN77');
await page.waitForTimeout(4500);
await page.locator('[data-testid=outdoor-place-search-option-0]').first().click().catch(() => {});
await page.waitForTimeout(5000);
await page.locator('.ap-option-row').first().click().catch(() => {});
await page.waitForTimeout(2500);
await clickText(page, /就定这个场地/);
await page.waitForTimeout(10000);
await clickText(page, /确认并应用这一版/);
await page.waitForTimeout(12000);
out.plan = await planState(page);

// ── 户外分享面板：分享 | 发布 | 导出 三个页签，导出项在「导出」页签下
async function openShare(tab = '导出') {
  const btn = page.locator('[data-testid=outdoor-publish]').first();
  if (await btn.count()) await btn.click().catch(() => {});
  else await page.getByRole('button', { name: '分享' }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const tabBtn = page.getByText(tab, { exact: true }).first();
  if (await tabBtn.count()) await tabBtn.click().catch(() => {});
  await page.waitForTimeout(1200);
}
out.shareOpened = await (async () => { await openShare(); return true; })();
await page.screenshot({ path: `${OUT}/2026-11-19-share-menu.png` });
out.shareItems = await page.evaluate(() => [...document.querySelectorAll('button,[role=menuitem],li,div[role=tab]')]
  .map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)).filter((t) => t && /效果图|物料|场地|文件|PDF|打印|交付|分享|发布|导出/.test(t)));

for (const label of [/效果图/, /物料清单/, /场地范围文件/]) {
  const before = downloads.length;
  await openShare();
  const hit = await clickText(page, label);
  await page.waitForTimeout(9000);
  const got = downloads.slice(before);
  out.exports.push({ entry: String(label), clicked: hit, downloads: got });
  console.log(`导出 ${String(label)} → ${hit} ${JSON.stringify(got)}`);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);
}

// ── 执行资料（室内交付面板）：JSON / GLB / DXF / HTML / 打印
await clickText(page, /执行资料/);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/2026-11-19-delivery-panel.png` });
out.deliveryButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
  .map((e) => ({ t: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), v: e.offsetParent !== null }))
  .filter((b) => b.t && /导出|打印|PDF/.test(b.t)));

for (const label of [/导出场景 JSON/, /导出场景 GLB/, /导出平面 DXF/, /导出活动执行资料草案 HTML/]) {
  const before = downloads.length;
  const hit = await clickText(page, label);
  await page.waitForTimeout(12000);
  const got = downloads.slice(before);
  out.exports.push({ entry: String(label), clicked: hit, downloads: got });
  console.log(`导出 ${String(label)} → ${hit} ${JSON.stringify(got)}`);
}

// ── PDF 打印稿：打开打印窗口页，读取其内容（另存 PDF 需人工一步）
try {
  const printBtn = page.getByRole('button', { name: /按比例打印/ }).first();
  if (await printBtn.count()) {
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
      printBtn.click().catch(() => {}),
    ]);
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.waitForTimeout(4000);
      out.printWindow = {
        url: popup.url(),
        title: await popup.title(),
        svgCount: await popup.evaluate(() => document.querySelectorAll('svg').length),
        textHead: await popup.evaluate(() => document.body.innerText.slice(0, 400)),
      };
      await popup.screenshot({ path: `${OUT}/2026-11-19-print-window.png` });
      out.exports.push({ entry: '/按比例打印（另存 PDF）', clicked: '打印稿窗口已打开', downloads: [], printWindow: out.printWindow });
      await popup.close().catch(() => {});
    } else out.exports.push({ entry: '/按比例打印（另存 PDF）', clicked: '未捕获打印窗口' });
  } else out.exports.push({ entry: '/按比例打印（另存 PDF）', clicked: null });
} catch (e) { out.exports.push({ entry: 'print', error: String(e).slice(0, 120) }); }

out.downloads = downloads;
out.consoleErrors = consoleErrors.slice(0, 15);
fs.writeFileSync(`${OUT}/2026-11-19-exports.json`, JSON.stringify(out, null, 2));
console.log('\n=== 汇总 ===');
console.log(JSON.stringify(out.exports, null, 1));
await browser.close();
