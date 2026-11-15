/**
 * 2026-11-16 设施拖放（物件库 → 画布 / 3D 地面）。
 *
 * HTML5 拖拽在 `dragover` 阶段出于安全不暴露 `dataTransfer.getData()`，
 * 只靠 drop 才读到模板 id，就没法在松手前画占地幽灵。
 * 这里用一份模块级记录保存「正在拖的设施模板」，拖起时写入、dragend/drop 清掉；
 * 2D 画布和 3D 接管层都只读这一个来源，预览与最终落位不会各拿一份。
 */
let planFacilityDrag: string | null = null;

export function setPlanFacilityDrag(templateId: string | null): void {
  planFacilityDrag = templateId;
}

export function getPlanFacilityDrag(): string | null {
  return planFacilityDrag;
}

export function clearPlanFacilityDrag(): void {
  planFacilityDrag = null;
}
