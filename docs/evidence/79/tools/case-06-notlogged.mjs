// #6 用例 · 分支一：未登录（无任何会话）
// 判据：聊天框被登录门顶住 / 提示登录；零模型请求、零云端写。
import fs from 'node:fs';
import { launch, skipGuide, chat, summary, pageText, planState, SITE } from './harness.mjs';

const OUT = 'docs/evidence/79/06';
fs.mkdirSync(OUT, { recursive: true });

// 不注入任何会话 = 未登录
const { browser, page, netlog, consoleErrors } = await launch({ session: null });
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);

const out = { scenario: '未登录（无会话）', at: new Date().toISOString() };
out.cookieKeys = await page.evaluate(() => document.cookie.split(';').map((s) => s.trim().split('=')[0]).filter(Boolean));
out.authRequests = netlog.filter((n) => n.t === 'res' && /auth\/v1/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '')}`);

// 建场后尝试发一条模型路消息（应被登录门拦下）
await page.getByRole('button', { name: '搜索地点', exact: true }).first().click().catch(() => {});
await page.waitForTimeout(700);
const input = page.locator('[data-testid=outdoor-place-search-input]').first();
await input.click();
await input.fill('杭州 IN77');
await page.waitForTimeout(4000);
await page.locator('[data-testid=outdoor-place-search-option-0]').first().click().catch(() => {});
await page.waitForTimeout(5000);
await page.locator('.ap-option-row').first().click().catch(() => {});
await page.waitForTimeout(2000);
const hit = await page.getByRole('button', { name: /就定这个场地/ }).first().click().then(() => 'clicked').catch(() => 'not-found');
out.venueConfirm = hit;
await page.waitForTimeout(9000);

const ta = page.locator('textarea').first();
out.textareaDisabled = await ta.isDisabled().catch(() => null);
out.textareaPlaceholder = await ta.getAttribute('placeholder').catch(() => null);

// 未登录时的登录门：先发一条**非本地白名单**、需要模型理解的句子
await chat(page, '把主通道改到场地北侧的仁和路，别沿湖滨路走', { wait: 20000 }).catch((e) => { out.chatError = String(e).slice(0, 120); });
await page.screenshot({ path: `${OUT}/2026-11-19-not-logged-in.png` });
out.loginGateText = await page.evaluate(() => {
  const el = document.querySelector('[data-testid=outdoor-task-card]');
  return (el?.innerText || document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
});
out.loginGateMentions = /登录/.test(out.loginGateText) ? '提到「登录」' : '未提到「登录」';
out.modelCallsAfterGate = netlog.filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).length;

await chat(page, '再加两个摊位区', { wait: 12000 }).catch((e) => { out.chatError = String(e).slice(0, 120); });

out.taskCardText = await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 600));
out.bodySnippet = (await pageText(page, 1200));
out.summary = await summary(page);
out.planState = await planState(page);
out.chatRequests = netlog.filter((n) => n.t === 'res' && /assistant\/chat|conversation-api/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '')}`);
out.allApiRequests = netlog.filter((n) => n.t === 'res' && !/oneplan|people\/|showcase|\.(png|svg|woff2|css|js)/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
out.consoleErrors = consoleErrors.slice(0, 10);

fs.writeFileSync(`${OUT}/2026-11-19-not-logged-in.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
await browser.close();
