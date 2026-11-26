/**
 * 旧纯室内草稿判定与「另存为户外新场地」迁移（S3-4，2026-11-26 裁定）。
 *
 * 裁定：不造 layout↔plan 互转层。旧壳体（室内）项目没有绑定户外 plan 记录时，
 * 只读打开；用户显式「另存为户外新场地」才起一份新的户外草稿。
 *
 * 迁移口径：
 * - 可迁：方案名等元信息；
 * - 不外带：墙体、楼层、室内分区、壳体物件几何（坐标体系与 plan 不同构，不做自动转换）；
 * - 不伪造空场：新场地用起步 outdoor plan（默认地理锚点、空边界），与新建活动一致。
 */

import type { RoomLayout } from './types';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { createStarterOutdoorPlan, type OutdoorProjectRecord } from './outdoor-project-store';
import { randomSuffix } from './ids';

/** 壳体楼层里算作「旧室内有内容」的字段：物件 / 分区 / 室内隔墙。 */
function shellHasContent(layout: RoomLayout): boolean {
  const floor = layout.floors[0];
  if (!floor) return false;
  const items = floor.items.length > 0;
  const zones = (floor.zones?.length ?? 0) > 0;
  const interiorWalls = (floor.interiorWalls?.length ?? 0) > 0;
  return items || zones || interiorWalls;
}

/**
 * 是否旧纯室内草稿：
 * - 已绑户外 plan（`plan != null`）→ 不是，按户外项目编辑；
 * - 壳体无任何内容 → 不是，属空起步草稿，放行编辑；
 * - 否则壳体带旧室内内容且无 plan → 旧纯室内，只读。
 *
 * 身份排除（云项目 / 案例副本 / 本机草稿槽）由调用方结合 projectId 判定，本函数只看内容与 plan。
 */
export function isLegacyIndoorDraft(layout: RoomLayout, plan: SitePlanData | null): boolean {
  if (plan != null) return false;
  return shellHasContent(layout);
}

/** 另存迁移结果：待写入新户外草稿记录；旧壳体物件 / 墙体 / 楼层不进入。 */
export interface OutdoorSaveAsDraft {
  record: OutdoorProjectRecord;
}

/**
 * 从旧室内方案准备一份新的户外草稿记录。
 * 只迁方案名（元信息）；plan 用起步空场，不带墙体 / 楼层 / 室内分区 / 物件几何，
 * 也不带旧壳体 sceneAnchor（与 plan.anchor 不同构）。
 */
export function prepareOutdoorSaveAs(layout: RoomLayout): OutdoorSaveAsDraft {
  const now = new Date().toISOString();
  const nextId = `house-${randomSuffix()}${randomSuffix()}`;
  const sourceName = layout.name?.trim();
  const name = sourceName ? `${sourceName}（户外新场地）` : '未命名活动（户外新场地）';
  const record: OutdoorProjectRecord = {
    v: 1,
    projectId: nextId,
    name,
    createdAt: now,
    updatedAt: now,
    plan: createStarterOutdoorPlan(),
  };
  return { record };
}
