/**
 * 活动受众/区类型/场地短边命中式建议表。
 *
 * 本模块是离线规则表兜底，未来 LLM Agent 可直接替换本层；
 * 接口形状 generateSuggestions(ctx) 是 Agent 可调用的工具形状：
 * 入参 SuggestionContext（audience 自由文本 + zoneTypes 去重列表 + roomShortSideM），
 * 出参 ActivitySuggestion[]（短标题 + 一句话理由，最多 3 条）。
 *
 * 红线：纯规则、纯函数；不调模型、不读 layoutStore；文案中文简体。
 */
import type { ZoneSemanticType } from './plan-annotation';

/** 一条对话式专业建议（短标题 + 一句话理由）。 */
export interface ActivitySuggestion {
  /** 建议标题（短，一行人话），如「签到区前留 2m 排队缓冲」。 */
  title: string;
  /** 一句话理由，如「中老年人队伍会慢，1.5m 不够排」。 */
  reason: string;
}

/** 生成建议所需的上下文。 */
export interface SuggestionContext {
  /** 活动受众关键词（自由文本），如「中老年人」「商务」「亲子」「学生」「」。 */
  audience: string;
  /** 已画 zone 类型列表（去重），如 ['checkin','rest','roundtable']。 */
  zoneTypes: readonly ZoneSemanticType[];
  /** 场地短边（米），可选；用于判断空间是否局促。 */
  roomShortSideM?: number;
}

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

/**
 * 按小规则表命中式生成 0~3 条建议。
 * - 受众关键词命中老年/商务/亲子；
 * - zone 类型命中签到/休息/圆桌；
 * - 场地短边 < 8m 时给局促提醒。
 * 同一标题只出一条；最多返回 3 条。
 */
export function generateSuggestions(ctx: SuggestionContext): ActivitySuggestion[] {
  const { audience, zoneTypes, roomShortSideM } = ctx;
  const zones = new Set<ZoneSemanticType>(zoneTypes);
  const isElderly = includesAny(audience, ['中老年', '老人', '长辈']);
  const isBusiness = includesAny(audience, ['商务', '企业', '客户']);
  const isFamily = includesAny(audience, ['亲子', '小孩', '儿童']);

  const out: ActivitySuggestion[] = [];
  const push = (s: ActivitySuggestion) => {
    if (!out.some((x) => x.title === s.title)) out.push(s);
  };

  // 老年受众：通用轮椅通道建议，不依赖 zone 是否画了
  if (isElderly) {
    push({
      title: '轮椅通道按 1.5m 留',
      reason: '中老年人队伍会慢，轮椅通道按 1.5m 留，别按 1.2m',
    });
  }

  // zone 相关建议：完全没画 zone 时不堆
  if (zones.size > 0) {
    if (zones.has('checkin')) {
      if (isElderly) {
        push({
          title: '签到区前留 2m 排队缓冲',
          reason: '中老年人队伍会慢，1.5m 不够排',
        });
      } else if (isBusiness) {
        push({
          title: '签到台前留 1.2m 通道',
          reason: '商务访客拿包侧身不挤',
        });
      } else {
        push({
          title: '签到台前主通道按 1.2m 留',
          reason: '人流动线别被签到台堵死',
        });
      }
    }

    if (zones.has('rest') && isElderly) {
      push({
        title: '休息区放场地阴凉侧',
        reason: '下午晒不到，长辈们坐得稳',
      });
    }

    if (zones.has('rest') && isFamily) {
      push({
        title: '休息区长椅别靠墙',
        reason: '孩子跑过来有缓冲，不会撞椅子',
      });
    }

    if (
      zones.has('roundtable') &&
      typeof roomShortSideM === 'number' &&
      Number.isFinite(roomShortSideM) &&
      roomShortSideM < 8
    ) {
      push({
        title: '场地短边不到 8m',
        reason: '圆桌桌距别再缩，否则轮椅过不去',
      });
    }
  }

  return out.slice(0, 3);
}

/** 一条「主动帮你圈区」提示。 */
export interface ZonePrompt {
  /** 要补画的 zone 语义类型。 */
  zoneType: ZoneSemanticType;
  /** 给用户看的一句话，如「要不要我先在门口圈个签到区？」。 */
  prompt: string;
}

/**
 * 主动提示：当用户还没画某个关键区时，按受众画像推荐要不要直接帮他圈。
 * - 没签到区 → 必推（任何活动都需要）；
 * - 没休息区 + 受众是中老年/亲子 → 推；
 * - 没圆桌区 + 受众是商务/晚宴 → 推；
 * - 已经画过的 zone 不重复推。
 */
export function generateZonePrompts(ctx: SuggestionContext): ZonePrompt[] {
  const { audience, zoneTypes } = ctx;
  const zones = new Set<ZoneSemanticType>(zoneTypes);
  const isElderly = includesAny(audience, ['中老年', '老人', '长辈']);
  const isBusiness = includesAny(audience, ['商务', '企业', '客户', '晚宴']);
  const isFamily = includesAny(audience, ['亲子', '小孩', '儿童']);

  const out: ZonePrompt[] = [];
  if (!zones.has('checkin')) {
    out.push({
      zoneType: 'checkin',
      prompt: isElderly
        ? '要不要我先在门口圈个签到区？长辈们一进来就有人接待，不用到处问'
        : '要不要我先在门口圈个签到区？宾客一进来就有人接待',
    });
  }
  if (!zones.has('rest') && (isElderly || isFamily)) {
    out.push({
      zoneType: 'rest',
      prompt: isElderly
        ? '顺便在场地深处留个休息区？长辈们走累了有地方坐'
        : '顺便在场地深处留个休息区？孩子跑累了有地方歇',
    });
  }
  if (!zones.has('roundtable') && isBusiness) {
    out.push({
      zoneType: 'roundtable',
      prompt: '要不要我在场地中间摆几片圆桌区？商务晚宴默认 8 人桌',
    });
  }
  return out;
}

/**
 * 一键落区：在一份空/已有 draft 里，按 zone 类型的「黄金默认位」追加一个矩形 zone 标注。
 * - checkin：靠近入口（南墙 z 正方向），x 居中，3m×2m；
 * - rest：场地深处（北墙 z 负方向），x 居中，4m×3m；
 * - roundtable：场地正中，6m×5m；
 * - photo：靠一侧墙，3m×2m。
 * 房间尺寸由调用方传，缺省按 12×8m。
 */
export function defaultZoneRect(
  zoneType: ZoneSemanticType,
  roomSize: { width: number; height: number },
): { x: number; z: number; width: number; depth: number } {
  const w = roomSize.width;
  const h = roomSize.height;
  switch (zoneType) {
    case 'checkin':
      return { x: 0, z: h / 2 - 1.5, width: Math.min(3, w * 0.4), depth: 2 };
    case 'rest':
      return { x: 0, z: -h / 2 + 2, width: Math.min(4, w * 0.5), depth: 3 };
    case 'roundtable':
      return { x: 0, z: 0, width: Math.min(6, w * 0.6), depth: Math.min(5, h * 0.5) };
    case 'photo':
      return { x: -w / 2 + 2, z: 0, width: 2, depth: Math.min(3, h * 0.4) };
  }
}
