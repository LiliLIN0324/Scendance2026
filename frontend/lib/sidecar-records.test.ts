import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventOperationsSchema, type EventOperations } from '../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema, type ProductionPlan } from '../../supabase/functions/_shared/production-plan-contract';
import { listSourceRecords, readSourceRecord, updateSourceForm } from './source-storage';
import {
  listSidecarRecords,
  readSidecarRecord,
  resolveBackupSidecar,
  resolveSidecarRef,
  saveSidecarRecord,
  type SidecarRecord,
} from './sidecar-records';

vi.mock('./source-storage', () => ({
  readSourceRecord: vi.fn(),
  updateSourceForm: vi.fn(),
  listSourceRecords: vi.fn(),
}));

const records = new Map<string, unknown>();
const projectId = 'house-sidecar-rehearsal';
const otherProject = 'house-sidecar-other';

function ops(): EventOperations {
  return eventOperationsSchema.parse({ tasks: [{ id: crypto.randomUUID(), title: '签到布置', phase: 'setup' }] });
}
function plan(): ProductionPlan {
  return productionPlanSchema.parse({});
}

beforeEach(() => {
  records.clear();
  vi.clearAllMocks();
  vi.mocked(readSourceRecord).mockImplementation(async key => structuredClone(records.get(JSON.stringify(key))) as never);
  vi.mocked(updateSourceForm).mockImplementation(async (key, update) => {
    const address = JSON.stringify(key);
    const next = update(structuredClone(records.get(address)));
    if (next === undefined) records.delete(address); else records.set(address, structuredClone(next));
    return structuredClone(next) as never;
  });
  vi.mocked(listSourceRecords).mockImplementation(async namespace => {
    const out: { key: [string, string]; value: unknown }[] = [];
    for (const [address, value] of records) {
      try {
        const parsed = JSON.parse(address) as [string, string];
        if (Array.isArray(parsed) && parsed[0] === namespace) out.push({ key: parsed, value: structuredClone(value) });
      } catch { /* ignore non-form keys */ }
    }
    return out;
  });
});

afterEach(() => vi.unstubAllGlobals());

function envelope(partial: Partial<SidecarRecord> & { id: string; kind: SidecarRecord['kind']; savedAt: string }): SidecarRecord {
  return {
    projectId,
    data: partial.kind === 'plan' ? plan() : ops(),
    ...partial,
  };
}

describe('sidecar record save / read', () => {
  it('saves a uuid record and reads data back field-by-field', async () => {
    const saved = await saveSidecarRecord(projectId, 'operations', ops());
    expect(saved.recordId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const read = await readSidecarRecord(projectId, 'operations', saved.recordId);
    expect(read?.kind).toBe('operations');
    expect(read?.projectId).toBe(projectId);
    expect(read?.data).toEqual(saved.record.data);
    expect(read?.savedAt).toBe(saved.record.savedAt);
  });

  it('refuses cross-project read: foreign record stays isolated, never joined or bridged', async () => {
    const saved = await saveSidecarRecord(projectId, 'plan', plan());
    expect(await readSidecarRecord(otherProject, 'plan', saved.recordId)).toBeUndefined();
    const resolved = await resolveSidecarRef({ projectId: otherProject, kind: 'plan', refId: saved.recordId, legacyFallback: plan() });
    expect(resolved.status).toBe('missing');
  });

  it('does not write a record when contract validation fails', async () => {
    await expect(saveSidecarRecord(projectId, 'operations', { tasks: 'not-an-array' } as never)).rejects.toThrow('无效');
    expect(updateSourceForm).not.toHaveBeenCalled();
    expect(records.size).toBe(0);
  });

  it('keeps multiple records in the same project independent, no overwrite', async () => {
    const first = await saveSidecarRecord(projectId, 'operations', ops());
    const second = await saveSidecarRecord(projectId, 'operations', ops());
    expect(first.recordId).not.toBe(second.recordId);
    expect((await readSidecarRecord(projectId, 'operations', first.recordId))?.data).toEqual(first.record.data);
    expect((await readSidecarRecord(projectId, 'operations', second.recordId))?.data).toEqual(second.record.data);
  });

  it('throws on a damaged envelope instead of swallowing it', async () => {
    const id = crypto.randomUUID();
    records.set(JSON.stringify(['event-operations-record', id]), { broken: true });
    await expect(readSidecarRecord(projectId, 'operations', id)).rejects.toThrow();
  });
});

describe('sidecar list', () => {
  it('filters by projectId + kind and sorts by savedAt descending', async () => {
    const oldId = crypto.randomUUID();
    const newId = crypto.randomUUID();
    const foreignId = crypto.randomUUID();
    const planOneId = crypto.randomUUID();
    records.set(JSON.stringify(['event-operations-record', oldId]), envelope({ id: oldId, kind: 'operations', savedAt: '2026-11-20T01:00:00.000Z' }));
    records.set(JSON.stringify(['event-operations-record', newId]), envelope({ id: newId, kind: 'operations', savedAt: '2026-11-27T01:00:00.000Z' }));
    records.set(JSON.stringify(['event-operations-record', foreignId]), envelope({ id: foreignId, kind: 'operations', projectId: otherProject, savedAt: '2026-11-28T01:00:00.000Z' }));
    records.set(JSON.stringify(['production-plan-record', planOneId]), envelope({ id: planOneId, kind: 'plan', savedAt: '2026-11-26T01:00:00.000Z' }));

    const opsList = await listSidecarRecords(projectId, 'operations');
    expect(opsList.map(r => r.id)).toEqual([newId, oldId]);
    const planList = await listSidecarRecords(projectId, 'plan');
    expect(planList.map(r => r.id)).toEqual([planOneId]);
  });
});

describe('sidecar resolve', () => {
  it('record hit returns the independent record data', async () => {
    const saved = await saveSidecarRecord(projectId, 'operations', ops());
    const legacy = ops();
    const result = await resolveSidecarRef({ projectId, kind: 'operations', refId: saved.recordId, legacyFallback: legacy });
    expect(result.status).toBe('record');
    if (result.status === 'record') expect(result.data).toEqual(saved.record.data);
  });

  it('blank ref falls back to the legacy bundled field without creating a pointer', async () => {
    const legacy = plan();
    const empty = await resolveSidecarRef({ projectId, kind: 'plan', refId: '', legacyFallback: legacy });
    expect(empty.status).toBe('fallback-legacy');
    if (empty.status === 'fallback-legacy') expect(empty.data).toBe(legacy);
    const undef = await resolveSidecarRef({ projectId, kind: 'plan', refId: undefined, legacyFallback: undefined });
    expect(undef).toEqual({ status: 'fallback-legacy', data: undefined });
    expect(updateSourceForm).not.toHaveBeenCalled();
  });

  it('ref pointing to a missing record resolves missing, never replaced by the latest record', async () => {
    await saveSidecarRecord(projectId, 'operations', ops());
    const result = await resolveSidecarRef({ projectId, kind: 'operations', refId: crypto.randomUUID(), legacyFallback: ops() });
    expect(result.status).toBe('missing');
  });

  it('ref belonging to another project resolves missing', async () => {
    const saved = await saveSidecarRecord(projectId, 'plan', plan());
    const result = await resolveSidecarRef({ projectId: otherProject, kind: 'plan', refId: saved.recordId, legacyFallback: plan() });
    expect(result.status).toBe('missing');
  });
});

describe('backup sidecar dual-read fallback (D6-4-2)', () => {
  const refId = crypto.randomUUID();
  const local = envelope({ id: refId, kind: 'operations', savedAt: '2026-11-20T01:00:00.000Z' });
  const packet = envelope({ id: refId, kind: 'operations', savedAt: '2026-11-19T01:00:00.000Z' });

  it('blank ref falls back to the legacy bundled field', () => {
    const legacy = ops();
    const result = resolveBackupSidecar({ projectId, kind: 'operations', refId: '', localRecord: undefined, packetRecord: undefined, legacyFallback: legacy });
    expect(result.status).toBe('fallback-legacy');
    if (result.status === 'fallback-legacy') expect(result.data).toBe(legacy);
  });

  it('prefers the local IDB record when it matches the ref', () => {
    const result = resolveBackupSidecar({ projectId, kind: 'operations', refId, localRecord: local, packetRecord: packet, legacyFallback: undefined });
    expect(result.status).toBe('record');
    if (result.status === 'record') expect(result.record).toBe(local);
  });

  it('falls back to the frozen packet copy when the local record is absent', () => {
    const result = resolveBackupSidecar({ projectId, kind: 'operations', refId, localRecord: undefined, packetRecord: packet, legacyFallback: undefined });
    expect(result.status).toBe('record');
    if (result.status === 'record') expect(result.record).toBe(packet);
  });

  it('resolves missing when neither source matches, never substituting the latest record', () => {
    const result = resolveBackupSidecar({ projectId, kind: 'operations', refId, localRecord: undefined, packetRecord: undefined, legacyFallback: ops() });
    expect(result.status).toBe('missing');
  });

  it('drops a foreign-project packet copy instead of merging it', () => {
    const foreign = envelope({ id: refId, kind: 'operations', projectId: otherProject, savedAt: '2026-11-19T01:00:00.000Z' });
    const result = resolveBackupSidecar({ projectId, kind: 'operations', refId, localRecord: undefined, packetRecord: foreign, legacyFallback: undefined });
    expect(result.status).toBe('missing');
  });

  it('ignores a local record under a different id and uses only the matching packet copy', () => {
    const other = envelope({ id: crypto.randomUUID(), kind: 'operations', savedAt: '2026-11-21T01:00:00.000Z' });
    const result = resolveBackupSidecar({ projectId, kind: 'operations', refId, localRecord: other, packetRecord: packet, legacyFallback: undefined });
    expect(result.status).toBe('record');
    if (result.status === 'record') expect(result.record).toBe(packet);
  });
});
