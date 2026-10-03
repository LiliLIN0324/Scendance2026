import type { ScenePresetKey } from '@/components/room-organizer/lib/scene-presets';

export type AssistantMode = 'auto' | 'scene' | 'model';
export type AssistantAction =
  | { kind: 'scene' }
  | { kind: 'model'; prompt: string }
  | { kind: 'preset'; key: ScenePresetKey }
  | { kind: 'choose-preset' }
  | { kind: 'help' }
  | { kind: 'choose-action' };

/**
 * Keyword routing per archived preset. First match wins, so venue names stay
 * above generic words, and every key here must exist in `SCENE_PRESETS`.
 */
const PRESET_HINTS: ReadonlyArray<readonly [ScenePresetKey, RegExp]> = [
  ['gym', /体育馆|黑客松|hackathon|gym/i],
  ['popup', /香氛|快闪|青序|popup/i],
  ['bar', /酒吧|琥珀间|吧台|bar/i],
  ['cafe', /咖啡|慢调|cafe/i],
  ['conference', /学术|会议|论坛|conference/i],
  ['lawn', /草坪|旷野|室外|lawn/i],
  ['market', /市集|集市|风物|market/i],
  ['museum', /美术馆|博物馆|展区|museum/i],
  ['office', /办公室|工位|office/i],
  ['studio', /摄影|影棚|studio/i],
];

/** Routing only selects an existing capability; message text never becomes executable code. */
export function assistantAction(message: string, mode: AssistantMode): AssistantAction {
  const text = message.trim();
  if (/^(你好|您好|嗨|你是谁|你能做什么|有什么功能|帮助)[！!。？?\s]*$/.test(text) ||
    /(?:不要|别|不需要|暂不|不想).*(?:生成|制作|载入)|(?:如何|怎么|多少钱|费用|价格).*(?:模型|生成)|(?:模型|生成).*(?:多少钱|费用|价格)|(?:能否|可以).*(?:生成).*[吗么？?]/.test(text)) return { kind: 'help' };
  if (mode === 'model') return { kind: 'model', prompt: text };
  if (/预设|模板|载入|加载/.test(text)) {
    const hinted = PRESET_HINTS.find(([, pattern]) => pattern.test(text));
    if (hinted) return { kind: 'preset', key: hinted[0] };
    if (/预设|模板/.test(text)) return { kind: 'choose-preset' };
  }
  if (mode === 'scene') return { kind: 'scene' };
  const model = /(?:生成|制作|建模|创建).*(?:单件|模型|物料)|(?:3d|三维).*(?:模型|物件)/i.test(text);
  const scene = /场景|场地|布局|布置方案|活动方案/.test(text);
  if (model && scene) return { kind: 'choose-action' };
  const singleObject = /(?:生成|制作|建模|创建).{0,5}(?:一|1)(?:个|把|张|件|座|盏|棵)/.test(text);
  return model || singleObject && !scene ? { kind: 'model', prompt: text } : { kind: 'scene' };
}
