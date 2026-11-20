import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloudCaseOutdoorPlan,
  detectCloudCaseSession,
  ensureCloudCaseCopyRecord,
  listCloudCases,
  readCloudCase,
  suggestCloudCaseStableId,
  type CloudCaseSessionContract,
} from './cloud-cases';
import { createStarterOutdoorPlan, readOutdoorProjectRecord, saveOutdoorProjectRecord, type KeyValueStorage, type OutdoorProjectRecord } from './outdoor-project-store';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 测试用内存存储；setItem 可配置成抛错来模拟配额满/隐私模式。 */
function mapStorage(options: { failWrites?: boolean } = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => {
      if (options.failWrites) throw new Error('quota');
      data.set(key, String(value));
    },
    removeItem: key => { data.delete(key); },
  };
}

/** 把记录按项目 key 写进存储（模拟本机已有草稿）。 */
function seedRecord(storage: KeyValueStorage, record: OutdoorProjectRecord): void {
  saveOutdoorProjectRecord(record, storage);
}

const CN_CASE_ID = 'cn-yuquan-chrysanthemum';

function caseManifest() {
  return {
    case: { id: CN_CASE_ID, title: '杭州植物园菊花展', category: '花卉展', sortOrder: 0, revision: 4 },
    publicationId: 'pub-1',
    revision: 4,
    manifest: { outdoor: createStarterOutdoorPlan() },
    assets: [],
  };
}

/** 带全部 9 个方法的会话替身；readCloudCase 默认回一份合法 manifest。 */
function fakeSession(readManifest: unknown = caseManifest()): CloudCaseSessionContract {
  return {
    getCloudCapabilities: vi.fn(async () => ({ version: 1, superAdmin: false, officialStudioId: null })),
    listCloudCases: vi.fn(async () => [caseManifest().case]),
    readCloudCase: vi.fn(async () => readManifest),
    upsertCloudCase: vi.fn(async (_id: string, input: { title: string }) => ({ id: CN_CASE_ID, projectId: 'proj-1', version: 1, ...input })),
    listCloudCaseDrafts: vi.fn(async () => []),
    publishCloudCase: vi.fn(async () => caseManifest().case),
    unpublishCloudCase: vi.fn(async () => caseManifest().case),
    listCloudCaseVersions: vi.fn(async () => []),
    restoreCloudCase: vi.fn(async () => caseManifest().case),
  };
}

describe('detectCloudCaseSession', () => {
  it('没有 controller 或方法不全时按不可用处理', () => {
    expect(detectCloudCaseSession(null)).toBeNull();
    const partial = fakeSession();
    delete (partial as Partial<CloudCaseSessionContract>).publishCloudCase;
    expect(detectCloudCaseSession(partial as unknown as CloudCaseSessionContract)).toBeNull();
  });

  it('方法齐全时原样接通', () => {
    const session = fakeSession();
    expect(detectCloudCaseSession(session)).toBe(session);
  });
});

describe('listCloudCases', () => {
  it('方法缺失返回不可用，不制造目录数据', async () => {
    const result = await listCloudCases(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unavailable');
  });

  it('目录行按契约校验后原样透出', async () => {
    const session = fakeSession();
    const result = await listCloudCases(session);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({ id: CN_CASE_ID, title: '杭州植物园菊花展', revision: 4 });
    }
    expect(session.listCloudCases).toHaveBeenCalledOnce();
  });

  it('目录返回不是数组时拒绝展示', async () => {
    const session = fakeSession();
    (session.listCloudCases as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [] });
    const result = await listCloudCases(session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid');
  });

  it('封面地址（C09）：https 签名地址原样透出，非 https 拒绝', async () => {
    const session = fakeSession();
    (session.listCloudCases as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: CN_CASE_ID, title: '带封面案', revision: 1, coverUrl: 'https://wkhfvnzgopjdzxlmycks.supabase.co/storage/v1/object/sign/x.png?token=abc' },
    ]);
    const ok = await listCloudCases(session);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value[0].coverUrl).toContain('sign/x.png');
    (session.listCloudCases as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: CN_CASE_ID, title: '坏封面案', revision: 1, coverUrl: 'javascript:alert(1)' },
    ]);
    const bad = await listCloudCases(session);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid');
  });
});

describe('readCloudCase / cloudCaseOutdoorPlan', () => {
  it('manifest.outdoor 是合法户外规划时直接可另存', async () => {
    const session = fakeSession();
    const result = await readCloudCase(session, CN_CASE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = cloudCaseOutdoorPlan(result.value);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.plan.schemaVersion).toBe(1);
  });

  it('manifest 缺户外数据时明确拒绝，不灌空方案', async () => {
    const session = fakeSession({
      case: { id: CN_CASE_ID, title: '只有室内的案', revision: 1 },
      publicationId: 'pub-2',
      revision: 1,
      manifest: { scene: { schemaVersion: 1 } },
    });
    const result = await readCloudCase(session, CN_CASE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = cloudCaseOutdoorPlan(result.value);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('没有可另存的户外规划数据');
  });

  it('户外数据不合法时拒绝（坏数据不进画布）', async () => {
    const session = fakeSession({
      case: { id: CN_CASE_ID, title: '坏数据的案', revision: 1 },
      publicationId: 'pub-3',
      revision: 1,
      manifest: { outdoor: { schemaVersion: 1, boundary: 'not-a-polygon' } },
    });
    const result = await readCloudCase(session, CN_CASE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = cloudCaseOutdoorPlan(result.value);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('不是有效的户外方案');
  });
});

describe('suggestCloudCaseStableId', () => {
  it('案例副本项目取回原稳定 ID，其余原样', () => {
    expect(suggestCloudCaseStableId('replica-cn-yuquan-chrysanthemum')).toBe('cn-yuquan-chrysanthemum');
    expect(suggestCloudCaseStableId('proj-abcd')).toBe('proj-abcd');
    expect(suggestCloudCaseStableId('')).toBe('');
    expect(suggestCloudCaseStableId(null)).toBe('');
  });
});

describe('ensureCloudCaseCopyRecord（使用此案例 = 独立另存）', () => {
  it('首次另存读 manifest 落本机副本，且不继承任何云端身份', async () => {
    const storage = mapStorage();
    // 用户当前还有一个挂在云端活动上的项目——副本绝不能把它带走。
    seedRecord(storage, {
      v: 1, projectId: 'proj-cloud-1', name: '我自己的活动', createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z',
      plan: createStarterOutdoorPlan(), remoteActivityId: 'act-own-1', remoteRevision: 6,
    });
    const session = fakeSession();
    const result = await ensureCloudCaseCopyRecord(session, CN_CASE_ID, storage);
    expect(result).toEqual({ created: true, projectId: `replica-${CN_CASE_ID}` });
    const record = readOutdoorProjectRecord(result.projectId, storage);
    expect(record?.name).toBe('官方案例 · 杭州植物园菊花展');
    expect(record?.plan).toEqual(createStarterOutdoorPlan());
    expect(record?.remoteActivityId).toBeUndefined();
    expect(record?.remoteRevision).toBeUndefined();
    expect(session.readCloudCase).toHaveBeenCalledOnce();
  });

  it('已有副本原样续用：重复点击不再请求云端、不覆盖本机修改（V11）', async () => {
    const storage = mapStorage();
    const projectId = `replica-${CN_CASE_ID}`;
    seedRecord(storage, {
      v: 1, projectId, name: '我改过的副本', createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T01:00:00.000Z',
      plan: { ...createStarterOutdoorPlan(), boundary: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 18 }, { x: 0, y: 18 }] },
    });
    const session = fakeSession();
    const result = await ensureCloudCaseCopyRecord(session, CN_CASE_ID, storage);
    expect(result).toEqual({ created: false, projectId });
    expect(session.readCloudCase).not.toHaveBeenCalled();
    const record = readOutdoorProjectRecord(projectId, storage);
    expect(record?.name).toBe('我改过的副本');
    expect(record?.updatedAt).toBe('2026-11-19T01:00:00.000Z');
    expect(record?.plan?.boundary).toHaveLength(4);
  });

  it('存储写入静默失败时明确报错，不假成功', async () => {
    const storage = mapStorage({ failWrites: true });
    const session = fakeSession();
    await expect(ensureCloudCaseCopyRecord(session, CN_CASE_ID, storage)).rejects.toThrow('浏览器未能保存案例副本');
  });

  it('案例标识为空直接拒绝', async () => {
    const session = fakeSession();
    await expect(ensureCloudCaseCopyRecord(session, '  ', mapStorage())).rejects.toThrow('案例标识为空');
    expect(session.readCloudCase).not.toHaveBeenCalled();
  });
});

describe('使用此案例端到端（2026-11-20 集成回归：A 实际响应形状）', () => {
  /** A 的 GET /cloud/cases/:stableId 实际响应形状（supabase/functions/_shared/cloud-storage.ts 构造）。 */
  function realReadResponse() {
    const plan = createStarterOutdoorPlan();
    return {
      case: { id: CN_CASE_ID, title: '杭州植物园菊花展', description: '浙江 · 杭州 · 花卉展', category: '花卉展', version: 3, publishedAt: '2026-11-20T08:00:00.000Z' },
      projectId: '11111111-1111-4111-8111-111111111111',
      publicationId: '22222222-2222-4222-8222-222222222222',
      revision: 4,
      manifest: { version: 1, scene: null, outdoor: plan, dependencies: [] },
      assets: [{ id: '33333333-3333-4333-8333-333333333333', name: '舞台桁架', kind: 'scene-asset', format: 'glb', byteSize: 64, sha256: 'a'.repeat(64), integrity: 'full', metadata: {}, url: 'https://storage.example/signed/x', expiresIn: 300 }],
    };
  }

  it('按 A 实际形状另存个人副本，重复调用幂等（V11 + 修复后的解析链）', async () => {
    const storage = mapStorage();
    const session = fakeSession(realReadResponse());
    const first = await ensureCloudCaseCopyRecord(session, CN_CASE_ID, storage);
    expect(first).toEqual({ created: true, projectId: `replica-${CN_CASE_ID}` });
    const record = readOutdoorProjectRecord(`replica-${CN_CASE_ID}`, storage);
    expect(record?.name).toContain('杭州植物园菊花展');
    expect(record?.remoteActivityId).toBeUndefined();
    expect(record?.remoteRevision).toBeUndefined();
    // 二次打开：不重读云端、不覆盖本机副本。
    const second = await ensureCloudCaseCopyRecord(session, CN_CASE_ID, storage);
    expect(second).toEqual({ created: false, projectId: `replica-${CN_CASE_ID}` });
    expect(session.readCloudCase).toHaveBeenCalledTimes(1);
    expect(readOutdoorProjectRecord(`replica-${CN_CASE_ID}`, storage)?.plan).toEqual(record?.plan);
  });

  it('公开目录条目（带 revision/coverUrl 的另一形状）同样通过解析', async () => {
    const session = fakeSession();
    const result = await listCloudCases(session);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value[0]?.revision).toBe(4);
  });
});
