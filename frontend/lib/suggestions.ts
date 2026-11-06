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
