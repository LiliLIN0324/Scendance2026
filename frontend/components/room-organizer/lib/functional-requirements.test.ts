import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { checkFunctionalRequirements } from './functional-requirements';

describe('explicit functional needs', () => {
  it('does not mistake an ordinary table or a backdrop for check-in or a stage', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'table', type: 'table', name: '普通桌子' }),
      makeItem({ id: 'backdrop', type: 'backdrop', materialId: 'backdrop', category: 'stage', name: '舞台背景板' }),
    ] })] });
    const checks = checkFunctionalRequirements(layout, 0, { checkin: true, stage: true });
    expect(checks.map(check => check.status)).toEqual(['unknown', 'unknown']);
    expect(checks[0]!.objectIds).toEqual([]);
    expect(checks[1]!.objectIds).toEqual([]);
    expect(checks[1]!.message).toContain('背景板');
  });

  it('recognizes explicit reception and stage semantics without asserting safety', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'desk', type: 'counter', materialId: 'reception', name: '接待台' }),
      makeItem({ id: 'stage', type: 'stage', name: '舞台' }),
    ] })] });
    const checks = checkFunctionalRequirements(layout, 0, { checkin: true, stage: true });
    expect(checks.map(check => check.status)).toEqual(['pass', 'pass']);
    expect(checks[0]!.objectIds).toEqual(['desk']);
    expect(checks[1]!.objectIds).toEqual(['stage']);
    expect(checks.every(check => check.message.includes('仍需核验'))).toBe(true);
  });

  it('reports conflicting unwanted features without deleting even locked items', () => {
    const desk = makeItem({ id: 'desk', type: 'counter', materialId: 'reception', name: '签到台', locked: true });
    const layout = makeLayout({ floors: [makeFloor({ items: [desk], zones: [
      { id: 'stage-zone', name: '舞台区', color: '#4A7C59', x: 0, z: 0, w: 2, d: 2 },
    ] })] });
    const before = structuredClone(layout);
    const checks = checkFunctionalRequirements(layout, 0, { checkin: false, stage: false });
    expect(checks.map(check => check.status)).toEqual(['unknown', 'unknown']);
    expect(checks[0]!.message).toContain('不会自动删除');
    expect(checks[1]!.zoneIds).toEqual(['stage-zone']);
    expect(layout).toEqual(before);
  });

  it('treats an empty stage zone as insufficient, and ignores invalid or negated labels', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [], zones: [
      { id: 'stage-zone', name: '主舞台区域', color: '#4A7C59', x: 0, z: 0, w: 2, d: 2 },
      { id: 'outside', name: '签到区', color: '#4A7C59', x: 40, z: 0, w: 2, d: 2 },
      { id: 'no-checkin', name: '不需要签到区', color: '#4A7C59', x: 0, z: 0, w: 2, d: 2 },
    ] })] });
    const checks = checkFunctionalRequirements(layout, 0, { checkin: true, stage: true });
    expect(checks.map(check => check.status)).toEqual(['unknown', 'unknown']);
    expect(checks[0]!.zoneIds).toEqual(['outside']);
    expect(checks[1]!.zoneIds).toEqual(['stage-zone']);
    const negative = checkFunctionalRequirements(layout, 0, { checkin: false, stage: null });
    expect(negative[0]!.status).toBe('unknown');
  });

  it('does not certify a rectangular marker against an unchecked polygonal venue', () => {
    const layout = makeLayout({ width: 10, height: 8, backendVenue: { width: 10, depth: 8, height: 3, shape: 'polygon',
      polygon: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 3 }, { x: 3, z: 3 }, { x: 3, z: 8 }, { x: 0, z: 8 }], entrances: [] },
    floors: [makeFloor({ items: [], zones: [{ id: 'checkin', name: '签到区', color: '#4A7C59', x: 0, z: 0, w: 2, d: 2 }] })] });
    const [check] = checkFunctionalRequirements(layout, 0, { checkin: true, stage: null });
    expect(check!.status).toBe('unknown');
    expect(check!.zoneIds).toEqual(['checkin']);
  });

  it('distinguishes an unspecified requirement, a missing floor and a bounded negative check', () => {
    const layout = makeLayout();
    expect(checkFunctionalRequirements(layout, 0, { checkin: null, stage: null }).map(check => check.status)).toEqual(['unknown', 'unknown']);
    expect(checkFunctionalRequirements(layout, 4, { checkin: false, stage: true }).map(check => check.status)).toEqual(['unknown', 'unknown']);
    const [check] = checkFunctionalRequirements(layout, 0, { checkin: false, stage: null });
    expect(check!.status).toBe('pass');
    expect(check!.message).toContain('未标注物件的用途仍需核对');
  });
  it.each(['签到柜台', '签到服务台', '来宾报到处', '接待工作桌'])('does not silently pass an unwanted explicitly named object: %s', name => {
    const {position: _position, ...item} = makeItem({id:'ambiguous',type:'table',name});
    const layout = makeLayout({floors:[makeFloor({items:[item]})]});
    const [check] = checkFunctionalRequirements(layout,0,{checkin:false,stage:null});
    expect(check!.status).toBe('unknown');expect(check!.objectIds).toContain('ambiguous');
    expect(check!.message).toContain('不会自动删除');
  });

});
