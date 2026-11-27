import { describe, expect, it } from 'vitest';
import { eventOperationsSchema, type EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema, type ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout, makeZone } from './__testfixtures__/fixtures';
import { prepareVariantSaveAs, type VariantSaveAsDraft } from './variant-save-as';
import type { DesignVariant, RoomLayout, VariantSummary } from './types';

function ops(): EventOperations {
  return eventOperationsSchema.parse({ tasks: [{ id: crypto.randomUUID(), title: '签到布置', phase: 'setup' }] });
}
function plan(): ProductionPlan {
  return productionPlanSchema.parse({});
}

function geometryLayout(): RoomLayout {
  return makeLayout({
    id: 'variant-source-id',
    floors: [makeFloor({ items: [makeItem({ name: '椅子 A' })], zones: [makeZone()] })],
  });
}

function variant(overrides: Partial<DesignVariant> = {}): DesignVariant {
  return {
    id: 'snap-1',
    name: '迎宾区先落位',
    layout: geometryLayout(),
    origin: 'manual',
    savedAt: '2026-11-20T09:00:00.000Z',
    ...overrides,
  };
}

const summary: VariantSummary = {
  headcount: 120,
  taskCount: 3,
  acquisitionCount: 1,
  staffingCount: 2,
  estimateCount: 0,
  itemCount: 7,
  chairCount: 3,
  tableCount: 2,
  otherItemCount: 2,
  zoneCount: 2,
};

describe('prepareVariantSaveAs（T4 E3 逐变体另存纯函数）', () => {
  it('both slots record: geometry carried, two sidecar entries queued, refs pending, summary kept', () => {
    const result: VariantSaveAsDraft = prepareVariantSaveAs({
      sourceProjectId: 'house-src',
      variant: variant({
        operationsRef: '22222222-2222-4222-8222-222222222222',
        planRef: '33333333-3333-4333-8333-333333333333',
        scan: { assetId: 'scan-1' },
        summary,
      }),
      operations: { status: 'record', data: ops() },
      plan: { status: 'record', data: plan() },
    });

    expect(result.pendingRefs).toEqual({ operations: true, plan: true });
    expect(result.missingKinds).toEqual([]);
    expect(result.legacyUsed).toBe(false);
    expect(result.sidecarEntries).toHaveLength(2);
    expect(result.sidecarEntries.map(e => e.kind)).toEqual(['operations', 'plan']);
    // 条目只带 data，不沿用旧 recordId。
    for (const entry of result.sidecarEntries) {
      expect('recordId' in entry).toBe(false);
      expect('id' in entry).toBe(false);
    }
    expect(result.summary).toEqual(summary);
    expect(result.scan).toEqual({ assetId: 'scan-1' });
    // 几何物料与分区保留。
    expect(result.draft.floors[0]!.items).toHaveLength(1);
    expect(result.draft.floors[0]!.zones).toHaveLength(1);
  });

  it('legacy variant without refs: embedded copy read-only, not queued into new records, geometry still saved', () => {
    const embeddedOps = ops();
    const embeddedPlan = plan();
    const legacy: DesignVariant = { id: 'legacy-1', name: '旧方案', layout: geometryLayout() };
    const result = prepareVariantSaveAs({
      sourceProjectId: 'house-src',
      variant: legacy,
      operations: { status: 'fallback-legacy', data: embeddedOps },
      plan: { status: 'fallback-legacy', data: embeddedPlan },
    });

    expect(result.legacyUsed).toBe(true);
    expect(result.sidecarEntries).toEqual([]);
    expect(result.pendingRefs).toEqual({ operations: false, plan: false });
    expect(result.missingKinds).toEqual(['operations', 'plan']);
    // 内嵌副本没有被写进新草稿业务槽。
    expect(result.draft.eventOperations).toBeUndefined();
    expect(result.draft.productionPlan).toBeUndefined();
    expect(result.draft.venueScan).toBeUndefined();
    // 几何照常另存。
    expect(result.draft.floors[0]!.items).toHaveLength(1);
  });

  it('missing referenced record: no substitution, no legacy id carried, pending slot marked unresolved', () => {
    const result = prepareVariantSaveAs({
      sourceProjectId: 'house-src',
      variant: variant({
        operationsRef: '22222222-2222-4222-8222-222222222222',
        planRef: '33333333-3333-4333-8333-333333333333',
      }),
      operations: { status: 'missing', data: undefined },
      plan: { status: 'missing', data: undefined },
    });

    expect(result.sidecarEntries).toEqual([]);
    expect(result.pendingRefs).toEqual({ operations: false, plan: false });
    expect(result.missingKinds).toEqual(['operations', 'plan']);
    expect(result.draft.eventOperations).toBeUndefined();
  });

  it('pending resolution is treated as unresolved: not queued until the read resolves', () => {
    const result = prepareVariantSaveAs({
      sourceProjectId: 'house-src',
      variant: variant({ operationsRef: '22222222-2222-4222-8222-222222222222' }),
      operations: { status: 'pending', data: undefined },
      plan: { status: 'fallback-legacy', data: undefined },
    });

    expect(result.sidecarEntries).toEqual([]);
    expect(result.missingKinds).toEqual(['operations', 'plan']);
    expect(result.pendingRefs).toEqual({ operations: false, plan: false });
  });

  it('mixed record + missing: record slot queued, missing slot unresolved, slots do not pollute each other', () => {
    const result = prepareVariantSaveAs({
      sourceProjectId: 'house-src',
      variant: variant({ operationsRef: '22222222-2222-4222-8222-222222222222' }),
      operations: { status: 'record', data: ops() },
      plan: { status: 'missing', data: undefined },
    });

    expect(result.sidecarEntries).toEqual([{ kind: 'operations', data: expect.any(Object) }]);
    expect(result.pendingRefs).toEqual({ operations: true, plan: false });
    expect(result.missingKinds).toEqual(['plan']);
    expect(result.legacyUsed).toBe(false);
  });

  it('absent summary stays undefined; no on-the-fly recompute from geometry', () => {
    const result = prepareVariantSaveAs({
      sourceProjectId: 'house-src',
      variant: variant(),
      operations: { status: 'fallback-legacy', data: undefined },
      plan: { status: 'fallback-legacy', data: undefined },
    });
    expect(result.summary).toBeUndefined();
  });

  it('does not mutate the variant layout or the resolution inputs', () => {
    const sourceLayout = geometryLayout();
    const opsInput = { status: 'record', data: ops() } as const;
    const planInput = { status: 'record', data: plan() } as const;
    const beforeLayout = structuredClone(sourceLayout);
    prepareVariantSaveAs({
      sourceProjectId: 'house-src',
      variant: variant({ layout: sourceLayout }),
      operations: opsInput,
      plan: planInput,
    });
    expect(sourceLayout).toEqual(beforeLayout);
    expect(opsInput.data.tasks).toHaveLength(1);
  });

  it('draft keeps geometry markers but drops legacy id, business slots and old refs', () => {
    const result = prepareVariantSaveAs({
      sourceProjectId: 'house-src',
      variant: variant({
        operationsRef: '22222222-2222-4222-8222-222222222222',
        planRef: '33333333-3333-4333-8333-333333333333',
        scan: { assetId: 'scan-1' },
      }),
      operations: { status: 'record', data: ops() },
      plan: { status: 'record', data: plan() },
    });

    expect(result.draft.id).toBeUndefined();
    expect(result.draft.name).toBe('迎宾区先落位');
    // 业务三键不落新草稿；旧 ref / scan 身份不复制进草稿几何（由壳侧按新记录重挂）。
    expect(result.draft.eventOperations).toBeUndefined();
    expect(result.draft.productionPlan).toBeUndefined();
    expect(result.draft.venueScan).toBeUndefined();
    expect(result.draft.floors[0]!.items[0]!.name).toBe('椅子 A');
  });
});
