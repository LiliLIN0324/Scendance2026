/**
 * 监督档位：agent 动手前要不要先问过用户。
 *
 * 对标谷地工坊的「需要我多久跟你确认一次？」——把「确认」从一次性的设置项
 * 变成可调的档位，用户按自己的放心程度选，而不是替所有人写死一套。
 *
 * 三档的口径（不按模型说辞判，只按**动作性质**判）：
 * - strict   严格：凡是会改画布的动作（含普通写入）都先问；
 * - key-points 关键节点：只有「破坏性」与「大范围」动作才问，普通写入照跑；
 * - auto     自动：都不问，但照样记进决策留痕，事后可回看。
 *
 * 判定用到的两个事实必须来自调用方已有的真值：动作类别 + 影响件数。
 * 拿不到件数就按「未知」处理——未知不算大范围，但破坏性仍然要问
 * （宁可在关键节点多问一句，也不拿「不知道」当成「没影响」）。
 */

export type SupervisionLevel = 'strict' | 'key-points' | 'auto';

/** 动作性质：只读 / 普通写入 / 破坏性（删、清空、覆盖既有物件）/ 大范围批量写入。 */
export type AgentActionKind = 'read' | 'write' | 'destructive' | 'bulk';

export interface SupervisionLevelInfo {
  id: SupervisionLevel;
  /** 档位名，直接当按钮文案。 */
  label: string;
  /** 一行说明：这一档到底在什么时候问。 */
  detail: string;
  /** 短标签：塞进运行态头部时不占行。 */
  short: string;
}

/** 大范围阈值：一次动作影响超过这个件数就按 bulk 处理。 */
export const BULK_THRESHOLD = 100;

export const SUPERVISION_LEVELS: readonly SupervisionLevelInfo[] = Object.freeze([
  {
    id: 'strict',
    label: '严格',
    short: '每步都问',
    detail: '每一处改动画布的动作都先征求你的同意。',
  },
  {
    id: 'key-points',
    label: '关键节点',
    short: '关键处问',
    detail: '在计划步骤和大范围改动前询问。',
  },
  {
    id: 'auto',
    label: '自动',
    short: '先做后看',
    detail: '不再打断，改动照常记进留痕，事后可看可撤。',
  },
]);

export function supervisionLevelInfo(level: SupervisionLevel): SupervisionLevelInfo {
  return SUPERVISION_LEVELS.find((item) => item.id === level) ?? SUPERVISION_LEVELS[1]!;
}

export function supervisionLabel(level: SupervisionLevel): string {
  return supervisionLevelInfo(level).label;
}

/**
 * 读数收敛：界面存的是字符串（localStorage / 旧版本残留），
 * 认不出来的值一律回落到「关键节点」——默认比「自动」更保守。
 */
export function normalizeSupervision(value: string | null | undefined): SupervisionLevel {
  const found = SUPERVISION_LEVELS.find((item) => item.id === value);
  return found ? found.id : 'key-points';
}

/** 判定结果：要不要问、为什么问（原因要能原样念给用户听）。 */
export interface SupervisionGate {
  required: boolean;
  /** 需要确认时的一句话理由；不需要时为空串。 */
  why: string;
}

function isBulk(kind: AgentActionKind, affectedCount: number | undefined): boolean {
  if (kind === 'bulk') return true;
  return kind === 'write' && typeof affectedCount === 'number' && affectedCount > BULK_THRESHOLD;
}

/**
 * 这一次动作要不要先问。
 *
 * 只读动作任何档位都不问——问「能不能看一眼」只会把确认磨成噪音，
 * 真出事时用户反而不再细看。
 */
export function gateAction(
  level: SupervisionLevel,
  action: { kind: AgentActionKind; affectedCount?: number | undefined; label?: string | undefined },
): SupervisionGate {
  if (action.kind === 'read') return { required: false, why: '' };
  const label = action.label?.trim() || '这处改动';
  const bulk = isBulk(action.kind, action.affectedCount);

  if (level === 'auto') return { required: false, why: '' };

  if (action.kind === 'destructive') {
    return { required: true, why: `${label}会覆盖或删除画布上已有的东西，先确认再动手。` };
  }

  if (bulk) {
    const count = typeof action.affectedCount === 'number' ? `约 ${action.affectedCount} 件` : '大范围';
    return { required: true, why: `${label}影响${count}，属于大范围改动，先确认再动手。` };
  }

  if (level === 'strict') {
    return { required: true, why: `${label}会写入画布，严格档下每步都先问你。` };
  }

  // 关键节点档：普通写入直接执行。
  return { required: false, why: '' };
}
