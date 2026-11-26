'use client';

import { useMemo } from 'react';
import { readOutdoorProjectRecord } from '../lib/outdoor-project-store';
import { CaseThumb } from './case-thumb';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 项目卡预览的取图顺序：
 * 1. 本机封面（画布真实定格，见 lib/activity-cover）——所见即所得；
 * 2. 本机户外规划画成线稿缩略（与「经典案例」卡同一套画法）；
 * 3. 都没有就交回卡片的描边占位。
 *
 * 2026-11-18 用户：「删掉古早的那个室内的壳体」——卡片不再把云端 scene 重画成三维单帧。
 * 2026-11-26 壳体退役：旧 layout 平面顺位（区域/门只存在壳体 layout）随壳撤掉，
 * 云端项目卡只认 plan 正源，不再回读本机旧壳体归档。
 */

export interface ProjectThumbProps {
  projectId: string;
  /** 本机活动 id（从本机草稿升上云时保留）：规划与封面可能落在旧 id 上。 */
  aliasId?: string | undefined;
  /** 本机封面（data URL），可缺省。 */
  cover?: string | null;
  /** 一张图都没有时由卡片自己给的描边占位。 */
  fallback: JSX.Element;
}

function planHasContent(plan: SitePlanData | null): plan is SitePlanData {
  if (!plan) return false;
  return plan.boundary.length >= 3 || plan.zones.length > 0 || plan.facilities.length > 0 || plan.routes.length > 0;
}

export function ProjectThumb({ projectId, aliasId, cover, fallback }: ProjectThumbProps): JSX.Element {
  const plan = useMemo(() => {
    for (const id of [projectId, aliasId]) {
      if (!id) continue;
      try {
        const found = readOutdoorProjectRecord(id)?.plan ?? null;
        if (planHasContent(found)) return found;
      } catch { /* 记录读坏了就换下一个 id。 */ }
    }
    return null;
  }, [projectId, aliasId]);

  if (cover) return <img src={cover} alt=""/>;
  if (plan) return <CaseThumb plan={plan} basemap={false} className="sc-project-thumb"/>;
  return fallback;
}
