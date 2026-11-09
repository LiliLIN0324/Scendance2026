/** 生成出来的清单只说明文件和数量。采购、布置和现场盘点都要另有记录。 */
export const GENERATED_LIST_NOTICE = '生成清单不等于已采购或已布置。';

export type LedgerColumn = '口述' | '场景模型' | '核实库存';

export interface LedgerChecklistLine {
  column: LedgerColumn;
  identity: string;
  quantity: number;
  note: string;
}

const COMPLETED_CLAIMS = ['已采购', '已布置', '采购完成', '已下单', '已经采购', '已经布置'] as const;

/** 列出生成说明之外的完成态措辞。说明本身里的「已采购」「已布置」不算违规。 */
export function deliveryListViolations(text: string): string[] {
  const remainder = text.split(GENERATED_LIST_NOTICE).join('');
  return COMPLETED_CLAIMS.filter(token => remainder.includes(token));
}

/** 清单必须带生成说明，并且不能声称已经采购或已经布置。 */
export function assertGeneratedListNotProcured(text: string): void {
  const hits = deliveryListViolations(text);
  if (!text.includes(GENERATED_LIST_NOTICE) || hits.length) {
    throw new Error(`交付清单把生成内容写成了采购或布置：${hits.join('、') || '缺少生成说明'}`);
  }
}
