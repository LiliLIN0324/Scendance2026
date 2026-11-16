/**
 * 「车」清单（2026-11-16 用户）。
 *
 * 用户原话：把车从人群和基础设施里摘出来，因为我们有后勤流线和车流线。素材库第一段
 * 「区域、路线及交通」下面加一个「车」子组，每种车给一个素材、一条它自己怎么走的流线。
 *
 * 两条属性分开记：
 * - `kind`：走哪一类动线（人行 / 车辆 / 后勤）——决定线色与图例里的目的；
 * - `carrier`：靠什么在走（planRouteCarrier）——决定布点密度与冲突判定。
 *   车一律 carrier='vehicle'；自行车/非机动车暂并入 vehicle，等真有「非机动车流线」
 *   再加一档 carrier，不在这里先造概念。
 *
 * `modelSlugs` 只登记库内确实存在的 GLB（台账 `deliverables/asset-ledger/glb-ledger.json`）。
 * 没有就留空 = 待补：界面上照常能画这条车的流线，但不假装有模型。
 */

import type { PlanRouteCarrier } from '../../../../supabase/functions/_shared/site-plan';

/** 第一段之外、与「基础设施」同级的一行（2026-11-16 用户）：车。 */
export const CAR_ROW_LABEL = '车';

export interface VehicleType {
  id: string;
  /** 面板上的名字。 */
  name: string;
  /** 一句话：这车在现场干什么、怎么停。 */
  note: string;
  /** 走哪一类动线。 */
  kind: 'pedestrian' | 'vehicle' | 'service';
  /** 载体：车一律 vehicle。 */
  carrier: PlanRouteCarrier;
  /** 库内模型 slug（空数组 = 待补）。 */
  modelSlugs: readonly string[];
}

export const VEHICLE_TYPES: readonly VehicleType[] = [
  {
    id: 'coach',
    name: '服务大巴车',
    note: '旅游 / 团队接驳；集中上下客，停靠点要留队形空间',
    kind: 'vehicle',
    carrier: 'vehicle',
    modelSlugs: [],
  },
  {
    id: 'business',
    name: '商务车',
    note: '办公迎宾、VIP 接送；短停、就近落客',
    kind: 'vehicle',
    carrier: 'vehicle',
    modelSlugs: ['car-park-and-road-vehicle-fleet-saloon-ad831b1f'],
  },
  {
    id: 'daily',
    name: '日常车',
    note: '大部分人流自驾抵达；停车时长最长，占用车位是主项',
    kind: 'vehicle',
    carrier: 'vehicle',
    modelSlugs: ['car-park-and-road-vehicle-fleet-city-car-033e3215'],
  },
  {
    id: 'taxi',
    name: '出租车',
    note: '临时落客；停靠短、周转快，最好与自驾车流分开',
    kind: 'vehicle',
    carrier: 'vehicle',
    modelSlugs: ['car-park-and-road-vehicle-fleet-saloon-ad831b1f'],
  },
  {
    id: 'bus',
    name: '公交车',
    note: '公共交通到站；瞬时大客流，站点是入口级的节点',
    kind: 'vehicle',
    carrier: 'vehicle',
    modelSlugs: [],
  },
  {
    id: 'bike',
    name: '自行车',
    note: '非机动车；走非机动车流线，混进车行道最危险',
    kind: 'vehicle',
    carrier: 'vehicle',
    modelSlugs: [],
  },
  {
    id: 'cleaning',
    name: '保洁车',
    note: '后勤：低速沿场巡回，作业时间窗通常在客流低谷',
    kind: 'service',
    carrier: 'vehicle',
    modelSlugs: [],
  },
  {
    id: 'garbage',
    name: '垃圾车',
    note: '后勤：定点清运，停留久，要避开客流入口',
    kind: 'service',
    carrier: 'vehicle',
    modelSlugs: [],
  },
  {
    id: 'truck',
    name: '货车',
    note: '后勤：装卸货，必须有装卸位，倒车扫掠要留出来',
    kind: 'service',
    carrier: 'vehicle',
    modelSlugs: ['car-park-and-road-vehicle-fleet-box-truck-4574c765'],
  },
] as const;

/** 有一种车有库内模型就返回它，否则 null（界面据此标「待补」）。 */
export function vehicleModelSlug(type: VehicleType): string | null {
  return type.modelSlugs[0] ?? null;
}
