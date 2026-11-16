/**
 * 人物动作状态解析（纯函数层，零 three 依赖，便于单测）。
 *
 * 规则口径：
 * - 请求动作在素材里没有对应 clip 时回退 idle；idle 也缺则返回 null（保持当前姿态，
 *   不切低模、不播空动作）。
 * - walk 是人流动线覆盖态，由注册表 follower 每帧决定，不走这里的静态解析。
 * - wave / emote 是一次性动作预留位；素材与重定向链路到位后接入「播完回到基础循环态」。
 */
import type { PersonAction } from './types';

/** 动作 → clip 句柄映射；纯函数层不关心句柄真实类型，只判空。 */
export type PersonActionClips = Partial<Record<PersonAction, unknown>>;

/** 请求动作是否有可播片段。 */
export function personActionHasClip(action: PersonAction, clips: PersonActionClips): boolean {
  return Boolean(clips[action]);
}

/**
 * 解析请求动作最终能播的循环态：缺片段回退 idle，idle 也缺返回 null。
 * 一次性动作（wave/emote）无片段时同样回退，不强行播放空动作。
 */
export function resolvePersonAction(
  requested: PersonAction,
  clips: PersonActionClips,
): PersonAction | null {
  if (personActionHasClip(requested, clips)) return requested;
  if (personActionHasClip('idle', clips)) return 'idle';
  return null;
}

/** 循环态集合：在 idle/talk/walk/sit 之间常驻切换。 */
export const LOOP_PERSON_ACTIONS: readonly PersonAction[] = ['idle', 'talk', 'walk', 'sit'] as const;

/** 一次性动作集合（进入后播完回到基础循环态）。 */
export const ONE_SHOT_PERSON_ACTIONS: readonly PersonAction[] = ['wave', 'emote'] as const;

/** 是否常驻循环态。 */
export function isLoopAction(action: PersonAction): boolean {
  return LOOP_PERSON_ACTIONS.includes(action);
}

/** 是否一次性动作。 */
export function isOneShotAction(action: PersonAction): boolean {
  return ONE_SHOT_PERSON_ACTIONS.includes(action);
}
