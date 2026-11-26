import { describe, expect, it } from 'vitest';
import { ANONYMOUS_DRAFT_SCOPE } from '@/lib/project-scope';
import {
  REVIEW_LINK_NO_IDENTITY,
  REVIEW_LINK_SPLIT_DRAFT,
  REVIEW_LINK_UNBOUND_CLOUD,
  classifyProjectIdentity,
  cloudLedgerProjectId,
  localSlotNeedsCloudCheck,
  projectLinkKind,
  reachabilityFromError,
  reviewLinkProjectKey,
} from './project-identity';

const house = 'house-9f0d18c5-d595-481c-9245-4d4dba223419';
const otherHouse = 'house-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const cloud = '10000000-0000-4000-8000-000000000001';
const otherCloud = '10000000-0000-4000-8000-000000000002';

describe('projectLinkKind', () => {
  it('本机草稿和经典案例不是云项目号', () => {
    expect(projectLinkKind(house)).toBe('local-draft');
    expect(projectLinkKind('house-abcdwxyz')).toBe('local-draft');
    expect(projectLinkKind(' default-outdoor ')).toBe('local-draft');
    expect(projectLinkKind('replica-banbury-town-council')).toBe('local-draft');
    // 匿名 draft 槽是一等本机草稿，不去云端查，不判 invalid。
    expect(projectLinkKind(ANONYMOUS_DRAFT_SCOPE)).toBe('local-draft');
  });

  it('裸 uuid 才是云项目号，空串和杂串无效', () => {
    expect(projectLinkKind(cloud)).toBe('cloud');
    expect(projectLinkKind('')).toBe('invalid');
    expect(projectLinkKind('not-a-project')).toBe('invalid');
    expect(projectLinkKind(null)).toBe('invalid');
  });
});

describe('reviewLinkProjectKey', () => {
  it('打开中的本机草稿用这一个号发评审链接', () => {
    expect(reviewLinkProjectKey({ layoutId: house, activeProjectId: house })).toEqual({ ok: true, projectKey: house });
    expect(reviewLinkProjectKey({ layoutId: 'replica-garden', activeProjectId: 'replica-garden' })).toEqual({
      ok: true, projectKey: 'replica-garden',
    });
  });

  it('画布和打开的本机草稿不是同一份时拒绝，不发链接', () => {
    expect(reviewLinkProjectKey({ layoutId: otherHouse, activeProjectId: house })).toEqual({
      ok: false, reason: REVIEW_LINK_SPLIT_DRAFT,
    });
    expect(reviewLinkProjectKey({ layoutId: cloud, activeProjectId: house, cloudProjectId: cloud })).toEqual({
      ok: false, reason: REVIEW_LINK_SPLIT_DRAFT,
    });
  });

  it('起步壳 default-outdoor 不抢走画布自己的本机号', () => {
    expect(reviewLinkProjectKey({ layoutId: 'house-abcdwxyz', activeProjectId: 'default-outdoor' })).toEqual({
      ok: true, projectKey: 'house-abcdwxyz',
    });
  });

  it('云项目只有画布确实挂在已打开的那份上才绑定', () => {
    expect(reviewLinkProjectKey({ layoutId: cloud, activeProjectId: cloud, cloudProjectId: cloud })).toEqual({
      ok: true, projectKey: cloud,
    });
    expect(reviewLinkProjectKey({ layoutId: cloud, cloudProjectId: otherCloud })).toEqual({
      ok: false, reason: REVIEW_LINK_UNBOUND_CLOUD,
    });
    expect(reviewLinkProjectKey({ layoutId: cloud })).toEqual({
      ok: false, reason: REVIEW_LINK_UNBOUND_CLOUD,
    });
  });

  it('没有编号时用本机草稿键；杂串拒绝', () => {
    expect(reviewLinkProjectKey({})).toEqual({ ok: true, projectKey: 'local-draft' });
    expect(reviewLinkProjectKey({ layoutId: '???' })).toEqual({ ok: false, reason: REVIEW_LINK_NO_IDENTITY });
  });
});

describe('cloudLedgerProjectId', () => {
  it('本机草稿号不拿去查云端项目清单', () => {
    expect(cloudLedgerProjectId({ layoutId: house })).toBeNull();
    expect(cloudLedgerProjectId({ layoutId: house, cloudProjectId: cloud })).toBeNull();
    expect(cloudLedgerProjectId({ layoutId: 'default-outdoor', cloudProjectId: cloud })).toBeNull();
  });

  it('只承认画布就是它的那个已打开云项目', () => {
    expect(cloudLedgerProjectId({ layoutId: cloud, cloudProjectId: cloud })).toBe(cloud);
    expect(cloudLedgerProjectId({ cloudProjectId: cloud })).toBe(cloud);
    expect(cloudLedgerProjectId({ layoutId: otherCloud, cloudProjectId: cloud })).toBeNull();
    expect(cloudLedgerProjectId({ layoutId: cloud })).toBeNull();
  });
});

/** 四态身份：判正源，不判 id 长相。 */
describe('classifyProjectIdentity', () => {
  it('挂在云项目上、回读可达或还没探活：云端正源', () => {
    expect(classifyProjectIdentity({ id: cloud, controllerProjectId: cloud, reachability: 'reachable' })).toBe('bound-cloud');
    expect(classifyProjectIdentity({ id: cloud, controllerProjectId: cloud })).toBe('bound-cloud');
    // 临时失败（网络抖动 / 502 未定性）不降级：挂载就是挂载。
    expect(classifyProjectIdentity({ id: cloud, controllerProjectId: cloud, reachability: 'unknown' })).toBe('bound-cloud');
    // 只靠几何绑定挂上的云项目同样算挂载。
    expect(classifyProjectIdentity({
      id: cloud, geometryBinding: { localActivityId: house, cloudProjectId: cloud },
    })).toBe('bound-cloud');
    // 列表里回读可达、尚未打开：正源仍在云端。
    expect(classifyProjectIdentity({ id: cloud, reachability: 'reachable' })).toBe('bound-cloud');
  });

  it('本机前缀从不去云端查，也不算云项目', () => {
    for (const id of [house, 'default-outdoor', 'replica-banbury-town-council', ANONYMOUS_DRAFT_SCOPE]) {
      expect(classifyProjectIdentity({ id })).toBe('local-draft');
      expect(classifyProjectIdentity({ id, reachability: 'reachable' })).toBe('local-draft');
      // 本机号即使真被探活成不可达，也不会被推到 orphan。
      expect(classifyProjectIdentity({ id, reachability: 'unreachable' })).toBe('local-draft');
    }
  });

  it('裸 uuid + 本机信封 + 未挂云项目：本机缓存副本，不是云项目', () => {
    expect(classifyProjectIdentity({ id: cloud, localRecordExists: true })).toBe('cache-copy');
    expect(classifyProjectIdentity({ id: cloud, localRecordExists: true, reachability: 'unknown' })).toBe('cache-copy');
  });

  it('挂着但回读明确失效：挂载不作数，有本机信封落缓存副本，否则落 orphan', () => {
    expect(classifyProjectIdentity({
      id: cloud, controllerProjectId: cloud, reachability: 'unreachable', localRecordExists: true,
    })).toBe('cache-copy');
    expect(classifyProjectIdentity({ id: cloud, controllerProjectId: cloud, reachability: 'unreachable' })).toBe('orphan');
  });

  it('裸 uuid + 未挂 + 回读不可达、且本机没有信封：orphan', () => {
    expect(classifyProjectIdentity({ id: cloud, reachability: 'unreachable' })).toBe('orphan');
    expect(classifyProjectIdentity({ id: otherCloud, reachability: 'unreachable' })).toBe('orphan');
    // 没探活、没挂载、没本机信封：只能按待迁移，不冒充云项目。
    expect(classifyProjectIdentity({ id: cloud })).toBe('orphan');
  });

  it('杂串与空 id 没有可打开身份', () => {
    expect(classifyProjectIdentity({ id: 'not-a-project' })).toBe('orphan');
    expect(classifyProjectIdentity({ id: 'not-a-project', reachability: 'reachable' })).toBe('orphan');
    expect(classifyProjectIdentity({})).toBe('orphan');
    expect(classifyProjectIdentity({ id: '  ' })).toBe('orphan');
  });

  it('四态互斥：同一份输入只落一个态', () => {
    const inputs = [
      { id: cloud, controllerProjectId: cloud, reachability: 'reachable' as const, localRecordExists: true },
      { id: house, localRecordExists: true, reachability: 'unreachable' as const },
      { id: cloud, localRecordExists: true },
      { id: cloud },
    ];
    const states = inputs.map(input => classifyProjectIdentity(input));
    expect(states).toEqual(['bound-cloud', 'local-draft', 'cache-copy', 'orphan']);
    expect(new Set(states).size).toBe(states.length);
  });
});

describe('localSlotNeedsCloudCheck', () => {
  it('裸 uuid 且不是当前画布，才需要去云端核对归属', () => {
    expect(localSlotNeedsCloudCheck(cloud)).toBe(true);
    expect(localSlotNeedsCloudCheck(cloud, otherCloud)).toBe(true);
    expect(localSlotNeedsCloudCheck(` ${cloud} `, cloud)).toBe(false);
  });

  it('本机前缀与杂串从不去云端查', () => {
    expect(localSlotNeedsCloudCheck(house)).toBe(false);
    expect(localSlotNeedsCloudCheck('default-outdoor')).toBe(false);
    expect(localSlotNeedsCloudCheck('replica-banbury-town-council')).toBe(false);
    expect(localSlotNeedsCloudCheck(ANONYMOUS_DRAFT_SCOPE)).toBe(false);
    expect(localSlotNeedsCloudCheck('')).toBe(false);
    expect(localSlotNeedsCloudCheck('not-a-project')).toBe(false);
  });
});

describe('reachabilityFromError', () => {
  it('项目不存在 / 无权限才算确定性失效', () => {
    for (const code of ['PROJECT_NOT_FOUND', 'FORBIDDEN', 'STUDIO_NOT_FOUND']) {
      expect(reachabilityFromError(Object.assign(new Error(code), { code }))).toBe('unreachable');
      expect(reachabilityFromError({ code })).toBe('unreachable');
    }
  });

  it('网络抖动、登录过期、5xx 未定性不算失效', () => {
    for (const code of ['NETWORK_ERROR', 'UNAUTHENTICATED', 'SESSION_CHANGED', 'INVALID_RESPONSE', 'ROUTE_NOT_FOUND']) {
      expect(reachabilityFromError(Object.assign(new Error(code), { code, status: 502 }))).toBe('unknown');
    }
  });

  it('没有可用错误码时保守归 unknown，不误判失效', () => {
    expect(reachabilityFromError(new Error('offline'))).toBe('unknown');
    expect(reachabilityFromError(null)).toBe('unknown');
    expect(reachabilityFromError('PROJECT_NOT_FOUND')).toBe('unknown');
    expect(reachabilityFromError({ code: '  ' })).toBe('unknown');
  });
});
