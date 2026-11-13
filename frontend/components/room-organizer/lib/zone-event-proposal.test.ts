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

describe('buildZoneEventProposal（活动逻辑安全默认）', () => {
  const entrance = { ...ENTRANCE_S, position: { x: 0, y: -200 } };
  it('45人讲座真实人数落位并挂区域事件，只有确认方可写入', () => {
    const proposal = buildZoneEventProposal({ boundary: BOUNDARY, nodes: [entrance], brief: { event: '讲座', guests: 45 } }, ids)!;
    expect(proposal).not.toBeNull();
    expect(proposal.facilities.filter(f => f.templateId.includes('chair'))).toHaveLength(45);
    expect(proposal.zones.every(z => z.event?.startsWith('讲座·'))).toBe(true);
    expect(proposal.routes?.some(r => r.name.includes('签到接驳'))).toBe(true);
  });
  it('不支持活动、缺人数、缺真实入口不回退到固定矩形模板', () => {
    expect(buildZoneEventProposal({ boundary: BOUNDARY, nodes: [entrance], brief: { event: '音乐节', guests: 120 } }, ids)).toBeNull();
    expect(buildZoneEventProposal({ boundary: BOUNDARY, nodes: [entrance], brief: { event: '讲座', guests: null } }, ids)).toBeNull();
    expect(buildZoneEventProposal({ boundary: BOUNDARY, nodes: [], brief: { event: '讲座', guests: 45 } }, ids)).toBeNull();
    expect(buildZoneEventProposal({ boundary: BOUNDARY, nodes: [ENTRANCE_S], brief: { event: '讲座', guests: 45 } }, ids)).toBeNull();
  });
});
