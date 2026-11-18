import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IMPLEMENTED_RULE_IDS,
  evaluateLayout,
  hardViolations,
  unsupportedReason,
} from '../frontend/lib/agent-corpus/evaluate';
import { facilityRect, rectGap, ringArea } from '../frontend/lib/agent-corpus/geometry';
import { buildPromptDigest, digestLine } from '../frontend/lib/agent-corpus/prompt-digest';
import type { CorpusRule, Layout, LayoutFacility } from '../frontend/lib/agent-corpus/types';

/**
 * 判据执行器的金标准用例（2026-11-18）。
 *
 * 每条已实现的判据都至少有一个 pass 与一个 violation 夹具，且断言的是
 * 「为什么红/为什么绿」的可读理由，不是只对状态码。未实现的判据必须进
 * unsupported 并带原因码，不许静默消失。
 */

const root = process.cwd();
const corpus = JSON.parse(
  readFileSync(path.join(root, 'data', 'agent-corpus', 'layout-assertions.json'), 'utf8'),
) as { rules: CorpusRule[] };

const ruleById = new Map(corpus.rules.map((rule) => [rule.id, rule]));

function rule(id: string): CorpusRule {
  const found = ruleById.get(id);
  if (!found) throw new Error(`规则不存在：${id}`);
  return found;
}

function facility(
  id: string,
  templateId: string,
  x: number,
  y: number,
  width = 2,
  depth = 2,
  rotationDeg = 0,
): LayoutFacility {
  return { id, templateId, name: id, position: { x, y }, rotationDeg, size: { width, depth } };
}

const square = (size: number, offsetX = 0, offsetY = 0) => [
  { x: offsetX, y: offsetY },
  { x: offsetX + size, y: offsetY },
  { x: offsetX + size, y: offsetY + size },
  { x: offsetX, y: offsetY + size },
];

const building = (minX: number, minY: number, maxX: number, maxY: number) => ({
  id: 'b-1',
  kind: 'building' as const,
  name: '建筑',
  polygon: [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ],
});

function evaluateOne(id: string, layout: Layout) {
  return evaluateLayout(layout, [rule(id)]).receipts[0];
}

describe('覆盖率：实现集与未实现集必须正好铺满 80 条', () => {
  it('11 条已实现，其余 69 条带原因码进 unsupported', () => {
    const evaluation = evaluateLayout({ facilities: [] }, corpus.rules);
    expect(evaluation.receipts).toHaveLength(80);
    const unsupportedIds = evaluation.unsupported.map((item) => item.ruleId);
    expect(unsupportedIds).toHaveLength(69);
    expect(new Set([...IMPLEMENTED_RULE_IDS, ...unsupportedIds]).size).toBe(80);
    for (const id of IMPLEMENTED_RULE_IDS) {
      expect(unsupportedIds).not.toContain(id);
      expect(ruleById.has(id)).toBe(true);
    }
  });

  it('原因码是受控词表，且能对上判据需要的输入', () => {
    const allowed = new Set([
      'needs-raster',
      'needs-water-depth',
      'needs-elevation',
      'needs-canopy',
      'needs-runtime-sensor',
      'needs-season-simulation',
      'needs-surface-data',
      'needs-fixture-typing',
      'needs-aisle-semantics',
      'needs-route-topology',
      'needs-orientation-semantics',
      'needs-metadata',
    ]);
    for (const item of corpus.rules) {
      if ((IMPLEMENTED_RULE_IDS as readonly string[]).includes(item.id)) continue;
      const reason = unsupportedReason(item);
      expect({ id: item.id, reason, allowed: allowed.has(reason) }).toEqual({ id: item.id, reason, allowed: true });
    }
    // 抽查：宽度类必须承认需要栅格；噪声必须承认需要传感器。
    expect(unsupportedReason(rule('GEN-03'))).toBe('needs-raster');
    expect(unsupportedReason(rule('STG-10'))).toBe('needs-runtime-sensor');
    expect(unsupportedReason(rule('KID-09'))).toBe('needs-water-depth');
  });
});

describe('GEN-04 出口数量', () => {
  const nodes = (kinds: Array<'entry' | 'exit' | 'both'>) =>
    kinds.map((kind, index) => ({ id: `n-${index}`, kind, name: `n${index}`, position: { x: index, y: 0 } }));

  it('两个出口即达标', () => {
    const receipt = evaluateOne('GEN-04', { facilities: [], nodes: nodes(['exit', 'both']) });
    expect(receipt.status).toBe('pass');
    expect(receipt.actual).toContain('2 个出口');
  });

  it('只有一个出口判违规', () => {
    const receipt = evaluateOne('GEN-04', { facilities: [], nodes: nodes(['exit']) });
    expect(receipt.status).toBe('violation');
    expect(receipt.detail).toContain('出口不足');
  });

  it('万人以上要求 4 个出口', () => {
    const receipt = evaluateOne('GEN-04', { facilities: [], nodes: nodes(['exit', 'both']), people: 12000 });
    expect(receipt.status).toBe('violation');
    expect(receipt.expected).toContain('4');
  });

  it('没有节点时是 skipped，不是 pass', () => {
    const receipt = evaluateOne('GEN-04', { facilities: [] });
    expect(receipt.status).toBe('skipped');
    expect(receipt.reason).toBe('no-entrance-nodes');
  });
});

describe('GEN-07 / MKT-11 建筑退距', () => {
  it('设施距建筑 1 m 判 GEN-07 违规', () => {
    const receipt = evaluateOne('GEN-07', {
      facilities: [facility('f-1', 'tent-3x3', 8, 5)],
      obstacles: [building(10, 0, 20, 10)],
    });
    expect(receipt.status).toBe('violation');
    expect(receipt.actual).toContain('1 m');
  });

  it('设施距建筑 4 m 通过', () => {
    const receipt = evaluateOne('GEN-07', {
      facilities: [facility('f-1', 'tent-3x3', 5, 5)],
      obstacles: [building(10, 0, 20, 10)],
    });
    expect(receipt.status).toBe('pass');
  });

  it('没有建筑证据时 skipped 并说明缺什么', () => {
    const receipt = evaluateOne('GEN-07', { facilities: [facility('f-1', 'tent-3x3', 0, 0)] });
    expect(receipt.status).toBe('skipped');
    expect(receipt.reason).toBe('no-building-evidence');
  });

  it('摊位距建筑 1 m 判 MKT-11 违规', () => {
    const receipt = evaluateOne('MKT-11', {
      facilities: [facility('s-1', 'booth-2x2', 8, 5)],
      obstacles: [building(10, 0, 20, 10)],
    });
    expect(receipt.status).toBe('violation');
  });
});

describe('MKT-02 摊位间距（左右 1.5 m / 上下 2 m）', () => {
  it('左右相邻 1 m 判违规', () => {
    const receipt = evaluateOne('MKT-02', {
      facilities: [facility('s-1', 'booth-2x2', 0, 0), facility('s-2', 'booth-2x2', 3, 0)],
    });
    expect(receipt.status).toBe('violation');
    expect(receipt.detail).toContain('低于 1.5 m');
  });

  it('左右相邻 2 m 通过', () => {
    const receipt = evaluateOne('MKT-02', {
      facilities: [facility('s-1', 'booth-2x2', 0, 0), facility('s-2', 'booth-2x2', 4, 0)],
    });
    expect(receipt.status).toBe('pass');
  });

  it('上下相邻 1 m 按 2 m 判违规', () => {
    const receipt = evaluateOne('MKT-02', {
      facilities: [facility('s-1', 'booth-2x2', 0, 0), facility('s-2', 'booth-2x2', 0, 3)],
    });
    expect(receipt.status).toBe('violation');
    expect(receipt.detail).toContain('低于 2 m');
  });
});

describe('MKT-06 明火分区', () => {
  it('明火摊距其他摊 4 m 判违规', () => {
    const receipt = evaluateOne('MKT-06', {
      facilities: [facility('f-1', 'food-truck-6x2.5', 0, 0, 6, 2.5), facility('s-1', 'booth-2x2', 8, 0)],
    });
    expect(receipt.status).toBe('violation');
    expect(receipt.detail).toContain('明火摊与其他摊位');
  });

  it('明火摊距其他摊 6 m 通过', () => {
    const receipt = evaluateOne('MKT-06', {
      facilities: [facility('f-1', 'food-truck-6x2.5', 0, 0, 6, 2.5), facility('s-1', 'booth-2x2', 10, 0)],
    });
    expect(receipt.status).toBe('pass');
  });
});

describe('MKT-07 灭火器配比', () => {
  const stalls = (count: number) =>
    Array.from({ length: count }, (_, index) => facility(`s-${index}`, 'booth-2x2', index * 4, 0));

  it('10 摊 0 具判违规', () => {
    const receipt = evaluateOne('MKT-07', { facilities: stalls(10) });
    expect(receipt.status).toBe('violation');
    expect(receipt.expected).toContain('2');
  });

  it('10 摊 2 具通过', () => {
    const receipt = evaluateOne('MKT-07', {
      facilities: [...stalls(10), facility('e-1', 'fire-extinguisher', 0, 5, 0.4, 0.4), facility('e-2', 'fire-extinguisher', 4, 5, 0.4, 0.4)],
    });
    expect(receipt.status).toBe('pass');
  });
});

describe('MKT-10 摊位占地率', () => {
  it('100 ㎡ 场地摆 10 个 2×2 摊位（40%）判违规', () => {
    const facilities = Array.from({ length: 10 }, (_, index) => facility(`s-${index}`, 'booth-2x2', (index % 5) * 4 + 2, Math.floor(index / 5) * 4 + 2));
    const receipt = evaluateOne('MKT-10', { facilities, boundary: square(10) });
    expect(receipt.status).toBe('violation');
    expect(receipt.actual).toContain('40%');
  });

  it('100×100 场地同摊位通过', () => {
    const facilities = Array.from({ length: 10 }, (_, index) => facility(`s-${index}`, 'booth-2x2', (index % 5) * 4 + 2, Math.floor(index / 5) * 4 + 2));
    const receipt = evaluateOne('MKT-10', { facilities, boundary: square(100) });
    expect(receipt.status).toBe('pass');
  });
});

describe('STG-01 观众密度', () => {
  const zone = (size: number) => ({ id: 'z-1', semantic: 'audience', name: '观众区', polygon: square(size) });

  it('100 ㎡ / 50 人 = 2 ㎡/人 通过', () => {
    const receipt = evaluateOne('STG-01', { facilities: [], zones: [zone(10)], people: 50 });
    expect(receipt.status).toBe('pass');
  });

  it('100 ㎡ / 200 人 = 0.5 ㎡/人 违规', () => {
    const receipt = evaluateOne('STG-01', { facilities: [], zones: [zone(10)], people: 200 });
    expect(receipt.status).toBe('violation');
    expect(receipt.actual).toContain('0.5');
  });

  it('没有人数的 skipped 不算通过', () => {
    const receipt = evaluateOne('STG-01', { facilities: [], zones: [zone(10)] });
    expect(receipt.status).toBe('skipped');
    expect(receipt.reason).toBe('no-people-count');
  });
});

describe('STG-02 首排退距（随台高变化）', () => {
  const stage = { id: 'z-stage', semantic: 'stage', name: '舞台区', polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 6 }] };
  const audienceAt = (minX: number) => ({
    id: 'z-aud',
    semantic: 'audience',
    name: '观众区',
    polygon: [{ x: minX, y: 0 }, { x: minX + 20, y: 0 }, { x: minX + 20, y: 10 }, { x: minX, y: 10 }],
  });

  it('退距 2 m 判违规', () => {
    const receipt = evaluateOne('STG-02', { facilities: [], zones: [stage, audienceAt(10)] });
    expect(receipt.status).toBe('violation');
    expect(receipt.expected).toContain('5');
  });

  it('退距 7 m 且台高 0 通过', () => {
    const receipt = evaluateOne('STG-02', { facilities: [], zones: [stage, audienceAt(15)] });
    expect(receipt.status).toBe('pass');
  });

  it('台高 3 m 时阈值升到 11 m，同一布置转而违规', () => {
    const receipt = evaluateOne('STG-02', { facilities: [], zones: [stage, audienceAt(15)], stageHeightM: 3 });
    expect(receipt.status).toBe('violation');
    expect(receipt.expected).toContain('11');
  });
});

describe('CMP-02 / CMP-03 露营间距', () => {
  it('帐篷间距 1 m 判违规', () => {
    const receipt = evaluateOne('CMP-02', {
      facilities: [facility('t-1', 'tent-3x3', 0, 0, 3, 3), facility('t-2', 'tent-3x3', 4, 0, 3, 3)],
    });
    expect(receipt.status).toBe('violation');
  });

  it('帐篷防火 2 m 判违规（服务间距 2 m 不等于防火 4 m）', () => {
    const receipt = evaluateOne('CMP-03', {
      facilities: [facility('t-1', 'tent-3x3', 0, 0, 3, 3), facility('t-2', 'tent-3x3', 5, 0, 3, 3)],
    });
    expect(receipt.status).toBe('violation');
    expect(receipt.expected).toContain('4');
  });

  it('帐篷 6 m + 明火 9 m 判违规（明火要 10 m）', () => {
    const receipt = evaluateOne('CMP-03', {
      facilities: [
        facility('t-1', 'tent-3x3', 0, 0, 3, 3),
        facility('t-2', 'tent-3x3', 9, 0, 3, 3),
        facility('f-1', 'food-truck-6x2.5', 0, 11.75, 6, 2.5),
      ],
    });
    expect(receipt.status).toBe('violation');
  });
});

describe('几何底座', () => {
  it('90° 旋转交换宽深', () => {
    const upright = facilityRect(facility('a', 't', 0, 0, 4, 2, 0));
    const turned = facilityRect(facility('b', 't', 0, 0, 4, 2, 90));
    expect(upright.maxX - upright.minX).toBe(4);
    expect(turned.maxX - turned.minX).toBe(2);
    expect(turned.maxY - turned.minY).toBe(4);
  });

  it('斜向净距取较大的正交偏移', () => {
    const a = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const b = { minX: 4, maxX: 5, minY: 6, maxY: 7 };
    expect(rectGap(a, b)).toBe(5);
  });

  it('多边形面积按鞋带公式', () => {
    expect(ringArea(square(10))).toBe(100);
  });
});

describe('提示词摘要', () => {
  it('21 条核心判据全部进正文，且不超预算', () => {
    const digest = buildPromptDigest(corpus.rules);
    expect(digest.ruleIds).toHaveLength(21);
    expect(digest.omitted).toEqual([]);
    expect(digest.chars).toBeLessThanOrEqual(digest.budget);
    for (const id of digest.ruleIds) expect(digest.text).toContain(id);
  });

  it('C 级一律带「建议值，非规范」，全文不出现「规范要求」', () => {
    const digest = buildPromptDigest(corpus.rules);
    for (const line of digest.text.split('\n')) {
      const id = line.slice(0, 6);
      const ruleItem = ruleById.get(id);
      if (!ruleItem) continue;
      if (ruleItem.sourceLevel === 'C') expect(line).toContain('建议值，非规范');
    }
    expect(digest.text).not.toContain('规范要求');
  });

  it('预算收紧时整条丢弃并列出 id，不静默截半句', () => {
    const digest = buildPromptDigest(corpus.rules, 200);
    expect(digest.omitted.length).toBeGreaterThan(0);
    expect(digest.ruleIds.length + digest.omitted.length).toBe(21);
    for (const line of digest.text.split('\n')) expect(line.endsWith('评分') || line.endsWith('落笔') || line.includes('；')).toBe(true);
  });

  it('同一规则每次生成同一行（确定性）', () => {
    expect(digestLine(rule('GEN-03'))).toBe(digestLine(rule('GEN-03')));
  });
});

describe('回执聚合', () => {
  it('只把硬性违规筛出来', () => {
    const evaluation = evaluateLayout(
      { facilities: [facility('s-1', 'booth-2x2', 0, 0), facility('s-2', 'booth-2x2', 3, 0)] },
      corpus.rules,
    );
    const hard = hardViolations(evaluation);
    expect(hard.every((item) => item.severity === 'hard')).toBe(true);
    expect(hard.map((item) => item.ruleId)).toContain('MKT-02');
  });
});
