'use client';

import type { PlanOverviewStats } from '../lib/site-plan-measure';

/** 空方案：没有边界、物料、人员，也没有待处理问题。这时不铺一屏 0。 */
export function planSheetIsEmpty(stats: PlanOverviewStats, inventoryCount: number): boolean {
  return inventoryCount === 0
    && stats.boundaryAreaM2 <= 0
    && stats.zoneCount === 0
    && stats.facilityCount === 0
    && stats.routeCount === 0
    && stats.nodeCount === 0
    && stats.workerTotalCount === 0
    && stats.vehicleTotalCount === 0
    && stats.measurementCount === 0
    && stats.annotationCount === 0
    && stats.issueCount + stats.conflictCount === 0;
}

export interface PlanStatRowsProps {
  area: string;
  zones: number;
  facilities: number;
  routes: number;
  routeLength: string;
  issues: number;
  issuesOnly: boolean;
  onShowIssues: () => void;
}

/** 清单页顶部：一行一项，左边标签、右边数值。 */
export function PlanStatRows({
  area,
  zones,
  facilities,
  routes,
  routeLength,
  issues,
  issuesOnly,
  onShowIssues,
}: PlanStatRowsProps): JSX.Element {
  return (
    <div className="sc-plan-stats">
      <dl data-testid="info-overview-stats">
        <div>
          <dt>场地面积</dt>
          <dd>{area}</dd>
        </div>
        <div>
          <dt>分区 / 设施</dt>
          <dd>{zones} / {facilities}</dd>
        </div>
        <div>
          <dt>动线</dt>
          <dd>{routes} 条 · {routeLength}</dd>
        </div>
        <div>
          <dt>待处理问题</dt>
          <dd>
            {issues > 0 ? (
              <button
                type="button"
                data-testid="info-issue-count"
                aria-pressed={issuesOnly}
                onClick={onShowIssues}
              >
                {issues}
              </button>
            ) : (
              <span data-testid="info-issue-count">0</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="sc-plan-stats-hint">点问题数只看有问题的行。隐藏图层不改这些数字。</p>
    </div>
  );
}
