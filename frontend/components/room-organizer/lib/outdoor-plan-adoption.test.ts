// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStarterOutdoorPlan, readOutdoorProjectRecord } from './outdoor-project-store';
import {
  adoptOutdoorActivity,
  describeActivities,
  listAdoptableActivities,
  localIdForActivity,
} from './outdoor-plan-adoption';

beforeEach(() => localStorage.clear());

describe('换设备找回活动', () => {
  it('没登录/失败/空都安静返回空列表', async () => {
    expect(await listAdoptableActivities(null)).toEqual([]);
    expect(
      await listAdoptableActivities({ listOutdoorPlans: vi.fn().mockRejectedValue(new Error('offline')) }),
    ).toEqual([]);
    expect(await listAdoptableActivities({ listOutdoorPlans: vi.fn().mockResolvedValue([]) })).toEqual([]);
  });

  it('按更新时间新到旧排，缺 localActivityId 时用 cloud-<前8位>', () => {
    const list = describeActivities([
      { activityId: 'aaaaaaaa-1111', name: '旧的', revision: 1, updatedAt: '2026-11-16T00:00:00Z', localActivityId: null },
      { activityId: 'bbbbbbbb-2222', name: '', revision: 3, updatedAt: '2026-11-17T00:00:00Z', localActivityId: null },
    ]);
    expect(list.map(item => item.activityId)).toEqual(['bbbbbbbb-2222', 'aaaaaaaa-1111']);
    expect(list[0]!.name).toBe('未命名活动');
    expect(list[0]!.localActivityId).toBe('cloud-bbbbbbbb');
  });

  it('localActivityId 优先沿用作本机 id', () => {
    expect(localIdForActivity({ activityId: 'a-1', localActivityId: 'default-outdoor' })).toBe('default-outdoor');
    expect(localIdForActivity({ activityId: 'a-1', localActivityId: '   ' })).toBe('cloud-a-1');
  });

  it('打开一份：拉回 plan + 记下后端 id / 版本号', async () => {
    const plan = createStarterOutdoorPlan();
    const getOutdoorPlan = vi.fn().mockResolvedValue({
      found: true, activityId: 'a-9', name: '湖滨夜集', revision: 4, plan,
    });
    const result = await adoptOutdoorActivity(
      { getOutdoorPlan },
      { activityId: 'a-9', localActivityId: 'default-outdoor', name: '湖滨夜集', revision: 4 },
    );
    expect(result?.projectId).toBe('default-outdoor');
    expect(getOutdoorPlan).toHaveBeenCalledWith('a-9');
    const stored = readOutdoorProjectRecord('default-outdoor');
    expect(stored).toMatchObject({ name: '湖滨夜集', remoteActivityId: 'a-9', remoteRevision: 4 });
    expect(stored?.plan).toEqual(plan);
  });

  it('读不到 / 方案不合法都返回 null，不写坏本机记录', async () => {
    expect(
      await adoptOutdoorActivity(
        { getOutdoorPlan: vi.fn().mockResolvedValue({ found: false }) },
        { activityId: 'a-1', localActivityId: 'x', name: 'x', revision: 1 },
      ),
    ).toBeNull();
    expect(
      await adoptOutdoorActivity(
        { getOutdoorPlan: vi.fn().mockRejectedValue(new Error('offline')) },
        { activityId: 'a-1', localActivityId: 'x', name: 'x', revision: 1 },
      ),
    ).toBeNull();
    expect(
      await adoptOutdoorActivity(
        { getOutdoorPlan: vi.fn().mockResolvedValue({ found: true, plan: { nope: true } }) },
        { activityId: 'a-1', localActivityId: 'broken', name: 'x', revision: 1 },
      ),
    ).toBeNull();
    expect(readOutdoorProjectRecord('broken')).toBeNull();
  });
});
