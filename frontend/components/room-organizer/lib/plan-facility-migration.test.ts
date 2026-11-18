import { describe, expect, it, vi } from 'vitest';
import type { FurnitureItem } from './types';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { migrateFacilities } from './plan-facility-migration';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from './__testfixtures__/fixtures';

/** 10×8 m 平面边界；壳体 20×16，两轴缩放 2。 */
const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

const SHELL = { width: 20, height: 16 };

function sequentialIds(): () => string {
  let n = 0;
  return () => `u-${++n}`;
}

describe('plan-facility-migration（室内物件 → plan 设施）', () => {
  it('builtin 直连内置模板：厕位模板尺寸与坐标逆变换、角度取反换算', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({
          id: 't1', type: 'toilet', name: '洗手间', position: { x: 2, z: 4 },
          rotation: Math.PI / 2, color: '#3d8fa8',
        })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(1);
    const facility = result.facilities[0]!;
    expect(facility.templateId).toBe('toilet-2.4x1.2');
    expect(facility.position).toEqual({ x: 1, y: 6 });
    expect(facility.size).toEqual({ width: 2.4, depth: 1.2 });
    expect(facility.rotationDeg).toBeCloseTo(-90, 5);
    expect(facility.name).toBe('洗手间');
    expect(facility.color).toBe('#3d8fa8');
  });

  it('oneplan 对齐条目保留 slug，纯函数层走兜底 2×2 尺寸', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'c1', type: 'chair', name: '折叠椅', position: { x: 2, z: 2 } })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities[0]!.templateId).toBe('oneplan:scale:chair');
    expect(result.facilities[0]!.size).toEqual({ width: 2, depth: 2 });
  });

  it('纯室内家居回落 misc 占位，兜底尺寸 2×2', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'b1', type: 'bed', name: '双人床', position: { x: 2, z: 2 } })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities[0]!.templateId).toBe('misc');
    expect(result.facilities[0]!.size).toEqual({ width: 2, depth: 2 });
  });

  it('墙体/隔断/门窗/人员进 skipped，不建 facility', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'p1', type: 'partition', position: { x: 2, z: 2 } }),
          makeItem({ id: 'f1', type: 'fence', position: { x: 2, z: 2 } }),
          makeItem({ id: 'd1', type: 'door', position: { x: 2, z: 2 } }),
          makeItem({ id: 'w1', type: 'window', position: { x: 2, z: 2 } }),
          makeItem({ id: 'person1', type: 'person', name: '引导员', position: { x: 2, z: 2 } }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(0);
    expect(result.skipped.map(s => s.sourceId)).toEqual(['p1', 'f1', 'd1', 'w1', 'person1']);
    expect(result.skipped.every(s => s.reason.length > 0)).toBe(true);
  });

  it('缺落点物料进 skipped，不留半成品', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({ items: [makeUnplacedItem({ id: 'x1', type: 'chair', name: '未落位' })] })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(0);
    expect(result.skipped).toEqual([{ sourceId: 'x1', reason: '物料缺少落点' }]);
  });

  it('多楼层物料平铺合并到同一批设施', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [
        makeFloor({ id: 'f1', items: [makeItem({ id: 'a1', type: 'table', position: { x: 2, z: 2 } })] }),
        makeFloor({ id: 'f2', items: [makeItem({ id: 'a2', type: 'fridge', position: { x: 6, z: 6 } })] }),
      ],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(2);
  });

  it('落点命中分区带 zoneId，区外物件归属留空（口径与 worker/node 一致）', () => {
    const zones = [
      { id: 'a1000000-0000-4000-8000-000000000001', name: '一区', polygon: [{ x: 0, y: 8 }, { x: 5, y: 8 }, { x: 5, y: 4 }, { x: 0, y: 4 }] },
    ];
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          // {x:2,z:2} → 平面 (1,7)，落在一区矩形内
          makeItem({ id: 't1', type: 'toilet', name: '洗手间', position: { x: 2, z: 2 } }),
          // {x:16,z:14} → 平面 (8,1)，在一区矩形外
          makeItem({ id: 'b1', type: 'bed', name: '床', position: { x: 16, z: 14 } }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds(), zones);

    expect(result.facilities).toHaveLength(2);
    const [inside, outside] = result.facilities;
    expect(inside!.zoneId).toBe(zones[0].id);
    expect(outside!.zoneId).toBeUndefined();
  });

  it('物料备注保真透传，超长按契约 500 截断', () => {
    const longNotes = '备'.repeat(520);
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'c1', type: 'chair', name: '折叠椅', position: { x: 2, z: 2 }, notes: '预留电源，实物待确认' }),
          makeItem({ id: 'b1', type: 'bed', name: '床', position: { x: 6, z: 6 }, notes: longNotes }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities[0]!.notes).toBe('预留电源，实物待确认');
    expect(result.facilities[1]!.notes).toHaveLength(500);
    expect(result.facilities[1]!.notes).toBe('备'.repeat(500));
  });

  it('空名或纯空白名回落通用占位名', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'n1', type: 'chair', name: '', position: { x: 2, z: 2 } }),
          makeItem({ id: 'n2', type: 'bed', name: '   ', position: { x: 6, z: 6 } }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(2);
    expect(result.facilities.every(f => f.name === '通用物件')).toBe(true);
  });

  it('非法十六进制色丢弃，不把脏颜色带进 plan', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'c1', type: 'chair', color: 'red', position: { x: 2, z: 2 } }),
          makeItem({ id: 'c2', type: 'bed', color: '#fff', position: { x: 6, z: 6 } }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities.every(f => f.color === undefined)).toBe(true);
  });

  it('非有限旋转角回落 0，不把 NaN/Infinity 传进工厂', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'r1', type: 'chair', rotation: NaN, position: { x: 2, z: 2 } })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(1);
    expect(Number.isFinite(result.facilities[0]!.rotationDeg)).toBe(true);
    expect(result.facilities[0]!.rotationDeg).toBe(0);
  });

  it('物件名超 60 字符按契约截断', () => {
    const longName = '甲'.repeat(70);
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({ items: [makeItem({ id: 'l1', type: 'chair', name: longName, position: { x: 2, z: 2 } })] })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities[0]!.name).toHaveLength(60);
    expect(result.facilities[0]!.name).toBe('甲'.repeat(60));
  });

  it('libraryEntry 注入点校准 oneplan 尺寸，builtin 不采信', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'c1', type: 'chair', name: '折叠椅', position: { x: 2, z: 2 } }),
          makeItem({ id: 't1', type: 'toilet', name: '洗手间', position: { x: 6, z: 6 } }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds(), [], {
      libraryEntry: (templateId) => (templateId === 'oneplan:scale:chair' ? { width: 0.6, depth: 0.6 } : undefined),
    });

    expect(result.facilities[0]!.size).toEqual({ width: 0.6, depth: 0.6 });
    expect(result.facilities[1]!.size).toEqual({ width: 2.4, depth: 1.2 });
  });

  it('库条目尺寸非法（0 / NaN / 超 100 m）保留 2×2 兜底，不把脏尺寸带进 plan', () => {
    const sizes = [
      { width: 0, depth: 1 },
      { width: Number.NaN, depth: 1 },
      { width: 101, depth: 2 },
    ];
    for (const size of sizes) {
      const layout = makeLayout({
        ...SHELL,
        floors: [makeFloor({ items: [makeItem({ id: 'c1', type: 'chair', position: { x: 2, z: 2 } })] })],
      });

      const result = migrateFacilities(layout, BOUNDARY, sequentialIds(), [], { libraryEntry: () => size });

      expect(result.facilities[0]!.size).toEqual({ width: 2, depth: 2 });
    }
  });

  it('glb 物件经注入 resolver 挂 modelOverride，普通物件不询问也不落键', () => {
    const resolver = vi.fn((item: FurnitureItem) => (item.type === 'glb-asset' ? 'lib:sofa-01' : undefined));
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'g1', type: 'glb-asset', name: '雕塑', assetId: 'asset-123', position: { x: 2, z: 2 } }),
          makeItem({ id: 'c1', type: 'chair', name: '折叠椅', position: { x: 6, z: 6 } }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds(), [], { modelSlug: resolver });

    expect(result.facilities[0]!.modelOverride).toBe('lib:sofa-01');
    expect('modelOverride' in result.facilities[1]!).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('resolver 返回空串 / 超 160 字符时不落 modelOverride', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'g1', type: 'glb-asset', assetId: 'asset-123', position: { x: 2, z: 2 } }),
          makeItem({ id: 'g2', type: 'glb-asset', assetId: 'asset-456', position: { x: 6, z: 6 } }),
        ],
      })],
    });

    const slugs = ['   ', 'x'.repeat(161)];
    const result = migrateFacilities(layout, BOUNDARY, sequentialIds(), [], {
      modelSlug: (item) => (item.id === 'g1' ? slugs[0] : slugs[1]),
    });

    expect('modelOverride' in result.facilities[0]!).toBe(false);
    expect('modelOverride' in result.facilities[1]!).toBe(false);
  });

  it('assetId 直通 sourceAssetId；空白与超长值不落字段', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'g1', type: 'glb-asset', assetId: 'asset-123', position: { x: 2, z: 2 } }),
          makeItem({ id: 'g2', type: 'glb-asset', assetId: 'x'.repeat(161), position: { x: 6, z: 6 } }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities[0]!.sourceAssetId).toBe('asset-123');
    expect('sourceAssetId' in result.facilities[1]!).toBe(false);
  });

  it('空布局（无楼层）退成空设施清单，不抛错', () => {
    const layout = makeLayout({ ...SHELL, floors: [] });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });


  it('C1：resolver 返回 UUID 时不落 modelOverride', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'g1', type: 'glb-asset', assetId: 'asset-123', position: { x: 2, z: 2 } })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds(), [], {
      modelSlug: () => '50000000-0000-4000-8000-000000000001',
    });

    expect('modelOverride' in result.facilities[0]!).toBe(false);
  });

  it('C1：slug 只进 modelOverride，不改写 sourceAssetId', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'g1', type: 'glb-asset', assetId: 'asset-123', position: { x: 2, z: 2 } })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds(), [], {
      modelSlug: () => 'lib:sofa-01',
    });

    expect(result.facilities[0]!.sourceAssetId).toBe('asset-123');
    expect(result.facilities[0]!.modelOverride).toBe('lib:sofa-01');
  });

  it('C3：室内特化字段不迁 plan，按条目如实标 lossy', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({
          id: 'c3',
          type: 'chair',
          elevation: 2.4,
          price: 1200,
          isCCTV: true,
          position: { x: 2, z: 2 },
        })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.lossy).toEqual([{ sourceId: 'c3', fields: ['elevation', 'price', 'isCCTV'] }]);
    expect('elevation' in result.facilities[0]!).toBe(false);
    expect('price' in result.facilities[0]!).toBe(false);
    expect('isCCTV' in result.facilities[0]!).toBe(false);
  });

  it('C3：普通物件不产生 lossy 行，false 不算损失', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'p1', type: 'chair', isCCTV: false, position: { x: 2, z: 2 } })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.lossy).toEqual([]);
  });
});
