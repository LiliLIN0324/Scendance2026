import type {PlanPoint} from '@/lib/plan-annotation';
import type {UserRouteBinding} from '../hooks/use-plan-annotations';

/** One drawing gesture, independent of React render timing and updater replays. */
export function createRouteDrawingSession(capture:()=>UserRouteBinding|null,commit:(points:PlanPoint[],binding:UserRouteBinding)=>boolean) {
 let binding:UserRouteBinding|null=null,points:PlanPoint[]=[],closed=false;
 const current=()=>{try{return !!binding&&binding.isCurrent()&&(!binding.isDrawingCurrent||binding.isDrawingCurrent());}catch{return false;}};
 const clear=()=>{closed=true;binding=null;points=[];};
 return {
  points:()=>points.map(point=>({...point})),
  add(point:PlanPoint):'added'|'invalidated'|'unavailable' {
   if(closed||!Number.isFinite(point.x)||!Number.isFinite(point.z))return 'unavailable';
   if(!binding){try{binding=capture();}catch{return 'unavailable';}if(!binding||!current()){clear();return 'unavailable';}}
   if(!current()){clear();return 'invalidated';}
   points=[...points,{x:point.x,z:point.z}];return 'added';
  },
  revalidate():boolean {if(!binding||closed)return true;if(current())return true;clear();return false;},
  finish():'committed'|'short'|'invalidated'|'failed'|'closed' {
   if(closed)return 'closed';
   if(!binding||points.length<2){clear();return 'short';}
   if(!current()){clear();return 'invalidated';}
   const chosen=binding,copy=points.map(point=>({...point}));clear();
   try{return chosen.isCurrent()&&(!chosen.isDrawingCurrent||chosen.isDrawingCurrent())&&commit(copy,chosen)?'committed':'failed';}catch{return 'failed';}
  },
  cancel:clear,
 };
}
