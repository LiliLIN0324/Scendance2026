'use client';

import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 2026-11-17 用户：「经典案例我要的也是和其他的视觉一样的卡片预览图」。
 *
 * 案例卡要和示例场景同一套卡形（16:10 预览 + 名称 + 一行元信息），所以这里给每案画一张缩略。
 * 画的是**这一案复刻出来的方案本身**（边界 + 分区 + 设施 + 流线），不是 OnePlan 的参考截图——
 * 参考图版权归 OnePlan，只放 learning-library 内部学习，不进 frontend/public。
 * 好处是卡片所见即所得：点开进 2D 规划看到的就是这张图放大后的东西。
 */

/** 卡片只有约 200px 宽，设施画到这个数量以上就糊成一片，多的不画。 */
const MAX_FACILITY_DOTS = 90;

function toPoints(points: readonly PlanPoint[]): string {
  return points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
}

export function CaseThumb({ plan }: { plan: SitePlanData }): JSX.Element {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const grow = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const point of plan.boundary) grow(point.x, point.y);
  for (const zone of plan.zones) for (const point of zone.polygon) grow(point.x, point.y);
  for (const route of plan.routes) for (const point of route.points) grow(point.x, point.y);
  for (const facility of plan.facilities) grow(facility.position.x, facility.position.y);

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return <svg className="sc-case-thumb" viewBox="0 0 160 100" aria-hidden="true" focusable="false"/>;
  }

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const pad = Math.max(width, height) * 0.05;
  const viewBox = `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(width + pad * 2).toFixed(1)} ${(height + pad * 2).toFixed(1)}`;
  // 线宽/点大小跟着视口走，缩到 200px 宽也不会变成一根头发丝或一块黑。
  const stroke = Math.max(width, height) / 240;

  return <svg className="sc-case-thumb" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    {plan.boundary.length >= 3 && <polygon points={toPoints(plan.boundary)}
      fill="var(--space-tint, #eef2ef)" stroke="var(--space-line, #c8d3cd)" strokeWidth={stroke}/>}
    {plan.zones.map(zone => <polygon key={zone.id} points={toPoints(zone.polygon)}
      fill={zone.color ?? '#9fb3aa'} fillOpacity={zone.opacity ?? 0.28}
      stroke={zone.color ?? '#9fb3aa'} strokeOpacity={0.5} strokeWidth={stroke * 0.6}/>)}
    {plan.routes.map(route => <polyline key={route.id} points={toPoints(route.points)} fill="none"
      stroke={route.color ?? '#f2c744'} strokeWidth={stroke * 1.2}
      strokeDasharray={`${stroke * 4} ${stroke * 3}`} strokeLinecap="round"/>)}
    {plan.facilities.slice(0, MAX_FACILITY_DOTS).map(facility => <rect key={facility.id}
      x={facility.position.x - facility.size.width / 2}
      y={facility.position.y - facility.size.depth / 2}
      width={facility.size.width} height={facility.size.depth}
      fill={facility.color ?? 'var(--space-ink, #3d4b45)'} fillOpacity={0.8} rx={stroke * 0.5}
      transform={`rotate(${facility.rotationDeg} ${facility.position.x} ${facility.position.y})`}/>)}
  </svg>;
}
