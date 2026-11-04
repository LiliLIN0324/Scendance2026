import { describe, expect, it, vi } from 'vitest';
import {
  DampingTable,
  Governor,
  getTool,
  listToolNames,
  registerTool,
  type ToolSpec,
} from './agent-governance';
import { z } from 'zod';

/**
 * 第 8 批「agent 自律」本地编排回路测试。
 *
 * 全程不碰网络、不碰大模型：用一个假的"模型回合"循环（spy 计数执行器）
 * 模拟 agent 连续犯同样错误、回滚、空转、跑满轮限四种场景。
 */

/* ---------- 工具注册表 ---------- */

describe('宏工具注册表', () => {
  it('内置 4 个宏工具已自注册，名字可枚举可取回', () => {
    expect(listToolNames().sort()).toEqual(
      ['arrangeSeating', 'buildStage', 'layBanquet', 'scatterDecor'].sort(),
    );
    for (const name of listToolNames()) {
      const spec = getTool(name);
      expect(spec).toBeDefined();
      expect(spec!.name).toBe(name);
      expect(spec!.description.length).toBeGreaterThan(0);
    }
  });

  it('registerTool 可追加自定义工具并按名取回', () => {
    const spec: ToolSpec<{ q: number }> = {
      name: 'probeDecor',
      description: '测试用探针工具',
      schema: z.object({ q: z.number() }).strict(),
    };
    registerTool(spec);
    expect(getTool('probeDecor')!.name).toBe('probeDecor');
    expect(getTool('not-exist')).toBeUndefined();
  });
});

/* ---------- zod 契约 ---------- */

describe('宏工具 zod 契约', () => {
  it('scatterDecor 传 density=1.5 → 失败，消息含「0 到 1」与 example', () => {
    const spec = getTool('scatterDecor')!;
    const r = spec.schema.safeParse({ zone: 'main', density: 1.5 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message).join(' | ');
      expect(msgs).toContain('0 到 1');
      expect(msgs).toContain('例如 0.6');
    }
  });

  it('scatterDecor 传 density="0.5"（字符串）→ 失败（拒绝隐式转换）', () => {
    const spec = getTool('scatterDecor')!;
    const r = spec.schema.safeParse({ zone: 'main', density: '0.5' });
    expect(r.success).toBe(false);
  });

  it('scatterDecor 合法调用（含可选 seed）通过', () => {
    const spec = getTool('scatterDecor')!;
    expect(spec.schema.safeParse({ zone: 'main', density: 0.6 }).success).toBe(true);
    expect(spec.schema.safeParse({ zone: 'main', density: 0.6, seed: 7 }).success).toBe(true);
  });

  it('layBanquet 多传未声明字段 foo → strict 模式失败', () => {
    const spec = getTool('layBanquet')!;
    const r = spec.schema.safeParse({
      zone: 'main',
      spec: { tables: 10, chairsPerTable: 8, shape: 'round' },
      foo: 1,
    });
    expect(r.success).toBe(false);
  });

  it('layBanquet shape 传「square」→ 失败', () => {
    const spec = getTool('layBanquet')!;
    const r = spec.schema.safeParse({
      zone: 'main',
      spec: { tables: 10, chairsPerTable: 8, shape: 'square' },
    });
    expect(r.success).toBe(false);
  });

  it('arrangeSeating count=0 → 失败（refine）', () => {
    const spec = getTool('arrangeSeating')!;
    expect(spec.schema.safeParse({ zone: 'main', count: 0 }).success).toBe(false);
    expect(spec.schema.safeParse({ zone: 'main', count: 12 }).success).toBe(true);
  });

  it('buildStage facing 非四方位 → 失败', () => {
    const spec = getTool('buildStage')!;
    expect(
      spec.schema.safeParse({ size: { width: 8, depth: 4 }, facing: 'up' }).success,
    ).toBe(false);
    expect(
      spec.schema.safeParse({ size: { width: 8, depth: 4 }, facing: 'north' }).success,
    ).toBe(true);
  });
});

/* ---------- DampingTable 三级阻尼 ---------- */

describe('DampingTable', () => {
  it('新 key 首次失败 → ALLOW（不拦）', () => {
    const damp = new DampingTable();
    expect(damp.decide('fresh:{}')).toBe('ALLOW');
    damp.recordFailure('fresh:{}', '踩墙');
    expect(damp.failures('fresh:{}')).toBe(1);
    // 第 1 次失败后仍 ALLOW，第 2 次才拦
    expect(damp.decide('fresh:{}')).toBe('ALLOW');
  });

  it('不同 key 失败互不影响', () => {
    const damp = new DampingTable();
    damp.recordFailure('a:{}', 'x');
    damp.recordFailure('a:{}', 'y');
    expect(damp.decide('a:{}')).toBe('STOP_RETRY');
    expect(damp.decide('b:{}')).toBe('ALLOW');
  });

  it('回滚累加 4 次 → STOP_HARD，无视 key', () => {
    const damp = new DampingTable();
    for (let i = 0; i < 4; i++) damp.recordRollback();
    expect(damp.rollbacks()).toBe(4);
    expect(damp.decide('any-key')).toBe('STOP_HARD');
  });

  it('mock 回合循环：同一参数失败 2 次后第 3 次不再真正调执行器', () => {
    const gov = new Governor('婚宴 10 桌');
    const damp = new DampingTable();
    const execute = vi.fn();
    const params = { zone: 'main', spec: { tables: 10, chairsPerTable: 8, shape: 'round' as const } };

    for (let i = 0; i < 3; i++) {
      gov.turn();
      const key = `layBanquet:${JSON.stringify(params)}`;
      if (damp.decide(key) !== 'ALLOW') {
        // 阻尼拦截：直接记一次非写入轮，不再碰执行器
        gov.recordToolCall(false);
        continue;
      }
      execute(params);
      damp.recordFailure(key, '桌子压到主通道');
      gov.recordToolCall(false);
    }

    // 只真的执行了前 2 次，第 3 次被 damping 拦下
    expect(execute).toHaveBeenCalledTimes(2);
    expect(damp.decide(`layBanquet:${JSON.stringify(params)}`)).toBe('STOP_RETRY');
  });
});

/* ---------- Governor 轮闸 ---------- */

describe('Governor', () => {
  it('连续 3 轮 didWrite=false → tick() 返回非空 nudge 文案', () => {
    const gov = new Governor('婚宴 10 桌');
    let nudge: string | null = null;
    for (let i = 0; i < 3; i++) {
      gov.turn();
      gov.recordToolCall(false);
      nudge = gov.tick();
    }
    expect(nudge).not.toBeNull();
    expect(nudge).toContain('连续 3 轮没有实际改动');
  });

  it('中间有一次写入 → 空转计数清零，不 nudge', () => {
    const gov = new Governor('婚宴 10 桌');
    const nudges: Array<string | null> = [];
    // 两轮空转
    for (let i = 0; i < 2; i++) {
      gov.turn();
      gov.recordToolCall(false);
      nudges.push(gov.tick());
    }
    // 一轮写入
    gov.turn();
    gov.recordToolCall(true);
    nudges.push(gov.tick());
    // 再两轮空转
    for (let i = 0; i < 2; i++) {
      gov.turn();
      gov.recordToolCall(false);
      nudges.push(gov.tick());
    }
    expect(nudges.every((n) => n === null)).toBe(true);
  });

  it('turn 到 40 → shouldStop()=true，循环不会走到第 41 次', () => {
    const gov = new Governor('婚宴 10 桌');
    let turns = 0;
    while (!gov.shouldStop()) {
      gov.turn();
      gov.recordToolCall(true);
      gov.tick();
      turns++;
    }
    expect(turns).toBe(40);
    expect(gov.shouldStop()).toBe(true);
    expect(gov.stopMessage()).toContain('跑满 40 轮');
  });

  it('ledger() 的 toolCallCount / writes / turn 与手动注入次数一致', () => {
    const gov = new Governor('婚宴 10 桌');
    gov.turn();
    gov.recordToolCall(true);
    gov.tick();
    gov.turn();
    gov.recordToolCall(false);
    gov.tick();
    gov.turn();
    gov.recordToolCall(true);
    gov.tick();
    const ledger = gov.ledger();
    expect(ledger.orderSummary).toBe('婚宴 10 桌');
    expect(ledger.toolCallCount).toBe(3);
    expect(ledger.writes).toBe(2);
    expect(ledger.turn).toBe(3);
  });

  it('ledger() 是纯本地账本：字段固定、无函数无网络痕迹', () => {
    const gov = new Governor('年会舞台');
    gov.turn();
    gov.recordToolCall(true);
    gov.tick();
    const ledger = gov.ledger();
    expect(Object.keys(ledger).sort()).toEqual(
      ['orderSummary', 'toolCallCount', 'turn', 'writes'].sort(),
    );
    expect(JSON.parse(JSON.stringify(ledger))).toEqual(ledger);
  });
});
