/**
 * 第 7.5 批「规划草案」指纹。
 *
 * 用途：「换一版计划」整份撤销标注后，用 planDraftFingerprint 断言草案内容已回到
 * 上一版（或空）状态；再配合 lib/layout-fingerprint.ts 的 layoutFingerprint 对
 * RoomLayout 做断言，证明规划层的反复横跳没有碰过一件家具。
 *
 * 与 layout-fingerprint 同一套 FNV-1a / 1e-6 规范化约定，避免两套哈希漂移。
 */
import type {
  LayoutPlanDraft,
  PlanAnnotation,
  PlanPoint,
} from './plan-annotation';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** 数字规范化到 1e-6，-0 归一成 0；缺值按 0 兜底。 */
function normalizeNumber(value: number | undefined): number {
  if (value === undefined || value === null || Number.isNaN(value)) return 0;
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function serializePoint(p: PlanPoint): string {
  return `${normalizeNumber(p.x)},${normalizeNumber(p.z)}`;
}

function serializeGeometry(a: PlanAnnotation): string {
  const g = a.geometry;
  switch (g.kind) {
    case 'rect':
      return `R(${normalizeNumber(g.x)},${normalizeNumber(g.z)},${normalizeNumber(g.width)},${normalizeNumber(g.depth)})`;
    case 'polyline':
      return `P(${g.points.map(serializePoint).join(';')})`;
    case 'measure':
      return `M(${serializePoint(g.from)};${serializePoint(g.to)})`;
    default:
      return `?${String(g)}`;
  }
}

/** 把单条标注压成稳定字符串（字段顺序固定）。 */
function serializeAnnotation(a: PlanAnnotation): string {
  return [
    a.id,
    a.kind,
    a.label,
    a.stageNo,
    serializeGeometry(a),
  ].join('|');
}

/** FNV-1a 32 位 → 8 位十六进制。 */
function fnv1aHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 草案指纹：stages 按 stageNo 排序、annotations 按 id 排序后串成稳定字符串。
 * draft.id 与 createdAt 不进指纹——「换一版」保留同一槽位时，只关心内容变没变。
 */
export function planDraftFingerprint(draft: LayoutPlanDraft): string {
  const stages = [...draft.stages].sort((a, b) => a.stageNo - b.stageNo);
  const annotations = [...draft.annotations].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const lines: string[] = [];
  for (const s of stages) {
    lines.push(
      `S${s.stageNo}|${s.title}|${s.rationale}|${[...s.annotationIds].sort().join(',')}`,
    );
  }
  for (const a of annotations) {
    lines.push(serializeAnnotation(a));
  }
  return fnv1aHex(lines.join('\n'));
}

/** 两份草案指纹是否一致。 */
export function planDraftsEqual(a: LayoutPlanDraft, b: LayoutPlanDraft): boolean {
  return planDraftFingerprint(a) === planDraftFingerprint(b);
}
