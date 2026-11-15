/**
 * 分区编号：把计划里的阶段与画布上的分区对上线。
 *
 * 对标谷地工坊那张「分区施工方案」截图——画面上的色块带编号（6 森林 / 9 婚礼仪式区），
 * 计划卡里写「主迎宾大道与三条支路 #1-#5」「森林缓冲带 #6-#7」。两边用的是同一套号，
 * 所以用户扫一眼就知道「计划里的第 2 阶段」对应画布上哪两块地。
 *
 * 编号只由草案本身算：阶段按 stageNo 升序，阶段内按 annotationIds 顺序，
 * 没被任何阶段引用的分区接在后面补号。同一份草案反复算结果必须一致——
 * 编号是给人对照用的，跳号或漂移就失去意义。
 */

import type { LayoutPlanDraft } from '../../../lib/plan-annotation';

export interface NumberedPlanZone {
  zoneId: string;
  /** 1-based 分区编号。 */
  number: number;
  label: string;
  /** 归属阶段（1-based）；未被阶段引用时为 0。 */
  stageNo: number;
}

type DraftLike = Pick<LayoutPlanDraft, 'stages' | 'annotations'>;

/**
 * 给每个 zone 标注分配编号，返回 zoneId → 编号信息。
 * 非 zone 标注（动线 / 测距 / 门）不参与编号，不给它们占号。
 */
export function numberPlanZones(draft: DraftLike | null | undefined): Map<string, NumberedPlanZone> {
  const result = new Map<string, NumberedPlanZone>();
  if (!draft) return result;

  const zonesById = new Map<string, { label: string }>();
  for (const annotation of draft.annotations) {
    if (annotation.kind === 'zone') zonesById.set(annotation.id, { label: annotation.label || '未命名分区' });
  }

  let next = 1;
  const stages = [...draft.stages].sort((a, b) => a.stageNo - b.stageNo);
  for (const stage of stages) {
    for (const id of stage.annotationIds) {
      const zone = zonesById.get(id);
      if (!zone || result.has(id)) continue;
      result.set(id, { zoneId: id, number: next++, label: zone.label, stageNo: stage.stageNo });
    }
  }
  for (const [id, zone] of zonesById) {
    if (result.has(id)) continue;
    result.set(id, { zoneId: id, number: next++, label: zone.label, stageNo: 0 });
  }
  return result;
}

/** 阶段号 → 该阶段覆盖的分区编号（升序）。 */
export function stageZoneNumbers(draft: DraftLike | null | undefined): Map<number, number[]> {
  const numbers = new Map<number, number[]>();
  for (const zone of numberPlanZones(draft).values()) {
    if (zone.stageNo <= 0) continue;
    const list = numbers.get(zone.stageNo) ?? [];
    list.push(zone.number);
    numbers.set(zone.stageNo, list);
  }
  for (const list of numbers.values()) list.sort((a, b) => a - b);
  return numbers;
}

/**
 * 编号列表压成「#1-#5、#8」这种写法。
 * 连续段折成区间，断了就另起一段——只压视觉，不改号。
 */
export function formatZoneRange(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? `#${start}` : `#${start}-#${prev}`);
    start = current;
    prev = current;
  }
  parts.push(start === prev ? `#${start}` : `#${start}-#${prev}`);
  return parts.join('、');
}
