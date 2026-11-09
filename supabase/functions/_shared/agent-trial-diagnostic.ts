/** Minimal business outcomes for explicitly enabled isolated trials only. */
export type AgentTrialDiagnostic =
  | {tool:'validate_candidate';valid:boolean;errorCode?:string}
  | {tool:'submit_candidates';accepted:number;expected:number;errorCodes:string[]}
  | {tool:'model_round';turn:number;phase:'start'|'response'|'failed';remainingMs:number;elapsedMs?:number};

const errors=new Set(['AGENT_TOOL_FAILED','ASSET_MATERIAL_UNSUPPORTED','CANDIDATE_GEOMETRY_CONFLICT','CANDIDATES_NOT_DISTINCT','DIMENSION_CONFLICT','DIMENSION_TARGET_REQUIRED','INVALID_MATERIAL_TARGET','INVALID_SELECTION','INVALID_TOOL_INPUT','LAYOUT_DOES_NOT_FIT','LAYOUT_REQUIRES_EMPTY_SCENE','OBJECT_LOCKED','OBJECT_NOT_FOUND','OUT_OF_BOUNDS','PREPARED_CANDIDATE_NOT_FOUND','VALIDATED_CANDIDATE_NOT_FOUND','RESOURCE_NOT_FOUND','RESOURCE_SIZE_REQUIRED','SEATING_ALLOCATION_CONFLICT','SEATING_ALLOCATION_UNCONFIRMED','SEATING_SPEC_CONFLICT','SEATING_SPEC_UNCONFIRMED','STRUCTURAL_COLLISION']);
function code(value:unknown):string|undefined {
  return typeof value==='string'&&errors.has(value)?value:undefined;
}
export function trialValidationDiagnostic(result:unknown):AgentTrialDiagnostic|null {
  if(!result||typeof result!=='object'||!('valid' in result)||typeof result.valid!=='boolean')return null;
  const error=code('code' in result?result.code:'errorCode' in result?result.errorCode:undefined);
  return {tool:'validate_candidate',valid:result.valid,...(error?{errorCode:error}:{})};
}
export function trialSubmissionDiagnostic(accepted:number,expected:number,issues:unknown[]):AgentTrialDiagnostic|null {
  if(!Number.isSafeInteger(accepted)||accepted<0||accepted>3||!Number.isSafeInteger(expected)||expected<1||expected>3||issues.length>3)return null;
  const errorCodes=[...new Set(issues.flatMap(issue=>{
    const item=issue&&typeof issue==='object'&&'code' in issue?code(issue.code):undefined;
    return item?[item]:[];
  }))];
  return {tool:'submit_candidates',accepted,expected,errorCodes};
}
/** Numeric timings only: no content, request IDs, URLs, arguments or credentials. */
export function trialModelRoundDiagnostic(turn:unknown,phase:unknown,remainingMs:unknown,elapsedMs?:unknown):AgentTrialDiagnostic|null {
  if(!Number.isSafeInteger(turn)||Number(turn)<1||Number(turn)>6||typeof phase!=='string'||!['start','response','failed'].includes(phase)||!Number.isSafeInteger(remainingMs)||Number(remainingMs)<0||Number(remainingMs)>900_000)return null;
  if(phase==='start'&&elapsedMs!==undefined)return null;
  if(phase!=='start'&&(!Number.isSafeInteger(elapsedMs)||Number(elapsedMs)<0||Number(elapsedMs)>900_000))return null;
  return {tool:'model_round',turn:Number(turn),phase:phase as 'start'|'response'|'failed',remainingMs:Number(remainingMs),...(elapsedMs===undefined?{}:{elapsedMs:Number(elapsedMs)})};
}
