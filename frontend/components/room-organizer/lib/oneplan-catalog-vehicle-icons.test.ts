import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from './oneplan-library';
import { infraBuckets, isPlanVehicleEntry, planVehicleGroupColors, vehicleIconItems } from './oneplan-catalog';

/** 只填筛选真正读的字段：中文名 / slug / kind / 原始分类。 */
function entry(nameZh: string, slug: string, kind = 'scale', categoryZh = '设施物料 / 车辆'): LibraryEntry {
  return { id: `${kind}:${slug}`, slug, nameZh, nameEn: nameZh, categoryZh, kind } as unknown as LibraryEntry;
}

const library = [
  // 服务类（后勤 + 保障），库里都是鸟瞰平面比例图
  entry('重型货车', 'hgv'),
  entry('重型货车（斜置）', 'hgv-rotated'),
  entry('厢式货车', 'van'),
  entry('皮卡', 'pickup-truck'),
  entry('叉车', 'forklift'),
  entry('餐饮拖车', 'food-trailer'),
  entry('救护车', 'ambulance'),
  // 服务以外（载客）
  entry('巴士', 'bus'),
  entry('巴士（斜置）', 'bus-rotated'),
  entry('大巴', 'coach'),
  entry('轿车', 'car'),
  entry('房车', 'caravan'),
  entry('高尔夫球车', 'golf-cart'),
  entry('摩托车', 'motorcycle'),
  // 库里只有正面小图标（带一圈圆底），不是平面图 → 不进车组
  entry('出租车', 'taxi', 'icon', '设施物料 / 交通接驳'),
  entry('摩托车', 'motorbike', 'icon', '设施物料 / 交通接驳'),
  // 不是车：必须留在原来的分类里
  entry('公交站', 'bus-stop', 'icon', '设施物料 / 交通接驳'),
  entry('自行车架', 'bike-rack', 'scale', '设施物料 / 构筑物'),
  entry('停车场关闭', 'car-park-closed', 'scale', '设施物料 / 交通管理'),
  entry('活塞式飞机', 'piston-aircraft', 'scale', '设施物料 / 车辆'),
  entry('剪叉升降车', 'scissor-lift', 'scale', '设施物料 / 车辆'),
];

const slugsOf = (items: LibraryEntry[]) => items.map(i => i.slug);

describe('「车」组：只收鸟瞰平面图，一段平铺，服务/非服务靠配色区分（2026-11-16）', () => {
  it('平面图优先；库里只有正面小图标的车也收（出租车），斜置版不进，同名多条只留一行', () => {
    const items = vehicleIconItems(library);
    const slugs = slugsOf(items);
    for (const slug of ['hgv', 'van', 'pickup-truck', 'forklift', 'food-trailer', 'ambulance', 'bus', 'coach', 'car', 'caravan', 'golf-cart', 'motorcycle', 'taxi']) {
      expect(slugs).toContain(slug);
    }
    expect(slugs).not.toContain('motorbike'); // 同名「摩托车」已由 scale 版占位
    expect(slugs).not.toContain('hgv-rotated');
    expect(slugs).not.toContain('bus-rotated');
    // 同一个 slug 有 scale 时不会拿 icon 版顶替
    expect(items.find(i => i.slug === 'car')?.kind).toBe('scale');
    expect(items.find(i => i.slug === 'taxi')?.kind).toBe('icon');
  });

  it('服务类后勤金、服务以外车行紫，且橙的一簇在上、紫的一簇在下', () => {
    const items = vehicleIconItems(library);
    const colorOf = (slug: string) => items.find(i => i.slug === slug)?.color;
    expect(colorOf('hgv')).toBe(planVehicleGroupColors.service);
    expect(colorOf('car')).toBe(planVehicleGroupColors.passenger);
    expect(planVehicleGroupColors.service).not.toBe(planVehicleGroupColors.passenger);
    const colors = items.map(i => i.color);
    expect(colors.lastIndexOf(planVehicleGroupColors.service)).toBeLessThan(colors.indexOf(planVehicleGroupColors.passenger));
    // 视觉统一：无论库里是 icon 还是 scale，车组一律按「彩底 + 白字形」渲染
    expect(items.every(i => i.chipStyle === 'icon')).toBe(true);
  });

  it('不是车的（公交站 / 自行车架 / 停车场关闭 / 飞机 / 升降车）一个都不进车组', () => {
    const slugs = slugsOf(vehicleIconItems(library));
    for (const slug of ['bus-stop', 'bike-rack', 'car-park-closed', 'piston-aircraft', 'scissor-lift']) {
      expect(slugs).not.toContain(slug);
      expect(isPlanVehicleEntry(entry('x', slug))).toBe(false);
    }
  });

  it('它们也没被删：还留在基础设施原来的分类里；进了车组的车才不重复出现', () => {
    const buckets = infraBuckets(library);
    const itemsOf = (label: string) => buckets.find(b => b.label === label)?.items.map(i => i.slug) ?? [];
    expect(itemsOf('运输')).toContain('bus-stop');
    expect(itemsOf('交通管理')).toContain('car-park-closed');
    expect(itemsOf('交通管理')).not.toContain('taxi'); // 已在车组里，不再重复
    expect(itemsOf('建筑物')).toContain('bike-rack');
    expect(itemsOf('车辆')).toContain('piston-aircraft');
    expect(itemsOf('车辆')).toContain('scissor-lift');
    // 已进车组的那几台车，不在基础设施里再来一份
    expect(itemsOf('车辆')).not.toContain('car');
    expect(itemsOf('车辆')).not.toContain('hgv');
    expect(itemsOf('运输')).not.toContain('bus');
    expect(itemsOf('运输')).not.toContain('van');
    expect(itemsOf('运输')).not.toContain('forklift');
  });

  it('同一台车同名多份只出一行，且留平面图那份', () => {
    const motors = vehicleIconItems(library).filter(i => i.nameZh === '摩托车');
    expect(motors).toHaveLength(1);
    expect(motors[0].kind).toBe('scale');
  });
});
