import fs from 'node:fs';
import { launch, skipGuide, SITE } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session-v3.json', 'utf8'));
const { browser, page } = await launch({ session, headless: true });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);
const info = await page.evaluate(() => {
  const dlg = document.querySelector('[data-testid=outdoor-cloud-recover]');
  if (!dlg) return { present: false };
  return {
    present: true,
    html: dlg.outerHTML.slice(0, 6000),
    buttons: [...dlg.querySelectorAll('button')].map((el) => ({ text: (el.innerText || '').trim().slice(0, 80), testid: el.getAttribute('data-testid'), aria: el.getAttribute('aria-label') })),
    text: (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 1000),
  };
});
fs.writeFileSync('.temp/79-dialog.json', JSON.stringify(info, null, 2));
console.log(JSON.stringify({ present: info.present, buttons: info.buttons, text: info.text }, null, 1));
await page.screenshot({ path: '.temp/79-ui-dialog.png' });
await browser.close();
