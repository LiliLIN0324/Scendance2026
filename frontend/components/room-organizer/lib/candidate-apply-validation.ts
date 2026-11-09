import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import { layoutReducer } from '../hooks/layout-reducer';
import { withHouseId } from './ids';
import { parseLayoutEventOperations } from './schema';
import type { RoomLayout } from './types';

/** A preview may be committed only when the actual store reducer preserves every field. */
export type CandidateApplyValidation = { ok: true } | { ok: false; reason: string };

function hasDuplicateIds(layout: RoomLayout): boolean {
  const floorIds=new Set<string>(), itemIds=new Set<string>(), wallIds=new Set<string>(), zoneIds=new Set<string>();
  const add=(seen:Set<string>,id:unknown):boolean => {
    if(typeof id !== 'string' || !id.trim() || seen.has(id))return false;
    seen.add(id);return true;
  };
  for(const floor of layout.floors) {
    if(!add(floorIds,floor.id))return true;
    for(const item of floor.items)if(!add(itemIds,item.id))return true;
    for(const wall of floor.interiorWalls ?? [])if(!add(wallIds,wall.id))return true;
    for(const zone of floor.zones ?? [])if(!add(zoneIds,zone.id))return true;
  }
  return !!layout.designBook?.variants.some(variant=>hasDuplicateIds(variant.layout));
}

/**
 * Dry-run exactly the `applyLayout` reducer action, including the store's `withHouseId` step.
 * Missing identities are refused: minting a random identity during a dry-run is not deterministic.
 * Call again against the synchronous current store immediately before applying.
 */
export function validateCandidateApply(before: RoomLayout, candidate: RoomLayout, activeFloorIndex: number): CandidateApplyValidation {
  try {
    if (!candidate.id || !candidate.id.trim()) return {ok:false,reason:'候选缺少活动编号，未应用。'};
    if (!Number.isInteger(activeFloorIndex) || activeFloorIndex < 0 || activeFloorIndex >= before.floors.length) return {ok:false,reason:'当前楼层已变化，未应用。'};
    // Refuse getters, non-finite numbers and non-plain data before running the reducer.
    if (!sameRecoveryFormValue(candidate,candidate)) return {ok:false,reason:'候选数据无法核对，未应用。'};
    if (hasDuplicateIds(candidate)) return {ok:false,reason:'候选包含缺失或重复编号，未应用。'};
    for(const floor of before.floors) {
      const target=candidate.floors.find(value=>value.id===floor.id);
      if(!target)return {ok:false,reason:`候选未保留楼层「${floor.name}」，请先核对；原方案未更改。`};
      for(const zone of floor.zones ?? []) if(!(target.zones ?? []).some(value=>value.id===zone.id))
        return {ok:false,reason:`候选未保留区域「${zone.name}」，请先核对；原方案未更改。`};
      for(const item of floor.items) if(item.locked) {
        const preserved=target.items.find(value=>value.id===item.id);
        if(!preserved || !sameRecoveryFormValue(item,preserved))
          return {ok:false,reason:`候选未完整保留锁定物件「${item.name}」，请先核对；原方案未更改。`};
      }
    }
    if (!parseLayoutEventOperations(candidate)) return {ok:false,reason:'候选布局资料无效，未应用。'};
    const result=layoutReducer({layout:before,activeFloorIndex},{type:'applyLayout',layout:withHouseId(candidate)});
    if (!sameRecoveryFormValue(candidate,result.layout)) return {ok:false,reason:'应用过程会改变预览内容，未应用。请重新核对。'};
    return {ok:true};
  } catch {
    return {ok:false,reason:'候选数据无法完整核对，未应用。'};
  }
}
