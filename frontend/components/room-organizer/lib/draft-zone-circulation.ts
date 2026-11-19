import type { PlanFacility, PlanPoint, PlanZone, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { eventLayoutPath } from './event-layout-path';
import { clearForObject } from './outdoor-agent-planning';
import { facilityFootprintRing } from './site-plan-facilities';
import { outdoorCorridorStrips, outdoorRingsOverlap } from './outdoor-event-logic';
import { planPointInRing } from './site-plan-editing';

const center=(zone:PlanZone):PlanPoint=>({x:zone.polygon.reduce((sum,p)=>sum+p.x,0)/zone.polygon.length,y:zone.polygon.reduce((sum,p)=>sum+p.y,0)/zone.polygon.length});
const movable=(facility:PlanFacility)=>Boolean(facility.allocationKey||facility.notes.startsWith('复用我的物料库'))
  && !/固定|锁定|不可移动|保留原位|所属桌号/.test(facility.notes)
  && !facility.allocationKey?.includes('banquet-');

export async function draftZoneCirculation(input:{plan:SitePlanData;hardBlocks:PlanPoint[][];signal:AbortSignal}):Promise<{plan:SitePlanData;notes:string[]}>{
  let plan:SitePlanData={...input.plan,facilities:[...input.plan.facilities],routes:[...input.plan.routes],annotations:[...(input.plan.annotations??[])]};
  const notes:string[]=[],pairs:Array<{from:PlanZone;to:PlanZone;service:boolean}>=[];
  const zones=plan.zones.filter(zone=>zone.environment!=='indoor');
  const add=(from:PlanZone|undefined,to:PlanZone|undefined,service=false)=>{
    if(from&&to&&from.id!==to.id&&!pairs.some(pair=>pair.from.id===from.id&&pair.to.id===to.id))pairs.push({from,to,service});
  };
  const welcome=zones.find(zone=>/签到|迎宾/.test(zone.name));
  const guests=zones.find(zone=>/宾客|席位|观众/.test(zone.name))??zones.find(zone=>zone.purpose==='audience');
  const ceremony=zones.find(zone=>/仪式|证婚|舞台/.test(zone.name));
  const food=zones.find(zone=>/餐饮|宴席|宴会|餐区/.test(zone.name));
  add(welcome,guests??ceremony);add(guests,ceremony);add(guests??welcome,food,true);
  for(const zone of zones){
    if(pairs.some(pair=>pair.from.id===zone.id||pair.to.id===zone.id))continue;
    const others=zones.filter(other=>other.id!==zone.id).sort((a,b)=>Math.hypot(center(a).x-center(zone).x,center(a).y-center(zone).y)-Math.hypot(center(b).x-center(zone).x,center(b).y-center(zone).y));
    add(others[0],zone,zone.purpose==='service');
  }
  const moved=new Set<string>();let pending=0,added=0;
  const pointFor=(zone:PlanZone):PlanPoint=>{
    const c=center(zone),xs=zone.polygon.map(p=>p.x),ys=zone.polygon.map(p=>p.y),candidates=[c];
    for(let y=1;y<10;y++)for(let x=1;x<10;x++)candidates.push({x:Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*x/10,y:Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*y/10});
    candidates.sort((a,b)=>Math.hypot(a.x-c.x,a.y-c.y)-Math.hypot(b.x-c.x,b.y-c.y));
    return candidates.find(p=>planPointInRing(p,zone.polygon)&&!plan.facilities.some(f=>planPointInRing(p,facilityFootprintRing(f))))
      ??candidates.find(p=>planPointInRing(p,zone.polygon))??zone.polygon[0];
  };
  for(const pair of pairs){
    input.signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,0));
    const name=`草案接驳：${pair.from.name}→${pair.to.name}`.slice(0,60);
    if(plan.routes.some(route=>route.name===name))continue;
    const start=pointFor(pair.from),end=pointFor(pair.to);
    const hard=[...input.hardBlocks,...(plan.buildings??[]).map(building=>building.points),
      ...plan.zones.filter(zone=>zone.id!==pair.from.id&&zone.id!==pair.to.id&&(zone.environment==='indoor'||['performance','exhibition'].includes(zone.purpose??''))).map(zone=>zone.polygon)];
    const path=(source:SitePlanData,widthM:number)=>eventLayoutPath({boundary:source.boundary,blocked:[...hard,...source.facilities.map(facilityFootprintRing)],start,end,widthM});
    let widthM=2,points=path(plan,widthM);
    if(!points){
      const corridor=outdoorCorridorStrips([start,end],2);
cial:      for(const facility of plan.facilities.filter(item=>movable(item)&&corridor.some(strip=>outdoorRingsOverlap(strip,facilityFootprintRing(item))))){
        const zone=plan.zones.find(item=>item.id===facility.zoneId);if(!zone)continue;
        const old=plan;
        const without={...plan,facilities:plan.facilities.filter(item=>item.id!==facility.id),routes:[...plan.routes,{id:crypto.randomUUID(),name:'预留接驳',kind:'pedestrian' as const,points:[start,end],widthM:2,oneWay:false,notes:'调整时临时预留，不写入方案'}]};
        const xs=zone.polygon.map(p=>p.x),ys=zone.polygon.map(p=>p.y),step=Math.max(0.75,facility.size.width,facility.size.depth);
        const positions:PlanPoint[]=[];
        for(let y=Math.min(...ys)+step/2;y<Math.max(...ys)&&positions.length<1200;y+=step)
          for(let x=Math.min(...xs)+step/2;x<Math.max(...xs)&&positions.length<1200;x+=step)positions.push({x,y});
        positions.sort((a,b)=>Math.hypot(a.x-facility.position.x,a.y-facility.position.y)-Math.hypot(b.x-facility.position.x,b.y-facility.position.y));
        const position=positions.find(p=>{const next={...facility,position:p};return clearForObject(next,without,zone)&&!hard.some(ring=>outdoorRingsOverlap(facilityFootprintRing(next),ring));});
        if(position){plan={...plan,facilities:plan.facilities.map(item=>item.id===facility.id?{...item,position}:item)};moved.add(facility.id);}
        else plan=old;
        input.signal.throwIfAborted();
      }
      points=path(plan,widthM);
    }
    if(!points)for(const candidate of [1.5,1.2]){const result=path(plan,candidate);if(result){widthM=candidate;points=result;break;}}
    if(points){
      plan.routes.push({id:crypto.randomUUID(),name,kind:pair.service?'service':'pedestrian',carrier:'walk',points,widthM,oneWay:false,
        audiences:pair.service?['service','staff','security']:['visitors','staff','security'],
        notes:`Agent 草案接驳；${widthM}米为本版设计宽度，不代表实测或通行认证。`});
      added++;
      if(widthM<2)notes.push(`${pair.from.name}→${pair.to.name}先按 ${widthM} 米给出可调整草案，目标 2 米尚未满足。`);
    }else{
      pending++;
      if((plan.annotations?.length??0)<498)plan.annotations!.push(
        {id:crypto.randomUUID(),kind:'line',name:`待调整连接：${pair.from.name}→${pair.to.name}`.slice(0,60),points:[start,end],color:'#96651f',strokeWidth:'thin',text:'',notes:'仅连接意图，尚未贯通；不是可行走路线，不用于人群和岗位路径。'},
        {id:crypto.randomUUID(),kind:'note',name:'连接意图说明',points:[start],text:`${pair.from.name}→${pair.to.name}：先标出连接意图，需继续调整局部物件或分区。`.slice(0,200),notes:'待完善的草案内容，不是通行结论。'});
    }
  }
  notes.unshift(`先给出本版连接方案：新增 ${added} 条通路，调整 ${moved.size} 件可移动物料。`);
  if(pending)notes.push(`${pending} 处暂未贯通，已用说明线标在画布上；这些线不是可行走路线，其余可用部分保留，可继续用聊天修改。`);
  if(!pairs.length){notes.push('当前没有两处可连接的分区，保留现有布局；可直接说需要连接哪些区域。');}
  return{plan,notes};
}
