/**
 * 2026-11-17 #118 补漏：属性卡「选中数」口径（纯函数）。
 *
 * 为什么单独立一个文件：车辆属性卡（车型 / 台数 / 归属分区 / 车型模型 / 删除）住在
 * `selectionInspectorZone` 里，而编辑器里的「属性」浮窗只在该区**非空**时才展开
 * （角标 = 选中数；为 0 时整张卡被空状态「在图上点选物件…」顶掉）。
 * 车辆一旦漏算进选中数，就是「选中车 → 角标仍是 0 → 卡片不弹 → 车辆属性永远够不着」。
 * 这条链路只在真机走查里露出来（单元测的是纯函数，测不到浮窗开合），
 * 所以把口径抽成可测的纯函数，钉死「车算一件」。
 *
 * 口径（与既有实现一致，只把车辆补进来）：
 * - 单选实体各算 1：分区 / 设施 / 动线 / 出入口 / 人员 / **车辆**；
 * - 多选：动线与出入口按「选中条数」累加；设施多选 ≥ 2 才算 1（单件已由 facility 计过）。
 */

export interface PlanSelectionCountInput {
  /** 选中了分区。 */
  zone: boolean;
  /** 选中了设施（单选）。 */
  facility: boolean;
  /** 选中了动线（单选）。 */
  route: boolean;
  /** 选中了出入口节点（单选）。 */
  node: boolean;
  /** 选中了人员点位（单选）。 */
  worker: boolean;
  /** 2026-11-17 #118：选中了规划车辆（单选）。 */
  vehicle: boolean;
  /** 多选动线条数。 */
  multiRoute: number;
  /** 多选出入口条数。 */
  multiNode: number;
  /** 多选设施条数。 */
  multiFacility: number;
}

/** 属性卡「选中数」：单选实体各 1 件，多选按条数累加（设施多选 ≥2 才算 1）。 */
export function planSelectionCount(input: PlanSelectionCountInput): number {
  const singles = [
    input.zone,
    input.facility,
    input.route,
    input.node,
    input.worker,
    input.vehicle,
  ].filter(Boolean).length;
  return singles + input.multiRoute + input.multiNode + (input.multiFacility >= 2 ? 1 : 0);
}
