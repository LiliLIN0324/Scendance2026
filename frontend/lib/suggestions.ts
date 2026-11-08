/**
 * 对已绘制区域给出待核对提示，不根据受众标签推断需求。
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
  /** 建议标题（短，一行人话）。 */
  title: string;
  /** 一句话理由。 */
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

/** 基于已绘制的区域提示需要人工复核的事项。 */
export function generateSuggestions(ctx: SuggestionContext): ActivitySuggestion[] {
  const out: ActivitySuggestion[] = [];
  const zones = new Set(ctx.zoneTypes);
  if (zones.has('checkin')) out.push({ title: '核对签到排队空间', reason: '确认队伍是否影响入口和通行。' });
  if (zones.has('rest')) out.push({ title: '核对休息区位置', reason: '结合实际使用需求和场地条件确认。' });
  if (zones.has('roundtable') && typeof ctx.roomShortSideM === 'number' && ctx.roomShortSideM < 8) {
    out.push({ title: '核对桌椅间距', reason: '场地较窄，需结合实际尺寸和通行需求检查。' });
  }
  return out;
}

/**
 * 一键落区：在一份空/已有 draft 里，按 zone 类型的「黄金默认位」追加一个矩形 zone 标注。
 * - checkin：默认位于南侧（不代表真实入口），x 居中，3m×2m；
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
    case 'desk':
      // 课桌区：场地中央偏前（z 正方向靠入口），宽 60% 深 60%。
      return { x: 0, z: h * 0.05, width: Math.min(8, w * 0.7), depth: Math.min(6, h * 0.6) };
    default:
      return { x: 0, z: 0, width: 3, depth: 2 };
  }
}
