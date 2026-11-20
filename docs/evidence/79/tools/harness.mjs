// #79 门禁走查台架（可复跑）
// 约定：所有脚本从仓库根运行（node docs/evidence/79/tools/xxx.mjs）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../../frontend/node_modules/playwright/index.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const SITE = 'https://scendance-scene-planner-ewz.pages.dev/';
export const REF = 'wkhfvnzgopjdzxlmycks';
export const BASE = `https://${REF}.supabase.co`;
export const API = `${BASE}/functions/v1/scene-api`;
export const CHROME = `${process.env.USERPROFILE}\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe`;
export const AUTH_KEY = `sb-${REF}-auth-token`;

export function readEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = /([A-Za-z0-9_]+)\s*=\s*([^\s\r\n]+)/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/** 新建匿名访客会话（真实云端 Supabase Auth） */
export async function newGuestSession(env = readEnv()) {
  const r = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`signup failed ${r.status} ${await r.text()}`);
  const j = await r.json();
  return {
    access_token: j.access_token,
    token_type: j.token_type || 'bearer',
    expires_in: j.expires_in,
    expires_at: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    refresh_token: j.refresh_token,
    user: j.user,
  };
}

/** 直连真实云端 scene-api（读数用） */
export async function cloudFetch(session, p, init = {}) {
  const env = readEnv();
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const r = await fetch(`${API}${p}`, {
        ...init,
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
      const text = await r.text();
      let body = text;
      try { body = JSON.parse(text); } catch { /* 非 JSON 原样返回 */ }
      return { status: r.status, body };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** 管理 API 只读 SQL（scene_private 未暴露给 PostgREST，只能走这条） */
export async function cloudSql(sql) {
  const env = readEnv();
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, apikey: env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  try { return { status: r.status, rows: JSON.parse(text) }; } catch { return { status: r.status, rows: text }; }
}

/** 某账号的户外方案云端副本读数（表未上线时如实返回不可用） */
export async function outdoorPlanReadings(actor) {
  const exists = await cloudSql("select to_regclass('scene_private.outdoor_plans')::text as tbl");
  const tbl = exists.rows?.[0]?.tbl ?? null;
  if (!tbl) return { available: false, reason: 'scene_private.outdoor_plans 表不存在（迁移 20261117180000/190000 未应用）' };
  const list = await cloudSql(
    `select activity_id::text as activity_id, name, revision, local_activity_id, updated_at
     from scene_private.outdoor_plans where actor='${actor}'::uuid order by updated_at desc`,
  );
  return { available: true, table: tbl, list: list.rows };
}

/** 拉起浏览器：注入会话 + 录 HAR + 全量请求/响应记账 */
export async function launch({ session, har = null, headless = true, viewport = { width: 1600, height: 1000 } } = {}) {
  const browser = await chromium.launch({ headless, executablePath: CHROME, args: ['--disable-http2', '--disable-quic'] });
  const context = await browser.newContext({
    viewport, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    recordHar: har ? { path: har, content: 'embed' } : undefined,
  });
  const netlog = [];
  const consoleErrors = [];
  const page = await context.newPage();

  if (session) {
    // @supabase/ssr 用 cookie 存会话：base64- 前缀 + base64url(UTF-8 JSON)，无 padding
    const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
    await context.addCookies([{
      name: AUTH_KEY, value,
      domain: new URL(SITE).hostname, path: '/',
      httpOnly: false, secure: true, sameSite: 'Lax',
    }]);
    await context.addInitScript(({ key, value }) => {
      try { localStorage.setItem(key, value); } catch { /* ignore */ }
      window.__pcReady = true;
      window.__pcRecoveryGateReady = true;
    }, { key: AUTH_KEY, value: JSON.stringify(session) });
  }

  page.on('request', (req) => {
    const url = req.url();
    if (!/supabase\.co/.test(url) && !['xhr', 'fetch'].includes(req.resourceType())) return; // 只记云端 API 与 xhr/fetch，静态资源不入账
    const body = req.postData();
    netlog.push({
      t: 'req', method: req.method(), url: url.replace(/([?&](token|apikey|access_token)=)[^&]+/gi, '$1***'),
      resourceType: req.resourceType(),
      body: body && body.length < 4000 ? body : body ? `${body.slice(0, 4000)}…(${body.length}B)` : null,
    });
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (!/supabase\.co/.test(url) && !['xhr', 'fetch'].includes(res.request().resourceType())) return;
    const entry = { t: 'res', method: res.request().method(), status: res.status(), url: url.replace(/([?&](token|apikey|access_token)=)[^&]+/gi, '$1***') };
    const ct = res.headers()['content-type'] || '';
    if (/json|text/.test(ct) && res.request().method() !== 'GET') {
      try {
        const txt = await res.text();
        entry.body = txt.length < 4000 ? txt : `${txt.slice(0, 4000)}…(${txt.length}B)`;
      } catch { /* body 不可读 */ }
    }
    netlog.push(entry);
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 400)}`));

  return { browser, context, page, netlog, consoleErrors };
}

/** 页面结构快照：按钮/可点元素 + testid + 关键文案 */
export async function dumpUi(page, limit = 220) {
  return page.evaluate((lim) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };
    const items = [...document.querySelectorAll('button,a,[role=button],[data-testid],input,textarea')]
      .filter(vis)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 60),
        testid: el.getAttribute('data-testid') || null,
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      }))
      .filter((x) => x.text || x.testid);
    return { count: items.length, items: items.slice(0, lim) };
  }, limit);
}

/** 页面可见文案 */
export async function pageText(page, max = 4000) {
  return page.evaluate(() => document.body.innerText.slice(0, 20000)).then((t) => t.slice(0, max));
}

export function writeEvidence(caseId, name, data) {
  const dir = path.join(ROOT, 'docs/evidence/79', String(caseId).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  return file;
}

/** 关掉「找回云端活动」弹层；云端副本上线后，空设备首次进入会看到它 */
export async function dismissCloudRecover(page) {
  const dialog = page.locator('[data-testid=outdoor-cloud-recover]').first();
  for (let i = 0; i < 12 && !(await dialog.count()); i += 1) await page.waitForTimeout(1000);
  if (!(await dialog.count())) return;
  const btn = dialog.locator('[data-testid=outdoor-cloud-recover-dismiss]').first();
  if (await btn.count()) {
    await btn.click({ timeout: 2000 }).catch(() => {});
  } else {
    const fresh = dialog.getByRole('button', { name: /新活动/ }).first();
    if (await fresh.count()) await fresh.click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(800);
}

/** 跳过新手引导气泡 */
export async function skipGuide(page) {
  const btn = page.getByRole('button', { name: '跳过引导' });
  if (await btn.count()) { await btn.first().click().catch(() => {}); await page.waitForTimeout(600); }
}

/** 本机户外方案槽状态（localStorage） */
export async function planState(page) {
  return page.evaluate(() => {
    const out = {};
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('scendance-outdoor-plan-v1')) continue;
      try {
        const env = JSON.parse(localStorage.getItem(k));
        const p = env.plan || env.data?.plan || {};
        out[k] = {
          projectId: env.projectId ?? null, name: env.name ?? null,
          updatedAt: env.updatedAt ?? null,
          counts: {
            zones: (p.zones || []).length, routes: (p.routes || []).length,
            entrances: (p.entrances || []).length, workers: (p.workers || []).length,
            facilities: (p.facilities || []).length, objects: (p.objects || []).length,
            boundary: (p.boundary || []).length,
          },
          planLen: JSON.stringify(p).length,
        };
      } catch (e) { out[k] = { error: String(e) }; }
    }
    out['scendance-outdoor-last-v1'] = localStorage.getItem('scendance-outdoor-last-v1');
    return out;
  });
}

/** 在聊天框输入并回车 */
export async function chat(page, text, { wait = 2500 } = {}) {
  await dismissCloudRecover(page);
  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.fill(text);
  await ta.press('Enter');
  await page.waitForTimeout(wait);
}

/** 页面上与关键词相关的按钮 */
export async function buttonsMatching(page, words) {
  return page.evaluate((ws) => [...document.querySelectorAll('button')]
    .map((b) => ({ t: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50), d: b.disabled === true, id: b.getAttribute('data-testid') }))
    .filter((b) => ws.some((w) => b.t.includes(w))), words);
}

/** 紧凑状态摘要：任务卡标题、提案、按钮清单 */
export async function summary(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const cards = [...document.querySelectorAll('[data-testid=outdoor-task-card],[aria-label="场地确认"],[aria-label="区域提案确认"],[aria-label="流线提案确认"],.ap-proposal')]
      .filter(vis).map((c) => (c.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160));
    const buttons = [...document.querySelectorAll('button')].filter(vis)
      .map((b) => ({ t: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), d: b.disabled === true, cls: (b.className || '').toString().slice(0, 28) }))
      .filter((b) => b.t && b.t.length > 1 && !/^[\ue000-\uf8ff]/.test(b.t)).slice(0, 40);
    return { cards, buttons };
  });
}

/** 页面文案（含错误提示），用于抓失效/失败文案 */
export async function chatText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid=outdoor-task-card]') || document.body;
    return (el.innerText || '').trim().replace(/\s+/g, ' ');
  });
}

/** 按可见文案点按钮，返回命中的文案（未命中返回 null）；Playwright 点不到时退回 DOM 级 click */
export async function clickText(page, re, { timeout = 8000, index = 0 } = {}) {
  await dismissCloudRecover(page);
  const loc = page.getByRole('button', { name: re }).nth(index);
  try {
    await loc.waitFor({ state: 'visible', timeout });
    const t = (await loc.innerText()).trim().replace(/\s+/g, ' ');
    await loc.click();
    return t;
  } catch { /* 落到 DOM 兜底 */ }
  return page.evaluate(({ src, flags, idx }) => {
    let rx;
    try { rx = new RegExp(src, flags.replace(/g/g, '')); } catch { return null; }
    const nodes = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],a')]
      .filter((b) => rx.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
    const el = nodes[idx];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return (el.innerText || el.getAttribute('aria-label') || '').trim();
  }, { src: re.source, flags: re.flags, idx: index });
}

/** 轮询等某个按钮出现，返回其文案；requireEnabled 时跳过 disabled 的占位按钮 */
export async function waitForButton(page, re, { timeout = 60000, poll = 1500, requireEnabled = false } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const n = await page.getByRole('button', { name: re }).count();
    if (n) {
      const loc = page.getByRole('button', { name: re }).first();
      if (requireEnabled && await loc.isDisabled().catch(() => false)) {
        await page.waitForTimeout(poll);
        continue;
      }
      const t = (await loc.innerText()).trim().replace(/\s+/g, ' ');
      return t;
    }
    await page.waitForTimeout(poll);
  }
  return null;
}

/** 推进到「可应用预览」：批计划 → 出分区预览 → 必要时补一句需求 */
export async function driveToProposal(page, { answers = ['室外展览区和表演区', '200 人市集，预算 20 万'], maxRounds = 6, shot = null } = {}) {
  await dismissCloudRecover(page);
  const trace = [];
  let zonesAnswered = false;
  for (let i = 0; i < maxRounds; i += 1) {
    const view = await summary(page).catch(() => null);
    const viewText = await chatText(page).catch(() => '');
    console.log(`[drive] round=${i} zonesAnswered=${zonesAnswered}`);
    console.log('[drive:view]', JSON.stringify(view).slice(0, 1200));
    console.log('[drive:text]', String(viewText).slice(0, 500));
    await page.screenshot({ path: `.temp/79-drive-${i}.png` }).catch(() => {});
    const confirm = await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 12000, requireEnabled: true });
    if (confirm) { trace.push({ round: i, action: 'proposal-ready', button: confirm }); if (shot) await page.screenshot({ path: shot }); return { ok: true, trace }; }
    const approve = await waitForButton(page, /批准并执行/, { timeout: 8000, requireEnabled: true });
    if (approve) {
      await page.getByRole('button', { name: /批准并执行/ }).first().click();
      trace.push({ round: i, action: 'approve-plan', button: approve });
      await page.waitForTimeout(30000);
      continue;
    }
    // 「出分区预览」在“分区用途”小卡里是 submit，输入为空时 disabled；先填用途再提交。
    const zonesAsk = page.locator('input[aria-label="分区用途和室内外"]').first();
    if (await zonesAsk.count() && await zonesAsk.isVisible().catch(() => false)) {
      const current = (await zonesAsk.inputValue().catch(() => '')).trim();
      if (!current && !zonesAnswered) {
        const next = answers[i] ?? answers[answers.length - 1];
        await zonesAsk.fill(next);
        await zonesAsk.press('Enter');
        zonesAnswered = true;
        trace.push({ round: i, action: 'answer-zones', text: next });
        await page.waitForTimeout(48000);
        continue;
      }
      // 提交后输入框会被清空；不要再填第二遍，直接往下查预览按钮。
    }
    const PREVIEW_RE = /生成分区预览|出分区预览|先生成分区预览|预览主要入口与通道|预览按分区摆放物料|预览物件间隙|预览岗位/;
    const preview = await waitForButton(page, PREVIEW_RE, { timeout: 20000, requireEnabled: true });
    if (preview) {
      await page.getByRole('button', { name: PREVIEW_RE }).first().click();
      trace.push({ round: i, action: 'make-preview', button: preview });
      await page.waitForTimeout(22000);
      continue;
    }
    if (zonesAnswered) {
      // 分区已提交，模型/预览还在跑；不再补话，等下一轮看按钮或提案。
      trace.push({ round: i, action: 'wait-zones-preview' });
      await page.waitForTimeout(15000);
      continue;
    }
    const next = answers[i] ?? answers[answers.length - 1];
    trace.push({ round: i, action: 'answer', text: next });
    await chat(page, next, { wait: 30000 });
  }
  const confirm = await waitForButton(page, /确认并应用这一版|确认分区并预览/, { timeout: 10000 });
  trace.push({ round: maxRounds, action: 'final-check', button: confirm });
  if (shot) await page.screenshot({ path: shot });
  return { ok: !!confirm, trace };
}

/** 标准建场：搜索地点 → 选候选 → 定场地 → 确认范围（红线进画布） */export async function setupSite(page, { keyword = '杭州 IN77', optionIndex = 0, shot = null } = {}) {
  await dismissCloudRecover(page);
  const trace = {};
  await page.getByRole('button', { name: '搜索地点', exact: true }).first().click();
  await page.waitForTimeout(800);
  const input = page.locator('[data-testid=outdoor-place-search-input]').first();
  await input.click();
  await input.fill(keyword);
  await page.waitForTimeout(4500);
  // 2026-11-19 新选址面板：候选类名 sc-plan-place-search-option（amap-suggest 只在旧包上兜底）。
  const planOption = page.locator('.sc-plan-place-search-option').nth(optionIndex);
  const suggestion = page.locator('[data-testid=amap-suggest] [role=option] button').first();
  for (let i = 0; i < 15; i += 1) {
    if (await planOption.count()) break;
    if (await suggestion.count()) break;
    if (await page.locator(`[data-testid=outdoor-place-search-option-${optionIndex}]`).count()) break;
    await page.waitForTimeout(1000);
  }
  if (await planOption.count()) {
    trace.candidates = await page.evaluate(() => [...document.querySelectorAll('.sc-plan-place-search-option')]
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 90)));
    await planOption.click();
    await page.waitForTimeout(6000);
    const gen = page.getByRole('button', { name: /生成户外场地|就定这个场地/ }).first();
    if (await gen.count()) {
      for (let i = 0; i < 20 && await gen.isDisabled().catch(() => true); i += 1) await page.waitForTimeout(1000);
      await gen.click().catch(() => {});
      await page.waitForTimeout(16000);
      trace.generated = true;
    }
  } else if (await suggestion.count()) {
    trace.candidates = await page.evaluate(() => [...document.querySelectorAll('[data-testid=amap-suggest] [role=option]')]
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 90)));
    await suggestion.click();
    await page.waitForTimeout(5000);
    trace.preview = await page.locator('[data-testid=venue-preview]').first().innerText().catch(() => null);
    const gen = page.getByRole('button', { name: '生成户外场地' }).first();
    if (await gen.count()) {
      for (let i = 0; i < 20 && await gen.isDisabled().catch(() => true); i += 1) await page.waitForTimeout(1000);
      await gen.click().catch(() => {});
      await page.waitForTimeout(16000);
      trace.generated = true;
    }
  } else {
    trace.candidates = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=outdoor-place-search-option-]')]
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 90)));
    await page.locator(`[data-testid=outdoor-place-search-option-${optionIndex}]`).first().click();
    await page.waitForTimeout(5000);
    await page.locator('.ap-option-row').first().click();
    await page.waitForTimeout(2500);
    trace.venueButton = await clickText(page, /就定这个场地/);
    await page.waitForTimeout(11000);
  }
  trace.rangeButton = await waitForButton(page, /确认并应用这一版/, { timeout: 20000, requireEnabled: true });
  if (trace.rangeButton) await page.getByRole('button', { name: /确认并应用这一版/ }).first().click().catch(() => {});
  await page.waitForTimeout(13000);
  if (shot) await page.screenshot({ path: shot });
  trace.plan = await planState(page);
  return trace;
}
