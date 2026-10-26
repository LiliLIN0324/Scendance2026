/**
 * T-01 场地真相：对话里确认尺度后出的「可布置壳体」——四面外墙、一个主入口、一个层高。
 * 只产出 SceneV2 数据，不碰画布；由 Agent 出方案那一步喂给 backendSceneToLayout。
 * 真相字段只有 `venue.height` + `venue.site.mainEntrance.openingId` + `indoorOutdoor`，
 * 不得另造 ceilingHeightM 这类平行字段（docs/AI-NATIVE-FOR-EXECUTORS.md §2 场地真相）。
 */
import { sceneV2Schema, type HeightSource, type SceneV2, type VenueSite } from '../../../../supabase/functions/_shared/domain';
import { MAX_ROOM_DIMENSION } from './constants';

/** 卡片钉死的层高兜底：用户没说层高就取这个数，并把 heightSource 标成 default。 */
export const VENUE_DEFAULT_HEIGHT_M = 4;
export const VENUE_MIN_DIMENSION_M = 1;
/** 待核：升级卡写 1–500 米，本版编辑器的场地上限是 `MAX_ROOM_DIMENSION`，这里按编辑器为准。 */
export const VENUE_MAX_DIMENSION_M = MAX_ROOM_DIMENSION;
export const VENUE_WALL_THICKNESS_M = 0.16;
export const VENUE_MAIN_ENTRANCE_WIDTH_M = 1.8;
export const VENUE_MAIN_ENTRANCE_HEIGHT_M = 2.2;

/**
 * 尺度是怎么来的：用户在话里说过、在卡片里填过、只给了面积折算、按图纸比例估的，
 * 还是根本没提（沿用画布当前大小）。confidence 由它决定，墙体证据状态也跟着走。
 */
export type ScaleOrigin = 'stated' | 'typed' | 'area' | 'plan' | 'canvas';

const SCALE_CONFIDENCE: Record<ScaleOrigin, 'high' | 'medium' | 'low'> = {
  stated: 'high', typed: 'high', area: 'medium', plan: 'medium', canvas: 'low',
};

const round1 = (value: number): number => Math.round(value * 10) / 10;
const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `venue-${Math.random().toString(16).slice(2, 10)}`);

/** 层高真相：给了就用给的（算人确认过），没给取默认 4.0 并如实标 default。 */
export function resolveVenueHeight(raw?: number | null): { heightM: number; heightSource: HeightSource } {
  if (raw === undefined || raw === null || !Number.isFinite(raw) || raw <= 0) return { heightM: VENUE_DEFAULT_HEIGHT_M, heightSource: 'default' };
  return { heightM: round1(raw), heightSource: 'confirmed' };
}

export interface VenueShellInput {
  widthM: number;
  depthM: number;
  indoorOutdoor: 'indoor' | 'outdoor';
  scaleOrigin: ScaleOrigin;
  /** 人确认过的净高（米）；不给就是默认 4.0。 */
  heightM?: number | null;
  entranceWidthM?: number;
}

/**
 * 出壳体。户外场地本期不假装有四堵墙：只出场地真相（尺寸 + 层高 + 室内外 + 尺度置信度），
 * 主入口留空——域约束要求它必须指向真实门窗，没有墙就没有门。
 */
export function buildVenueShell(input: VenueShellInput): SceneV2 {
  const width = round1(input.widthM);
  const depth = round1(input.depthM);
  const inRange = (value: number): boolean => value >= VENUE_MIN_DIMENSION_M && value <= VENUE_MAX_DIMENSION_M;
  if (!inRange(width) || !inRange(depth)) {
    throw new Error(`场地长宽要在 ${VENUE_MIN_DIMENSION_M}–${VENUE_MAX_DIMENSION_M} 米之间，先改一下卡片里的数字。`);
  }
  const { heightM, heightSource } = resolveVenueHeight(input.heightM);
  const confidence = SCALE_CONFIDENCE[input.scaleOrigin];
  // 只有人明确给过尺度才把外墙当确认事实；面积折算、图纸估算、沿用画布都还是推断。
  const wallStatus = confidence === 'high' ? 'confirmed' : 'inferred';
  const indoor = input.indoorOutdoor === 'indoor';

  const corners = [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
  const walls = indoor
    ? corners.map((start, index) => ({
        id: newId(), start, end: corners[(index + 1) % 4]!,
        thickness: VENUE_WALL_THICKNESS_M, height: heightM, kind: 'exterior' as const, status: wallStatus,
      }))
    : [];

  const entranceWidth = Math.min(input.entranceWidthM ?? VENUE_MAIN_ENTRANCE_WIDTH_M, Math.max(0.6, width - 0.4));
  // 主入口开在正面那堵墙（z = depth）正中，位置标 inferred：人要挪就在结构里挪。
  const frontWall = walls[2];
  const openings = frontWall
    ? [{
        id: newId(), wallId: frontWall.id, kind: 'door' as const,
        offset: Math.max(0, round1((width - entranceWidth) / 2)), width: entranceWidth,
        height: Math.min(VENUE_MAIN_ENTRANCE_HEIGHT_M, heightM), sillHeight: 0, status: 'inferred' as const,
      }]
    : [];

  const site: VenueSite = {
    ...(openings[0] ? { mainEntrance: { openingId: openings[0].id } } : {}),
    scale: { confidence },
    indoorOutdoor: input.indoorOutdoor,
  };

  return sceneV2Schema.parse({
    schemaVersion: 2,
    venue: { shape: 'rectangle', width, depth, height: heightM, entrances: [], heightSource, site },
    objects: [],
    camera: 'overview',
    lighting: 'neutral',
    structure: { walls, openings, columns: [] },
    sources: [],
    dimensions: [
      { id: newId(), kind: 'width', valueMeters: width, status: 'inferred', label: '总宽' },
      { id: newId(), kind: 'depth', valueMeters: depth, status: 'inferred', label: '总长' },
      { id: newId(), kind: 'height', valueMeters: heightM, status: 'inferred', label: '净高' },
    ],
  });
}

/**
 * 主入口只能指着结构里真实存在的门窗。门洞被删掉或换过墙之后，保存时剪掉这条引用，
 * 保留室内外与尺度这些其它真相——不能拿它当错误把用户锁死在「无法保存」上。
 */
export function pruneVenueSite(site: VenueSite | undefined, openingIds: readonly string[]): VenueSite | undefined {
  if (!site?.mainEntrance || openingIds.includes(site.mainEntrance.openingId)) return site;
  const { mainEntrance: _dropped, ...rest } = site;
  return Object.keys(rest).length ? rest : undefined;
}
