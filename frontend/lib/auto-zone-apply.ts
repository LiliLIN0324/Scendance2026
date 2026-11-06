/**
 * 「回好自动落区」纯函数层。
 *
 * 背景：brief-agent 在受众命中时会回一句「要不要我直接在 2D 上帮你把签到区和休息区先圈出来？回「好」就落。」
 * 本模块只做三件纯事：
 *  1. 识别用户是不是在回「好 / 可以 / 圈吧」这类肯定意图；
 *  2. 识别某条 AI 回复是不是含「要不要帮你圈出来」这种提议；
 *  3. 按提议文本里提到的区，把 defaultZoneRect 排成一份不重叠的默认矩形清单。
 *
 * 红线：纯函数、不读 store、不发副作用；文案中文简体；位置以房间中心为原点（与 plan-annotation 一致）。
 */
import { ZONE_SEMANTIC_LABELS, type ZoneSemanticType } from './plan-annotation';
import { defaultZoneRect } from './suggestions';

/** 一段默认矩形：zone 类型 + 画布上的中心矩形（x/z 是中心，width/depth 是米）。 */
export interface DefaultZoneRect {
  zoneType: ZoneSemanticType;
  label: string;
  rect: { x: number; z: number; width: number; depth: number };
}

/**
 * 肯定意图识别：用户输入匹配「好 / 好的 / 可以 / 行 / 圈吧 / 帮我圈 / ok / yes」这类短回复。
 * - 只在 trimmed 后很短（≤8 个字符）时命中，避免把「好的，但是签到往南挪」误当肯定。
 * - 英文大小写不敏感；中文不做标点敏感。
 */
export function isAffirmativeIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 8) return false;
  // 去掉常见语气标点，避免「好。」「可以！」漏判。
  const normalized = t.replace(/[。！！!？?，,\.\s]+$/u, '');
  if (!normalized) return false;
  const positives = [
    '好', '好的', '好啊', '好吧', '行', '行吧', '可以', 'ok', 'okay', 'yes', '嗯',
    '圈吧', '帮我圈', '圈出来', '就这么办', '没问题', '来吧',
  ];
  return positives.includes(normalized);
}

/**
 * 检测一条 AI 回复是否含「要不要帮你圈出来 / 圈一下」的提议。
 * 简单字符串包含，不做 NLP——brief-agent 的措辞是自己控制的。
 */
export function hasZoneApplyProposal(aiReply: string): boolean {
  if (!aiReply) return false;
  return aiReply.includes('圈出来') || aiReply.includes('圈一下') || aiReply.includes('先圈');
}

/**
 * 从 AI 回复里抽它提议的 zoneType 列表。
 * - 默认至少含签到区（checkin）和休息区（rest），这是 brief-agent 的兜底提议；
 * - 回复里提到「圆桌」追加 roundtable；
 * - 回复里提到「打卡」追加 photo。
 * 顺序固定，去重；返回的类型保证和 ZONE_SEMANTIC_LABELS 对得上。
 */
export function extractProposedZoneTypes(aiReply: string): ZoneSemanticType[] {
  const out: ZoneSemanticType[] = ['checkin', 'rest'];
  if (aiReply.includes('圆桌')) out.push('roundtable');
  if (aiReply.includes('打卡')) out.push('photo');
  return out;
}

/**
 * 批量构造默认 zone 矩形。
 * - 内部调 suggestions.ts 的 defaultZoneRect 拿每个 zone 的黄金默认位；
 * - 不同 zone 之间本来就在不同方位（checkin 南墙、rest 北墙、roundtable 正中、photo 西侧），
 *   不会重叠——这里只做边界 clamp，不重排偏移；
 * - 若房间太小撑不下，就把矩形等比缩到房间内 80%，绝不越界。
 */
export function buildDefaultZoneRects(
  zoneTypes: readonly ZoneSemanticType[],
  roomSize: { width: number; height: number },
): DefaultZoneRect[] {
  const w = Math.max(Number(roomSize.width) || 0, 0.01);
  const h = Math.max(Number(roomSize.height) || 0, 0.01);
  const out: DefaultZoneRect[] = [];
  const seen = new Set<ZoneSemanticType>();
  for (const zoneType of zoneTypes) {
    if (seen.has(zoneType)) continue;
    seen.add(zoneType);
    const raw = defaultZoneRect(zoneType, { width: w, height: h });
    // 边界 clamp：矩形任何一边都不能越出房间；越界就往中心收。
    const halfW = raw.width / 2;
    const halfD = raw.depth / 2;
    const maxX = Math.max(w / 2 - halfW, 0);
    const maxZ = Math.max(h / 2 - halfD, 0);
    const x = Math.min(Math.max(raw.x, -maxX), maxX);
    const z = Math.min(Math.max(raw.z, -maxZ), maxZ);
    out.push({
      zoneType,
      label: ZONE_SEMANTIC_LABELS[zoneType],
      rect: { x, z, width: raw.width, depth: raw.depth },
    });
  }
  return out;
}
