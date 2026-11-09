import { describe, expect, it } from 'vitest';
import { generateSuggestions, defaultZoneRect } from './suggestions';

describe('generateSuggestions', () => {
  it('不因为长者、商务或亲子标签推断轮椅、签到或圆桌需求', () => {
    for (const audience of ['中老年人', '企业客户', '亲子活动']) {
      expect(generateSuggestions({ audience, zoneTypes: [] })).toEqual([]);
    }
  });
  it('只对已画区域给核对提示，不宣称固定宽度合规', () => {
    const list = generateSuggestions({ audience: '中老年人', zoneTypes: ['checkin', 'rest', 'roundtable'], roomShortSideM: 6 });
    expect(list).toHaveLength(3);
    expect(list.map(item => item.title).join(' ')).toContain('签到');
    expect(JSON.stringify(list)).not.toMatch(/轮椅|1\.5m|1\.2m|达标|通过/);
  });
});

describe('defaultZoneRect（一键落区默认位）', () => {
  it('checkin 在场地前侧（z>0）', () => {
    const r = defaultZoneRect('checkin', { width: 12, height: 8 });
    expect(r.z).toBeGreaterThan(0);
  });
  it('rest 在场地深处（z<0）', () => {
    const r = defaultZoneRect('rest', { width: 12, height: 8 });
    expect(r.z).toBeLessThan(0);
  });
  it('roundtable 在场地正中', () => {
    const r = defaultZoneRect('roundtable', { width: 12, height: 8 });
    expect(r.x).toBe(0);
    expect(r.z).toBe(0);
  });
});
