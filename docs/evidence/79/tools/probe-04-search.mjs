import fs from 'node:fs';
import { launch, skipGuide, SITE } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { browser, page, consoleErrors } = await launch({ session });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);
const field = page.locator('.sc-plan-place-search-field').first();
console.log('field', await field.count());
await field.click().catch(() => {});
await page.waitForTimeout(600);
const input = page.locator('[data-testid=plan-place-search-input], [data-testid=outdoor-place-search-input]').first();
console.log('input', await input.count(), await input.isVisible().catch(() => false));
await input.fill('杭州湖滨银泰in77').catch((e) => console.log('fill err', e.message));
await page.waitForTimeout(9000);
const state = await page.evaluate(() => ({
  inputValue: document.querySelector('[data-testid=plan-place-search-input], [data-testid=outdoor-place-search-input]')?.value,
  options: [...document.querySelectorAll('.sc-plan-place-search-option')].map((e) => ({ t: e.innerText.replace(/\s+/g, ' ').slice(0, 100), cls: e.className })).slice(0, 10),
  testIds: [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((x) => /place|search|venue/.test(x)).slice(0, 30),
  buttons: [...document.querySelectorAll('button')].map((b) => ({ t: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), d: b.disabled })).filter((b) => b.t).slice(0, 40),
  body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 1200),
}));
console.log(JSON.stringify(state, null, 1));
console.log('consoleErrors', consoleErrors.slice(0, 5));
await page.screenshot({ path: '.temp/04-search-probe.png' });
await browser.close();
