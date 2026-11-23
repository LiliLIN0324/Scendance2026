import { describe, expect, it } from 'vitest';
import {
  REVIEW_LINK_NO_IDENTITY,
  REVIEW_LINK_SPLIT_DRAFT,
  REVIEW_LINK_UNBOUND_CLOUD,
  cloudLedgerProjectId,
  projectLinkKind,
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
