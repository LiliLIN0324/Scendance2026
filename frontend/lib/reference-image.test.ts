import {describe,expect,it} from 'vitest';
import {backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene} from '../components/room-organizer/lib/backend-adapter';
import {makeLayout,makeItem} from '../components/room-organizer/lib/__testfixtures__/fixtures';
import {referenceSceneBasis,resolveReferenceImage,type ReferenceRegistration} from './reference-image';
import type {StoredSource} from './source-storage';
const assetId='20000000-0000-4000-8000-000000000001';
const measured=createMeasuredRoomLayout(makeLayout({id:'project-a',roof:{style:'none'}}),{width:12,depth:8,height:3});
const scene=layoutToBackendScene(measured);
if(scene.schemaVersion!==2)throw new Error('v2 fixture');
const layout=backendSceneToLayout({...scene,sources:[{assetId,kind:'floorplan',name:'原图',width:1000,height:600}]},{projectId:'project-a'});
const source:StoredSource={id:'local-image-a',scope:'project-a',kind:'floorplan',assetId,name:'原图',width:1000,height:600,blob:new Blob(['pixels'])};
const {blob:omittedBlob,...withoutBlob}=source;
const {assetId:omittedAsset,...localSource}=source;
function registration():ReferenceRegistration{return {sourceId:source.id,sourceAssetId:assetId,points:[{x:10,z:20},{x:610,z:20},{x:10,z:420}],worldWidth:12,worldDepth:8,imageWidth:1000,imageHeight:600,appliedBasis:referenceSceneBasis(layout),confirmationId:'manual-confirmation'};}
describe('applied reference image resolution',()=>{
 it('resolves one scoped blob and its confirmed affine mapping without network or mutable furniture authorization',()=>{
  const result=resolveReferenceImage(layout,[source],{registration:registration()});expect(result.status).toBe('ready');
  expect(result.source).toBe(source);const [a,b,c,d,e,f]=result.imageToWorld!;
  expect(a*610+c*20+e).toBeCloseTo(12);expect(b*10+d*420+f).toBeCloseTo(8);
  const moved={...layout,floors:[{...layout.floors[0]!,items:[makeItem({type:'glb-asset',glbUrl:'https://review.invalid/unarchived.glb',position:{x:2,z:1}})]}]};
  expect(referenceSceneBasis(moved)).toBe(referenceSceneBasis(layout));expect(resolveReferenceImage(moved,[source],{registration:registration()}).status).toBe('ready');
 });
 it.each([
  {sourceId:source.id,points:[{x:10,z:20},{x:610,z:20},{x:10,z:420}]},
  {...registration(),worldWidth:10}, {...registration(),imageWidth:500}, {...registration(),sourceAssetId:'other'},
  {...registration(),appliedBasis:'old'}, {...registration(),confirmationId:undefined},
  {...registration(),points:[{x:NaN,z:0},{x:10,z:0},{x:0,z:10}]},
  {...registration(),points:[{x:-1,z:0},{x:10,z:0},{x:0,z:10}]},
  {...registration(),points:[{x:0,z:0},{x:10,z:10},{x:20,z:20}]},
 ])('does not adopt unconfirmed, stale or malformed points',value=>{expect(resolveReferenceImage(layout,[source],{registration:value}).status).toBe('needs-review');});
 it('keeps the fixed affine reference while edited walls move against it, and rejects a changed world frame',()=>{
  const changed={...layout,floors:[{...layout.floors[0]!,interiorWalls:layout.floors[0]!.interiorWalls!.map((wall,index)=>index===0?{...wall,x1:wall.x1+.2,x2:wall.x2+.2}:wall)}]};
  expect(changed.backendSceneV2).toBe(layout.backendSceneV2);expect(referenceSceneBasis(changed)).toBe(referenceSceneBasis(layout));
  expect(resolveReferenceImage(changed,[source],{registration:registration()}).status).toBe('ready');
  expect(resolveReferenceImage(changed,[source],{registration:registration()}).imageToWorld).toEqual(resolveReferenceImage(layout,[source],{registration:registration()}).imageToWorld);
  expect(resolveReferenceImage({...layout,width:16},[source],{registration:registration()}).status).toBe('needs-review');
  expect(resolveReferenceImage({...layout,height:10},[source],{registration:registration()}).status).toBe('needs-review');
 });
 it.each([
  [{...source,scope:'project-b'}], [{...source,kind:'photo' as const}], [withoutBlob],
  [{...source,width:900}], [source,{...source,id:'duplicate'}], [{...source,assetId:'not-in-scene'}],
  [{...source,assetId:''}],
 ].map(sources=>[sources] as const))('refuses a missing, mismatched, duplicate or wrong-kind source',sources=>{expect(resolveReferenceImage(layout,sources,{registration:registration()}).status).toBe('unavailable');});
 it('supports explicitly confirmed local-only floorplans without fabricating a cloud source, but rejects a copied old asset registration',()=>{
  const local=localSource;const confirmed={...registration(),sourceAssetId:undefined,appliedBasis:referenceSceneBasis(measured)};
  expect(resolveReferenceImage(measured,[local],{registration:confirmed}).status).toBe('ready');
  expect(measured.backendSceneV2!.sources).toEqual([]);
  expect(resolveReferenceImage(layout,[local],{registration:registration()}).status).toBe('needs-review');
  expect(resolveReferenceImage(measured,[{...local,scope:'copied-project'}],{registration:confirmed}).status).toBe('unavailable');
 });
 it('treats unknown persisted form types as unconfirmed rather than applying them',()=>{
  expect(resolveReferenceImage(layout,[source],null).status).toBe('needs-review');
  expect(resolveReferenceImage(layout,[source],{registration:'bad'}).status).toBe('needs-review');
 });
});
