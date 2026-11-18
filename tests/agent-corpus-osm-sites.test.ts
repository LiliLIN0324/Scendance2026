import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * OSM 真实建筑轮廓的守门测试（2026-11-18）。
 *
 * 守四件事：
 * 1) 数据来源与许可不能丢：没有 ODbL 归属就不许出图；
 * 2) 投影必须与已有布局同一原点，否则设施和建筑不在一个坐标系里，
 *    「最小退距 9.8 m」就是编出来的；
 * 3) 建筑轮廓闭合、面积为正，不能有空环；
 * 4) 这一轮的真实成果要钉住：GEN-07 第一次在真实数据上算出结果。
 */

const root = process.cwd();
const sitesDir = path.join(root, 'data', 'agent-corpus', 'sites');

const site = JSON.parse(readFileSync(path.join(sitesDir, 'yanguan.json'), 'utf8')) as {
  license: { name: string; attribution: string; source: string; notice: string };
  query: { endpoint: string; query: string; radiusM: number; osmBaseTimestamp: string | null; rawFile: string };
  origin: { lng: number; lat: number; metersPerDegLat: number; metersPerDegLng: number; kind: string };
  buildings: {
    osmId: number;
    polygon: { x: number; y: number }[];
    areaM2: number;
    bbox: { minX: number; maxX: number; minY: number; maxY: number };
    tags: Record<string, string>;
  }[];
  stats: { buildingCount: number; totalFootprintM2: number; extentM: { width: number; height: number } | null };
};

const check = JSON.parse(readFileSync(path.join(sitesDir, 'yanguan-check.json'), 'utf8')) as {
  siteId: string;
  layoutRef: { file: string; id: string };
  inputs: { facilities: number; zones: number; buildings: number; facilityProvenance: string; obstacleProvenance: string };
  counts: { pass: number; violation: number; skipped: number; unsupported: number };
  computed: { ruleId: string; status: string; actual: string; expected: string }[];
};

const layouts = JSON.parse(readFileSync(path.join(root, 'data', 'agent-corpus', 'venue-layouts', 'layouts.json'), 'utf8')) as {
  layouts: { id: string; layout: { facilities: unknown[]; zones?: unknown[] }; coordinateTransform: { origin: { lng: number; lat: number } } }[];
};

describe('来源与许可', () => {
  it('带 ODbL 归属，且指向 openstreetmap.org', () => {
    expect(site.license.name).toBe('ODbL 1.0');
    expect(site.license.attribution).toContain('OpenStreetMap');
    expect(site.license.source).toContain('openstreetmap.org');
    expect(site.license.notice).toContain('ODbL');
  });

  it('原始导出文件还在，且它自己的版权声明也是 ODbL', () => {
    const rawPath = path.join(root, site.query.rawFile);
    expect(existsSync(rawPath)).toBe(true);
    const raw = JSON.parse(readFileSync(rawPath, 'utf8').replace(/^\uFEFF/, '')) as {
      osm3s?: { copyright?: string; timestamp_osm_base?: string };
      elements: unknown[];
    };
    expect(raw.osm3s?.copyright ?? '').toContain('ODbL');
    expect(raw.osm3s?.timestamp_osm_base).toBe(site.query.osmBaseTimestamp);
    expect(raw.elements.length).toBeGreaterThanOrEqual(site.buildings.length);
  });

  it('查询口径写清：端点、半径、时间戳', () => {
    expect(site.query.endpoint).toContain('overpass');
    expect(site.query.radiusM).toBe(120);
    expect(site.query.query).toContain('building');
    expect(site.query.osmBaseTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('几何与投影', () => {
  it('8 栋建筑，轮廓闭合，面积为正', () => {
    expect(site.buildings).toHaveLength(8);
    expect(site.stats.buildingCount).toBe(8);
    for (const building of site.buildings) {
      expect(building.polygon.length).toBeGreaterThanOrEqual(4);
      const first = building.polygon[0];
      const last = building.polygon[building.polygon.length - 1];
      expect({ x: first.x, y: first.y }).toEqual({ x: last.x, y: last.y });
      expect(building.areaM2).toBeGreaterThan(0);
    }
    expect(site.stats.totalFootprintM2).toBeGreaterThan(100);
  });

  it('投影原点与真实坐标布局完全一致（否则两套坐标不能叠）', () => {
    const layout = layouts.layouts.find((item) => item.id === check.layoutRef.id)!;
    expect(site.origin.lng).toBe(layout.coordinateTransform.origin.lng);
    expect(site.origin.lat).toBe(layout.coordinateTransform.origin.lat);
    expect(site.origin.kind).toBe('equirectangular');
  });

  it('任取一栋建筑的角点，能从原始经纬复算出同一坐标', () => {
    const raw = JSON.parse(readFileSync(path.join(root, site.query.rawFile), 'utf8').replace(/^\uFEFF/, '')) as {
      elements: { id: number; geometry: { lat: number; lon: number }[] }[];
    };
    const building = site.buildings[0];
    const source = raw.elements.find((element) => element.id === building.osmId)!;
    const point = source.geometry[0];
    const x = Math.round((point.lon - site.origin.lng) * site.origin.metersPerDegLng * 100) / 100;
    const y = Math.round((point.lat - site.origin.lat) * site.origin.metersPerDegLat * 100) / 100;
    expect(Math.abs(building.polygon[0].x - x)).toBeLessThan(0.05);
    expect(Math.abs(building.polygon[0].y - y)).toBeLessThan(0.05);
  });
});

describe('真实数据下的判据', () => {
  it('GEN-07 第一次算出结果：真实建筑 + 真实设施坐标', () => {
    const gen07 = check.computed.find((item) => item.ruleId === 'GEN-07');
    expect(gen07).toBeTruthy();
    expect(['pass', 'violation']).toContain(gen07!.status);
    expect(gen07!.actual).toContain('最小退距');
    expect(gen07!.expected).toContain('≥3 m');
    expect(check.computed).toHaveLength(1);
  });

  it('设施来自真实坐标布局，建筑来自 OSM，来源分别写明', () => {
    const layout = layouts.layouts.find((item) => item.id === check.layoutRef.id)!;
    expect(check.inputs.facilities).toBe(layout.layout.facilities.length);
    expect(check.inputs.zones).toBe((layout.layout.zones ?? []).length);
    expect(check.inputs.buildings).toBe(site.buildings.length);
    expect(check.inputs.facilityProvenance).toContain('GeoJSON');
    expect(check.inputs.obstacleProvenance).toContain('OSM');
  });

  it('80 条判据的去向加起来对得上', () => {
    const total = check.counts.pass + check.counts.violation + check.counts.skipped + check.counts.unsupported;
    expect(total).toBe(80);
    expect(check.counts.skipped).toBe(10);
    expect(check.counts.unsupported).toBe(69);
  });
});
