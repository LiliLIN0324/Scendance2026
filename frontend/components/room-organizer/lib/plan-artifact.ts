import type { CandidateTicket } from './confirmation-guard';
import type { RoomLayout } from './types';

/**
 * 一版候选项的身份：确认时不比对象引用，比「这一版是从哪块场地算出来的」。
 * 场地或候选内容一变（哪怕 reducer 换了新对象、或只挪了一厘米），旧身份就对不上；
 * 放太久也会过期。参照 Terraform saved plan 的「内嵌基线 + 按时效失效」。
 */

export const PLAN_TTL_MS = 10 * 60_000;

export interface PlanArtifactCounts {
  added: number;
  removed: number;
  moved: number;
  keptLocked: number;
  dropped: number;
  overlap: number;
}

export interface PlanArtifact {
  id: string;
  createdAt: number;
  expiresAt: number;
  ttlMs: number;
  /** 生成这一版时脚下的场地内容指纹。 */
  baseHash: string;
  /** 这一版最后要落盘的候选内容指纹。 */
  layoutHash: string;
  counts: PlanArtifactCounts;
  /** 已经确认过的版本不再接受第二次确认。 */
  appliedAt?: number;
  /** 确认时必须与当前需求版本一起核对；旧工件没有这张票据。 */
  confirmation?: CandidateTicket;
}

export type PlanObsoleteReason = 'stale-base' | 'expired' | 'layout-mismatch' | 'already-applied';

export type PlanApplicability = { ok: true } | { ok: false; reason: PlanObsoleteReason };

export const PLAN_OBSOLETE_COPY: Record<PlanObsoleteReason, string> = {
  'stale-base': '场景在这期间改过了',
  expired: '这版放太久，已经过期了',
  'layout-mismatch': '这版候选和要落盘的内容对不上',
  'already-applied': '这版已经确认过了',
};

const HASH_SCALE = 1000;

function quantize(value: number): number | string {
  if (!Number.isFinite(value)) return String(value);
  return Math.round(value * HASH_SCALE) / HASH_SCALE;
}

function stable(value: unknown): unknown {
  if (typeof value === 'number') return quantize(value);
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = stable(record[key]);
    return sorted;
  }
  return value;
}

/** cyrb53：同步、确定、无依赖；这里只需要稳定身份，不需要加密强度。 */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

/**
 * 只把会影响布置的内容算进指纹：场地尺寸/结构/楼层/物料。
 * 名字、底图透明度、相机构图、本地执行记录这些改了不算场地变。
 */
function planContent(layout: RoomLayout): unknown {
  return {
    width: layout.width,
    height: layout.height,
    roof: layout.roof,
    scenePreset: layout.scenePreset,
    backendVenue: layout.backendVenue,
    backendSceneV2: layout.backendSceneV2,
    floors: layout.floors.map(floor => ({
      name: floor.name,
      floorColor: floor.floorColor,
      floorPattern: floor.floorPattern,
      wallPattern: floor.wallPattern,
      wallColors: floor.wallColors,
      hiddenWalls: floor.hiddenWalls,
      interiorWalls: floor.interiorWalls,
      zones: floor.zones,
      height: floor.height,
      // 物料顺序不是内容；按 id 排，reducer 重排不会误判成场地变了。
      items: floor.items
        .map(item => {
          const { handoff: _handoff, ...content } = item;
          return content;
        })
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)),
    })),
  };
}

export function layoutContentHash(layout: RoomLayout): string {
  return hashText(JSON.stringify(stable(planContent(layout))));
}

const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export function makePlanArtifact(input: {
  base: RoomLayout;
  candidate: RoomLayout;
  counts?: Partial<PlanArtifactCounts>;
  ttlMs?: number;
  now?: number;
  id?: string;
}): PlanArtifact {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? PLAN_TTL_MS;
  return {
    id: input.id ?? newId(),
    createdAt: now,
    expiresAt: now + ttlMs,
    ttlMs,
    baseHash: layoutContentHash(input.base),
    layoutHash: layoutContentHash(input.candidate),
    counts: {
      added: 0, removed: 0, moved: 0, keptLocked: 0, dropped: 0, overlap: 0,
      ...input.counts,
    },
  };
}

/** 确认前的唯一判断：这版还是不是「从当前这块地长出来、且没过期」。 */
export function planIsApplicable(
  artifact: PlanArtifact,
  current: RoomLayout,
  now: number = Date.now(),
): PlanApplicability {
  if (artifact.appliedAt !== undefined) return { ok: false, reason: 'already-applied' };
  if (now >= artifact.expiresAt) return { ok: false, reason: 'expired' };
  if (layoutContentHash(current) !== artifact.baseHash) return { ok: false, reason: 'stale-base' };
  return { ok: true };
}

/** 落盘前再核一次：要写的那一版必须就是身份里记下的那一版。 */
export function planCoversLayout(artifact: PlanArtifact, candidate: RoomLayout): boolean {
  return layoutContentHash(candidate) === artifact.layoutHash;
}

export function markPlanApplied(artifact: PlanArtifact, now: number = Date.now()): PlanArtifact {
  return { ...artifact, appliedAt: now };
}
