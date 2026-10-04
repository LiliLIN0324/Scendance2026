import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, studio, session, scene, chair } from './fixtures.ts';
import { presetManifest, sceneSchema, sceneHash } from '../supabase/functions/_shared/domain.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { agentRunSchema } from '../supabase/functions/_shared/agent-contract.ts';
import { buildProposal } from '../supabase/functions/_shared/ai.ts';

function gym() {
  return sceneSchema.parse({ ...scene(), scenePreset: 'gym', venue: { ...scene().venue, width: 70, depth: 76, height: 6 },
    objects: Array.from({ length: 307 }, (_, index) => ({ ...chair(), materialId: 'asset', presetNode: index,
      position: { x: 5 + index % 20, z: 5 + Math.floor(index / 20) } })) });
}

describe('archived public scene references', () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { f = await database(); }, 30000);
  afterAll(async () => { await f?.db.close(); });
  it('keeps the 50-object rule for ordinary scenes and validates known nodes in JS and SQL', async () => {
    for (const [key, labels] of Object.entries(presetManifest)) {
      const result = await f.db.query<{ count: number }>('select scene_private.preset_node_count($1) as count', [key]);
      expect(result.rows[0].count).toBe(labels.length);
    }
    const base = gym();
    const invalid = [
      { ...scene(), objects: Array.from({ length: 51 }, () => chair()) },
      { ...base, scenePreset: 'unknown' },
      { ...base, scenePreset: undefined },
      { ...base, objects: [{ ...base.objects[0], presetNode: 307 }] },
      { ...base, objects: [{ ...base.objects[0], presetNode: -1 }] },
      { ...base, objects: [{ ...base.objects[0], presetNode: '0' }] },
      { ...base, objects: [{ ...base.objects[0], assetId: crypto.randomUUID() }] },
      { ...base, objects: [{ ...base.objects[0], materialId: 'table' }] },
      { ...base, objects: Array.from({ length: 501 }, () => ({ ...base.objects[0], id: crypto.randomUUID() })) },
    ];
    for (const candidate of invalid) {
      expect(sceneSchema.safeParse(candidate).success).toBe(false);
      await expect(f.rpc(owner, 'projects.create', { studioId: studio, name: 'Invalid', scene: candidate })).rejects.toThrow();
    }
    await expect(f.rpc(owner, 'projects.create', { studioId: studio, name: 'Unknown GLB', scene: {
      ...base, objects: [{ ...chair(), materialId: 'asset', assetId: crypto.randomUUID() }],
    } })).rejects.toThrow('ASSET_FORBIDDEN');
  });
  it('runs an Agent on 307 objects and applies and reopens 308 without losing preset identity', async () => {
    const base = gym(), project = await f.rpc(owner, 'projects.create', { studioId: studio, name: 'Gym', scene: base });
    const lease = await f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session });
    const input = { requestId: crypto.randomUUID(), sessionId: session, generation: lease.generation,
      expectedRevision: 0, localRevision: 0, scene: base, selectedIds: [], instruction: '添加一张桌子，先预览', executionMode: 'preview' };
    let calls = 0;
    const api = createApi(f.backend, key => key === 'DEEPSEEK_API_KEY' ? 'fixture' : undefined, async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(JSON.parse(request.messages[1].content).presetObjectLabels[base.objects[0].id]).toBe(presetManifest.gym[0]);
      if (++calls === 1) return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null,
        tool_calls: [{ id: 'read-scene', type: 'function', function: { name: 'get_scene', arguments: '{}' } }],
      } }] }));
      const readResult = JSON.parse(request.messages.at(-1).content);
      expect(readResult).toMatchObject({ sameAsInitialScene: true, objectCount: 307 });
      expect(readResult.scene).toBeUndefined();
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{
        id: 'call-1', type: 'function', function: { name: 'submit_candidates', arguments: JSON.stringify({ candidates: [{
          title: '增加桌子', explanation: '保留原场景并新增桌子', commands: [{ op: 'add', materialId: 'table', position: { x: 2, z: 2 }, rotation: 0, color: '#ffffff' }],
        }] }) },
      }] } }] }));
    });
    const response = await api(new Request(`https://api.test/projects/${project.id}/agent-runs`, { method: 'POST',
      headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, body: JSON.stringify(input) }));
    expect(response.status).toBe(202);
    const run = agentRunSchema.parse(await response.json());
    expect(run.state).toBe('complete');
    expect(calls).toBe(2);
    const applied = await f.rpc(owner, 'proposals.apply', { ...input, projectId: project.id,
      proposalId: run.candidates[0].proposal.id, baseHash: await sceneHash(base) });
    expect(applied.scene.scenePreset).toBe('gym');
    expect(applied.scene.objects).toHaveLength(308);
    expect(applied.scene.objects.slice(0, 307)).toEqual(base.objects);
    const reopened = await f.rpc(owner, 'projects.get', { projectId: project.id });
    expect(reopened.scene).toEqual(applied.scene);
    expect(reopened.materials.every((row: { name: unknown }) => typeof row.name === 'string')).toBe(true);
  });
  it('preserves baseline bounds issues but blocks newly invalid changes and fake GLB recoloring', () => {
    const base = gym(); base.objects[0].position = { x: -1, z: -1 };
    const output = { explanation: '增加桌子', commands: [{ op: 'add', materialId: 'table', position: { x: 2, z: 2 }, rotation: 0, color: '#ffffff' }] };
    expect(buildProposal(base, 'modify', output).scene.objects).toHaveLength(308);
    expect(() => buildProposal(base, 'modify', { explanation: '越界', commands: [{ op: 'move', id: base.objects[1].id, position: { x: -5, z: -5 } }] })).toThrow(/OUT_OF_BOUNDS|STRUCTURAL_COLLISION/);
    expect(() => buildProposal(base, 'modify', { explanation: '换色', commands: [{ op: 'recolor', id: base.objects[1].id, color: '#ff0000' }] })).toThrow('ASSET_MATERIAL_UNSUPPORTED');
    const replaced = buildProposal(base, 'modify', { explanation: '替换', commands: [{ op: 'replace', id: base.objects[1].id, materialId: 'table' }] });
    expect(replaced.scene.objects[1].presetNode).toBeUndefined();
  });
});
