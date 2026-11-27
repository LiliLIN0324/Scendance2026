import { describe, expect, it } from 'vitest';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { EventProfile } from '../../../lib/event-profile';
import type { DesignVariant, RoomLayout } from './types';
import { summarizeVariant } from './variant-summary';
import { makeItem, makeLayout, makeZone, makeFloor } from './__testfixtures__/fixtures';

function layoutWith(overrides: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout(overrides);
}

describe('summarizeVariant', () => {
  it('an empty layout counts everything as zero and leaves headcount absent', () => {
    const summary = summarizeVariant(layoutWith());
    expect(summary).toEqual({
      headcount: undefined,
      taskCount: 0,
      acquisitionCount: 0,
      staffingCount: 0,
      estimateCount: 0,
      itemCount: 0,
      chairCount: 0,
      tableCount: 0,
      otherItemCount: 0,
      zoneCount: 0,
    });
  });

  it('classifies chairs, tables and other items, and counts zones across floors', () => {
    const summary = summarizeVariant(layoutWith({
      floors: [makeFloor({
        items: [
          makeItem({ name: '椅子 A' }),
          makeItem({ name: '椅子 B' }),
          makeItem({ type: 'table', name: '桌子 A' }),
          makeItem({ type: 'plant', name: '绿植' }),
        ],
        zones: [makeZone(), makeZone({ id: 'zone-2', name: 'Zone 2' })],
      })],
    }));
    expect(summary.itemCount).toBe(4);
    expect(summary.chairCount).toBe(2);
    expect(summary.tableCount).toBe(1);
    expect(summary.otherItemCount).toBe(1);
    expect(summary.zoneCount).toBe(2);
  });

  it('takes headcount from the event profile attendance fact', () => {
    const withCount = summarizeVariant(layoutWith({
      eventProfile: { expectedAttendance: { value: 120 } } as unknown as EventProfile,
    }));
    expect(withCount.headcount).toBe(120);

    const withNull = summarizeVariant(layoutWith({
      eventProfile: { expectedAttendance: { value: null } } as unknown as EventProfile,
    }));
    expect(withNull.headcount).toBeUndefined();

    expect(summarizeVariant(layoutWith()).headcount).toBeUndefined();
  });

  it('counts tasks, acquisitions, staffing and estimates when present, zero otherwise', () => {
    const withPlan = summarizeVariant(layoutWith({
      eventOperations: { schemaVersion: 1, dataKind: 'unspecified', tasks: [{}, {}, {}] } as unknown as EventOperations,
      productionPlan: {
        staffing: [{}, {}],
        acquisitions: [{}],
        estimates: [{}, {}, {}, {}],
      } as unknown as ProductionPlan,
    }));
    expect(withPlan.taskCount).toBe(3);
    expect(withPlan.staffingCount).toBe(2);
    expect(withPlan.acquisitionCount).toBe(1);
    expect(withPlan.estimateCount).toBe(4);

    expect(summarizeVariant(layoutWith()).taskCount).toBe(0);
    expect(summarizeVariant(layoutWith()).staffingCount).toBe(0);
    expect(summarizeVariant(layoutWith()).acquisitionCount).toBe(0);
    expect(summarizeVariant(layoutWith()).estimateCount).toBe(0);
  });

  it('tolerates a legacy variant without summary or reference fields', () => {
    const legacy: DesignVariant = { id: 'legacy-1', name: '旧方案', layout: makeLayout() };
    expect(legacy.summary).toBeUndefined();
    expect(legacy.operationsRef).toBeUndefined();
    expect(legacy.planRef).toBeUndefined();
    expect(legacy.scan).toBeUndefined();
    expect(() => summarizeVariant(legacy.layout)).not.toThrow();
    expect(summarizeVariant(legacy.layout).itemCount).toBe(0);
  });
});
