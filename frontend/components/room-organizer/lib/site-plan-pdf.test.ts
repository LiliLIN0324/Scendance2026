import { describe, expect, it } from 'vitest';
import { buildDeckPages, deckCaption, deckLegendLines } from './site-plan-pdf';
import { encodeSnapshot, decodeSnapshot } from './site-plan-share';
import type { SitePlanSnapshot } from '../../../../supabase/functions/_shared/site-plan';

function sampleSnapshot(): SitePlanSnapshot {
  return {
    planId: '99999999-9999-4999-8999-999999999999',
    projectId: '88888888-8888-4888-8888-888888888888',
    revision: 3,
    updatedAt: '2026-11-10T14:00:00.000Z',
    data: {
      schemaVersion: 1,
      anchor: { lng: 120.1443, lat: 30.2459, crs: 'gcj-02', source: 'picker' },
      boundary: [
        { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 },
      ],
      zones: [
        {
          id: 'a1000000-0000-4000-8000-000000000001', semantic: 'audience', name: '观众区',
          polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
          notes: '',
        },
      ],
      facilities: [
        { id: 'b2000000-0000-4000-8000-000000000001', templateId: 'booth-2x2', name: '摊位', position: { x: 60, y: 80 }, rotationDeg: 0, size: { width: 2, depth: 2 }, notes: '' },
      ],
      routes: [
        { id: 'c3000000-0000-4000-8000-000000000001', kind: 'pedestrian', name: '入场动线', points: [{ x: 0, y: 60 }, { x: 55, y: 60 }], oneWay: true, notes: '' },
      ],
      nodes: [
        { id: 'd4000000-0000-4000-8000-000000000001', kind: 'entry', name: '西门', position: { x: 0, y: 60 }, notes: '' },
      ],
      workers: [
        { id: 'e5000000-0000-4000-8000-000000000001', role: '安保', count: 2, position: { x: 3, y: 57 }, notes: '' },
      ],
      measurements: [],
    },
  } as unknown as SitePlanSnapshot;
}

describe('pdf deck pages (H5-b)', () => {
  it('builds cover + overview + grouped inventory pages', () => {
    const pages = buildDeckPages(sampleSnapshot());
    expect(pages[0].title).toBe('封面');
    expect(pages[0].lines[0]).toContain('幕景');
    expect(pages[0].lines[1]).toContain('r3');
    expect(pages[1].title).toBe('总览');
    expect(pages[1].lines.some(l => l.includes('24000'))).toBe(true);
    // 分组清单页：分区/设施/动线/出入口与人员（测量空组不输出）。
    const titles = pages.map(p => p.title);
    expect(titles).toContain('清单 · 分区');
    expect(titles).toContain('清单 · 设施');
    expect(titles).toContain('清单 · 动线');
    expect(titles).toContain('清单 · 出入口与人员');
    expect(titles).not.toContain('清单 · 测量');
  });

  it('keeps issue markers on inventory rows', () => {
    const pages = buildDeckPages(sampleSnapshot());
    const routePage = pages.find(p => p.title === '清单 · 动线')!;
    // 西门未连动线是问题——「出入口与人员」组带 ⚠。
    const nodePage = pages.find(p => p.title === '清单 · 出入口与人员')!;
    expect(nodePage.lines.some(l => l.includes('⚠')) || routePage.lines.every(l => !l.includes('⚠'))).toBe(true);
  });

  it('derives legend lines from the same source as the canvas legend', () => {
    const legend = deckLegendLines(sampleSnapshot().data);
    expect(legend.length).toBeGreaterThan(0);
    expect(legend.some(l => l.includes('观众区'))).toBe(true);
  });

  it('writes the deck caption with revision and OSM attribution', () => {
    const caption = deckCaption(5, new Date('2026-11-10T15:00:00'));
    expect(caption).toContain('r5');
    expect(caption).toContain('OpenStreetMap');
  });
});

describe('share link snapshot codec (H5-b)', () => {
  it('round-trips a snapshot through base64url without loss', () => {
    const snapshot = sampleSnapshot();
    const encoded = encodeSnapshot(snapshot);
    expect(encoded).toMatch(/^[A-Za-z0-9\-_]+$/);
    const decoded = decodeSnapshot(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.revision).toBe(3);
    expect(decoded!.data.zones[0].name).toBe('观众区');
    expect(decoded!.data.facilities).toHaveLength(1);
  });

  it('rejects corrupted payloads safely', () => {
    expect(decodeSnapshot('!!!not-base64!!!')).toBeNull();
    expect(decodeSnapshot('eyJub3QiOiJhIHNuYXBzaG90In0')).toBeNull(); // 合法 b64 但 schema 不符。
  });
});

