/**
 * bench.mjs — replay the REAL brief-extraction contract against candidate models.
 *
 * WHAT MAKES THIS EVIDENCE RATHER THAN A VIBE CHECK
 *  - The system prompts are imported at runtime from `contract.real.ts`
 *    (byte-identical to the repo source `_shared/brief-extract-contract.ts`, sha256
 *     13EADF79…, read-only verified) — they are not retyped here.
 *  - Every response is scored by *executing* the production parsers
 *    (`parseBriefModelJson` → `parseModelBrief` / `parseBriefConversation`), which enforce
 *    the verbatim-evidence rule, the strict schemas, and the factEvidence<->slot coupling.
 *    `selftest.mjs` (34/34) proves those parsers run and behave as the contract documents.
 *  - Call parameters replay api.ts:214-232: temperature 0, response_format json_object,
 *    2048-token cap, 90 s timeout, system prompt + the self-reporting model-id block.
 *
 * USAGE
 *   node bench.mjs [--models=a,b] [--modes=conversation,extract] [--cases=c1,c3]
 *                  [--concurrency=3] [--dry]
 *   --dry prints the exact request payloads and calls nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const HOME = process.env.USERPROFILE;

// 端点与密钥：默认指向本机的免费渠道网关，但一律允许用环境变量覆盖，
// 这样同一个 bench 既能测本地网关，也能测云端供应商（例如直接测 api.minimax.cn）。
const BASE = process.env.BENCH_BASE ?? 'http://127.0.0.1:8326/v1';
const KEY = (process.env.BENCH_KEY ?? (() => {
  try { return fs.readFileSync(path.join(HOME, '.dsh', 'openai-gateway', 'api-key'), 'utf8').trim(); }
  catch { return ''; }
})()).trim();
if (!KEY) {
  console.error('缺少 API key：设置 BENCH_KEY，或确保 ~/.dsh/openai-gateway/api-key 存在。');
  process.exit(1);
}
// 可选：只有想给模型贴上倍率标签时才需要这份目录快照（来自渠道网关的 /v1/models）。
const CATALOG = process.env.BENCH_CATALOG ?? path.join(HERE, 'catalog.json');

const contract = await import('./contract.real.ts');
const { parseBriefModelJson } = await import('./brief-model-json.real.ts');

// ---------------------------------------------------------------- args
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const CONCURRENCY = Number(args.concurrency ?? 3);
const DRY = Boolean(args.dry);
const ONLY_MODELS = args.models ? String(args.models).split(',') : null;
const ONLY_MODES = args.modes ? String(args.modes).split(',') : null;
const ONLY_CASES = args.cases ? String(args.cases).split(',') : null;

// ---------------------------------------------------------------- candidates
// 倍率标签来自渠道网关的 /v1/models 快照（本目录的 catalog.json，可用 BENCH_CATALOG 覆盖）。
// `minimax/MiniMax-M3.1-Flash` is the model production runs today (baseline). It is also the
// only candidate whose production profile is `minimax`, which is the one profile that sends
// max_completion_tokens instead of max_tokens (api.ts:219) — reproduced here.
// `trae/minimax-m3.1-flash` is the same weights behind a different gateway channel: it is the
// control for the caveat that this bench's minimax path is a white-label channel.
const CANDIDATES = [
  { id: 'minimax/MiniMax-M3.1-Flash', role: 'baseline (production today)', minimaxProfile: true },
  { id: 'trae/deepseek-v4.1-flash', role: 'candidate' },
  { id: 'trae/doubao-2.0-mini', role: 'candidate' },
  { id: 'trae/kimi-k2.6', role: 'candidate' },
  { id: 'trae/minimax-m3.1-flash', role: 'control: same model, other channel' },
  { id: 'qodercn/qfmodel', role: 'candidate' },
  { id: 'qodercn/mmodel', role: 'candidate' },
  { id: 'buddy/glm-5v-turbo', role: 'candidate' },
  { id: 'buddy/glm-5.3', role: 'candidate' },
  { id: 'raccoon/sn-sensenova-6-8-flash-lite', role: 'candidate' },
  { id: 'loomy/qwen3.8-flash', role: 'candidate' },
  { id: 'our-free-model/stealth/glyph-cluster', role: 'candidate (keyless lane)' },
].filter((m) => !ONLY_MODELS || ONLY_MODELS.includes(m.id)).slice(0, 12);

const catalog = (() => {
  try {
    const j = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    return new Map((j.data ?? []).map((m) => [m.id, m]));
  } catch { return new Map(); }
})();
for (const m of CANDIDATES) {
  const entry = catalog.get(m.id);
  m.displayName = entry?.name ?? m.id;
  const mult = /·\s*x\s*([\d.]+)/.exec(m.displayName);
  m.costMultiplier = mult ? Number(mult[1]) : null;
  m.costLabel = mult ? `x${mult[1]}` : /免费/.test(m.displayName) ? '免费 (free)' : m.id.startsWith('our-free-model/') ? '免费 (keyless lane)' : 'no tag';
}

// ---------------------------------------------------------------- test messages
// Source of every message, and of every "expected value" below:
//   c1  Lead-named hard case; clause shape identical to the contract's own example (L321).
//   c2  Contract L327, verbatim: 「为30人办室内讲座」 — short-phrase evidence.
//   c3  Contract L68, verbatim: the 2026-11-11 production incident message (L3 comment) —
//       whitespace/full-width normalisation is the only thing that saves this turn.
//   c4  Contract L330 scenario, verbatim wording: a vague idea with no numbers/venue/materials.
//   c5  Composite assembled ONLY from clauses the contract names as hazards:
//       公司/年会→business, 长者→elderly but NOT mobilityAssistance(L16-19,294-297),
//       都站着不安排座位→all_seated not_needed(L284), 舞台/签到区→stage/checkin,
//       已经有30把椅子→inventoryMentions not headcount(L285,L319),
//       预算→must stay out of extraction and appear in unhandled(L321),
//       大概300平→areaM2 not lengthM/widthM(L277,L314), 一定要室内→requirements must(L300).
const CASES = [
  {
    id: 'c1',
    provenance: 'lead-named hard case; shape matches contract example L321',
    message: '下周三下午两点，30个人，80把椅子，签到还没定',
    unscored: [],
    expect: {
      slots: { headcount: 30, timeOfDay: 14 },
      forbidSlots: ['lengthM', 'widthM', 'areaM2', 'venueIO', 'layoutMode', 'event', 'mobilityAssistance'],
      forbidNonEmptyTags: true,
      needs: [{ kind: 'checkin', decision: 'unknown', evidenceAnyOf: ['签到还没定', '签到'] }],
      inventoryAnyOf: ['80把椅子'],
      unhandledEmpty: true,
    },
  },
  {
    id: 'c2',
    provenance: 'contract L327 verbatim',
    message: '为30人办室内讲座',
    unscored: ['audienceTags'], // 讲座→student is not in the contract's keyword map (L291): not scored either way
    expect: {
      slots: { headcount: 30, venueIO: 'indoor', eventContains: '讲座' },
      forbidSlots: ['lengthM', 'widthM', 'areaM2', 'layoutMode', 'mobilityAssistance'],
      forbidInventory: true,
      forbidNeeds: true,
      unhandledEmpty: true,
    },
  },
  {
    id: 'c3',
    provenance: 'contract L68 / L3 — the 2026-11-11 production incident message, verbatim',
    message: '都站着 搭建舞台和签到区',
    unscored: ['event'], // "搭建舞台" is setup work, not an activity type name; not scored either way
    expect: {
      slots: {},
      forbidSlots: ['headcount', 'venueIO', 'lengthM', 'widthM', 'areaM2', 'layoutMode', 'timeOfDay', 'mobilityAssistance'],
      forbidNonEmptyTags: true,
      forbidInventory: true,
      needs: [
        { kind: 'all_seated', decision: 'not_needed', evidenceAnyOf: ['都站着'] },
        { kind: 'stage', decision: 'needed', evidenceAnyOf: ['搭建舞台', '舞台'] },
        { kind: 'checkin', decision: 'needed', evidenceAnyOf: ['签到区', '签到'] },
      ],
      noFactEvidence: true, // no non-empty slot exists, so the contract forbids factEvidence rows (L240/L244)
      unhandledEmpty: true,
    },
  },
  {
    id: 'c4',
    provenance: 'contract L330 scenario, verbatim wording — nothing concrete to extract',
    message: '我们想办个活动，还没想好',
    unscored: ['event'], // reading 活动 itself as an event name is a defensible judgment call
    expect: {
      slots: {},
      forbidSlots: ['headcount', 'venueIO', 'lengthM', 'widthM', 'areaM2', 'layoutMode', 'timeOfDay', 'mobilityAssistance'],
      forbidNonEmptyTags: true,
      forbidInventory: true,
      forbidNeeds: true,
      noFactEvidence: true,
    },
  },
  {
    id: 'c5',
    provenance: 'composite of contract-named hazards (see comment block above)',
    message: '下个月公司办年会，大概120人，长者比较多，都站着不安排座位，舞台和签到区都要，已经有30把椅子，预算还没定，场地大概300平，一定要室内',
    unscored: [],
    expect: {
      slots: { headcount: 120, areaM2: 300, venueIO: 'indoor', eventContains: '年会' },
      forbidSlots: ['lengthM', 'widthM', 'mobilityAssistance'], // 长者 must NOT become mobilityAssistance
      requireTags: ['business', 'elderly'],
      needs: [
        { kind: 'all_seated', decision: 'not_needed', evidenceAnyOf: ['都站着', '不安排座位'] },
        { kind: 'stage', decision: 'needed', evidenceAnyOf: ['舞台'] },
        { kind: 'checkin', decision: 'needed', evidenceAnyOf: ['签到区', '签到'] },
      ],
      inventoryAnyOf: ['30把椅子'],
      unhandledAnyOf: ['预算'],
      forbidsExtraKey: 'budget',
      requirements: { venueIO: 'must', headcount: 'prefer', areaM2: 'prefer' },
    },
  },
].filter((c) => !ONLY_CASES || ONLY_CASES.includes(c.id));

const MODES = [
  { id: 'conversation', prompt: contract.BRIEF_CONVERSATION_PROMPT, responseMode: 'conversation_v1' },
  { id: 'extract', prompt: contract.BRIEF_EXTRACT_PROMPT, responseMode: null },
].filter((m) => !ONLY_MODES || ONLY_MODES.includes(m.id));

// ---------------------------------------------------------------- helpers
/** Mirrors the contract's own normalisation, for *value* assertions only.
 *  Validity (verbatim evidence) is always decided by the real contract, never by this. */
function normLite(v) {
  return String(v).replace(/\s+/g, '').replace(/[，､,]/g, ',').replace(/[。．]/g, '.').replace(/[：﹕:]/g, ':')
    .replace(/[；﹔;]/g, ';').replace(/[！﹗!]/g, '!').replace(/[？﹖?]/g, '?').replace(/[（﹙(]/g, '(')
    .replace(/[）﹚)]/g, ')').replace(/[“”〝〞＂"'′″]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
}
const containsAny = (hay, needles) => needles.some((n) => normLite(hay).includes(normLite(n)));
const isEmptySlot = (v) => v === undefined || v === null || (Array.isArray(v) && v.length === 0);
const has = (o, k) => o !== undefined && o !== null && Object.prototype.hasOwnProperty.call(o, k);

/** Score slot values against a case's expectations. Returns a list of named failures. */
function checkValues(extraction, caseDef, mode) {
  const e = caseDef.expect;
  const f = [];
  const unscored = new Set(caseDef.unscored ?? []);
  const slots = extraction ?? {};

  for (const [key, want] of Object.entries(e.slots ?? {})) {
    if (key.endsWith('Contains')) {
      const k = key.slice(0, -'Contains'.length);
      if (unscored.has(k)) continue;
      if (!(typeof slots[k] === 'string' && slots[k].includes(want))) f.push(`value:${k}!~"${want}"`);
    } else {
      if (unscored.has(key)) continue;
      if (slots[key] !== want) f.push(`value:${key}=${JSON.stringify(slots[key])}!=${JSON.stringify(want)}`);
    }
  }
  for (const k of e.forbidSlots ?? []) {
    if (unscored.has(k)) continue;
    if (k === 'mobilityAssistance') { if (has(slots, k)) f.push('value:mobilityAssistance-present'); continue; }
    if (!isEmptySlot(slots[k])) f.push(`value:${k}-should-be-empty(${JSON.stringify(slots[k])})`);
  }
  if (e.forbidNonEmptyTags && Array.isArray(slots.audienceTags) && slots.audienceTags.length) f.push(`value:audienceTags-invented(${slots.audienceTags.join('|')})`);
  for (const t of e.requireTags ?? []) if (!(slots.audienceTags ?? []).includes(t)) f.push(`value:audienceTags-missing:${t}`);

  const needs = slots.activityNeeds ?? [];
  for (const want of e.needs ?? []) {
    const hit = needs.find((n) => n.kind === want.kind);
    if (!hit) f.push(`value:activityNeeds-missing:${want.kind}`);
    else if (hit.decision !== want.decision) f.push(`value:activityNeeds:${want.kind}=${hit.decision}!=${want.decision}`);
    else if (want.evidenceAnyOf && !containsAny(hit.evidence, want.evidenceAnyOf)) f.push(`value:activityNeeds:${want.kind}-evidence-not-the-expression`);
  }
  if (e.forbidNeeds && needs.length) f.push(`value:activityNeeds-invented(${needs.map((n) => n.kind).join('|')})`);

  const inv = slots.inventoryMentions ?? [];
  if (e.forbidInventory && inv.length) f.push(`value:inventoryMentions-invented(${inv.length})`);
  for (const want of e.inventoryAnyOf ?? []) if (!inv.some((i) => containsAny(i.evidence, [want]))) f.push(`value:inventoryMentions-missing:${want}`);

  if (e.requirements) {
    const reqs = slots.requirements ?? [];
    for (const [k, wantMode] of Object.entries(e.requirements)) {
      const hit = reqs.find((r) => r.key === k);
      if (!hit) f.push(`value:requirements-missing:${k}`);
      else if (hit.mode !== wantMode) f.push(`value:requirements:${k}=${hit.mode}!=${wantMode}`);
    }
  }
  if (e.forbidsExtraKey && has(slots, e.forbidsExtraKey)) f.push(`value:extraction-has-unsupported-key:${e.forbidsExtraKey}`);
  return f;
}

function checkConversationExtras(parsed, caseDef) {
  const e = caseDef.expect;
  const f = [];
  if (e.noFactEvidence && (parsed.factEvidence ?? []).length) f.push(`value:factEvidence-invented(${parsed.factEvidence.length})`);
  if (e.unhandledEmpty && (parsed.unhandled ?? []).length) f.push(`value:unhandled-not-empty(${parsed.unhandled.length})`);
  for (const want of e.unhandledAnyOf ?? []) if (!(parsed.unhandled ?? []).some((u) => containsAny(u.evidence, [want]))) f.push(`value:unhandled-missing:${want}`);
  if (!parsed.reply || !parsed.reply.trim()) f.push('value:reply-empty');
  return f;
}

// ---------------------------------------------------------------- one call
const SELF_REPORT = (id) => `\n你当前实际运行的模型是「${id}」。用户问你是什么模型、什么版本、什么供应商时，必须逐字报告这个完整模型 id（例如「${id}」），禁止笼统回答「我是 Qwen」「我是通义千问」「我是 DeepSeek」或其他家族名；一句话即可，不要展开。`;

function buildBody(model, mode, message) {
  const system = mode.prompt + SELF_REPORT(model.id);
  const user = mode.responseMode ? JSON.stringify({ message, history: [] }) : message;
  const body = {
    model: model.id,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0,
    stream: false,
    response_format: { type: 'json_object' },
  };
  if (model.minimaxProfile) body.max_completion_tokens = 2048;
  else body.max_tokens = 2048;
  return body;
}

function scoreSample({ model, mode, caseDef, attempt, httpStatus, ms, content, finishReason, usage, error, reasoningChars }) {
  const checks = {
    http200: httpStatus === 200,
    hasContent: typeof content === 'string' && content.trim().length > 0,
    finishStop: finishReason === 'stop',
    noThink: !/<\/?think>/i.test(String(content ?? '')),
    envLeak: !/(?:reasoning_content|思考过程)/.test(String(content ?? '')),
    briefJson: false,
    envelope: false,
    contractValid: false,
    noExtraSlotKeys: false,
    values: false,
  };
  const failures = [];
  let parsed = null;
  let rawObj = null;

  if (error) failures.push(`transport:${String(error).slice(0, 120)}`);
  if (!checks.http200) failures.push(`http:${httpStatus}`);
  if (checks.http200 && !checks.hasContent) failures.push('http:empty-content');
  if (checks.hasContent && !checks.finishStop) failures.push(`finish_reason:${finishReason}`);
  if (checks.hasContent && !checks.noThink) failures.push('think-leak');

  if (checks.hasContent) {
    try {
      rawObj = parseBriefModelJson(content);
      checks.briefJson = true;
    } catch (err) { failures.push(`json:${err.name}`); }

    if (checks.briefJson) {
      const expectedKeys = mode.id === 'conversation'
        ? ['extraction', 'reply', 'unhandled', 'factEvidence', 'materialQueries']
        : ['event', 'headcount', 'venueIO', 'lengthM', 'widthM', 'areaM2', 'layoutMode', 'timeOfDay', 'audienceTags', 'mobilityAssistance', 'proactiveReply', 'requirements', 'inventoryMentions', 'activityNeeds'];
      checks.envelope = mode.id === 'conversation'
        ? ['extraction', 'reply', 'unhandled', 'factEvidence'].every((k) => has(rawObj, k)) && Object.keys(rawObj ?? {}).every((k) => expectedKeys.includes(k))
        : rawObj !== null && typeof rawObj === 'object' && !Array.isArray(rawObj);

      try {
        if (mode.id === 'conversation') {
          parsed = contract.parseBriefConversation(rawObj, caseDef.message);
          const extra = Object.keys(rawObj.extraction ?? {}).filter((k) => !expectedKeys.includes(k));
          checks.noExtraSlotKeys = extra.length === 0;
          if (extra.length) failures.push(`extra-slot-keys:${extra.join('|')}`);
          const vf = [...checkValues(parsed.extraction, caseDef, mode), ...checkConversationExtras(parsed, caseDef)];
          checks.values = vf.length === 0;
          failures.push(...vf);
        } else {
          parsed = contract.parseModelBrief(rawObj, caseDef.message);
          const extra = Object.keys(rawObj).filter((k) => !expectedKeys.includes(k));
          checks.noExtraSlotKeys = extra.length === 0;
          if (extra.length) failures.push(`extra-slot-keys:${extra.join('|')}`); // informational: production strips these on this path
          const vf = checkValues(parsed, caseDef, mode);
          checks.values = vf.length === 0;
          failures.push(...vf);
        }
        checks.contractValid = true;
      } catch (err) {
        failures.push(err?.message === 'MODEL_EVIDENCE_MISMATCH' ? 'contract:MODEL_EVIDENCE_MISMATCH' : `contract:${err.name}:${String(err.message).slice(0, 90)}`);
      }
    } else {
      failures.push('contract:schema-not-reached');
    }
  }

  // Production only survives when the whole chain passes. Unknown slot keys are fatal on the
  // conversation path (extraction is .strict()) but stripped on the extract path — so
  // `noExtraSlotKeys` is deliberately NOT part of the extract pass condition.
  const pass = checks.http200 && checks.hasContent && checks.finishStop && checks.noThink && checks.briefJson
    && checks.contractValid && checks.values && (mode.id !== 'conversation' || checks.envelope);

  return {
    model: model.id, mode: mode.id, caseId: caseDef.id, attempt,
    at: new Date().toISOString(), ms, httpStatus, finishReason, usage: usage ?? null,
    contentChars: typeof content === 'string' ? content.length : 0,
    reasoningChars: reasoningChars ?? 0,
    checks, failures, pass,
    content: typeof content === 'string' ? content : null,
    error: error ? String(error) : null,
    parsedEmitted: parsed,
  };
}

async function callOnce(model, mode, caseDef, attempt) {
  const body = buildBody(model, mode, caseDef.message);
  if (DRY) return { dry: true, body };
  const t0 = Date.now();
  let httpStatus = 0;
  let content = null;
  let finishReason = null;
  let usage = null;
  let error = null;
  let reasoningChars = 0;
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    httpStatus = res.status;
    const text = await res.text();
    if (res.status === 200) {
      const j = JSON.parse(text);
      const choice = j.choices?.[0];
      content = choice?.message?.content ?? '';
      finishReason = choice?.finish_reason ?? null;
      usage = j.usage ?? null;
      reasoningChars = String(choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? '').length;
    } else {
      error = text.slice(0, 300);
    }
  } catch (e) {
    error = `${e.name}: ${e.message}`;
  }
  const ms = Date.now() - t0;
  const sample = scoreSample({ model, mode, caseDef, attempt, httpStatus, ms, content, finishReason, usage, error, reasoningChars });
  return { ...sample, ms };
}

const TRANSPORT_RETRY = new Set([0, 408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runModel(model) {
  const out = [];
  const slug = model.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  for (const mode of MODES) {
    for (const caseDef of CASES) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const r = await callOnce(model, mode, caseDef, attempt);
        if (r.dry) return [{ dry: true }];
        r.retryOf = attempt > 1 ? `${mode.id}/${caseDef.id}/a1` : null;
        out.push(r);
        const tag = r.pass ? 'PASS' : 'FAIL';
        console.log(`${tag} a${attempt} ${String(r.ms).padStart(6)}ms ${model.id} ${mode.id} ${caseDef.id}${r.pass ? '' : ' :: ' + r.failures.slice(0, 3).join(', ')}`);
        fs.writeFileSync(path.join(RAW, `${slug}__${mode.id}__${caseDef.id}__a${attempt}.json`), JSON.stringify(r, null, 2));
        // One retry, only for transport-level failure, always recorded as its own sample.
        if (attempt === 1 && TRANSPORT_RETRY.has(r.httpStatus)) { await sleep(2500); continue; }
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- run
fs.mkdirSync(RAW, { recursive: true });
if (!DRY) for (const f of fs.readdirSync(RAW)) fs.unlinkSync(path.join(RAW, f));

if (DRY) {
  for (const m of CANDIDATES.slice(0, 2)) console.log(JSON.stringify(buildBody(m, MODES[0], CASES[0].message), null, 2).slice(0, 700) + '\n…');
  console.log(`models=${CANDIDATES.length} modes=${MODES.length} cases=${CASES.length} => ${CANDIDATES.length * MODES.length * CASES.length} calls`);
  process.exit(0);
}

const t0 = Date.now();
const all = [];
const queue = CANDIDATES.slice();
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  while (queue.length) {
    const model = queue.shift();
    const samples = await runModel(model);
    all.push(...samples);
  }
}));

// ---------------------------------------------------------------- summary
const p = (arr, q) => arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(q * (arr.length - 1)))] : null;
const summary = CANDIDATES.map((m) => {
  const s = all.filter((r) => r.model === m.id);
  const first = s.filter((r) => r.attempt === 1);
  const ok = s.filter((r) => r.checks.http200);
  const byCheck = {};
  for (const r of s) for (const [k, v] of Object.entries(r.checks)) if (!v) byCheck[k] = (byCheck[k] ?? 0) + 1;
  const failureKinds = {};
  for (const r of s) for (const fl of r.failures) { const k = fl.split(':')[0]; failureKinds[k] = (failureKinds[k] ?? 0) + 1; }
  const valueFails = {};
  for (const r of s) for (const fl of r.failures) if (fl.startsWith('value:')) { const k = fl.split('(')[0]; valueFails[k] = (valueFails[k] ?? 0) + 1; }
  const lat = ok.map((r) => r.ms);
  const promptTok = ok.map((r) => r.usage?.prompt_tokens).filter((n) => typeof n === 'number');
  const compTok = ok.map((r) => r.usage?.completion_tokens).filter((n) => typeof n === 'number');
  const reasonTok = ok.map((r) => r.usage?.completion_tokens_details?.reasoning_tokens ?? r.usage?.reasoning_tokens).filter((n) => typeof n === 'number');
  return {
    model: m.id, displayName: m.displayName, costLabel: m.costLabel, costMultiplier: m.costMultiplier, role: m.role,
    samples: s.length, retries: s.filter((r) => r.attempt > 1).length,
    passAll: s.filter((r) => r.pass).length,
    passRate: s.length ? s.filter((r) => r.pass).length / s.length : 0,
    firstAttemptPassRate: first.length ? first.filter((r) => r.pass).length / first.length : 0,
    contractValidRate: s.length ? s.filter((r) => r.checks.contractValid).length / s.length : 0,
    pureValidRate: s.length ? s.filter((r) => r.checks.contractValid && r.checks.values).length / s.length : 0,
    valuesRate: s.filter((r) => r.checks.contractValid).length
      ? s.filter((r) => r.checks.contractValid && r.checks.values).length / s.filter((r) => r.checks.contractValid).length : 0,
    http: ok.length, byCheck, failureKinds, valueFails,
    p50ms: p(lat, 0.5), p90ms: p(lat, 0.9), minMs: lat.length ? Math.min(...lat) : null, maxMs: lat.length ? Math.max(...lat) : null,
    avgPromptTokens: promptTok.length ? Math.round(promptTok.reduce((a, b) => a + b, 0) / promptTok.length) : null,
    avgCompletionTokens: compTok.length ? Math.round(compTok.reduce((a, b) => a + b, 0) / compTok.length) : null,
    avgReasoningTokens: reasonTok.length ? Math.round(reasonTok.reduce((a, b) => a + b, 0) / reasonTok.length) : null,
    perCase: Object.fromEntries(CASES.map((c) => {
      const cs = s.filter((r) => r.caseId === c.id);
      return [c.id, `${cs.filter((r) => r.pass).length}/${cs.length}`];
    })),
    perMode: Object.fromEntries(MODES.map((mo) => {
      const ms2 = s.filter((r) => r.mode === mo.id);
      return [mo.id, `${ms2.filter((r) => r.pass).length}/${ms2.length}`];
    })),
  };
}).sort((a, b) => b.passRate - a.passRate || b.contractValidRate - a.contractValidRate || (a.p50ms ?? 1e9) - (b.p50ms ?? 1e9));

const results = {
  at: new Date().toISOString(), wallMs: Date.now() - t0, gateway: BASE,
  contract: {
    source: 'C:\\\\幕景\\\\Scendance2026\\\\supabase\\\\functions\\\\_shared\\\\brief-extract-contract.ts',
    sha256: '13EADF79EC879B4F7DE9E6C0B45AD8E8A3BA87535348E8E58A19F2CA4C90AD16',
    executedCopy: 'reports/bench/contract.real.ts (only import lines 1-2 rewritten)',
    promptD_sha256_16: crypto.createHash('sha256').update(contract.BRIEF_EXTRACT_PROMPT).digest('hex').slice(0, 16),
    promptE_sha256_16: crypto.createHash('sha256').update(contract.BRIEF_CONVERSATION_PROMPT).digest('hex').slice(0, 16),
    promptD_chars: contract.BRIEF_EXTRACT_PROMPT.length, promptE_chars: contract.BRIEF_CONVERSATION_PROMPT.length,
  },
  cases: CASES.map((c) => ({ id: c.id, message: c.message, provenance: c.provenance, unscored: c.unscored })),
  models: CANDIDATES, summary, samples: all,
};
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2));

console.log('\n=== RANKING (sorted by all-checks pass rate) ===');
console.log('model'.padEnd(38) + 'pass  valid  p50ms  cost      perCase');
for (const s of summary) {
  console.log(s.model.padEnd(38) + `${s.passAll}/${s.samples}`.padEnd(6) + `${(s.contractValidRate * 100).toFixed(0)}%`.padEnd(7) + String(s.p50ms).padEnd(7) + String(s.costLabel).padEnd(10) + JSON.stringify(s.perCase));
}
console.log(`\nwall=${Math.round((Date.now() - t0) / 1000)}s  samples=${all.length}  results.json written`);
