import {describe,expect,it} from 'vitest';
import {createEmptyPlanDraft,type LayoutPlanDraft,type PlanAnnotationGeometry} from './plan-annotation';
import {readAgentAnnotationObservation,type AnnotationObservationSource} from './agent-annotation-observation';

const draft=():LayoutPlanDraft=>({...createEmptyPlanDraft(),annotations:[
  {id:'z',kind:'zone',label:'用户私密标签',geometry:{kind:'rect',x:0,z:0,width:4,depth:3},zoneType:'checkin',stageNo:1},
  {id:'r',kind:'route',label:'路线',geometry:{kind:'polyline',points:[{x:0,z:0},{x:2,z:1}]},stageNo:1},
  {id:'d',kind:'door',label:'入口',geometry:{kind:'door',wall:'north',position:1,widthM:null},stageNo:1},
]});
function fixture(value=draft()):AnnotationObservationSource{return {binding:{activityScope:'activity:a',activityEpoch:2,sceneRevision:3,floorId:'floor-1',annotationRevision:5},bounds:{width:12,depth:8},annotationFloor:()=> 'floor-1',read:()=>({revision:5,draft:value}),isCurrent:()=>true};}

describe('Agent annotation observation',()=>{
  it('reads typed geometry only, marks door properties unknown and does not claim solver use',()=>{
    const result=readAgentAnnotationObservation(fixture());expect(result.status).toBe('ready');if(result.status!=='ready')return;
    expect(result.annotations[0]).toMatchObject({kind:'zone',zoneType:'checkin',source:'unverified'});
    expect(result.annotations[1]).toMatchObject({kind:'route',source:'unverified'});
    expect(result.annotations[2]).toMatchObject({kind:'door',positionStatus:'unverified',widthStatus:'unknown',directionStatus:'unknown'});
    expect(result.notice).toContain('不代表已用于排布');expect(JSON.stringify(result)).not.toContain('用户私密标签');
  });
  it('does not promote a supplied door width or inferred position to an authoritative fact',()=>{
    const value=draft();value.annotations[2]={id:'d',kind:'door',label:'',stageNo:1,geometry:{kind:'door',wall:'south',position:0,widthM:1.8,inferred:true}};
    const result=readAgentAnnotationObservation(fixture(value));expect(result.status).toBe('ready');if(result.status!=='ready')return;
    expect(result.annotations[2]).toMatchObject({positionStatus:'inferred',widthStatus:'unknown',directionStatus:'unknown'});
    expect(JSON.stringify(result.annotations[2])).not.toContain('1.8');
  });
  it('fails closed for stale or changing activity and annotation snapshots',()=>{
    expect(readAgentAnnotationObservation({...fixture(),isCurrent:()=>false})).toEqual({status:'unavailable'});
    expect(readAgentAnnotationObservation({...fixture(),binding:{...fixture().binding,annotationRevision:4}})).toEqual({status:'unavailable'});
    let calls=0;expect(readAgentAnnotationObservation({...fixture(),isCurrent:()=>++calls===1})).toEqual({status:'unavailable'});
    let reads=0;expect(readAgentAnnotationObservation({...fixture(),read:()=>({revision:5,draft:++reads===1?draft():null})})).toEqual({status:'unavailable'});
  });
  it('does not convert malformed geometry or unidentified activity to a successful empty read',()=>{
    const invalid=draft();invalid.annotations[0]!.geometry={kind:'rect',x:0,z:0,width:NaN,depth:3};
    expect(readAgentAnnotationObservation(fixture(invalid))).toEqual({status:'unavailable'});
    expect(readAgentAnnotationObservation({...fixture(),binding:{...fixture().binding,activityScope:'draft:unidentified'}})).toEqual({status:'unavailable'});
  });
  it('requires valid bounds and floor ownership, and includes only the current floor',()=>{
    expect(readAgentAnnotationObservation({...fixture(),bounds:null})).toEqual({status:'unavailable'});
    expect(readAgentAnnotationObservation({...fixture(),annotationFloor:()=>null})).toEqual({status:'unavailable'});
    const result=readAgentAnnotationObservation({...fixture(),annotationFloor:id=>id==='r'?'floor-2':'floor-1'});
    expect(result.status).toBe('ready');if(result.status==='ready')expect(result.annotations.map(x=>x.id)).toEqual(['z','d']);
    let calls=0;expect(readAgentAnnotationObservation({...fixture(),annotationFloor:()=>++calls<=3?'floor-1':'floor-2'})).toEqual({status:'unavailable'});
  });
  it('rejects repeated IDs and geometries crossing the current venue bounds',()=>{
    const duplicate=draft();duplicate.annotations[1]!.id='z';expect(readAgentAnnotationObservation(fixture(duplicate))).toEqual({status:'unavailable'});
    const edge=draft();edge.annotations=[{id:'edge',label:'',stageNo:1,kind:'zone',geometry:{kind:'rect',x:4,z:3,width:2,depth:1}}];
    expect(readAgentAnnotationObservation(fixture(edge)).status).toBe('ready');
    const geometries:PlanAnnotationGeometry[]=[
      {kind:'rect',x:5,z:0,width:2,depth:1},
      {kind:'polyline',points:[{x:0,z:0},{x:7,z:0}]},
      {kind:'measure',from:{x:0,z:0},to:{x:0,z:5}},
      {kind:'door',wall:'north',position:7,widthM:null},
    ];
    for(const geometry of geometries){
      const value=draft();value.annotations=[{id:'x',label:'',stageNo:1,kind:geometry.kind==='rect'?'zone':geometry.kind==='polyline'?'route':geometry.kind,geometry}];
      expect(readAgentAnnotationObservation(fixture(value))).toEqual({status:'unavailable'});
    }
  });
  it('rejects in-place mutation even if the revision does not change',()=>{
    const value=draft();let calls=0;const source=fixture(value);
    source.read=()=>{if(++calls===2)value.annotations[0]!.label='changed';return {revision:5,draft:value};};
    expect(readAgentAnnotationObservation(source)).toEqual({status:'unavailable'});
  });
});
