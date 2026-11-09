import { preserveCurrentActivity } from '../../../lib/production-plan';
import { backendSceneToLayout } from './backend-adapter';
import { randomId } from './ids';
import { buildVenueShell } from './venue-shell';
import type { FurnitureItem, RoomLayout } from './types';

/** A fictional, editable example; dimensions and availability are not site evidence. */
export function createSharingExample(before: RoomLayout): RoomLayout {
  // The example replaces one floor. Do not silently discard additional floors,
  // zones or locked objects while reusing the existing activity identity.
  if(before.floors.length!==1)throw new Error('当前活动有多个楼层，请先新建活动再使用示例；原布置未更改。');
  if((before.floors[0]!.zones?.length??0)>0)throw new Error('当前场地有区域标注，请先新建活动再使用示例；原布置未更改。');
  if(before.floors[0]!.items.some(item=>item.locked))throw new Error('当前场地有锁定物件，请先新建活动再使用示例；原布置未更改。');
  const shell=buildVenueShell({widthM:12,depthM:10,indoorOutdoor:'indoor',scaleOrigin:'canvas'});
  const next=preserveCurrentActivity(before,backendSceneToLayout(shell,{
    name:before.name,...(before.id?{projectId:before.id}:{}),
  }));
  const common={rotation:0,locked:false,source:'builtin' as const};
  const backdrop: FurnitureItem={...common,id:randomId('item'),type:'backdrop',name:'分享区背景',icon:'景',
    width:3,depth:0.2,height:2.4,color:'#375B4B',position:{x:2.5,z:-4.5}};
  const presenter: FurnitureItem={...common,id:randomId('item'),type:'table',name:'主讲桌',icon:'桌',
    width:1.2,depth:0.6,height:0.75,color:'#C9B89D',position:{x:2.5,z:-3.5}};
  const seats: FurnitureItem[]=[];
  for(const z of [-1.6,0.05,1.7,3.35]) for(const x of [-2.7,-1.05,1.05,2.7]) seats.push({
    ...common,id:randomId('item'),type:'chair',name:'听众座椅',icon:'椅',width:0.5,depth:0.5,height:0.85,
    color:'#4A7C59',position:{x,z},rotation:Math.PI,
  });
  const floors=next.floors.map((floor,index)=>index===0?{...floor,id:before.floors[0]!.id,items:[...floor.items,backdrop,presenter,...seats]}:floor);
  return {...next,floors};
}
