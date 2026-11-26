'use client';

import { useEffect, useMemo, useState } from 'react';
import { readLocalActivity } from '@/lib/local-activities';
import { readOutdoorProjectRecord } from '../lib/outdoor-project-store';
import { CaseThumb } from './case-thumb';
import { PlanThumb } from './plan-thumb';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { RoomLayout } from '../lib/types';

/**
 * 项目卡预览的取图顺序：
 * 1. 本机封面（画布真实定格，见 lib/activity-cover）——所见即所得；
 * 2. 本机平面（含区域标注与门，这些只存在 layout 里，不进云端 scene）——画成 2D 平面缩略；
 * 3. 本机户外规划画成线稿缩略（与「经典案例」卡同一套画法）；
 * 4. 都没有就交回卡片的描边占位。
 *
 * 2026-11-18 用户：「删掉古早的那个室内的壳体」——卡片不再把云端 scene 重画成三维单帧，
 * 那种只认场地/物料的空房间既看不出区域与门，也会让每张卡长得一模一样。
 */

export interface ProjectThumbProps {
  projectId: string;
  /** 本机活动 id（从本机草稿升上云时保留）：布局、规划与封面可能落在旧 id 上。 */
  aliasId?: string | undefined;
  /** 本机封面（data URL），可缺省。 */
  cover?: string | null;
  /** 一张图都没有时由卡片自己给的描边占位。 */
  fallback: JSX.Element;
  /** 首屏内的卡立即画，不等 IntersectionObserver。 */
  eager?: boolean;
}

function layoutHasContent(layout: RoomLayout): boolean {
  return layout.floors.some(floor =>
    (floor.zones?.length ?? 0) > 0 || floor.items.length > 0);
}

function planHasContent(plan: SitePlanData | null): plan is SitePlanData {
  if (!plan) return false;
  return plan.boundary.length >= 3 || plan.zones.length > 0 || plan.facilities.length > 0 || plan.routes.length > 0;
}

export function ProjectThumb({ projectId, aliasId, cover, fallback, eager = false }: ProjectThumbProps): JSX.Element {
  // 本机平面：区域标注与门只存在活动归档里（云端契约不收区域），所以异步读一次。
  const [layout, setLayout] = useState<RoomLayout | null>(null);
  useEffect(() => {
    let active = true;
    setLayout(null);
    void (async () => {
      for (const id of [projectId, aliasId]) {
        if (!id) continue;
        try {
          const candidate = await readLocalActivity(id);
          if (!active) return;
          if (layoutHasContent(candidate.layout)) { setLayout(candidate.layout); return; }
        } catch { /* 没有这份本机归档就试下一个 id；预览不值得拦下卡片。 */ }
      }
    })();
    return () => { active = false; };
  }, [projectId, aliasId]);

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
  if (layout) return <PlanThumb layout={layout} width={320} height={190} eager={eager} className="sc-project-plan"/>;
  if (plan) return <CaseThumb plan={plan} basemap={false} className="sc-project-thumb"/>;
  return fallback;
}
