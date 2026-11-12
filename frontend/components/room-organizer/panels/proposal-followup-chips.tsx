'use client';

/**
 * 方案预览卡的「人话边界一行」+「可点续问 chip」。
 * - BoundaryLine：从 plan 已有字段拼出一句给人看的「这版干了什么、哪里妥协了」，
 *   不是技术枚举；按严重度分支，warn 优先于 ok。挂在座位条下面，一眼能看到。
 * - FollowupChips：2-4 个可点 chip，点一下 = 把对应指令预填进 composer（onPrefill），
 *   不发送。文案按当前状态分支（short 才出加座类，ok 才出换摆法类）。
 *   挂在「撤回/换一版」那排 chip 附近，不抢「确认布置」主钮的视觉位置。
 * 不新增后端字段，只消费 ProposalCard 已经算好的派生量 + plan 上一两个已有字段。
 */
import './proposal-followup-chips.css';

/**
 * 这两个组件实际只读 plan.overlapCount 与 plan.blocked；
 * 其他量都从 BoundaryContext 来。用结构类型，避免和 PlanProposal / ProposalView
 * 这类完整 proposal 类型硬绑（后者在不同构建里字段不同）。
 */
export interface FollowupPlan {
  overlapCount: number;
  blocked: string | null;
}

/** ProposalCard 已经算好的派生量，避免在这边重复算。 */
export interface BoundaryContext {
  guests: number;
  seats: number;
  short: boolean;
  banquet: boolean;
  review: boolean;
}

export interface BoundaryLine {
  text: string;
  tone: 'ok' | 'warn';
}

/**
 * 按严重度从高到低挑一句人话。返回 null 表示这版没什么需要额外说的
 * （已有 ap-warn-line / ap-outcome 已把话说完了）。
 */
export function buildBoundaryLine(plan: FollowupPlan, ctx: BoundaryContext): BoundaryLine | null {
  // 1. 硬卡：过不了几何闸。blocked 已经有专门一行，这里不重复，跳过。
  // 2. 重叠：确认前先挪。
  if (plan.overlapCount > 0) {
    return {
      text: ctx.review
        ? `这版改完还剩 ${plan.overlapCount} 件挤在一起，确认前先把它们挪开。`
        : `这版有 ${plan.overlapCount} 件挤在一起，确认前先挪开它们。`,
      tone: 'warn',
    };
  }
  // 3. 座位不够：说人话，给两条出路。
  if (ctx.short) {
    const gap = ctx.guests - ctx.seats;
    if (ctx.banquet) {
      return {
        text: `这版按现有场地排到 ${ctx.seats} 座，还差 ${gap}——可以加座再排，或把桌数压一压。`,
        tone: 'warn',
      };
    }
    return {
      text: `这版按现有场地最多排了 ${ctx.seats} 座，还差 ${gap}——可以加座，或把规模压一压。`,
      tone: 'warn',
    };
  }
  // 4. 改法预览（体检改的）：只挪位置，不增不删。
  if (ctx.review) {
    return {
      text: '这版只挪位置、不新增物料也不删，看完对了再确认。',
      tone: 'ok',
    };
  }
  // 5. 一切正常：一句定心丸。
  if (ctx.guests > 0 && ctx.seats >= ctx.guests) {
    return { text: '这版没踩墙、没重叠，座位按当前人数排满。', tone: 'ok' };
  }
  return null;
}

export interface FollowupChip {
  label: string;
  /** 预填进 composer 的指令文案；不发送。 */
  draft: string;
}

/**
 * 按状态挑 2-4 个续问 chip。short 时偏加座/缩规模；overlap 偏挪开；正常时偏换摆法。
 */
export function buildFollowupChips(plan: FollowupPlan, ctx: BoundaryContext): FollowupChip[] {
  const chips: FollowupChip[] = [];
  const canRegenerate = !ctx.review; // 改法预览不鼓励再换一版（那是体检的结果）
  if (ctx.short) {
    if (!/加不进更多/.test(plan.blocked ?? '')) {
      chips.push({ label: '加座，再排一版', draft: '加座，再排一版' });
    }
    chips.push({ label: '座位还差多少', draft: '座位还差多少？' });
  }
  if (plan.overlapCount > 0) {
    chips.push({ label: '先把重叠的挪开', draft: '把叠在一起的物料挪开' });
  }
  if (canRegenerate) {
    chips.push({ label: '换一版看看', draft: '换一版看看' });
  }
  if (ctx.guests > 0 && !ctx.short && !plan.overlapCount) {
    chips.push({ label: '把休息区挪到靠窗那侧', draft: '把休息区挪到靠窗那侧' });
  }
  // 最多 4 个。
  return chips.slice(0, 4);
}

/** 人话边界一行：挂在座位条下面。 */
export function BoundaryLineNote({ plan, ctx }: { plan: FollowupPlan; ctx: BoundaryContext }): JSX.Element | null {
  const boundary = buildBoundaryLine(plan, ctx);
  if (!boundary) return null;
  return <p className={`ap-boundary-line ap-boundary-${boundary.tone}`} role="note">
    <span aria-hidden="true" className="ap-boundary-dot"/>
    {boundary.text}
  </p>;
}

/** 续问 chip 排：挂在「撤回/换一版」附近。 */
export function FollowupChips({ plan, ctx, onPrefill }: {
  plan: FollowupPlan;
  ctx: BoundaryContext;
  onPrefill?: ((text: string) => void) | undefined;
}): JSX.Element | null {
  const chips = buildFollowupChips(plan, ctx);
  if (chips.length === 0) return null;
  return <div className="ap-chips ap-followup-chips" role="group" aria-label="续问">
    {chips.map(chip => <button
      key={chip.label}
      type="button"
      className="chip btn-outline"
      onClick={() => onPrefill?.(chip.draft)}
    >{chip.label}</button>)}
  </div>;
}
