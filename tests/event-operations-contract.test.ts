import { describe, expect, it, vi } from 'vitest';
import {
  eventOperationPhases, eventOperationTaskSchema, eventOperationsLimits, eventOperationsSchema,
} from '../supabase/functions/_shared/event-operations-contract.ts';
import { handoffLimits, handoffSchema } from '../supabase/functions/_shared/delivery-contract.ts';

const basis = 'sha256:' + 'a'.repeat(64);
const draft = () => ({ id: crypto.randomUUID(), title: '签到准备', phase: 'preparation' as const });
const accepted = () => ({ ...draft(), status: 'accepted', ownerName: '执行组', acceptance: '核对签到表与到场安排', evidenceNote: '现场已核对', reviewedBasis: basis });

describe('local event operations contract', () => {
  it('defaults to unspecified data and empty tasks, without inventing an activity', () => {
    expect(eventOperationsSchema.parse({})).toEqual({ schemaVersion: 1, dataKind: 'unspecified', tasks: [] });
    expect(eventOperationsSchema.parse({ dataKind: 'rehearsal' }).dataKind).toBe('rehearsal');
    expect(eventOperationsSchema.parse({ dataKind: 'real' }).dataKind).toBe('real');
  });

  it('creates an unassigned task with no invented time, evidence, materials or reviewed basis', () => {
    const input = draft();
    const first = eventOperationTaskSchema.parse(input);
    const second = eventOperationTaskSchema.parse(input);
    expect(first).toEqual({
      ...input, plannedStartAt: null, plannedEndAt: null, ownerName: '', contractorName: '', acceptance: '',
      status: 'todo', objectIds: [], actualStartedAt: null, actualFinishedAt: null, evidenceNote: '', evidenceUrls: [],
    });
    expect(first).not.toHaveProperty('reviewedBasis');
    first.objectIds.push('legacy-chair');
    first.evidenceUrls.push('https://example.test/photo');
    expect(second.objectIds).toEqual([]);
    expect(second.evidenceUrls).toEqual([]);
  });

  it.each(eventOperationPhases)('supports phase %s independently from progress', phase => {
    expect(eventOperationTaskSchema.parse({ ...draft(), phase, status: 'doing' }).phase).toBe(phase);
  });

  it('does not invent a task ID, title or phase', () => {
    for (const field of ['id', 'title', 'phase'] as const) {
      const input: Record<string, unknown> = draft();
      delete input[field];
      expect(eventOperationTaskSchema.safeParse(input).success).toBe(false);
    }
    expect(eventOperationTaskSchema.safeParse({ ...draft(), id: 'not-a-uuid' }).success).toBe(false);
    expect(eventOperationTaskSchema.safeParse({ ...draft(), phase: 'doing' }).success).toBe(false);
    expect(eventOperationTaskSchema.safeParse({ ...draft(), status: 'setup' }).success).toBe(false);
  });

  it.each(['todo', 'doing', 'review', 'accepted'])('requires a nonblank title in %s', status => {
    for (const title of ['', ' \t\n ']) expect(eventOperationTaskSchema.safeParse({ ...accepted(), status, title }).success).toBe(false);
  });

  it.each(['todo', 'doing'])('keeps incomplete %s tasks editable', status => {
    expect(eventOperationTaskSchema.parse({ ...draft(), status })).toMatchObject({
      status, ownerName: '', acceptance: '', plannedStartAt: null, plannedEndAt: null,
    });
  });

  it.each(['review', 'accepted'])('requires an owner and a condition for %s', status => {
    for (const field of ['ownerName', 'acceptance']) {
      const result = eventOperationTaskSchema.safeParse({ ...accepted(), status, contractorName: '承接团队', [field]: ' \n ' });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(issue => issue.path[0] === field)).toBe(true);
    }
  });

  it('permits review without completion evidence, and completion with unknown actual times', () => {
    expect(eventOperationTaskSchema.safeParse({ ...draft(), status: 'review', ownerName: '执行组', acceptance: '主持流程已核对' }).success).toBe(true);
    expect(eventOperationTaskSchema.parse(accepted())).toMatchObject({
      status: 'accepted', plannedStartAt: null, plannedEndAt: null, actualStartedAt: null, actualFinishedAt: null,
    });
  });

  it('requires a completion note even when a photo link exists, without changing handoff rules', () => {
    expect(eventOperationTaskSchema.safeParse({ ...accepted(), evidenceNote: ' ', evidenceUrls: ['https://example.test/photo'] }).success).toBe(false);
    expect(handoffSchema.safeParse({
      ownerName: '执行组', dueDate: '2026-10-07', acceptance: '核对尺寸', status: 'accepted',
      evidenceUrls: ['https://example.test/photo'], reviewedBasis: basis,
    }).success).toBe(true);
  });

  it.each([undefined, '', 'plain text', 'a'.repeat(64), 'sha256:' + 'a'.repeat(63), 'sha256:' + 'a'.repeat(65), 'sha256:' + 'A'.repeat(64), 'sha256:' + 'g'.repeat(64)])
    ('rejects missing or noncanonical completion basis %s', reviewedBasis => {
      expect(eventOperationTaskSchema.safeParse({ ...accepted(), reviewedBasis }).success).toBe(false);
    });

  it.each([
    '0001-01-01T00:00:00Z', '2000-02-29T09:30:00+08:00', '2024-02-29T00:00:00Z',
    '2026-10-07T09:30:00Z', '2026-10-07T09:30:00.1Z', '2026-10-07T09:30:00.12Z',
    '2026-10-07T09:30:00.123+08:00', '2026-10-07T09:30:00-05:30',
  ])('accepts true zoned timestamp %s and preserves its offset', plannedStartAt => {
    expect(eventOperationTaskSchema.parse({ ...draft(), plannedStartAt }).plannedStartAt).toBe(plannedStartAt);
  });

  it.each([
    '0000-01-01T00:00:00Z', '1900-02-29T09:30:00Z', '2026-02-29T09:30:00Z', '2026-02-30T09:30:00Z',
    '2026-04-31T09:30:00Z', '2026-13-01T09:30:00Z', '2026-10-07T24:00:00Z', '2026-10-07T09:60:00Z',
    '2026-10-07T09:30:60Z', '2026-10-07T09:30:00', '2026-10-07T09:30Z', '2026-10-07T09:30:00-00:00',
    '2026-10-07T09:30:00+24:00', '2026-10-07T09:30:00+08:60', '2026-10-07T09:30:00.1234Z',
    '2026/10/07 09:30:00+08:00', '', 'not-a-date',
  ])('rejects false, unknown-offset or underspecified time %s in every time field', time => {
    for (const field of ['plannedStartAt', 'plannedEndAt', 'actualStartedAt', 'actualFinishedAt']) {
      expect(eventOperationTaskSchema.safeParse({ ...draft(), [field]: time }).success).toBe(false);
    }
  });

  it.each([
    ['2026-10-07T23:30:00+08:00', '2026-10-08T00:30:00+08:00'],
    ['2026-10-07T09:30:00+08:00', '2026-10-07T02:00:00Z'],
    ['2026-10-07T09:30:00.1+08:00', '2026-10-07T01:30:00.100Z'],
  ])('allows forward or equal real instants across midnight and offsets', (start, end) => {
    expect(eventOperationTaskSchema.safeParse({ ...draft(), plannedStartAt: start, plannedEndAt: end, actualStartedAt: start, actualFinishedAt: end }).success).toBe(true);
  });

  it.each([
    ['2026-10-07T09:30:00+08:00', '2026-10-07T09:29:59+08:00'],
    ['2026-10-07T09:30:00+08:00', '2026-10-07T10:00:00+09:00'],
    ['2026-10-07T09:30:00.123Z', '2026-10-07T09:30:00.122Z'],
  ])('rejects backwards planned and actual instants', (start, end) => {
    for (const [startKey, endKey] of [['plannedStartAt', 'plannedEndAt'], ['actualStartedAt', 'actualFinishedAt']]) {
      const result = eventOperationTaskSchema.safeParse({ ...draft(), [startKey]: start, [endKey]: end });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(issue => issue.path[0] === endKey)).toBe(true);
    }
  });

  it('keeps plan and actual separate and allows an actual delay or incomplete timing', () => {
    const task = eventOperationTaskSchema.parse({
      ...accepted(), plannedStartAt: '2026-10-07T09:00:00+08:00', plannedEndAt: '2026-10-07T10:00:00+08:00',
      actualStartedAt: '2026-10-07T09:15:00+08:00', actualFinishedAt: '2026-10-07T11:00:00+08:00',
    });
    const changed = eventOperationTaskSchema.parse({ ...task, plannedEndAt: '2026-10-07T10:30:00+08:00' });
    expect(changed.actualStartedAt).toBe(task.actualStartedAt);
    expect(changed.actualFinishedAt).toBe(task.actualFinishedAt);
    expect(eventOperationTaskSchema.parse({ ...draft(), plannedEndAt: task.plannedEndAt }).plannedStartAt).toBeNull();
    expect(eventOperationTaskSchema.parse({ ...draft(), plannedStartAt: task.plannedStartAt }).actualStartedAt).toBeNull();
  });

  it('allows no-material work and multiple tasks for the same existing instance', () => {
    const tasks = [
      { ...draft(), title: '主持流程', phase: 'event' },
      { ...draft(), phase: 'setup', objectIds: ['chair-1', ' legacy ID '] },
      { ...draft(), phase: 'teardown', objectIds: ['chair-1'] },
    ];
    expect(eventOperationsSchema.parse({ tasks }).tasks.map(task => task.objectIds)).toEqual([[], ['chair-1', ' legacy ID '], ['chair-1']]);
  });

  it('does not discard a referenced ID without layout context, but rejects duplicate and blank IDs', () => {
    expect(eventOperationTaskSchema.parse({ ...draft(), objectIds: ['temporarily-missing'] }).objectIds).toEqual(['temporarily-missing']);
    for (const objectIds of [['chair-1', 'chair-1'], [''], [' \t ']]) expect(eventOperationTaskSchema.safeParse({ ...draft(), objectIds }).success).toBe(false);
    const task = draft();
    expect(eventOperationsSchema.safeParse({ tasks: [task, task] }).success).toBe(false);
  });

  it('rejects case-equivalent task UUIDs without rewriting stored IDs', () => {
    const id = 'abcdef00-0000-4000-8000-000000000001';
    const upper = id.toUpperCase();
    expect(eventOperationTaskSchema.parse({ ...draft(), id: upper }).id).toBe(upper);
    expect(eventOperationsSchema.safeParse({ tasks: [{ ...draft(), id }, { ...draft(), id: upper }] }).success).toBe(false);
  });

  it('rejects unknown fields and false types at both document and task levels', () => {
    for (const input of [{ schemaVersion: 2 }, { dataKind: 'confirmed' }, { tasks: 'not-an-array' }, { revision: 1 }, { brief: {} }]) {
      expect(eventOperationsSchema.safeParse(input).success).toBe(false);
    }
    for (const change of [{ actor: 'untrusted' }, { ownerName: 42 }, { plannedStartAt: 20261007 }, { reviewedBasis: {} }, { objectIds: [42] }, { evidenceUrls: 'https://example.test' }]) {
      expect(eventOperationTaskSchema.safeParse({ ...draft(), ...change }).success).toBe(false);
    }
  });

  it('reuses evidence URL limits and safe HTTP rules without accessing links', () => {
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      const urls = Array.from({ length: handoffLimits.evidenceUrls }, (_, i) => `http://example.test/photo/${i}?signature=a%2Bb`);
      expect(eventOperationTaskSchema.parse({ ...draft(), evidenceUrls: urls }).evidenceUrls).toEqual(urls);
      for (const evidenceUrls of [
        [...urls, 'https://example.test/extra'], [urls[0], ` ${urls[0]} `], ['javascript:alert(1)'],
        ['blob:https://example.test/photo'], ['https://user:secret@example.test/photo'], ['//example.test/photo'],
        ['https://example.test/' + 'a'.repeat(handoffLimits.evidenceUrl)],
      ]) expect(eventOperationTaskSchema.safeParse({ ...draft(), evidenceUrls }).success).toBe(false);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it.each(['title', 'ownerName', 'contractorName', 'acceptance', 'evidenceNote'] as const)('bounds %s without truncating it', field => {
    const text = '甲'.repeat(eventOperationsLimits[field]);
    expect(eventOperationTaskSchema.parse({ ...draft(), [field]: text })[field]).toBe(text);
    expect(eventOperationTaskSchema.safeParse({ ...draft(), [field]: text + '甲' }).success).toBe(false);
  });

  it('bounds tasks and object references while retaining valid records', () => {
    const tasks = Array.from({ length: eventOperationsLimits.tasks }, () => draft());
    expect(eventOperationsSchema.parse({ tasks }).tasks).toHaveLength(500);
    expect(eventOperationsSchema.safeParse({ tasks: [...tasks, draft()] }).success).toBe(false);
    const objectIds = Array.from({ length: eventOperationsLimits.objectIds }, (_, i) => `item-${i}`);
    expect(eventOperationTaskSchema.parse({ ...draft(), objectIds }).objectIds).toHaveLength(500);
    expect(eventOperationTaskSchema.safeParse({ ...draft(), objectIds: [...objectIds, 'extra'] }).success).toBe(false);
    const longestId = 'x'.repeat(128);
    expect(eventOperationTaskSchema.parse({ ...draft(), objectIds: [longestId] }).objectIds).toEqual([longestId]);
    expect(eventOperationTaskSchema.safeParse({ ...draft(), objectIds: ['x'.repeat(eventOperationsLimits.objectId + 1)] }).success).toBe(false);
  });
});
