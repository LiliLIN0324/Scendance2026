// #1 用例（空白项目 + 真实物料）与 #9 用例（撤销整批 → 再应用一次）
import fs from 'node:fs';
import { launch, skipGuide, chat, setupSite, driveToProposal, planState, clickText, waitForButton, cloudFetch, SITE } from './harness.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const D01 = 'docs/evidence/79/01', D09 = 'docs/evidence/79/09';
for (const d of [D01, D09]) fs.mkdirSync(d, { recursive: true });
const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case-01-09.har' });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE };
const writes = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);

// ── 空白项目：从活动面板新建一个空白活动
await page.locator('.sc-activity-island-toggle').first().click().catch(() => {});
await page.waitForTimeout(1500);
out.activityPanel = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => ({ t: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 26), a: b.getAttribute('aria-label') })).filter((b) => (b.a || '').includes('活动') || /新建|方案/.test(b.t)));
const newAct = page.getByRole('button', { name: /新建活动/ }).first();
out.newActivitySeen = await newAct.count();
if (out.newActivitySeen) await newAct.click().catch(() => {});
await page.waitForTimeout(6000);
await page.screenshot({ path: `${D01}/2026-11-19-blank-project.png` });
out.blankProject = await planState(page);
console.log('空白项目:', JSON.stringify(out.blankProject));

// ── 组合需求（真实用户说法）
const m1 = netlog.length;
await chat(page, '在杭州 IN77 做设计，200 人发布会，户外广场 30×20 米，签到台放西侧入口', { wait: 45000 });
await page.screenshot({ path: `${D01}/2026-11-19-composite-requirement.png` });
out.composite = {
  taskText: await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 700)),
  calls: netlog.slice(m1).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => `${n.method} ${n.status}`),
};

// ── 场地 + 范围
out.setup = await setupSite(page, { shot: `${D01}/2026-11-19-range-confirmed.png` });

// ── 真实物料：我的物料库应非空
await chat(page, '按分区摆物料', { wait: 45000 });
const libBtn = await clickText(page, /从我的物料库查找/);
await page.waitForTimeout(2000);
const searchBtn = await clickText(page, /检索真实库/);
await page.waitForTimeout(12000);
await page.screenshot({ path: `${D01}/2026-11-19-material-library.png` });
out.material = {
  libraryButton: libBtn, searchButton: searchBtn,
  libraryText: await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) => /物料库/.test(e.innerText || '') && (e.innerText || '').length < 1200);
    return (el?.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
  }),
  apiAssets: netlog.slice(m1).filter((n) => n.t === 'res' && /assets/.test(n.url)).map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`),
};
const cloudAssets = await cloudFetch(session, '/assets');
out.material.cloudAssets = { status: cloudAssets.status, count: Array.isArray(cloudAssets.body) ? cloudAssets.body.length : cloudAssets.body };

// ── 推进到提案并应用
const m2 = netlog.length;
const drive = await driveToProposal(page, { shot: `${D01}/2026-11-19-proposal.png` });
const applyBtn = await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 8000 });
const beforeApply = await planState(page);
if (applyBtn) await page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first().click().catch(() => {});
await page.waitForTimeout(18000);
await page.screenshot({ path: `${D09}/2026-11-19-applied.png` });
out.applied = { drive, applyBtn, beforeApply, afterApply: await planState(page), writes: writes(m2) };
console.log('应用后:', JSON.stringify(out.applied.afterApply));

// ── #9 撤销整批：画布 Ctrl+Z
const m3 = netlog.length;
const canvas = page.locator('[aria-label="户外规划业务图层"]').first();
await canvas.click({ position: { x: 40, y: 40 }, force: true }).catch(() => {});
await page.waitForTimeout(800);
await page.keyboard.press('Control+z');
await page.waitForTimeout(12000);
await page.screenshot({ path: `${D09}/2026-11-19-after-undo.png` });
out.undo = { afterUndo: await planState(page), writes: writes(m3) };
console.log('撤销后:', JSON.stringify(out.undo.afterUndo));

// ── #9 再应用一次
const m4 = netlog.length;
const again = await waitForButton(page, /确认并应用这一版|重试|出分区预览|预览按分区/, { timeout: 15000 });
if (again) await page.getByRole('button', { name: /确认并应用这一版|重试|出分区预览|预览按分区/ }).first().click().catch(() => {});
await page.waitForTimeout(20000);
await page.screenshot({ path: `${D09}/2026-11-19-reapplied.png` });
out.reapply = { again, afterReapply: await planState(page), writes: writes(m4) };
console.log('再应用后:', JSON.stringify(out.reapply.afterReapply));

out.consoleErrors = consoleErrors.slice(0, 15);
fs.writeFileSync(`${D01}/2026-11-19-case01.json`, JSON.stringify(out, null, 2));
fs.writeFileSync(`${D09}/2026-11-19-case09.json`, JSON.stringify(out, null, 2));
console.log('\n=== 汇总 ===');
console.log(JSON.stringify({
  blank: out.blankProject && Object.values(out.blankProject)[0]?.counts,
  afterApply: out.applied.afterApply && Object.values(out.applied.afterApply)[0]?.counts,
  afterUndo: out.undo.afterUndo && Object.values(out.undo.afterUndo)[0]?.counts,
  afterReapply: out.reapply.afterReapply && Object.values(out.reapply.afterReapply)[0]?.counts,
  cloudAssets: out.material.cloudAssets,
  writes: { apply: out.applied.writes, undo: out.undo.writes, reapply: out.reapply.writes },
}, null, 1));
await browser.close();
