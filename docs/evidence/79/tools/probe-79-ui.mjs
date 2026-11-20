import fs from 'node:fs';
import { launch, skipGuide, SITE } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const { browser, page } = await launch({ session, headless: true });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(3000);
await page.screenshot({ path: '.temp/79-ui-initial.png', fullPage: false });

const dump = async (label) => {
  const data = await page.evaluate(() => ({
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 2500),
    buttons: [...document.querySelectorAll('button')].map((el) => ({
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      disabled: el.disabled,
      testid: el.getAttribute('data-testid'),
    })).filter((x) => x.text).slice(0, 60),
    inputs: [...document.querySelectorAll('input,textarea')].map((el) => ({
      aria: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      testid: el.getAttribute('data-testid'),
      value: el.value?.slice(0, 80),
    })).slice(0, 30),
    testids: [...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid')).slice(0, 80),
  }));
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(data, null, 1));
};
await dump('initial');
await browser.close();
