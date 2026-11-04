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
  | 'UNKNOWN_MATERIAL'
  /** 这一块区按尺寸连一组家具都摆不下（脚本路径：座位区太窄、舞台横不下）。 */
  | 'ROLE_UNFIT'
  /** 落点压在通道或预留区上：丢掉，不挪。 */
  | 'KEEP_OUT';

export interface PlanDiagnostic {
  severity: 'error' | 'warning';
  code: DiagnosticCode;
  /** 这一条代表的件数（同一原因、同一批物料合并计数）。 */
  count: number;
  /** 涉及的物料名；没有名字时给 id。 */
  names: string[];
  /** 一句原因，接在「N 件没放进去：…（原因）」的括号里。 */
  message: string;
  /**
   * 座位口径的缺口：一件物料都没被拒（count 为 0），但这块地给不起要的那几个人。
   * 有了它，同一件事只按座说一次，不再换算成「没放进去 75 件」这种没人会数的件数。
   */
  seats?: number;
  /** 这块座位区给得起的座位上限，只在带 seats 的那条上出现。 */
  capacity?: number;
}

/** 每条原因的短说法：卡片和气泡都照这一句念，编译器也用它写 message。 */
export const DIAGNOSTIC_REASON: Record<DiagnosticCode, string> = {
  OUT_OF_BOUNDS: '超出场地边界',
  STRUCTURAL_COLLISION: '压墙或立柱',
  NO_SPOT: '附近没有空位',
  CAPACITY_EXCEEDED: '超出场地容量',
  UNKNOWN_MATERIAL: '物料目录里没有这件',
  ROLE_UNFIT: '这一区按尺寸摆不下这一组',
  KEEP_OUT: '压在通道或预留区上',
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
    message: DIAGNOSTIC_REASON[code],
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
    // 座位缺口跟着同一条原因累加；上限取两次里更大的那个，同一区的两次合并不会变。
    if (diagnostic.seats !== undefined) existing.seats = (existing.seats ?? 0) + diagnostic.seats;
    if (diagnostic.capacity !== undefined) existing.capacity = Math.max(existing.capacity ?? 0, diagnostic.capacity);
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
