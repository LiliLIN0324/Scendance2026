import { describe, expect, it } from 'vitest';
import rehearsalExample from '../../docs/examples/30-person-rehearsal-operations.json';
import { canonical } from '../../supabase/functions/_shared/domain';
import {
  eventOperationsLimits,
  eventOperationsSchema,
  type EventOperations,
} from '../../supabase/functions/_shared/event-operations-contract';
import {
  materialCheckinLedgerSchema,
  materialCheckinSheetSchema,
} from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { operationBasis, operationReview } from '../components/room-organizer/lib/event-operations';
import {
  acceptActivityTaskSuggestions,
  buildActivityTaskContext,
  prepareActivityTaskSuggestions,
} from './activity-task-suggestions';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const id = (n: number) => `a3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PROJECT_ID = id(1);
const OBJECT_A = id(701);
const OBJECT_B = id(702);
const CHECKIN_ACQUISITION = id(811);
const CHECKIN_SHEET = id(812);
const CHECKIN_AGREEMENT = id(813);

type ActivityInput = Parameters<typeof buildActivityTaskContext>[0];
type ActivityContext = Awaited<ReturnType<typeof buildActivityTaskContext>>;
type ActivityProposal = ReturnType<typeof prepareActivityTaskSuggestions>;

function rehearsalOperations(): EventOperations {
  const operations = eventOperationsSchema.parse(structuredClone(rehearsalExample));
  operations.tasks[0] = { ...operations.tasks[0], objectIds: [OBJECT_A, OBJECT_B] };
  operations.tasks[1] = { ...operations.tasks[1], objectIds: [OBJECT_B] };
  return operations;
}

function rehearsalLayout(overrides: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout({
    id: PROJECT_ID,
    name: '30人共创演练',
    width: 12,
    height: 9,
    floors: [makeFloor({ id: 'ground', items: [
      makeItem({
        id: OBJECT_A,
        type: 'table',
        name: '签到台',
        width: 0.8,
        depth: 0.5,
        height: 0.9,
        color: '#d97706',
        position: { x: 1, z: 2 },
        rotation: 0.25,
        elevation: 0.1,
        notes: 'PRIVATE_ITEM_NOTE',
        assetId: id(799),
        glbUrl: 'https://private.example/model.glb?token=PRIVATE_TOKEN',
      }),
      makeItem({
        id: OBJECT_B,
        type: 'chair',
        name: '演练椅',
        width: 0.5,
        depth: 0.5,
        height: 0.85,
        color: '#2563eb',
        position: { x: 2, z: 2 },
      }),
    ] })],
    eventOperations: rehearsalOperations(),
    ...overrides,
  });
}

function activityInput(
  layout: RoomLayout = rehearsalLayout(),
  overrides: {
    briefText?: string;
    taskIds?: string[];
    objectIds?: string[];
    checkins?: ActivityInput['checkins'];
    dataKind?: ActivityInput['dataKind'];
  } = {},
): ActivityInput {
  const tasks = layout.eventOperations?.tasks ?? [];
  const taskIds = overrides.taskIds ?? tasks.slice(0, 2).map(task => task.id);
  const objectIds = overrides.objectIds ?? [OBJECT_A];
  return {
    layout,
    selection: {
      briefText: overrides.briefText ?? '30人演练：签到、布场与撤场，未确认的费用和联系人不进入建议。',
      taskIds,
      objectIds,
    },
    ...(overrides.checkins === undefined ? {} : { checkins: overrides.checkins }),
    ...(overrides.dataKind === undefined ? {} : { dataKind: overrides.dataKind }),
  } as ActivityInput;
}

function validResponse(objectId = OBJECT_A) {
  return {
    suggestions: [{
      title: '核对签到台摆放',
      phase: 'setup',
      acceptance: '按当前演练资料核对签到台位置并记录未确认项。',
      objectIds: [objectId],
    }],
  };
}

async function validContext(): Promise<{ input: ActivityInput; context: ActivityContext }> {
  const input = activityInput();
  return { input, context: await buildActivityTaskContext(input) };
}

async function validProposal(): Promise<{
  input: ActivityInput;
  context: ActivityContext;
  proposal: ActivityProposal;
}> {
  const { input, context } = await validContext();
  return {
    input,
    context,
    proposal: prepareActivityTaskSuggestions(context, validResponse(), 'synthetic-30-person'),
  };
}

function checkinLedger(projectId: string, dataKind: 'unspecified' | 'rehearsal' | 'real') {
  const sheet = materialCheckinSheetSchema.parse({
    id: CHECKIN_SHEET,
    acquisitionId: CHECKIN_ACQUISITION,
    acquisitionSnapshot: { title: '演练签到台取得', supplierName: '', specificationNote: '' },
    unit: 'piece',
    agreements: [{
      id: CHECKIN_AGREEMENT,
      agreedQuantity: 1,
      basisNote: '演练资料中的手工约定',
      recordedAt: '2026-10-09T08:00:00+08:00',
      recordedBy: '演练记录人',
    }],
  });
  return materialCheckinLedgerSchema.parse({ projectId, dataKind, sheets: [sheet] });
}

function withAcquisition(layout: RoomLayout, dataKind: 'unspecified' | 'rehearsal' | 'real'): RoomLayout {
  return {
    ...layout,
    productionPlan: productionPlanSchema.parse({
      dataKind,
      acquisitions: [{
        id: CHECKIN_ACQUISITION,
        title: '演练签到台取得',
        taskIds: [layout.eventOperations!.tasks[0].id],
        objectIds: [OBJECT_A],
      }],
    }),
  };
}

function boundedOperations(count: number): EventOperations {
  return eventOperationsSchema.parse({
    dataKind: 'rehearsal',
    tasks: Array.from({ length: count }, (_, index) => ({
      id: id(10000 + index),
      title: `已有任务${index}`,
      phase: 'setup',
      acceptance: '保留已有条件',
    })),
  });
}

describe('activity task suggestion context', () => {
  it('uses the 30-person rehearsal fixture and exposes only selected, non-private context', async () => {
    const { context } = await validContext();
    const firstTask = context.summary.tasks[0];
    const firstObject = context.summary.objects[0];

    expect(context.summary.projectId).toBe(PROJECT_ID);
    expect(context.summary.dataKind).toBe('rehearsal');
    expect(context.summary.briefText).toContain('30人演练');
    expect(context.summary.tasks.map(task => task.id)).toEqual([
      rehearsalExample.tasks[0].id,
      rehearsalExample.tasks[1].id,
    ]);
    expect(firstTask.objectIds).toEqual([OBJECT_A]);
    expect(JSON.stringify(context)).not.toContain(OBJECT_B);
    expect(JSON.stringify(context)).not.toContain('PRIVATE_ITEM_NOTE');
    expect(JSON.stringify(context)).not.toContain('PRIVATE_TOKEN');
    expect(Object.keys(context.summary).sort()).toEqual(['briefText', 'dataKind', 'objects', 'projectId', 'tasks']);
    expect(Object.keys(firstTask).sort()).toEqual([
      'acceptance', 'id', 'objectIds', 'phase', 'plannedEndAt', 'plannedStartAt', 'status', 'title',
    ]);
    expect(Object.keys(firstObject).sort()).toEqual([
      'color', 'elevation', 'floorId', 'floorName', 'id', 'name', 'position', 'rotation', 'size', 'type',
    ]);
    expect(firstObject).toMatchObject({
      id: OBJECT_A,
      name: '签到台',
      type: 'table',
      floorId: 'ground',
      floorName: 'Ground Floor',
      size: { width: 0.8, depth: 0.5, height: 0.9 },
      position: { x: 1, z: 2 },
      rotation: 0.25,
      elevation: 0.1,
    });
    expect(context.source).toMatchObject({ projectId: PROJECT_ID, dataKind: 'rehearsal' });
    expect(context.source.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('keeps same-coordinate objects distinct by their real floor identity and expires after a floor rename', async () => {
    const layout = rehearsalLayout({
      floors: [
        makeFloor({ id: 'ground', name: 'Ground Floor', items: [makeItem({
          id: OBJECT_A, name: '一层签到台', type: 'table', position: { x: 1, z: 2 },
        })] }),
        makeFloor({ id: 'gallery', name: 'Gallery Floor', items: [makeItem({
          id: OBJECT_B, name: '二层签到台', type: 'table', position: { x: 1, z: 2 },
        })] }),
      ],
    });
    const input = activityInput(layout, { taskIds: [], objectIds: [OBJECT_A, OBJECT_B] });
    const context = await buildActivityTaskContext(input);
    expect(context.summary.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: OBJECT_A, floorId: 'ground', floorName: 'Ground Floor', position: { x: 1, z: 2 },
      }),
      expect.objectContaining({
        id: OBJECT_B, floorId: 'gallery', floorName: 'Gallery Floor', position: { x: 1, z: 2 },
      }),
    ]));
    expect(new Set(context.summary.objects.map(item => `${item.floorId}:${item.floorName}`))).toEqual(
      new Set(['ground:Ground Floor', 'gallery:Gallery Floor']),
    );

    const proposal = prepareActivityTaskSuggestions(context, validResponse(OBJECT_A), 'synthetic-30-person');
    const renamed = structuredClone(layout);
    renamed.floors[1].name = 'Gallery Renamed';
    await expect(acceptActivityTaskSuggestions(
      activityInput(renamed, { taskIds: [], objectIds: [OBJECT_A, OBJECT_B] }),
      proposal,
      [proposal.tasks[0].id],
    )).rejects.toThrow();
  });

  it.each([undefined, '', '  ', 'local'] as const)('rejects a missing or public local project id: %j', async projectId => {
    const layout = rehearsalLayout();
    if (projectId === undefined) delete layout.id;
    else layout.id = projectId;
    await expect(buildActivityTaskContext(activityInput(layout))).rejects.toThrow();
  });

  it('accepts a legacy non-UUID project id without using a shared local fallback', async () => {
    const layout = rehearsalLayout({ id: 'legacy-project-30' });
    const context = await buildActivityTaskContext(activityInput(layout));
    expect(context.summary.projectId).toBe('legacy-project-30');
    expect(context.source.projectId).toBe('legacy-project-30');
  });

  it('requires all three selection fields and refuses an absent event document unless dataKind is explicit', async () => {
    const layout = rehearsalLayout();
    await expect(buildActivityTaskContext({
      layout,
      selection: { briefText: '', taskIds: [] },
    } as never)).rejects.toThrow();
    await expect(buildActivityTaskContext({
      layout,
      selection: { briefText: '', objectIds: [] },
    } as never)).rejects.toThrow();

    const emptyLayout = makeLayout({ id: id(3), floors: [makeFloor()] });
    await expect(buildActivityTaskContext(activityInput(emptyLayout))).rejects.toThrow();
    const empty = await buildActivityTaskContext({
      layout: emptyLayout,
      dataKind: 'unspecified',
      selection: { briefText: '', taskIds: [], objectIds: [] },
    });
    expect(empty.summary).toMatchObject({ projectId: id(3), dataKind: 'unspecified', briefText: '', tasks: [], objects: [] });
  });

  it('preserves an explicit unspecified kind and rejects a caller kind that disagrees with EventOperations', async () => {
    const layout = rehearsalLayout();
    await expect(buildActivityTaskContext(activityInput(layout, { dataKind: 'real' }))).rejects.toThrow();
    const context = await buildActivityTaskContext(activityInput(layout, { dataKind: 'rehearsal' }));
    expect(context.summary.dataKind).toBe('rehearsal');
  });

  it('keeps UUID aliases connected, treats opaque ids exactly, and rejects ambiguous source ids', async () => {
    const aliasContext = await buildActivityTaskContext(activityInput(rehearsalLayout(), {
      taskIds: [rehearsalOperations().tasks[0].id.toUpperCase()],
      objectIds: [OBJECT_A.toUpperCase()],
    }));
    expect(aliasContext.summary.tasks[0].id).toBe(rehearsalExample.tasks[0].id);
    expect(aliasContext.summary.objects[0].id).toBe(OBJECT_A);

    const legacy = rehearsalLayout({ floors: [makeFloor({ items: [makeItem({ id: 'opaque-Object-A', name: '旧物件' })] })] });
    legacy.eventOperations = eventOperationsSchema.parse({
      dataKind: 'rehearsal',
      tasks: [{ ...rehearsalOperations().tasks[0], objectIds: ['opaque-Object-A'] }],
    });
    await expect(buildActivityTaskContext(activityInput(legacy, { objectIds: ['opaque-object-a'] }))).rejects.toThrow();
    const exactLegacy = await buildActivityTaskContext(activityInput(legacy, { objectIds: ['opaque-Object-A'] }));
    expect(exactLegacy.summary.objects[0].id).toBe('opaque-Object-A');

    const ambiguous = rehearsalLayout({ floors: [makeFloor({ items: [
      makeItem({ id: OBJECT_A, name: 'A' }),
      makeItem({ id: OBJECT_A.toUpperCase(), name: 'A别名' }),
    ] })] });
    await expect(buildActivityTaskContext(activityInput(ambiguous))).rejects.toThrow();
  });

  it('uses operationReview for effective task status and retains the accepted basis boundary', async () => {
    const layout = rehearsalLayout();
    const task = layout.eventOperations!.tasks[0];
    task.objectIds = [OBJECT_A];
    task.ownerName = '演练负责人';
    task.acceptance = '核对签到台位置';
    task.evidenceNote = '演练核对说明';
    task.status = 'accepted';
    task.reviewedBasis = await operationBasis(layout, task);
    expect((await operationReview(layout, task)).status).toBe('accepted');
    const accepted = await buildActivityTaskContext(activityInput(layout));
    expect(accepted.summary.tasks[0].status).toBe('accepted');

    layout.floors[0].items[0].position = { x: 8, z: 8 };
    const changed = await buildActivityTaskContext(activityInput(layout));
    expect(changed.summary.tasks[0].status).toBe('needs_review');
    expect(changed.summary.tasks[0].acceptance).toBe('核对签到台位置');
  });

  it('rejects a mismatched production kind only when its selected task/object participates in the context', async () => {
    const layout = withAcquisition(rehearsalLayout(), 'real');
    await expect(buildActivityTaskContext(activityInput(layout))).rejects.toThrow();
    await expect(buildActivityTaskContext(activityInput(layout, { taskIds: [], objectIds: [] }))).resolves.toBeDefined();
  });

  it('rejects a mismatched or foreign check-in ledger only for a selected related basis', async () => {
    const layout = withAcquisition(rehearsalLayout(), 'rehearsal');
    const mismatch = checkinLedger(PROJECT_ID, 'real');
    await expect(buildActivityTaskContext(activityInput(layout, { checkins: mismatch }))).rejects.toThrow();
    await expect(buildActivityTaskContext(activityInput(layout, { taskIds: [], objectIds: [], checkins: mismatch }))).resolves.toBeDefined();

    const foreign = checkinLedger(id(999), 'rehearsal');
    await expect(buildActivityTaskContext(activityInput(layout, { checkins: foreign }))).rejects.toThrow();
  });

  it('ignores an unrelated foreign ledger when no production basis participates, with or without a production plan', async () => {
    const foreign = checkinLedger(id(999), 'real');
    const withoutProduction = rehearsalLayout();
    const plain = await buildActivityTaskContext(activityInput(withoutProduction));
    const plainWithForeignLedger = await buildActivityTaskContext(activityInput(withoutProduction, { checkins: foreign }));
    expect(plainWithForeignLedger.source.fingerprint).toBe(plain.source.fingerprint);

    const unrelated = rehearsalLayout({
      productionPlan: productionPlanSchema.parse({
        dataKind: 'rehearsal',
        acquisitions: [{
          id: CHECKIN_ACQUISITION,
          title: '未选中的物件取得',
          taskIds: [rehearsalOperations().tasks[2].id],
          objectIds: ['unrelated-object-id'],
        }],
      }),
    });
    const selected = activityInput(unrelated, {
      taskIds: [unrelated.eventOperations!.tasks[0].id],
      objectIds: [OBJECT_A],
    });
    const unrelatedPlain = await buildActivityTaskContext(selected);
    const unrelatedWithForeignLedger = await buildActivityTaskContext({ ...selected, checkins: foreign });
    expect(unrelatedWithForeignLedger.source.fingerprint).toBe(unrelatedPlain.source.fingerprint);
  });

  it('snapshots the source synchronously before its asynchronous review and never mutates the input', async () => {
    const layout = rehearsalLayout();
    const input = activityInput(layout);
    const before = canonical(layout.eventOperations);
    const pending = buildActivityTaskContext(input);
    layout.floors[0].items[0].position = { x: 99, z: 99 };
    layout.eventOperations!.tasks[0].title = '后来修改的原任务';
    const context = await pending;

    expect(context.summary.objects[0].position).toEqual({ x: 1, z: 2 });
    expect(context.summary.tasks[0].title).toBe(rehearsalExample.tasks[0].title);
    expect(canonical(input.layout.eventOperations)).not.toBe(before);
  });
});

describe('prepareActivityTaskSuggestions', () => {
  it('accepts an explicit synthetic response, creates fresh todo operations, and preserves the disclosed item id', async () => {
    const { context } = await validContext();
    const response = validResponse(OBJECT_A.toUpperCase());
    const before = structuredClone(response);
    const proposal = prepareActivityTaskSuggestions(context, response, 'synthetic-30-person');
    const task = proposal.tasks[0];

    expect(proposal.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(proposal.source).toEqual(context.source);
    expect(proposal.sourceLabel).toBe('synthetic-30-person');
    expect(task).toMatchObject({
      title: '核对签到台摆放',
      phase: 'setup',
      acceptance: '按当前演练资料核对签到台位置并记录未确认项。',
      objectIds: [OBJECT_A],
      status: 'todo',
      ownerName: '',
      contractorName: '',
      plannedStartAt: null,
      plannedEndAt: null,
      actualStartedAt: null,
      actualFinishedAt: null,
      evidenceNote: '',
      evidenceUrls: [],
    });
    expect(task.id).not.toBe(rehearsalExample.tasks[0].id);
    expect(task.reviewedBasis).toBeUndefined();
    expect(response).toEqual(before);
  });

  it('allows a project-level suggestion with no object association and rejects undisclosed references', async () => {
    const { context } = await validContext();
    const noObject = prepareActivityTaskSuggestions(context, {
      suggestions: [{ title: '签到引导', phase: 'event', acceptance: '说明入口和求助方式。' }],
    }, 'synthetic-30-person');
    expect(noObject.tasks[0].objectIds).toEqual([]);
    expect(() => prepareActivityTaskSuggestions(context, validResponse(OBJECT_B), 'synthetic-30-person')).toThrow();
  });

  it.each([
    { suggestions: [] },
    { suggestions: [{ title: '   ', phase: 'setup', acceptance: '有效条件' }] },
    { suggestions: [{ title: '标题', phase: 'unknown', acceptance: '有效条件' }] },
    { suggestions: [{ title: '标题', phase: 'setup', acceptance: '   ' }] },
    { suggestions: [{ title: '标题', phase: 'setup', acceptance: '有效条件', ownerName: '不能传入' }] },
  ])('rejects malformed or over-disclosed synthetic rows: %o', async response => {
    const { context } = await validContext();
    expect(() => prepareActivityTaskSuggestions(context, response, 'synthetic-30-person')).toThrow();
  });

  it('rejects an unknown response key, a duplicate row, and a suggestion count above the event limit', async () => {
    const { context } = await validContext();
    expect(() => prepareActivityTaskSuggestions(context, {
      suggestions: [{ ...validResponse().suggestions[0], unexpected: 'private' }],
    }, 'synthetic-30-person')).toThrow();
    const row = validResponse().suggestions[0];
    expect(() => prepareActivityTaskSuggestions(context, { suggestions: [row, row] }, 'synthetic-30-person')).toThrow();

    const tooMany = Array.from({ length: eventOperationsLimits.tasks + 1 }, (_, index) => ({
      title: `建议 ${index}`,
      phase: 'setup' as const,
      acceptance: `核对条件 ${index}`,
    }));
    expect(() => prepareActivityTaskSuggestions(context, { suggestions: tooMany }, 'synthetic-30-person')).toThrow();
  });
});

describe('acceptActivityTaskSuggestions', () => {
  it('appends only selected todo tasks, preserves originals, and leaves the source layout untouched', async () => {
    const { input, proposal } = await validProposal();
    const beforeLayout = canonical(input.layout);
    const beforeOperations = canonical(input.layout.eventOperations);
    const selected = proposal.tasks.map(task => task.id);
    const result = await acceptActivityTaskSuggestions(input, proposal, selected);

    expect(result.status).toBe('accepted');
    expect(result.operations).toBeDefined();
    expect(result.addedTaskIds).toEqual(selected);
    expect(result.receipt).toMatchObject({ projectId: PROJECT_ID, acceptedTaskIds: selected });
    expect(result.receipt.proposalId).toBe(proposal.id);
    expect(result.operations!.tasks.slice(0, input.layout.eventOperations!.tasks.length)).toEqual(input.layout.eventOperations!.tasks);
    expect(result.operations!.tasks.slice(-proposal.tasks.length)).toEqual(proposal.tasks);
    expect(result.operations!.tasks.every(task => task.status === 'todo')).toBe(true);
    expect(canonical(input.layout.eventOperations)).toBe(beforeOperations);
    expect(canonical(input.layout)).toBe(beforeLayout);
  });

  it.each([
    { selected: [] as string[] },
    { selected: ['not-a-proposal-id'] },
  ])('rejects an empty or foreign selected-id set: %o', async ({ selected }: { selected: string[] }) => {
    const { input, proposal } = await validProposal();
    await expect(acceptActivityTaskSuggestions(input, proposal, selected)).rejects.toThrow();
  });

  it('rejects duplicate selections and partial follow-up selection under the same receipt', async () => {
    const { input, context } = await validContext();
    const proposal = prepareActivityTaskSuggestions(context, {
      suggestions: [
        { title: '先核对签到台', phase: 'setup', acceptance: '记录签到台核对结果。', objectIds: [OBJECT_A] },
        { title: '再核对撤场', phase: 'teardown', acceptance: '记录撤场清点结果。' },
      ],
    }, 'synthetic-30-person');
    await expect(acceptActivityTaskSuggestions(input, proposal, [proposal.tasks[0].id, proposal.tasks[0].id])).rejects.toThrow();

    const first = await acceptActivityTaskSuggestions(input, proposal, [proposal.tasks[0].id]);
    await expect(acceptActivityTaskSuggestions(input, proposal, [proposal.tasks[1].id], first.receipt)).rejects.toThrow();
  });

  it('keeps the same proposal ids when a simulated save fails before the layout changes', async () => {
    const { input, proposal } = await validProposal();
    const first = await acceptActivityTaskSuggestions(input, proposal, [proposal.tasks[0].id]);
    const retry = await acceptActivityTaskSuggestions(input, proposal, [proposal.tasks[0].id]);

    expect(first.addedTaskIds).toEqual([proposal.tasks[0].id]);
    expect(retry.addedTaskIds).toEqual(first.addedTaskIds);
    expect(input.layout.eventOperations!.tasks.some(task => task.id === proposal.tasks[0].id)).toBe(false);
    expect(proposal.tasks.map(task => task.id)).toEqual([proposal.tasks[0].id]);
  });

  it('treats a repeated receipt as closed without overwriting later manual edits', async () => {
    const { input, proposal } = await validProposal();
    const first = await acceptActivityTaskSuggestions(input, proposal, [proposal.tasks[0].id]);
    const current = structuredClone(input.layout);
    current.eventOperations = structuredClone(first.operations)!;
    current.eventOperations.tasks.at(-1)!.title = '人工修改后的建议任务';
    const repeat = await acceptActivityTaskSuggestions(
      activityInput(current), proposal, [proposal.tasks[0].id], first.receipt,
    );

    expect(repeat.status).toBe('closed');
    expect(repeat.addedTaskIds).toEqual([]);
    expect(repeat.operations!.tasks.at(-1)!.title).toBe('人工修改后的建议任务');
  });

  it('does not resurrect a task deleted after receipt confirmation, including a completely cleared document', async () => {
    const { input, proposal } = await validProposal();
    const first = await acceptActivityTaskSuggestions(input, proposal, [proposal.tasks[0].id]);

    const deleted = structuredClone(input.layout);
    deleted.eventOperations = structuredClone(input.layout.eventOperations);
    const currentIds = new Set([proposal.tasks[0].id]);
    deleted.eventOperations!.tasks = deleted.eventOperations!.tasks.filter(task => !currentIds.has(task.id));
    const afterDelete = await acceptActivityTaskSuggestions(
      activityInput(deleted), proposal, [proposal.tasks[0].id], first.receipt,
    );
    expect(afterDelete.status).toBe('closed');
    expect(afterDelete.addedTaskIds).toEqual([]);
    expect(afterDelete.operations!.tasks.some(task => task.id === proposal.tasks[0].id)).toBe(false);

    const cleared = structuredClone(input.layout);
    cleared.eventOperations = undefined;
    const afterClear = await acceptActivityTaskSuggestions(
      activityInput(cleared, {
        dataKind: 'rehearsal',
        taskIds: [...input.selection.taskIds],
        objectIds: [...input.selection.objectIds],
      }), proposal, [proposal.tasks[0].id], first.receipt,
    );
    expect(afterClear.status).toBe('closed');
    expect(afterClear.addedTaskIds).toEqual([]);
    expect(afterClear.operations).toBeUndefined();
  });

  it('rejects an unreceipted proposal after the current source changes', async () => {
    const { input, proposal } = await validProposal();
    const changedBrief = activityInput(input.layout, { briefText: '需求已改，旧建议过期。' });
    await expect(acceptActivityTaskSuggestions(changedBrief, proposal, [proposal.tasks[0].id])).rejects.toThrow();

    const changedTask = structuredClone(input.layout);
    changedTask.eventOperations!.tasks[0].acceptance = '后来改过的原任务条件';
    await expect(acceptActivityTaskSuggestions(
      activityInput(changedTask), proposal, [proposal.tasks[0].id],
    )).rejects.toThrow();

    const changedObject = structuredClone(input.layout);
    changedObject.floors[0].items[0].position = { x: 7, z: 7 };
    await expect(acceptActivityTaskSuggestions(
      activityInput(changedObject), proposal, [proposal.tasks[0].id],
    )).rejects.toThrow();
  });

  it('rejects a stale project/data-kind source and an existing id collision instead of silently rebasing', async () => {
    const { input, proposal } = await validProposal();
    const changedProject = structuredClone(input.layout);
    changedProject.id = id(9000);
    await expect(acceptActivityTaskSuggestions(
      activityInput(changedProject), proposal, [proposal.tasks[0].id],
    )).rejects.toThrow();

    const changedKind = structuredClone(input.layout);
    changedKind.eventOperations = { ...changedKind.eventOperations!, dataKind: 'real' };
    await expect(acceptActivityTaskSuggestions(
      activityInput(changedKind), proposal, [proposal.tasks[0].id],
    )).rejects.toThrow();

    const collision = structuredClone(input.layout);
    collision.eventOperations!.tasks.push(proposal.tasks[0]);
    await expect(acceptActivityTaskSuggestions(
      activityInput(collision), proposal, [proposal.tasks[0].id],
    )).rejects.toThrow();
  });

  it('rejects mismatched receipts without changing the layout and closes a valid accepted subset', async () => {
    const { input, context } = await validContext();
    const proposal = prepareActivityTaskSuggestions(context, {
      suggestions: [
        { title: '先核对签到台', phase: 'setup', acceptance: '记录签到台核对结果。', objectIds: [OBJECT_A] },
        { title: '再核对撤场', phase: 'teardown', acceptance: '记录撤场清点结果。' },
      ],
    }, 'synthetic-30-person');
    const first = await acceptActivityTaskSuggestions(input, proposal, [proposal.tasks[0].id]);
    const before = canonical(input.layout);
    const invalidReceipts = [
      { ...first.receipt, projectId: id(9001) },
      { ...first.receipt, proposalId: id(9002) },
      { ...first.receipt, acceptedTaskIds: [id(9003)] },
      { ...first.receipt, acceptedTaskIds: [proposal.tasks[0].id, proposal.tasks[0].id] },
    ];
    for (const receipt of invalidReceipts) {
      await expect(acceptActivityTaskSuggestions(
        input, proposal, [proposal.tasks[0].id], receipt,
      )).rejects.toThrow();
      expect(canonical(input.layout)).toBe(before);
    }

    const closed = await acceptActivityTaskSuggestions(
      input, proposal, [proposal.tasks[0].id], first.receipt,
    );
    expect(closed.status).toBe('closed');
    expect(closed.addedTaskIds).toEqual([]);
    expect(closed.receipt.acceptedTaskIds).toEqual([proposal.tasks[0].id]);
  });

  it('enforces the merged task limit without truncating 500 originals and allows 499 plus one', async () => {
    const fullLayout = rehearsalLayout({ eventOperations: boundedOperations(500) });
    const fullInput = activityInput(fullLayout, { taskIds: [], objectIds: [] });
    const fullContext = await buildActivityTaskContext(fullInput);
    const fullProposal = prepareActivityTaskSuggestions(fullContext, {
      suggestions: [{ title: '追加上限任务', phase: 'setup', acceptance: '记录新增任务条件。' }],
    }, 'synthetic-30-person');
    const fullBefore = canonical(fullInput.layout.eventOperations);
    await expect(acceptActivityTaskSuggestions(
      fullInput, fullProposal, [fullProposal.tasks[0].id],
    )).rejects.toThrow();
    expect(fullInput.layout.eventOperations!.tasks).toHaveLength(500);
    expect(canonical(fullInput.layout.eventOperations)).toBe(fullBefore);

    const almostFullLayout = rehearsalLayout({ eventOperations: boundedOperations(499) });
    const almostFullInput = activityInput(almostFullLayout, { taskIds: [], objectIds: [] });
    const almostFullContext = await buildActivityTaskContext(almostFullInput);
    const almostFullProposal = prepareActivityTaskSuggestions(almostFullContext, {
      suggestions: [{ title: '达到上限任务', phase: 'setup', acceptance: '记录最后一个任务条件。' }],
    }, 'synthetic-30-person');
    const result = await acceptActivityTaskSuggestions(
      almostFullInput, almostFullProposal, [almostFullProposal.tasks[0].id],
    );
    expect(result.operations!.tasks).toHaveLength(500);
    expect(result.operations!.tasks.slice(0, 499)).toEqual(almostFullInput.layout.eventOperations!.tasks);
    expect(result.addedTaskIds).toEqual([almostFullProposal.tasks[0].id]);
  });

  it('expires an object-only proposal when its linked acquisition changes without exposing production fields', async () => {
    const layout = withAcquisition(rehearsalLayout(), 'rehearsal');
    const input = activityInput(layout, { taskIds: [], objectIds: [OBJECT_A] });
    const context = await buildActivityTaskContext(input);
    expect(context.summary.tasks).toEqual([]);
    expect(context.summary.objects.map(item => item.id)).toEqual([OBJECT_A]);
    expect(JSON.stringify(context.summary)).not.toContain(CHECKIN_ACQUISITION);
    expect(JSON.stringify(context.summary)).not.toContain('演练签到台取得');

    const proposal = prepareActivityTaskSuggestions(context, validResponse(), 'synthetic-30-person');
    const changed = structuredClone(layout);
    changed.productionPlan!.acquisitions[0].sourceNote = '后来确认的来源字段';
    const before = canonical(layout);
    await expect(acceptActivityTaskSuggestions(
      activityInput(changed, { taskIds: [], objectIds: [OBJECT_A] }),
      proposal,
      [proposal.tasks[0].id],
    )).rejects.toThrow();
    expect(canonical(layout)).toBe(before);
  });
});
