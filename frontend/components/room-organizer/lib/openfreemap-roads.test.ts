import { describe, expect, it } from 'vitest';
import {
  consecutiveSharedRun,
  decimatePoints,
  highwayForTransportationClass,
  matchRoadName,
  roadNameKey,
  toGcjRoadSegments,
  vertexKey,
} from './openfreemap-roads';
import { tilePointToLngLat, tilesForBBox } from './openfreemap-tiles';

describe('openfreemap-roads（与底图同源的 transportation 解码）', () => {
  describe('highwayForTransportationClass', () => {
    it('只产出前端 HIGHWAY_CLASS_MAP 认识的等级', () => {
      expect(highwayForTransportationClass('primary')).toBe('primary');
      expect(highwayForTransportationClass('trunk')).toBe('trunk');
      expect(highwayForTransportationClass('minor')).toBe('residential');
      expect(highwayForTransportationClass('service')).toBe('service');
    });

    it('path 按 subclass 细分，未知 subclass 回落 path', () => {
      expect(highwayForTransportationClass('path', 'pedestrian')).toBe('pedestrian');
      expect(highwayForTransportationClass('path', 'footway')).toBe('footway');
      expect(highwayForTransportationClass('path', 'steps')).toBe('steps');
      expect(highwayForTransportationClass('path', 'cycleway')).toBe('cycleway');
      expect(highwayForTransportationClass('path', 'whatever')).toBe('path');
      expect(highwayForTransportationClass('path')).toBe('path');
    });

    it('轨交/站台/码头/轮渡不是进场道路，返回 null', () => {
      expect(highwayForTransportationClass('rail')).toBeNull();
      expect(highwayForTransportationClass('transit')).toBeNull();
      expect(highwayForTransportationClass('pier')).toBeNull();
      expect(highwayForTransportationClass('ferry')).toBeNull();
      expect(highwayForTransportationClass('')).toBeNull();
    });
  });

  describe('decimatePoints', () => {
    it('不超过上限时原样返回，超限时抽稀且首点保留', () => {
      const short: [number, number][] = [[1, 2], [3, 4]];
      expect(decimatePoints(short)).toEqual(short);
      const long: [number, number][] = Array.from({ length: 400 }, (_, i) => [i, i] as [number, number]);
      const out = decimatePoints(long);
      expect(out.length).toBeLessThanOrEqual(160);
      expect(out[0]).toEqual([0, 0]);
    });
  });

  describe('名字回填', () => {
    const line: [number, number][] = [[120.16, 30.25], [120.161, 30.251], [120.162, 30.252]];

    it('端点键方向无关', () => {
      expect(roadNameKey(line)).toBe(roadNameKey([...line].reverse()));
      expect(roadNameKey([])).toBe('');
    });

    it('连续共享 ≥2 个顶点才认名字（一个顶点是路口相交，不算）', () => {
      const vertices = new Set(line.slice(0, 2).map(vertexKey));
      expect(consecutiveSharedRun(line, vertices)).toBe(2);
      const junctionOnly = new Set([vertexKey(line[2]!)]);
      expect(consecutiveSharedRun(line, junctionOnly)).toBe(1);
    });

    it('端点键优先，其次连续共享顶点，再不行留空', () => {
      const exact = new Map([[roadNameKey(line), '延安路']]);
      expect(matchRoadName(line, { exact, features: [] })).toBe('延安路');
      expect(
        matchRoadName(line, {
          exact: new Map(),
          features: [{ label: '湖滨路', vertices: new Set([vertexKey(line[0]!), vertexKey(line[1]!)]) }],
        }),
      ).toBe('湖滨路');
      expect(
        matchRoadName(line, {
          exact: new Map(),
          features: [{ label: '错配', vertices: new Set([vertexKey([0, 0])]) }],
        }),
      ).toBe('');
    });
  });

  describe('toGcjRoadSegments', () => {
    it('WGS84 → GCJ-02、6 位小数、不足两点丢弃', () => {
      const out = toGcjRoadSegments([
        { id: 'a', highway: 'primary', name: '延安路', points: [[120.1637, 30.2528], [120.1647, 30.2538]] },
        { id: 'b', highway: 'path', name: '', points: [[120.1637, 30.2528]] },
      ]);
      expect(out).toHaveLength(1);
      const [lng, lat] = out[0]!.points[0]!;
      // GCJ-02 在杭州的偏移是亚角分级（几米到几百米），只需确认"确实换算了"且没跑飞。
      expect(Math.abs(lng - 120.1637)).toBeGreaterThan(0.0002);
      expect(Math.abs(lng - 120.1637)).toBeLessThan(0.01);
      expect(Math.abs(lat - 30.2528)).toBeGreaterThan(0.0002);
      expect(Math.abs(lat - 30.2528)).toBeLessThan(0.01);
      expect(String(lng).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
      expect(out[0]!.name).toBe('延安路');
    });
  });

  describe('瓦片数学', () => {
    it('in77（120.1637, 30.2528）落在 z14 的 13660/6746 块', () => {
      const tiles = tilesForBBox(120.1637, 30.2528, 120.1637, 30.2528, 14);
      expect(tiles).toEqual([{ z: 14, x: 13660, y: 6746 }]);
    });

    it('瓦片局部坐标 → 经纬度可回到瓦片原点', () => {
      const tile = { z: 14, x: 13660, y: 6746 };
      const [west, north] = tilePointToLngLat(tile, 4096, 0, 0);
      expect(west).toBeCloseTo((13660 / 2 ** 14) * 360 - 180, 9);
      const [east, south] = tilePointToLngLat(tile, 4096, 4096, 4096);
      expect(east - west).toBeCloseTo(360 / 2 ** 14, 9);
      expect(north).toBeGreaterThan(south);
    });
  });
});
