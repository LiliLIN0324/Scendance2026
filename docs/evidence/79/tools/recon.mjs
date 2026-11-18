// 走查台架自检：正式站 + 访客登录态，确认 UI 结构与云端连通
import fs from 'node:fs';
import { launch, newGuestSession, dumpUi, pageText, cloudFetch, SITE } from './harness.mjs';

const session = await newGuestSession();
fs.writeFileSync('.temp/guest-session.json', JSON.stringify(session, null, 2));
console.log('访客会话 user=', session.user.id, 'anon=', session.user.is_anonymous);

const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/recon.har' });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

console.log('\n=== URL ===', page.url());
console.log('\n=== 页面文案 ===\n' + (await pageText(page, 2500)));
console.log('\n=== 可交互元素 ===');
const ui = await dumpUi(page);
console.log(JSON.stringify(ui, null, 1));
await page.screenshot({ path: '.temp/recon-home.png', fullPage: false });

console.log('\n=== localStorage keys ===');
console.log(JSON.stringify(await page.evaluate(() => Object.keys(localStorage))));

console.log('\n=== 云端请求 ===');
for (const e of netlog.filter((n) => n.t === 'res')) console.log(`${e.method} ${e.status} ${e.url.slice(0, 150)}`);
console.log('\n=== console errors ===', consoleErrors.slice(0, 8));

console.log('\n=== 云端直读 ===');
for (const p of ['/outdoor-plans', '/studios', '/projects']) {
  const r = await cloudFetch(session, p);
  console.log(`GET ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
}

await browser.close();
