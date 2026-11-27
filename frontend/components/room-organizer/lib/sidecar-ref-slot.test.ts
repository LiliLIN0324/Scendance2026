import { describe, expect, it } from 'vitest';
import {
  OUTDOOR_LAST_PROJECT_KEY,
  createStarterOutdoorPlan,
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
  type KeyValueStorage,
} from './outdoor-project-store';
import { writeSidecarRefToPlan } from './sidecar-ref-slot';

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

const OPERATIONS_REF = '11111111-1111-4111-8111-111111111111';
const PLAN_REF = '22222222-2222-4222-8222-222222222222';

describe('writeSidecarRefToPlan（侧车记录 id 挂回 plan 正源）', () => {
  it('operations 记录 id 落到 plan.operationsRef，plan 记录 id 落到 plan.planRef', () => {
    const storage = memoryStorage();

    const ops = writeSidecarRefToPlan('p1', 'operations', OPERATIONS_REF, { storage, name: '湖滨夜集', now: '2026-11-27T01:00:00.000Z' });
    expect(ops.ok).toBe(true);
    const opsRecord = readOutdoorProjectRecord('p1', storage);
    expect(opsRecord?.plan?.operationsRef).toBe(OPERATIONS_REF);
    expect(opsRecord?.plan?.planRef).toBeUndefined();

    const plan = writeSidecarRefToPlan('p2', 'plan', PLAN_REF, { storage, now: '2026-11-27T01:01:00.000Z' });
    expect(plan.ok).toBe(true);
    const planRecord = readOutdoorProjectRecord('p2', storage);
    expect(planRecord?.plan?.planRef).toBe(PLAN_REF);
    expect(planRecord?.plan?.operationsRef).toBeUndefined();
  });

  it('已有记录只改对应 ref，其它规划字段 / 名字 / 创建时间原样保留', () => {
    const storage = memoryStorage();
    const plan = {
      ...createStarterOutdoorPlan(),
      boundary: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    };
    saveOutdoorProjectRecord({
      v: 1, projectId: 'p1', name: '老项目', createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z', plan,
    }, storage, false);

    const result = writeSidecarRefToPlan('p1', 'plan', PLAN_REF, { storage, now: '2026-11-27T02:00:00.000Z' });
    expect(result.ok).toBe(true);
    const record = readOutdoorProjectRecord('p1', storage);
    expect(record?.name).toBe('老项目');
    expect(record?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(record?.updatedAt).toBe('2026-11-27T02:00:00.000Z');
    expect(record?.plan?.boundary).toEqual(plan.boundary);
    expect(record?.plan?.planRef).toBe(PLAN_REF);
  });

  it('没有 projectId 或空 recordId 都不写，不造无主记录 / 悬空指针', () => {
    const storage = memoryStorage();
    expect(writeSidecarRefToPlan('', 'operations', OPERATIONS_REF, { storage })).toEqual({ ok: false, reason: 'no-project' });
    expect(writeSidecarRefToPlan(null, 'operations', OPERATIONS_REF, { storage })).toEqual({ ok: false, reason: 'no-project' });
    expect(writeSidecarRefToPlan('p1', 'operations', '  ', { storage })).toEqual({ ok: false, reason: 'no-project' });
    expect(storage.getItem(OUTDOOR_LAST_PROJECT_KEY)).toBeNull();
  });

  it('ref 回写不抢「最近项目」指针，也不串到别的项目', () => {
    const storage = memoryStorage();
    writeSidecarRefToPlan('p3', 'operations', OPERATIONS_REF, { storage });
    expect(storage.getItem(OUTDOOR_LAST_PROJECT_KEY)).toBeNull();
    expect(readOutdoorProjectRecord('p4', storage)).toBeNull();
  });
});
