import { preserveCurrentActivity } from '../../../lib/production-plan';
import type { RoomLayout } from './types';
import { HEADCOUNT_MAX } from './workbench-agent';

export interface CreativeBrief {
  event: string;
  hasFloorplan?: boolean;
  guests: number;
  description: string;
  mustHave: string;
  allowIdeas: boolean;
  venueConditions?: string;
  style?: string;
  palette?: string;
  atmosphere?: string;
}
/** 左栏活动类型的固定选项；聊天说出的其他类型会作为当前值单独回显，不改这份清单。 */
export const BRIEF_EVENT_OPTIONS = ['品牌快闪', '露营派对', '工作坊', '小型黑客松', '展览市集', '婚礼聚会', '其他活动'] as const;
export const INITIAL_BRIEF: CreativeBrief = {
  event: '品牌快闪', guests: 24,
  description: '', mustHave: '', allowIdeas: true, venueConditions: '', style: '', palette: '', atmosphere: '',
};
export const CREATIVE_BRIEF_DESCRIPTION_LIMIT = 1800;
const MANUAL_BRIEF_HEADING = '【创意简报与观众体验】';
const BRIEF_REFERENCE_PREFIX = '【需求参考 ·';
/** 旧版「✦ 插入空提纲」留下的骨架行；生成参考时清掉，不占正文。 */
const BLANK_SCAFFOLD_LINES = new Set([MANUAL_BRIEF_HEADING, '活动目标：', '参与观众：', '布置要求：']);

/** 旧版冗长提纲的逐行内容，用于迁移清理已保存的描述。 */
const LEGACY_BRIEF_TEMPLATE_LINES = [
  MANUAL_BRIEF_HEADING,
  '请按实际情况填写；未知写“待确认”，演练设定写明“假设”。',
  '活动目标：待填写希望表达什么、解决什么问题。',
  '参与观众：待填写谁会来，希望他们理解或做什么。',
  '交付范围：待填写我们承担什么、交付到什么状态。',
  '已知约束：待填写已确认的场地、时间、预算与必须保留的条件。',
  '待确认项：待填写需要向客户、场地方或协作方核实的事项。',
  '到达：待填写如何找到入口、提前需要知道什么。',
  '进入：待填写第一眼看见什么、如何开始参与。',
  '观看：待填写内容、顺序、关键视角及对应物件。',
  '交流：待填写停留位置、互动方式和负责引导的人。',
  '离开：待填写带走什么、如何反馈或继续参与。',
];

/** 只剩旧的空白提纲（含标题被迁移删掉的版本）时，视同没有需求。 */
export function isBlankBriefScaffold(description: string): boolean {
  const lines = description.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(line => BLANK_SCAFFOLD_LINES.has(line));
}

function stripBlankBriefScaffold(description: string): string {
  return description
    .split('\n')
    .filter(line => !BLANK_SCAFFOLD_LINES.has(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 把已保存描述中的旧版冗长提纲与空白骨架清掉，只清理模板、不动用户文字。 */
export function migrateBriefDescription(description: string): string {
  return stripBlankBriefScaffold(
    description.split('\n').filter(line => !LEGACY_BRIEF_TEMPLATE_LINES.includes(line.trim())).join('\n')
  );
}

interface EventFocus {
  goal: string;
  audience: string;
  layout: string;
}

function eventFocus(event: string): EventFocus {
  if (/婚礼|婚宴/.test(event)) return {
    goal: '仪式与宴席都看得见，合影体面。',
    audience: '亲友为主，长时间停留、走动频繁。',
    layout: '仪式、就餐、合影分区明确；主通道与上菜动线不交叉；留出合影背景。',
  };
  if (/露营|派对|聚会/.test(event)) return {
    goal: '让人放松下来、围坐聊天，夜里也有氛围。',
    audience: '朋友与家庭客群，傍晚到夜间在场内走动。',
    layout: '用帐篷、天幕或低座围合交流区；灯串串联主要停留点；保留到出口的通道。',
  };
  if (/工作坊|培训|课堂/.test(event)) return {
    goal: '让每位参与者坐下来动手，听得清、看得见。',
    audience: '报名参加的来宾，需要长时间专注。',
    layout: '每人有可操作的台面；讲师区与投影视线无遮挡；桌椅之间留出拉椅和走动的空间。',
  };
  if (/黑客松|编程|比赛/.test(event)) return {
    goal: '让参赛者能长时间 coding，也能随时拉人讨论。',
    audience: '参赛者与导师，工位停留时间长、设备多。',
    layout: '工位成组、电源可达；留出白板或讨论角；主通道不压线，保留安静区。',
  };
  if (/市集|展览|展销/.test(event)) return {
    goal: '逛展动线顺畅，每个摊位都能被看见、被停留。',
    audience: '流动观众，停留时间不固定。',
    layout: '摊位沿主动线排布但不压通道；摊前留停留和议价空间；出口留缓冲。',
  };
  if (/快闪|发布|品牌/.test(event)) return {
    goal: '入口第一眼认出主题，场内愿意停下来看、试用和拍照。',
    audience: '品牌邀请的顾客与场内客流，进出频繁、停留时间不一。',
    layout: '入口留出缓冲和拍照位；展示、试用、收银互不挡路；主通道留够双向走动。',
  };
  return {
    goal: '让来宾清楚活动在做什么，愿意停留和参与。',
    audience: '按邀请名单到场的来宾，停留时间不一。',
    layout: '入口留缓冲与引导；主要功能区不互相挡路；保留一条顺畅的主通道。',
  };
}

/**
 * 「✦ 生成需求参考」：按左栏已有的活动类型/人数/必需项拼一段可直接改的
 * 参考文字，不是空提纲，也不是客户原话。全部来自本机规则。
 */
export function buildBriefReference(brief: CreativeBrief): string {
  const event = brief.event.trim() || '这场活动';
  const guests = Number.isInteger(brief.guests) && brief.guests > 0 ? brief.guests : null;
  const focus = eventFocus(event);
  const mustHave = brief.mustHave.trim();
  const venue = brief.venueConditions?.trim() ?? '';
  const style = brief.style?.trim() ?? '';
  const palette = brief.palette?.trim() ?? '';
  const atmosphere = brief.atmosphere?.trim() ?? '';
  const styleLine = [
    style ? `风格：${style}` : '',
    palette ? `配色：${palette}` : '',
    atmosphere ? `氛围：${atmosphere}` : '',
  ].filter(Boolean).join('；');
  return [
    `${BRIEF_REFERENCE_PREFIX} ${event}${guests ? ` · ${guests} 人` : ''}】`,
    `目标：${focus.goal}`,
    `观众：${focus.audience}`,
    `布置：${focus.layout}`,
    mustHave ? `必须保留：${mustHave}` : '',
    venue ? `现场条件：${venue}` : '',
    styleLine,
  ].filter(Boolean).join('\n');
}

/**
 * 把参考接到现有需求里：保留用户文字，清掉旧的空白骨架；上一段参考
 * 放在末尾，重新生成时整段刷新，避免越点越长。
 */
export function composeBriefReference(description: string, brief: CreativeBrief): string {
  const cleaned = stripBlankBriefScaffold(description);
  const lines = cleaned.split('\n');
  const previous = lines.findIndex(line => line.trim().startsWith(BRIEF_REFERENCE_PREFIX));
  const kept = (previous >= 0 ? lines.slice(0, previous) : lines).join('\n').trim();
  const reference = buildBriefReference(brief);
  const next = kept ? `${kept}\n\n${reference}` : reference;
  if (next.length > CREATIVE_BRIEF_DESCRIPTION_LIMIT) {
    throw new Error('描述空间不足，请先精简原文；参考没有写入，原文字保持不变。');
  }
  return next;
}
export const IDEA_CARDS = [
  { title: '轻露营会客区', text: '用开放式帐篷、地毯与低座围合交流区，预留顺畅的主通道。', prompt: '设置一处帐篷会客区，适合小组交流，保留宽敞的主通道。' },
  { title: '会发光的夜场', text: '用暖色串灯连接签到、互动与休息区，形成连贯的夜间氛围。', prompt: '用暖色串灯串联签到区和休息区，并加入有层次的夜间照明。' },
  { title: '把记忆带走', text: '加入合影拱门或共创留言区，让参与者拥有一个愿意停留的角落。', prompt: '增加与主题呼应的合影拱门和互动留言区，作为活动记忆点。' },
] as const;

/** Current v1 accepts text only; image bytes must never be implied to reach the model. */
export function briefInstruction(brief: CreativeBrief, width: number, depth: number): string {
  if (!brief.description.trim()) throw new Error('请先描述客户希望举办怎样的活动。');
  if (!Number.isInteger(brief.guests) || brief.guests < 1 || brief.guests > HEADCOUNT_MAX) throw new Error(`当前生成服务支持 1–${HEADCOUNT_MAX} 人，请填写范围内的整数。`);
  const result = [
    `请为客户设计一套完整的${brief.event}场景布置方案。场地${width}×${depth}米，预计${brief.guests}人。`,
    `客户需求：${brief.description.trim()}`,
    brief.mustHave.trim() ? `必须满足：${brief.mustHave.trim()}` : '',
    brief.venueConditions?.trim() ? `用户确认的现场条件（文字输入，非图片识别）：${brief.venueConditions.trim()}。必须保留出入口与固定设施，不得覆盖。` : '',
    brief.style?.trim() ? `风格要求：${brief.style.trim()}` : '',
    brief.palette?.trim() ? `配色要求：${brief.palette.trim()}` : '',
    brief.atmosphere?.trim() ? `氛围要求：${brief.atmosphere.trim()}；超出现有三种灯光预设的能力仅作为建议说明。` : '',
    brief.allowIdeas ? '在满足客户需求的基础上，主动布置适合主题的亮点、分区、装饰和氛围，形成完整候选后由客户整体确认。明确说明每个亮点的用途与对应物件。' : '只围绕客户明确提出的要求规划，不自行扩展需求。',
    '保留锁定对象。提出候选修改，不声称已经应用或保存；应用方式依据本轮用户指令和服务端规则。依据当前资源库优先选用真实物料；缺少所需物件时，可通过桌、椅、柜台、地台、背景板和柜体的参数化工具建模。工具不支持的造型须说明缺项，不得用桌椅冒充，也不得未经确认替换原要求。',
    '现场照片尚未提交给模型；不能声称已经识别、测量或参考了图片内容。',
  ].filter(Boolean).join('\n');
  if (result.length > 12000) throw new Error('需求内容过长，请精简后再生成。');
  return result;
}

export function proposalSummary(before: RoomLayout, after: RoomLayout): { added: number; removed: number; total: number } {
  const old = new Set(before.floors.flatMap(f => f.items.map(item => item.id)));
  const next = new Set(after.floors.flatMap(f => f.items.map(item => item.id)));
  return { added: [...next].filter(id => !old.has(id)).length, removed: [...old].filter(id => !next.has(id)).length, total: next.size };
}

/** Preserve presentation metadata absent from the v1 wire scene when applying a proposal. */
export function mergeProposalPresentation(base: RoomLayout, candidate: RoomLayout): RoomLayout {
  candidate = preserveCurrentActivity(base, candidate);
  const previous = base.floors[0];
  const next = candidate.floors[0];
  if (!previous || !next) return candidate;
  const existing = new Map(previous.items.map(item => [item.id, item]));
  return { ...base, ...candidate, floors: [{ ...previous, ...next, id: previous.id,
    name: previous.name, floorColor: candidate.backendSceneV2 ? next.floorColor : previous.floorColor,
    items: next.items.map(item => {
      const old = existing.get(item.id);
      return old && old.type === item.type && old.assetId === item.assetId
          ? { ...item, name: old.name, icon: old.icon, ...(old.groupId ? { groupId: old.groupId } : {}) }
        : item;
    }),
  }] };
}
