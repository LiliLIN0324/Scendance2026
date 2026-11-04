import { z } from 'zod';

/**
 * 第 8 批「agent 自律」——本地编排回路。
 *
 * 背景：主轨上 agent 会一口气回一大段、跟同一个错误死磕、静默空转。
 * 本件在本地加三道刹车，不依赖大模型自觉：
 *
 *   1. ToolSpec 单源：宏工具参数契约统一用 zod 声明（strict 拒未知键）；
 *   2. DampingTable 三级阻尼：同一参数失败两次就换思路，回滚四次就停下；
 *   3. Governor 轮闸：单 job 最多 40 轮，连续 3 轮没有写入就 nudge，机械账本兜底。
 *
 * 本文件不调任何网络 / 大模型；工具"真的执行"由后续命令门接线，这里只做契约与账本。
 * 受众视角 U6：聊天框里能看到 agent 自述「第 N 次尝试、换了思路」，且任务必然在轮限内结束。
 */

/* ================= 1. ToolSpec 单源 ================= */

/** 一个宏工具的完整声明：名字 + 给模型看的中文说明 + zod 参数契约。 */
export interface ToolSpec<TParams> {
  name: string;
  /** 给模型看的中文说明（不出英文错误码）。 */
  description: string;
  /** strict 契约：未知字段直接拒绝。 */
  schema: z.ZodType<TParams>;
}

/** 公共字段：区域名不能为空。 */
const zoneField = z
  .string({ message: 'zone 必须是非空字符串' })
  .trim()
  .min(1, { message: 'zone 不能为空' });

/** 正整数（桌数 / 椅子数 / 人数），拒绝字符串、0、负数、小数。 */
const positiveInt = (label: string) =>
  z
    .number({ message: `${label} 必须是正整数，不能传字符串` })
    .int({ message: `${label} 必须是整数` })
    .refine((v) => v > 0, { message: `${label} 至少为 1` });

/** 正数（米）：舞台宽深。 */
const positiveMeter = (label: string) =>
  z
    .number({ message: `${label} 必须是数字（米），不能传字符串` })
    .refine((v) => Number.isFinite(v), { message: `${label} 必须是有限数字` })
    .refine((v) => v > 0, { message: `${label} 必须是正数` });

/* ---------- 4 个宏工具的契约（只声明，不执行） ---------- */

const layBanquetSchema = z
  .object({
    zone: zoneField,
    spec: z
      .object({
        tables: positiveInt('tables'),
        chairsPerTable: positiveInt('chairsPerTable'),
        shape: z.enum(['round', 'rect'], { message: 'shape 只能是 round 或 rect' }),
      })
      .strict(),
  })
  .strict();

const buildStageSchema = z
  .object({
    size: z
      .object({
        width: positiveMeter('width'),
        depth: positiveMeter('depth'),
      })
      .strict(),
    facing: z.enum(['north', 'south', 'east', 'west'], {
      message: 'facing 只能是 north / south / east / west',
    }),
  })
  .strict();

const arrangeSeatingSchema = z
  .object({
    zone: zoneField,
    count: positiveInt('count'),
  })
  .strict();

const scatterDecorSchema = z
  .object({
    zone: zoneField,
    // density 显式拒绝字符串（不做隐式 Number() 转换），越界给 example。
    density: z
      .number({ message: 'density 必须是 0 到 1 之间的数字，例如 0.6；你传的是字符串' })
      .refine((v) => v >= 0 && v <= 1, {
        message: 'density 必须是 0 到 1 之间的数字，例如 0.6',
      }),
    seed: z
      .number({ message: 'seed 必须是整数' })
      .int({ message: 'seed 必须是整数' })
      .optional(),
  })
  .strict();

export const layBanquetSpec: ToolSpec<z.infer<typeof layBanquetSchema>> = {
  name: 'layBanquet',
  description: '在指定区域布置宴会桌：一次给出桌数、每桌椅子数、圆桌还是长桌。',
  schema: layBanquetSchema,
};

export const buildStageSpec: ToolSpec<z.infer<typeof buildStageSchema>> = {
  name: 'buildStage',
  description: '按宽深尺寸搭一个舞台，并指定朝向（north / south / east / west）。',
  schema: buildStageSchema,
};

export const arrangeSeatingSpec: ToolSpec<z.infer<typeof arrangeSeatingSchema>> = {
  name: 'arrangeSeating',
  description: '在指定区域安排若干座位（人数至少为 1）。',
  schema: arrangeSeatingSchema,
};

export const scatterDecorSpec: ToolSpec<z.infer<typeof scatterDecorSchema>> = {
  name: 'scatterDecor',
  description: '在指定区域按密度 0~1 撒装饰摆件，可给随机种子复现布局。',
  schema: scatterDecorSchema,
};

/* ---------- 宏工具注册表 ---------- */

const registry = new Map<string, ToolSpec<unknown>>();

/** 注册一个宏工具（内置 4 个在模块底自注册；自定义工具由调用方追加）。 */
export function registerTool<TParams>(spec: ToolSpec<TParams>): void {
  registry.set(spec.name, spec as ToolSpec<unknown>);
}

/** 按名字取回宏工具；未注册返回 undefined。 */
export function getTool(name: string): ToolSpec<unknown> | undefined {
  return registry.get(name);
}

/** 列出全部已注册工具名。 */
export function listToolNames(): string[] {
  return [...registry.keys()];
}

registerTool(layBanquetSpec);
registerTool(buildStageSpec);
registerTool(arrangeSeatingSpec);
registerTool(scatterDecorSpec);

/* ================= 2. DampingTable 三级阻尼 ================= */

export type DampingDecision = 'ALLOW' | 'STOP_RETRY' | 'STOP_HARD';

export const DAMPING_STOP_RETRY_MESSAGE = '这个位置我已经试过两次不行，换个摆法';
export const DAMPING_STOP_HARD_MESSAGE = '这个任务我已经回滚 4 次，先停下来等你确认';

/**
 * 同一把"规范化参数钥匙"失败计数。
 * 钥匙由调用方拼成 `工具名 + ":" + JSON.stringify(规范化参数)`，
 * 保证同一个换汤不换药的重试会被识别为同一个 key。
 */
export class DampingTable {
  private readonly failuresByKey = new Map<string, number>();
  private rollbackCount = 0;

  /** 记录一次工具调用失败。 */
  recordFailure(key: string, _message: string): void {
    this.failuresByKey.set(key, (this.failuresByKey.get(key) ?? 0) + 1);
  }

  /** 同一 key 已失败次数。 */
  failures(key: string): number {
    return this.failuresByKey.get(key) ?? 0;
  }

  /**
   * 每轮尝试前问一次：
   * - 回滚 ≥4 次 → STOP_HARD（硬停，等人确认）；
   * - 同 key 失败 ≥2 次 → STOP_RETRY（换思路，别再撞同一堵墙）；
   * - 否则 ALLOW。
   */
  decide(key: string): DampingDecision {
    if (this.rollbackCount >= 4) return 'STOP_HARD';
    if ((this.failuresByKey.get(key) ?? 0) >= 2) return 'STOP_RETRY';
    return 'ALLOW';
  }

  /** 记一次回滚（agent 把上一步撤掉重摆）。 */
  recordRollback(): void {
    this.rollbackCount += 1;
  }

  rollbacks(): number {
    return this.rollbackCount;
  }
}

/* ================= 3. Governor 轮闸 ================= */

export interface GovernorPolicy {
  /** 单 job 最大轮数，默认 40。 */
  maxTurns: number;
  /** 连续多少轮没有任何写入工具调用就 nudge，默认 3。 */
  silentTurnLimit: number;
}

export const GOVERNOR_DEFAULT_POLICY: GovernorPolicy = {
  maxTurns: 40,
  silentTurnLimit: 3,
};

export const SILENT_NUDGE_MESSAGE = '连续 3 轮没有实际改动，要不要先把现有方案给你看一眼？';
export const TURN_LIMIT_MESSAGE = '已经跑满 40 轮，先停下来汇报当前结果';

/** 机械账本：不依赖摘要模型，纯本地计数。 */
export interface GovernorLedger {
  orderSummary: string;
  toolCallCount: number;
  writes: number;
  turn: number;
}

/**
 * 每个 agent job 一个 Governor 实例：
 * - turn() 每轮自增；
 * - recordToolCall(didWrite) 记一次工具调用，写入类工具才清零空转计数；
 * - tick() 每轮末尾问一次要不要 nudge；
 * - shouldStop() 到轮限必须终止，由调用方打断循环。
 */
export class Governor {
  private readonly policy: GovernorPolicy;
  private readonly orderSummary: string;
  private turnCount = 0;
  private toolCallCount = 0;
  private writes = 0;
  private silentStreak = 0;
  private turnHadWrite = false;

  constructor(orderSummary: string, policy?: Partial<GovernorPolicy>) {
    this.orderSummary = orderSummary;
    this.policy = { ...GOVERNOR_DEFAULT_POLICY, ...policy };
  }

  /** 进入新一轮。 */
  turn(): void {
    this.turnCount += 1;
    this.turnHadWrite = false;
  }

  /** 记一次工具调用；didWrite=true 表示这一轮产生了画布写入。 */
  recordToolCall(didWrite: boolean): void {
    this.toolCallCount += 1;
    if (didWrite) {
      this.writes += 1;
      this.turnHadWrite = true;
    }
  }

  /** 每轮末尾调用：连续 silentTurnLimit 轮没写入就回 nudge 文案，否则 null。 */
  tick(): string | null {
    if (this.turnHadWrite) {
      this.silentStreak = 0;
    } else {
      this.silentStreak += 1;
    }
    if (this.silentStreak >= this.policy.silentTurnLimit) {
      return SILENT_NUDGE_MESSAGE;
    }
    return null;
  }

  /** 是否必须终止（跑满轮限）。 */
  shouldStop(): boolean {
    return this.turnCount >= this.policy.maxTurns;
  }

  /** 终止时给用户看的收尾文案；未到轮限返回 null。 */
  stopMessage(): string | null {
    return this.shouldStop() ? TURN_LIMIT_MESSAGE : null;
  }

  /** 机械账本：订单摘要 + 工具调用计数，不依赖大模型。 */
  ledger(): GovernorLedger {
    return {
      orderSummary: this.orderSummary,
      toolCallCount: this.toolCallCount,
      writes: this.writes,
      turn: this.turnCount,
    };
  }
}
