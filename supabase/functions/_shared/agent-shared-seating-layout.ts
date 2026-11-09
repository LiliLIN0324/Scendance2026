import { z } from 'zod';
import { ApiError, objectSchema, sceneSchema, uuid, type Scene } from './domain.ts';
import { deskChairLayoutSchema, planDeskChairGroups } from './agent-seating-layout.ts';

/** Two independent chairs per table; all dimensions and spacing are explicit assumptions. */
export const sharedDeskLayoutSchema=deskChairLayoutSchema.extend({layout:z.literal('two_people_per_desk'),chairGap:z.number().min(0.01).max(5)});
export type SharedDeskLayoutInput=z.infer<typeof sharedDeskLayoutSchema>;
export function planSharedDesks(original:Scene,raw:SharedDeskLayoutInput,idFactory:(index:number)=>string) {
  const scene=sceneSchema.parse(original),input=sharedDeskLayoutSchema.parse(raw);
  if(typeof idFactory!=='function')throw new ApiError('SEATING_ID_FACTORY_REQUIRED',422);
  const virtualWidth=2*input.chairSize.width+input.chairGap;
  if(virtualWidth>200)throw new ApiError('INVALID_TOOL_INPUT',422);
  // Two people require two usable positions along the same desk edge.  The
  // enclosing footprint can fit in the room even when the desk is too narrow.
  if(input.count>1&&virtualWidth>input.deskSize.width+1e-6)throw new ApiError('SEATING_DESK_TOO_NARROW',422);
  // The virtual chair encloses both independent chairs, so existing collision and
  // boundary checks conservatively cover the entire pair, including their gap.
  const available=Math.max(0,50-scene.objects.length);
  const maxTables=Math.floor(available/3)+(available%3>=2?1:0);
  const wantedTables=Math.ceil(input.count/2),groups=Math.min(maxTables,wantedTables);
  const used=new Set((JSON.stringify(scene).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)??[]).map(v=>v.toLowerCase()));
  let sequence=0;
  const fresh=()=>{for(let tries=0;tries<100;tries++){const value=uuid.safeParse(idFactory(sequence++));if(!value.success)throw new ApiError('SEATING_ID_INVALID',422);const id=value.data.toLowerCase();if(!used.has(id)){used.add(id);return id;}}throw new ApiError('SEATING_ID_COLLISION',422);};
  const {layout:_,chairGap:__,...rest}=input;void _;void __;
  const trial=planDeskChairGroups(scene,{...rest,layout:'one_desk_one_chair',count:Math.max(1,groups),chairSize:{...input.chairSize,width:virtualWidth}},fresh);
  const base=trial.scene.objects.slice(0,scene.objects.length),generated=trial.scene.objects.slice(scene.objects.length),out=[...base];
  let seated=0;
  for(let i=0;i<generated.length;i+=2){
    const desk=generated[i]!,virtual=generated[i+1]!;
    const remaining=Math.min(input.count-seated,available-out.length+scene.objects.length-1);
    const seats=Math.min(2,remaining);
    if(seats<1)break;
    out.push(desk);
    const offset=(input.chairSize.width+input.chairGap)/2;
    for(let j=0;j<seats;j++)out.push(objectSchema.parse({...virtual,id:j===0?virtual.id:fresh(),size:input.chairSize,position:{...virtual.position,x:virtual.position.x+(seats===1?0:j===0?-offset:offset)}}));
    seated+=seats;
  }
  const tables=(out.length-scene.objects.length-seated),shortfall=input.count-seated;
  const maxSeats=Math.floor(available/3)*2+(available%3>=2?1:0);
  const limitReason=shortfall===0?null:seated>=maxSeats?'object_limit':trial.limitReason??'no_placement';
  return {scene:sceneSchema.parse({...trial.scene,objects:out}),requestedPeople:input.count,placedPeople:seated,tables,shortfall,limitReason,assumptions:input,unknown:trial.unknown};
}
