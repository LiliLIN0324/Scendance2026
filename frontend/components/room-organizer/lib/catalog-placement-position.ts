import { executeSceneCommand, placeItemCommand } from '@/lib/build-command';
import { floorKeepOut } from './floor-keep-out';
import { findFreePosition,hasCollisions } from './geometry';
import { canApplyLayoutGeometry } from './structural-layout';
import type { CatalogItem, FurnitureItem, RoomLayout } from './types';

export type CatalogPositionResult =
  | { ok:true; position:{x:number;z:number} }
  | { ok:false; reason:string; code:string; item:FurnitureItem };

/** Search is local to the centre; explicit user positions are never moved. */
export function resolveCatalogPosition(layout:RoomLayout,floorIndex:number,item:CatalogItem,trialId:string,position?:{x:number;z:number}):CatalogPositionResult {
  const floor=layout.floors[floorIndex];
  const trial={...item,id:trialId,position:position??{x:0,z:0},rotation:0} as FurnitureItem;
  if(!floor)return {ok:false,reason:'当前楼层无法读取，请重新选择。',code:'FLOOR_OUT_OF_RANGE',item:trial};
  const context={interiorWalls:floor.interiorWalls??[],keepOut:floorKeepOut(layout,floorIndex)};
  const check=(point:{x:number;z:number}):CatalogPositionResult=>{
    const positioned={...trial,position:point};
    if(hasCollisions(positioned,floor.items,layout.width,layout.height,context))return {ok:false,reason:'此位置与物件或保留区域冲突，请点击其他位置。',code:'POSITION_CONFLICT',item:positioned};
    const checked=executeSceneCommand(placeItemCommand({floorIndex,item:positioned}),{layout});
    if(!checked.ok)return {ok:false,reason:checked.refused[0]?.message??checked.preconditions[0]?.message??(checked.shapeIssues.map(issue=>issue.message).join('；')||'落点不合法'),
      code:checked.refused[0]?.code??checked.preconditions[0]?.code??'SHAPE_INVALID',item:positioned};
    if(!canApplyLayoutGeometry(layout,checked.nextLayout))return {ok:false,reason:'此位置与场地结构冲突，请点击其他位置。',code:'STRUCTURAL_COLLISION',item:positioned};
    return {ok:true,position:point};
  };
  if(position)return check(position);
  const resolved=findFreePosition({item:trial,others:floor.items,roomWidth:layout.width,roomDepth:layout.height,
    context,accept:point=>check(point).ok});
  if(!resolved)return {ok:false,reason:'附近没有找到可用位置，请点击场地或移动物件。',code:'NO_NEARBY_POSITION',item:trial};
  return {ok:true,position:resolved};
}
