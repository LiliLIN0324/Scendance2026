import {isStructuralMarker} from './structural-layout';
import type {FurnitureItem,RoomLayout} from './types';
/** Same visible ID-based scope as the candidate diff; structural markers are not event materials. */
export function generationMaterialDiff(before:RoomLayout,after:RoomLayout):{added:FurnitureItem[];removed:FurnitureItem[]} {
  const old=before.floors.flatMap(f=>f.items),next=after.floors.flatMap(f=>f.items);
  const oldIds=new Set(old.map(item=>item.id)),nextIds=new Set(next.map(item=>item.id));
  return {added:next.filter(item=>!oldIds.has(item.id)&&!isStructuralMarker(item)),removed:old.filter(item=>!nextIds.has(item.id)&&!isStructuralMarker(item))};
}
