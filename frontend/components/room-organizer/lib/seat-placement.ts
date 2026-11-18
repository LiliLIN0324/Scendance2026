/**
 * 户外设施 → 座位落点（纯函数层，零 three / React 依赖，便于单测）。
 *
 * 与 `walk-seat` 同一套坐面高度 / 坐姿眼高口径；区别是户外设施没有 FurnitureItem.type，
 * 可坐判定改走物件库 slug、模板 id 与中文名关键词（椅 / 沙发 / 凳 / 长椅）。
 *
 * 坐标系：输入输出均为规划 ENU（x 东、y 北，米）；世界坐标换算仍由场景层完成。
 * 坐姿真人 clip 未到位前，本层只负责「能不能坐、坐哪、坐多高」，不播坐姿动画。
 */

/** 可坐物件 slug / 模板 id 关键词（小写匹配）。 */
const SEAT_SLUG_TOKENS = [
  'chair',
  'armchair',
  'dining-chair',
  'sofa',
  'bench',
  'garden-bench',
  'seat',
] as const;

/** 可坐物件中文名关键词。 */
const SEAT_NAME_TOKENS = ['椅', '沙发', '凳', '长椅', '等候椅'] as const;

/** 坐姿眼高 = 坐面 + 这么多（米），与 walk-seat 一致。 */
const SEATED_EYE_OFFSET = 0.63;

export interface SeatFacilityInput {
  id: string;
  name: string;
  position: { x: number; y: number };
  /** 平面朝向角（度，东为零、逆时针为正）。 */
  rotationDeg?: number;
  /** 物件库 slug / 模板 id / override slug，用于可坐关键词判定。 */
  ref?: string | undefined;
  /** 模型标称高度（米），用于坐面高度收边。 */
  height?: number;
}

/** 一个可落座的座位目标。 */
export interface SeatTarget {
  id: string;
  name: string;
  /** 落座落点（设施中心，ENU 米）。 */
  x: number;
  y: number;
  /** 平面朝向角（度）。 */
  rotationDeg: number;
  /** 坐面高度（米，从地面起算）。 */
  seatHeight: number;
  /** 坐下后的相机眼高（含楼层基准）。 */
  eyeY: number;
}

function lowerTokens(text: string): string {
  return (text ?? '').toLowerCase();
}

/** 设施是否可坐：slug / 模板 id / 名称命中坐具关键词；桌子、绿植、摊位不算。 */
export function isSeatFacility(input: SeatFacilityInput): boolean {
  const haystack = lowerTokens(`${input.ref ?? ''} ${input.name ?? ''}`);
  const slugHit = SEAT_SLUG_TOKENS.some(token => haystack.includes(token));
  if (slugHit) return true;
  return SEAT_NAME_TOKENS.some(token => (input.name ?? '').includes(token));
}

/** 坐面高度：沙发略低，椅 / 凳常规；用模型高度收边，避免异常模型坐进地里或悬空。 */
export function seatSurfaceHeight(input: SeatFacilityInput): number {
  const isCushioned = lowerTokens(`${input.ref ?? ''} ${input.name ?? ''}`).includes('sofa')
    || (input.name ?? '').includes('沙发');
  const base = isCushioned ? 0.42 : 0.45;
  const capped = typeof input.height === 'number' && input.height > 0
    ? Math.min(base, input.height * 0.55)
    : base;
  return Math.max(0.28, capped);
}

/** 坐姿 / 起身落点（世界系：x 东、z = −北；与 `outdoor-walk-boundary` 同一口径）。 */
export interface SeatWalkAnchor {
  /** 落座锚点（髂部落点）。 */
  x: number;
  z: number;
  /** 落座朝向（弧度）。 */
  yaw: number;
  /** 起身落点：再沿朝向后让 `standoffM`，站起来不站在椅子里。 */
  standX: number;
  standZ: number;
}

/** 坐姿朝向：设施模型 `rotation.y = -deg`、人物正面 +Z，人转 π − deg 才背靠椅背。 */
export function seatFacingRad(rotationDeg: number): number {
  return Math.PI - (rotationDeg * Math.PI) / 180;
}

/**
 * 座位 ENU 落点 → 落座锚点与起身落点。
 *
 * 纯函数，供户外 3D 的 E 键落座与起身共用，避免「坐下在椅面上、起身站进椅子里」
 * 两处各算一套。髋部后移 0.12 m、起身再让 0.45 m，与 `planSeatAnchors` 同一手感。
 */
export function seatWalkAnchor(
  seat: { x: number; y: number; rotationDeg: number },
  options: { hipBackM?: number; standoffM?: number } = {},
): SeatWalkAnchor {
  const hipBack = options.hipBackM ?? 0.12;
  const standoff = options.standoffM ?? 0.45;
  const yaw = seatFacingRad(seat.rotationDeg);
  const baseX = seat.x;
  const baseZ = -seat.y;
  return {
    x: baseX - Math.sin(yaw) * hipBack,
    z: baseZ - Math.cos(yaw) * hipBack,
    yaw,
    standX: baseX - Math.sin(yaw) * (hipBack + standoff),
    standZ: baseZ - Math.cos(yaw) * (hipBack + standoff),
  };
}

/** 单个设施 → 座位目标；不可坐返回 null。 */
export function seatTargetOf(
  input: SeatFacilityInput,
  groundY = 0,
): SeatTarget | null {
  if (!isSeatFacility(input)) return null;
  const seatHeight = seatSurfaceHeight(input);
  return {
    id: input.id,
    name: input.name,
    x: input.position.x,
    y: input.position.y,
    rotationDeg: input.rotationDeg ?? 0,
    seatHeight,
    eyeY: groundY + seatHeight + SEATED_EYE_OFFSET,
  };
}

/** 一批设施里挑出可落座的座位目标。 */
export function seatFacilityTargets(
  facilities: readonly SeatFacilityInput[],
  groundY = 0,
): SeatTarget[] {
  return facilities
    .map(facility => seatTargetOf(facility, groundY))
    .filter((target): target is SeatTarget => target !== null);
}
