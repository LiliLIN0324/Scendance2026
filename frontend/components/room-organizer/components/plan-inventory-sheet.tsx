'use client';

import { formatAreaM2, formatLengthM, type PlanOverviewStats } from '../lib/site-plan-measure';

/** 清单列表还没有任何行。统计行不靠这个判断隐藏。 */
export function planListIsBlank(inventoryCount: number): boolean {
  return inventoryCount === 0;
}

/** 没有闭合红线时面积用 —；有红线就显示算出的面积，包括 0。 */
export function planStatAreaLabel(areaM2: number, hasClosedBoundary: boolean): string {
  if (!hasClosedBoundary) return '—';
  return formatAreaM2(areaM2);
}

/** 没有动线时只写 0，不写成「0 条 · 0 m」。 */
export function planStatRouteLabel(routeCount: number, lengthM: number): string {
  if (routeCount <= 0) return '0';
  return `${routeCount} 条 · ${formatLengthM(lengthM)}`;
}

/** 兼容旧测试名：空清单且没有面积、分区和问题。 */
export function planSheetIsEmpty(stats: PlanOverviewStats, inventoryCount: number): boolean {
  return planListIsBlank(inventoryCount)
    && stats.boundaryAreaM2 <= 0
    && stats.zoneCount === 0
    && stats.facilityCount === 0
    && stats.routeCount === 0
    && stats.issueCount + stats.conflictCount === 0;
}

export interface PlanStatRowsProps {
  areaM2: number;
  hasClosedBoundary: boolean;
  zones: number;
  facilities: number;
  routes: number;
  routeLengthM: number;
  issues: number;
  issuesOnly: boolean;
  onShowIssues: () => void;
}

/** 清单页顶部：一行一项，左边标签、右边数值。空方案也保留这四行。 */
export function PlanStatRows({
  areaM2,
  hasClosedBoundary,
  zones,
  facilities,
  routes,
  routeLengthM,
  issues,
  issuesOnly,
  onShowIssues,
}: PlanStatRowsProps): JSX.Element {
  return (
    <div className="sc-plan-stats">
      <dl data-testid="info-overview-stats">
        <div>
          <dt>场地面积</dt>
          <dd>{planStatAreaLabel(areaM2, hasClosedBoundary)}</dd>
        </div>
        <div>
          <dt>分区 / 设施</dt>
          <dd>{zones} / {facilities}</dd>
        </div>
        <div>
          <dt>动线</dt>
          <dd>{planStatRouteLabel(routes, routeLengthM)}</dd>
        </div>
        <div>
          <dt>待处理问题</dt>
          <dd>
            <button
              type="button"
              className={issues > 0 ? 'is-alert' : undefined}
              data-testid="info-issue-count"
              aria-pressed={issuesOnly}
              onClick={onShowIssues}
            >
              {issues}
            </button>
          </dd>
        </div>
      </dl>
      <p className="sc-plan-stats-hint">点问题数只看有问题的行。隐藏图层不改这些数字。</p>
    </div>
  );
}
