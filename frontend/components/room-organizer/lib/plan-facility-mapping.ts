/**
 * M2 facility 迁移：室内 `FurnitureType` → plan 设施模板落点映射表（纯函数，不含执行器）。
 *
 * 四档落点：
 * - `builtin`：语义明确、对齐内置 8 模板（舞台 / 厕位）；
 * - `oneplan`：能对上 OnePlan 白名单贴纸 / 线稿（座椅 / 桌台 / 绿化 / 照明 / 安防 / 餐饮 / 水景 / 楼梯）；
 * - `misc`：纯室内家居 / 装饰，户外目录无对应，回落 misc 占位（保留名称 / 颜色 / 坐标，尺寸走 misc 兜底）；
 * - `skip`：墙体 / 隔断 / 门窗 / 围栏等结构件，归下一轮独立 `walls` 集合，本轮不进 facility。
 *
 * 口径备注：
 * - `person` 在主循环分流到 workers，不进 facility；
 * - `glb-asset` 回落 misc，其 `glbUrl/assetId` 下一轮挂契约 `modelOverride`；
 * - 本模块只给档位与 templateId，不加载 manifest、不读 store、不接壳体调用。
 */

export type FacilityMigrationTarget =
  | { kind: 'builtin'; templateId: string }
  | { kind: 'oneplan'; templateId: string }
  | { kind: 'misc' }
  | { kind: 'skip'; reason: string };

/** 室内类型 → 内置模板 templateId（命中 `PLAN_FACILITY_TEMPLATES` 白名单）。 */
export const BUILTIN_TEMPLATE: Readonly<Record<string, string>> = {
  toilet: 'toilet-2.4x1.2',
  backdrop: 'stage-platform-8x6',
};

/** 室内类型 → OnePlan 白名单条目 templateId（`oneplan:<kind>:<slug>`，均在可放置清单内）。 */
export const ONEPLAN_TEMPLATE: Readonly<Record<string, string>> = {
  // 座椅
  chair: 'oneplan:scale:chair',
  armchair: 'oneplan:scale:chair',
  'dining-chair': 'oneplan:scale:chair',
  bench: 'oneplan:scale:bench',
  'garden-bench': 'oneplan:scale:bench',
  sofa: 'oneplan:scale:sofa',
  // 桌台
  table: 'oneplan:scale:table',
  'dining-table': 'oneplan:scale:table-and-chairs',
  'coffee-table': 'oneplan:scale:table',
  'side-table': 'oneplan:scale:table',
  'picnic-table': 'oneplan:scale:picnic-table',
  desk: 'oneplan:scale:table',
  // 绿化
  plant: 'oneplan:icon:plant',
  flowerpot: 'oneplan:icon:plant',
  bush: 'oneplan:icon:plant',
  'rose-bush': 'oneplan:icon:plant',
  hedge: 'oneplan:icon:plant',
  flowerbed: 'oneplan:icon:plant',
  tulips: 'oneplan:icon:plant',
  sunflower: 'oneplan:icon:plant',
  // 照明
  lamppost: 'oneplan:icon:street-lamp',
  // 电子 / 安防
  wifi: 'oneplan:icon:wifi',
  router: 'oneplan:icon:wifi',
  cctv: 'oneplan:icon:cctv-camera',
  'security-camera': 'oneplan:icon:cctv-camera',
  computer: 'oneplan:icon:computer',
  // 餐饮 / 后勤
  fridge: 'oneplan:icon:fridge',
  bbq: 'oneplan:icon:barbeque',
  // 水景
  pool: 'oneplan:icon:water-pool',
  pond: 'oneplan:icon:water-pool',
  birdbath: 'oneplan:icon:water-fountain',
  // 交通件
  stairs: 'oneplan:scale:stairs',
};

/** 本轮不迁进 facility 的室内结构 / 墙体件。 */
const SKIP_REASON: Readonly<Record<string, string>> = {
  partition: '隔断归独立 walls 集合（下一轮契约扩字段后再接）',
  fence: '围栏归独立 walls 集合（下一轮）',
  door: '门洞结构件归独立 walls 集合（下一轮）',
  window: '窗洞结构件归独立 walls 集合（下一轮）',
  person: '人员分流到 workers，不进 facility',
};

/**
 * 解析一个室内物件类型的 facility 落点档位。
 * 未列入映射的室内家居 / 装饰类型一律回落 `misc`，不在此处硬猜户外语义。
 */
export function resolveFacilityTarget(type: string): FacilityMigrationTarget {
  const t = type.trim();
  const builtin = BUILTIN_TEMPLATE[t];
  if (builtin) return { kind: 'builtin', templateId: builtin };
  const skip = SKIP_REASON[t];
  if (skip) return { kind: 'skip', reason: skip };
  const oneplan = ONEPLAN_TEMPLATE[t];
  if (oneplan) return { kind: 'oneplan', templateId: oneplan };
  return { kind: 'misc' };
}
