import { describe, expect, it } from 'vitest';
import { createStarterOutdoorPlan } from './outdoor-project-store';
import { isLegacyIndoorDraft, prepareOutdoorSaveAs } from './legacy-indoor-draft';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';

describe('旧纯室内草稿判定（S3-4）', () => {
  it('已绑户外 plan → 不是旧室内，按户外项目编辑', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [makeItem()] })] });
    expect(isLegacyIndoorDraft(layout, createStarterOutdoorPlan())).toBe(false);
  });

  it('无 plan 且壳体为空 → 空起步草稿，放行编辑', () => {
    expect(isLegacyIndoorDraft(makeLayout(), null)).toBe(false);
  });

  it('无 plan 且有壳体物件 → 旧纯室内，只读', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [makeItem()] })] });
    expect(isLegacyIndoorDraft(layout, null)).toBe(true);
  });

  it('无 plan 且有室内分区 → 旧纯室内，只读', () => {
    const layout = makeLayout({ floors: [makeFloor({ zones: [{ id: 'z1', name: '区', color: '#333', x: 0, z: 0, w: 2, d: 2 }] })] });
    expect(isLegacyIndoorDraft(layout, null)).toBe(true);
  });

  it('无 plan 且有室内隔墙 → 旧纯室内，只读', () => {
    const layout = makeLayout({ floors: [makeFloor({ interiorWalls: [{ id: 'w1', x1: 0, z1: 0, x2: 2, z2: 0, color: '#333' }] })] });
    expect(isLegacyIndoorDraft(layout, null)).toBe(true);
  });
});

describe('另存为户外新场地迁移（S3-4）', () => {
  it('生成 house-* 新编号，方案名带后缀，plan 为起步空场', () => {
    const layout = makeLayout({ name: '婚礼场地', floors: [makeFloor({ items: [makeItem()] })] });
    const { record } = prepareOutdoorSaveAs(layout);
    expect(record.projectId.startsWith('house-')).toBe(true);
    expect(record.name).toBe('婚礼场地（户外新场地）');
    expect(record.plan?.zones).toEqual([]);
    expect(record.plan?.facilities).toEqual([]);
    expect(record.plan?.boundary).toEqual([]);
    expect(record.plan?.anchor).toBeDefined();
  });

  it('不迁旧壳体物件 / 分区 / 隔墙：新 plan 的实体集合为空', () => {
    const layout = makeLayout({
      floors: [makeFloor({ items: [makeItem()], zones: [{ id: 'z1', name: '区', color: '#333', x: 0, z: 0, w: 2, d: 2 }], interiorWalls: [{ id: 'w1', x1: 0, z1: 0, x2: 2, z2: 0, color: '#333' }] })],
    });
    const { record } = prepareOutdoorSaveAs(layout);
    expect(record.plan?.facilities).toEqual([]);
    expect(record.plan?.zones).toEqual([]);
    expect(record.plan?.routes).toEqual([]);
  });

  it('旧方案无名时落默认名', () => {
    const { record } = prepareOutdoorSaveAs(makeLayout({ name: '' }));
    expect(record.name).toBe('未命名活动（户外新场地）');
  });
});
