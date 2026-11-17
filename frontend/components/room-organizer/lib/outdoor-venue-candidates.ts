/**
 * 同名地点怎么选（轮次 55）。
 *
 * 验收用例 #2 是「两个同名地点，地图选中其中一个」。真实搜索要登录态跑不了，
 * 但「拿到两个同名候选之后该怎么办」是纯逻辑，可以先定死：
 *
 *   - 只有一个同名 → 就是它；
 *   - 有多个同名、且调用方给了点击位置 → 取最近的那个，但**并列就说不清**；
 *   - 有多个同名、没给位置 → 不猜，返回 ambiguous 并把人话问题交回去；
 *   - 一个都没有 → 明说没找到，不退回第一个。
 *
 * 这里的取舍很明确：宁可多问一句，也不要在同名里随便挑一个——
 * 挑错地点会让后面整份方案建在错的地方。
 */

export interface VenueCandidate {
  id: string;
  name: string;
  /** 平面坐标（米），与画布同一个坐标系。 */
  position: { x: number; y: number };
}

export interface VenueNear {
  x: number;
  y: number;
  /** 只在多大范围内算「点的是这个」，默认 30 米。 */
  radiusM?: number;
}

export type VenuePick =
  | { kind: "single"; candidate: VenueCandidate }
  | { kind: "none"; reason: string }
  | { kind: "ambiguous"; candidates: VenueCandidate[]; question: string };

const DEFAULT_RADIUS_M = 30;
/** 两个候选到点击点距离差小于这个值，就算「说不清是哪个」。 */
const TIE_EPS_M = 0.5;

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function describe(candidate: VenueCandidate): string {
  return `「${candidate.name}」(${candidate.position.x}, ${candidate.position.y})`;
}

export function pickVenueCandidate(
  candidates: readonly VenueCandidate[],
  request: { name: string; near?: VenueNear },
): VenuePick {
  const wanted = normalizeName(request.name);
  if (!wanted) return { kind: "none", reason: "没说地点名，先说要选哪个地点。" };

  const sameName = candidates.filter((c) => normalizeName(c.name) === wanted);
  if (sameName.length === 0) {
    return { kind: "none", reason: `地图上没有叫「${request.name.trim()}」的地点。` };
  }
  if (sameName.length === 1) return { kind: "single", candidate: sameName[0]! };

  const near = request.near;
  if (!near) {
    return {
      kind: "ambiguous",
      candidates: sameName,
      question: `地图上有 ${sameName.length} 个都叫「${request.name.trim()}」的地点：${sameName
        .map(describe)
        .join("、")}。在地图上点一下要用的那个。`,
    };
  }

  const radius = near.radiusM ?? DEFAULT_RADIUS_M;
  const scored = sameName
    .map((candidate) => ({ candidate, d: distance(candidate.position, near) }))
    .sort((a, b) => a.d - b.d);
  const closest = scored[0]!;
  if (closest.d > radius) {
    return {
      kind: "ambiguous",
      candidates: sameName,
      question: `点的地方离这几个同名地点都超过 ${radius} 米，确认一下要哪个：${sameName
        .map(describe)
        .join("、")}。`,
    };
  }
  const runnerUp = scored[1];
  if (runnerUp && Math.abs(runnerUp.d - closest.d) < TIE_EPS_M) {
    return {
      kind: "ambiguous",
      candidates: sameName,
      question: `这两个同名地点几乎重合，说不清点的是哪个：${describe(closest.candidate)}、${describe(
        runnerUp.candidate,
      )}。放大一点再点一次。`,
    };
  }
  return { kind: "single", candidate: closest.candidate };
}
