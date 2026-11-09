// 复现我们的等距渲染截图（只读：不改 hangzhou-map-lab 任何文件，截图写到 OUT）
// 用法：node capture250.cjs <outDir> [viewSize] [port]
// 前置：hangzhou-map-lab 以静态服务跑在 127.0.0.1:3051
const { chromium } = require('C:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/node_modules/playwright');
const path = require('path');

const out = process.argv[2] || './';
const view = Number(process.argv[3] || 250);
const port = Number(process.argv[4] || 3051);

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 710 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/iso.html?capture=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__iso && window.__iso.ready, null, { timeout: 180000 });
  await page.evaluate(v => { __iso.setFocus(120.1596, 30.2518); __iso.setView(v); }, view);
  // 必须在 2-3 s 内截图：停留 6 s 以上建筑会整体消失
  await page.waitForTimeout(2500);
  const file = path.join(out, `ours-east-${view}.png`);
  await page.screenshot({ path: file, timeout: 180000 });
  console.log(file);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
