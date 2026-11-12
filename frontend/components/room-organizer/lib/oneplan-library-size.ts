/**
 * 物件库默认占地（米）。
 *
 * 清单本身只有贴纸 viewBox，没有米制尺寸；此前一律落到杂项 2×2，
 * 轿车、座椅、舞台看起来一样大。这里按 slug / 分类给出可信长边，
 * 比例尺线稿（scale-fg）再用 viewBox 的长宽比落到地面。
 *
 * 不改已经摆上图的 `facility.size`：只影响新从库里拖出来的默认值。
 * viewBox 数字不是米（长边常被归一到 24），只作比例。
 */

import { PLAN_PROP_SIZE, planPropKind } from './plan-footprint-geometry';

export interface LibraryFootprintInput {
  slug: string;
  /** manifest 的 kind：icon / scale-fg / area，或已归一的 scale。 */
  kind: string;
  categoryZh?: string;
  viewBox?: string;
}

/** 解析 SVG viewBox，只取宽高。 */
export function parseViewBox(viewBox: string | undefined): { w: number; h: number } | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const w = Math.abs(parts[2]);
  const h = Math.abs(parts[3]);
  if (w < 1e-6 || h < 1e-6) return null;
  return { w, h };
}

function roundSize(width: number, depth: number): { width: number; depth: number } {
  const clamp = (n: number) => Math.max(0.2, Math.round(n * 10) / 10);
  return { width: clamp(width), depth: clamp(depth) };
}

function fitMajor(major: number, vw: number, vh: number): { width: number; depth: number } {
  const long = Math.max(vw, vh);
  return roundSize((major * vw) / long, (major * vh) / long);
}

function isScaleKind(kind: string): boolean {
  return kind === 'scale-fg' || kind === 'scale';
}

function isAreaKind(kind: string): boolean {
  return kind === 'area';
}

type SizeRule = {
  re: RegExp;
  /** 特征长边（米）。 */
  major: number;
  /** 无 viewBox 时短边/长边，默认正方形。 */
  shortRatio?: number;
  only?: 'scale' | 'icon' | 'area';
};

/**
 * 更具体的规则在前。轿车不误伤旋转木马，巴士不误伤公交站图标。
 */
const SIZE_RULES: readonly SizeRule[] = [
  // 2026-11-12 中国节庆包原创 scale 物件（比通用 boat/stage 规则更具体，放最前）。
  { re: /^cn-opera-stage$/, major: 8, shortRatio: 6 / 8 },
  { re: /^cn-dragon-boat$/, major: 6, shortRatio: 1.6 / 6 },
  { re: /ferris-wheel/, major: 16 },
  { re: /carousel|chair-o-planes|paratrooper/, major: 12 },
  { re: /bungee-trampoline/, major: 8 },
  { re: /helicopter|piston-aircraft|spitfire/, major: 10, shortRatio: 0.35 },
  { re: /^(bus|coach)(-rotated)?$/, major: 12, shortRatio: 2.5 / 12, only: 'scale' },
  { re: /hgv(-rotated)?$/, major: 12, shortRatio: 2.5 / 12, only: 'scale' },
  { re: /fire-engine/, major: 8, shortRatio: 0.32 },
  { re: /large-screen-truck|outside-broadcast|satellite-van|team-wax-truck|hb-van|ob-/, major: 8, shortRatio: 0.32 },
  { re: /ambulance|swat|pickup-truck/, major: 5.5, shortRatio: 2 / 5.5 },
  { re: /food-trailer|enclosed-trailer|toilet-trailer/, major: 6, shortRatio: 2.5 / 6 },
  { re: /(^|-)van(-rotated)?$/, major: 5.4, shortRatio: 2 / 5.4 },
  { re: /caravan/, major: 6, shortRatio: 2.2 / 6 },
  { re: /(^|-)((police-)?car)(-rotated)?$/, major: 4.5, shortRatio: 1.8 / 4.5 },
  { re: /golf-cart/, major: 2.7, shortRatio: 1.2 / 2.7 },
  { re: /motorcycle|motorbike/, major: 2.2, shortRatio: 0.8 / 2.2 },
  { re: /forklift|scissor-lift/, major: 3.2, shortRatio: 1.4 / 3.2 },
  { re: /telehandler/, major: 5, shortRatio: 0.4 },
  { re: /tractor/, major: 4, shortRatio: 0.5 },
  { re: /dinghy/, major: 3.5, shortRatio: 0.4 },
  { re: /motor-boat|(^|-)boat(-|$)/, major: 6, shortRatio: 0.35 },
  { re: /shipping-container/, major: 6.1, shortRatio: 2.4 / 6.1 },
  { re: /portable-cabin|wooden-chalet/, major: 5, shortRatio: 0.5 },
  { re: /stretch-tent/, major: 6, shortRatio: 16 / 24 },
  { re: /yurt/, major: 5 },
  { re: /bell-tent|pop-up-tent|(^|-)tent(-|$)/, major: 3 },
  { re: /portable-toilet|urinal-pod|accessible-portable-toilet/, major: 1.2 },
  { re: /large-waste-container/, major: 3.5, shortRatio: 0.55 },
  { re: /waste-container|recycling-bin/, major: 1.2 },
  { re: /generator/, major: 2.4, shortRatio: 0.5 },
  { re: /fuel-cube/, major: 1.2 },
  { re: /distribution-board/, major: 1 },
  { re: /battery-energy-storage/, major: 2.5, shortRatio: 0.6 },
  { re: /cable-matting|ada-low-profile/, major: 2, shortRatio: 0.5 },
  { re: /ev-charge/, major: 0.8 },
  { re: /large-screen/, major: 6, shortRatio: 2 / 24 },
  { re: /pa-speakers|speaker/, major: 0.7 },
  { re: /dj-location/, major: 2 },
  { re: /folding-chair|deck-chair|(^|-)chair(-|$)/, major: 0.55, shortRatio: 20 / 24 },
  { re: /sofa/, major: 2, shortRatio: 11 / 24 },
  { re: /beanbag/, major: 0.8 },
  { re: /picnic-table|bar-table|table-and-chairs|round-table-and-chairs/, major: 2.2, shortRatio: 0.7 },
  { re: /round-table|(^|-)table(-|$)/, major: 1.6, shortRatio: 8.3 / 24 },
  { re: /bench/, major: 1.8, shortRatio: 0.4 },
  { re: /pallet/, major: 1.2, shortRatio: 0.8 },
  { re: /hay-bale/, major: 1 },
  { re: /inflatable-arch|truss-arch|balloon-arch/, major: 6, shortRatio: 0.3 },
  { re: /pedestrian-bridge/, major: 12, shortRatio: 0.25 },
  { re: /pontoon/, major: 8, shortRatio: 0.3 },
  { re: /gantry/, major: 8, shortRatio: 0.2 },
  { re: /scaffold-tower|scaffold/, major: 2 },
  { re: /bike-rack/, major: 2.5, shortRatio: 0.5 },
  { re: /viewing-platform/, major: 4 },
  { re: /shooting-range/, major: 8, shortRatio: 0.4 },
  { re: /dugout/, major: 6, shortRatio: 0.35 },
  { re: /switch-back-ramp|(^|-)ramp(-|$)/, major: 4, shortRatio: 0.35 },
  { re: /stairs/, major: 2.5, shortRatio: 0.5 },
  { re: /aluminum-trackway|ground-protection|trackway/, major: 3, shortRatio: 0.4 },
  { re: /concrete-block/, major: 0.8 },
  { re: /signage-frame|pull-up-banner|feather-flag|lamp-post-banner/, major: 1.2, shortRatio: 0.35 },
  { re: /stanchion|bollard|(^|-)cone(-|$)|traffic-cone/, major: 0.4 },
  { re: /camera-platform|camera-crane/, major: 3, shortRatio: 0.5 },
  { re: /camera-boat/, major: 6, shortRatio: 0.35 },
  { re: /camera|cctv/, major: 0.4 },
  { re: /fire-extinguisher|fire-hydrant/, major: 0.4 },
  { re: /variable-message|traffic-lights/, major: 1.5, shortRatio: 0.6 },
  { re: /market-stall|food-trader|merchandise-stall/, major: 2 },
  { re: /bouncy-castle/, major: 5 },
  { re: /warming-dome/, major: 4 },
  { re: /christmas-tree/, major: 1.5 },
  { re: /aid-station|feed-station|water-refill/, major: 4, shortRatio: 0.6 },
  { re: /sight-screen/, major: 4, shortRatio: 0.2 },
  { re: /wicket/, major: 1.2, shortRatio: 3 / 24 },
  { re: /heavy-roller|light-roller/, major: 3, shortRatio: 0.4 },
  { re: /stage/, major: 8, shortRatio: 6 / 8 },
  { re: /ticket-office|box-office/, major: 3, shortRatio: 2 / 3 },
  { re: /first-aid|medical-tent/, major: 4, shortRatio: 3 / 4 },
];

function matchRule(slug: string, kind: string): SizeRule | null {
  const scale = isScaleKind(kind);
  const area = isAreaKind(kind);
  const bucket: SizeRule['only'] = area ? 'area' : scale ? 'scale' : 'icon';
  for (const rule of SIZE_RULES) {
    if (rule.only && rule.only !== bucket) continue;
    if (rule.re.test(slug)) return rule;
  }
  return null;
}

function categoryMajor(categoryZh: string, kind: string): number | null {
  if (!categoryZh) return null;
  const scale = isScaleKind(kind);
  if (categoryZh.includes('流线') || categoryZh.includes('通行区域') || categoryZh.includes('活动区域')) {
    return 10;
  }
  if (categoryZh.includes('车辆')) return scale ? 5 : 1.5;
  if (categoryZh.includes('家具')) return 1.6;
  if (categoryZh.includes('交通管理')) return 1.2;
  if (categoryZh.includes('电力') || categoryZh.includes('弱电')) return scale ? 1.5 : 1;
  if (categoryZh.includes('铺道') || categoryZh.includes('地面')) return 3;
  if (categoryZh.includes('视听')) return 1.5;
  if (categoryZh.includes('品牌') || categoryZh.includes('导视')) return 1.2;
  if (categoryZh.includes('转播') || categoryZh.includes('摄像')) return scale ? 1.2 : 0.6;
  if (categoryZh.includes('安全')) return 0.6;
  if (categoryZh.includes('卫生')) return 2.4;
  if (categoryZh.includes('餐饮') || categoryZh.includes('集市')) return 2.5;
  if (categoryZh.includes('供水')) return 1.2;
  if (categoryZh.includes('交通接驳') || categoryZh.includes('兴趣点') || categoryZh.includes('出入口')) {
    return 1.5;
  }
  if (categoryZh.includes('构筑物')) return scale ? 4 : 2;
  if (categoryZh.includes('垃圾')) return 1.2;
  if (categoryZh.includes('图元') || categoryZh.includes('底衬')) return 6;
  if (categoryZh.includes('路跑') || categoryZh.includes('铁人') || categoryZh.includes('板球') || categoryZh.includes('冬季')) {
    return scale ? 2 : 1.5;
  }
  if (categoryZh.includes('圣诞')) return 2;
  return null;
}

function propKindSize(slug: string): { width: number; depth: number } | null {
  const kind = planPropKind(slug);
  if (kind === 'misc') return null;
  return PLAN_PROP_SIZE[kind];
}

function defaultMajor(kind: string): number {
  if (isAreaKind(kind)) return 10;
  if (isScaleKind(kind)) return 3;
  return 1.2;
}

function unrotatedFromRule(rule: SizeRule, slug: string): { width: number; depth: number } {
  const short = rule.major * (rule.shortRatio ?? 1);
  const rotated = /-rotated$/.test(slug);
  return rotated
    ? roundSize(short, rule.major)
    : roundSize(rule.major, short);
}

/**
 * 库条目 / 模板解析共用的默认占地。
 * 有 viewBox 的比例尺贴纸按线稿朝向落在地面上；符号图标用类型矩形（厕所 2.4×1.2）。
 */
export function libraryFootprint(input: LibraryFootprintInput): { width: number; depth: number } {
  const slug = input.slug.trim().toLowerCase();
  const kind = input.kind;
  const rule = matchRule(slug, kind);
  const aspect = parseViewBox(input.viewBox);
  const fromKind = propKindSize(slug);

  if (isScaleKind(kind) || isAreaKind(kind)) {
    const major =
      rule?.major ??
      (fromKind ? Math.max(fromKind.width, fromKind.depth) : null) ??
      categoryMajor(input.categoryZh ?? '', kind) ??
      defaultMajor(kind);
    if (aspect) return fitMajor(major, aspect.w, aspect.h);
    if (rule) return unrotatedFromRule(rule, slug);
    if (fromKind) return { width: fromKind.width, depth: fromKind.depth };
    return roundSize(major, major);
  }

  if (rule) return unrotatedFromRule(rule, slug);
  if (fromKind) return { width: fromKind.width, depth: fromKind.depth };
  const major = categoryMajor(input.categoryZh ?? '', kind) ?? defaultMajor(kind);
  return roundSize(major, major);
}
