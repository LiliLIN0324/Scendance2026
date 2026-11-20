import fs from 'node:fs';
import { launch, skipGuide, chat, SITE, planState, waitForButton } from './harness-proxy.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session-v3.json', 'utf8'));
const { browser, page, netlog } = await launch({ session, headless: true });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await skipGuide(page).catch(() => {});
await page.waitForTimeout(2000);
const from = netlog.length;
await chat(page, '在杭州湖滨银泰in77做200人市集设计，签到靠近入口，留出通道', { wait: 50000 });
await chat(page, '活动边界用银泰in77 A区东坡路一侧的室外广场，约40米×30米；入口用东坡路7号A区主入口；分区就按摊位区、舞台/表演区、签到服务区、观众区，不需要餐饮。请直接出可应用的场地预览。', { wait: 60000 });

const drawBtn = page.getByRole('button', { name: '在地图上手画活动范围' }).first();
console.log('draw button', await drawBtn.count());
if (await drawBtn.count()) {
  await drawBtn.click({ force: true });
  await page.waitForTimeout(1800);
  for (const [x, y] of [[900, 430], [1120, 430], [1120, 650], [900, 650], [900, 430]]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(2500);
}
const afterDraw = { plan: await planState(page), text: await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(-1200)) };
await page.screenshot({ path: '.temp/79-ui-drawn2.png' });
fs.writeFileSync('.temp/79-after-draw.json', JSON.stringify(afterDraw, null, 2));
console.log('after draw', JSON.stringify(afterDraw.plan, null, 1));

const retry = page.getByRole('button', { name: '重试', exact: true }).first();
console.log('retry button', await retry.count());
if (await retry.count()) {
  await retry.click({ force: true }).catch(() => {});
  await page.waitForTimeout(60000);
}
await page.screenshot({ path: '.temp/79-ui-after-retry.png' });
const data = await page.evaluate(() => ({
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 5000),
  buttons: [...document.querySelectorAll('button')].map((el) => ({ text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120), disabled: el.disabled, testid: el.getAttribute('data-testid') })).filter((x) => x.text).slice(0, 100),
}));
const writes = netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
const payload = { afterDraw, ...data, plan: await planState(page), writes };
fs.writeFileSync('.temp/79-after-retry.json', JSON.stringify(payload, null, 2));
const interesting = data.buttons.filter(b => /候选|就定|确认|场地|预览|批准|搜索|手画|重试/.test(b.text));
console.log(JSON.stringify({ text: data.text.slice(-2200), buttons: interesting, plan: payload.plan, writes }, null, 1));
await browser.close();
