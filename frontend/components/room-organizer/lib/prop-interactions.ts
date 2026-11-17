/**
 * 道具 → 可交互动作（丽丽 2026-11-16：人物的坐/站动作要按道具分类结合）。
 *
 * 只做纯判定，不碰 three / React：
 * - 坐具继续复用 `seat-placement`，不另造第二套「能不能坐」；
 * - 其余道具给类别、可用交互与对应人物动作；
 * - 没有 clip 的动作不在这里假装能播，场景层用 `resolvePersonAction` 回退 idle。
 *
 * 交互键仍由 `interact-registry` 统一（一期 E），本层只回答「这个道具能做什么」。
 */

import { isSeatFacility, isSeatSetFacility, type SeatFacilityInput } from './seat-placement';
import { hasAnyText, hasAnyToken } from './prop-signal';
import type { PropCapabilityEntry } from './prop-capabilities';
import type { PersonAction } from './types';

export type PropKind =
  | 'seat'
  /** 桌椅套装：能坐，但座位是四向锚点，不是设施中心（2026-11-17）。 */
  | 'seat-set'
  | 'table'
  | 'stage'
  | 'booth'
  | 'display'
  | 'barrier'
  | 'plant'
  | 'vehicle'
  /** 可操作但还没有人物动作（ATM、自助机、闸机）。 */
  | 'operate'
  /** 纯陈设：能力表明确判定不交互。 */
  | 'none'
  /** 人（人群层）不参与物料能力。 */
  | 'person'
  | 'unknown';

export type PropInteraction = 'sit' | 'talk' | 'wave' | 'emote';

export interface PropInteractionInput extends SeatFacilityInput {
  /** 物料品类 / 场景物件类型；有就参与判定，没有只看 slug 与名称。 */
  category?: string | undefined;
  /** 物料子类别（座椅 / 摊位 / 展柜…），中文口径，命中即加分。 */
  subcategory?: string | undefined;
  /** 额外标签（例如「可坐」「展陈」），命中即加分。 */
  tags?: readonly string[] | undefined;
  /**
   * 能力标签（2026-11-17）：目录生成表给出时以此为准，不再跑关键词。
   * 只有表外新物料才回退下面的规则。
   */
  capabilities?: PropCapabilityEntry | null | undefined;
}

export interface PropInteractionProfile {
  id: string;
  name: string;
  kind: PropKind;
  /** 可用的交互；空数组表示不注册为可交互物。 */
  interactions: PropInteraction[];
  /** 选中默认交互时播的人物动作；没有可用动作时不填。 */
  personAction?: PersonAction;
  /** 交互提示主文案，例如「坐下 · 木质餐椅」。 */
  label: string;
}

interface KindRule {
  kind: PropKind;
  slug: readonly string[];
  name: readonly string[];
  interactions: readonly PropInteraction[];
  personAction: PersonAction;
  verb: string;
}

/**
 * 顺序有意义：舞台先于桌（「舞台」也含「台」），摊位先于展柜，
 * 围栏/绿植只用来判「不可交互」，不抢占前面的类别。
 */
const KIND_RULES: readonly KindRule[] = [
  {
    kind: 'stage',
    slug: ['stage', 'platform', 'catwalk'],
    name: ['舞台', '台口', '表演区', 'T台'],
    interactions: ['wave', 'emote'],
    personAction: 'wave',
    verb: '挥手',
  },
  {
    kind: 'table',
    slug: ['table', 'desk', 'counter', 'workbench'],
    name: ['桌', '柜台', '吧台', '工作台', '服务台', '前台', '签到台', '咨询台'],
    interactions: ['talk'],
    personAction: 'talk',
    verb: '交谈',
  },
  {
    kind: 'booth',
    slug: ['booth', 'stall', 'stand', 'tent', 'canopy', 'gazebo', 'kiosk'],
    name: ['摊位', '展位', '棚', '帐篷', '餐车', '售卖车'],
    interactions: ['talk'],
    personAction: 'talk',
    verb: '交谈',
  },
  {
    kind: 'display',
    slug: ['display', 'showcase', 'shelf', 'rack'],
    name: ['展柜', '展架', '货架', '展示'],
    interactions: ['talk'],
    personAction: 'talk',
    verb: '交谈',
  },
  {
    kind: 'barrier',
    slug: ['fence', 'barrier', 'bollard', 'cone', 'railing'],
    name: ['围栏', '护栏', '隔离', '水马', '路障', '锥'],
    interactions: [],
    personAction: 'idle',
    verb: '',
  },
  {
    kind: 'plant',
    slug: ['plant', 'tree', 'flower', 'planter'],
    name: ['绿植', '盆栽', '花箱', '树'],
    interactions: [],
    personAction: 'idle',
    verb: '',
  },
  {
    kind: 'vehicle',
    slug: ['car', 'truck', 'bus', 'van', 'trailer'],
    name: ['车', '巴士'],
    interactions: [],
    personAction: 'idle',
    verb: '',
  },
];

function matches(rule: KindRule, input: PropInteractionInput): boolean {
  const name = input.name ?? '';
  if (hasAnyText(name, rule.name)) return true;
  // slug 只比物件段整词（2026-11-17）：场景名前缀不再替道具决定动作。
  if (hasAnyToken(input.ref, rule.slug)) return true;
  const tags = (input.tags ?? []).join(' ');
  if (hasAnyText(tags, rule.name)) return true;
  return hasAnyText(input.subcategory ?? '', rule.name);
}

/** 能力标签 → 交互动词；与 KIND_RULES 的 verb 口径一致。 */
const CAPABILITY_VERB: Readonly<Record<PropInteraction, string>> = {
  sit: '坐下',
  talk: '交谈',
  wave: '挥手',
  emote: '互动',
};

/**
 * 一个道具的交互画像。
 * 优先级：能力标签（目录定稿）＞ 坐具判定 ＞ 关键词规则。
 */
export function propInteractionProfile(input: PropInteractionInput): PropInteractionProfile {
  const name = input.name ?? '';
  const capability = input.capabilities ?? null;
  if (capability) {
    const interactions = [...capability.actions];
    if (interactions.length === 0) {
      return { id: input.id, name, kind: capability.kind, interactions, label: name };
    }
    const first = interactions[0]!;
    return {
      id: input.id,
      name,
      kind: capability.kind,
      interactions,
      personAction: personActionOf(first),
      label: `${CAPABILITY_VERB[first]} · ${name}`,
    };
  }
  if (isSeatSetFacility(input)) {
    return {
      id: input.id,
      name,
      kind: 'seat-set',
      interactions: ['sit'],
      personAction: 'sit',
      label: `坐下 · ${name}`,
    };
  }
  if (isSeatFacility(input)) {
    return {
      id: input.id,
      name,
      kind: 'seat',
      interactions: ['sit'],
      personAction: 'sit',
      label: `坐下 · ${name}`,
    };
  }

  const rule = KIND_RULES.find(candidate => matches(candidate, input));
  if (!rule) {
    return { id: input.id, name, kind: 'unknown', interactions: [], label: name };
  }
  const interactions = [...rule.interactions];
  if (interactions.length === 0) {
    return { id: input.id, name, kind: rule.kind, interactions, label: name };
  }
  return {
    id: input.id,
    name,
    kind: rule.kind,
    interactions,
    personAction: rule.personAction,
    label: `${rule.verb} · ${name}`,
  };
}

/** 属性卡只读摘要：可交互时给「可交互：坐下 · 名称」，不可交互返回空串。 */
export function propInteractionSummary(profile: PropInteractionProfile): string {
  if (profile.interactions.length === 0) return '';
  return `可交互：${profile.label}`;
}

/** 交互名 → 人物动作；供能力表与旧规则共用。 */
function personActionOf(interaction: PropInteraction): PersonAction {
  if (interaction === 'sit') return 'sit';
  if (interaction === 'talk') return 'talk';
  if (interaction === 'wave') return 'wave';
  return 'emote';
}

/** 落座后再看同一座位：提示改成「起身 · 名称」；其它道具维持原文案。 */
export function propInteractionHint(profile: PropInteractionProfile, seated: boolean): string {
  if ((profile.kind === 'seat' || profile.kind === 'seat-set') && seated) return `起身 · ${profile.name}`;
  return profile.label;
}

/** 道具是否值得注册成可交互物（围栏、绿植、垃圾桶不注册）。 */
export function isInteractableProp(profile: PropInteractionProfile): boolean {
  return profile.interactions.length > 0;
}

/** 每个人物动作依赖的 clip 名；null 表示不依赖特定剪辑。 */
export const PERSON_ACTION_CLIP: Readonly<Record<PersonAction, string | null>> = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  sit: 'Sitting_Idle_Loop',
  talk: 'Idle_Talking_Loop',
  wave: 'Wave_Loop',
  emote: 'Emote_Loop',
};

/** 人物重定向的默认剪辑：站/走/坐三条是现有资产保证，交谈靠生成链新增。 */
export const DEFAULT_PERSON_CLIPS: readonly string[] = ['Idle_Loop', 'Walk_Loop', 'Sitting_Idle_Loop'];

/** 缺少哪条 clip；不依赖剪辑的动作返回 null。 */
export function missingActionClip(
  action: PersonAction,
  clips: readonly string[] = DEFAULT_PERSON_CLIPS,
): string | null {
  const clip = PERSON_ACTION_CLIP[action];
  if (!clip) return null;
  return clips.includes(clip) ? null : clip;
}

/**
 * 能力可用性（2026-11-17 三个真问题之二）：
 * 物料说「能交谈」不等于场景里真能播；把 clip 依赖算清楚，别到按 E 才报错。
 */
export interface PropInteractionAvailability {
  ready: boolean;
  /** 缺的 clip（去重）。 */
  missing: string[];
}

export function propInteractionAvailability(
  profile: PropInteractionProfile,
  clips: readonly string[] = DEFAULT_PERSON_CLIPS,
): PropInteractionAvailability {
  const missing = new Set<string>();
  for (const interaction of profile.interactions) {
    const action = personActionForInteraction(profile, interaction);
    if (!action) continue;
    const clip = missingActionClip(action, clips);
    if (clip) missing.add(clip);
  }
  return { ready: missing.size === 0, missing: [...missing] };
}

/** 属性卡补充一句「需要什么人物」；能力已就绪时返回空串。 */
export function propInteractionRequirement(
  profile: PropInteractionProfile,
  clips: readonly string[] = DEFAULT_PERSON_CLIPS,
): string {
  const availability = propInteractionAvailability(profile, clips);
  if (availability.ready || availability.missing.length === 0) return '';
  return `需带 ${availability.missing.join(' / ')} 的人物`;
}

/**
 * 动作确实播不出来时的短提示。
 * 2026-11-16 E7c：crowd / 玩家 GLB 只有 Idle_Loop / Walk_Loop，talk 与 wave
 * 都没有片段；提示里把“缺哪种 clip”说清楚，不用 idle 冒充交谈或挥手。
 */
export function personActionUnavailableNote(action: PersonAction): string {
  if (action === 'talk') return '这个人物暂时没有交谈片段（需要带 Talk 的 GLB）';
  if (action === 'wave') return '这个人物暂时没有挥手片段（需要带 Wave 的 GLB）';
  if (action === 'sit') return '这个人物暂时没有坐姿片段';
  return '这个人物暂时没有该动作片段';
}

/** 把交互名映射到人物动作；坐姿以外的动作没有 clip 时由场景层回退 idle。 */
export function personActionForInteraction(
  profile: PropInteractionProfile,
  interaction: PropInteraction,
): PersonAction | null {
  if (!profile.interactions.includes(interaction)) return null;
  return personActionOf(interaction);
}
