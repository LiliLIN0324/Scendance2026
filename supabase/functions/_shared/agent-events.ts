/** Observations describe tool execution only, never model reasoning or safety approval. */
export const agentEventTools=['get_scene','search_resources','search_places','inspect_zone','find_free_areas','prepare_seating_candidate','prepare_shared_seating_candidate','create_parametric_model','inspect_materials','customize_material','validate_candidate','submit_candidates','get_bom','start_lux3d_model','get_outdoor_plan','prepare_plan_zones','prepare_plan_facilities','prepare_plan_routes','prepare_plan_workers','validate_plan_candidate','submit_plan_candidates'] as const;
export const agentEventErrors=['INVALID_TOOL_INPUT','UNKNOWN_TOOL','AGENT_TOOL_FAILED','CANDIDATE_GEOMETRY_CONFLICT','CANDIDATES_NOT_DISTINCT','DIMENSION_CONFLICT','INVALID_SELECTION','INVALID_MATERIAL_TARGET','OBJECT_LOCKED','OBJECT_NOT_FOUND','OUT_OF_BOUNDS','STRUCTURAL_COLLISION','RESOURCE_NOT_FOUND','PREPARED_CANDIDATE_NOT_FOUND','VALIDATED_CANDIDATE_NOT_FOUND','SEATING_ALLOCATION_CONFLICT','SEATING_ALLOCATION_UNCONFIRMED','SEATING_SPEC_CONFLICT','SEATING_SPEC_UNCONFIRMED','PLACE_SEARCH_FAILED','PLACE_SEARCH_UNAVAILABLE','PLAN_UNKNOWN_TEMPLATE','PLAN_UNKNOWN_ZONE','PLAN_UNKNOWN_NODE','PLAN_CANDIDATE_NOT_FOUND'] as const;
export type AgentEventTool=typeof agentEventTools[number];
export type AgentEvent={tool:AgentEventTool;stage:'started'|'finished';outcome:'success'|'failed'|'unknown'|null;errorCode:string|null;argsSummary?:string|null;durationMs?:number|null};
export function agentEventTool(value:string):value is AgentEventTool{return (agentEventTools as readonly string[]).includes(value);}
/** A returned response may encode a failed operation despite the call completing normally. */
export function agentEventOutcome(tool:AgentEventTool,value:unknown,expectedCandidates?:number):Pick<AgentEvent,'outcome'|'errorCode'> {
  if(!value||typeof value!=='object'||Array.isArray(value))return {outcome:'unknown',errorCode:null};
  const item=value as Record<string,unknown>;
  const code=typeof item.code==='string'&&(agentEventErrors as readonly string[]).includes(item.code)?item.code:null;
  if(typeof item.code==='string')return {outcome:'failed',errorCode:code};
  if(tool==='validate_candidate')return {outcome:item.valid===true?'success':item.valid===false?'failed':'unknown',errorCode:null};
  if(tool==='prepare_seating_candidate'||tool==='prepare_shared_seating_candidate'){
    // A partial layout or no prepared handle is a returned result, not a fulfilled request.
    if(!Number.isSafeInteger(item.shortfall)||Number(item.shortfall)!==0||typeof item.preparedId!=='string'||! /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.preparedId))return {outcome:'unknown',errorCode:null};
    return {outcome:'success',errorCode:null};
  }
  if(tool==='validate_plan_candidate')return {outcome:item.valid===true?'success':item.valid===false?'failed':'unknown',errorCode:null};
  if(tool==='prepare_plan_zones'||tool==='prepare_plan_facilities'||tool==='prepare_plan_routes'||tool==='prepare_plan_workers'){
    return typeof item.preparedId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.preparedId)?{outcome:'success',errorCode:null}:{outcome:'unknown',errorCode:null};
  }
  if(tool==='submit_plan_candidates'){
    if(!Number.isSafeInteger(item.accepted)||Number(item.accepted)<0||Number(item.accepted)>3)return {outcome:'unknown',errorCode:null};
    const errors=Array.isArray(item.errors)?item.errors:[];
    const first=errors.find((entry:unknown)=>entry&&typeof entry==='object'&&typeof (entry as {code?:unknown}).code==='string'&&(agentEventErrors as readonly string[]).includes((entry as {code:string}).code)) as {code:string}|undefined;
    return Number(item.accepted)===0?{outcome:'failed',errorCode:first?.code??null}:{outcome:'success',errorCode:null};
  }
  if(tool==='submit_candidates'){
    if(!Number.isSafeInteger(item.accepted)||Number(item.accepted)<0||Number(item.accepted)>3)return {outcome:'unknown',errorCode:null};
    const errors=Array.isArray(item.errors)?item.errors:[];
    const first=errors.find((entry:unknown)=>entry&&typeof entry==='object'&&typeof (entry as {code?:unknown}).code==='string'&&(agentEventErrors as readonly string[]).includes((entry as {code:string}).code)) as {code:string}|undefined;
    if(Number(item.accepted)===0)return {outcome:'failed',errorCode:first?.code??null};
    const expected=Number.isSafeInteger(expectedCandidates)&&Number(expectedCandidates)>=1&&Number(expectedCandidates)<=3?Number(expectedCandidates)
      :Number.isSafeInteger(item.expected)&&Number(item.expected)>=1&&Number(item.expected)<=3?Number(item.expected):null;
    return item.partial===true||expected===null||Number(item.accepted)!==expected?{outcome:'unknown',errorCode:null}:{outcome:'success',errorCode:null};
  }
  return {outcome:'success',errorCode:null};
}
