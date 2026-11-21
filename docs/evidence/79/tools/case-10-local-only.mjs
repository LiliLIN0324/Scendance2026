// #10 阴性对照：纯本地分支（匿名 + 地点待定的设计句，本地退回选址）。
// 判据：本地气泡回话（「这句我先留着」），零 /assistant/chat 请求，零 outdoor-plans 写，plan 仍空槽。
// 口径前置：place-first 本地守卫只在 viewerKnownAnonymous 或断网时触发；登录态该守卫不拦，结果不外推到登录态。
import fs from 'node:fs';
import { launch, dismissCloudRecover, skipGuide, chat, pageText, planState, SITE, writeEvidence } from './harness-proxy.mjs';

const OUT = 'docs/evidence/79/10';
fs.mkdirSync(OUT, { recursive: true });

// 不注入任何会话 cookie = 匿名访客
const { browser, page, netlog, consoleErrors } = await launch({ session: null, proxyBypass: '*.pages.dev' });
const out = { case: 10, scenario: '匿名访客 · 地点待定 · 纯设计句本地退回选址', ranAt: new Date().toISOString() };

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);
await dismissCloudRecover(page);

out.identity = await page.evaluate(() => ({
  cookieKeys: document.cookie.split(';').map((s) => s.trim().split('=')[0]).filter(Boolean),
}));
out.baselinePlan = await planState(page);

// 发句前记账切片位置
const beforeIdx = netlog.length;
const DESIGN_SENTENCE = '把舞台摆到东侧，再加两排座椅';
out.sentence = DESIGN_SENTENCE;

await chat(page, DESIGN_SENTENCE, { wait: 5000 });

// 本地气泡关键词
const bodyText = await pageText(page, 4000);
out.bounceHits = {
  placeFirst: bodyText.includes('还没定在哪'),
  keptDraft: bodyText.includes('这句我先留着'),
  nextStep: bodyText.includes('在地图上选地点'),
};
out.bodyTail = bodyText.slice(-500);

// 发句后新增的云端 API 请求切片
const slice = netlog.slice(beforeIdx);
out.afterSlice = slice.map((n) => ({
  t: n.t, method: n.method, status: n.status,
  url: n.url.replace(/https:\/\/[^/]+/, '').slice(0, 120),
}));
out.chatRequests = slice.filter((n) => /assistant\/chat|conversation-api/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '')}`);
out.planWrites = slice.filter((n) => n.t === 'req' && /outdoor-plans|outdoor-history/.test(n.url) && n.method !== 'GET').map((n) => `${n.method} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 100)}`);
out.planState = await planState(page);
out.consoleErrors = consoleErrors.slice(0, 12);

await page.screenshot({ path: `${OUT}/2026-11-20-case10-local-only.png` });
out.finding = `匿名设计句本地退回选址：bounce=${JSON.stringify(out.bounceHits)}；新增 chat 请求 ${out.chatRequests.length} 条；方案写 ${out.planWrites.length} 条。`;

writeEvidence(10, '2026-11-20-case10-local-only.json', out);
console.log(JSON.stringify(out, null, 1).slice(0, 3500));
await browser.close();
