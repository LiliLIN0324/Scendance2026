// #1 用例：空白项目 + 组合需求 + 地点范围 + 真实物料库
// 2026-11-19 修正：新选址面板（amap-suggest → 生成户外场地）+ 分区用途小卡 + 分阶段应用
import fs from 'node:fs';
import {
  launch, skipGuide, chat, setupSite, driveToProposal, planState,
  waitForButton, clickText, cloudFetch, SITE,
} from './harness.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const OUT = 'docs/evidence/79/01';
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, netlog, consoleErrors } = await launch({ session, har: '.temp/case-01-material.har' });
const out = { ranAt: new Date().toISOString(), account: session.user.email, site: SITE };
const writes = (from = 0) => netlog.slice(from)
  .filter((n) => n.t === 'res' && n.method !== 'GET' && /supabase\.co/.test(n.url))
  .map((n) => `${n.method} ${n.status} ${n.url.replace(/https:\/\/[^/]+/, '').slice(0, 90)}`);
const latestPlan = async () => {
  const all = await planState(page);
  const keys = Object.keys(all).filter((k) => k.startsWith('scendance-outdoor-plan-v1:'));
  const active = all['scendance-outdoor-last-v1'];
  const pick = keys.find((k) => k.endsWith(`:${active}`))
    || keys.sort((a, b) => String(all[b]?.updatedAt || '').localeCompare(String(all[a]?.updatedAt || '')))[0];
  return { active, pick, plan: pick ? all[pick] : null, all };
};

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await skipGuide(page);

// ── 1. 空白项目：新建本机活动，画布应为 0 分区/0 设施/167B
await page.locator('.sc-activity-island-toggle').first().click().catch(() => {});
await page.waitForTimeout(1500);
const newAct = page.getByRole('button', { name: /新建活动/ }).first();
out.newActivitySeen = await newAct.count();
if (out.newActivitySeen) await newAct.click().catch(() => {});
await page.waitForTimeout(7000);
await page.screenshot({ path: `${OUT}/2026-11-19-blank-project.png` });
out.blank = await latestPlan();
console.log('空白项目:', JSON.stringify({ active: out.blank.active, pick: out.blank.pick, counts: out.blank.plan?.counts, planLen: out.blank.plan?.planLen }));

// ── 2. 组合需求：一句真实用户说法
const m1 = netlog.length;
await chat(page, '在杭州 IN77 做设计，200 人发布会，户外广场 30×20 米，签到台放西侧入口', { wait: 45000 });
await page.screenshot({ path: `${OUT}/2026-11-19-composite-requirement.png` });
out.composite = {
  taskText: await page.evaluate(() => (document.querySelector('[data-testid=outdoor-task-card]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 700)),
  calls: netlog.slice(m1).filter((n) => n.t === 'res' && /assistant\/chat/.test(n.url)).map((n) => `${n.method} ${n.status}`),
};

// ── 3. 地点 + 范围（新面板：联想候选 → 生成户外场地 → 确认范围）
out.setup = await setupSite(page, { shot: `${OUT}/2026-11-19-range-confirmed.png` });
out.afterSetup = await latestPlan();
console.log('范围确认:', JSON.stringify(out.setup));

// ── 4. 分阶段推进：分区 → 主通道 → 物料
async function applyStage(label, answers) {
  const from = netlog.length;
  const before = await latestPlan();
  const drive = await driveToProposal(page, { answers });
  const btn = await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 12000, requireEnabled: true });
  if (btn) {
    await page.getByRole('button', { name: /确认并应用这一版|确认分区并预览/ }).first().click().catch(() => {});
    await page.waitForTimeout(16000);
  }
  await page.screenshot({ path: `${OUT}/2026-11-19-stage-${label}.png` });
  const after = await latestPlan();
  return { label, drive, button: btn, applied: !!btn, before: before.plan?.counts, after: after.plan?.counts, planLen: after.plan?.planLen, writes: writes(from) };
}

out.zones = await applyStage('zones', ['室外发布会区和签到区']);
console.log('分区后:', JSON.stringify(out.zones.after));

out.routes = await applyStage('routes', ['室外发布会区和签到区']);
console.log('主通道后:', JSON.stringify(out.routes.after));

// ── 5. 物料表单只在 objects 阶段出现；先检索真实库，再出物件预览
const matInput = page.locator('input[aria-label="物料名称或用途"]').first();
out.material = { inputSeen: await matInput.count() };
if (out.material.inputSeen) {
  await matInput.fill('展板');
  await page.waitForTimeout(600);
  out.material.search = await clickText(page, /检索真实库/);
  await page.waitForTimeout(14000);
  out.material.choices = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
    .map((b) => (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 100))
    .filter((t) => t && /我的库|本机会话|×/.test(t)).slice(0, 20));
  out.material.libraryText = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="当前分区物料候选"]');
    return (el?.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
  });
  await page.screenshot({ path: `${OUT}/2026-11-19-material-library.png` });
  const firstChoice = page.locator('[aria-label="当前分区物料候选"] button').filter({ hasText: /我的库|本机会话/ }).first();
  if (await firstChoice.count()) {
    out.material.firstChoice = (await firstChoice.innerText()).trim().replace(/\s+/g, ' ');
    await firstChoice.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
}

// #1 只要求物料候选可见；物件预览会再打一次模型，留给 #8/#9 的链，不在这里硬跑。
out.objects = { skipped: true, reason: '#1 物料候选已取证，不要求物件预览' };

// ── 6. 云端资产读数（网络抖动时重试；失败不伪造通过）
try {
  const cloudAssets = await cloudFetch(session, '/assets');
  out.material.cloudAssets = { status: cloudAssets.status, count: Array.isArray(cloudAssets.body) ? cloudAssets.body.length : cloudAssets.body };
} catch (error) {
  out.material.cloudAssets = { error: String(error) };
}

out.final = await latestPlan();
out.consoleErrors = consoleErrors.slice(0, 15);
fs.writeFileSync(`${OUT}/2026-11-19-case01-round7.json`, JSON.stringify(out, null, 2));
console.log('\n=== 汇总 ===');
console.log(JSON.stringify({
  blank: out.blank.plan?.counts,
  setup: out.afterSetup.plan?.counts,
  zones: out.zones.after,
  routes: out.routes.after,
  material: { inputSeen: out.material.inputSeen, choices: out.material.choices, cloudAssets: out.material.cloudAssets },
  objects: out.objects.after,
  final: out.final.plan?.counts,
}, null, 1));
await browser.close();
