import { describe, expect, it } from 'vitest';
import { parseRoadNetwork, routeClassForHighway, routeClassLabel } from './road-network';

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
      expect(parseRoadNetwork(null)).toEqual([]);
      expect(parseRoadNetwork({})).toEqual([]);
      expect(parseRoadNetwork({ roads: 'x' })).toEqual([]);
    });

    it('保留合法段，name 去空白；缺 id 时回首点坐标拼接', () => {
      const roads = parseRoadNetwork({
        roads: [
          { id: 'r1', highway: 'motorway', name: ' 天目山路 ', points: [[120.14, 30.25], [120.15, 30.26]] },
          { highway: 'footway', name: '步径', points: [[120.14, 30.25], [120.14, 30.26]] },
        ],
      });
      expect(roads).toHaveLength(2);
      expect(roads[0]).toMatchObject({ id: 'r1', highway: 'motorway', name: '天目山路' });
      expect(roads[1]!.id).toBe('120.14,30.25');
    });

    it('裁掉缺 points、点非有限、不足两点的段', () => {
      const roads = parseRoadNetwork({
        roads: [
          { id: 'skip-short', highway: 'path', points: [[120.14, 30.25]] },
          { id: 'skip-nopoints', highway: 'service' },
          { id: 'skip-badpoint', highway: 'path', points: [[120.14, 30.25], [NaN, 30.26]] },
          { id: 'ok', highway: 'secondary', name: '路', points: [[120.14, 30.25], [120.16, 30.27]] },
        ],
      });
      expect(roads.map(r => r.id)).toEqual(['ok']);
    });
  });
});
