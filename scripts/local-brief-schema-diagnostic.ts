/** Isolated trial only. Zod issue messages, input values and unknown keys never leave this module. */
export const SCHEMA_ISSUE_CODES=['invalid_type','invalid_value','unrecognized_keys','too_big','too_small','invalid_union','invalid_format','not_multiple_of','custom','other'] as const;
export const SCHEMA_ISSUE_PATHS=['$','extraction','extraction.event','extraction.headcount','extraction.venueIO','extraction.lengthM','extraction.widthM','extraction.areaM2','extraction.layoutMode','extraction.timeOfDay','extraction.audienceTags','extraction.audienceTags[]','extraction.mobilityAssistance','extraction.proactiveReply','extraction.requirements','extraction.requirements[]','extraction.requirements[].key','extraction.requirements[].value','extraction.requirements[].mode','extraction.inventoryMentions','extraction.inventoryMentions[]','extraction.inventoryMentions[].evidence','extraction.activityNeeds','extraction.activityNeeds[]','extraction.activityNeeds[].kind','extraction.activityNeeds[].decision','extraction.activityNeeds[].evidence','reply','unhandled','unhandled[]','unhandled[].kind','unhandled[].evidence','factEvidence','factEvidence[]','factEvidence[].key','factEvidence[].evidence','materialQueries','materialQueries[]','materialQueries[].query','materialQueries[].evidence','other'] as const;
export interface SchemaDiagnostic {total:number;issues:Array<{code:typeof SCHEMA_ISSUE_CODES[number];path:typeof SCHEMA_ISSUE_PATHS[number]}>}
const allowedCodes=new Set<string>(SCHEMA_ISSUE_CODES),allowedPaths=new Set<string>(SCHEMA_ISSUE_PATHS);

export function diagnoseBriefSchemaIssues(issues:unknown):SchemaDiagnostic|null {
 if(!Array.isArray(issues)||!issues.length)return null;
 const result:SchemaDiagnostic['issues']=[];
 for(const item of issues.slice(0,5)){
  if(!item||typeof item!=='object')return null;
  const value=item as {code?:unknown;path?:unknown};
  const code=typeof value.code==='string'&&allowedCodes.has(value.code)?value.code:'other';
  if(!Array.isArray(value.path)||value.path.length>8)return null;
  let path='';
  for(const segment of value.path){
   if(typeof segment==='number'&&Number.isSafeInteger(segment)&&segment>=0)path+='[]';
   else if(typeof segment==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(segment))path+=(path?'.':'')+segment;
   else {path='other';break;}
  }
  path=path||'$';
  result.push({code:code as typeof SCHEMA_ISSUE_CODES[number],path:(allowedPaths.has(path)?path:'other') as typeof SCHEMA_ISSUE_PATHS[number]});
 }
 return {total:Math.min(issues.length,99),issues:result};
}
