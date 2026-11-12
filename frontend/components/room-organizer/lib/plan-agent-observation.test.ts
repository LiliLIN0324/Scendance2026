import { describe, expect, it } from 'vitest';
import {
  buildPlanObservation,
  computePlanFingerprint,
  type OutdoorPlanCapture,
} from './plan-agent-observation';
import { AGENT_PLAN_OBSERVATION_NOTICE } from '../../../../supabase/functions/_shared/agent-contract';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

function makePlan(overrides: Partial<SitePlanData> = {}): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
    ...overrides,
  } as unknown as SitePlanData;
}

describe('buildPlanObservation', () => {
  it('挂上固定未核验 notice，并原样透传 plan/anchor/选区/指纹', () => {
    const plan = makePlan();
    const capture: OutdoorPlanCapture = {
      plan,
      anchor: { lng: 101.7, lat: 3.1, crs: 'gcj-02', source: 'preset' } as OutdoorPlanCapture['anchor'],
      selected: ['a'.repeat(36), 'b'.repeat(36)],
      planHash: 'f'.repeat(64),
    };
    const observation = buildPlanObservation(capture);
    expect(observation.notice).toBe(AGENT_PLAN_OBSERVATION_NOTICE);
    expect(observation.plan).toBe(plan);
    expect(observation.anchor).toEqual(capture.anchor);
    expect(observation.selected).toEqual(capture.selected);
    expect(observation.planHash).toBe(capture.planHash);
  });

  it('无选区/无指纹时省略可选字段，anchor 为空时落 null', () => {
    const observation = buildPlanObservation({ plan: makePlan(), anchor: null, selected: [] });
    expect(observation.anchor).toBeNull();
    expect('selected' in observation).toBe(false);
    expect('planHash' in observation).toBe(false);
  });
});

describe('computePlanFingerprint', () => {
  it('规范化后同一份 plan 得到稳定的 64 位十六进制摘要', async () => {
    const planA = makePlan({ zones: [{ id: 'z1', name: '舞台区' }] as never });
    const planB = makePlan({ zones: [{ name: '舞台区', id: 'z1' }] as never });
    const [hashA, hashB] = await Promise.all([computePlanFingerprint(planA), computePlanFingerprint(planB)]);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashA).toBe(hashB);
  });

  it('内容变化时摘要不同', async () => {
    const hashBefore = await computePlanFingerprint(makePlan());
    const hashAfter = await computePlanFingerprint(
      makePlan({ boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] }),
    );
    expect(hashBefore).not.toBe(hashAfter);
  });

  it('crypto.subtle 不可用时回 undefined，不抛错', async () => {
    const originalSubtle = globalThis.crypto?.subtle;
    try {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
      await expect(computePlanFingerprint(makePlan())).resolves.toBeUndefined();
    } finally {
      if (globalThis.crypto) Object.defineProperty(globalThis.crypto, 'subtle', { value: originalSubtle, configurable: true });
    }
  });
});
