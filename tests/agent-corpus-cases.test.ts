import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CorpusRule } from '../frontend/lib/agent-corpus/types';

/**
 * 成熟案例库与物料参考的守门测试（2026-11-18）。
 *
 * 守三件事：
 * 1) 案例的读数、锚点、件数可复算，且锚点经纬顺序没有被读反；
 * 2) 案例引用的模板与判据都存在，档案文件真的存在；
 * 3) 外部物料参数只能有出处、只能标「未核」，不许冒充实测或规范。
 */

const root = process.cwd();
const dir = path.join(root, 'data', 'agent-corpus');

type CaseFile = {
  schemaVersion: number;
  counts: { basemap: number; recommended: number; venues: number; venueFiles: number; incidents: number };
  basemap: {
    id: string;
    name: string;
    anchor: { lat: number; lng: number; raw: string; rawOrder: string; matchesRaw: boolean };
    spanM: { width: number | null; height: number | null };
    counts: { zones: number | null; objects: number | null; routes: number | null; entrances: number | null };
    templateHints: string[];
    recommended: boolean;
    confidence: string;
    evidence: Record<string, string>;
  }[];
  venues: { id: string; name: string; files: string[]; fileCount: number; templateHints: string[]; evidence: { dir: string } }[];
  incidents: {
    id: string;
    name: string;
    failureModes: string[];
    assertionRefs: string[];
    templateHints: string[];
    verification: string;
  }[];
};

const cases = JSON.parse(readFileSync(path.join(dir, 'cases', 'cases.json'), 'utf8')) as CaseFile;
const ruleIds = new Set(
  (JSON.parse(readFileSync(path.join(dir, 'layout-assertions.json'), 'utf8')) as { rules: CorpusRule[] }).rules.map((rule) => rule.id),
);
const templateIds = new Set(
  (JSON.parse(readFileSync(path.join(dir, 'event-templates.json'), 'utf8')) as { templates: { id: string }[] }).templates.map(
    (template) => template.id,
  ),
);
const materials = (() => {
  const text = readFileSync(path.join(dir, 'materials.csv'), 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
  });
})();
const materialIds = new Set(materials.map((row) => row.id));

describe('案例库：底图核对 43 案', () => {
  it('数量、推荐数与统计字段一致', () => {
    expect(cases.basemap).toHaveLength(43);
    expect(cases.counts.basemap).toBe(43);
    expect(cases.basemap.filter((item) => item.recommended)).toHaveLength(10);
    expect(cases.counts.recommended).toBe(10);
  });

  it('id 唯一，跨三类不重复', () => {
    const ids = [...cases.basemap, ...cases.venues, ...cases.incidents].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('锚点经纬没有读反：每条都能从「经在前」原始串复算出来', () => {
    for (const item of cases.basemap) {
      expect(item.anchor.rawOrder).toBe('lng,lat');
      expect(item.anchor.matchesRaw).toBe(true);
      expect(item.anchor.lat).toBeGreaterThanOrEqual(-90);
      expect(item.anchor.lat).toBeLessThanOrEqual(90);
      expect(item.anchor.lng).toBeGreaterThanOrEqual(-180);
      expect(item.anchor.lng).toBeLessThanOrEqual(180);
      const [lng, lat] = item.anchor.raw.split(',').map((part) => Number(part.trim()));
      expect(lng).toBeCloseTo(item.anchor.lng, 6);
      expect(lat).toBeCloseTo(item.anchor.lat, 6);
    }
  });

  it('跨度与件数都是正数或显式缺失，不出现 0 冒充有数据', () => {
    for (const item of cases.basemap) {
      for (const value of [item.spanM.width, item.spanM.height]) {
        if (value !== null) expect(value).toBeGreaterThan(0);
      }
      for (const value of Object.values(item.counts)) {
        if (value !== null) expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('模板提示都在注册表里，且每条案例带来源与可信度口径', () => {
    for (const item of cases.basemap) {
      for (const hint of item.templateHints) expect(templateIds.has(hint)).toBe(true);
      expect(item.confidence).toContain('不是');
      expect(Object.keys(item.evidence).length).toBeGreaterThan(0);
    }
  });
});

describe('案例库：自有场地档案', () => {
  it('场地数与文件数对得上，且每个文件真实存在', () => {
    expect(cases.venues.length).toBe(cases.counts.venues);
    const total = cases.venues.reduce((sum, venue) => sum + venue.fileCount, 0);
    expect(total).toBe(cases.counts.venueFiles);
    for (const venue of cases.venues) {
      expect(venue.fileCount).toBe(venue.files.length);
      expect(venue.files.length).toBeGreaterThan(0);
      for (const file of venue.files) {
        expect(existsSync(path.join(root, venue.evidence.dir, file))).toBe(true);
      }
      for (const hint of venue.templateHints) expect(templateIds.has(hint)).toBe(true);
    }
  });

  it('不再出现「未分组」这类兜底名', () => {
    expect(cases.venues.map((venue) => venue.name)).not.toContain('未分组');
  });
});

describe('案例库：公开事故复盘', () => {
  it('只记布局失效模式，绑定判据，且明确未取得调查报告', () => {
    expect(cases.incidents).toHaveLength(3);
    for (const incident of cases.incidents) {
      expect(incident.failureModes.length).toBeGreaterThan(0);
      expect(incident.assertionRefs.length).toBeGreaterThan(0);
      for (const id of incident.assertionRefs) expect(ruleIds.has(id)).toBe(true);
      for (const hint of incident.templateHints) expect(templateIds.has(hint)).toBe(true);
      expect(incident.verification).toContain('待回查');
      // 不许出现伤亡数字：没有字段，且名称与失效描述里也不写数值。
      expect(Object.keys(incident)).not.toContain('deaths');
      expect(Object.keys(incident)).not.toContain('casualties');
      expect(JSON.stringify(incident)).not.toMatch(/\d+\s*(死|伤|人遇难)/);
    }
  });
});

describe('物料参考值', () => {
  const rows = (() => {
    const text = readFileSync(path.join(dir, 'material-references.csv'), 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const header = lines[0].split(',');
    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
    });
  })();

  it('每一行都指向已有物料，字段非空', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(materialIds.has(row.material_id)).toBe(true);
      expect(row.field.length).toBeGreaterThan(0);
      expect(row.value.length).toBeGreaterThan(0);
      expect(row.unit.length).toBeGreaterThan(0);
    }
  });

  it('来源类型受控，URL 可点，取数日期是 ISO 日期', () => {
    const allowed = new Set(['vendor-page', 'standard', 'code', 'platform-case']);
    for (const row of rows) {
      expect(allowed.has(row.source_type)).toBe(true);
      expect(row.source_url).toMatch(/^https?:\/\//);
      expect(row.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('置信度必须自曝口径：商家页面只能写「未核」或替代值，不能写实测', () => {
    for (const row of rows) {
      expect(row.confidence.length).toBeGreaterThan(0);
      if (row.source_type === 'vendor-page') {
        expect(row.confidence).toMatch(/未核|替代值|同系列/);
        expect(row.confidence).not.toContain('实测');
      }
    }
  });

  it('物料表本身不因参考值被改写：canonical 的待核仍在', () => {
    const tent = materials.find((row) => row.id === 'tent-3x3')!;
    expect(tent['高_m']).toBe('待核');
    expect(tent['重量_kg']).toBe('待核');
  });
});
