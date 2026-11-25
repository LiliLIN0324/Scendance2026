import { describe, expect, it } from 'vitest';
import {
  adoptLegacyOutdoorPlanForActivity,
  clearOutdoorProjectRecord,
  createStarterOutdoorPlan,
  DEFAULT_OUTDOOR_PLAN_ANCHOR,
  DEFAULT_OUTDOOR_PROJECT_ID,
  hasOutdoorPlanDraft,
  latestOutdoorProjectId,
  latestLocalActivityRecord,
  listOutdoorProjectRecords,
  OUTDOOR_LAST_PROJECT_KEY,
  outdoorPlanStorageKey,
  outdoorSaveScope,
  patchOutdoorProjectRemote,
  readOutdoorProjectRecord,
  renameOutdoorProject,
  resolveFallbackOutdoorProject,
  resolveOutdoorProjectId,
  saveOutdoorProjectRecord,
  type KeyValueStorage,
  type OutdoorProjectRecord,
} from './outdoor-project-store';
import { sitePlanDataSchema, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { MemoryStorage } from '@/lib/test-support-memory-storage';

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

  it('贴地底图（plan.ground）随本机草稿往返，不被 store 校验吞掉（B4）', () => {
    const storage = memoryStorage();
    const plan: SitePlanData = {
      ...samplePlan(),
      ground: {
        image: `data:image/jpeg;base64,${'B'.repeat(32)}`,
        opacity: 0.94,
        satelliteRef: true,
        polygon: [
          { lng: 120.1443, lat: 30.2465 }, { lng: 120.1463, lat: 30.2465 },
          { lng: 120.1463, lat: 30.2445 }, { lng: 120.1443, lat: 30.2445 },
        ],
        center: { lng: 120.1453, lat: 30.2455 },
        frame: { lng0: 120.1443, lat0: 30.2465, latMid: 30.2455, scale: 1, latSign: -1 },
        source: 'amap-satellite',
        capturedAt: '2026-11-25T06:00:00.000Z',
      },
    };
    saveOutdoorProjectRecord(record(plan), storage);
    const loaded = readOutdoorProjectRecord(PID, storage);
    expect(loaded!.plan!.ground).toEqual(plan.ground);
  });

  it('单价、价格书和报价抬头随本机草稿往返', () => {
    const storage = memoryStorage();
    const plan: SitePlanData = {
      ...samplePlan(),
      facilities: [{
        id: '22222222-2222-4222-8222-222222222222',
        templateId: 'chair',
        name: '折叠椅',
        position: { x: 10, y: 8 },
        rotationDeg: 0,
        size: { width: 0.55, depth: 0.53 },
        notes: '',
        modelOverride: 'folding-chair',
        unitPrice: 88,
      }],
      priceBook: { 'folding-chair': 88 },
      quote: { projectName: '秋季发布会', client: '星河品牌部', validUntil: '2026-12-31', preparedBy: '幕景策划' },
    };
    saveOutdoorProjectRecord(record(plan), storage);
    const loaded = readOutdoorProjectRecord(PID, storage)?.plan;
    expect(loaded?.facilities[0]?.unitPrice).toBe(88);
    expect(loaded?.priceBook).toEqual({ 'folding-chair': 88 });
    expect(loaded?.quote).toEqual(plan.quote);
    expect(sitePlanDataSchema.safeParse(loaded).success).toBe(true);
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

    it('无 project 参数 → null（由 shell 续最近项目或起步默认草稿）', () => {
      const storage = memoryStorage();
      saveOutdoorProjectRecord(record(null), storage);
      expect(resolveOutdoorProjectId('/editor/', storage)).toBeNull();
      expect(resolveOutdoorProjectId('/', storage)).toBeNull();
      expect(resolveOutdoorProjectId('/editor/?restore=backup', storage)).toBeNull();
    });

    it('仅 mode=outdoor、无 project → null，不在解析层越权起默认草稿', () => {
      const storage = memoryStorage();
      expect(resolveOutdoorProjectId('/editor/?mode=outdoor', storage)).toBeNull();
      expect(resolveOutdoorProjectId('/?mode=outdoor', storage)).toBeNull();
      expect(readOutdoorProjectRecord(DEFAULT_OUTDOOR_PROJECT_ID, storage)).toBeNull();
    });

    it('start=outdoor 之外的 start 值不直接命中', () => {
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&start=indoor`, memoryStorage())).toBeNull();
    });

    it('显式 mode=outdoor 直接命中，不看本机草稿', () => {
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&mode=outdoor`, memoryStorage())).toBe(PID);
    });

    it('mode=indoor 不再切独立通路：无草稿回落 null，有草稿照常命中', () => {
      const storage = memoryStorage();
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&mode=indoor`, storage)).toBeNull();
      saveOutdoorProjectRecord(record(null), storage);
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&mode=indoor`, storage)).toBe(PID);
    });

    it('start=outdoor 优先于已废弃的 indoor 模式标记', () => {
      expect(resolveOutdoorProjectId(`/editor/?project=${PID}&start=outdoor&mode=indoor`, memoryStorage())).toBe(PID);
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

  describe('活动级规划（2026-11-17 新建活动不再继承上一份场地）', () => {
    it('活动记录落盘时不动「最近项目」指针', () => {
      const storage = memoryStorage();
      saveOutdoorProjectRecord(record(samplePlan()), storage);
      expect(storage.getItem(OUTDOOR_LAST_PROJECT_KEY)).toBe(PID);
      saveOutdoorProjectRecord({ ...record(createStarterOutdoorPlan()), projectId: 'house-activity-b' }, storage, false);
      expect(storage.getItem(OUTDOOR_LAST_PROJECT_KEY)).toBe(PID);
      expect(readOutdoorProjectRecord('house-activity-b', storage)!.plan).toEqual(createStarterOutdoorPlan());
    });

    it('旧版共用的一份规划只交给第一个挂载的活动，之后的新活动仍是空白', () => {
      const storage = memoryStorage();
      saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'default-outdoor' }, storage);
      expect(adoptLegacyOutdoorPlanForActivity('house-activity-a', 'default-outdoor', storage)).toBe(true);
      expect(readOutdoorProjectRecord('house-activity-a', storage)!.plan).toEqual(samplePlan());
      // 第二个活动（新建的空活动）不再接管旧规划。
      expect(adoptLegacyOutdoorPlanForActivity('house-activity-b', 'default-outdoor', storage)).toBe(false);
      expect(readOutdoorProjectRecord('house-activity-b', storage)).toBeNull();
      // 旧记录本身保留，不销毁。
      expect(readOutdoorProjectRecord('default-outdoor', storage)!.plan).toEqual(samplePlan());
    });

    it('已经处理过迁移时不覆盖活动自己的规划', () => {
      const storage = memoryStorage();
      saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'default-outdoor' }, storage);
      saveOutdoorProjectRecord({ ...record(createStarterOutdoorPlan()), projectId: 'house-activity-a' }, storage, false);
      expect(adoptLegacyOutdoorPlanForActivity('house-activity-a', 'default-outdoor', storage)).toBe(false);
      expect(readOutdoorProjectRecord('house-activity-a', storage)!.plan).toEqual(createStarterOutdoorPlan());
    });
  });
});

// 2026-11-17：「有红线就带白框」不等于「无红线也造框」。起步规划是零边界起步，
// 没画红线时凭空长出一只白框，就违反 schema 里「读取层不得把没设渲染成设了」。
describe('起步规划不造白框', () => {
  it('createStarterOutdoorPlan：边界为空，也不带 designScope', () => {
    const plan = createStarterOutdoorPlan();
    expect(plan.boundary).toEqual([]);
    expect(plan.designScope).toBeUndefined();
  });
});

// 2026-11-20 审计 B2：本机写失败必须能被告知，不能静默当已保存。
describe('本机落盘结果', () => {
  it('成功时返回 ok', () => {
    const storage = memoryStorage();
    expect(saveOutdoorProjectRecord(record(samplePlan()), storage)).toEqual({ ok: true });
  });

  it('配额满：返回 quota，且没有写坏已有记录', () => {
    const storage = memoryStorage();
    const full: KeyValueStorage = {
      getItem: key => storage.getItem(key),
      removeItem: key => storage.removeItem(key),
      setItem: () => { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; },
    };
    expect(saveOutdoorProjectRecord(record(samplePlan()), full)).toEqual({ ok: false, reason: 'quota' });
    expect(readOutdoorProjectRecord(PID, storage)).toBeNull();
  });

  it('没有存储：返回 unavailable，不抛错', () => {
    expect(saveOutdoorProjectRecord(record(samplePlan()), null)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('其它存储异常：返回 unknown', () => {
    const broken: KeyValueStorage = {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => { throw new Error('disk on fire'); },
    };
    expect(saveOutdoorProjectRecord(record(samplePlan()), broken)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('「最近项目」指针写失败不推翻「记录已落盘」的结论', () => {
    const storage = memoryStorage();
    const pointerBroken: KeyValueStorage = {
      getItem: key => storage.getItem(key),
      removeItem: key => storage.removeItem(key),
      setItem: (key, value) => {
        if (key === OUTDOOR_LAST_PROJECT_KEY) throw new Error('pointer failed');
        storage.setItem(key, value);
      },
    };
    expect(saveOutdoorProjectRecord(record(samplePlan()), pointerBroken)).toEqual({ ok: true });
    expect(readOutdoorProjectRecord(PID, storage)?.plan).toEqual(samplePlan());
  });

  it('plan 不合法仍然抛错（属于程序缺陷，不当成暂时写不进去）', () => {
    const storage = memoryStorage();
    const bad = { ...samplePlan(), boundary: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }] } as SitePlanData;
    expect(() => saveOutdoorProjectRecord(record(bad), storage)).toThrow();
    expect(saveOutdoorProjectRecord(record(samplePlan()), storage)).toEqual({ ok: true });
  });
});

describe('云端回执只改版本指针（B2/B6）', () => {
  it('在途期间又存了新 plan：回执不把盘上的 plan 退回旧版', () => {
    const storage = memoryStorage();
    saveOutdoorProjectRecord(record(samplePlan()), storage);
    const newer: SitePlanData = { ...samplePlan(), boundary: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }] };
    saveOutdoorProjectRecord(record(newer), storage);

    const patched = patchOutdoorProjectRemote(PID, {
      remoteActivityId: 'a-1',
      remoteRevision: 4,
      unsyncedPlan: false,
    }, storage);

    expect(patched).toEqual({ ok: true });
    const loaded = readOutdoorProjectRecord(PID, storage)!;
    expect(loaded.plan).toEqual(newer);
    expect(loaded.remoteActivityId).toBe('a-1');
    expect(loaded.remoteRevision).toBe(4);
    expect(loaded.unsyncedPlan).toBe(false);
  });

  it('不传 unsyncedPlan 时保留盘上的值', () => {
    const storage = memoryStorage();
    saveOutdoorProjectRecord({ ...record(samplePlan()), unsyncedPlan: true }, storage);
    expect(patchOutdoorProjectRemote(PID, { remoteRevision: 2 }, storage)).toEqual({ ok: true });
    expect(readOutdoorProjectRecord(PID, storage)!.unsyncedPlan).toBe(true);
  });

  it('记录不存在时不无中生有', () => {
    const storage = memoryStorage();
    expect(patchOutdoorProjectRemote(PID, { remoteRevision: 2 }, storage)).toEqual({ ok: false, reason: 'unavailable' });
    expect(readOutdoorProjectRecord(PID, storage)).toBeNull();
  });

  it('写失败时如实返回失败（不假装回执已落盘）', () => {
    const storage = memoryStorage();
    saveOutdoorProjectRecord(record(samplePlan()), storage);
    const full: KeyValueStorage = {
      getItem: key => storage.getItem(key),
      removeItem: key => storage.removeItem(key),
      setItem: () => { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; },
    };
    expect(patchOutdoorProjectRemote(PID, { remoteRevision: 3 }, full)).toEqual({ ok: false, reason: 'quota' });
  });
});

describe('outdoorSaveScope（与云面板订阅同口径）', () => {
  it('有项目 id 就用它，空/未给回落 local（云面板的 layout.id ?? local）', () => {
    expect(outdoorSaveScope(PID)).toBe(PID);
    expect(outdoorSaveScope('  spaced  ')).toBe('spaced');
    expect(outdoorSaveScope(null)).toBe('local');
    expect(outdoorSaveScope(undefined)).toBe('local');
    expect(outdoorSaveScope('   ')).toBe('local');
  });
});

describe('plan 草稿索引枚举（B1-b 身份恢复地基）', () => {
  it('按 updatedAt 降序列出全部 plan 记录，过滤指针键与坏信封', () => {
    const storage = new MemoryStorage();
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'house-a',
      createdAt: '2026-11-10T07:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z' }, storage);
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'house-b',
      createdAt: '2026-11-11T08:00:00.000Z', updatedAt: '2026-11-11T09:00:00.000Z' }, storage);
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: DEFAULT_OUTDOOR_PROJECT_ID,
      createdAt: '2026-11-09T06:00:00.000Z', updatedAt: '2026-11-09T07:00:00.000Z' }, storage);
    storage.setItem(OUTDOOR_LAST_PROJECT_KEY, PID);
    storage.setItem(outdoorPlanStorageKey('broken'), 'not-valid-json');

    const listed = listOutdoorProjectRecords(storage);
    expect(listed.map(item => item.projectId)).toEqual(['house-b', 'house-a', DEFAULT_OUTDOOR_PROJECT_ID]);
    for (const item of listed) expect(item.plan).toEqual(samplePlan());
  });

  it('存储不提供枚举能力时安静返回空，不抛错', () => {
    const storage = memoryStorage();
    saveOutdoorProjectRecord(record(samplePlan()), storage);
    expect(listOutdoorProjectRecords(storage)).toEqual([]);
  });
});

describe('latestLocalActivityRecord（无参刷新兜底找回本机活动）', () => {
  it('返回 updatedAt 最新的 house-* 草稿，跳过 replica 副本与默认草稿', () => {
    const storage = new MemoryStorage();
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'house-a',
      createdAt: '2026-11-10T07:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z' }, storage);
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'house-b',
      createdAt: '2026-11-11T08:00:00.000Z', updatedAt: '2026-11-11T09:00:00.000Z' }, storage);
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'replica-garden',
      createdAt: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z' }, storage);
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: DEFAULT_OUTDOOR_PROJECT_ID,
      createdAt: '2026-11-09T06:00:00.000Z', updatedAt: '2026-11-09T07:00:00.000Z' }, storage);

    const picked = latestLocalActivityRecord(storage);
    expect(picked?.projectId).toBe('house-b');
  });

  it('只有 replica 副本 / 默认草稿时返回 null，不抢续非本机活动', () => {
    const storage = new MemoryStorage();
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'replica-garden' }, storage);
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: DEFAULT_OUTDOOR_PROJECT_ID }, storage);
    expect(latestLocalActivityRecord(storage)).toBeNull();
  });

  it('空存储返回 null', () => {
    expect(latestLocalActivityRecord(new MemoryStorage())).toBeNull();
  });
});

describe('resolveFallbackOutdoorProject（弱参 / 无参刷新兜底身份）', () => {
  it('指针指向云项目时续指针，不被本机活动顶掉', () => {
    const storage = new MemoryStorage();
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'house-a', updatedAt: '2026-11-11T09:00:00.000Z' }, storage, false);
    storage.setItem(OUTDOOR_LAST_PROJECT_KEY, PID);
    expect(resolveFallbackOutdoorProject(storage)).toBe(PID);
  });

  it('指针只是默认草稿时让位最近的本机 house 活动', () => {
    const storage = new MemoryStorage();
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: DEFAULT_OUTDOOR_PROJECT_ID }, storage, true);
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'house-a', updatedAt: '2026-11-11T09:00:00.000Z' }, storage, false);
    expect(latestOutdoorProjectId(storage)).toBe(DEFAULT_OUTDOOR_PROJECT_ID);
    expect(resolveFallbackOutdoorProject(storage)).toBe('house-a');
  });

  it('指针指向本机 house 时续该 house', () => {
    const storage = new MemoryStorage();
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'house-a' }, storage, true);
    expect(resolveFallbackOutdoorProject(storage)).toBe('house-a');
  });

  it('没有指针时枚举最近 house 活动', () => {
    const storage = new MemoryStorage();
    saveOutdoorProjectRecord({ ...record(samplePlan()), projectId: 'house-b', updatedAt: '2026-11-11T09:00:00.000Z' }, storage, false);
    expect(resolveFallbackOutdoorProject(storage)).toBe('house-b');
  });

  it('空存储起步默认草稿并落盘', () => {
    const storage = new MemoryStorage();
    expect(resolveFallbackOutdoorProject(storage)).toBe(DEFAULT_OUTDOOR_PROJECT_ID);
    expect(readOutdoorProjectRecord(DEFAULT_OUTDOOR_PROJECT_ID, storage)).not.toBeNull();
  });
});

describe('read strips the legacy West Lake preset ground from the plan (B4 read-side)', () => {
  it('drops only the old preset image and keeps a user-picked West Lake basemap', () => {
    const store = memoryStorage();
    const pid = 'ground-purge';
    const base = { opacity: 0.94, satelliteRef: true, center: { lng: 120.1453, lat: 30.2455 } };
    // 用户自己在这一带选的卫星底图：必须留着（当年说的只是「默认进来那套不要」）。
    saveOutdoorProjectRecord({ v: 1, projectId: pid, name: '平湖秋月', createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z',
      plan: { ...createStarterOutdoorPlan(), ground: { ...base, image: 'data:image/jpeg;base64,Zm9v' } } }, store);
    expect(readOutdoorProjectRecord(pid, store)?.plan?.ground?.image).toBe('data:image/jpeg;base64,Zm9v');
    // 旧预设那张：正源侧也要剥，否则 layout 剥完会被正源同步补回来。
    saveOutdoorProjectRecord({ v: 1, projectId: pid, name: '旧预设', createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z',
      plan: { ...createStarterOutdoorPlan(), ground: { ...base, image: '/basemap/xihu-scenic-z15.jpg' } } }, store);
    expect(readOutdoorProjectRecord(pid, store)?.plan?.ground).toBeUndefined();
  });
});