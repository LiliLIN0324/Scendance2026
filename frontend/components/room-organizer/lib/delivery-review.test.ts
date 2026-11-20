import { describe, expect, it } from 'vitest';
import { materialCheckinLedgerSchema } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { summarizeDeliveryGaps } from './delivery-review';
import type { RoomLayout } from './types';
import type { EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function task(overrides: Partial<EventOperationTask> = {}): EventOperationTask {
  return {
    id: id(1), title: '签到台布置', phase: 'setup',
    plannedStartAt: null, plannedEndAt: null,
    ownerName: '', contractorName: '', acceptance: '', status: 'todo', objectIds: [],
    evidenceNote: '', evidenceUrls: [],
    actualStartedAt: null, actualFinishedAt: null, ...overrides,
  };
}

describe('summarizeDeliveryGaps', () => {
  it('reports no gaps when the local ledger is empty', () => {
    const layout = makeLayout();
    const result = summarizeDeliveryGaps({ layout });
    expect(result.total).toBe(0);
    expect(result.counts).toEqual({ operations: 0, workorders: 0, plan: 0, checkins: 0 });
  });

  it('scans operation tasks for missing owner, acceptance, time and linked objects', () => {
    const missingObject = id(2);
    const layout = makeLayout({
      eventOperations: { schemaVersion: 1, dataKind: 'rehearsal', tasks: [task({ objectIds: [missingObject] })] },
    }) as RoomLayout;
    const result = summarizeDeliveryGaps({ layout });
    expect(result.counts.operations).toBe(1);
    const gap = result.gaps.find(entry => entry.group === 'operations');
    expect(gap?.title).toBe('签到台布置');
    expect(gap?.details).toEqual(expect.arrayContaining(['缺负责人', '缺完成条件', '缺计划时间', '关联物料缺失 1 件']));
  });

  it('does not flag an item without a handoff work order, but flags an incomplete handoff', () => {
    const bare = makeItem({ id: id(3), name: '未填工作单的椅子' });
    const handoff = makeItem({ id: id(4), name: '待补工作单的桌子', handoff: { ownerName: '', dueDate: '', acceptance: '', status: 'todo', evidenceUrls: [], evidenceNote: '', reviewedBasis: undefined } });
    const layout = makeLayout({ floors: [makeFloor({ items: [bare, handoff] })] });
    const result = summarizeDeliveryGaps({ layout });
    expect(result.counts.workorders).toBe(1);
    const gap = result.gaps.find(entry => entry.objectId === id(4));
    expect(gap?.details).toEqual(expect.arrayContaining(['缺负责人', '缺期限', '缺验收条件']));
  });

  it('scans the production plan for unassigned staffing, unknown headcount and budget overrun', () => {
    const plan = productionPlanSchema.parse({
      staffing: [{ id: id(5), roleName: '签到岗位', taskIds: [id(6)], headcount: null, sourceType: 'unspecified' }],
      acquisitions: [],
      estimates: [{ id: id(7), title: '舞台估算', amountMinor: 20000, basisNote: '报价依据', taskIds: [], objectIds: [] }],
      budget: { limitMinor: 10000, scopeNote: '覆盖舞台', basisNote: '预算口径' },
    });
    const layout = makeLayout({ productionPlan: plan });
    const result = summarizeDeliveryGaps({ layout });
    expect(result.counts.plan).toBe(2);
    const staffing = result.gaps.find(entry => entry.refId === id(5));
    expect(staffing?.details).toEqual(expect.arrayContaining(['任务引用缺失 1 项', '人数待核', '用工来源未定']));
    const budget = result.gaps.find(entry => entry.refId === 'budget');
    expect(budget?.details).toEqual(['已录入估算合计超过预算上限']);
  });

  it('flags a disputed check-in sheet', () => {
    const ledger = materialCheckinLedgerSchema.parse({
      projectId: 'project-1',
      sheets: [{
        id: id(8), acquisitionId: id(9),
        acquisitionSnapshot: { title: '庆典椅子', supplierName: '', specificationNote: '' },
        unit: 'piece',
        agreements: [{ id: id(10), recordedAt: '2026-10-08T08:00:00+08:00', recordedBy: '张', agreedQuantity: 10, basisNote: '布置清单' }],
        events: [{
          id: id(11), recordedAt: '2026-10-08T09:00:00+08:00', recordedBy: '张', kind: 'receive',
          batchRef: 'B1', quantity: 9, checkState: 'disputed', occurredAt: '2026-10-08T08:30:00+08:00',
          fromPartyName: '供应商', toPartyName: '主办方', evidenceNote: '', evidenceUrls: [],
        }],
      }],
    });
    const layout = makeLayout();
    const result = summarizeDeliveryGaps({ layout, checkins: ledger });
    expect(result.counts.checkins).toBe(1);
    expect(result.gaps[0].title).toBe('庆典椅子');
    expect(result.gaps[0].details).toContain('存在争议的点验记录');
  });
});
