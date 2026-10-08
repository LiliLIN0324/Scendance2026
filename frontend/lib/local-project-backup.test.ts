import { afterEach, describe, expect, it, vi } from 'vitest';
import { handoffSchema } from '../../supabase/functions/_shared/delivery-contract';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { materialCheckinLedgerSchema, mergeMaterialCheckinLedgers, type MaterialCheckinLedger } from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema, type ProductionPlan } from '../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { INITIAL_LAYOUT } from '../components/room-organizer/lib/initial-layout';
import {
  createLocalProjectBackup, createLocalProjectBackupV3, LOCAL_PROJECT_BACKUP_COVERAGE, LOCAL_PROJECT_BACKUP_V1_COVERAGE,
  LOCAL_PROJECT_BACKUP_V3_COVERAGE, MAX_LOCAL_PROJECT_BACKUP_BYTES,
  parseLocalProjectBackupJson, readLocalProjectBackupFile, serializeLocalProjectBackup, serializeLocalProjectBackupV3, validateLocalProjectRestoreCandidate,
  type BackupBriefSnapshot, type BackupMaterialCheckinSnapshot,
} from './local-project-backup';
import type { CreativeBrief } from '../components/room-organizer/lib/creative-brief';
import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';

const createdAt = '2026-10-07T09:30:00.000Z';
const scope = 'rehearsal-project-1';
const publicAssetId = '6a4e04d0-57a7-528b-863c-41ee15c91fa7';
const privateAssetId = '80000000-0000-4000-8000-000000000001';
const publicUrl = 'https://cdn.3dassets.dev/assets/39459/v1/model.glb';
const loadingUrl = 'https://storage.example.test/private/model.glb?token=FAKE_BACKUP_TOKEN';
const brief = (): CreativeBrief => ({ event: '社区分享会', guests: 81.5, description: '  客户原话\n原文保留  ',
  mustHave: '保持入口通畅', allowIdeas: false, hasFloorplan: true,
  venueConditions: '北侧入口', style: '素雅', palette: '米白', atmosphere: '安静' });
const ready = (value: CreativeBrief = brief()): BackupBriefSnapshot => ({
  state: 'ready', scope, brief: { status: 'present', value },
});
function layout(): RoomLayout {
  const handoff = handoffSchema.parse({ ownerName: '搭建甲', dueDate: '2026-10-08',
    acceptance: '逐件核对尺寸', status: 'accepted', evidenceNote: '演练记录',
    evidenceUrls: ['https://example.test/material-evidence'], reviewedBasis: '原物料核对依据' });
  const eventOperations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
    id: 'a1000000-0000-4000-8000-000000000001', title: '签到', phase: 'event',
    plannedStartAt: '2026-10-08T23:30:00+08:00', plannedEndAt: '2026-10-09T00:30:00+08:00',
    ownerName: '执行乙', contractorName: '主持团队', acceptance: '人员记录核对', status: 'accepted',
    objectIds: ['same-name-1', 'missing-original'], actualStartedAt: '2026-10-08T23:35:00+08:00',
    actualFinishedAt: '2026-10-09T00:35:00+08:00', evidenceNote: '演练结束',
    evidenceUrls: ['https://example.test/event-evidence'], reviewedBasis: `sha256:${'a'.repeat(64)}`,
  }, { id: 'a1000000-0000-4000-8000-000000000002', title: '主持', phase: 'event' }] });
  return makeLayout({ id: scope, eventOperations, floors: [makeFloor({ items: [
    makeItem({ id: 'same-name-1', name: '相同名称', handoff }),
    makeItem({ id: 'same-name-2', name: '相同名称' }),
  ] })] });
}
const backup = () => createLocalProjectBackup(layout(), ready(), createdAt);
const json = (value: unknown) => JSON.stringify(value);
const plan = (): ProductionPlan => productionPlanSchema.parse({
  dataKind: 'rehearsal', budget: { limitMinor: null, scopeNote: '  布场与撤场\n范围待确认  ', basisNote: '' },
  staffing: [{ id: 'b1000000-0000-4000-8000-000000000001', roleName: '签到', shiftLabel: '晚班',
    taskIds: ['a1000000-0000-4000-8000-000000000001'], headcount: 2, sourceType: 'outsourced', sourceName: '演练执行团队',
    plannedArrivalAt: '2026-10-08T23:00:00+08:00', plannedDepartureAt: '2026-10-09T01:00:00+08:00' }],
  acquisitions: [{ id: 'b1000000-0000-4000-8000-000000000002', title: '演练椅子取得', method: 'rental',
    taskIds: ['a1000000-0000-4000-8000-000000000003'], objectIds: ['same-name-1', 'missing-original'],
    supplierName: '', specificationNote: '  规格未确认  ', sourceNote: '人工待询', transportScope: '送达与回收', installationScope: '按原位置摆放' }],
  estimates: [{ id: 'b1000000-0000-4000-8000-000000000003', title: '待询人工估算',
    taskIds: ['a1000000-0000-4000-8000-000000000001'], objectIds: ['same-name-2'], amountMinor: null, basisNote: '' },
  { id: 'b1000000-0000-4000-8000-000000000004', title: '明确零金额的演练项', amountMinor: 0, basisNote: '演练假设已有，不是报价' }],
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const checkinId = (n: number) => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function checkinLedger(projectId = scope): MaterialCheckinLedger {
  return materialCheckinLedgerSchema.parse({ schemaVersion: 1, projectId, dataKind: 'rehearsal', sheets: [{
    id: checkinId(1), acquisitionId: 'b1000000-0000-4000-8000-000000000002',
    acquisitionSnapshot: { title: '演练租椅', supplierName: '演练供方', specificationNote: '  单位为件\n规格待实物核对  ' }, unit: 'piece',
    agreements: [{ id: checkinId(2), agreedQuantity: 20, basisNote: '演练约定', recordedAt: '2026-10-09T08:00:00+08:00', recordedBy: '演练记录人' }],
    events: [{ id: checkinId(3), kind: 'receive', batchRef: '收-01', quantity: 18, checkState: 'checked',
      occurredAt: '2026-10-09T09:00:00+08:00', fromPartyName: '演练供方', toPartyName: '演练执行方',
      evidenceNote: '演练手动核对，未到两件待处理', evidenceUrls: [], recordedAt: '2026-10-09T09:05:00+08:00', recordedBy: '演练记录人' },
    { id: checkinId(4), kind: 'return', batchRef: '还-01', quantity: 18, checkState: 'checked',
      occurredAt: '2026-10-09T17:00:00+08:00', fromPartyName: '演练执行方', toPartyName: '演练供方',
      evidenceNote: '演练归还点验', evidenceUrls: [], recordedAt: '2026-10-09T17:05:00+08:00', recordedBy: '演练记录人' }],
  }] });
}
const readyCheckins = (value = checkinLedger()): BackupMaterialCheckinSnapshot => ({
  state: 'ready', scope: value.projectId, materialCheckins: { status: 'present', value },
});

describe('explicit V3 material checkin backup', () => {
  it('keeps the old writer V2 and writes V3 only with an explicit ready ledger snapshot', async () => {
    const base = { ...layout(), productionPlan: plan() };
    const original = { ...base, designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '方案', layout: base }] } };
    const before = json(original), facts = checkinLedger(), factsBefore = json(facts);
    const old = createLocalProjectBackup(original, ready(), createdAt);
    expect(old.version).toBe(2); expect(old.coverage).not.toHaveProperty('materialCheckins');
    expect(old).not.toHaveProperty('materialCheckins');
    const text = serializeLocalProjectBackupV3(original, ready(), readyCheckins(facts), createdAt);
    const restored = await readLocalProjectBackupFile(new File([text], 'checkin-v3.json'));
    expect(JSON.parse(text)).toMatchObject({ version: 3, coverage: LOCAL_PROJECT_BACKUP_V3_COVERAGE });
    expect(restored).toMatchObject({ source: 'backup', backupVersion: 3, layout: original,
      materialCheckins: { status: 'present', value: facts } });
    expect(restored.layout).not.toHaveProperty('materialCheckins');
    expect(restored.layout.designBook!.variants[0]!.layout).not.toHaveProperty('materialCheckins');
    expect(validateLocalProjectRestoreCandidate(restored)).toEqual(restored);
    if (restored.materialCheckins?.status === 'present') restored.materialCheckins.value.sheets[0]!.events.reverse();
    expect(json(original)).toBe(before); expect(json(facts)).toBe(factsBefore);
  });
  it('keeps explicit absence distinct from a saved empty ledger and an old file without coverage', () => {
    const absent: BackupMaterialCheckinSnapshot = { state: 'ready', scope, materialCheckins: { status: 'absent' } };
    const emptyLedger = materialCheckinLedgerSchema.parse({ projectId: scope, dataKind: 'rehearsal', sheets: [] });
    const present = readyCheckins(emptyLedger);
    expect(parseLocalProjectBackupJson(serializeLocalProjectBackupV3(layout(), ready(), absent)).materialCheckins).toEqual({ status: 'absent' });
    expect(parseLocalProjectBackupJson(serializeLocalProjectBackupV3(layout(), ready(), present)).materialCheckins)
      .toEqual({ status: 'present', value: emptyLedger });
    for (const text of [json({ ...backup(), version: 1, coverage: LOCAL_PROJECT_BACKUP_V1_COVERAGE }), json(backup()), json(layout())]) {
      const candidate = parseLocalProjectBackupJson(text);
      expect(candidate.materialCheckins).toEqual({ status: 'not-in-file' });
      expect(validateLocalProjectRestoreCandidate(candidate).materialCheckins).toEqual({ status: 'not-in-file' });
    }
    const { materialCheckins: _notInFile, ...olderCaller } = parseLocalProjectBackupJson(json(backup()));
    expect(validateLocalProjectRestoreCandidate(olderCaller).materialCheckins).toEqual({ status: 'not-in-file' });
  });
  it.each(['loading', 'saving', 'error'] as const)('blocks V3 when checkin snapshot is %s instead of exporting absence', state => {
    expect(() => createLocalProjectBackupV3(layout(), ready(), { state, scope })).toThrow('尚未完成');
  });
  it('binds both snapshots and ledger to a real persisted project ID, including non-UUID house IDs', () => {
    const id = 'house-checkin-甲'; const target = { ...layout(), id };
    const result = createLocalProjectBackupV3(target, { ...ready(), scope: id }, readyCheckins(checkinLedger(id)));
    expect(result.materialCheckins).toMatchObject({ status: 'present', value: { projectId: id } });
    expect(() => createLocalProjectBackupV3(layout(), ready(), { ...readyCheckins(), scope: 'other' })).toThrow('项目不一致');
    expect(() => createLocalProjectBackupV3(layout(), { ...ready(), scope: 'other' }, readyCheckins())).toThrow('项目不一致');
    expect(() => createLocalProjectBackupV3(layout(), ready(), { state: 'ready', scope, materialCheckins: { status: 'present', value: checkinLedger('other') } })).toThrow('编号不一致');
    expect(() => createLocalProjectBackupV3(makeLayout(), { state: 'ready', scope: 'local', brief: { status: 'absent' } },
      { state: 'ready', scope: 'local', materialCheckins: { status: 'absent' } })).toThrow('真实场景项目');
    const file = createLocalProjectBackupV3(layout(), ready(), readyCheckins());
    expect(() => parseLocalProjectBackupJson(json({ ...file, materialCheckins: { status: 'present', value: checkinLedger('other') } }))).toThrow('编号不一致');
  });
  it('rejects missing or false V3 coverage and missing fact status rather than downgrading', () => {
    const file = createLocalProjectBackupV3(layout(), ready(), readyCheckins());
    for (const coverage of [LOCAL_PROJECT_BACKUP_COVERAGE, { ...LOCAL_PROJECT_BACKUP_V3_COVERAGE, materialCheckins: false }]) {
      expect(() => parseLocalProjectBackupJson(json({ ...file, coverage }))).toThrow('字段无效');
    }
    const { materialCheckins: _facts, ...missing } = file;
    expect(() => parseLocalProjectBackupJson(json(missing))).toThrow('点验账本');
    const candidate = parseLocalProjectBackupJson(json(file));
    const { materialCheckins: _checkedFacts, ...missingCandidate } = candidate;
    expect(() => validateLocalProjectRestoreCandidate(missingCandidate)).toThrow('点验账本');
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, materialCheckins: { status: 'not-in-file' } })).toThrow('点验账本');
    for (const backupVersion of [1, 2, undefined]) {
      expect(() => validateLocalProjectRestoreCandidate({ ...candidate, backupVersion })).toThrow('旧候选未覆盖');
      expect(() => validateLocalProjectRestoreCandidate({ ...candidate, backupVersion, materialCheckins: { status: 'absent' } })).toThrow('旧候选未覆盖');
    }
  });
  it('retains unknown versus explicit zero quantities and the full correction/void history', () => {
    const facts = checkinLedger();
    const receive = facts.sheets[0]!.events[0]!;
    if (receive.kind !== 'receive') throw new Error('fixture');
    const { id: _id, kind: _kind, recordedAt: _at, recordedBy: _by, ...replacement } = receive;
    facts.sheets[0]!.events.push({ id: checkinId(5), kind: 'correction', targetId: receive.id, reason: '演练更正',
      replacement: { ...replacement, quantity: 16 }, recordedAt: '2026-10-09T18:00:00+08:00', recordedBy: '演练复核人' },
    { id: checkinId(6), kind: 'void', targetId: checkinId(5), reason: '演练作废错误记录', evidenceNote: '原记录保留', evidenceUrls: [],
      recordedAt: '2026-10-09T19:00:00+08:00', recordedBy: '演练复核人' },
    { ...receive, id: checkinId(7), batchRef: '', quantity: null, checkState: 'pending', occurredAt: null },
    { ...receive, id: checkinId(8), batchRef: '明确零', quantity: 0 });
    const text = serializeLocalProjectBackupV3(layout(), ready(), readyCheckins(facts));
    expect(parseLocalProjectBackupJson(text).materialCheckins).toEqual({ status: 'present', value: facts });
    expect(json(facts)).toContain('null');
  });
  it.each([
    { status: 'not-in-file' }, { status: 'loading' }, { status: 'absent', value: {} }, null,
  ])('rejects an illegal V3 fact state: %j', materialCheckins => {
    const file = createLocalProjectBackupV3(layout(), ready(), readyCheckins());
    expect(() => parseLocalProjectBackupJson(json({ ...file, materialCheckins }))).toThrow('点验账本');
  });
  it('refuses invalid ledgers and serializers while leaving supplied facts unchanged', () => {
    const facts = checkinLedger(), before = json(facts);
    const invalid = { ...facts, sheets: [{ ...facts.sheets[0]!, events: [{ ...facts.sheets[0]!.events[0]!, quantity: -1 }] }] };
    expect(() => createLocalProjectBackupV3(layout(), ready(), readyCheckins(invalid as MaterialCheckinLedger))).toThrow('点验账本');
    const serialize = vi.fn(() => ({ ...facts, projectId: 'other' }));
    expect(() => createLocalProjectBackupV3(layout(), ready(), readyCheckins({ ...facts, toJSON: serialize } as MaterialCheckinLedger))).toThrow('不支持的 JSON');
    expect(serialize).not.toHaveBeenCalled(); expect(json(facts)).toBe(before);
  });
  it('leaves older/newer facts separate for root merge, preserving current order and rejecting conflicts or forks', () => {
    const old = checkinLedger(), current = checkinLedger();
    const event = current.sheets[0]!.events[0]!;
    if (event.kind !== 'receive') throw new Error('fixture');
    const { id: _id, kind: _kind, recordedAt: _at, recordedBy: _by, ...replacement } = event;
    const correction = { id: checkinId(9), kind: 'correction' as const, targetId: event.id, reason: '演练后续更正',
      replacement: { ...replacement, quantity: 16 }, recordedAt: '2026-10-09T18:00:00+08:00', recordedBy: '演练复核人' };
    current.sheets[0]!.events.push(correction);
    const original = json(current);
    const candidate = parseLocalProjectBackupJson(serializeLocalProjectBackupV3(layout(), ready(), readyCheckins(old)));
    if (candidate.materialCheckins?.status !== 'present') throw new Error('fixture');
    const merged = mergeMaterialCheckinLedgers(current, candidate.materialCheckins.value);
    expect(merged.sheets[0]!.events).toEqual(current.sheets[0]!.events);
    expect(mergeMaterialCheckinLedgers(merged, candidate.materialCheckins.value)).toEqual(merged);
    const conflict = checkinLedger();
    const conflictingEvent = conflict.sheets[0]!.events[0]!;
    if (conflictingEvent.kind !== 'receive') throw new Error('fixture');
    conflictingEvent.quantity = 17;
    expect(() => mergeMaterialCheckinLedgers(current, conflict)).toThrow('不同内容');
    const fork = checkinLedger(); fork.sheets[0]!.events.push({ ...correction, id: checkinId(10) });
    expect(() => mergeMaterialCheckinLedgers(current, fork)).toThrow('分叉');
    expect(json(current)).toBe(original);
  });
  it('counts the separate ledger toward the same 8 MiB file budget', () => {
    const prefix = 'data:image/png;base64,';
    const base = { ...layout(), floorPlanImage: prefix };
    const overhead = new TextEncoder().encode(serializeLocalProjectBackup(base, ready(), createdAt)).length;
    const large = { ...base, floorPlanImage: prefix + 'a'.repeat(MAX_LOCAL_PROJECT_BACKUP_BYTES - overhead - 50) };
    expect(() => serializeLocalProjectBackup(large, ready(), createdAt)).not.toThrow();
    expect(() => serializeLocalProjectBackupV3(large, ready(), readyCheckins(), createdAt)).toThrow('8 MiB');
    const mutable = parseLocalProjectBackupJson(serializeLocalProjectBackup(large, ready(), createdAt));
    const enlargedCandidate = { ...mutable, backupVersion: 3,
      materialCheckins: { status: 'present', value: materialCheckinLedgerSchema.parse({ projectId: scope, sheets: [] }) } };
    expect(() => validateLocalProjectRestoreCandidate(enlargedCandidate)).toThrow('8 MiB');
  });
  it('does not read, merge, write or delete real facts, or fetch models during V3 precheck', () => {
    const sideEffect = vi.fn(() => { throw new Error('unexpected side effect'); });
    vi.stubGlobal('fetch', sideEffect);
    for (const name of ['indexedDB', 'localStorage', 'document']) vi.stubGlobal(name, new Proxy({}, { get: sideEffect }));
    const text = serializeLocalProjectBackupV3(layout(), ready(), readyCheckins());
    expect(validateLocalProjectRestoreCandidate(parseLocalProjectBackupJson(text)).materialCheckins?.status).toBe('present');
    expect(sideEffect).not.toHaveBeenCalled();
  });
});

describe('scene and activity backup', () => {
  it('refuses misplaced checkin facts even in permissive legacy input instead of silently dropping them', () => {
    const misplaced = { ...layout(), materialCheckins: { status: 'absent' } };
    expect(() => parseLocalProjectBackupJson(json(misplaced))).toThrow('独立的 V3');
    expect(() => createLocalProjectBackup(misplaced, ready())).toThrow('独立的 V3');
    for (const version of [1, 2]) {
      const envelope = { ...backup(), version, coverage: version === 1 ? LOCAL_PROJECT_BACKUP_V1_COVERAGE : LOCAL_PROJECT_BACKUP_COVERAGE };
      expect(() => parseLocalProjectBackupJson(json({ ...envelope, materialCheckins: { status: 'absent' } }))).toThrow('字段无效');
      const nested = { ...layout(), designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '错误位置', layout: misplaced }] } };
      expect(() => parseLocalProjectBackupJson(json({ ...envelope, layout: nested }))).toThrow('独立的 V3');
      expect(() => parseLocalProjectBackupJson(json(nested))).toThrow('独立的 V3');
    }
  });
  it('refuses facts hidden in legacy layout containers that whitelist repair would otherwise remove', () => {
    const materialCheckins = { status: 'present', value: checkinLedger() };
    const original = layout(), floor = original.floors[0]!;
    const variant = { id: 'v1', name: '方案', layout: original };
    const book = { activeId: 'v1', variants: [variant] };
    const misplaced = [
      { ...original, floors: [{ ...floor, materialCheckins }] },
      { ...original, designBook: { ...book, materialCheckins } },
      { ...original, designBook: { ...book, variants: [{ ...variant, materialCheckins }] } },
      { ...original, floors: [{ ...floor, items: [{ ...floor.items[0]!, materialCheckins }] }] },
      { ...original, unknownContainer: { materialCheckins } },
    ];
    for (const input of misplaced) {
      const before = json(input);
      expect(() => parseLocalProjectBackupJson(before)).toThrow('独立的 V3');
      expect(json(input)).toBe(before);
    }
  });

  it('revalidates V1 provenance and refuses a valid plan added to an already parsed old candidate', () => {
    const old = { ...backup(), version: 1, coverage: LOCAL_PROJECT_BACKUP_V1_COVERAGE };
    const candidate = parseLocalProjectBackupJson(json(old));
    expect(validateLocalProjectRestoreCandidate(candidate)).toEqual(candidate);
    const tampered = { ...candidate, layout: { ...candidate.layout, productionPlan: plan() } };
    expect(() => validateLocalProjectRestoreCandidate(tampered)).toThrow('V1');
    const nested = { ...candidate, layout: { ...candidate.layout, designBook: { activeId: 'v1', variants: [{
      id: 'v1', name: '后来混入的制作计划', layout: { ...layout(), productionPlan: plan() },
    }] } } };
    expect(() => validateLocalProjectRestoreCandidate(nested)).toThrow('V1');
    expect(candidate.layout).not.toHaveProperty('productionPlan');
  });

  it('keeps V2 plans and supports old unversioned callers without inventing source provenance', () => {
    const candidate = parseLocalProjectBackupJson(serializeLocalProjectBackup({ ...layout(), productionPlan: plan() }, ready(), createdAt));
    expect(validateLocalProjectRestoreCandidate(candidate)).toEqual(candidate);
    const { backupVersion: _version, ...unversioned } = candidate;
    const checked = validateLocalProjectRestoreCandidate(unversioned);
    expect(checked).toEqual(unversioned);
    expect(checked).not.toHaveProperty('backupVersion');
    expect(checked.layout.productionPlan).toEqual(plan());
    expect(checked.layout).not.toBe(candidate.layout);
    const explicitUndefined = validateLocalProjectRestoreCandidate({ ...unversioned, backupVersion: undefined });
    expect(explicitUndefined).not.toHaveProperty('backupVersion');
    const old = parseLocalProjectBackupJson(json({ ...backup(), version: 1, coverage: LOCAL_PROJECT_BACKUP_V1_COVERAGE }));
    const { backupVersion: _oldVersion, ...olderCaller } = old;
    expect(validateLocalProjectRestoreCandidate(olderCaller).layout).not.toHaveProperty('productionPlan');
  });

  it('preserves parsed legacy presence and repair metadata without claiming the old file contained a brief', () => {
    const old = { id: scope, name: '旧单层', width: 8, height: 6, items: [], floorColor: '#fff' };
    const candidate = parseLocalProjectBackupJson(json(old));
    expect(validateLocalProjectRestoreCandidate(candidate)).toEqual(candidate);
    expect(candidate.layoutWasRepaired).toBe(true);
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, backupVersion: 1 })).toThrow('候选格式');
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, brief: { status: 'absent' } })).toThrow('候选格式');
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, createdAt })).toThrow('候选格式');
  });

  it.each([0, 4, 99, '1', null])('refuses an unknown candidate version without silently repackaging it: %j', backupVersion => {
    const candidate = parseLocalProjectBackupJson(json(backup()));
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, backupVersion })).toThrow('备份版本');
  });

  it('rechecks malformed and non-JSON candidate values before returning a detached replacement', () => {
    const candidate = parseLocalProjectBackupJson(json(backup()));
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, layout: null })).toThrow('候选格式');
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, brief: { status: 'error' } })).toThrow('候选格式');
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, hidden: true })).toThrow('候选格式');
    const transform = vi.fn(() => ({ ...layout(), id: 'other-project' }));
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, layout: { ...layout(), toJSON: transform } })).toThrow('不支持的 JSON');
    expect(transform).not.toHaveBeenCalled();
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, layout: { ...layout(), productionPlan: null } })).toThrow('制作计划');
  });

  it('writes V2 and round-trips the complete root and design-variant production plans without inventing facts', async () => {
    const base = { ...layout(), productionPlan: plan() };
    const original = { ...base, designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '计划方案', layout: base }] } };
    const text = serializeLocalProjectBackup(original, ready(), createdAt);
    const parsed = await readLocalProjectBackupFile(new File([text], 'production-v2.json'));
    expect(JSON.parse(text)).toMatchObject({ version: 2, coverage: { productionPlan: true } });
    expect(parsed.backupVersion).toBe(2);
    expect(parsed.layout).toEqual(original);
    expect(parsed.layout.productionPlan!.budget!.limitMinor).toBeNull();
    expect(parsed.layout.productionPlan!.estimates.map(row => row.amountMinor)).toEqual([null, 0]);
    expect(parsed.layout.productionPlan!.acquisitions[0]!.objectIds).toEqual(['same-name-1', 'missing-original']);
    expect(parsed.layout.productionPlan!.acquisitions[0]!.taskIds).toEqual(['a1000000-0000-4000-8000-000000000003']);
    expect(parsed.layout.productionPlan!.staffing[0]).not.toHaveProperty('actualArrivalAt');
    parsed.layout.productionPlan!.staffing[0]!.roleName = '候选修改';
    expect(original.productionPlan.staffing[0]!.roleName).toBe('签到');
  });

  it('keeps missing plans absent and distinguishes an explicitly recorded empty planning block', () => {
    const original = layout();
    const noPlan = parseLocalProjectBackupJson(serializeLocalProjectBackup(original, ready(), createdAt));
    expect(noPlan.layout).not.toHaveProperty('productionPlan');
    const empty = { ...original, productionPlan: {} as ProductionPlan };
    expect(createLocalProjectBackup(empty, ready(), createdAt).layout.productionPlan).toEqual(productionPlanSchema.parse({}));
    const nested = { ...original, designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '旧方案', layout: original }] } };
    expect(createLocalProjectBackup(nested, ready()).layout.designBook!.variants[0]!.layout).not.toHaveProperty('productionPlan');
  });

  it('explicitly reads strict old V1 backups and upgrades new writes to V2 without a default plan', () => {
    const old = { ...backup(), version: 1, coverage: LOCAL_PROJECT_BACKUP_V1_COVERAGE };
    const restored = parseLocalProjectBackupJson(json(old));
    expect(restored).toMatchObject({ source: 'backup', backupVersion: 1, createdAt,
      layout: layout(), brief: { status: 'present', value: brief() } });
    expect(restored.layout).not.toHaveProperty('productionPlan');
    const upgraded = createLocalProjectBackup(restored.layout, ready(), createdAt);
    expect(upgraded.version).toBe(2);
    expect(upgraded.coverage.productionPlan).toBe(true);
    expect(upgraded.layout).toEqual(old.layout);
  });

  it('refuses mixed-version V1 coverage or new plans in the root and any design variant', () => {
    const old = { ...backup(), version: 1, coverage: LOCAL_PROJECT_BACKUP_V1_COVERAGE };
    expect(() => parseLocalProjectBackupJson(json({ ...old, coverage: LOCAL_PROJECT_BACKUP_COVERAGE }))).toThrow('字段无效');
    for (const value of [plan(), {}, null]) {
      expect(() => parseLocalProjectBackupJson(json({ ...old, layout: { ...layout(), productionPlan: value } }))).toThrow('V1');
      expect(() => parseLocalProjectBackupJson(json({ ...old, layout: { ...layout(), designBook: {
        activeId: 'v1', variants: [{ id: 'v1', name: '混版', layout: { ...layout(), productionPlan: value } }],
      } } }))).toThrow('V1');
    }
  });

  it.each([
    LOCAL_PROJECT_BACKUP_V1_COVERAGE,
    { ...LOCAL_PROJECT_BACKUP_COVERAGE, productionPlan: false },
    { ...LOCAL_PROJECT_BACKUP_COVERAGE, paidFacts: true },
  ])('requires the exact V2 coverage even when no plan is present: %j', coverage => {
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), coverage }))).toThrow('字段无效');
  });

  it('keeps a valid plan from headerless current-layout JSON, but refuses repair that changes its associations', () => {
    const original = { ...layout(), productionPlan: plan() };
    const restored = parseLocalProjectBackupJson(json(original));
    expect(restored).toMatchObject({ source: 'legacy-layout', brief: { status: 'not-in-file' } });
    expect(restored.backupVersion).toBeUndefined();
    expect(restored.layout.productionPlan).toEqual(plan());
    const singleFloor = { id: original.id, name: original.name, width: original.width, height: original.height,
      items: original.floors[0]!.items, floorColor: original.floors[0]!.floorColor,
      eventOperations: original.eventOperations, productionPlan: original.productionPlan };
    const migrated = parseLocalProjectBackupJson(json(singleFloor));
    expect(migrated.layout.productionPlan).toEqual(plan());
    expect(migrated.layout.eventOperations).toEqual(original.eventOperations);
    expect(migrated.layout.floors[0]!.items.map(item => item.id)).toEqual(original.floors[0]!.items.map(item => item.id));
    expect(migrated.layoutWasRepaired).toBe(true);
    const broken = { ...makeLayout({ id: scope }), productionPlan: plan(), floors: [makeFloor({ items: [
      makeItem({ id: 'a' }), makeItem({ id: 'a' }),
    ] })] };
    broken.productionPlan.acquisitions[0]!.objectIds = ['a-2'];
    expect(() => parseLocalProjectBackupJson(json(broken))).toThrow(/计划|执行资料/);
  });

  it.each([
    null, { ...plan(), schemaVersion: 2 }, { ...plan(), actualPaidMinor: 0 },
    { ...plan(), budget: { limitMinor: -1, scopeNote: '演练', basisNote: '演练' } },
    { ...plan(), estimates: [{ ...plan().estimates[0]!, amountMinor: 1.2, basisNote: '演练' }] },
    { ...plan(), estimates: [{ ...plan().estimates[0]!, amountMinor: Number.MAX_SAFE_INTEGER + 1, basisNote: '演练' }] },
    { ...plan(), estimates: [{ ...plan().estimates[0]!, id: plan().staffing[0]!.id.toUpperCase() }] },
  ])('refuses invalid plan data in V2 and legacy without mutating the source: %j', invalid => {
    const original = { ...layout(), productionPlan: invalid } as unknown as RoomLayout;
    const before = json(original);
    expect(() => createLocalProjectBackup(original, ready())).toThrow('制作计划');
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), layout: original }))).toThrow('制作计划');
    expect(() => parseLocalProjectBackupJson(before)).toThrow('制作计划');
    const nested = { ...layout(), designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '非法计划方案', layout: original }] } };
    expect(() => createLocalProjectBackup(nested, ready())).toThrow('制作计划');
    expect(json(original)).toBe(before);
  });

  it('round-trips the real default activity layout with stable project and execution IDs', () => {
    const before = json(INITIAL_LAYOUT);
    const initial = { ...INITIAL_LAYOUT, id: scope, eventOperations: eventOperationsSchema.parse({
      dataKind: 'rehearsal', tasks: [{ id: 'a1000000-0000-4000-8000-000000000003',
        title: '布场', phase: 'setup', objectIds: [INITIAL_LAYOUT.floors[0]!.items[0]!.id] }],
    }) };
    const snapshot: BackupBriefSnapshot = { state: 'ready', scope, brief: { status: 'absent' } };
    const restored = parseLocalProjectBackupJson(serializeLocalProjectBackup(initial, snapshot, createdAt));
    expect(restored.layout).toEqual(initial);
    expect(restored.brief).toEqual({ status: 'absent' });
    expect(restored.layoutWasRepaired).toBe(false);
    expect(json(INITIAL_LAYOUT)).toBe(before);
  });

  it('allows only missing shared defaults, ignores key order/optional undefined, and never rewrites supplied values', () => {
    const initial = { ...INITIAL_LAYOUT, id: scope, eventOperations: {
      tasks: [{ phase: 'setup', title: '布场', id: 'a1000000-0000-4000-8000-000000000003' }],
    } } as RoomLayout;
    const snapshot: BackupBriefSnapshot = { state: 'ready', scope, brief: { status: 'absent' } };
    const file = createLocalProjectBackup(initial, snapshot, createdAt);
    expect(file.layout.eventOperations).toEqual(eventOperationsSchema.parse(initial.eventOperations));
    expect(parseLocalProjectBackupJson(json(file)).layout).toEqual(file.layout);
    expect(parseLocalProjectBackupJson(json({ ...file, layout: initial })).layout).toEqual(file.layout);
    const optional = { ...initial, floorPlanImage: undefined } as unknown as RoomLayout;
    expect(createLocalProjectBackup(optional, snapshot, createdAt).layout).toEqual(file.layout);
    const handoffDefaults = { ...layout(), floors: [makeFloor({ items: [makeItem({
      handoff: {} as NonNullable<RoomLayout['floors'][number]['items'][number]['handoff']>,
    })] })] };
    expect(createLocalProjectBackup(handoffDefaults, ready(), createdAt).layout.floors[0]!.items[0]!.handoff)
      .toEqual(handoffSchema.parse({}));
    const changed = { ...initial, eventOperations: { tasks: [{
      ...initial.eventOperations!.tasks[0]!, title: '  布场  ',
    }] } } as RoomLayout;
    expect(() => createLocalProjectBackup(changed, snapshot, createdAt)).toThrow('需要修复');
  });

  it('round-trips all editable records, stable IDs, original text and both review bases through a file', async () => {
    const base = layout();
    const original = { ...base, designBook: { activeId: 'variant-1', variants: [
      { id: 'variant-1', name: '备用方案', layout: base },
    ] } };
    const input = ready();
    const text = serializeLocalProjectBackup(original, input, createdAt);
    const restored = await readLocalProjectBackupFile(new File([text], '场景与活动备份.json'));
    expect(JSON.parse(text)).toMatchObject({ format: 'scendance-local-project-backup', version: 2,
      createdAt, coverage: LOCAL_PROJECT_BACKUP_COVERAGE });
    expect(restored).toEqual({ source: 'backup', backupVersion: 2, createdAt, layout: original, materialCheckins: { status: 'not-in-file' },
      brief: { status: 'present', value: brief() }, layoutWasRepaired: false });
    expect(restored.layout).not.toBe(original);
    expect(restored.layout.eventOperations!.tasks[0]!.objectIds).toEqual(['same-name-1', 'missing-original']);
    expect(restored.layout.eventOperations!.tasks[1]).toMatchObject({ ownerName: '', contractorName: '',
      plannedStartAt: null, plannedEndAt: null, actualStartedAt: null, actualFinishedAt: null, objectIds: [] });
    expect(restored.layout.floors[0]!.items[1]).not.toHaveProperty('handoff');
    if (restored.brief.status === 'present') restored.brief.value.description = '恢复候选被编辑';
    restored.layout.eventOperations!.tasks[0]!.title = '候选被编辑';
    expect(input).toEqual(ready());
    expect(original.eventOperations!.tasks[0]!.title).toBe('签到');
  });

  it('keeps a successful absent read distinct from loading, saving, failure and a stale scope', () => {
    const absent: BackupBriefSnapshot = { state: 'ready', scope, brief: { status: 'absent' } };
    const result = parseLocalProjectBackupJson(serializeLocalProjectBackup(layout(), absent, createdAt));
    expect(result.brief).toEqual({ status: 'absent' });
    expect(result.layout).toEqual(layout());
    for (const state of ['loading', 'saving', 'error'] as const) {
      expect(() => createLocalProjectBackup(layout(), { state, scope })).toThrow('尚未完成');
    }
    expect(() => createLocalProjectBackup(layout(), { ...ready(), scope: 'another-project' })).toThrow('项目不一致');
    expect(() => createLocalProjectBackup(makeLayout(), { ...absent, scope: 'local' }, createdAt)).not.toThrow();
  });

  it('preserves every actual brief field without generation limits, default people or text truncation', () => {
    const value = { ...brief(), guests: 0, description: '原'.repeat(14000), mustHave: '要'.repeat(1000),
      venueConditions: '现场'.repeat(1000), style: '风格'.repeat(150), palette: '', atmosphere: '' };
    const result = parseLocalProjectBackupJson(serializeLocalProjectBackup(layout(), ready(value), createdAt));
    expect(result.brief).toEqual({ status: 'present', value });
    const minimal: CreativeBrief = { event: '', guests: -1, description: '', mustHave: '', allowIdeas: true };
    expect(parseLocalProjectBackupJson(serializeLocalProjectBackup(layout(), ready(minimal), createdAt)).brief)
      .toEqual({ status: 'present', value: minimal });
  });

  it('opens current and single-floor legacy layouts without claiming a brief was in the file', () => {
    const current = parseLocalProjectBackupJson(json(layout()));
    expect(current).toEqual({ source: 'legacy-layout', createdAt: null, layout: layout(), materialCheckins: { status: 'not-in-file' },
      brief: { status: 'not-in-file' }, layoutWasRepaired: false });
    const base = layout();
    const old = { id: scope, name: '旧单层', width: 8, height: 6,
      items: base.floors[0]!.items, floorColor: '#fff', eventOperations: base.eventOperations };
    const restored = parseLocalProjectBackupJson(json(old));
    expect(restored).toMatchObject({ source: 'legacy-layout', createdAt: null,
      brief: { status: 'not-in-file' }, layoutWasRepaired: true });
    expect(restored.layout.eventOperations).toEqual(base.eventOperations);
    expect(restored.layout.floors[0]!.items).toEqual(base.floors[0]!.items);
    expect(restored.layout.id).toBe(scope);
  });

  it('rejects delivery envelopes, unknown format/version and misleading coverage', () => {
    expect(() => parseLocalProjectBackupJson(json({ format: 'scendance-scene-delivery', version: 2,
      layout: layout(), scene: {}, execution: [], materials: [] }))).toThrow('交付文件');
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), version: 99 }))).toThrow('版本');
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), format: 'something-else' }))).toThrow('格式');
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), coverage: {
      ...LOCAL_PROJECT_BACKUP_COVERAGE, attachments: true } }))).toThrow('字段无效');
  });

  it.each([
    { ...brief(), guests: '30' }, { ...brief(), guests: null },
    { ...brief(), allowIdeas: 'yes' }, { ...brief(), hasFloorplan: null },
    { ...brief(), style: [] }, { ...brief(), description: null },
    { ...brief(), hidden: 'never silently drop this' },
    { guests: 30, description: '', mustHave: '', allowIdeas: true },
  ])('refuses malformed saved brief fields: %j', value => {
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), brief: { status: 'present', value } })))
      .toThrow('字段无效');
  });

  it.each([
    { status: 'loading' }, { status: 'error' }, { status: 'absent', value: brief() },
    { status: 'present' }, { status: 'not-in-file' }, null,
  ])('refuses ambiguous brief presence in new backups: %j', value => {
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), brief: value }))).toThrow('字段无效');
  });

  it('rejects invalid metadata and lossy layout repairs, while showing legacy repair explicitly', () => {
    expect(() => createLocalProjectBackup(layout(), ready({ ...brief(), guests: Number.NaN }))).toThrow('字段无效');
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), createdAt: '2026-02-30T12:00:00Z' }))).toThrow('字段无效');
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), secret: 'unexpected' }))).toThrow('字段无效');
    const corrupt = { ...layout(), hidden: 'unrecognised' };
    expect(() => createLocalProjectBackup(corrupt, ready())).toThrow('未知字段');
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), layout: corrupt }))).toThrow('未知字段');
    const tooLong = makeLayout({ id: scope, name: 'a'.repeat(201) });
    expect(() => createLocalProjectBackup(tooLong, ready())).toThrow('需要修复');
    expect(parseLocalProjectBackupJson(json(tooLong)).layoutWasRepaired).toBe(true);
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), layout: { ...layout(), width: -1 } })))
      .toThrow('布局或执行资料无效');
  });

  it('rejects values JSON would silently omit and custom serializers that could change project identity', () => {
    const original = layout();
    const omitted = { ...original, floors: [makeFloor({ items: [
      { ...makeItem(), notes: () => 'lost text' } as unknown as FurnitureItem,
    ] })] } as unknown as RoomLayout;
    expect(() => createLocalProjectBackup(omitted, ready())).toThrow('不支持的 JSON');
    const toJSON = vi.fn(() => ({ ...original, id: 'other-project' }));
    expect(() => createLocalProjectBackup({ ...original, toJSON } as RoomLayout, ready()))
      .toThrow('不支持的 JSON');
    expect(toJSON).not.toHaveBeenCalled();
    const hiddenSerializer = Object.defineProperty({ ...original }, 'toJSON', { value: toJSON });
    expect(() => createLocalProjectBackup(hiddenSerializer, ready())).toThrow('不支持的 JSON');
    expect(toJSON).not.toHaveBeenCalled();
    expect(() => createLocalProjectBackup({ ...original, floors: Array(1) } as RoomLayout, ready()))
      .toThrow('不支持的 JSON 数组');
    const cyclic = { ...original } as RoomLayout & { cycle?: unknown };
    cyclic.cycle = cyclic;
    expect(() => createLocalProjectBackup(cyclic, ready())).toThrow('循环引用');
    expect(() => createLocalProjectBackup({ ...original, hidden: undefined } as RoomLayout, ready()))
      .toThrow('未知字段');
    expect(original.id).toBe(scope);
  });

  it('rejects inherited array serializers and reports excessive nesting without a stack overflow', () => {
    const serializer = vi.fn(() => []);
    class CustomFloors extends Array<RoomLayout['floors'][number]> {
      toJSON() { return serializer(); }
    }
    const original = layout();
    const floors = new CustomFloors(...original.floors);
    expect(() => createLocalProjectBackup({ ...original, floors }, ready())).toThrow('不支持的 JSON 对象');
    expect(serializer).not.toHaveBeenCalled();
    let deep: unknown = {};
    for (let index = 0; index < 10000; index++) deep = { next: deep };
    expect(() => createLocalProjectBackup({ ...original, hidden: deep } as RoomLayout, ready())).toThrow('嵌套过深');
  });

  it('rejects illegal execution fields, ambiguous associations and repair-created task links', () => {
    const base = layout();
    const badTask = { ...base.eventOperations!.tasks[0]!, reviewedBasis: 'wrong' };
    const invalid = { ...base, eventOperations: { ...base.eventOperations!, tasks: [badTask] } };
    expect(() => parseLocalProjectBackupJson(json({ ...backup(), layout: invalid }))).toThrow('执行资料无效');
    const duplicate = { ...base, floors: [makeFloor({ items: [
      makeItem({ id: 'same-name-1' }), makeItem({ id: 'same-name-1' }),
    ] })] };
    expect(() => parseLocalProjectBackupJson(json(duplicate))).toThrow('执行资料无效');
    const repairedLink = { ...base, floors: [makeFloor({ items: [makeItem({ id: 'a' }), makeItem({ id: 'a' })] })],
      eventOperations: { ...base.eventOperations!, tasks: [{ ...base.eventOperations!.tasks[0]!, objectIds: ['a-2'] }] } };
    expect(() => parseLocalProjectBackupJson(json(repairedLink))).toThrow('执行资料无效');
    const badHandoff = { ...base, floors: [makeFloor({ items: [makeItem({ handoff: {
      ...base.floors[0]!.items[0]!.handoff!, reviewedBasis: '',
    } })] })] };
    expect(() => createLocalProjectBackup(badHandoff, ready())).toThrow('执行资料无效');
  });

  it('cleans archive authorisations recursively, retains confirmed public IDs and leaves the source alone', () => {
    const base = makeLayout({ id: scope, floors: [makeFloor({ items: [
      makeItem({ id: 'private', type: 'glb-asset', assetId: privateAssetId, glbUrl: loadingUrl }),
      makeItem({ id: 'public', type: 'glb-asset', assetId: publicAssetId, glbUrl: loadingUrl }),
      makeItem({ id: 'spoof', type: 'glb-asset', assetId: privateAssetId, source: 'public_library', glbUrl: publicUrl }),
      makeItem({ id: 'local-sample', type: 'glb-asset', source: 'local_sample', glbUrl: '/samples/table.glb' }),
    ] })] });
    const original = { ...base, designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '备选', layout: base }] } };
    const before = json(original);
    const text = serializeLocalProjectBackup(original, ready(), createdAt);
    expect(text).not.toContain('FAKE_BACKUP_TOKEN');
    const restored = parseLocalProjectBackupJson(text);
    for (const candidate of [restored.layout, restored.layout.designBook!.variants[0]!.layout]) {
      const [privateItem, publicItem, spoofed, localItem] = candidate.floors[0]!.items;
      expect(privateItem).toMatchObject({ id: 'private', assetId: privateAssetId });
      expect(privateItem).not.toHaveProperty('glbUrl');
      expect(publicItem).toMatchObject({ assetId: publicAssetId, glbUrl: publicUrl });
      expect(spoofed).not.toHaveProperty('glbUrl');
      expect(localItem).toHaveProperty('glbUrl', '/samples/table.glb');
    }
    // A file supplied by someone else is cleaned on read as well.
    expect(parseLocalProjectBackupJson(json(original)).layout.floors[0]!.items[0]).not.toHaveProperty('glbUrl');
    expect(json(original)).toBe(before);
  });

  it('checks file size before reading, checks actual UTF-8 bytes, and rejects broken JSON/read failures', async () => {
    const read = vi.fn(async () => '{}');
    await expect(readLocalProjectBackupFile({ size: MAX_LOCAL_PROJECT_BACKUP_BYTES + 1, text: read })).rejects.toThrow('8 MiB');
    expect(read).not.toHaveBeenCalled();
    const large = '字'.repeat(Math.floor(MAX_LOCAL_PROJECT_BACKUP_BYTES / 3) + 1);
    await expect(readLocalProjectBackupFile({ size: 1, text: async () => large })).rejects.toThrow('8 MiB');
    expect(() => createLocalProjectBackup(layout(), ready({ ...brief(), description: large }))).toThrow('8 MiB');
    expect(() => parseLocalProjectBackupJson('{broken')).toThrow('有效的 JSON');
    await expect(readLocalProjectBackupFile({ size: 10, text: async () => { throw new Error('读取失败'); } }))
      .rejects.toThrow('读取失败');
  });

  it('accepts exactly 8 MiB without changing the file limit or truncating text', () => {
    const value = backup();
    if (value.brief.status !== 'present') throw new Error('fixture');
    value.brief.value.description = '';
    const overhead = new TextEncoder().encode(json(value)).length;
    value.brief.value.description = 'a'.repeat(MAX_LOCAL_PROJECT_BACKUP_BYTES - overhead);
    const text = json(value);
    expect(new TextEncoder().encode(text)).toHaveLength(MAX_LOCAL_PROJECT_BACKUP_BYTES);
    expect(parseLocalProjectBackupJson(text).brief).toEqual(value.brief);
    expect(() => parseLocalProjectBackupJson(`${text} `)).toThrow('8 MiB');
  });

  it('does not access network, browser storage, DOM or mutate the supplied records', async () => {
    const sideEffect = vi.fn(() => { throw new Error('unexpected side effect'); });
    vi.stubGlobal('fetch', sideEffect);
    for (const name of ['indexedDB', 'localStorage', 'document']) {
      vi.stubGlobal(name, new Proxy({}, { get: sideEffect }));
    }
    const original = layout();
    const originalText = json(original);
    const text = serializeLocalProjectBackup(original, ready(), createdAt);
    await readLocalProjectBackupFile({ size: new TextEncoder().encode(text).length, text: async () => text });
    expect(sideEffect).not.toHaveBeenCalled();
    expect(json(original)).toBe(originalText);
  });
});
