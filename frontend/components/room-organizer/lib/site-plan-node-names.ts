/**
 * 出入口自动编号（2026-11-15 用户：入口改成出口要自动改名；三种类型各自从 1 开始排号）。
 *
 * 口径：
 * - 自动名 = `类型文案 + 空格 + 数字`（`入口 1` / `出口 2` / `出入口 3`）；
 * - **入口 / 出口 / 出入口 各有一套编号，都从 1 起连续排**：新号取该类型当前最小空号，
 *   删掉中间某个点后新放的点会补上这个号，不出现断号；
 * - 换类型时按**目标类型**重新取号：`入口 5` 改成出口、而这是第一个出口 → `出口 1`
 *   （不把入口的号带过去，否则出口序列会从 5 开始跳）；
 * - 只改「看起来就是自动名」的那些（正则命中）。用户手改过的名字（`西门`、`北门临时口`）
 *   一律原样保留——改名不能吃掉用户的命名；
 * - 撞名兜底：目标号已被任何点位占用（含用户手改出的同名）就顺延到下一个空号。
 *
 * 纯函数：不碰画布，也不改 plan；调用方决定是否写回。
 */

import type { PlanNode } from '../../../../supabase/functions/_shared/site-plan';
import { PLAN_NODE_KIND_LABELS } from './site-plan-inventory';

type NodeKind = PlanNode['kind'];

/** 自动名形态：类型文案 + 数字。`出入口` 必须排在 `入口` 前面（子串优先）。 */
const AUTO_NODE_NAME = /^(出入口|入口|出口)\s*(\d+)$/;

/** 类型 → 中文文案（与清单/图例同一份）。 */
export function planNodeKindLabel(kind: NodeKind): string {
  return PLAN_NODE_KIND_LABELS[kind];
}

/** 这个名字是不是「入口 N」这类自动名（用户手改过的名字返回 false）。 */
export function isAutoNodeName(name: string): boolean {
  return AUTO_NODE_NAME.test(name.trim());
}

/** 解析自动名里的编号；非自动名返回 null。 */
export function autoNodeNameNumber(name: string): number | null {
  const match = AUTO_NODE_NAME.exec(name.trim());
  return match ? Number.parseInt(match[2]!, 10) : null;
}

/** 除自己之外，是否已经有人叫这个完整名字。 */
function nameTaken(nodes: readonly PlanNode[], name: string, exceptId?: string): boolean {
  const target = name.trim();
  return nodes.some(node => node.id !== exceptId && node.name.trim() === target);
}

/**
 * 该类型下一个可用编号：从 1 往上找第一个空号。
 * 空号 = 既没有被同类型的自动名占用，也没有被任何点位的同名占用。
 */
function nextNodeNumber(kind: NodeKind, nodes: readonly PlanNode[], exceptId?: string): number {
  const label = planNodeKindLabel(kind);
  const prefix = new RegExp(`^${label}\\s*(\\d+)$`);
  const used = new Set<number>();
  for (const node of nodes) {
    if (exceptId !== undefined && node.id === exceptId) continue;
    const match = prefix.exec(node.name.trim());
    if (match) used.add(Number.parseInt(match[1]!, 10));
  }
  let n = 1;
  while (used.has(n) || nameTaken(nodes, `${label} ${n}`, exceptId)) n += 1;
  return n;
}

/** 放新点位时的自动名：`入口 1` / `出口 3`（编号按类型各自从 1 连续排）。 */
export function autoNodeName(kind: NodeKind, nodes: readonly PlanNode[], exceptId?: string): string {
  return `${planNodeKindLabel(kind)} ${nextNodeNumber(kind, nodes, exceptId)}`;
}

/**
 * 换类型时的自动改名：按目标类型重新取号。
 * `入口 5` 改成出口、而这是第一个出口 → `出口 1`。
 * 非自动名（用户自己起的名字）原样返回。
 */
export function renamedNodeName(
  name: string,
  nextKind: NodeKind,
  nodes: readonly PlanNode[],
  selfId?: string,
): string {
  if (!isAutoNodeName(name)) return name;
  return autoNodeName(nextKind, nodes, selfId);
}
