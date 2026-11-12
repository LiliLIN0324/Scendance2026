import { describe, expect, it } from 'vitest';
import { buildZoneEventProposal, matchZoneCommand } from './zone-event-proposal';

const ids = (() => {
  let n = 0;
  return () => `id-${(n += 1)}`;
})();

/** 600×400m 矩形边界，中心在原点。 */
const BOUNDARY = [
  { x: -300, y: -200 }, { x: 300, y: -200 }, { x: 300, y: 200 }, { x: -300, y: 200 },
];

const ENTRANCE_S = { id: 'node-1', kind: 'entry' as const, name: '南口', position: { x: 0, y: -205 }, notes: '' };

describe('matchZoneCommand（V-3 意图）', () => {
  it('分区类说法命中 auto', () => {
    expect(matchZoneCommand('帮我分区')).toBe('auto');
    expect(matchZoneCommand('排一下区域')).toBe('auto');
    expect(matchZoneCommand('自动分区，按讲座配')).toBe('auto');
  });

  it('删除/无关说法不劫持', () => {
    expect(matchZoneCommand('把分区删了')).toBeNull();
    expect(matchZoneCommand('排一下流线')).toBeNull();
    expect(matchZoneCommand('')).toBeNull();
  });
});

describe('buildZoneEventProposal（V-3b 生成规则）', () => {
  it('南口默认：签到在南、观众居中、舞台在北；分区挂事件名', () => {
    const proposal = buildZoneEventProposal(
      { boundary: BOUNDARY, nodes: [ENTRANCE_S], brief: { event: '潮乐之夜', guests: 120 } },
      ids,
    )!;
    const bySemantic = new Map(proposal.zones.map(zone => [zone.semantic, zone]));
    const checkin = bySemantic.get('checkin')!;
    const audience = bySemantic.get('audience')!;
    const stage = bySemantic.get('stage')!;
    expect(checkin).toBeTruthy();
    expect(stage.polygon[0]!.y).toBeGreaterThan(audience.polygon[0]!.y); // 舞台比观众更靠北（远端）
    expect(audience.polygon[0]!.y).toBeGreaterThan(checkin.polygon[0]!.y); // 观众比签到更靠北
    expect(checkin.event).toBeUndefined(); // 签到区不挂活动事件
    expect(audience.event).toBe('潮乐之夜·观众区');
    expect(stage.event).toBe('潮乐之夜·舞台区');
    // 全部分区落在边界 bbox 内
    for (const zone of proposal.zones) {
      for (const point of zone.polygon) {
        expect(point.x).toBeGreaterThanOrEqual(-300);
        expect(point.x).toBeLessThanOrEqual(300);
        expect(point.y).toBeGreaterThanOrEqual(-200);
        expect(point.y).toBeLessThanOrEqual(200);
      }
    }
  });

  it('物料选型：舞台/签到台×2/医疗帐篷/厕所×2/垃圾点×2，都挂 zoneId 且在对应分区里', () => {
    const proposal = buildZoneEventProposal(
      { boundary: BOUNDARY, nodes: [ENTRANCE_S], brief: { event: '潮乐之夜', guests: 120 } },
      ids,
    )!;
    const bySemantic = new Map(proposal.zones.map(zone => [zone.semantic, zone]));
    const stageZone = bySemantic.get('stage')!;
    const medicalZone = bySemantic.get('medical')!;
    const names = proposal.facilities.map(facility => facility.name);
    expect(names.some(name => name.includes('舞台'))).toBe(true);
    expect(names.filter(name => name.includes('签到台')).length).toBe(2);
    expect(names.some(name => name.includes('医疗帐篷'))).toBe(true);
    expect(names.filter(name => name.includes('移动厕所')).length).toBe(2);
    expect(names.filter(name => name.includes('垃圾收集点')).length).toBe(2);
    // 舞台在舞台区中心附近、医疗在医疗区中心附近
    const stageFacility = proposal.facilities.find(facility => facility.templateId === 'stage-platform-8x6')!;
    expect(stageFacility.zoneId).toBe(stageZone.id);
    const stageCenter = {
      x: (stageZone.polygon[0]!.x + stageZone.polygon[1]!.x) / 2,
      y: (stageZone.polygon[0]!.y + stageZone.polygon[2]!.y) / 2,
    };
    expect(Math.hypot(stageFacility.position.x - stageCenter.x, stageFacility.position.y - stageCenter.y)).toBeLessThan(5);
    const medicalFacility = proposal.facilities.find(facility => facility.templateId === 'medical-tent-4x3')!;
    expect(medicalFacility.zoneId).toBe(medicalZone.id);
    // 全部设施落在边界内
    for (const facility of proposal.facilities) {
      expect(Math.abs(facility.position.x)).toBeLessThan(300);
      expect(Math.abs(facility.position.y)).toBeLessThan(200);
    }
  });

  it('无入口节点默认南口；小场地（40×30 以下）回 null', () => {
    const noNodes = buildZoneEventProposal({ boundary: BOUNDARY, nodes: [], brief: { event: null, guests: null } }, ids)!;
    expect(noNodes.zones.length).toBeGreaterThan(0);
    expect(buildZoneEventProposal({
      boundary: [{ x: -10, y: -8 }, { x: 10, y: -8 }, { x: 10, y: 8 }, { x: -10, y: 8 }],
      nodes: [],
      brief: { event: null, guests: null },
    }, ids)).toBeNull();
  });

  it('窄场（宽 <120m）不配两侧医疗/VIP，只出居中舞台；id 全唯一', () => {
    const NARROW = [{ x: -50, y: -200 }, { x: 50, y: -200 }, { x: 50, y: 200 }, { x: -50, y: 200 }];
    const proposal = buildZoneEventProposal({ boundary: NARROW, nodes: [ENTRANCE_S], brief: { event: null, guests: null } }, ids)!;
    expect(proposal.zones.some(zone => zone.semantic === 'medical')).toBe(false);
    expect(proposal.zones.some(zone => zone.semantic === 'stage')).toBe(true);
    const allIds = [...proposal.zones.map(zone => zone.id), ...proposal.facilities.map(facility => facility.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
