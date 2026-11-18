'use client';

import { caseBasemapTiles } from '../lib/case-basemap';
import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 2026-11-17 用户：「经典案例我要的也是和其他的视觉一样的卡片预览图」。
 *
 * 案例卡要和示例场景同一套卡形（16:10 预览 + 名称 + 一行元信息），所以这里给每案画一张缩略。
 * 画的是**这一案复刻出来的方案本身**（边界 + 分区 + 设施 + 流线），不是 OnePlan 的参考截图——
 * 参考图版权归 OnePlan，只放 learning-library 内部学习，不进 frontend/public。
 * 好处是卡片所见即所得：点开进 2D 规划看到的就是这张图放大后的东西。
 *
 * 2026-11-18 用户：「经典案例卡片可以给背后加底图吗」——线稿下面铺该锚点的真实卫星瓦片
 * （取图口径见 lib/case-basemap，与 2D 画布同源）。瓦片加载不出来时仍只剩线稿与浅色底，
 * 不额外造占位图。
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
  const vbX = minX - pad;
  const vbY = -maxY - pad;
  const vbW = width + pad * 2;
  const vbH = height + pad * 2;
  const viewBox = `${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`;
  // 线宽/点大小跟着视口走，缩到 200px 宽也不会变成一根头发丝或一块黑。
  const stroke = Math.max(width, height) / 240;
  // 底图按真实锚点取瓦片；SVG 里 y 向下、ENU 的 y 向北，图片单独放在未翻转的坐标里画。
  const basemap = caseBasemapTiles({ anchor: plan.anchor ?? null, bounds: { minX, minY, maxX, maxY } });
  const creditSize = Math.max(width, height) * 0.05;

  return <svg className="sc-case-thumb" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    {basemap && <g className="sc-case-thumb-ground">
      {basemap.tiles.map(tile => <image key={tile.url} href={tile.url}
        x={tile.rect.x} y={-(tile.rect.y + tile.rect.height)}
        width={tile.rect.width} height={tile.rect.height} preserveAspectRatio="none"/>)}
      {/* 压一层淡墨：线稿的浅色分区压得住影像，又不把地面糊死。 */}
      <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="#0c1a14" opacity={0.2}/>
      <text className="sc-case-thumb-credit" x={vbX + vbW - stroke * 2} y={vbY + vbH - stroke * 2}
        textAnchor="end" fontSize={creditSize} fill="#ffffff" fillOpacity={0.72}
        stroke="#0c1a14" strokeOpacity={0.5} strokeWidth={creditSize * 0.18}
        paintOrder="stroke" letterSpacing={creditSize * 0.04}>{basemap.credit}</text>
    </g>}
    {/* ENU 的 +Y 为北，SVG 的 +Y 向下；与编辑器北向一致，不能把案例上下镜像。 */}
    <g transform="scale(1 -1)">
    {plan.boundary.length >= 3 && <polygon points={toPoints(plan.boundary)}
      fill="var(--space-tint, #eef2ef)" fillOpacity={basemap ? 0.06 : 1}
      stroke={basemap ? '#ffffff' : 'var(--space-line, #c8d3cd)'} strokeOpacity={basemap ? 0.9 : 1} strokeWidth={stroke}/>}
    {plan.zones.map(zone => <polygon key={zone.id} points={toPoints(zone.polygon)}
      fill={zone.color ?? '#9fb3aa'} fillOpacity={zone.opacity ?? 0.28}
      stroke={zone.color ?? '#9fb3aa'} strokeOpacity={0.5} strokeWidth={stroke * 0.6}/>)}
    {plan.routes.map(route => <polyline key={route.id} points={toPoints(route.points)} fill="none"
      stroke={route.color ?? '#f2c744'} strokeWidth={stroke * 1.2}
      strokeDasharray={route.kind === 'vehicle' ? `${stroke * 4} ${stroke * 3}` : undefined} strokeLinecap="round"/>)}
    {plan.facilities.slice(0, MAX_FACILITY_DOTS).map(facility => <rect key={facility.id}
      x={facility.position.x - facility.size.width / 2}
      y={facility.position.y - facility.size.depth / 2}
      width={facility.size.width} height={facility.size.depth}
      fill={facility.color ?? 'var(--space-ink, #3d4b45)'} fillOpacity={0.8}
      stroke={basemap ? '#ffffff' : 'none'} strokeOpacity={0.45} strokeWidth={stroke * 0.22} rx={stroke * 0.5}
      transform={`rotate(${facility.rotationDeg} ${facility.position.x} ${facility.position.y})`}/>)}
    </g>
  </svg>;
}
