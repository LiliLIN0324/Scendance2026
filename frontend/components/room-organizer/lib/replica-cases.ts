/**
 * OnePlan 经典案例复刻（学习库 → 产品）——barrel。
 *
 * 参考图：learning-library/oneplan-siteplans/（OnePlan「Site plans we love」45 案，
 * 版权归 OnePlan，仅内部学习用，不进 frontend/public）。
 * 每案 = 真实案例地点锚点（source 'preset'）+ 按参考图近似复刻的区块/设施/流线/出入口。
 * 规格分文件维护（replica-specs-*.ts），本文件按灵感库原序汇总成 REPLICA_CASES。
 */

import { expandReplicaSpec, type ReplicaCaseSpec } from './replica-kit';
import { replicaCaseLabels } from './replica-case-labels';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import {
  BASILDON_PRIDE,
  FIRE_IN_THE_MOUNTAIN,
  NORTH_AUSTRALIA_FESTIVAL_OF_THE_ARTS,
  NORTHERN_NEVADA_PRIDE,
  SCOTIABANK_HOCKEY_DAY_CANADA,
  THE_NEWPORT_SHOW,
} from './replica-specs-festivals-1';
import {
  MUGSTOCK,
  NEW_FOREST_FOLK_FESTIVAL,
  PARKENFESTIVALEN,
  RIVERBEND_MUSIC_FESTIVAL,
} from './replica-specs-festivals-2';
import {
  ASHFIELD_DAY,
  DESERT_WINEFEST,
  HALLOWEEN_FIREWORK_SPOOKTACULAR,
  NATIONAL_CHERRY_FESTIVAL,
  OUTFIELD_MUSIC_FOOD_ARTS_FESTIVAL,
  RIVERSIDE_FESTIVAL_QC,
  SPEARFISH_FESTIVAL_IN_THE_PARK,
  SPILTROCK_SUMMERJAM,
  START_ON_THE_STREET,
} from './replica-specs-festivals-3';
import {
  BUFFALO_MARATHON_WEEKEND,
  FESTIVAL_FOODS_11_RUNNING_EVENTS,
  FRANKLINS_GARDENS_NORTHAMPTON_SAINTS,
  USA_TRIATHLON_NATIONALS_PTO,
} from './replica-specs-road-venue';
import { SENIOR_PRO_RODEO_FINALS } from './replica-specs-rodeo';
import { CN_SPECS } from './replica-specs-cn';
import {
  BANBURY_TOWN_COUNCIL_CORONATION,
  FAREHAM_WEST_SCOUTS_CAMP24,
  ROTHERHAM_CHRISTMAS_LIGHT_SWITCH_ON,
  VICTORIA_PARK_BRISBANE_EASTER_EGG_HUNT,
} from './replica-specs-gov-1';
import {
  HALLOWEEN_CARNIVAL_MANHEIM,
  HIGH_CHAPARRAL_PARK_ECLIPSE,
  NATIONAL_NIGHT_OUT_OLNEY,
  TRUNK_OR_TREAT_KUNA,
  WINTERSKOL_ASPEN,
} from './replica-specs-gov-2';
import {
  CAROLS_IN_THE_PARK,
  HALLOWEEN_TOWN,
  MANDURAH_CHRISTMAS_PAGEANT,
  SPRINGVALE_SNOW_FEST,
} from './replica-specs-gov-3';
import {
  CHRISTMAS_IN_JULY,
  EUROVISION_HOST_CITY_BID,
  GC_LIVE_STARRY_NIGHTS,
  GREAT_FAIR_OF_SHALFORD,
  MASTERS_OF_MOTORING,
  ROCKET_CITY_FAIR,
  SWITAS_TRUCK_SHOW,
  TRAFALGAR_SQUARE_COURSE,
} from './replica-specs-markets-education';

/** 顺序 = OnePlan 灵感库原序（对应 learning-library/oneplan-siteplans/index.json）。 */
const SPECS: ReplicaCaseSpec[] = [
  SCOTIABANK_HOCKEY_DAY_CANADA,
  NORTH_AUSTRALIA_FESTIVAL_OF_THE_ARTS,
  USA_TRIATHLON_NATIONALS_PTO,
  THE_NEWPORT_SHOW,
  NORTHERN_NEVADA_PRIDE,
  FRANKLINS_GARDENS_NORTHAMPTON_SAINTS,
  BANBURY_TOWN_COUNCIL_CORONATION,
  NEW_FOREST_FOLK_FESTIVAL,
  CHRISTMAS_IN_JULY,
  NATIONAL_NIGHT_OUT_OLNEY,
  BASILDON_PRIDE,
  FIRE_IN_THE_MOUNTAIN,
  BUFFALO_MARATHON_WEEKEND,
  ROTHERHAM_CHRISTMAS_LIGHT_SWITCH_ON,
  FAREHAM_WEST_SCOUTS_CAMP24,
  VICTORIA_PARK_BRISBANE_EASTER_EGG_HUNT,
  TRUNK_OR_TREAT_KUNA,
  PARKENFESTIVALEN,
  WINTERSKOL_ASPEN,
  HIGH_CHAPARRAL_PARK_ECLIPSE,
  HALLOWEEN_CARNIVAL_MANHEIM,
  OUTFIELD_MUSIC_FOOD_ARTS_FESTIVAL,
  CAROLS_IN_THE_PARK,
  MANDURAH_CHRISTMAS_PAGEANT,
  HALLOWEEN_FIREWORK_SPOOKTACULAR,
  GC_LIVE_STARRY_NIGHTS,
  TRAFALGAR_SQUARE_COURSE,
  NATIONAL_CHERRY_FESTIVAL,
  HALLOWEEN_TOWN,
  ROCKET_CITY_FAIR,
  GREAT_FAIR_OF_SHALFORD,
  SPRINGVALE_SNOW_FEST,
  ASHFIELD_DAY,
  SPILTROCK_SUMMERJAM,
  MUGSTOCK,
  RIVERBEND_MUSIC_FESTIVAL,
  MASTERS_OF_MOTORING,
  DESERT_WINEFEST,
  FESTIVAL_FOODS_11_RUNNING_EVENTS,
  EUROVISION_HOST_CITY_BID,
  SPEARFISH_FESTIVAL_IN_THE_PARK,
  SWITAS_TRUCK_SHOW,
  SENIOR_PRO_RODEO_FINALS,
  RIVERSIDE_FESTIVAL_QC,
  START_ON_THE_STREET,
];

export type ReplicaCase = {
  id: string;
  /** 界面显示名（中文；海外案来自 replica-case-labels，国内案本来就是中文）。 */
  title: string;
  /** OnePlan 原案名，界面作副标题/提示用；国内案没有这一层。 */
  titleEn?: string;
  /** 中文分类。 */
  category: string;
  categoryEn?: string;
  /** 中文区域。 */
  region: string;
  regionEn?: string;
  /** 'cn' = 官网中国案例；缺省 = OnePlan 海外复刻。 */
  origin?: 'overseas' | 'cn';
  refImage: string;
  refLink: string;
  locationNote?: string;
  /** 平面图的几何旋转角；用户确认的观察角保存在 confirmedView。 */
  rotationDeg?: number;
  confirmedView?: ReplicaCaseSpec['confirmedView'];
  sourceRegistration?: ReplicaCaseSpec['sourceRegistration'];
  /** 官网侧平面数据（国内案），对比报告左幅用。 */
  officialPlan?: ReplicaCaseSpec['officialPlan'];
  buildPlan: () => SitePlanData;
};

function toReplicaCase(spec: ReplicaCaseSpec): ReplicaCase {
  const labels = replicaCaseLabels(spec.slug, spec);
  const origin = spec.origin ?? 'overseas';
  return {
    id: spec.slug,
    title: labels.title,
    ...(labels.title === spec.title ? {} : { titleEn: spec.title }),
    category: labels.category,
    ...(labels.category === spec.category ? {} : { categoryEn: spec.category }),
    region: labels.region,
    ...(labels.region === spec.region ? {} : { regionEn: spec.region }),
    ...(origin === 'cn' ? { origin } : {}),
    refImage: spec.refImage,
    refLink: spec.refLink,
    ...(spec.locationNote ? { locationNote: spec.locationNote } : {}),
    ...(spec.rotationDeg != null ? { rotationDeg: spec.rotationDeg } : {}),
    ...(spec.confirmedView ? { confirmedView: spec.confirmedView } : {}),
    ...(spec.sourceRegistration ? { sourceRegistration: spec.sourceRegistration } : {}),
    ...(spec.officialPlan ? { officialPlan: spec.officialPlan } : {}),
    buildPlan: () => expandReplicaSpec(spec),
  };
}

/** OnePlan 海外经典案例（45 案）。 */
export const REPLICA_CASES: ReplicaCase[] = SPECS.map(toReplicaCase);

/** 官网中国案例（同构复刻：真实地点锚点 + 拟设分区/物料/流线）。 */
export const CN_REPLICA_CASES: ReplicaCase[] = CN_SPECS.map(toReplicaCase);

/** 两个案例库合起来（选单与报告用）。 */
export const ALL_REPLICA_CASES: ReplicaCase[] = [...CN_REPLICA_CASES, ...REPLICA_CASES];

/** 旧导出（venue-picker 首卡在用）：Scotiabank 冰球日复刻案。 */
export function buildScotiabankReplicaPlan(): SitePlanData {
  return REPLICA_CASES[0].buildPlan();
}
