import fs from 'node:fs';
import { launch, skipGuide, chat, SITE, planState } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const message = process.argv[3] || '在杭州湖滨银泰in77做200人市集设计，签到靠近入口，留出通道';
const { browser, page, netlog } = await launch({ session, headless: true });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);
const from = netlog.length;
await chat(page, message, { wait: 60000 });
await page.screenshot({ path: '.temp/79-ui-chat.png', fullPage: false });
const data = await page.evaluate(() => ({
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 4000),
  buttons: [...document.querySelectorAll('button')].map((el) => ({
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    disabled: el.disabled,
    testid: el.getAttribute('data-testid'),
  })).filter((x) => x.text).slice(0, 100),
}));
const writes = netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
const payload = { ...data, plan: await planState(page), writes };
fs.writeFileSync('.temp/79-chat.json', JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ text: payload.text.slice(0, 1200), buttons: payload.buttons.filter(b => /杭州|候选|就定|确认|场地|登录/.test(b.text)).slice(0, 20), writes }, null, 1));
await browser.close();
