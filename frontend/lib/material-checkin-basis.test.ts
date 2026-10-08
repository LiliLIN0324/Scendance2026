import { describe, expect, it, vi } from 'vitest';
import { canonical } from '../../supabase/functions/_shared/domain';
import type { EventOperationTask } from '../../supabase/functions/_shared/event-operations-contract';
import {
  materialCheckinLedgerSchema, materialCheckinSheetSchema,
  type MaterialCheckinLedger, type MaterialCheckinSheet, type MaterialCheckinEvent,
} from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { materialCheckinTaskBasis } from './material-checkin-basis';

const id = (value: number) => `bc400000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const projectId = 'checkin-basis-project';
const recordedAt = '2026-10-09T09:05:00+08:00';
type Task = Pick<EventOperationTask, 'id' | 'objectIds'>;
type Basis = Pick<MaterialCheckinLedger, 'projectId' | 'dataKind' | 'sheets'>;
const task = (): Task => ({ id: id(2), objectIds: [id(21)] });
function layout(): RoomLayout {
  return makeLayout({ id: projectId, productionPlan: productionPlanSchema.parse({ dataKind: 'rehearsal', acquisitions: [
    { id: id(10), title: '明确任务关联取得', taskIds: [id(2)], objectIds: [id(20)] },
    { id: id(11), title: '仅物件关联取得', objectIds: [id(21)] },
    { id: id(12), title: '无关取得', taskIds: [id(3)], objectIds: [id(22)] },
  ] }) });
}
const payload = () => ({ batchRef: '演练批次', quantity: 28, checkState: 'checked' as const,
  occurredAt: '2026-10-09T09:00:00+08:00', fromPartyName: '演练供方', toPartyName: '演练执行方',
  evidenceNote: '  原始点验说明\n保留原话  ',
  evidenceUrls: ['https://evidence.example/Z', 'https://evidence.example/a', 'https://evidence.example/ä'],
});
function sheet(seed: number, acquisitionId: string): MaterialCheckinSheet {
  return materialCheckinSheetSchema.parse({ id: id(seed), acquisitionId, unit: 'piece',
    acquisitionSnapshot: { title: `演练物料${seed}`, supplierName: '演练供方', specificationNote: '实物规格待核' },
    agreements: [
      { id: id(seed + 1), agreedQuantity: 30, basisNote: '原约定', recordedAt, recordedBy: '记录人 A' },
      { id: id(seed + 2), supersedesId: id(seed + 1), agreedQuantity: 28, basisNote: '演练约定更替', recordedAt, recordedBy: '记录人 B' },
    ], events: [
      { ...payload(), id: id(seed + 10), kind: 'receive', recordedAt, recordedBy: '演练点验人' },
      { id: id(seed + 11), kind: 'correction', targetId: id(seed + 10), reason: '演练更正原收货记录',
        replacement: { ...payload(), quantity: 26 }, recordedAt, recordedBy: '演练复核人' },
      { id: id(seed + 12), kind: 'void', targetId: id(seed + 11), reason: '演练作废错误收货链',
        evidenceNote: '保留原收货与更正记录', evidenceUrls: ['https://evidence.example/void-Z', 'https://evidence.example/void-a'], recordedAt, recordedBy: '演练复核人' },
      { ...payload(), id: id(seed + 13), kind: 'return', quantity: 26, recordedAt, recordedBy: '演练退还人' },
    ],
  });
}
function ledger(): MaterialCheckinLedger {
  return materialCheckinLedgerSchema.parse({ projectId, dataKind: 'rehearsal', sheets: [
    sheet(100, id(10)), sheet(200, id(10)), sheet(300, id(11)), sheet(400, id(12)),
  ] });
}
function basis(source = layout(), target = task(), facts = ledger()): Basis {
  const value = materialCheckinTaskBasis(source, target, facts);
  expect(value).not.toBeNull();
  return value as Basis;
}
function returned(value: MaterialCheckinSheet): Extract<MaterialCheckinEvent, { kind: 'return' }> {
  const event = value.events.find(event => event.kind === 'return');
  if (!event || event.kind !== 'return') throw new Error('Missing return fixture');
  return event;
}

describe('material checkin facts in an operation basis', () => {
  it('selects every sheet for an explicitly task-linked acquisition without requiring direct object links', () => {
    const value = basis(layout(), { id: id(2), objectIds: [] });
    expect(value.sheets.map(sheet => sheet.id)).toEqual([id(100), id(200)]);
    expect(value.sheets.every(sheet => sheet.acquisitionId === id(10))).toBe(true);
  });

  it('selects an acquisition by explicit object overlap alone, without borrowing unrelated task links', () => {
    const value = basis(layout(), { id: id(90), objectIds: [id(21)] });
    expect(value.sheets.map(sheet => sheet.id)).toEqual([id(300)]);
    expect(value.sheets[0].acquisitionId).toBe(id(11));
  });

  it.each(['no plan', 'unrelated acquisition', 'no related sheet', 'undefined ledger'] as const)('returns null for %s without inventing completion facts', kind => {
    const source = layout(), target = task(), facts = ledger();
    if (kind === 'no plan') delete source.productionPlan;
    if (kind === 'unrelated acquisition') { target.id = id(90); target.objectIds = []; }
    if (kind === 'no related sheet') facts.sheets = facts.sheets.filter(sheet => sheet.acquisitionId === id(12));
    expect(materialCheckinTaskBasis(source, target, kind === 'undefined ledger' ? undefined : facts)).toBeNull();
  });

  it.each([true, false])('rejects a cross-project ledger before checking whether a plan exists: %s', hasPlan => {
    const source = layout(), facts = ledger(); facts.projectId = 'another-project';
    if (!hasPlan) delete source.productionPlan;
    expect(() => materialCheckinTaskBasis(source, task(), facts)).toThrow('项目不一致');
  });

  it('rejects an idless layout with a local ledger, while an absent legacy ledger still yields null', () => {
    const source = layout(); delete source.id;
    const facts = ledger(); facts.projectId = 'local';
    expect(() => materialCheckinTaskBasis(source, task(), facts)).toThrow('项目不一致');
    delete source.productionPlan;
    expect(() => materialCheckinTaskBasis(source, task(), facts)).toThrow('项目不一致');
    expect(materialCheckinTaskBasis(source, task(), undefined)).toBeNull();
  });

  it('treats project identity as exact even when the string resembles a UUID', () => {
    const source = layout(); source.id = id(1).toUpperCase();
    const facts = ledger(); facts.projectId = id(1);
    expect(() => materialCheckinTaskBasis(source, task(), facts)).toThrow('项目不一致');
    facts.projectId = source.id;
    expect(basis(source, task(), facts).projectId).toBe(source.id);
  });

  it('retains complete related agreements, correction/void history and evidence without phase or stock calculations', () => {
    const value = basis();
    expect(Object.keys(value).sort()).toEqual(['dataKind', 'projectId', 'sheets']);
    expect(value.projectId).toBe(projectId); expect(value.dataKind).toBe('rehearsal');
    expect(value.sheets.map(sheet => sheet.id)).toEqual([id(100), id(200), id(300)]);
    const selected = value.sheets.find(sheet => sheet.id === id(100))!;
    expect(selected.agreements).toHaveLength(2);
    expect(selected.agreements.find(agreement => agreement.id === id(102))!.supersedesId).toBe(id(101));
    expect(selected.events.map(event => event.kind).sort()).toEqual(['correction', 'receive', 'return', 'void']);
    expect(selected.events.find(event => event.kind === 'correction')).toMatchObject({ targetId: id(110), replacement: { quantity: 26 } });
    expect(selected.events.find(event => event.kind === 'void')).toMatchObject({ targetId: id(111), evidenceNote: '保留原收货与更正记录' });
    expect(returned(selected).evidenceNote).toBe('  原始点验说明\n保留原话  ');
    expect(returned(selected).evidenceUrls).toEqual(['https://evidence.example/Z', 'https://evidence.example/a', 'https://evidence.example/ä']);
    for (const property of ['status', 'complete', 'receivedQuantity', 'notReceivedQuantity', 'effectiveEvents']) expect(value).not.toHaveProperty(property);
  });

  // Separate valid snapshots test basis invalidation, not permission to overwrite historical records.
  it.each(['quantity', 'check state', 'evidence', 'correction', 'void', 'agreement successor', 'data kind'] as const)('changes the basis for a related %s fact', change => {
    const source = layout(), target = task(), before = ledger(), next = structuredClone(before);
    const selected = next.sheets[0], event = returned(selected);
    if (change === 'quantity') event.quantity = 25;
    if (change === 'check state') event.checkState = 'disputed';
    if (change === 'evidence') { event.evidenceNote += '\n补充点验依据'; event.evidenceUrls.push('https://evidence.example/supplement'); }
    if (change === 'correction') selected.events.push({ id: id(114), kind: 'correction', targetId: event.id, reason: '后续更正退还数量',
      replacement: { ...payload(), quantity: 25 }, recordedAt, recordedBy: '后续复核人' });
    if (change === 'void') selected.events.push({ id: id(114), kind: 'void', targetId: event.id, reason: '后续作废错误退还记录',
      evidenceNote: '保留原始退还说明', evidenceUrls: [], recordedAt, recordedBy: '后续复核人' });
    if (change === 'agreement successor') selected.agreements.push({ id: id(103), supersedesId: id(102), agreedQuantity: 26,
      basisNote: '后续约定更替依据', recordedAt, recordedBy: '后续记录人' });
    if (change === 'data kind') next.dataKind = 'real';
    expect(materialCheckinLedgerSchema.safeParse(next).success).toBe(true);
    expect(canonical(materialCheckinTaskBasis(source, target, next))).not.toBe(canonical(materialCheckinTaskBasis(source, target, before)));
  });

  it('keeps unknown and explicit zero quantities distinct without treating either as a phase completion', () => {
    const unknown = ledger(), zero = structuredClone(unknown);
    returned(unknown.sheets[0]).checkState = 'pending'; returned(unknown.sheets[0]).quantity = null;
    returned(zero.sheets[0]).checkState = 'pending'; returned(zero.sheets[0]).quantity = 0;
    expect(materialCheckinLedgerSchema.safeParse(unknown).success).toBe(true);
    expect(materialCheckinLedgerSchema.safeParse(zero).success).toBe(true);
    expect(canonical(basis(layout(), task(), unknown))).not.toBe(canonical(basis(layout(), task(), zero)));
    expect(returned(basis(layout(), task(), unknown).sheets[0]).quantity).toBeNull();
    expect(returned(basis(layout(), task(), zero).sheets[0]).quantity).toBe(0);
  });

  it('ignores changes to an unrelated sheet including its source, quantity and later facts', () => {
    const before = ledger(), next = structuredClone(before), unrelated = next.sheets[3];
    unrelated.acquisitionSnapshot.title = '无关点验单改名'; returned(unrelated).quantity = 17;
    unrelated.events.push({ id: id(414), kind: 'void', targetId: id(413), reason: '无关记录作废', evidenceNote: '无关依据', evidenceUrls: [], recordedAt, recordedBy: '无关记录人' });
    expect(materialCheckinLedgerSchema.safeParse(next).success).toBe(true);
    expect(JSON.stringify(basis(layout(), task(), next))).toBe(JSON.stringify(basis(layout(), task(), before)));
  });

  it('ignores display order of sheets, agreements, events and every evidence URL list using stable codepoint ordering', () => {
    const original = ledger(), reordered = structuredClone(original);
    reordered.sheets.reverse();
    for (const sheet of reordered.sheets) {
      sheet.agreements.reverse(); sheet.events.reverse();
      for (const event of sheet.events) {
        if ('evidenceUrls' in event) event.evidenceUrls.reverse();
        if (event.kind === 'correction') event.replacement.evidenceUrls.reverse();
      }
    }
    const source = layout(), reorderedSource = structuredClone(source); reorderedSource.productionPlan!.acquisitions.reverse();
    expect(materialCheckinLedgerSchema.safeParse(reordered).success).toBe(true);
    const first = basis(source, task(), original), second = basis(reorderedSource, task(), reordered);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    for (const sheet of first.sheets) {
      expect(sheet.events.map(canonical)).toEqual(sheet.events.map(canonical).sort());
      expect(sheet.agreements.map(canonical)).toEqual(sheet.agreements.map(canonical).sort());
      expect(returned(sheet).evidenceUrls).toEqual([...returned(sheet).evidenceUrls].sort());
    }
    expect(first.sheets.map(canonical)).toEqual(first.sheets.map(canonical).sort());
  });

  it('normalizes the four UUID identity fields and UUID task/object references without changing source wording', () => {
    const source = layout(), facts = ledger(), uppercase = structuredClone(facts), upperSource = structuredClone(source);
    for (const row of upperSource.productionPlan!.acquisitions) { row.id = row.id.toUpperCase(); row.taskIds = row.taskIds.map(id => id.toUpperCase()); row.objectIds = row.objectIds.map(id => id.toUpperCase()); }
    for (const sheet of uppercase.sheets) {
      sheet.id = sheet.id.toUpperCase(); sheet.acquisitionId = sheet.acquisitionId.toUpperCase();
      for (const agreement of sheet.agreements) { agreement.id = agreement.id.toUpperCase(); if (agreement.supersedesId) agreement.supersedesId = agreement.supersedesId.toUpperCase(); }
      for (const event of sheet.events) { event.id = event.id.toUpperCase(); if ('targetId' in event) event.targetId = event.targetId.toUpperCase(); }
    }
    expect(materialCheckinLedgerSchema.safeParse(uppercase).success).toBe(true);
    const value = basis(upperSource, { id: id(2).toUpperCase(), objectIds: [id(21).toUpperCase()] }, uppercase);
    expect(JSON.stringify(value)).toBe(JSON.stringify(basis(source, task(), facts)));
    expect(value.sheets[0].agreements[0].recordedBy).toContain('记录人');
    expect(value.sheets[0].acquisitionSnapshot.specificationNote).toBe('实物规格待核');
  });

  it('does not match legacy object IDs by different casing or equal source descriptions', () => {
    const source = layout(); source.productionPlan!.acquisitions[1].objectIds = ['Legacy-Chair'];
    for (const reference of ['LEGACY-CHAIR', 'legacy-chair']) expect(materialCheckinTaskBasis(source, { id: id(90), objectIds: [reference] }, ledger())).toBeNull();
    expect(basis(source, { id: id(90), objectIds: ['Legacy-Chair'] }).sheets.map(sheet => sheet.id)).toEqual([id(300)]);
  });

  it('does not mutate inputs and detaches nested facts from later input changes', () => {
    const source = layout(), target = task(), facts = ledger();
    const before = JSON.stringify({ source, target, facts }), value = basis(source, target, facts), frozenText = JSON.stringify(value);
    expect(JSON.stringify({ source, target, facts })).toBe(before);
    const selected = value.sheets.find(sheet => sheet.id === id(100))!, original = facts.sheets[0];
    expect(selected).not.toBe(original); expect(selected.acquisitionSnapshot).not.toBe(original.acquisitionSnapshot);
    expect(selected.agreements).not.toBe(original.agreements); expect(selected.agreements[0]).not.toBe(original.agreements[0]);
    expect(returned(selected).evidenceUrls).not.toBe(returned(original).evidenceUrls);
    const replacement = selected.events.find(event => event.kind === 'correction')!;
    const originalReplacement = original.events.find(event => event.kind === 'correction')!;
    if (replacement.kind !== 'correction' || originalReplacement.kind !== 'correction') throw new Error('Missing correction fixture');
    expect(replacement.replacement).not.toBe(originalReplacement.replacement);
    expect(replacement.replacement.evidenceUrls).not.toBe(originalReplacement.replacement.evidenceUrls);
    facts.sheets[0].acquisitionSnapshot.title = '后改取得名称'; returned(facts.sheets[0]).evidenceUrls.push('https://evidence.example/later');
    originalReplacement.replacement.evidenceNote = '后改更正依据'; target.objectIds.push('后改关联');
    source.productionPlan!.acquisitions[0].title = '后改制作计划';
    expect(JSON.stringify(value)).toBe(frozenText);
  });

  it('still enforces the frozen shared ledger schema before returning a no-plan result or reading getters', () => {
    const source = layout(); delete source.productionPlan;
    const invalid = { ...ledger(), unexpected: 'not accepted' } as MaterialCheckinLedger;
    expect(materialCheckinLedgerSchema.safeParse(invalid).success).toBe(false);
    expect(() => materialCheckinTaskBasis(source, task(), invalid)).toThrow();
    const getter = vi.fn(() => projectId), executable = ledger();
    Object.defineProperty(executable, 'projectId', { enumerable: true, get: getter });
    expect(() => materialCheckinTaskBasis(source, task(), executable)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
