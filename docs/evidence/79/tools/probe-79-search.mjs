import fs from 'node:fs';
import { launch, skipGuide, SITE } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const { browser, page } = await launch({ session, headless: true });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);

const dump = async (label) => {
  const data = await page.evaluate(() => ({
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 3000),
    buttons: [...document.querySelectorAll('button')].map((el) => ({
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      disabled: el.disabled,
      testid: el.getAttribute('data-testid'),
    })).filter((x) => x.text).slice(0, 80),
    inputs: [...document.querySelectorAll('input,textarea')].map((el) => ({
      aria: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      testid: el.getAttribute('data-testid'),
      type: el.getAttribute('type'),
    })).slice(0, 40),
  }));
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(data, null, 1));
};

const search = page.getByRole('button', { name: '搜索地点', exact: true }).first();
console.log('search count', await search.count());
if (await search.count()) {
  await search.click().catch((e) => console.log('click search failed', String(e).slice(0, 120)));
  await page.waitForTimeout(4000);
}
await page.screenshot({ path: '.temp/79-ui-search.png', fullPage: false });
await dump('after search');
await browser.close();
