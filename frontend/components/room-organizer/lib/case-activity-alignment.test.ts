// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { saveOutdoorProjectRecord, clearOutdoorProjectRecord } from './outdoor-project-store';
import { caseActivityAlignment } from './case-activity-alignment';
import type { RoomLayout } from './types';

const replicaId = 'replica-banbury-town-council-coronation-events';
const recordName = '经典案例 · Banbury Town Council – Coronation Events';

function layout(id: string, name = '新活动 11-17 23:37'): RoomLayout {
  return {
    id, name,
    scenePreset: 'outdoor' as const,
    floors: [{ id: 'floor-1', name: '一层', width: 10, depth: 8, height: 3, items: [], zones: [] }],
  } as unknown as RoomLayout;
}

afterEach(() => {
  clearOutdoorProjectRecord(replicaId);
});

describe('caseActivityAlignment（经典案例 × 活动身份对齐）', () => {
  it('案例打开时把当前活动身份换成案例记录的 id 与名字（同一 id 复用）', () => {
    saveOutdoorProjectRecord({
      v: 1, projectId: replicaId, name: recordName,
      createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z', plan: null,
    });
    const aligned = caseActivityAlignment({ projectId: replicaId, current: layout('house-abc123') });
    expect(aligned).not.toBeNull();
    expect(aligned!.id).toBe(replicaId);
    expect(aligned!.name).toBe(recordName);
    // 其余字段原样保留。
    expect(aligned!.floors).toHaveLength(1);
  });

  it('当前活动已经是该案例时不重复换', () => {
    saveOutdoorProjectRecord({
      v: 1, projectId: replicaId, name: recordName,
      createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z', plan: null,
    });
    expect(caseActivityAlignment({ projectId: replicaId, current: layout(replicaId, recordName) })).toBeNull();
  });

  it('画布正绑着云项目时不动身份，避免拆掉云端编辑绑定', () => {
    saveOutdoorProjectRecord({
      v: 1, projectId: replicaId, name: recordName,
      createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z', plan: null,
    });
    const cloudBound = layout('f53362f1-65d1-4527-aba0-ef48cc2bb1d0');
    expect(caseActivityAlignment({ projectId: replicaId, current: cloudBound, boundCloudProjectId: 'f53362f1-65d1-4527-aba0-ef48cc2bb1d0' })).toBeNull();
  });

  it('非 replica- 前缀的显式项目（云项目/默认壳体）不对齐', () => {
    expect(caseActivityAlignment({ projectId: 'f53362f1-65d1-4527-aba0-ef48cc2bb1d0', current: layout('house-abc123') })).toBeNull();
    expect(caseActivityAlignment({ projectId: 'default-outdoor', current: layout('house-abc123') })).toBeNull();
  });

  it('本机记录不存在时不对齐（案例数据还没落盘）', () => {
    expect(caseActivityAlignment({ projectId: 'replica-never-saved', current: layout('house-abc123') })).toBeNull();
  });
});
