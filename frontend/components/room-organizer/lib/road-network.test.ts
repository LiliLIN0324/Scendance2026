import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRoadNetwork, parseRoadNetwork, routeClassForHighway, routeClassLabel } from './road-network';
import { fetchOpenFreeMapRoads } from './openfreemap-roads';

vi.mock('./openfreemap-roads', () => ({ fetchOpenFreeMapRoads: vi.fn() }));
const ofmRoads = vi.mocked(fetchOpenFreeMapRoads);

describe('road-network（OSM 等级 → 流线类别 / 坏段裁剪）', () => {
  describe('routeClassForHighway', () => {
    it('机动车主/次干道归车行，步行步道归人行，支路街巷归后勤', () => {
      expect(routeClassForHighway('motorway')).toBe('vehicle');
      expect(routeClassForHighway('primary_link')).toBe('vehicle');
      expect(routeClassForHighway('footway')).toBe('pedestrian');
      expect(routeClassForHighway('path')).toBe('pedestrian');
      expect(routeClassForHighway('service')).toBe('service');
      expect(routeClassForHighway('residential')).toBe('service');
    });

    it('未登记等级回落 null', () => {
      expect(routeClassForHighway('emergency-route')).toBeNull();
      expect(routeClassForHighway('')).toBeNull();
    });
  });

  describe('routeClassLabel', () => {
    it('三类出中文标签', () => {
      expect(routeClassLabel('pedestrian')).toBe('人行');
      expect(routeClassLabel('vehicle')).toBe('车行');
      expect(routeClassLabel('service')).toBe('后勤');
    });
  });

  describe('parseRoadNetwork', () => {
    it('非对象 / 无 roads 数组返回空', () => {
      expect(parseRoadNetwork(null)).toEqual({ roads: [] });
      expect(parseRoadNetwork({})).toEqual({ roads: [] });
      expect(parseRoadNetwork({ roads: 'x' })).toEqual({ roads: [] });
    });

    it('保留合法段，name 去空白；缺 id 时回首点坐标拼接', () => {
      const network = parseRoadNetwork({
        roads: [
          { id: 'r1', highway: 'motorway', name: ' 天目山路 ', points: [[120.14, 30.25], [120.15, 30.26]] },
          { highway: 'footway', name: '步径', points: [[120.14, 30.25], [120.14, 30.26]] },
        ],
      });
      expect(network.roads).toHaveLength(2);
      expect(network.roads[0]).toMatchObject({ id: 'r1', highway: 'motorway', name: '天目山路' });
      expect(network.roads[1]!.id).toBe('120.14,30.25');
    });

    it('裁掉缺 points、点非有限、不足两点的段', () => {
      const network = parseRoadNetwork({
        roads: [
          { id: 'skip-short', highway: 'path', points: [[120.14, 30.25]] },
          { id: 'skip-nopoints', highway: 'service' },
          { id: 'skip-badpoint', highway: 'path', points: [[120.14, 30.25], [NaN, 30.26]] },
          { id: 'ok', highway: 'secondary', name: '路', points: [[120.14, 30.25], [120.16, 30.27]] },
        ],
      });
      expect(network.roads.map(r => r.id)).toEqual(['ok']);
    });
  });

  // 2026-11-16：生产 Overpass 三镜像全坏（实测 26.5s 恒回空），瓦片源是主源、Overpass 只是兜底。
  describe('fetchRoadNetwork 取源顺序', () => {
    beforeEach(() => {
      ofmRoads.mockReset();
    });

    it('瓦片源有路就直接用，不再打服务端', async () => {
      ofmRoads.mockResolvedValue([
        { id: 'ofm:1', highway: 'primary', name: '延安路', points: [[120.16, 30.25], [120.17, 30.26]] },
      ]);
      const api = vi.fn();
      const network = await fetchRoadNetwork({ lng: 120.1637, lat: 30.2528 }, 600, {
        fetchImpl: api as unknown as typeof fetch,
        local: false,
      });
      expect(network.roads).toHaveLength(1);
      expect(api).not.toHaveBeenCalled();
    });

    it('瓦片源空就退服务端，并把 buildings 一起带出', async () => {
      ofmRoads.mockResolvedValue([]);
      const api = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          roads: [{ id: 'osm:1', highway: 'service', name: '', points: [[120.16, 30.25], [120.17, 30.26]] }],
          buildings: [{ id: 'b1', name: '', points: [[120.16, 30.25], [120.17, 30.25], [120.17, 30.26]] }],
        }),
      }));
      const network = await fetchRoadNetwork({ lng: 120.1637, lat: 30.2528 }, 600, {
        fetchImpl: api as unknown as typeof fetch,
        local: false,
      });
      expect(api).toHaveBeenCalledTimes(1);
      expect(network.roads.map(r => r.id)).toEqual(['osm:1']);
      expect(network.buildings).toHaveLength(1);
    });

    it('瓦片源抛错不阻塞兜底', async () => {
      ofmRoads.mockRejectedValue(new Error('tilejson down'));
      const api = vi.fn(async () => ({
        ok: true,
        json: async () => ({ roads: [{ id: 'osm:2', highway: 'path', name: '', points: [[120.16, 30.25], [120.17, 30.26]] }] }),
      }));
      const network = await fetchRoadNetwork({ lng: 120.1637, lat: 30.2528 }, 600, {
        fetchImpl: api as unknown as typeof fetch,
        local: false,
      });
      expect(network.roads.map(r => r.id)).toEqual(['osm:2']);
    });

    it('两头都拿不到时回空路网，不抛', async () => {
      ofmRoads.mockResolvedValue([]);
      const api = vi.fn(async () => {
        throw new Error('network down');
      });
      const network = await fetchRoadNetwork({ lng: 120.1637, lat: 30.2528 }, 600, {
        fetchImpl: api as unknown as typeof fetch,
        local: false,
      });
      expect(network).toEqual({ roads: [] });
    });

    it('ofm: false 显式只用服务端（本地代理面板调试用）', async () => {
      const api = vi.fn(async () => ({ ok: true, json: async () => ({ roads: [] }) }));
      await fetchRoadNetwork({ lng: 120.1637, lat: 30.2528 }, 600, {
        fetchImpl: api as unknown as typeof fetch,
        local: false,
        ofm: false,
      });
      expect(ofmRoads).not.toHaveBeenCalled();
      expect(api).toHaveBeenCalledTimes(1);
    });
  });
});
