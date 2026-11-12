/**
 * 户外 2D 平面 → Agent run 上下文快照（阶段 B3 一期，协议打通）。
 *
 * 口径与后端 `agentPlanObservationSchema`（supabase/functions/_shared/agent-contract.ts）对齐：
 * - plan 是 run 发起时刻 structuredClone 冻结的本机草稿，不是已核验场地事实；
 * - 只做只读上下文注入，不新增后端工具、不写盘；
 * - planHash 为规范化 plan 内容的 sha256 对账指纹；安全连接不可用时省略，不编造。
 */
import { z } from 'zod';
import { agentPlanObservationSchema, AGENT_PLAN_OBSERVATION_NOTICE } from '../../../../supabase/functions/_shared/agent-contract';
import type { PlanAnchor, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { canonicalJson } from './delivery-version';

/** 发起 run 时刻由前端采集到的户外平面截面（未附 notice，装配时补）。 */
export interface OutdoorPlanCapture {
  /** 冻结后的户外规划数据（调用方负责 structuredClone）。 */
  plan: SitePlanData;
  /** 地理锚点；无锚点时为 null。 */
  anchor: PlanAnchor | null;
  /** 当前户外选区 id（zone/facility/route/node/worker/annotation + 组选设施）；无选区为空数组。 */
  selected: string[];
  /** 规范化 plan 内容指纹；不可用时省略。 */
  planHash?: string;
}

export type AgentPlanObservation = z.infer<typeof agentPlanObservationSchema>;

/** 规范化 plan JSON 的 sha256 十六进制摘要；crypto.subtle 不可用时回 undefined。 */
export async function computePlanFingerprint(plan: SitePlanData): Promise<string | undefined> {
  if (typeof globalThis.crypto?.subtle !== 'object' || !globalThis.crypto.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(plan)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 把采集截面装配成契约形状的 planObservation；notice 走后端固定文案。 */
export function buildPlanObservation(capture: OutdoorPlanCapture): AgentPlanObservation {
  return {
    plan: capture.plan,
    ...(capture.anchor ? { anchor: capture.anchor } : { anchor: null }),
    ...(capture.selected.length ? { selected: capture.selected } : {}),
    ...(capture.planHash ? { planHash: capture.planHash } : {}),
    notice: AGENT_PLAN_OBSERVATION_NOTICE,
  };
}
