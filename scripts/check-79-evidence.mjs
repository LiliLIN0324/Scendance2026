#!/usr/bin/env node
// #79 发布证据门禁：单一台账、计数重算、证据指纹去重、签字与结论分离。
// 用法：
//   node scripts/check-79-evidence.mjs            # 只验台账自洽（当前 2/11 也应为 0）
//   node scripts/check-79-evidence.mjs --strict   # 发布闸门：必须 11/11 且有人签字
//   node scripts/check-79-evidence.mjs --json     # 机器读数
//   node scripts/check-79-evidence.mjs --root <repo>
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');
const STATES = new Set(['pass', 'partial', 'blocked', 'fail', 'n/a']);
const CONCLUSIONS = new Set(['pass', 'partial', 'blocked', 'fail']);
const DIMENSIONS = ['browser', 'cloud'];
const CASE_IDS = Array.from({ length: 11 }, (_, index) => index + 1);

function argsOf(argv) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const [name, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) {
      values.set(name, inline);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(name, next);
      index += 1;
    } else {
      flags.add(name);
    }
  }
  return { flags, values };
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function allJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const output = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...allJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) output.push(full);
  }
  return output;
}

function normalizeCaseKey(file, evidenceDir) {
  const parts = relative(evidenceDir, file).split(/[\\/]/);
  return parts.length > 1 ? parts[0] : null;
}

function collectNumbers(value, output = new Set()) {
  if (typeof value === 'number' && Number.isFinite(value)) output.add(value);
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, output);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectNumbers(item, output);
  return output;
}

function collectLocalActivityIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectLocalActivityIds(item, output);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'localActivityId' && typeof item === 'string' && item.trim()) output.add(item.trim());
      else collectLocalActivityIds(item, output);
    }
  }
  return output;
}

function readingsTransitions(text) {
  const output = [];
  for (const match of String(text ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(?:B)?\s*→\s*(\d+(?:\.\d+)?)/g)) {
    output.push({ from: Number(match[1]), to: Number(match[2]), raw: match[0] });
  }
  return output;
}

function validateCasShape(file, data, root, issues) {
  const before = data?.before?.revision;
  const after = data?.after?.revision;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return;
  if (after <= before) issues.push(`CAS 原始证据不自洽：${relative(root, file)} 的 revision ${before}→${after} 没有递增`);
  const applied = data?.applied?.body?.revision;
  if (Number.isFinite(applied) && applied !== after) {
    issues.push(`CAS 原始证据不自洽：${relative(root, file)} 的 applied.revision=${applied}，after.revision=${after}`);
  }
  if (data?.stale?.body && data.stale.body.conflict !== true) {
    issues.push(`CAS 原始证据不自洽：${relative(root, file)} 的 stale 写入没有 conflict=true`);
  }
}

function evidencePaths(text, evidenceDir, root) {
  const found = [];
  let lastDir = evidenceDir;
  const pieces = String(text ?? '').split(/[；;]/).map(value => value.trim()).filter(Boolean);
  for (const piece of pieces) {
    const absolute = [...piece.matchAll(/docs[\\/]evidence[\\/]79[\\/][^\s；;、，,（）()]+/g)]
      .map(match => match[0].replace(/[。，,]+$/g, ''));
    if (absolute.length) {
      for (const item of absolute) {
        const full = resolve(root, item);
        found.push(full);
        lastDir = dirname(full);
      }
      continue;
    }
    // 台账里允许「第一个完整路径；第二个相对文件名」的写法。
    if (/\.(?:md|json|png|csv|geojson|html)$/i.test(piece)) {
      found.push(resolve(lastDir, piece.replace(/[。，,]+$/g, '')));
    }
  }
  return found;
}

function loadLedger(root) {
  const evidenceDir = join(root, 'docs/evidence/79');
  const ledgerFile = join(evidenceDir, 'walkthrough.json');
  if (!existsSync(ledgerFile)) throw new Error(`找不到台账：${relative(root, ledgerFile)}`);
  const raw = readFileSync(ledgerFile, 'utf8');
  return { evidenceDir, ledgerFile, raw, ledger: JSON.parse(raw) };
}

function validate(root) {
  const issues = [];
  const warnings = [];
  let ledgerFile = '';
  let ledger;
  let evidenceDir = join(root, 'docs/evidence/79');
  try {
    ({ evidenceDir, ledgerFile, ledger } = loadLedger(root));
  } catch (error) {
    return { issues: [String(error instanceof Error ? error.message : error)], warnings, counts: null, cases: [], root };
  }

  if (ledger.schemaVersion !== 2) issues.push(`schemaVersion 必须是 2，实际 ${JSON.stringify(ledger.schemaVersion)}`);
  if (!String(ledger.site ?? '').startsWith('https://')) issues.push('site 必须是可复跑的 https 地址');
  if (!String(ledger.round ?? '').trim()) issues.push('round 不能为空（否则不知道这份台账对应哪一轮）');

  const rows = Array.isArray(ledger.ledger) ? ledger.ledger : [];
  const referencedFiles = new Set();
  const evidenceByCase = new Map();
  const seen = new Set();
  for (const row of rows) {
    const id = Number(row?.case);
    if (!Number.isInteger(id) || id < 1 || id > 11) {
      issues.push(`ledger 里出现非法 case：${JSON.stringify(row?.case)}`);
      continue;
    }
    if (seen.has(id)) issues.push(`case #${id} 重复出现`);
    seen.add(id);
    if (!String(row.label ?? '').trim()) issues.push(`case #${id} 缺 label`);
    for (const dimension of DIMENSIONS) {
      if (!STATES.has(row[dimension])) issues.push(`case #${id} ${dimension} 状态非法：${JSON.stringify(row[dimension])}`);
    }
    if (!CONCLUSIONS.has(row.conclusion)) issues.push(`case #${id} conclusion 状态非法：${JSON.stringify(row.conclusion)}`);
    if (!String(row.readings ?? '').trim()) issues.push(`case #${id} 缺 readings（不能只写维度不写读数）`);
    if (row.conclusion !== 'pass' && !String(row.gap ?? '').trim()) issues.push(`case #${id} 不是 pass，却没有写 gap`);
    if (!String(row.evidence ?? '').trim()) {
      issues.push(`case #${id} 缺 evidence`);
    } else {
      const paths = evidencePaths(row.evidence, evidenceDir, root);
      if (!paths.length) issues.push(`case #${id} evidence 里没有可核对的 docs/evidence/79 路径`);
      const valid = [];
      for (const file of paths) {
        if (!existsSync(file)) issues.push(`case #${id} 引用的证据不存在：${relative(root, file)}`);
        else {
          referencedFiles.add(resolve(file));
          valid.push(resolve(file));
        }
      }
      evidenceByCase.set(id, valid);
    }
    const bothPass = row.browser === 'pass' && row.cloud === 'pass';
    if (bothPass && row.conclusion !== 'pass') issues.push(`case #${id} 浏览器与云端都 pass，但 conclusion 是 ${row.conclusion}`);
    if (!bothPass && row.conclusion === 'pass') issues.push(`case #${id} conclusion=pass，但维度未齐（browser=${row.browser}, cloud=${row.cloud}）`);
  }
  for (const id of CASE_IDS) if (!seen.has(id)) issues.push(` ledger 缺 case #${id}`);

  const calculated = { pass: 0, partial: 0, blocked: 0, fail: 0, na: 0 };
  for (const row of rows) {
    if (Object.hasOwn(calculated, row.conclusion)) calculated[row.conclusion] += 1;
  }
  const declared = ledger.counts ?? {};
  for (const key of Object.keys(calculated)) {
    if (declared[key] !== calculated[key]) {
      issues.push(`counts.${key} 手填为 ${JSON.stringify(declared[key])}，按 ledger 重算是 ${calculated[key]}`);
    }
  }
  if (!String(declared.note ?? '').trim()) issues.push('counts.note 不能为空');

  const deploy = ledger.deployGap ?? {};
  const byConclusion = (value) => rows.filter(row => row.conclusion === value).map(row => row.case).sort((a, b) => a - b);
  const expectedLists = {
    blockedCases: byConclusion('blocked'),
    partialCases: byConclusion('partial'),
    remainingCases: rows.filter(row => row.conclusion !== 'pass').map(row => row.case).sort((a, b) => a - b),
  };
  for (const [key, expected] of Object.entries(expectedLists)) {
    const actual = Array.isArray(deploy[key]) ? [...deploy[key]].sort((a, b) => a - b) : null;
    if (!actual) {
      issues.push(`deployGap.${key} 缺失或不是数组`);
      continue;
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      issues.push(`deployGap.${key} 与 ledger 不一致：声明 ${JSON.stringify(actual)}，重算 ${JSON.stringify(expected)}`);
    }
  }
  // resolvedCases 表示「因本次部署缺口修复而转绿的 case」，不是全部 pass；只校验它是 pass 的子集。
  if (!Array.isArray(deploy.resolvedCases)) {
    issues.push('deployGap.resolvedCases 缺失或不是数组');
  } else {
    const passIds = new Set(byConclusion('pass'));
    const resolved = deploy.resolvedCases;
    if (new Set(resolved).size !== resolved.length) issues.push('deployGap.resolvedCases 有重复 case');
    for (const id of resolved) {
      if (!passIds.has(id)) issues.push(`deployGap.resolvedCases 含非 pass case #${id}`);
    }
  }

  // 证据指纹：只核对台账实际引用的 JSON；未引用的失败样本保留审计，不参与结论。
  const hashes = new Map();
  const parsedEvidence = new Map();
  for (const file of allJsonFiles(evidenceDir)) {
    if (resolve(file) === resolve(ledgerFile)) continue;
    if (!referencedFiles.has(resolve(file))) continue;
    let digest;
    try {
      digest = sha256(file);
    } catch (error) {
      issues.push(`证据文件无法读取：${relative(root, file)}（${String(error)}）`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      issues.push(`证据 JSON 解析失败：${relative(root, file)}`);
      continue;
    }
    parsedEvidence.set(resolve(file), data);
    validateCasShape(file, data, root, issues);
    const caseKey = normalizeCaseKey(file, evidenceDir);
    if (!caseKey) continue;
    const name = basename(file);
    const explicitCases = [...name.matchAll(/case[-_]?(\d{1,2})/gi)].map(match => Number(match[1]));
    if (/^\d{2}$/.test(caseKey) && explicitCases.length && !explicitCases.includes(Number(caseKey))) {
      issues.push(`证据放错 case：${relative(root, file)} 的文件名指向 case ${explicitCases.join('/')}，但目录是 ${caseKey}`);
    }
    const entry = hashes.get(digest) ?? { files: [], cases: new Set(), names: new Set() };
    entry.files.push(relative(root, file));
    entry.cases.add(caseKey);
    entry.names.add(name);
    hashes.set(digest, entry);
  }
  for (const [digest, entry] of hashes) {
    if (entry.cases.size <= 1) continue;
    if (entry.names.size > 1) {
      issues.push(`证据指纹重复（${digest.slice(0, 12)}…）且文件名不一致，疑似跨 case 复制：${[...entry.cases].join(' / ')}；${entry.files.join('；')}`);
    } else {
      warnings.push(`共享证据（同指纹同文件名，允许）：${[...entry.cases].join(' / ')}；${entry.files.join('；')}`);
    }
  }

  // 读数语义：读数里写的数字必须能在本 case 引用的原始 JSON 里找到；
  // 带 localActivityId 的云端证据只能归给 readings 明写该 ID 的 case。
  for (const row of rows) {
    const id = Number(row?.case);
    if (!Number.isInteger(id)) continue;
    const files = evidenceByCase.get(id) ?? [];
    const data = files.map(file => parsedEvidence.get(file)).filter(Boolean);
    const transitions = readingsTransitions(row.readings);
    if (!data.length && transitions.length) {
      issues.push(`case #${id} readings 有数字读数，但没有引用可解析的 JSON，无法核对`);
    }
    const numbers = new Set();
    const activityIds = new Set();
    for (const item of data) {
      collectNumbers(item, numbers);
      collectLocalActivityIds(item, activityIds);
    }
    for (const transition of transitions) {
      if (!numbers.has(transition.from) || !numbers.has(transition.to)) {
        issues.push(`case #${id} readings 的 ${transition.raw} 没有原始 JSON 同时包含 ${transition.from} 和 ${transition.to}`);
      }
    }
    for (const activityId of activityIds) {
      if (!String(row.readings ?? '').includes(activityId)) {
        issues.push(`case #${id} 引用了云端活动 ${activityId}，但 readings 没有归属；疑似 CAS/活动错配`);
      }
    }
  }

  const signoff = ledger.signoff ?? {};
  const allPass = calculated.pass === CASE_IDS.length;
  if (!['pending-human', 'signed'].includes(signoff.status)) {
    issues.push(`signoff.status 非法：${JSON.stringify(signoff.status)}（只能是 pending-human / signed）`);
  }
  if (signoff.status === 'signed') {
    if (!String(signoff.signedBy ?? '').trim()) issues.push('signoff=signed，但缺 signedBy');
    if (!Number.isFinite(Date.parse(signoff.signedAt ?? ''))) issues.push('signoff=signed，但 signedAt 不可解析');
    if (!allPass) issues.push(`signoff=signed，但全绿只有 ${calculated.pass}/11；签字不能替代未完成证据`);
  }
  if (!allPass) warnings.push(`发布未就绪：${calculated.pass}/11 全绿（partial ${calculated.partial}，blocked ${calculated.blocked}）`);

  return {
    root,
    evidenceDir,
    ledgerFile,
    counts: calculated,
    declaredCounts: declared,
    cases: rows.map(row => ({ case: row.case, conclusion: row.conclusion, browser: row.browser, cloud: row.cloud })),
    allPass,
    signoff: signoff.status,
    issues,
    warnings,
  };
}

function printHuman(result, strict) {
  const counts = result.counts;
  if (counts) {
    console.log(`[79] 台账 ${result.cases.length}/11 · pass ${counts.pass} / partial ${counts.partial} / blocked ${counts.blocked} / fail ${counts.fail} / n/a ${counts.na}`);
    console.log(`[79] 签字状态：${result.signoff ?? '缺失'}`);
  }
  for (const warning of result.warnings ?? []) console.log(`[79] 提示：${warning}`);
  if (result.issues?.length) {
    for (const issue of result.issues) console.error(`[79] ✗ ${issue}`);
    console.error(`[79] 证据门禁 FAIL：${result.issues.length} 个问题`);
    return 1;
  }
  console.log('[79] 证据台账自洽：计数、维度、路径、指纹、读数、签字边界均通过');
  if (strict) {
    if (!result.allPass) {
      console.error('[79] 发布闸门 FAIL：证据未齐 11/11，不能进入发布签字');
      return 1;
    }
    if (result.signoff !== 'signed') {
      console.error('[79] 发布闸门 FAIL：证据已齐，但还没有人签字');
      return 1;
    }
    console.log('[79] 发布闸门 PASS：11/11 全绿且已签字');
  }
  return 0;
}

const { flags, values } = argsOf(process.argv.slice(2));
if (flags.has('help')) {
  console.log('用法：node scripts/check-79-evidence.mjs [--strict] [--json] [--root <repo>]');
  process.exit(0);
}
const root = resolve(values.get('root') ?? DEFAULT_ROOT);
const result = validate(root);
const strict = flags.has('strict');
if (flags.has('json')) {
  const jsonBlocked = result.issues.length > 0 || (strict && (!result.allPass || result.signoff !== 'signed'));
  console.log(JSON.stringify({ ...result, strict }, null, 2));
  process.exitCode = jsonBlocked ? 1 : 0;
} else {
  process.exitCode = printHuman(result, strict);
}
