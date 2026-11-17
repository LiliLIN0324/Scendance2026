import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'ms-playwright');
const exe = ['chromium-1254', 'chromium-1252', 'chromium-1234']
  .map(build => join(root, build, 'chrome-win64', 'chrome.exe'))
  .find(existsSync);

const BASE = process.env.SCENDANCE_BASE ?? 'http://localhost:3107';
const OUT = join(process.cwd(), '..', 'deliverables', 'verify');
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 200)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pcReady === true, null, { timeout: 60_000 });
await page.waitForTimeout(4000);
await page.getByRole('button', { name: '物料', exact: true }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, '11-library.png') });

const input = page.getByPlaceholder(/搜索素材/);
console.log('search input count:', await input.count());

async function search(query, shot) {
  const box = page.getByPlaceholder(/搜索素材/).first();
  await box.fill(query);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, shot) });
  // 结果条目：库里每条卡片的名称（去掉按钮/标签噪声后取前若干条）
  const names = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-model-slug], li, article')];
    const texts = nodes
      .map(node => (node.getAttribute('data-model-slug') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(text => text && text.length < 40);
    return [...new Set(texts)].slice(0, 30);
  });
  const count = await page.evaluate(() => document.querySelectorAll('[data-model-slug]').length);
  console.log(`\n[${query}] cards=${count}`);
  console.log(names.slice(0, 12).join(' | '));
}

await search('能坐', '12-search-sit.png');
await search('能聊', '13-search-talk.png');
await search('可操作', '14-search-operate.png');
await search('能坐 木', '15-search-sit-wood.png');

await browser.close();
