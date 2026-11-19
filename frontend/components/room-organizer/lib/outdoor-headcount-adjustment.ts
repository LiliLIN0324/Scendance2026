import type { OutdoorTurn } from "./outdoor-agent-contract";

/**
 * 这句话是不是「只改人数」。
 *
 * 2026-11-19 本地实测：`人数改为 150 人，保持现有分区。` 里的「分区」先命中
 * `matchZoneCommand`，被当成区域提案；没有活动类型时只回一句「先说活动类型」，
 * 真正的模型理解根本没发生。尾句「保持现有分区」是约束，不是空间动作，
 * 所以判定时先把这条常见尾句剥掉，再看剩下的核心句是否只有人数变更。
 */
export function isHeadcountOnlyMessage(message: string): boolean {
  const text = message.normalize("NFKC").trim();
  if (!/\d+\s*(?:人|位)/u.test(text)) return false;
  if (!/(?:人数|改|调|变|设|更新|调整)/u.test(text)) return false;
  const core = text.replace(
    /[，,。；;\s]*(?:保持|保留|维持)(?:现有|原有|当前)?(?:的)?(?:分区|区域|布置|画布|方案)(?:不变|原样)?[。！!]?$/u,
    "",
  ).trim();
  // 核心句里只要还有空间/物料动作，就不归这条路径，避免把真正的布置句吞掉。
  if (/(?:分区|区域|舞台|签到|入口|通道|边界|范围|摆放|放置|放|挪|移|增加|减少|删除|清空|物料|设施|座位|桌|椅|布置|设计|方案|流线|路线|场地)/u.test(core)) {
    return false;
  }
  return /^(?:请|麻烦|帮我)?(?:把|将)?(?:活动|总|预计)?(?:人数)?\s*(?:改|调|变|设|更新|调整)(?:为|成|到)?\s*\d+\s*(?:人|位)[。！!]?$/u.test(core);
}

/**
 * 模型把「人数改为 150 人，保持现有分区」判成 adjust，但没有给空间操作。
 * 这句不是几何变更：只要 guests 事实逐字来自本句，就按简报更新处理，
 * 不再让空间变更守卫抛红卡。带 operation 的 adjust 不在此列。
 */
export function headcountOnlyAdjustment(
  turn: Pick<OutdoorTurn, "action" | "facts" | "operation">,
  message: string,
): number | null {
  if (turn.action !== "adjust" && turn.action !== "connect") return null;
  if (turn.operation) return null;
  const guests = turn.facts.guests;
  if (!guests || !Number.isInteger(guests.value) || guests.value < 1) return null;
  if (!guests.evidence.trim() || !message.includes(guests.evidence)) return null;
  return guests.value;
}