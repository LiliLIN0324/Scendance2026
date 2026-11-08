/**
 * 门标注的 2D 渲染样式决策（纯函数，无 DOM / canvas 依赖）。
 *
 * 设计红线：
 * 只区分门洞记录与推测位置。当前数据未记录铰链和开向，任何门都不画门扇弧。
 */
import type { PlanAnnotation } from '../../../lib/plan-annotation';

export type DoorGeometry = Extract<PlanAnnotation['geometry'], { kind: 'door' }>;

export interface DoorRenderStyle {
  /** 推测门洞位置用虚线；实线也不代表现场核验。 */
  dashed: boolean;
  /** 每扇门都提醒位置或开向待核验。 */
  label: string;
}

/**
 * 门标注的渲染样式决策（纯函数）。
 *
 * 位置推测与场景记录使用不同说明；都不能推断门扇开向。
 */
export function doorRenderStyle(door: DoorGeometry): DoorRenderStyle {
  const widthUnknown = typeof door.widthM !== 'number' || !Number.isFinite(door.widthM) || door.widthM <= 0;
  if (widthUnknown) {
    const label = door.source === 'scene' ? '场景门中心、宽度与开向待核验'
      : door.inferred ? '推测门中心、宽度与开向待核验' : '门中心、宽度与开向待核验';
    return { dashed: !!door.inferred, label };
  }
  if (door.inferred) {
    return { dashed: true, label: door.source === 'scene' ? '场景门洞位置、宽度与开向待核验' : '推测门洞位置、宽度与开向待核验' };
  }
  return { dashed: false, label: '门洞位置、宽度与开向待核验' };
}
