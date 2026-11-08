import { describe, expect, it } from 'vitest';
import type { SceneScript } from '../../../../supabase/functions/_shared/scene-script-contract';
import {
  describeSceneScript,
  normalizeSceneScript,
  parseSceneScript,
  rectsOverlap,
  sceneScriptFromBrief,
  validateSceneScript,
  zonesWithRole,
} from './scene-script';

const venue = { width: 12, depth: 9 };

const script = (overrides: Partial<SceneScript> = {}): SceneScript => ({
  version: 1,
  seed: 7,
  layoutMode: 'dining',
  zones: [{ role: 'seating', rect: { x: -5, z: -4, w: 10, d: 8 } }],
  constraints: { aisleMinM: 1.2, wallGapM: 0.35 },
  ...overrides,
});

const minimal = { version: 1, seed: 7, zones: [{ role: 'seating', rect: { x: -5, z: -4, w: 10, d: 8 } }] };

describe('parseSceneScript — 读不动的脚本要报得出来，不能抛', () => {
  it('最小的合法脚本吃进去，缺省值补齐（布局模式、通道下限、墙距）', () => {
    const parsed = parseSceneScript(minimal);
    expect(parsed.ok).toBe(true);
    expect(parsed.script?.layoutMode).toBe('dining');
    expect(parsed.script?.constraints).toEqual({ aisleMinM: 1.2, wallGapM: 0.35 });
  });

  it('版本号、空 zones、自创字段都算形状错，错误里带路径', () => {
    for (const bad of [{ ...minimal, version: 2 }, { ...minimal, zones: [] }, { ...minimal, headline: 'x' }]) {
      const parsed = parseSceneScript(bad);
      expect(parsed.ok).toBe(false);
      expect(parsed.issues.length).toBeGreaterThan(0);
      expect(parsed.issues[0]?.code).toBe('E_SCRIPT_SHAPE');
      expect(parsed.issues[0]?.severity).toBe('error');
    }
  });

  it('不是对象也不抛，只是拒绝', () => {
    expect(() => parseSceneScript('一句话')).not.toThrow();
    expect(parseSceneScript(null).ok).toBe(false);
  });
});

describe('normalizeSceneScript — 收进场地，坏的丢掉并报数', () => {
  it('越过场地的区收进来，记一条 warning，不说它错', () => {
    const { script: fixed, issues } = normalizeSceneScript(script({ zones: [{ role: 'seating', rect: { x: -9, z: -4, w: 4, d: 3 } }] }), venue);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('E_ZONE_OUTSIDE');
    expect(issues[0]?.severity).toBe('warning');
    expect(fixed.zones[0]?.rect.x).toBeGreaterThanOrEqual(-venue.width / 2);
    expect(zonesWithRole(fixed, 'seating')[0]?.rect.w).toBeGreaterThan(0);
  });

  it('窄到不能成区的 rect 是 error，且不再留给编译器', () => {
    const { script: fixed, issues } = normalizeSceneScript(script({ zones: [{ role: 'plant', rect: { x: 0, z: 0, w: 0.1, d: 2 } }] }), venue);
    expect(issues[0]?.code).toBe('E_ZONE_TOO_SMALL');
    expect(issues[0]?.severity).toBe('error');
    expect(fixed.zones).toHaveLength(0);
  });
});

describe('validateSceneScript — 建之前先说清楚哪儿不对', () => {
  it('两块可建区压在一起是 error：只能建一个', () => {
    const issues = validateSceneScript(
      script({
        zones: [
          { role: 'stage', rect: { x: -5, z: -4, w: 10, d: 2 } },
          { role: 'seating', rect: { x: -5, z: -3, w: 10, d: 6 } },
        ],
      }),
      venue
    );
    expect(issues.some((entry) => entry.code === 'E_ZONE_OVERLAP' && entry.severity === 'error')).toBe(true);
  });

  it('通道压在座位区上是允许的（它就是挖出来的一条路），太窄才是 warning', () => {
    const issues = validateSceneScript(
      script({
        zones: [
          { role: 'seating', rect: { x: -5, z: -4, w: 10, d: 8 } },
          { role: 'aisle', rect: { x: -5, z: -2, w: 10, d: 0.8 } },
        ],
      }),
      venue
    );
    expect(issues.some((entry) => entry.code === 'E_ZONE_OVERLAP')).toBe(false);
    expect(issues.some((entry) => entry.code === 'W_AISLE_NARROW' && entry.severity === 'warning')).toBe(true);
  });

  it('说了人数却没有座位区，是 error 不是 warning', () => {
    const issues = validateSceneScript(script({ guests: 20, zones: [{ role: 'stage', rect: { x: -5, z: -4, w: 10, d: 2 } }] }), venue);
    expect(issues.some((entry) => entry.code === 'E_ROLE_UNFIT' && entry.severity === 'error')).toBe(true);
  });

  it('场地里放得下的一块座位区，一条 issue 都没有', () => {
    expect(validateSceneScript(script(), venue).filter((entry) => entry.severity === 'error')).toHaveLength(0);
  });
});

describe('sceneScriptFromBrief — 从人已经说过的话里先画一张计划', () => {
  it('12 × 9 的发布会：舞台、通道、座位、签到不互相压且不擅加绿植', () => {
    const derived = sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: 24, stage: true, checkin: true, seed: 3 });
    const roles = derived.zones.map((zone) => zone.role);
    expect(roles).toEqual(expect.arrayContaining(['stage', 'aisle', 'seating', 'checkin']));
    expect(roles).not.toContain('plant');
    expect(validateSceneScript(derived, venue).filter((entry) => entry.severity === 'error')).toHaveLength(0);
    const seating = zonesWithRole(derived, 'seating')[0]!;
    expect(seating.rect.x).toBeGreaterThanOrEqual(-venue.width / 2);
    expect(seating.rect.z + seating.rect.d).toBeLessThanOrEqual(venue.depth / 2 + 1e-6);
    expect(seating.count).toBe(24);
  });

  it('课室模式不设舞台和签到，座位区从北到南一路到底', () => {
    const derived = sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: 40, layoutMode: 'desk-chair', stage: false, checkin: false, seed: 0 });
    expect(zonesWithRole(derived, 'stage')).toHaveLength(0);
    expect(zonesWithRole(derived, 'checkin')).toHaveLength(0);
    expect(zonesWithRole(derived, 'seating')).toHaveLength(1);
    expect(derived.layoutMode).toBe('desk-chair');
  });

  it('同一份简报同一个 seed 得到同一张计划（换一版才换 seed）', () => {
    const a = sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: 24, stage: true, checkin: true, seed: 3 });
    const b = sceneScriptFromBrief({ widthM: 12, depthM: 9, guests: 24, stage: true, checkin: true, seed: 3 });
    expect(a).toEqual(b);
  });
});

describe('describeSceneScript / rectsOverlap', () => {
  it('读回的是人能核对的一句话，不是坐标', () => {
    const lines = describeSceneScript(script());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('座位');
    expect(lines[0]).toContain('m');
  });

  it('共边不算压在一起', () => {
    const a = { x: 0, z: 0, w: 2, d: 2 };
    expect(rectsOverlap(a, { x: 2, z: 0, w: 2, d: 2 })).toBe(false);
    expect(rectsOverlap(a, { x: 1.9, z: 0, w: 2, d: 2 })).toBe(true);
  });
});
