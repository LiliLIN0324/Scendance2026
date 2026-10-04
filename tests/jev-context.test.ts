import { expect, it, vi } from 'vitest';
import { evaluateCandidates } from '../supabase/functions/_shared/jev.ts';
import { chair, scene } from './fixtures.ts';

const candidates = ['A', 'B', 'C'].map(label => ({ label, title: label, scene: scene(), explanation: `方案 ${label}`, warnings: [] }));
const answer = { answers: { recommended_plan: { type: 'choice', choice: 'B', probabilities: { A: 0.15, B: 0.6, C: 0.2, NONE: 0.05 }, confidence: 0.6 } } };

it('keeps ordinary JEV requests and returned probability semantics unchanged', async () => {
  const small = candidates.map(candidate => ({ ...candidate, scene: { ...scene(), objects: [{ ...chair(), position: { x: 1 / 7, z: 2 / 9 } }] } }));
  const fetcher = vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.state).toEqual({ task: '比较方案', candidates: small });
    expect(body.questions.recommended_plan.criteria).toEqual({ A: '方案 A 更适合', B: '方案 B 更适合', C: '方案 C 更适合', NONE: '均不适合或证据不足' });
    return new Response(JSON.stringify(answer));
  });
  const result = await evaluateCandidates(small, '比较方案', () => 'fixture', 5000, fetcher);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ status: 'complete', choice: 'B', probabilities: answer.answers.recommended_plan.probabilities, confidence: 0.6 });
});

it('does not silently truncate a request still too large after summarizing shared context', async () => {
  const fetcher = vi.fn();
  expect((await evaluateCandidates(candidates, '要求'.repeat(50000), () => 'fixture', 5000, fetcher)).status).toBe('unavailable');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([40, 306])('retains every difference and exact source values with %i shared objects', async (sharedCount) => {
  const assetId = crypto.randomUUID();
  const shared = Array.from({ length: sharedCount }, (_, index) => ({ ...chair(), assetId, position: { x: index / 7, z: index / 11 } }));
  const changed = { ...chair(), assetId }, added = [chair(), chair(), chair()];
  const large = candidates.map((candidate, index) => ({ ...candidate, scene: { ...scene(), scenePreset: 'gym' as const,
    objects: [...shared, ...(index === 2 ? [] : [{ ...changed, position: { x: index + 0.123456789, z: 3 } }]), added[index]] },
    warnings: [{ code: 'OVERLAP', ids: [shared[0].id, shared[1].id] },
      { code: 'OVERLAP', ids: [added[index].id, shared[2].id], clearance: 0.123456789 },
      { code: 'GLOBAL', ids: [] }] }));
  const original = JSON.stringify(large);
  let sent: any;
  const result = await evaluateCandidates(large, `ref0 比较 ${changed.id}`, () => 'fixture', 5000, async (_url, init) => {
    sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify(answer));
  });
  expect(result.status).toBe('complete');
  expect(JSON.stringify(large)).toBe(original);
  expect(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i.test(JSON.stringify(sent))).toBe(false);
  const state = sent.state;
  expect(state.sharedContext).toMatchObject({ objectCount: sharedCount, materialCounts: { chair: sharedCount }, scenePreset: 'gym' });
  expect(state.sharedContext.nearbyObjects.length).toBeGreaterThan(0);
  expect(state.sharedContext.omittedObjectCount).toBe(sharedCount - state.sharedContext.nearbyObjects.length);
  expect(state.coverage).toContain('omitted shared geometry still exists');
  const aliases = new Map<string, string>();
  state.candidates.forEach((candidate: any, index: number) => {
    expect(candidate.scene.venue).toEqual(large[index].scene.venue);
    expect(candidate.scene.camera).toBe(large[index].scene.camera);
    expect(candidate.scene.scenePreset).toBe('gym');
    expect(candidate.title).toBe(large[index].title);
    expect(candidate.explanation).toBe(large[index].explanation);
    expect(candidate.objectCount).toBe(large[index].scene.objects.length);
    const changedObjects = large[index].scene.objects.filter(object => !shared.some(item => item.id === object.id));
    expect(candidate.scene.objects).toHaveLength(changedObjects.length);
    candidate.scene.objects.forEach((object: any, objectIndex: number) => {
      const source = changedObjects[objectIndex], { id, assetId: resourceId, ...geometry } = object;
      const { id: sourceId, assetId: sourceResourceId, ...sourceGeometry } = source as typeof changed;
      expect(geometry).toEqual(sourceGeometry);
      for (const [originalId, alias] of [[sourceId, id], [sourceResourceId, resourceId]]) if (originalId) {
        if (!aliases.has(originalId)) aliases.set(originalId, alias);
        expect(alias).toBe(aliases.get(originalId));
      }
    });
    expect(candidate.sharedWarningCounts).toEqual({ OVERLAP: 1 });
    expect(candidate.warnings).toHaveLength(2);
    expect(candidate.warnings[0]).toMatchObject({ code: 'OVERLAP', ids: [aliases.get(added[index].id), expect.any(String)], clearance: 0.123456789 });
    expect(candidate.warnings[1]).toEqual({ code: 'GLOBAL', ids: [] });
  });
  expect(state.candidates.map((candidate: any) => candidate.scene.objects.length)).toEqual([2, 2, 1]);
  expect(state.task).toBe(`ref0 比较 ${aliases.get(changed.id)}`);
  expect([...aliases.values()]).not.toContain('ref0');
});

it.each([
  { fetcher: async () => new Response('upstream private body', { status: 429 }), expected: { errorCode: 'PROVIDER_HTTP_ERROR', httpStatus: 429 } },
  { fetcher: async () => { throw new DOMException('private timeout detail', 'TimeoutError'); }, expected: { errorCode: 'JEV_TIMEOUT' } },
  { fetcher: async () => new Response('{}'), expected: { errorCode: 'JEV_INVALID_RESPONSE' } },
])('records only safe failure metadata: $expected.errorCode', async ({ fetcher, expected }) => {
  const usage = vi.fn();
  expect((await evaluateCandidates(candidates, '比较方案', () => 'private-api-key', 5000, fetcher, usage)).status).toBe('unavailable');
  expect(usage).toHaveBeenCalledExactlyOnceWith(expected);
});
