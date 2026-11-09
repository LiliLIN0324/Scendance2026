import {describe,expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout,makeUnplacedItem} from '../components/room-organizer/lib/__testfixtures__/fixtures';
import type {FurnitureItem} from '../components/room-organizer/lib/types';
import {reviewAgentAnnotations,type AnnotationProof} from './agent-annotation-review';
import {layoutToBackendScene,backendSceneToLayout} from '../components/room-organizer/lib/backend-adapter';
import {mergeProposalPresentation} from '../components/room-organizer/lib/creative-brief';
import {geometryProjectId} from './geometry-workbench';
import type {BackendSession} from './backend-session';
import {readAgentAnnotationObservation} from './agent-annotation-observation';
import {createEmptyPlanDraft,type PlanAnnotation} from './plan-annotation';

const binding={activityScope:'activity:a',activityEpoch:1,sceneRevision:2,floorId:'ground',annotationRevision:3};
const zone={id:'reserved',kind:'zone',geometry:{kind:'rect',x:-1,z:-1,width:2,depth:2},zoneType:'reserved',source:'unverified'};
const route={id:'route',kind:'route',geometry:{kind:'polyline',points:[{x:-3,z:0},{x:3,z:0}]},source:'unverified'};
const observation={status:'ready',binding,annotations:[zone,route],notice:'标注是待核验的规划草稿；读取不代表已用于排布或完成安全检查。'};
const evidence:AnnotationProof[]=[{id:'reserved',source:'user',floorId:'ground'},{id:'route',source:'user',floorId:'ground'}];
const remote='00000000-0000-4000-8000-000000000999';
const projectBinding={actorId:'actor-a',sessionId:'00000000-0000-4000-8000-000000000123',leaseGeneration:1,localActivityId:'a',projectId:remote,mappedProjectId:remote};
const layout=(items:FurnitureItem[]=[])=>makeLayout({id:'a',width:8,height:8,floors:[makeFloor({id:'ground',items})]});
function input(base=layout(),candidate=layout([makeItem()])) {return {observation,currentObservation:structuredClone(observation),provenance:evidence,currentProvenance:structuredClone(evidence),capturedBase:base,currentBase:structuredClone(base),candidate,candidateBinding:binding,projectBinding,currentProjectBinding:structuredClone(projectBinding),proposalProjectId:remote};}

describe('independent annotation review',()=>{
 it('reports new centreline and reserved-area intrusions without a safety pass',()=>{
  const result=reviewAgentAnnotations(input());expect(result.status).toBe('violated');expect(result.route.violations).toHaveLength(1);expect(result.reserved.violations).toHaveLength(1);
  expect(result.unknown).toEqual(expect.arrayContaining(['路线宽度与实际净宽','连续通行、转弯与会车','门扇和出口','消防与无障碍要求','现场实物和固定障碍']));
 });
 it('compares the same item before and after, rejecting only new or worsened occupancy',()=>{
  const old=layout([makeItem({width:1})]),same=layout([makeItem({width:1})]),larger=layout([makeItem({width:2})]);
  expect(reviewAgentAnnotations(input(old,same)).reserved.violations).toHaveLength(0);
  expect(reviewAgentAnnotations(input(old,larger)).reserved.violations).toHaveLength(1);
 });
 it('marks a moved but equally sized intersection unknown rather than claiming it was unchanged',()=>{
  const old=layout([makeItem({position:{x:-0.4,z:0}})]),moved=layout([makeItem({position:{x:0.4,z:0}})]);
  const result=reviewAgentAnnotations(input(old,moved));expect(result.status).toBe('unknown');
  expect(result.reserved.existing).toHaveLength(0);expect(result.route.existing).toHaveLength(0);
  expect(result.route.centerlineCoverage).toBe('incomplete');expect(result.unknown.join(' ')).toContain('占用位置已变化');
 });
 it('never treats ordinary activity areas as keep-outs',()=>{
  const source={...observation,annotations:[{...zone,zoneType:'checkin'}]};
  const value={...input(),observation:source,currentObservation:structuredClone(source),provenance:[evidence[0]],currentProvenance:[evidence[0]]};
  expect(reviewAgentAnnotations(value).reserved.violations).toHaveLength(0);expect(reviewAgentAnnotations(value).status).toBe('unknown');
 });
 it('refuses stale snapshots, absent provenance and unplaced objects without claiming pass',()=>{
  const original=input();expect(reviewAgentAnnotations({...original,currentObservation:{...observation,binding:{...binding,annotationRevision:4}}}).status).toBe('unknown');
  expect(reviewAgentAnnotations({...original,provenance:[],currentProvenance:[]}).status).toBe('unknown');
  const missing=input(layout(),layout([makeUnplacedItem()]));expect(reviewAgentAnnotations(missing).status).toBe('unknown');
  expect(reviewAgentAnnotations({...original,candidateBinding:{...binding,sceneRevision:9}}).status).toBe('unknown');
 });
 it('does not claim a rotated bounding box or an unknown earlier footprint is a proven intrusion',()=>{
  const changed=layout([makeItem({rotation:Math.PI/4})]);const result=reviewAgentAnnotations(input(layout(),changed));
  expect(result.reserved.violations).toHaveLength(0);expect(result.unknown.join(' ')).toContain('旋转');
  const before=layout([makeUnplacedItem()]),after=layout([makeItem()]);
  expect(reviewAgentAnnotations(input(before,after)).reserved.violations).toHaveLength(0);
 });
 it('distinguishes the tolerated boundary from entry into the keep-out core',()=>{
  const contact=layout([makeItem({width:1,depth:1,position:{x:1.5,z:0}})]);
  const intrusion=layout([makeItem({width:1,depth:1,position:{x:1.4,z:0}})]);
  expect(reviewAgentAnnotations(input(layout(),contact)).reserved.violations).toHaveLength(0);
  expect(reviewAgentAnnotations(input(layout(),intrusion)).reserved.violations).toHaveLength(1);
 });
 it('does not accept changes in current base, provenance or viewport binding',()=>{
  const original=input();
  expect(reviewAgentAnnotations({...original,currentBase:layout([makeItem({id:'newer'})])}).status).toBe('unknown');
  expect(reviewAgentAnnotations({...original,currentProvenance:[{id:'reserved',source:'unknown',floorId:null}]}).status).toBe('unknown');
  expect(reviewAgentAnnotations({...original,candidateBinding:{...binding,floorId:'another'}}).status).toBe('unknown');
 });
 it('uses the local activity and preserved floor after a real scene conversion, not the remote project ID',()=>{
  const base={...layout(),roof:{style:'none' as const}};
  const controller={getSnapshot:()=>({project:{id:remote}}),isGeometryBound:(id:string)=>id==='a'} as unknown as BackendSession;
  expect(geometryProjectId(controller,base.id)).toBe(remote);
  const scene=layoutToBackendScene(base);
  const wireCandidate={...scene,objects:[{id:'00000000-0000-4000-8000-000000000001',materialId:'chair' as const,position:{x:4,z:4},rotation:0,size:{width:1,depth:1,height:1},color:'#ffffff',locked:false,notes:''}]};
  const candidate=mergeProposalPresentation(base,backendSceneToLayout(wireCandidate,{projectId:base.id!,name:base.name}));
  expect(candidate.id).toBe('a');expect(candidate.floors[0]?.id).toBe('ground');
  const draft={...createEmptyPlanDraft(),annotations:[{...zone,label:'预留区',stageNo:1},{...route,label:'路线',stageNo:1}] as PlanAnnotation[]};
  const captured=readAgentAnnotationObservation({binding,read:()=>({revision:3,draft}),bounds:{width:base.width,depth:base.height},annotationFloor:()=>base.floors[0]!.id,isCurrent:()=>true});
  expect(captured.status).toBe('ready');
  const actual={...input(base,candidate),observation:captured,currentObservation:structuredClone(captured)};
  expect(reviewAgentAnnotations(actual).reserved.violations).toHaveLength(1);
  expect(reviewAgentAnnotations({...actual,candidateBinding:{...binding,activityScope:`activity:${remote}`}}).status).toBe('unknown');
  expect(reviewAgentAnnotations({...input(base,candidate),proposalProjectId:'00000000-0000-4000-8000-000000000888'}).status).toBe('unknown');
  expect(reviewAgentAnnotations({...input(base,candidate),currentProjectBinding:{...projectBinding,mappedProjectId:'00000000-0000-4000-8000-000000000888'}}).status).toBe('unknown');
  const wrongMapping={...projectBinding,mappedProjectId:'00000000-0000-4000-8000-000000000888'};
  expect(reviewAgentAnnotations({...input(base,candidate),projectBinding:wrongMapping,currentProjectBinding:wrongMapping}).status).toBe('unknown');
  expect(reviewAgentAnnotations({...input(base,candidate),currentProjectBinding:{...projectBinding,actorId:'actor-b'}}).status).toBe('unknown');
  expect(reviewAgentAnnotations({...input(base,candidate),currentProjectBinding:{...projectBinding,leaseGeneration:2}}).status).toBe('unknown');
  expect(reviewAgentAnnotations({...input(base,candidate),projectBinding:null}).status).toBe('unknown');
 });
});
