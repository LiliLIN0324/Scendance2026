import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  drawOneplanScaleSticker,
  drawOneplanSticker,
  facilitySticker,
  nodeSticker,
  nodeStickerColor,
  oneplanScaleSrcs,
  stickerNeedsQuarterTurn,
  oneplanStickerSrc,
  planStickerDescriptors,
  preloadOneplanStickers,
  routeSticker,
  subscribeOneplanStickerLoads,
  workerSticker,
  workerRoleColor,
  WORKER_ROLE_FAMILIES,
  WORKER_ROLE_NEUTRAL_COLOR,
  zoneSticker,
  FACILITY_STICKERS,
  NODE_STICKERS,
  ROUTE_STICKERS,
  WORKER_ROLE_STICKERS,
  ZONE_STICKERS,
  type OneplanStickerDescriptor,
} from './oneplan-stickers';
import { buildPlanLegend } from './site-plan-legend';
import { LABOR_ROLES } from './oneplan-catalog';
import { PLANNING_LAYER_COLORS, PLANNING_NODE_KIND_COLORS } from '@/lib/outdoor-plan-tokens';
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

  it('出入口三型的芯片色两两不同（绿进 / 红出 / 青双向），字形也不同', () => {
    expect(nodeStickerColor('entry')).toBe(PLANNING_NODE_KIND_COLORS.entry);
    expect(nodeStickerColor('exit')).toBe(PLANNING_NODE_KIND_COLORS.exit);
    expect(nodeStickerColor('both')).toBe(PLANNING_NODE_KIND_COLORS.both);
    expect(new Set([nodeStickerColor('entry'), nodeStickerColor('exit'), nodeStickerColor('both')]).size).toBe(3);
    expect(new Set([nodeSticker('entry')!.slug, nodeSticker('exit')!.slug, nodeSticker('both')!.slug]).size).toBe(3);
  });

  it('样例人员岗位命中：保安→岗亭、警察→警徽、引导员→问询处；未知岗位返回 null', () => {
    expect(workerSticker('安保')).toMatchObject({ kind: 'icon', slug: 'security-checkpoint' });
    expect(workerSticker('警察')).toMatchObject({ kind: 'icon', slug: 'police' });
    expect(workerSticker('引导员')).toMatchObject({ kind: 'icon', slug: 'information-point' });
    expect(workerSticker('医疗组')).toMatchObject({ slug: 'first-aid-point' });
    expect(workerSticker('安保队长')).toMatchObject({ slug: 'security-checkpoint' });
    expect(workerSticker('完全未登记的岗位')).toBeNull();
    expect(workerSticker('')).toBeNull();
  });

  it('九个内置岗位都写死主题色：色系定色相、同色系里每个身份占不同明度档', () => {
    // 九岗都有显式色，不再落哈希。
    expect(LABOR_ROLES.map(role => workerRoleColor(role)).filter(color => color === null)).toEqual([]);
    // 工作人员色系（蓝）：现场执行都在这套里……
    const staffRoles = ['保安', '志愿者', '管理员', '引导员', '检票', '技术', '摄像'];
    for (const role of staffRoles) {
      expect(WORKER_ROLE_FAMILIES.staff.shades, role).toContain(workerRoleColor(role));
    }
    // ……但身份之间不再同色（用户：「虽然是一个色系，每个身份的颜色有点不一样」）。
    const staffColors = staffRoles.map(role => workerRoleColor(role));
    expect(new Set(staffColors).size).toBe(staffRoles.length);
    // 应急三岗（消防/警察/医务）另成红系，内部也各占一档。
    const emergencyColors = ['消防', '警察', '医务人员'].map(role => workerRoleColor(role));
    expect(new Set(emergencyColors).size).toBe(3);
    for (const color of emergencyColors) expect(WORKER_ROLE_FAMILIES.emergency.shades).toContain(color);
    // 色系之间不串色。
    expect(workerRoleColor('保安')).not.toBe(workerRoleColor('警察'));
    // 负责人占工作人员色系最深的两档，不另开新色系。
    expect(workerRoleColor('经理')).toBe(WORKER_ROLE_FAMILIES.staff.shades[0]);
    expect(workerRoleColor('主管')).toBe(WORKER_ROLE_FAMILIES.staff.shades[1]);
    // 「自定义点」中性色，不冒充任何色系。
    expect(workerRoleColor('自定义点')).toBe(WORKER_ROLE_NEUTRAL_COLOR);
    // 同族别名与主岗位同色同档。
    expect(workerRoleColor('安保')).toBe(workerRoleColor('保安'));
    expect(workerRoleColor('安保队长')).toBe(workerRoleColor('保安'));
    // 自动输入的同族岗位也拿同一档（关键词回落表同样带 family/tone）。
    expect(workerRoleColor('医务岗')).toBe(workerRoleColor('医务人员'));
    expect(workerRoleColor('现场管理员')).toBe(workerRoleColor('管理员'));
    expect(workerRoleColor('警务岗')).toBe(workerRoleColor('保安'));
    // 表里没写的岗位返回 null，交给调色板回落。
    expect(workerRoleColor('完全未登记的岗位')).toBeNull();
    expect(workerRoleColor('')).toBeNull();
  });

  it('剩下六个岗位（引导/检票/保洁/技术/摄像/停车）也在色系里各有各的档', () => {
    for (const role of ['引导员', '检票', '保洁', '技术', '摄像', '停车']) {
      expect(workerRoleColor(role), role).not.toBeNull();
    }
    // 2026-11-16 用户：后勤走后勤色系，不跟工作人员同色。
    for (const role of ['引导员', '检票', '技术', '摄像']) {
      expect(WORKER_ROLE_FAMILIES.staff.shades, role).toContain(workerRoleColor(role));
    }
    for (const role of ['保洁', '环卫', '停车']) {
      expect(WORKER_ROLE_FAMILIES.logistics.shades, role).toContain(workerRoleColor(role));
    }
    // 后勤两岗也不同档。
    expect(workerRoleColor('保洁')).not.toBe(workerRoleColor('停车'));
    // 四套色系（工作人员/后勤/应急/游客）都有明度梯，主色相两两不同。
    const families = Object.values(WORKER_ROLE_FAMILIES);
    expect(families.every(family => family.shades.length >= 3)).toBe(true);
    const mids = families.map(family => family.shades[Math.floor(family.shades.length / 2)]!);
    expect(new Set(mids).size).toBe(families.length);
    expect(new Set(families.map(family => family.label)).size).toBe(4);
  });

  it('游客/参观者拿游客色系与行人图标（tourist），不与岗位设施图标撞', () => {
    expect(workerSticker('游客')).toMatchObject({ kind: 'icon', slug: 'tourist' });
    expect(workerRoleColor('游客')).toBe(WORKER_ROLE_FAMILIES.visitor.shades[1]);
    // 同族别名同色同图标。
    expect(workerRoleColor('参观者')).toBe(workerRoleColor('游客'));
    expect(workerSticker('参观者')?.slug).toBe('tourist');
    // 手打的「参观人群」走关键词回落，也拿游客色系。
    expect(workerRoleColor('参观人群')).toBe(workerRoleColor('游客'));
    // 游客图标不被任何岗位占用（岗位上就是同一张图上认人）。
    expect(LABOR_ROLES.map(role => workerSticker(role)?.slug)).not.toContain('tourist');
    // 游客色与其他三套色系不串。
    for (const family of ['staff', 'logistics', 'emergency'] as const) {
      expect(WORKER_ROLE_FAMILIES[family].shades).not.toContain(workerRoleColor('游客'));
    }
  });

  it('观众用自制 audience 图标 + 游客青系第 3 档，跟游客不同档不同图标', () => {
    // 官方库里没有观众图形（spectator-services 是透明通用点），这枚是自画的白字形。
    expect(workerSticker('观众')).toMatchObject({ kind: 'icon', slug: 'audience' });
    expect(workerRoleColor('观众')).toBe(WORKER_ROLE_FAMILIES.visitor.shades[2]);
    // 同色系但不同身份：颜色不同、图标也不同。
    expect(workerRoleColor('观众')).not.toBe(workerRoleColor('游客'));
    expect(workerSticker('观众')?.slug).not.toBe(workerSticker('游客')?.slug);
    // 手打的「观演人群」走关键词回落。
    expect(workerRoleColor('观演人群')).toBe(workerRoleColor('观众'));
    expect(workerSticker('观演人群')?.slug).toBe('audience');
    // 观众图标不被任何岗位占用。
    expect(LABOR_ROLES.map(role => workerSticker(role)?.slug)).not.toContain('audience');
  });

  it('岗位表里的每枚图标文件都真实存在（含自制的 audience）', () => {
    const slugs = new Set(Object.values(WORKER_ROLE_STICKERS).map(sticker => sticker.slug));
    const missing = [...slugs].filter(slug => !existsSync(join(process.cwd(), 'public/oneplan-icons/icon', `${slug}.svg`)));
    // 官方库里没有观众图形，audience.svg 是照同套规范自画的，别让人误删。
    expect(slugs.has('audience')).toBe(true);
    expect(missing).toEqual([]);
  });

  it('图例人员色块取岗位主题色（与左侧行/地图芯片/3D 同源）', () => {
    const groups = buildPlanLegend(samplePlan());
    const people = groups.find(g => g.title === '人员')!;
    // 样例岗位是「安保」→ 安保族显式色。
    expect(people.entries[0]!.swatch).toBe(workerRoleColor('安保'));
    expect(people.entries[0]!.swatch).not.toBe(PLANNING_LAYER_COLORS.worker);
  });

  it('左侧「工作人员」九个岗位各有一枚图标，不同岗位不共用 slug（地图上已不写岗位名）', () => {
    const slugs = LABOR_ROLES.map(role => workerSticker(role)?.slug ?? null);
    // 每个岗位都必须命中贴纸，否则地图上会退回圆点、认不出岗位。
    expect(slugs.filter(slug => slug === null)).toEqual([]);
    // 不共享图标：九个岗位九个 slug。
    expect(new Set(slugs).size).toBe(LABOR_ROLES.length);
  });

  it('关键词回落也按「一岗一图标」分开：管理员→胸牌、经理→管理办公室、志愿→爱心、自定义→星标', () => {
    expect(workerSticker('现场管理员')).toMatchObject({ slug: 'accreditation' });
    expect(workerSticker('项目经理')).toMatchObject({ slug: 'event-management-office' });
    expect(workerSticker('志愿者')).toMatchObject({ slug: 'charity' });
    expect(workerSticker('自定义岗')).toMatchObject({ slug: 'km-marker' });
  });

  it('planStickerDescriptors 按 kind+slug 去重（两个摊位只预加载一张贴纸）', () => {
    const stickers = planStickerDescriptors(samplePlan());
    const keys = stickers.map(s => `${s.kind}:${s.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('area:crowd');
    expect(keys).toContain('scale:market-stall');
    expect(keys).toContain('icon:entry-gate'); // 动线徽标与自定义闸机共用入口闸门
    expect(keys).toContain('icon:pedestrian-access');
    expect(keys).toContain('icon:security-checkpoint');
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

  it('画布朝向与占地朝向不一致时转 90°（摩托车 8×24 落进 2.2×0.8）', () => {
    expect(stickerNeedsQuarterTurn(8, 24, 2.2, 0.8)).toBe(true);
    expect(stickerNeedsQuarterTurn(24, 6, 12, 2.5)).toBe(false);
    expect(stickerNeedsQuarterTurn(24, 11, 4.5, 1.8)).toBe(false);
    expect(stickerNeedsQuarterTurn(24, 24, 4.5, 1.8)).toBe(false);
    expect(stickerNeedsQuarterTurn(0, 0, 4.5, 1.8)).toBe(false);
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
    expect(group('人员').entries[0]).toMatchObject({ sticker: { kind: 'icon', slug: 'security-checkpoint' } });
    expect(group('用地红线').entries[0]!.sticker).toBeUndefined();
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