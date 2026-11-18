// #5 用例：离线 / 地图部分 / 无路网
// 口径：CDP 级浏览器离线（context.setOffline → Network.emulateNetworkConditions），
// 覆盖 fetch/XHR/图片/瓦片，比页面级注入更接近系统级断网；同时录 HAR 作为云端请求底账。
import fs from 'node:fs';
import { launch, skipGuide, chat, summary, planState, SITE, writeEvidence } from './harness.mjs';

const session = JSON.parse(fs.readFileSync('.temp/real-session.json', 'utf8'));
const OUT = 'docs/evidence/79/05';
fs.mkdirSync(OUT, { recursive: true });

const { browser, context, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case05.har' });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await skipGuide(page);

// 建场（在线）：选地点 + 确认
await page.getByRole('button', { name: '搜索地点', exact: true }).first().click();
await page.waitForTimeout(700);
const input = page.locator('[data-testid=outdoor-place-search-input]').first();
await input.click();
await input.fill('杭州 IN77');
await page.waitForTimeout(4000);
await page.locator('[data-testid=outdoor-place-search-option-0]').first().click();
await page.waitForTimeout(5000);
await page.locator('.ap-option-row').first().click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /就定这个场地/ }).first().click().catch(() => {});
await page.waitForTimeout(10000);
await page.getByRole('button', { name: /确认并应用这一版/ }).first().click().catch(() => {});
await page.waitForTimeout(10000);

const onlineState = { plan: await planState(page), reqs: netlog.filter((n) => n.t === 'res').length };
await page.screenshot({ path: `${OUT}/2026-11-19-online-before-offline.png` });

// ── 切离线（CDP 级，浏览器所有网络请求都断）
await context.setOffline(true);
const offMark = netlog.length;
console.log('已切离线');

const off = {};
// 1) 地图检索：应失败或降级
await page.getByRole('button', { name: '搜索地点', exact: true }).first().click().catch(() => {});
await page.waitForTimeout(800);
const offInput = page.locator('[data-testid=outdoor-place-search-input]').first();
await offInput.click();
await offInput.fill('北京 朝阳公园');
await page.waitForTimeout(6000);
off.searchText = (await page.evaluate(() => (document.querySelector('[data-testid=outdoor-place-search]')?.innerText || '').replace(/\s+/g, ' '))).slice(0, 300);
await page.screenshot({ path: `${OUT}/2026-11-19-offline-place-search.png` });

// 2) Agent 回合：应如实报失败
await chat(page, '再加两个摊位区', { wait: 25000 });
off.agentText = (await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' '))).slice(0, 400);
await page.screenshot({ path: `${OUT}/2026-11-19-offline-agent-turn.png` });

// 3) 断网点「确认并应用这一版」（若有提案按钮）
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
off.applyButtonSeen = await applyBtn.count();
if (off.applyButtonSeen) {
  await applyBtn.click().catch(() => {});
  await page.waitForTimeout(20000);
}
off.afterApplyText = (await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' '))).slice(0, 400);
off.planAfter = await planState(page);
off.offlineRequests = netlog.slice(offMark).filter((n) => n.t === 'res').map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
off.offlineFailedRequests = netlog.slice(offMark).filter((n) => n.t === 'req').map((n) => `${n.method} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
await page.screenshot({ path: `${OUT}/2026-11-19-offline-apply.png` });

// 4) 恢复网络：检查是否静默重放
const resMark = netlog.length;
await context.setOffline(false);
await page.waitForTimeout(15000);
off.afterRecoverRequests = netlog.slice(resMark).filter((n) => n.t === 'res').map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
off.afterRecoverText = (await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' '))).slice(0, 300);

off.consoleErrors = consoleErrors.slice(0, 20);
off.onlineState = onlineState;
fs.writeFileSync(`${OUT}/2026-11-19-offline-readings.json`, JSON.stringify(off, null, 2));
console.log(JSON.stringify(off, null, 1).slice(0, 3000));

await context.close(); // 落盘 HAR
await browser.close();
