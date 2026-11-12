/**
 * 2026-11-12 活动包（packs.json，物件级）单元测试：
 * 数据完整性（六包 203 件）、`pack:` 模板 id 往返、放置语义分派、
 * 主题色透传、包分桶预览、搜索按包归组、节庆 scale 占地规则。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isPackTemplateId,
  packEntryFromItem,
  packFacilityTemplate,
  packStickerForTemplateId,
  packTemplateId,
  packsToEntries,
  parsePackTemplateId,
  registerPackEntries,
  type OneplanPackDef,
  type OneplanPacksFile,
} from './oneplan-library';
import { groupCatalogResults, packBuckets } from './oneplan-catalog';
import { planPropKind } from './plan-footprint-geometry';

const packsFile = JSON.parse(
  readFileSync(new URL('../../../public/oneplan-icons/packs.json', import.meta.url), 'utf8'),
) as OneplanPacksFile;

describe('活动包清单 packs.json', () => {
  it('六个包按 OnePlan marketplace 顺序排列，物件总数 203', () => {
    expect(packsFile.packs.map(p => p.id)).toEqual([
      'cricket',
      'biathlon',
      'race',
      'christmas',
      'fairs',
      'festival-cn',
    ]);
    const counts = packsFile.packs.map(p => p.items.length);
    expect(counts).toEqual([43, 41, 48, 22, 29, 20]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(203);
  });

  it('物件级条目齐全：id/资产 slug/中文名/主题色', () => {
    for (const pack of packsFile.packs) {
      for (const item of pack.items) {
        expect(item.id).toBeTruthy();
        expect(item.name_zh).toBeTruthy();
        expect(item.name_zh).not.toBe(item.name_en);
        expect(item.color).toMatch(/^#[0-9a-f]{6}$/);
        if (pack.source === 'oneplan' && !item.generic && item.kind !== 'area') {
          expect(item.asset_slug).toBeTruthy();
        }
      }
    }
  });

  it('中国节庆包是原创包，20 件，scale 两件有独立画法口径', () => {
    const festival = packsFile.packs.find(p => p.id === 'festival-cn');
    expect(festival?.source).toBe('original');
    expect(festival?.items.every(item => item.asset_slug.startsWith('cn-'))).toBe(true);
    const scaleItems = festival?.items.filter(item => item.kind === 'scale') ?? [];
    expect(scaleItems.map(item => item.asset_slug)).toEqual(['cn-dragon-boat', 'cn-opera-stage']);
  });
});

describe('packsToEntries / 模板 id', () => {
  const entries = packsToEntries(packsFile);

  it('包物件条目带 packId/color/placeKind，categoryZh 标注扩展包', () => {
    const slips = entries.find(entry => entry.id === 'cricket/slips');
    expect(slips).toBeDefined();
    expect(slips?.packId).toBe('cricket');
    expect(slips?.packItemId).toBe('slips');
    expect(slips?.color).toBe('#159300');
    expect(slips?.placeKind).toBe('facility');
    expect(slips?.sticker).toEqual({ kind: 'icon', slug: 'slips', icon: 'shapes' });
    expect(slips?.categoryZh).toBe('物件库扩展包 / 板球活动包');
  });

  it('放置语义分派：generic→worker、route→route、area→area、icon/scale→facility', () => {
    const dj = entries.find(entry => entry.id === 'cricket/dj');
    expect(dj?.placeKind).toBe('worker');
    expect(dj?.sticker.slug).toBe('transparent');

    const bikeCourse = entries.find(entry => entry.id === 'race/bike-course');
    expect(bikeCourse?.placeKind).toBe('route');
    expect(bikeCourse?.sticker).toEqual({ kind: 'icon', slug: 'route-dash', icon: 'shapes' });

    const dismount = entries.find(entry => entry.id === 'race/dismount-area');
    expect(dismount?.placeKind).toBe('area');
    expect(dismount?.sticker.slug).toBe('solid-fg');

    const ferris = entries.find(entry => entry.id === 'christmas/ferris-wheel');
    expect(ferris?.placeKind).toBe('facility');
    expect(ferris?.sticker.kind).toBe('scale');
  });

  it('`pack:` 模板 id 往返；同名物件跨包互不冲突', () => {
    const a = packTemplateId('christmas', 'ferris-wheel');
    const b = packTemplateId('fairs', 'ferris-wheel');
    expect(a).toBe('pack:christmas:ferris-wheel');
    expect(b).toBe('pack:fairs:ferris-wheel');
    expect(a).not.toBe(b);
    expect(isPackTemplateId(a)).toBe(true);
    expect(isPackTemplateId('oneplan:icon:tent')).toBe(false);
    expect(parsePackTemplateId(a)).toEqual({ packId: 'christmas', itemId: 'ferris-wheel' });
    expect(parsePackTemplateId('pack:bad')).toBeNull();
  });

  it('registerPackEntries 后 `pack:` 模板可反查贴纸', () => {
    registerPackEntries(entries);
    const ferris = entries.find(entry => entry.id === 'christmas/ferris-wheel');
    expect(packStickerForTemplateId('pack:christmas:ferris-wheel')).toEqual(ferris?.sticker);
    expect(packStickerForTemplateId('pack:ghost:nope')).toBeNull();
  });

  it('pack 物件 3D 一律贴纸平铺（misc）：不吃关键词低模，也不给在线乱配留口', () => {
    // 2026-11-12 用户实测：team-wax-truck 含 'truck' 被拉去立餐车低模 + 在线配了厢式货车 GLB。
    expect(planPropKind('pack:biathlon:team-wax-truck')).toBe('misc');
    expect(planPropKind('pack:christmas:ferris-wheel')).toBe('misc');
    expect(planPropKind('pack:festival-cn:cn-opera-stage')).toBe('misc');
    // 既有口径不变：oneplan: 物件库条目仍按关键词落低模。
    expect(planPropKind('oneplan:scale:food-trailer')).toBe('foodTruck');
    expect(planPropKind('oneplan:scale:tent')).toBe('tent');
  });

  it('包物件设施模板带主题色；节庆 scale 占地走 SIZE_RULES', () => {
    const lantern = entries.find(entry => entry.id === 'festival-cn/cn-lantern');
    expect(lantern?.color).toBe('#eb0420');
    const template = packFacilityTemplate(lantern!);
    expect(template.templateId).toBe('pack:festival-cn:cn-lantern');
    expect(template.color).toBe('#eb0420');
    expect(template.name).toBe('灯笼');

    const opera = entries.find(entry => entry.id === 'festival-cn/cn-opera-stage');
    expect(opera?.width).toBe(8);
    expect(opera?.depth).toBeCloseTo(6, 5);
    const boat = entries.find(entry => entry.id === 'festival-cn/cn-dragon-boat');
    expect(boat?.width).toBe(6);
    expect(boat?.depth).toBeCloseTo(1.6, 5);
  });
});

describe('packBuckets / 搜索归组', () => {
  const entries = packsToEntries(packsFile);
  const buckets = packBuckets(packsFile.packs as OneplanPackDef[], entries);

  it('按包分桶、OnePlan 顺序在前、预览取前 3 件', () => {
    expect(buckets.map(b => b.id)).toEqual(['cricket', 'biathlon', 'race', 'christmas', 'fairs', 'festival-cn']);
    const cricket = buckets[0]!;
    expect(cricket.items).toHaveLength(43);
    expect(cricket.previews).toHaveLength(3);
    expect(cricket.previews[0]!.id).toBe('cricket/accreditation-manager');
    expect(cricket.nameZh).toBe('板球活动包');
  });

  it('搜索结果按包名归组（中英文都能搜到包内物件）', () => {
    const zh = groupCatalogResults(entries.filter(entry => entry.nameZh.includes('圣诞树')));
    expect(zh[0]?.label).toBe('圣诞活动包');
    const en = groupCatalogResults(entries.filter(entry => entry.nameEn === 'Bratwurst'));
    expect(en[0]?.label).toBe('圣诞活动包');
  });

  it('单件包条目也能独立成桶（packEntryFromItem 契约）', () => {
    const pack = packsFile.packs.find(p => p.id === 'christmas')!;
    const entry = packEntryFromItem(pack, pack.items[0]!);
    expect(entry.id).toBe(`christmas/${pack.items[0]!.id}`);
    expect(entry.packItemId).toBe(pack.items[0]!.id);
  });
});
