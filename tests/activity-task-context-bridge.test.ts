import { describe, expect, it, vi } from 'vitest';
import rehearsal from '../docs/examples/30-person-rehearsal-operations.json';
import { activityTaskContextSchema, validateActivityTaskResult } from '../supabase/functions/_shared/activity-task-contract.ts';
import { eventOperationsSchema } from '../supabase/functions/_shared/event-operations-contract.ts';
import { buildActivityTaskContext, prepareActivityTaskSuggestions } from '../frontend/lib/activity-task-suggestions.ts';
import { makeFloor, makeItem, makeLayout } from '../frontend/components/room-organizer/lib/__testfixtures__/fixtures.ts';
import { createSceneClient } from '../client/scene-client.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { database, owner, studio, session, scene } from './fixtures.ts';

describe('activity task context bridge', () => {
  it('accepts the shared rehearsal summary without private fields and prepares new local todos', async () => {
    const objectId = 'a3000000-0000-4000-8000-000000000701';
    const operations = eventOperationsSchema.parse(rehearsal);
    operations.tasks[0].objectIds = [objectId];
    const layout = makeLayout({
      id: 'a3000000-0000-4000-8000-000000000001',
      eventOperations: operations,
      floors: [makeFloor({ items: [makeItem({ id: objectId,
        notes: 'PRIVATE_ITEM_NOTE', glbUrl: 'https://private.example/model.glb?token=PRIVATE_TOKEN',
      })] })],
    });
    const before = JSON.stringify(layout);
    const context = await buildActivityTaskContext({ layout, selection: {
      briefText: 'Synthetic transport bridge; no on-site facts asserted.',
      taskIds: operations.tasks.map(task => task.id),
      objectIds: layout.floors.flatMap(floor => floor.items.map(item => item.id)),
    } });
    const disclosed = activityTaskContextSchema.parse(context.summary);
    expect(disclosed).toEqual(context.summary);
    expect(JSON.stringify(disclosed)).not.toMatch(/PRIVATE_|private\.example/);
    const result = validateActivityTaskResult({ suggestions: [{
      title: 'Synthetic bridge task', phase: 'preparation', acceptance: 'Review the selected object; synthetic verification only.',
      objectIds: [disclosed.objects[0]!.id],
    }] }, disclosed);
    const prepared = prepareActivityTaskSuggestions(context, result, 'Synthetic bridge');
    expect(prepared.tasks).toHaveLength(1);
    expect(prepared.tasks[0]).toMatchObject({ status: 'todo', objectIds: [disclosed.objects[0]!.id] });
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('recovers a lost committed POST through the typed client and real database without generating twice', async () => {
    const f = await database();
    try {
      const layout = makeLayout({ id: 'bridge/rehearsal', eventOperations: eventOperationsSchema.parse(rehearsal) });
      const original = JSON.stringify(layout);
      const context = await buildActivityTaskContext({ layout, selection: {
        briefText: 'Synthetic transport recovery; no real model or on-site claims.',
        taskIds: layout.eventOperations!.tasks.map(task => task.id), objectIds: [],
      } });
      const project = await f.rpc(owner, 'projects.create', { studioId: studio, name: 'Synthetic bridge', scene: scene() });
      const lease = await f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session });
      let modelCalls = 0;
      const api = createApi(f.backend, key => key === 'TOKENDANCE_API_KEY' ? 'synthetic' : undefined, async (url, init) => {
        expect(String(url)).toBe('https://tokendance.space/gateway/v1/chat/completions');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic');
        expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'deepseek-v4.1-flash' });
        modelCalls++;
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          suggestions: [{ title: 'Synthetic recovery task', phase: 'preparation', acceptance: 'Review manually; synthetic only.', objectIds: [] }],
        }) } }] }));
      });
      let discardPostResponse = true;
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const response = await api(request);
        if (request.method === 'POST' && discardPostResponse) {
          discardPostResponse = false;
          throw new TypeError('Synthetic loss after the API committed');
        }
        return response;
      });
      const client = createSceneClient('https://api.test', async () => owner);
      const requestId = crypto.randomUUID();
      await expect(client.startActivityTaskRun(project.id, {
        kind: 'activity_tasks', requestId, sessionId: session, generation: lease.generation,
        expectedRevision: 0, instruction: 'Suggest tasks for manual selection only.', activityContext: activityTaskContextSchema.parse(context.summary),
      })).rejects.toThrow('Synthetic loss after the API committed');
      const recovered = await client.getActivityTaskRunByRequest(project.id, requestId);
      expect(recovered).toMatchObject({ state: 'complete', activityId: layout.id, requestId });
      expect(modelCalls).toBe(1);
      const prepared = prepareActivityTaskSuggestions(context, recovered.activityResult, 'Synthetic recovery');
      expect(prepared.tasks).toHaveLength(1);
      expect(prepared.tasks[0].status).toBe('todo');
      const readAgain = await client.getActivityTaskRun(project.id, recovered.id);
      expect(readAgain.activityResult).toEqual(recovered.activityResult);
      expect(modelCalls).toBe(1);
      expect(JSON.stringify(layout)).toBe(original);
      const remote = await f.rpc(owner, 'projects.get', { projectId: project.id });
      expect(remote.revision).toBe(0);
      expect(remote.scene).toEqual(scene());
    } finally {
      vi.unstubAllGlobals();
      await f.db.close();
    }
  }, 30000);
});
