import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { convertPreset } from '../../../../scripts/package-scene-presets.mjs';
import { agentRunRequestSchema } from '../../../../supabase/functions/_shared/agent-contract';
import { executeAgentRun } from '../../../../supabase/functions/_shared/agent-runner';
import { buildProposal } from '../../../../supabase/functions/_shared/ai';
import { layoutToBackendScene } from '../lib/backend-adapter';
import { layoutFromPreset } from './scene-presets';
import type { Backend } from '../../../../supabase/functions/_shared/backend';

it.each([3, 6])('keeps the real gym read, BOM, three validations and JEV workflow inside provider limits across %i turns without dropping data', async (turns) => {
  const buffer = convertPreset(readFileSync(new URL('../../../../scene/templates/gym/gym.glb', import.meta.url)), 'gym');
  const oldLength = buffer.readUInt32LE(12), document = JSON.parse(buffer.subarray(20, 20 + oldLength).toString());
  document.materials = document.materials.map(() => ({}));
  const json = Buffer.from(JSON.stringify(document)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const geometry = Buffer.concat([buffer.subarray(0, 20), padded, buffer.subarray(20 + oldLength)]);
  geometry.writeUInt32LE(geometry.length, 8); geometry.writeUInt32LE(padded.length, 12);
  const source = await new GLTFLoader().parseAsync(new Uint8Array(geometry).buffer, '');
  const scene = layoutToBackendScene(layoutFromPreset('gym', source.scene));
  const input = agentRunRequestSchema.parse({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(),
    generation: 1, expectedRevision: 0, localRevision: 0, scene, selectedIds: [], instruction: '给出三个合理的新增桌子方案，保留现有体育馆物料', jevEnabled: true });
  const candidates = [2, 5, 8].map((x, index) => ({ title: `新增桌子 ${index + 1}`, explanation: `在 x=${x} 米处新增一张桌子`,
    commands: [{ op: 'add', materialId: 'table', position: { x, z: 3 }, rotation: 0, color: '#ffffff' }] }));
  const actions: { action: string; data: Record<string, unknown> }[] = [];
  const backend: Backend = {
    user: async () => 'actor', scene: async () => [], jobs: async () => ({}), reconstruction: async () => ({}), upload: async () => {}, sign: async () => '',
    agent: async (_actor, action, data = {}) => {
      actions.push({ action, data });
      return action === 'start' ? { claimed: true, claim: 'claim', input, studioId: crypto.randomUUID(), deadline: new Date(Date.now() + 90000).toISOString() } : {};
    },
  };
  const providerBodies: string[] = [], jevBodies: string[] = [];
  const tool = (name: string, args: unknown) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
  await executeAgentRun(backend, 'actor', crypto.randomUUID(), crypto.randomUUID(), () => 'fixture', async (url, init) => {
    const encoded = String(init?.body);
    if (String(url).includes('systemone')) {
      jevBodies.push(encoded);
      return new Response(JSON.stringify({ answers: { recommended_plan: { type: 'choice', choice: 'B',
        probabilities: { A: 0.2, B: 0.5, C: 0.2, NONE: 0.1 }, confidence: 0.5 } } }));
    }
    providerBodies.push(encoded);
    const calls = providerBodies.length === 1 ? [tool('get_scene', {}), tool('get_bom', {})]
      : providerBodies.length < turns - 1 ? [tool('get_scene', {})]
      : providerBodies.length === turns - 1 ? candidates.map(candidate => tool('validate_candidate', candidate))
        : [tool('submit_candidates', { candidates })];
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: calls } }] }));
  });
  expect(actions.find(entry => entry.action === 'fail')).toBeUndefined();
  expect(providerBodies).toHaveLength(turns);
  expect(JSON.parse(providerBodies[turns - 1]).tool_choice).toEqual(turns === 6
    ? { type: 'function', function: { name: 'submit_candidates' } } : 'auto');
  expect(providerBodies.map(body => new TextEncoder().encode(body).length).every(bytes => bytes < 220000)).toBe(true);
  const first = JSON.parse(JSON.parse(providerBodies[0]).messages[1].content);
  const restored = first.scene.objects.rows.map((row: unknown[]) => {
    const object: Record<string, unknown> = {};
    first.scene.objects.columns.forEach((column: string, index: number) => {
      const value = row[index];
      if (value === null) return;
      const [key, child] = column.split('.');
      if (child) object[key] ??= {};
      if (child) (object[key] as Record<string, unknown>)[child] = value;
      else object[key] = value;
    });
    return object;
  });
  expect({ ...first.scene, objects: restored }).toEqual(JSON.parse(JSON.stringify(scene)));
  expect(Object.keys(first.presetObjectLabels)).toHaveLength(307);
  const results = JSON.parse(providerBodies[turns - 1]).messages.filter((message: { role: string }) => message.role === 'tool')
    .map((message: { content: string }) => JSON.parse(message.content));
  expect(results[0]).toMatchObject({ sameAsInitialScene: true, objectCount: 307 });
  expect(results[0].presetObjectLabels).toBeUndefined();
  expect(results[1].items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0)).toBe(307);
  candidates.forEach((candidate, index) => {
    expect(results[results.length - 3 + index]).toEqual({ valid: true, objectCount: 308,
      warnings: buildProposal(scene, 'modify', { explanation: candidate.explanation, commands: candidate.commands }).warnings });
  });
  expect(jevBodies).toHaveLength(1);
  expect(new TextEncoder().encode(jevBodies[0]).length).toBeLessThan(12000);
  const comparison = JSON.parse(jevBodies[0]).state;
  expect(comparison.sharedContext.objectCount).toBe(307);
  expect(comparison.sharedContext.nearbyObjects.length).toBeGreaterThan(0);
  expect(comparison.sharedContext.nearbyObjects.length).toBeLessThanOrEqual(18);
  expect(comparison.sharedContext.omittedObjectCount).toBe(307 - comparison.sharedContext.nearbyObjects.length);
  expect(comparison.coverage).toContain('omitted shared geometry still exists');
  comparison.candidates.forEach((candidate: { objectCount: number; scene: typeof scene }, index: number) => {
    expect(candidate.objectCount).toBe(308);
    expect(candidate.scene.objects).toHaveLength(1);
    expect(candidate.scene.objects[0].position).toEqual(candidates[index].commands[0].position);
    expect(candidate.scene.venue).toEqual(scene.venue);
  });
  const stored = actions.find(entry => entry.action === 'checkpoint')?.data.candidates as { scene: typeof scene }[];
  expect(stored).toHaveLength(3);
  stored.forEach(candidate => {
    expect(candidate.scene.objects).toHaveLength(308);
    expect(candidate.scene.objects.filter(object => scene.objects.some(original => original.id === object.id))).toEqual(scene.objects);
  });
  expect(actions.find(entry => entry.action === 'finish')?.data.evaluation).toMatchObject({ status: 'complete', choice: 'B' });
});
