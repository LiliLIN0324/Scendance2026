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
/**
 * 立墙的上界跟着编辑器（`MAX_ROOM_DIMENSION`），比 `workbench-agent` 的输入口径 500 米更严：
 * 说了 200×150 会在这里被挡下，所以错误文案要报出上界，并给一句能直接说出口的下一步。
 */
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
  /**
   * 地图圈画的本地米制轮廓（≥3 点）。有点列则立真轮廓多边形壳；
   * 无点列才退化为轴对齐矩形。点须落在 [0,width]×[0,depth]。
   */
  polygonMeters?: ReadonlyArray<{ x: number; z: number }>;
}

/**
 * 出壳体。户外场地本期不假装有四堵墙：只出场地真相（尺寸 + 层高 + 室内外 + 尺度置信度），
 * 主入口留空——域约束要求它必须指向真实门窗，没有墙就没有门。
 */
export function buildVenueShell(input: VenueShellInput): SceneV2 {
  const width = round1(input.widthM);
  const depth = round1(input.depthM);
  if (width < VENUE_MIN_DIMENSION_M || depth < VENUE_MIN_DIMENSION_M) {
    throw new Error(`场地长宽至少 ${VENUE_MIN_DIMENSION_M} 米。说一句新的长宽，比如「12×9」，我按它出一版。`);
  }
  if (width > VENUE_MAX_DIMENSION_M || depth > VENUE_MAX_DIMENSION_M) {
    throw new Error(`这块场地最多立到 ${VENUE_MAX_DIMENSION_M} 米——再大画布撑不住。先说一句 ${VENUE_MAX_DIMENSION_M} 米以内的长宽，比如「80×60」，我按它出一版。`);
  }
  const { heightM, heightSource } = resolveVenueHeight(input.heightM);
  const confidence = SCALE_CONFIDENCE[input.scaleOrigin];
  // 只有人明确给过尺度才把外墙当确认事实；面积折算、图纸估算、沿用画布都还是推断。
  const wallStatus = confidence === 'high' ? 'confirmed' : 'inferred';
  const indoor = input.indoorOutdoor === 'indoor';

  const rawPoly = (input.polygonMeters ?? []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
  const unique = rawPoly.filter((p, i, arr) => arr.findIndex(q => q.x === p.x && q.z === p.z) === i);
  const usePolygon = unique.length >= 3;
  const polygon = usePolygon
    ? unique.map(p => ({
        x: Math.min(width, Math.max(0, round1(p.x))),
        z: Math.min(depth, Math.max(0, round1(p.z))),
      }))
    : undefined;
  // 无点列才用轴对齐矩形四角；有点列走真轮廓（即使碰巧是矩形也保留 polygon shape）。
  const corners = polygon ?? [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
  const walls = indoor
    ? corners.map((start, index) => ({
        id: newId(), start, end: corners[(index + 1) % corners.length]!,
        thickness: VENUE_WALL_THICKNESS_M, height: heightM, kind: 'exterior' as const, status: wallStatus,
      }))
    : [];

  const entranceWidth = Math.min(input.entranceWidthM ?? VENUE_MAIN_ENTRANCE_WIDTH_M, Math.max(0.6, width - 0.4));
  // 主入口：矩形壳开在正面（z = depth）；多边形壳开在最长边正中。
  let frontWall = walls[2];
  if (usePolygon && walls.length) {
    frontWall = walls.reduce((best, wall) => {
      const len = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
      const bestLen = Math.hypot(best.end.x - best.start.x, best.end.z - best.start.z);
      return len > bestLen ? wall : best;
    });
  }
  const frontLen = frontWall ? Math.hypot(frontWall.end.x - frontWall.start.x, frontWall.end.z - frontWall.start.z) : 0;
  const openings = frontWall && frontLen > 0.6
    ? [{
        id: newId(), wallId: frontWall.id, kind: 'door' as const,
        offset: Math.max(0, round1((frontLen - Math.min(entranceWidth, frontLen - 0.2)) / 2)),
        width: Math.min(entranceWidth, Math.max(0.6, frontLen - 0.2)),
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
    venue: {
      shape: usePolygon ? 'polygon' : 'rectangle',
      width, depth, height: heightM, entrances: [], heightSource, site,
      ...(usePolygon && polygon ? { polygon } : {}),
    },
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
