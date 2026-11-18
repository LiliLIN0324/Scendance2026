/**
 * 登录门白名单（M4 离线切片，2026-11-18）。
 *
 * 实测（2026-11-16 轮次 28，:3210 真浏览器、未登录）：范围确认后发
 * 「200 人市集，签到靠近入口，留出通道」零请求、zones 仍 0；发「帮我分区」输入框被禁，
 * 卡在「登录后继续这次选址」。而这两类句子的意图识别（matchZoneCommand /
 * parseOutdoorEventTurn / matchRouteCommand）和执行（讲座/市集几何模板、真实路网流线）
 * 本来就是本地确定性规则——模型在这条链上只负责「分类」，分类器已经本地化了，
 * 登录门把它们一并锁死属于误伤。
 *
 * 这里的白名单只收「零模型请求、零云端写入、纯本地可完成」的三类命令：
 *   1. 排流线/排入口（读真实路网出候选）
 *   2. 分区/排区域（含「自动分区」）
 *   3. 活动句「N 人 + 讲座/市集」（event + headcount 同时在场才认——只提活动类型不提
 *      人数的句子可能是物件微调等别的意图，仍走登录卡，不扩大误伤面）
 *
 * 不进白名单的：模型理解类需求、3D 生成/收费任务、导出评审等。这些未登录时仍由
 * use-outdoor-agent-workflow 的登录卡接住（四类阻塞分别可识别的口径不变）。
 *
 * 纯函数，可在 node 里直接测。
 */

import { matchRouteCommand } from "./route-proposal";
import { matchZoneCommand } from "./zone-event-proposal";
import { parseOutdoorEventTurn } from "./outdoor-event-turn";

/** 这句能否在未登录时由本地确定性路径直接完成（composer 放行 + panel 拦截共用同一个判定）。 */
export function matchesLocalOutdoorCommand(text: string, priorEvent: string | null): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (matchRouteCommand(trimmed, true)) return true;
  if (matchZoneCommand(trimmed)) return true;
  const turn = parseOutdoorEventTurn(trimmed, priorEvent);
  return turn !== null && turn.headcount != null;
}
