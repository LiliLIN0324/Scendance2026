import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_RULE_IDS, evaluateLayout } from '../frontend/lib/agent-corpus/evaluate';
import type { CorpusRule, Layout } from '../frontend/lib/agent-corpus/types';

/**
 * 真实场地档案抽取的守门测试（2026-11-18）。
 *
 * 这组测试的价值不是「JSON 能读」，而是钉住三件事：
 * 1) 抽出来的每个数字都能追回来源文件（sha256 + provenance）；
 * 2) 没抽到的语义没有被偷偷补上（zones 一律 unknown，不硬映射成 audience/stage）；
 * 3) 这批真实档案到底能算几条判据——答案是 0 条，这个结论也要被测试钉住，
 *    免得以后有人以为「跑过了就是验过了」。
 */

const root = process.cwd();
const dir = path.join(root, 'data', 'agent-corpus', 'venue-layouts');
const payload = JSON.parse(readFileSync(path.join(dir, 'layouts.json'), 'utf8')) as {
  layouts: {
    id: string;
    name: string;
    sourceType: string;
    source: { path: string; bytes: number; sha256: string };
    boundarySource: string;
    coordinateTransform: { kind: string; origin?: { lng: number; lat: number } };
    layout: Layout;
    labels: { name: string }[];
    routes: unknown[];
    counts: { facilities: number; zones: number; boundaryVertices: number; labels: number };
    evaluation: {
      totals: { pass: number; violation: number; skipped: number; unsupported: number };
      computed: { ruleId: string; status: string }[];
      skippedReasons: Record<string, number>;
    };
    caveats: string[];
  }[];
};
const rules = (JSON.parse(readFileSync(path.join(root, 'data', 'agent-corpus', 'layout-assertions.json'), 'utf8')) as { rules: CorpusRule[] }).rules;

const layoutOf = (id: string) => payload.layouts.find((item) => item.id === id)!;

describe('来源可追', () => {
  it('5 份档案，id 唯一', () => {
    expect(payload.layouts).toHaveLength(5);
    expect(new Set(payload.layouts.map((item) => item.id)).size).toBe(5);
  });

  it('每个来源文件都在，且 sha256 与文件内容一致', () => {
    for (const item of payload.layouts) {
      const absolute = path.join(root, item.source.path);
      expect(existsSync(absolute)).toBe(true);
      const digest = createHash('sha256').update(readFileSync(absolute)).digest('hex');
      expect(digest).toBe(item.source.sha256);
    }
  });

  it('每个物料都写清来自哪一类几何，不凭空出现', () => {
    for (const item of payload.layouts) {
      for (const facility of item.layout.facilities) {
        const provenance = (facility as unknown as { provenance?: { source?: string } }).provenance;
        expect(provenance?.source).toBeTruthy();
        expect(facility.size.width).toBeGreaterThan(0);
        expect(facility.size.depth).toBeGreaterThan(0);
        expect(Number.isFinite(facility.position.x)).toBe(true);
        expect(Number.isFinite(facility.position.y)).toBe(true);
      }
    }
  });

  it('边界写清来源，不把外接框冒充红线', () => {
    for (const item of payload.layouts) {
      expect(item.boundarySource.length).toBeGreaterThan(6);
      expect(item.layout.boundary?.length ?? 0).toBeGreaterThanOrEqual(4);
    }
    expect(layoutOf('NINGBO-FUWUQU').boundarySource).toContain('WALLS');
    expect(layoutOf('YANGUAN-AFTER').boundarySource).toContain('bbox');
  });
});

describe('不补不猜', () => {
  it('GeoJSON 的区域语义一律 unknown，没硬映射成 audience/stage', () => {
    for (const id of ['YANGUAN-BEFORE', 'YANGUAN-AFTER']) {
      const zones = layoutOf(id).layout.zones ?? [];
      expect(zones.length).toBeGreaterThan(0);
      for (const zone of zones) expect(zone.semantic).toBe('unknown');
    }
  });

  it('经纬投影参数写在文件里，换算后的尺寸与盐官实地量级相符', () => {
    const item = layoutOf('YANGUAN-AFTER');
    expect(item.coordinateTransform.kind).toBe('equirectangular');
    expect(item.coordinateTransform.origin?.lat).toBeGreaterThan(30.4);
    expect(item.coordinateTransform.origin?.lat).toBeLessThan(30.42);
    // 签到区多边形本身约 20×10 m；边界外接框还包含引导线，所以只对多边形做量级校验。
    const zoneRing = (item.layout.zones ?? [])[0].polygon;
    const zoneXs = zoneRing.map((point) => point.x);
    const zoneYs = zoneRing.map((point) => point.y);
    const zoneWidth = Math.max(...zoneXs) - Math.min(...zoneXs);
    const zoneHeight = Math.max(...zoneYs) - Math.min(...zoneYs);
    expect(zoneWidth).toBeGreaterThan(15);
    expect(zoneWidth).toBeLessThan(25);
    expect(zoneHeight).toBeGreaterThan(5);
    expect(zoneHeight).toBeLessThan(15);
    // 边界必须罩住区域，不能比区域还小。
    const boundaryXs = (item.layout.boundary ?? []).map((point) => point.x);
    expect(Math.max(...boundaryXs) - Math.min(...boundaryXs)).toBeGreaterThanOrEqual(zoneWidth);
  });

  it('抽取到的标注数量与 DXF 里一致，没有被吞掉', () => {
    expect(layoutOf('NINGBO-FUWUQU').counts.labels).toBe(19);
    expect(layoutOf('HANGZHOU2-FIRST').counts.labels).toBe(11);
  });

  it('每份档案都带 caveats，说明缺什么', () => {
    for (const item of payload.layouts) {
      expect(item.caveats.length).toBeGreaterThan(0);
      expect(item.caveats.join('')).toContain('没有');
    }
  });
});

describe('真实档案能算几条判据', () => {
  it('11 条已实现判据一条都算不出来——这个结论要钉住', () => {
    for (const item of payload.layouts) {
      expect(item.evaluation.computed).toHaveLength(0);
      const totals = item.evaluation.totals;
      expect(totals.pass).toBe(0);
      expect(totals.violation).toBe(0);
      expect(totals.skipped).toBe(11);
      expect(totals.unsupported).toBe(69);
      expect(totals.skipped + totals.unsupported + totals.pass + totals.violation).toBe(rules.length);
    }
  });

  it('跳过原因可读：缺摊位、缺观众区、缺建筑、缺出入口', () => {
    const reasons = layoutOf('NINGBO-FUWUQU').evaluation.skippedReasons;
    expect(reasons['not-enough-stalls']).toBeGreaterThan(0);
    expect(reasons['no-audience-zone']).toBeGreaterThan(0);
    expect(reasons['no-building-evidence']).toBeGreaterThan(0);
    expect(reasons['no-entrance-nodes']).toBeGreaterThan(0);
  });

  it('空布局不再因 0% 占地率被判合规：MKT-10 报 skipped', () => {
    const layout = layoutOf('NINGBO-FUWUQU').layout;
    const evaluation = evaluateLayout(layout, rules);
    const mkt10 = evaluation.receipts.find((item) => item.ruleId === 'MKT-10')!;
    expect(mkt10.status).toBe('skipped');
    expect(mkt10.reason).toBe('not-enough-stalls');
  });

  it('对照：同一份墙线，摆上 6 个摊位后 MKT-10 才真的开始算', () => {
    const layout = layoutOf('NINGBO-FUWUQU').layout;
    const withStalls: Layout = {
      ...layout,
      facilities: [
        ...layout.facilities,
        ...[0, 1, 2, 3, 4, 5].map((index) => ({
          id: `booth-test-${index}`,
          templateId: 'booth-3x3',
          name: `测试摊位 ${index}`,
          position: { x: 1 + (index % 3) * 3, y: 1 + Math.floor(index / 3) * 4 },
          rotationDeg: 0,
          size: { width: 3, depth: 3 },
        })),
      ],
    };
    const evaluation = evaluateLayout(withStalls, rules);
    const mkt10 = evaluation.receipts.find((item) => item.ruleId === 'MKT-10')!;
    expect(['pass', 'violation']).toContain(mkt10.status);
    expect((IMPLEMENTED_RULE_IDS as readonly string[]).includes('MKT-10')).toBe(true);
  });
});
