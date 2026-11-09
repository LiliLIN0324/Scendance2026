import {canonical,sceneSchema,sceneWarnings,type Scene,type SceneObject} from './domain.ts';
import {confirmedDoorwayObstructions,footprint,polygonPenetration,structuralViolations} from './structural-geometry.ts';

export interface IndependentCandidateReview {
  status:'violated'|'unknown';
  violations:Array<{code:string;ids:string[]}>;
  /** Existing problems and physical/safety topics that were not verified. */
  unknown:Array<{code:string;ids:string[]}>;
}
const eps=1e-6;
const key=(ids:readonly string[])=>[...ids].map(id=>id.toLowerCase()).sort().join(':');
function overlapDepth(a:SceneObject,b:SceneObject):{plan:number;height:number} {
  const bottomA=a.elevation??0,bottomB=b.elevation??0;
  return {plan:polygonPenetration(footprint(a),footprint(b)),height:Math.max(0,Math.min(bottomA+a.size.height,bottomB+b.size.height)-Math.max(bottomA,bottomB))};
}
function physicalStatus(scene:Scene,code:string,obstacleId:string):'known'|'unknown' {
  if(code==='OUT_OF_BOUNDS')return 'known';
  if(scene.schemaVersion!==2)return 'unknown';
  const wall=scene.structure.walls.find(item=>item.id===obstacleId);
  const column=scene.structure.columns.find(item=>item.id===obstacleId);
  return wall?.status==='confirmed'||column?.status==='confirmed'?'known':'unknown';
}

/**
 * Recompute against the complete candidate and its exact base independently of
 * the generator's warnings, ranking, tool receipts or previously validated key.
 * No success here certifies a real venue, doorway, egress, fire or accessibility.
 */
export function reviewAgentCandidate(base:Scene,candidate:Scene,selectedIds:readonly string[],hasCommands:boolean,preserve?:{keepAll:boolean;keepPositions:boolean}):IndependentCandidateReview {
  const unknown:IndependentCandidateReview['unknown']=[
    {code:'EXIT_UNKNOWN',ids:[]},{code:'EGRESS_UNKNOWN',ids:[]},{code:'DOOR_SWING_UNKNOWN',ids:[]},
    {code:'ACCESSIBILITY_UNKNOWN',ids:[]},{code:'FIRE_UNKNOWN',ids:[]},{code:'CAPACITY_UNKNOWN',ids:[]},
  ];
  const violations:IndependentCandidateReview['violations']=[];
  const before=sceneSchema.safeParse(base),after=sceneSchema.safeParse(candidate);
  if(!before.success||!after.success)return {status:'violated',violations:[{code:'CANDIDATE_INVALID',ids:[]}],unknown};
  const {objects:oldObjects,...oldBasis}=before.data,{objects:newObjects,...newBasis}=after.data;
  if(canonical(oldBasis)!==canonical(newBasis))violations.push({code:'BASE_CHANGED',ids:[]});
  const oldById=new Map(oldObjects.map(item=>[item.id.toLowerCase(),item]));
  const newById=new Map(newObjects.map(item=>[item.id.toLowerCase(),item]));
  const selection=new Set(selectedIds.map(id=>id.toLowerCase()));
  for(const item of oldObjects){
    const current=newById.get(item.id.toLowerCase());
    const changed=!current||canonical(item)!==canonical(current);
    if(!current&&preserve?.keepAll)violations.push({code:'USER_REQUESTED_EXISTING_ITEM_PRESERVED',ids:[item.id]});
    if(current&&preserve?.keepPositions&&(canonical(item.position)!==canonical(current.position)||item.rotation!==current.rotation))violations.push({code:'USER_REQUESTED_EXISTING_POSITION_PRESERVED',ids:[item.id]});
    if(changed&&item.locked)violations.push({code:'LOCKED_CHANGED',ids:[item.id]});
    if(changed&&selection.size&&!selection.has(item.id.toLowerCase()))violations.push({code:'UNSELECTED_CHANGED',ids:[item.id]});
  }
  // An empty-action explanation must not smuggle a changed candidate.
  if(!hasCommands&&canonical(oldObjects)!==canonical(newObjects))violations.push({code:'UNDECLARED_CHANGE',ids:[]});
  if(!hasCommands)return {status:violations.length?'violated':'unknown',violations,unknown};

  const beforeOverlaps=new Set(sceneWarnings(before.data).filter(w=>w.code==='OVERLAP').map(w=>key(w.ids)));
  for(const overlap of sceneWarnings(after.data).filter(w=>w.code==='OVERLAP')) {
    const identity=key(overlap.ids),a=newById.get(overlap.ids[0]!.toLowerCase()),b=newById.get(overlap.ids[1]!.toLowerCase());
    const oldA=oldById.get(overlap.ids[0]!.toLowerCase()),oldB=oldById.get(overlap.ids[1]!.toLowerCase());
    if(!a||!b||!oldA||!oldB||!beforeOverlaps.has(identity)){violations.push({code:'NEW_OVERLAP',ids:overlap.ids});continue;}
    const prior=overlapDepth(oldA,oldB),now=overlapDepth(a,b);
    // A larger penetration on one axis while the other shrinks is not enough
    // evidence that the overall existing conflict became worse.
    if(now.plan>=prior.plan-eps&&now.height>=prior.height-eps&&(now.plan>prior.plan+eps||now.height>prior.height+eps))violations.push({code:'WORSENED_OVERLAP',ids:overlap.ids});
    else unknown.push({code:'EXISTING_OVERLAP',ids:overlap.ids});
  }

  const oldStructural=new Map<string,number>();
  for(const issue of structuralViolations(before.data)){
    const identity=`${issue.code}:${issue.objectId.toLowerCase()}:${issue.obstacleId.toLowerCase()}`;
    oldStructural.set(identity,Math.max(oldStructural.get(identity)??0,issue.penetration));
  }
  for(const issue of structuralViolations(after.data)){
    const identity=`${issue.code}:${issue.objectId.toLowerCase()}:${issue.obstacleId.toLowerCase()}`;
    const ids=issue.obstacleId==='venue'?[issue.objectId]:[issue.objectId,issue.obstacleId];
    if(physicalStatus(after.data,issue.code,issue.obstacleId)==='unknown'){unknown.push({code:'STRUCTURE_UNCONFIRMED',ids});continue;}
    if(issue.penetration>(oldStructural.get(identity)??0)+eps)violations.push({code:`NEW_OR_WORSENED_${issue.code}`,ids});
    else unknown.push({code:`EXISTING_${issue.code}`,ids});
  }
  // This checks physical overlap of the recorded opening itself, not door swing,
  // usable clearance or egress. Existing obstructions are not silently passed.
  const oldDoorways=new Map(confirmedDoorwayObstructions(before.data).map(issue=>[`${issue.objectId.toLowerCase()}:${issue.openingId.toLowerCase()}`,issue.penetration]));
  for(const issue of confirmedDoorwayObstructions(after.data)){
    const identity=`${issue.objectId.toLowerCase()}:${issue.openingId.toLowerCase()}`;
    const ids=[issue.objectId,issue.openingId];
    if(issue.penetration>(oldDoorways.get(identity)??0)+eps)violations.push({code:'NEW_OR_WORSENED_DOORWAY_OBSTRUCTION',ids});
    else unknown.push({code:'EXISTING_DOORWAY_OBSTRUCTION',ids});
  }
  return {status:violations.length?'violated':'unknown',violations,unknown};
}
