import { CHARACTER_ANIMATION_PRESETS } from './character-generate';

/**
 * 人物设计链的步骤定义（纯数据，不碰网络与 DOM）。
 * 链路：参考形象(2D) → 四视图(2D) → 静态人形 GLB → 绑骨 GLB → 动作重定向 GLB。
 * 面板步骤条、推进与产物归类都从这里取，避免在组件里散落硬编码顺序。
 */

export type CharacterStepId = 'ref' | 'fourview' | 'model' | 'rig' | 'retarget';

export type CharacterStepOutput = 'image' | 'glb';

export interface CharacterStepDef {
  id: CharacterStepId;
  label: string;
  hint: string;
  output: CharacterStepOutput;
}

export const CHARACTER_STEPS: readonly CharacterStepDef[] = [
  { id: 'ref', label: '参考形象', hint: '文字描述生成全身 A-pose 形象稿', output: 'image' },
  { id: 'fourview', label: '四视图', hint: '参考图生成正/侧/背/侧一致性图', output: 'image' },
  { id: 'model', label: '静态人形', hint: '四视图生成无骨单网格人形 GLB', output: 'glb' },
  { id: 'rig', label: '骨骼绑定', hint: '标准人形绑骨，输出带骨 GLB', output: 'glb' },
  { id: 'retarget', label: '动作重定向', hint: '绑骨模型套用 Idle/Walk 动作', output: 'glb' },
] as const;

/** 漫游 avatar 必需的两条剪辑：Idle_Loop 待机动画、Walk_Loop 行走动画。 */
/**
 * 默认重定向的剪辑（2026-11-17 补全）：站 / 走 / 坐 / 交谈。
 * 坐下与交谈都是物料能力的默认动作，缺片段会让“能坐、能聊”的物料到 E 键才失败；
 * 挥手（Wave_Loop）不进默认集：只有舞台类物料要，按需勾选。
 */
export const DEFAULT_CHARACTER_ANIMATIONS: readonly string[] = CHARACTER_ANIMATION_PRESETS
  .filter(preset => ['Idle_Loop', 'Walk_Loop', 'Sitting_Idle_Loop', 'Idle_Talking_Loop'].includes(preset.id))
  .map(preset => preset.id);

export function characterStepIndex(id: CharacterStepId): number {
  return CHARACTER_STEPS.findIndex(step => step.id === id);
}

/** 返回当前步骤的下一步；最后一步返回 null。 */
export function nextCharacterStep(id: CharacterStepId): CharacterStepId | null {
  const index = characterStepIndex(id);
  const next = CHARACTER_STEPS[index + 1];
  return next ? next.id : null;
}

/** 上一步；第一步返回 null。 */
export function previousCharacterStep(id: CharacterStepId): CharacterStepId | null {
  const index = characterStepIndex(id);
  const previous = CHARACTER_STEPS[index - 1];
  return previous ? previous.id : null;
}
