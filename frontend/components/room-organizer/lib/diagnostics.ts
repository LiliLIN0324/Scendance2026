/**
 * 一版提案里「哪几件没放进去、为什么」的结构化说法。
 * 以前只有一个 dropped 数字；这里把同因同名的件数合成一条，气泡和卡片都照着说，
 * 不再用一句「N 件放不下」把原因盖过去。
 */

export type DiagnosticCode =
  | 'OUT_OF_BOUNDS'
  | 'STRUCTURAL_COLLISION'
  | 'NO_SPOT'
  | 'CAPACITY_EXCEEDED'
  | 'UNKNOWN_MATERIAL';

export interface PlanDiagnostic {
  severity: 'error' | 'warning';
  code: DiagnosticCode;
  /** 这一条代表的件数（同一原因、同一批物料合并计数）。 */
  count: number;
  /** 涉及的物料名；没有名字时给 id。 */
  names: string[];
  /** 一句原因，接在「N 件没放进去：…（原因）」的括号里。 */
  message: string;
}

const REASON: Record<DiagnosticCode, string> = {
  OUT_OF_BOUNDS: '超出场地边界',
  STRUCTURAL_COLLISION: '压墙或立柱',
  NO_SPOT: '附近没有空位',
  CAPACITY_EXCEEDED: '超出场地容量',
  UNKNOWN_MATERIAL: '物料目录里没有这件',
};

export interface RejectedPiece {
  name: string;
  code: DiagnosticCode;
}

/** 逐件被拒的物料 → 按原因合并的诊断；件数如实累加，名字去重。 */
export function rejectedDiagnostics(rejected: readonly RejectedPiece[]): PlanDiagnostic[] {
  const groups = new Map<DiagnosticCode, { count: number; names: Set<string> }>();
  for (const piece of rejected) {
    const group = groups.get(piece.code) ?? { count: 0, names: new Set<string>() };
    group.count += 1;
    group.names.add(piece.name);
    groups.set(piece.code, group);
  }
  return [...groups].map(([code, group]) => ({
    severity: 'warning' as const,
    code,
    count: group.count,
    names: [...group.names],
    message: REASON[code],
  }));
}

/** 同一版里分几步摆：同原因的件数并到一条，别让气泡里出现两遍「压墙或立柱」。 */
export function mergeDiagnostics(
  current: readonly PlanDiagnostic[],
  added: readonly PlanDiagnostic[],
): PlanDiagnostic[] {
  const merged = new Map<string, PlanDiagnostic>();
  for (const diagnostic of [...current, ...added]) {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, { ...diagnostic, names: [...diagnostic.names] }); continue; }
    existing.count += diagnostic.count;
    existing.severity = existing.severity === 'error' || diagnostic.severity === 'error' ? 'error' : 'warning';
    for (const name of diagnostic.names) if (!existing.names.includes(name)) existing.names.push(name);
  }
  return [...merged.values()];
}

export function summarizeDiagnostics(diagnostics: readonly PlanDiagnostic[]): {
  pieces: number;
  errors: number;
  warnings: number;
  byCode: Partial<Record<DiagnosticCode, number>>;
} {
  const byCode: Partial<Record<DiagnosticCode, number>> = {};
  let pieces = 0, errors = 0, warnings = 0;
  for (const diagnostic of diagnostics) {
    pieces += diagnostic.count;
    if (diagnostic.severity === 'error') errors += diagnostic.count;
    else warnings += diagnostic.count;
    byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + diagnostic.count;
  }
  return { pieces, errors, warnings, byCode };
}

/** 卡片和气泡共用的一句话；没有诊断就返回 null，调用方照旧走老的 dropped 文案。 */
export function describeDiagnostics(diagnostics: readonly PlanDiagnostic[]): string | null {
  const { pieces } = summarizeDiagnostics(diagnostics);
  if (!pieces) return null;
  const names = [...new Set(diagnostics.flatMap(diagnostic => diagnostic.names))];
  const reasons = [...new Set(diagnostics.map(diagnostic => diagnostic.message))];
  const who = names.length
    ? `${names.slice(0, 4).join('、')}${names.length > 4 ? ' 等' : ''}`
    : '物料';
  return `${pieces} 件没放进去：${who}${reasons.length ? `（${reasons.join('；')}）` : ''}`;
}
