import { describe, expect, it } from 'vitest';
import {
  OUTDOOR_LAST_PROJECT_KEY,
  createStarterOutdoorPlan,
  outdoorPlanStorageKey,
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
} from './outdoor-project-store';
import { readPlanGround, writeGroundToPlan } from './venue-ground-slot';
import type { KeyValueStorage } from './outdoor-project-store';

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

const GROUND = {
  image: 'data:image/png;base64,AAAA',
  opacity: 0.78,
  satelliteRef: true,
  polygon: [
    { lng: 121.473542418, lat: 31.2303096 },
    { lng: 121.473857582, lat: 31.2303096 },
    { lng: 121.473857582, lat: 31.2304904 },
  ],
  center: { lng: 121.4737, lat: 31.2304 },
  source: 'amap-satellite' as const,
};

describe('writeGroundToPlan（venue 项目复用户外记录，只写 ground）', () => {
  it('没有记录就建一份 starter plan，只挂 ground，不抢最近项目指针', () => {
    const storage = memoryStorage();
    const result = writeGroundToPlan('venue-new', GROUND, { storage, name: '湖滨广场', now: '2026-11-25T05:00:00.000Z' });

    expect(result.ok).toBe(true);
    const record = readOutdoorProjectRecord('venue-new', storage);
    expect(record?.name).toBe('湖滨广场');
    expect(record?.plan?.ground).toEqual(GROUND);
    expect(record?.plan?.boundary).toEqual([]);
    expect(record?.plan?.zones).toEqual([]);
    expect(storage.getItem(OUTDOOR_LAST_PROJECT_KEY)).toBeNull();
  });

  it('已有记录只改 ground，其它规划字段与名字、创建时间原样保留', () => {
    const storage = memoryStorage();
    const plan = {
      ...createStarterOutdoorPlan(),
      boundary: [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ],
    };
    saveOutdoorProjectRecord({
      v: 1, projectId: 'p1', name: '老项目', createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z', plan,
    }, storage, false);

    const result = writeGroundToPlan('p1', GROUND, { storage, now: '2026-11-25T05:00:00.000Z' });
    expect(result.ok).toBe(true);
    const record = readOutdoorProjectRecord('p1', storage);
    expect(record?.name).toBe('老项目');
    expect(record?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(record?.updatedAt).toBe('2026-11-25T05:00:00.000Z');
    expect(record?.plan?.boundary).toEqual(plan.boundary);
    expect(record?.plan?.ground).toEqual(GROUND);
  });

  it('没有 projectId 就不写：不造无主记录', () => {
    const storage = memoryStorage();
    expect(writeGroundToPlan('', GROUND, { storage })).toEqual({ ok: false, reason: 'no-project' });
    expect(writeGroundToPlan(null, GROUND, { storage })).toEqual({ ok: false, reason: 'no-project' });
    expect(storage.getItem(OUTDOOR_LAST_PROJECT_KEY)).toBeNull();
  });

  it('坏 ground 直接抛错，不当成「暂时写不进去」静默吞掉', () => {
    const storage = memoryStorage();
    const bad = { ...GROUND, polygon: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }] };
    expect(() => writeGroundToPlan('p2', bad as typeof GROUND, { storage })).toThrow();
    expect(storage.getItem(outdoorPlanStorageKey('p2'))).toBeNull();
  });

  it('readPlanGround 读回刚写的那份，别的项目读不到', () => {
    const storage = memoryStorage();
    writeGroundToPlan('p3', GROUND, { storage });
    expect(readPlanGround('p3', storage)?.polygon).toHaveLength(3);
    expect(readPlanGround('p4', storage)).toBeNull();
    expect(readPlanGround('', storage)).toBeNull();
  });
});
