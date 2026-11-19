import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

type CountKey = 'pass' | 'partial' | 'blocked' | 'fail' | 'na';
type Status = CountKey | 'blocked';

interface Row {
  case: number;
  label: string;
  browser: Status;
  cloud: Status;
  conclusion: Exclude<CountKey, 'na'>;
  readings: string;
  gap?: string;
  evidence: string;
}

interface Ledger {
  schemaVersion: number;
  site: string;
  round: string;
  counts: Record<CountKey, number> & { note: string };
  deployGap: {
    blockedCases: number[];
    partialCases: number[];
    resolvedCases: number[];
    remainingCases: number[];
  };
  signoff: { status: string; signedBy?: string; signedAt?: string };
  ledger: Row[];
}

interface FixtureOptions {
  passIds?: number[];
  mutate?: (rows: Row[]) => void;
  duplicateEvidence?: boolean;
  sharedEvidence?: boolean;
  mutateLedger?: (ledger: Ledger) => void;
}

const SCRIPT = fileURLToPath(new URL('../scripts/check-79-evidence.mjs', import.meta.url));
const roots: string[] = [];

function pad(id: number): string {
  return String(id).padStart(2, '0');
}

function ledgerFor(options: FixtureOptions = {}): Ledger {
  const { passIds = [2, 7], mutate, duplicateEvidence = false, sharedEvidence = false } = options;
  const rows: Row[] = Array.from({ length: 11 }, (_, index) => {
    const id = index + 1;
    const pass = passIds.includes(id);
    return {
      case: id,
      label: `case ${id}`,
      browser: 'pass',
      cloud: pass ? 'pass' : 'blocked',
      conclusion: pass ? 'pass' : 'partial',
      readings: `case ${id} readings`,
      ...(pass ? {} : { gap: `case ${id} gap` }),
      evidence: `docs/evidence/79/${pad(id)}/case${pad(id)}.json`,
    };
  });
  if (duplicateEvidence) {
    rows[8].evidence = 'docs/evidence/79/09/case09.json';
  }
  if (sharedEvidence) {
    for (const id of [7, 8, 9]) rows[id - 1].evidence = `docs/evidence/79/${pad(id)}/shared.json`;
  }
  if (mutate) mutate(rows);
  const counts: Record<CountKey, number> = { pass: 0, partial: 0, blocked: 0, fail: 0, na: 0 };
  for (const row of rows) counts[row.conclusion] += 1;
  return {
    schemaVersion: 2,
    site: 'https://example.test',
    round: 'fixture',
    counts: { ...counts, note: 'fixture counts' },
    deployGap: {
      blockedCases: rows.filter(row => row.conclusion === 'blocked').map(row => row.case),
      partialCases: rows.filter(row => row.conclusion === 'partial').map(row => row.case),
      resolvedCases: rows.filter(row => row.conclusion === 'pass').map(row => row.case),
      remainingCases: rows.filter(row => row.conclusion !== 'pass').map(row => row.case),
    },
    signoff: { status: 'pending-human' },
    ledger: rows,
  };
}

function makeFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-79-'));
  roots.push(root);
  const evidenceDir = join(root, 'docs/evidence/79');
  mkdirSync(evidenceDir, { recursive: true });
  const ledger = ledgerFor(options);
  for (let id = 1; id <= 11; id += 1) {
    const dir = join(evidenceDir, pad(id));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `case${pad(id)}.json`), JSON.stringify({ case: id, marker: `unique-${id}` }));
  }
  if (options.duplicateEvidence) {
    copyFileSync(join(evidenceDir, '01/case01.json'), join(evidenceDir, '09/case09.json'));
  }
  if (options.sharedEvidence) {
    const shared = JSON.stringify({ chain: '07-08-09', run: 1 });
    for (const id of [7, 8, 9]) writeFileSync(join(evidenceDir, pad(id), 'shared.json'), shared);
  }
  if (options.mutateLedger) options.mutateLedger(ledger);
  writeFileSync(join(evidenceDir, 'walkthrough.json'), JSON.stringify(ledger, null, 2));
  return { root, ledger, evidenceDir };
}

function run(root: string, extra: string[] = []) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extra], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-79-evidence', () => {
  it('接受自洽的 2/11 台账（check 通过，strict 未就绪）', () => {
    const { root } = makeFixture();
    const check = run(root);
    expect(check.status).toBe(0);
    expect(check.output).toContain('pass 2 / partial 9');
    expect(check.output).toContain('证据台账自洽');

    const strict = run(root, ['--strict']);
    expect(strict.status).toBe(1);
    expect(strict.output).toContain('证据未齐 11/11');
  });

  it('拒绝手填计数与 ledger 重算不一致', () => {
    const { root } = makeFixture({
      mutateLedger: ledger => { ledger.counts.pass = 3; },
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('counts.pass 手填为 3');
    expect(result.output).toContain('按 ledger 重算是 2');
  });

  it('拒绝 conclusion=pass 但云端未 pass', () => {
    const { root } = makeFixture({
      mutateLedger: ledger => {
        ledger.ledger[0].conclusion = 'pass';
        ledger.ledger[0].browser = 'pass';
        ledger.ledger[0].cloud = 'partial';
      },
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('case #1 conclusion=pass，但维度未齐');
  });

  it('拒绝把 case01.json 复制成 case09.json 后当 #9 证据', () => {
    const { root } = makeFixture({ duplicateEvidence: true });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('证据指纹重复');
    expect(result.output).toContain('文件名不一致');
    expect(result.output).toContain('01 / 09');
  });

  it('拒绝文件名指向另一个 case 的证据', () => {
    const { root, evidenceDir } = makeFixture();
    copyFileSync(join(evidenceDir, '01/case01.json'), join(evidenceDir, '09/case01.json'));
    const ledger: Ledger = JSON.parse(String(readFileSync(join(evidenceDir, 'walkthrough.json'), 'utf8')));
    ledger.ledger[8].evidence = 'docs/evidence/79/09/case01.json';
    writeFileSync(join(evidenceDir, 'walkthrough.json'), JSON.stringify(ledger));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('证据放错 case');
  });

  it('允许 07/08/09 引用同一份同 basename 的链式证据', () => {
    const { root } = makeFixture({ sharedEvidence: true });
    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.output).toContain('共享证据');
    expect(result.output).toContain('07 / 08 / 09');
  });

  it('拒绝引用不存在的证据文件', () => {
    const { root } = makeFixture();
    rmSync(join(root, 'docs/evidence/79/08/case08.json'));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('case #8 引用的证据不存在');
  });

  it('拒绝 deployGap 与实际结论冲突', () => {
    const { root } = makeFixture({
      mutateLedger: ledger => { ledger.deployGap.partialCases = [1]; },
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('deployGap.partialCases 与 ledger 不一致');
  });

  it('--json 也按 strict 返回非零，且输出可解析', () => {
    const { root } = makeFixture();
    const result = run(root, ['--json', '--strict']);
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.output);
    expect(payload.allPass).toBe(false);
    expect(payload.counts.pass).toBe(2);
    expect(payload.issues).toEqual([]);
  });

  it('拒绝把带 localActivityId 的云端证据记到别的 case', () => {
    const { root, evidenceDir } = makeFixture();
    writeFileSync(join(evidenceDir, '08/cloud.json'), JSON.stringify({
      localActivityId: 'house-cas-owner',
      before: { revision: 3 },
      after: { revision: 4 },
      applied: { body: { revision: 4 } },
      stale: { body: { conflict: true } },
    }));
    const ledger: Ledger = JSON.parse(String(readFileSync(join(evidenceDir, 'walkthrough.json'), 'utf8')));
    ledger.ledger[7].readings = 'house-cas-owner：revision 3→4';
    ledger.ledger[7].evidence = 'docs/evidence/79/08/cloud.json';
    ledger.ledger[8].evidence = 'docs/evidence/79/08/cloud.json';
    writeFileSync(join(evidenceDir, 'walkthrough.json'), JSON.stringify(ledger));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('引用了云端活动 house-cas-owner');
    expect(result.output).toContain('CAS/活动错配');
  });

  it('拒绝 CAS 原始证据自身不递增或 applied 与 after 不一致', () => {
    const { root, evidenceDir } = makeFixture();
    writeFileSync(join(evidenceDir, '08/cloud.json'), JSON.stringify({
      localActivityId: 'house-cas-owner',
      before: { revision: 4 },
      after: { revision: 4 },
      applied: { body: { revision: 5 } },
      stale: { body: { conflict: false } },
    }));
    const ledger: Ledger = JSON.parse(String(readFileSync(join(evidenceDir, 'walkthrough.json'), 'utf8')));
    ledger.ledger[7].readings = 'house-cas-owner：revision 4→4';
    ledger.ledger[7].evidence = 'docs/evidence/79/08/cloud.json';
    writeFileSync(join(evidenceDir, 'walkthrough.json'), JSON.stringify(ledger));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('revision 4→4 没有递增');
    expect(result.output).toContain('applied.revision=5');
    expect(result.output).toContain('stale 写入没有 conflict=true');
  });

  it('拒绝读数写 0→4 但原始 JSON 没有 0 和 4', () => {
    const { root, evidenceDir } = makeFixture();
    const ledger: Ledger = JSON.parse(String(readFileSync(join(evidenceDir, 'walkthrough.json'), 'utf8')));
    ledger.ledger[7].readings = '方案分区 0→4，方案长度 574→1440B';
    writeFileSync(join(evidenceDir, 'walkthrough.json'), JSON.stringify(ledger));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('readings 的 0→4');
    expect(result.output).toContain('没有原始 JSON 同时包含 0 和 4');
  });

  it('读数数字能在原始 JSON 中找到时通过', () => {
    const { root, evidenceDir } = makeFixture();
    writeFileSync(join(evidenceDir, '08/case08.json'), JSON.stringify({ before: { zones: 0, planLen: 574 }, after: { zones: 2, planLen: 1440 } }));
    const ledger: Ledger = JSON.parse(String(readFileSync(join(evidenceDir, 'walkthrough.json'), 'utf8')));
    ledger.ledger[7].readings = '方案分区 0→2，方案长度 574→1440B';
    writeFileSync(join(evidenceDir, 'walkthrough.json'), JSON.stringify(ledger));
    const result = run(root);
    expect(result.status).toBe(0);
  });

  it('不把嵌套历史列表里的 localActivityId 当作当前用例归属', () => {
    const { root, evidenceDir } = makeFixture();
    writeFileSync(join(evidenceDir, '08/cloud.json'), JSON.stringify({ cloudSql: { list: [{ localActivityId: 'house-history-only' }] } }));
    const ledger: Ledger = JSON.parse(String(readFileSync(join(evidenceDir, 'walkthrough.json'), 'utf8')));
    ledger.ledger[7].evidence = 'docs/evidence/79/08/cloud.json';
    writeFileSync(join(evidenceDir, 'walkthrough.json'), JSON.stringify(ledger));
    const result = run(root);
    expect(result.status).toBe(0);
  });

  it('拒绝在未全绿时签字', () => {
    const { root } = makeFixture({
      mutateLedger: ledger => {
        ledger.signoff = { status: 'signed', signedBy: 'fixture', signedAt: '2026-11-19T00:00:00.000Z' };
      },
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('签字不能替代未完成证据');
  });

  it('全绿且有人签字时 strict 通过', () => {
    const { root } = makeFixture({
      passIds: Array.from({ length: 11 }, (_, index) => index + 1),
      mutateLedger: ledger => {
        ledger.signoff = { status: 'signed', signedBy: 'fixture', signedAt: '2026-11-19T00:00:00.000Z' };
      },
    });
    const result = run(root, ['--strict']);
    expect(result.status).toBe(0);
    expect(result.output).toContain('发布闸门 PASS');
  });
});
