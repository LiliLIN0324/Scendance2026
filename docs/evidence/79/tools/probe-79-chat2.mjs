import fs from 'node:fs';
import { launch, skipGuide, chat, SITE, planState } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session-v3.json', 'utf8'));
const { browser, page, netlog } = await launch({ session, headless: true });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);
const from = netlog.length;
await chat(page, '在杭州湖滨银泰in77做200人市集设计，签到靠近入口，留出通道', { wait: 50000 });
await chat(page, '活动边界用银泰in77 A区东坡路一侧的室外广场，约40米×30米；入口用东坡路7号A区主入口；分区就按摊位区、舞台/表演区、签到服务区、观众区，不需要餐饮。请直接出可应用的场地预览。', { wait: 60000 });
await page.screenshot({ path: '.temp/79-ui-chat2.png', fullPage: false });
const data = await page.evaluate(() => ({
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 5000),
  buttons: [...document.querySelectorAll('button')].map((el) => ({
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    disabled: el.disabled,
    testid: el.getAttribute('data-testid'),
  })).filter((x) => x.text).slice(0, 100),
}));
const writes = netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
const payload = { ...data, plan: await planState(page), writes };
fs.writeFileSync('.temp/79-chat2.json', JSON.stringify(payload, null, 2));
const interesting = data.buttons.filter(b => /候选|就定|确认|场地|预览|批准|搜索|手画/.test(b.text));
console.log(JSON.stringify({ text: data.text.slice(-1800), buttons: interesting, writes }, null, 1));
await browser.close();
