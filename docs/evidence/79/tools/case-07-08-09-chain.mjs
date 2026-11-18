// #7 / #8 / #9 连跑：预览 → 「等等」 → 新提案 → 应用 → 刷新 → 撤销 → 再应用
// 口径：正式站 + 真实云端 + 真实账号；每步单独落证据（JSON + 截图），失败不吞前序证据。
import fs from 'node:fs';
import { launch, skipGuide, chat, summary, planState, clickText, cloudSql, SITE } from './harness.mjs';

const sessionFile = process.argv[2] || '.temp/real-session.json';
const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
const actor = session.user.id;
const D07 = 'docs/evidence/79/07', D08 = 'docs/evidence/79/08', D09 = 'docs/evidence/79/09';
for (const d of [D07, D08, D09]) fs.mkdirSync(d, { recursive: true });

const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case-07-08-09.har' });
const steps = [];
let stepNo = 0;

const apiWrites = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
const apiAll = (from = 0) => netlog.slice(from).filter((n) => n.t === 'res' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);

async function mark(name, extra = {}) {
  stepNo += 1;
  const rec = {
    step: stepNo, name, at: new Date().toISOString(),
    plan: await planState(page), ...extra,
  };
  steps.push(rec);
  console.log(`\n===== [${stepNo}] ${name} =====`);
  console.log(JSON.stringify({ plan: rec.plan, ...extra }, null, 1).slice(0, 1200));
  return rec;
}

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);

// ── 步骤 1：选地点
await page.getByRole('button', { name: '搜索地点', exact: true }).first().click();
await page.waitForTimeout(800);
const input = page.locator('[data-testid=outdoor-place-search-input]').first();
await input.click();
await input.fill('杭州 IN77');
await page.waitForTimeout(4500);
await page.locator('[data-testid=outdoor-place-search-option-0]').first().click();
await page.waitForTimeout(5000);
await page.locator('.ap-option-row').first().click();
await page.waitForTimeout(2500);
const venueBtn = await clickText(page, /就定这个场地/);
await page.waitForTimeout(11000);
await mark('场地已定', { venueBtn, candidates: await page.evaluate(() => [...document.querySelectorAll('[data-testid=outdoor-place-search-option-0]')].map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 80))) });

// ── 步骤 2：确认活动范围（红线写进画布）
const rangeBtn = await clickText(page, /确认并应用这一版/);
await page.waitForTimeout(13000);
await page.screenshot({ path: `${D07}/2026-11-19-range-confirmed.png` });
await mark('范围已确认（红线写入）', { rangeBtn });

// ── 步骤 3：发组合需求（模型路，预期会追问分区用途）
const m3 = netlog.length;
await chat(page, '200 人市集，签到靠近入口，留出通道', { wait: 45000 });
await page.screenshot({ path: `${D07}/2026-11-19-turn1-model-asks.png` });
await mark('第 1 回合：模型追问', {
  taskText: await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 700)),
  writes: apiWrites(m3), calls: apiAll(m3).filter((x) => /assistant\/chat/.test(x)),
});

// ── 步骤 4：补分区用途 → 应出预览提案
const m4 = netlog.length;
await chat(page, '室外展览区和表演区', { wait: 45000 });
await page.screenshot({ path: `${D07}/2026-11-19-turn2-proposal.png` });
const s4 = await summary(page);
const proposalText = s4.cards.join(' || ');
const digest = (await import('node:crypto')).createHash('sha256').update(proposalText).digest('hex').slice(0, 16);
await mark('第 2 回合：产出提案', {
  proposalDigest: digest, proposalText: proposalText.slice(0, 700),
  confirmButtonSeen: !!(await clickText === null) ? undefined : (await page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).count()),
  writes: apiWrites(m4), calls: apiAll(m4).filter((x) => /assistant\/chat/.test(x)),
});

// ── 步骤 5（#7）：待预览时说「等等」→ 旧票零写
const m5 = netlog.length;
await chat(page, '等等，先别动', { wait: 25000 });
await page.screenshot({ path: `${D07}/2026-11-19-say-wait.png` });
await mark('#7 说「等等」', {
  taskText: await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 700)),
  writes: apiWrites(m5), writesCount: apiWrites(m5).length,
  proposalStillVisible: !!(await page.getByRole('button', { name: /确认并应用这一版/ }).count()),
});

// ── 步骤 6：再要一次提案（新提案）
const m6 = netlog.length;
await chat(page, '室外展览区和表演区', { wait: 45000 });
const s6 = await summary(page);
const proposalText2 = s6.cards.join(' || ');
const digest2 = (await import('node:crypto')).createHash('sha256').update(proposalText2).digest('hex').slice(0, 16);
await page.screenshot({ path: `${D07}/2026-11-19-turn3-new-proposal.png` });
await mark('新提案', { proposalDigest: digest2, proposalText: proposalText2.slice(0, 700), digestChanged: digest2 !== digest, writes: apiWrites(m6) });

// ── 步骤 7（#8b）：双击确认（<300ms）→ 只应用一次
const m7 = netlog.length;
const applyBtn = page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first();
const before = await planState(page);
await applyBtn.click().catch((e) => console.log('click1 err', String(e).slice(0, 80)));
await applyBtn.click({ force: true, timeout: 3000 }).catch((e) => console.log('click2 err', String(e).slice(0, 80)));
await page.waitForTimeout(16000);
await page.screenshot({ path: `${D08}/2026-11-19-double-click-apply.png` });
await mark('#8b 双击应用', {
  before, writes: apiWrites(m7), writeCount: apiWrites(m7).length,
  taskText: await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500)),
});

// ── 步骤 8（#9）：撤销整批 → 再应用一次
const m8 = netlog.length;
await page.locator('[data-testid=plan-undo]').first().click().catch(() => {});
await page.waitForTimeout(9000);
const afterUndo = await planState(page);
await page.screenshot({ path: `${D09}/2026-11-19-after-undo.png` });
await mark('#9 撤销整批', { afterUndo, writes: apiWrites(m8) });

const m9 = netlog.length;
const reapply = await clickText(page, /确认并应用这一版|重试|出分区预览/);
await page.waitForTimeout(16000);
await page.screenshot({ path: `${D09}/2026-11-19-reapply.png` });
await mark('#9 撤销后再应用一次', { reapply, writes: apiWrites(m9) });

const bundle = {
  ranAt: new Date().toISOString(), account: session.user.email, actor, site: SITE,
  steps, consoleErrors: consoleErrors.slice(0, 30),
  cloud: await cloudSql(`select to_regclass('scene_private.outdoor_plans')::text as outdoor_plans_tbl`),
};
fs.writeFileSync(`${D07}/2026-11-19-chain-07-08-09.json`, JSON.stringify(bundle, null, 2));
fs.writeFileSync(`${D08}/2026-11-19-chain-07-08-09.json`, JSON.stringify(bundle, null, 2));
fs.writeFileSync(`${D09}/2026-11-19-chain-07-08-09.json`, JSON.stringify(bundle, null, 2));
console.log('\n===== 汇总 =====');
console.log(JSON.stringify(steps.map((s) => ({ step: s.step, name: s.name, writes: s.writes?.length ?? 0, plan: s.plan && Object.values(s.plan)[0]?.counts })), null, 1));

await browser.close();
