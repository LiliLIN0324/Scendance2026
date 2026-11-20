import fs from 'node:fs';
import { launch, skipGuide, dismissCloudRecover, SITE } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { browser, page } = await launch({ session });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);
await dismissCloudRecover(page);
const card = page.getByRole('button', { name: /^搜索地点$/ }).first();
console.log('card', await card.count());
if (await card.count()) await card.click().catch(() => {});
await page.waitForTimeout(800);
const field = page.locator('.sc-plan-place-search-field').first();
await field.click().catch(() => {});
await page.waitForTimeout(500);
const input = page.locator('[data-testid=plan-place-search-input], [data-testid=outdoor-place-search-input]').first();
console.log('input', await input.count(), await input.isVisible().catch(() => false));
await input.fill('杭州湖滨银泰in77').catch((e) => console.log('fill err', e.message));
for (const ms of [3000, 5000, 8000]) {
  await page.waitForTimeout(ms);
  const s = await page.evaluate(() => ({
    value: document.querySelector('[data-testid=plan-place-search-input], [data-testid=outdoor-place-search-input]')?.value,
    opts: [...document.querySelectorAll('.sc-plan-place-search-option')].map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 90)),
    dialog: !!document.querySelector('[data-testid=outdoor-cloud-recover]'),
    body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 600),
  }));
  console.log(ms, JSON.stringify(s));
}
await page.screenshot({ path: '.temp/04-search-probe2.png' });
await browser.close();
