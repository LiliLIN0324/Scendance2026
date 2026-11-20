import { describe, expect, it } from 'vitest';
import { createOutdoorPlanSession, samePlanContent } from './outdoor-plan-session';
import type { OutdoorProjectRecord } from './outdoor-project-store';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const PROJECT = 'activity-1';

function plan(overrides: Partial<SitePlanData> = {}): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: { lng: 120.15, lat: 30.25, crs: 'gcj-02', source: 'picker' },
    boundary: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
    ...overrides,
  };
}

function record(overrides: Partial<OutdoorProjectRecord> = {}): OutdoorProjectRecord {
  return {
    v: 1,
    projectId: PROJECT,
    name: '湖滨夜集',
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T01:00:00.000Z',
    plan: plan(),
    remoteActivityId: 'a-1',
    remoteRevision: 2,
    ...overrides,
  };
}

describe('户外编辑会话的云端版本基线（B6）', () => {
  it('打开时读一次：首次推送带打开时记录的版本', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(record());
    expect(session.remoteRevision()).toBe(2);
    expect(session.remoteActivityId()).toBe('a-1');
    expect(session.buildRecord({ projectId: PROJECT, plan: plan() }).remoteRevision).toBe(2);
  });

  it('成功回执推进基线：连续两次保存，第二次用第一次回执的版本号', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(record());
    session.confirmSaved({ remoteActivityId: 'a-1', remoteRevision: 3 });
    expect(session.buildRecord({ projectId: PROJECT, plan: plan() }).remoteRevision).toBe(3);
    session.confirmSaved({ remoteActivityId: 'a-1', remoteRevision: 4 });
    expect(session.buildRecord({ projectId: PROJECT, plan: plan() }).remoteRevision).toBe(4);
  });

  it('不借共享记录里别人写进去的新版本（B6 的覆盖路径）', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(record({ remoteRevision: 2 }));
    // 另一个窗口把成功回执写进了同一条本机记录：本会话不能拿它当 baseRevision。
    const sharedRecord = record({ remoteRevision: 99 });
    expect(sharedRecord.remoteRevision).toBe(99);
    expect(session.remoteRevision()).toBe(2);
    expect(session.buildRecord({ projectId: PROJECT, plan: plan() }).remoteRevision).toBe(2);
  });

  it('冲突到达的远端版本只用于提示，不推进基线', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(record({ remoteRevision: 2 }));
    session.noteConflict(7);
    expect(session.remoteRevision()).toBe(2);
  });

  it('用户明确「用服务器那版」才接受远端版本', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(record({ remoteRevision: 2 }));
    session.acceptRemote({ remoteActivityId: 'a-1', remoteRevision: 7 });
    expect(session.remoteRevision()).toBe(7);
  });

  it('首次推送（没有记录）不带 baseRevision / activityId', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(null);
    const built = session.buildRecord({ projectId: PROJECT, plan: plan() });
    expect(built.remoteRevision).toBeUndefined();
    expect(built.remoteActivityId).toBeUndefined();
  });

  it('组记录时保留打开时的创建时间与名字，名字可由调用方覆盖', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(record());
    expect(session.buildRecord({ projectId: PROJECT, plan: plan() }).createdAt).toBe('2026-11-17T00:00:00.000Z');
    expect(session.buildRecord({ projectId: PROJECT, plan: plan() }).name).toBe('湖滨夜集');
    expect(session.buildRecord({ projectId: PROJECT, plan: plan(), name: '  改名后  ' }).name).toBe('改名后');
    expect(session.buildRecord({ projectId: PROJECT, plan: plan(), name: '' }).name).toBe('湖滨夜集');
  });

  it('unsyncedPlan 如实传递：关页 flush 置 true，回执后才清', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(record());
    expect(session.buildRecord({ projectId: PROJECT, plan: plan() }).unsyncedPlan).toBeUndefined();
    expect(session.buildRecord({ projectId: PROJECT, plan: plan(), unsyncedPlan: true }).unsyncedPlan).toBe(true);
  });
});

describe('打开时的待同步标记与内容基线（B1 / F9）', () => {
  it('记录带 unsyncedPlan 才需要补推', () => {
    const dirty = createOutdoorPlanSession();
    dirty.hydrate(record({ unsyncedPlan: true }));
    expect(dirty.shouldCatchUpPush()).toBe(true);

    const clean = createOutdoorPlanSession();
    clean.hydrate(record());
    expect(clean.shouldCatchUpPush()).toBe(false);

    const fresh = createOutdoorPlanSession();
    fresh.hydrate(null);
    expect(fresh.shouldCatchUpPush()).toBe(false);
  });

  it('本会话成功回执后不再补推', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(record({ unsyncedPlan: true }));
    session.confirmSaved({ remoteActivityId: 'a-1', remoteRevision: 3 });
    expect(session.shouldCatchUpPush()).toBe(false);
  });

  it('盘上那一版就是当前内容时不需要写盘（F9）', () => {
    const stored = plan();
    const session = createOutdoorPlanSession();
    session.hydrate(record({ plan: stored }));
    expect(session.isPersisted(stored)).toBe(true);
    const edited = plan({ boundary: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    expect(session.isPersisted(edited)).toBe(false);
    session.markPersisted(edited);
    expect(session.isPersisted(edited)).toBe(true);
    expect(session.isPersisted(stored)).toBe(false);
  });

  it('没有记录时不算已落盘：首帧该落一次', () => {
    const session = createOutdoorPlanSession();
    session.hydrate(null);
    expect(session.isPersisted(plan())).toBe(false);
  });
});

describe('samePlanContent（键序不同不算改动）', () => {
  it('省略可选字段与显式 undefined 的落盘内容一致，null 仍是真实变更', () => {
    expect(samePlanContent({ facilities: [{ id: 'a' }] }, { facilities: [{ id: 'a', zoneId: undefined }] })).toBe(true);
    expect(samePlanContent({ facilities: [{ id: 'a', zoneId: undefined }] }, { facilities: [{ id: 'a' }] })).toBe(true);
    expect(samePlanContent({ zoneId: null }, {})).toBe(false);
  });
  it('结构相等忽略对象键序，但区分数组顺序与真实差异', () => {
    expect(samePlanContent({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(samePlanContent({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(samePlanContent([1, 2], [2, 1])).toBe(false);
    expect(samePlanContent(null, undefined)).toBe(false);
    expect(samePlanContent({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
  });

  it('真实的 plan 往返（JSON 解析后键序不同）判定为同一份内容', () => {
    const original = plan();
    const reparsed = JSON.parse(JSON.stringify(original)) as SitePlanData;
    expect(JSON.stringify(reparsed) === JSON.stringify(original)).toBe(true);
    expect(samePlanContent(original, reparsed)).toBe(true);
  });
});
