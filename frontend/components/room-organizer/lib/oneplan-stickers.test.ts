import { describe, expect, it } from 'vitest';
import {
  drawOneplanScaleSticker,
  drawOneplanSticker,
  facilitySticker,
  nodeSticker,
  oneplanScaleSrcs,
  oneplanStickerSrc,
  planStickerDescriptors,
  preloadOneplanStickers,
  routeSticker,
  subscribeOneplanStickerLoads,
  workerSticker,
  zoneSticker,
  FACILITY_STICKERS,
  NODE_STICKERS,
  ROUTE_STICKERS,
  WORKER_ROLE_STICKERS,
  ZONE_STICKERS,
  type OneplanStickerDescriptor,
} from './oneplan-stickers';
import { buildPlanLegend } from './site-plan-legend';
import { PLANNING_ICONS } from '@/lib/outdoor-plan-tokens';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 演示页「平湖秋月市集」同构的迷你样例（1 分区 / 2 摊位 + 1 自定义闸机 / 1 动线 / 1 节点 / 1 人员）。 */
function samplePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }],
    zones: [{
      id: 'a1000000-0000-4000-8000-000000000001',
      semantic: 'audience',
      name: '观众区',
      polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
      notes: '',
    }],
    facilities: [
      {
        id: 'b2000000-0000-4000-8000-000000000001',
        templateId: 'booth-2x2',
        name: '市集摊位 A',
        position: { x: 60, y: 80 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        notes: '',
      },
      {
        id: 'b2000000-0000-4000-8000-000000000002',
        templateId: 'booth-2x2',
        name: '市集摊位 B',
        position: { x: 68, y: 80 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        notes: '',
      },
      {
        id: 'b2000000-0000-4000-8000-000000000003',
        templateId: 'custom-gate-4x1',
        name: '临时闸机',
        position: { x: 0, y: 60 },
        rotationDeg: 0,
        size: { width: 4, depth: 1 },
        notes: '',
      },
    ],
    routes: [{
      id: 'c3000000-0000-4000-8000-000000000001',
      kind: 'pedestrian',
      name: '入场动线',
      points: [{ x: 0, y: 60 }, { x: 60, y: 60 }],
      oneWay: true,
      notes: '',
    }],
    nodes: [{
      id: 'd4000000-0000-4000-8000-000000000001',
      kind: 'entry',
      name: '西门',
      position: { x: 0, y: 60 },
      notes: '',
    }],
    workers: [{
      id: 'e5000000-0000-4000-8000-000000000001',
      role: '安保',
      count: 2,
      position: { x: 20, y: 70 },
      notes: '',
    }],
  };
}

const allStickers = (): OneplanStickerDescriptor[] => [
  ...Object.values(ZONE_STICKERS),
  ...Object.values(FACILITY_STICKERS),
  ...Object.values(NODE_STICKERS),
  ...Object.values(ROUTE_STICKERS),
  ...Object.values(WORKER_ROLE_STICKERS),
];

describe('OnePlan 贴纸映射', () => {
  it('每条映射都有合法 kind/slug，落点路径在 /oneplan-icons 下且以 .svg 结尾', () => {
    for (const sticker of allStickers()) {
      expect(['icon', 'area', 'scale']).toContain(sticker.kind);
      expect(sticker.slug.length).toBeGreaterThan(0);
      expect(oneplanStickerSrc(sticker)).toMatch(/^\/oneplan-icons\/(icon|area|scale-fg)\/.+\.svg$/);
    }
  });

  it('回落的 Lucide 图标名都在 PLANNING_ICONS 登记表内（不会回落到 undefined 图标）', () => {
    for (const sticker of allStickers()) {
      expect(PLANNING_ICONS as readonly string[]).toContain(sticker.icon);
    }
  });

  it('9 类分区语义全部命中贴纸，观众/停车/预留走面域底形', () => {
    for (const semantic of ['stage', 'audience', 'parking', 'loading', 'checkin', 'queue', 'medical', 'vip', 'reserved'] as const) {
      expect(zoneSticker(semantic)).not.toBeNull();
    }
    expect(zoneSticker('audience')).toMatchObject({ kind: 'area', slug: 'crowd' });
    expect(zoneSticker('parking')).toMatchObject({ kind: 'area', slug: 'parking' });
    expect(zoneSticker('reserved')).toMatchObject({ kind: 'area', slug: 'generic' });
    expect(zoneSticker('stage')).toMatchObject({ kind: 'icon', slug: 'stage' });
  });

  it('8 个内置设施模板命中贴纸：摊位/帐篷/餐车/舞台/厕所走 scale，医疗/安保/垃圾走点位符号', () => {
    expect(facilitySticker('booth-2x2')).toMatchObject({ kind: 'scale', slug: 'market-stall' });
    expect(facilitySticker('tent-3x3')).toMatchObject({ kind: 'scale', slug: 'tent' });
    expect(facilitySticker('food-truck-6x2.5')).toMatchObject({ kind: 'scale', slug: 'food-trailer' });
    expect(facilitySticker('stage-platform-8x6')).toMatchObject({ kind: 'scale', slug: 'stage' });
    expect(facilitySticker('toilet-2.4x1.2')).toMatchObject({ kind: 'scale', slug: 'portable-toilet' });
    expect(facilitySticker('medical-tent-4x3')).toMatchObject({ kind: 'icon', slug: 'first-aid-point' });
    expect(facilitySticker('security-post-1.5x1.5')).toMatchObject({ kind: 'icon', slug: 'security-checkpoint' });
    expect(facilitySticker('trash-point-1.2x1.2')).toMatchObject({ kind: 'icon', slug: 'waste-and-recycling-point' });
  });

  it('自定义 templateId 走关键词回落，完全不认识才返回 null（交给 Lucide 回落）', () => {
    expect(facilitySticker('custom-gate-4x1')).toMatchObject({ kind: 'icon', slug: 'entry-gate' });
    expect(facilitySticker('marquee-stage-10x8')).toMatchObject({ kind: 'scale', slug: 'stage' });
    expect(facilitySticker('mobile-toilet-xl')).toMatchObject({ kind: 'scale', slug: 'portable-toilet' });
    expect(facilitySticker('mystery-object')).toBeNull();
    expect(facilitySticker('   ')).toBeNull();
  });

  it('出入口三型与三类动线全部命中贴纸', () => {
    expect(nodeSticker('entry')).toMatchObject({ kind: 'icon', slug: 'entry-gate' });
    expect(nodeSticker('exit')).toMatchObject({ kind: 'icon', slug: 'exit-gate' });
    expect(nodeSticker('both')).toMatchObject({ kind: 'icon', slug: 'turnstile' });
    expect(routeSticker('pedestrian')).toMatchObject({ slug: 'pedestrian-access' });
    expect(routeSticker('vehicle')).toMatchObject({ slug: 'vehicle-access' });
    expect(routeSticker('service')).toMatchObject({ slug: 'load-zone' });
  });

  it('样例人员岗位命中：安保→警察、引导员→问询处；未知岗位返回 null', () => {
    expect(workerSticker('安保')).toMatchObject({ kind: 'icon', slug: 'police' });
    expect(workerSticker('引导员')).toMatchObject({ kind: 'icon', slug: 'information-point' });
    expect(workerSticker('医疗组')).toMatchObject({ slug: 'first-aid-point' });
    expect(workerSticker('安保队长')).toMatchObject({ slug: 'security-checkpoint' });
    expect(workerSticker('完全未登记的岗位')).toBeNull();
    expect(workerSticker('')).toBeNull();
  });

  it('planStickerDescriptors 按 kind+slug 去重（两个摊位只预加载一张贴纸）', () => {
    const stickers = planStickerDescriptors(samplePlan());
    const keys = stickers.map(s => `${s.kind}:${s.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('area:crowd');
    expect(keys).toContain('scale:market-stall');
    expect(keys).toContain('icon:entry-gate'); // 动线徽标与自定义闸机共用入口闸门
    expect(keys).toContain('icon:pedestrian-access');
    expect(keys).toContain('icon:police');
    expect(keys.filter(key => key === 'scale:market-stall')).toHaveLength(1);
  });

  it('scale 贴纸前后景路径成对且都在 scale-fg / scale-bg 下', () => {
    expect(oneplanScaleSrcs('tent')).toEqual({
      fg: '/oneplan-icons/scale-fg/tent.svg',
      bg: '/oneplan-icons/scale-bg/tent.svg',
    });
    expect(oneplanStickerSrc({ kind: 'scale', slug: 'tent', icon: 'tent' })).toBe('/oneplan-icons/scale-fg/tent.svg');
    expect(oneplanStickerSrc({ kind: 'icon', slug: 'stage', icon: 'shapes' })).toBe('/oneplan-icons/icon/stage.svg');
  });
});

describe('图例接入 OnePlan 贴纸', () => {
  it('分区/设施/动线/出入口/人员条目带上贴纸，边界与测量仍走 Lucide', () => {
    const groups = buildPlanLegend(samplePlan());
    const group = (title: string) => groups.find(g => g.title === title)!;
    expect(group('功能分区').entries[0]).toMatchObject({ sticker: { kind: 'area', slug: 'crowd' } });
    expect(group('设施').entries[0]).toMatchObject({ sticker: { kind: 'scale', slug: 'market-stall' } });
    expect(group('动线').entries[0]).toMatchObject({ sticker: { kind: 'icon', slug: 'pedestrian-access' } });
    expect(group('出入口').entries[0]).toMatchObject({ sticker: { kind: 'icon', slug: 'entry-gate' } });
    expect(group('人员').entries[0]).toMatchObject({ sticker: { kind: 'icon', slug: 'police' } });
    expect(group('场地边界').entries[0]!.sticker).toBeUndefined();
    expect(group('测量') ?? null).toBeNull(); // 样例无测量
    // 既有 icon 字段保持不变（PNG/PDF 图例与既有测试契约继续成立）。
    expect(group('设施').entries[0]!.icon).toBe('tent');
    expect(group('人员').entries[0]!.icon).toBe('users');
  });
});

describe('Canvas 绘制桥（Node 环境无 Image 时安全降级）', () => {
  const fakeCtx = {} as unknown as CanvasRenderingContext2D;

  it('图片未就绪时返回 false 且不抛错（draw 循环可继续）', () => {
    expect(drawOneplanSticker(fakeCtx, 'tent', 10, 10, 16)).toBe(false);
    expect(drawOneplanSticker(fakeCtx, { kind: 'icon', slug: 'stage', icon: 'shapes' }, 10, 10, 16)).toBe(false);
    expect(drawOneplanScaleSticker(fakeCtx, 'market-stall', 10, 10, 24, 24, 15)).toBe(false);
  });

  it('preload 在无 DOM 环境安全跳过（不抛错）', () => {
    expect(() => preloadOneplanStickers([null, undefined, ...planStickerDescriptors(samplePlan())])).not.toThrow();
  });

  it('加载订阅可注册/注销', () => {
    let hits = 0;
    const unsubscribe = subscribeOneplanStickerLoads(() => { hits += 1; });
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(hits).toBe(0);
  });
});