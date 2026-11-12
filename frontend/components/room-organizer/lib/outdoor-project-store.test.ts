import { describe, expect, it } from 'vitest';
import {
  clearOutdoorProjectRecord,
  createStarterOutdoorPlan,
  DEFAULT_OUTDOOR_PLAN_ANCHOR,
  hasOutdoorPlanDraft,
  latestOutdoorProjectId,
  OUTDOOR_LAST_PROJECT_KEY,
  outdoorPlanStorageKey,
  outdoorPlanViewStorageKey,
  readOutdoorPlanView,
  readOutdoorProjectRecord,
  renameOutdoorProject,
  resolveOutdoorProjectId,
  saveOutdoorPlanView,
  saveOutdoorProjectRecord,
  type KeyValueStorage,
  type OutdoorProjectRecord,
} from './outdoor-project-store';
import { sitePlanDataSchema, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** node 环境的 Map 版 localStorage mock（够 KeyValueStorage 三个方法）。 */
function memoryStorage(): KeyValueStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    dump: () => Object.fromEntries(map.entries()),
  };
}

const PID = '10000000-0000-4000-8000-000000000001';

function samplePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: { lng: 120.1443, lat: 30.2459, crs: 'gcj-02', source: 'picker' },
    boundary: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
  };
}

function record(plan: SitePlanData | null, overrides: Partial<Omit<OutdoorProjectRecord, 'v' | 'projectId' | 'plan'>> = {}): OutdoorProjectRecord {
  return {
    v: 1,
    projectId: PID,
    name: '西湖市集',
    createdAt: '2026-11-10T07:00:00.000Z',
    updatedAt: '2026-11-10T07:30:00.000Z',
    plan,
    ...overrides,
  };
}

describe('outdoor-project-store', () => {
  it('key 按项目隔离且前缀稳定', () => {
    expect(outdoorPlanStorageKey(PID)).toBe('scendance-outdoor-plan-v1:10000000-0000-4000-8000-000000000001');
    expect(outdoorPlanStorageKey('20000000-0000-4000-8000-000000000002'))
      .not.toBe(outdoorPlanStorageKey(PID));
  });

  it('save/read 往返：plan 严格校验后原样读回', () => {
    const storage = memoryStorage();
    const plan = samplePlan();
    saveOutdoorProjectRecord(record(plan), storage);
    const loaded = readOutdoorProjectRecord(PID, storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('西湖市集');
    expect(loaded!.createdAt).toBe('2026-11-10T07:00:00.000Z');
    expect(loaded!.plan).toEqual(plan);
    expect(hasOutdoorPlanDraft(PID, storage)).toBe(true);
  });

  it('meta 有效但 plan 坏：记录仍在（判定不丢），plan 宽容回落 null', () => {
    const storage = memoryStorage();
    // 「坏」用真不合法的构造（相邻重复顶点，superRefine 拒）；boundary: [] 自 2026-11-11 起是合法起步。
    const bad = record({ ...samplePlan(), boundary: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }] } as unknown as SitePlanData);
    storage.setItem(outdoorPlanStorageKey(PID), JSON.stringify(bad));
    const loaded = readOutdoorProjectRecord(PID, storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.plan).toBeNull();
    expect(hasOutdoorPlanDraft(PID, storage)).toBe(true);
  });

  it('JSON 坏/信封不符/字段缺失：读回 null，不抛错', () => {
    const storage = memoryStorage();
    storage.setItem(outdoorPlanStorageKey(PID), '{not json');
    expect(readOutdoorProjectRecord(PID, storage)).toBeNull();
    storage.setItem(outdoorPlanStorageKey(PID), JSON.stringify({ v: 2, projectId: PID, name: 'x', createdAt: '', updatedAt: '', plan: null }));
    expect(readOutdoorProjectRecord(PID, storage)).toBeNull();
    storage.setItem(outdoorPlanStorageKey(PID), JSON.stringify({ v: 1, projectId: '别的项目', name: 'x', createdAt: '', updatedAt: '', plan: null }));
    expect(readOutdoorProjectRecord(PID, storage)).toBeNull();
    expect(hasOutdoorPlanDraft(PID, storage)).toBe(false);
  });

  it('plan 不合法（相邻重复顶点）写入被拒', () => {
    const storage = memoryStorage();
    const plan = samplePlan();
    const bad = { ...plan, boundary: [...plan.boundary, plan.boundary[plan.boundary.length - 1]] } as SitePlanData;
    expect(() => saveOutdoorProjectRecord(record(bad), storage)).toThrow();
    expect(hasOutdoorPlanDraft(PID, storage)).toBe(false);
  });

  it('无存储环境（SSR/隐私模式）：读写静默降级不抛错', () => {
    expect(readOutdoorProjectRecord(PID, null)).toBeNull();
    expect(() => saveOutdoorProjectRecord(record(null), null)).not.toThrow();
    expect(() => renameOutdoorProject(PID, 'x', null)).not.toThrow();
    expect(() => clearOutdoorProjectRecord(PID, null)).not.toThrow();
  });

  it('rename 只改名字，createdAt/plan 保留', () => {
    const storage = memoryStorage();
    const plan = samplePlan();
    saveOutdoorProjectRecord(record(plan), storage);
    renameOutdoorProject(PID, '盐官潮乐之城', storage);
    const loaded = readOutdoorProjectRecord(PID, storage)!;
    expect(loaded.name).toBe('盐官潮乐之城');
    expect(loaded.createdAt).toBe('2026-11-10T07:00:00.000Z');
    expect(loaded.plan).toEqual(plan);
    expect(loaded.updatedAt).not.toBe('2026-11-10T07:30:00.000Z');
  });

  it('rename 对不存在的记录不无中生有', () => {
    const storage = memoryStorage();
    renameOutdoorProject(PID, 'x', storage);
    expect(Object.keys(storage.dump())).toHaveLength(0);
  });

  it('clear 删除后判定回落 false', () => {
    const storage = memoryStorage();
    saveOutdoorProjectRecord(record(null), storage);
    expect(hasOutdoorPlanDraft(PID, storage)).toBe(true);
    clearOutdoorProjectRecord(PID, storage);
    expect(hasOutdoorPlanDraft(PID, storage)).toBe(false);
  });

  describe('resolveOutdoorProjectId（workspace-shell 分支判定）', () => {
    it('?start=outdoor 直接命中，不看本机草稿', () => {
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&start=outdoor`, memoryStorage())).toBe(PID);
    });

    it('plain ?project=：本机有户外草稿才命中', () => {
      const storage = memoryStorage();
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}`, storage)).toBeNull();
      saveOutdoorProjectRecord(record(null), storage);
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}`, storage)).toBe(PID);
    });

    it('无 project 参数 → null（室内工作台不受影响）', () => {
      const storage = memoryStorage();
      saveOutdoorProjectRecord(record(null), storage);
      expect(resolveOutdoorProjectId('/editor/', storage)).toBeNull();
      expect(resolveOutdoorProjectId('/', storage)).toBeNull();
      expect(resolveOutdoorProjectId('/editor/?restore=backup', storage)).toBeNull();
    });

    it('start=outdoor 之外的 start 值不算户外', () => {
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&start=indoor`, memoryStorage())).toBeNull();
    });

    it('显式 mode=outdoor 直接命中，不看本机草稿', () => {
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&mode=outdoor`, memoryStorage())).toBe(PID);
    });

    it('显式 mode=indoor 直接进室内，即使本机有户外草稿', () => {
      const storage = memoryStorage();
      saveOutdoorProjectRecord(record(null), storage);
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&mode=indoor`, storage)).toBeNull();
    });

    it('mode 优先于旧 start 参数', () => {
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&start=outdoor&mode=indoor`, memoryStorage())).toBeNull();
    });
  });

  describe('latestOutdoorProjectId（/ 无参数「续上次」）', () => {
    it('没写过草稿时 null', () => {
      expect(latestOutdoorProjectId(memoryStorage())).toBeNull();
    });

    it('最近一次保存的户外项目胜出，清掉它后指针一起走', () => {
      const storage = memoryStorage();
      saveOutdoorProjectRecord(record(null), storage);
      expect(latestOutdoorProjectId(storage)).toBe(PID);
      clearOutdoorProjectRecord(PID, storage);
      expect(latestOutdoorProjectId(storage)).toBeNull();
      expect(storage.getItem(OUTDOOR_LAST_PROJECT_KEY)).toBeNull();
    });
  });

  describe('视角记忆（按项目记住 2D/3D）', () => {
    it('key 按项目隔离，默认没有记录', () => {
      const storage = memoryStorage();
      expect(outdoorPlanViewStorageKey(PID)).toBe(`scendance-outdoor-view-v1:${PID}`);
      expect(readOutdoorPlanView(PID, storage)).toBeNull();
    });

    it('写入后可读回，坏值回落 null', () => {
      const storage = memoryStorage();
      saveOutdoorPlanView(PID, '3d', storage);
      expect(readOutdoorPlanView(PID, storage)).toBe('3d');
      storage.setItem(outdoorPlanViewStorageKey(PID), 'top');
      expect(readOutdoorPlanView(PID, storage)).toBeNull();
    });
  });

  describe('createStarterOutdoorPlan（新户外项目起步）', () => {
    it('零边界起步（2026-11-11 用户拍板：不再自动送起步矩形），契约校验通过', () => {
      const plan = createStarterOutdoorPlan();
      const parsed = sitePlanDataSchema.parse(plan);
      expect(parsed.boundary).toHaveLength(0);
      expect(plan.zones).toHaveLength(0);
      expect(plan.facilities).toHaveLength(0);
      expect(plan.routes).toHaveLength(0);
      expect(plan.nodes).toHaveLength(0);
      expect(plan.workers).toHaveLength(0);
      // 2026-11-11 默认锚点决策：不传 anchor 落预置锚点（平湖秋月，source 'preset'）。
      expect(plan.anchor).toEqual(DEFAULT_OUTDOOR_PLAN_ANCHOR);
      expect(plan.anchor?.source).toBe('preset');
    });

    it('传入 anchor（从地图开始选的地点）时用真实锚点，不落预置', () => {
      const plan = createStarterOutdoorPlan({ lng: 120.15, lat: 30.25, crs: 'gcj-02', source: 'picker' });
      expect(plan.anchor).toEqual({ lng: 120.15, lat: 30.25, crs: 'gcj-02', source: 'picker' });
    });

    it('起步 plan 可直接落盘并被读回', () => {
      const storage = memoryStorage();
      saveOutdoorProjectRecord(record(createStarterOutdoorPlan()), storage);
      expect(readOutdoorProjectRecord(PID, storage)!.plan).toEqual(createStarterOutdoorPlan());
    });
  });
});
