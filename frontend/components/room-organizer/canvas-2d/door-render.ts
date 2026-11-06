/**
 * 门标注的 2D 渲染样式决策（纯函数，无 DOM / canvas 依赖）。
 *
 * 设计红线：
 * - 数据模型不动：inferred 字段已在 plan-annotation.ts 定义；
 * - 不读 human-factors.ts 的门弧判定结果，只做视觉层虚线/小字区分；
 * - 真实门（inferred 缺省/false）：门扇实线 + 开门弧实线；
 * - 推测门（inferred:true，withDefaultDoor 合成）：门扇仍实线，
 *   开门弧改虚线（strokeDasharray="6 4"），门旁标「门未确认」小字。
 *
 * 几何计算（铰链/关位/开位/弧 sweep）留在 plan-overlay.tsx 内联，
 * 因为它直接吃 worldToScreen 变换，抽出来不增加可测性。
 */
import type { PlanAnnotation } from '../../../lib/plan-annotation';

export type DoorGeometry = Extract<PlanAnnotation['geometry'], { kind: 'door' }>;

export interface DoorRenderStyle {
  /** 推测门的开门弧用虚线；真实门实线。门扇始终实线。 */
  dashed: boolean;
  /** 推测门旁的小字标签；真实门不标。 */
  label?: string;
}

/**
 * 门标注的渲染样式决策（纯函数）。
 *
 * - 用户真实画的门（inferred 缺省或 false）：实线门弧，不加小字；
 * - withDefaultDoor 推测出来的门（inferred:true）：门弧虚线 + 「门未确认」小字，
 *   提醒用户这是数据层兜底的门，位置/宽度/开启方向都未核验。
 */
export function doorRenderStyle(door: DoorGeometry): DoorRenderStyle {
  if (door.inferred) {
    return { dashed: true, label: '门未确认' };
  }
  return { dashed: false };
}
