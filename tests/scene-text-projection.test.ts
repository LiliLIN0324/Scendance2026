import {describe,expect,it} from 'vitest';
import {sceneHash,sceneSchema,type Scene} from '../supabase/functions/_shared/domain.ts';
import {projectUnverifiedScene} from '../supabase/functions/_shared/scene-text-projection.ts';
import {scene,chair} from './fixtures.ts';

const unsafe=():Scene=>sceneSchema.parse({...scene(),schemaVersion:2,objects:[chair('用户原有备注')],structure:{walls:[],openings:[],columns:[]},sources:[],dimensions:[],
  design:{concept:'消防已验收',palette:[],highlights:[{title:'疏散已合规',description:'所有出口均安全',objectIds:[]}],requirements:[{text:'消防与无障碍全部达标',status:'satisfied',reason:'模型判断',objectIds:[]}]}});
describe('read-only old-scene text projection',()=>{
 it('neutralizes unverified design without mutating the source or deleting user object data',()=>{
  const input=unsafe(),before=structuredClone(input),out=projectUnverifiedScene(input);
  expect(input).toEqual(before);expect(out.scene.objects[0]).toEqual({...input.objects[0],notes:''});
  expect(out.projection.hiddenObjectNotes).toBe(1);
  if(out.scene.schemaVersion!==2)throw new Error('expected v2');
  expect(out.scene.design?.requirements[0]).toMatchObject({status:'partial',reason:expect.stringContaining('未经独立核验')});
  expect(JSON.stringify(out.scene.design)).not.toMatch(/消防已验收|疏散已合规|全部达标/);
  expect(out.modelText.status).toBe('unverified');expect(out.projection.requiresOriginalSceneForWrite).toBe(true);
 });
 it('neutralizes legacy scene text after anonymous sharing projection without introducing private object data',()=>{
  const original=unsafe();if(original.schemaVersion!==2)throw new Error('expected v2');
  const out=projectUnverifiedScene(original);expect(out.scene.objects[0]!.notes).toBe('');
  expect(JSON.stringify(out.scene)).not.toContain('用户原有备注');expect(JSON.stringify(out.scene)).not.toContain('消防已验收');
 });
 it('projects historical restore results without replacing original state or its write baseline',async()=>{
  const history=unsafe(),before=structuredClone(history),originalHash=await sceneHash(history),out=projectUnverifiedScene(history);
  expect(await sceneHash(history)).toBe(originalHash);expect(await sceneHash(out.scene)).not.toBe(originalHash);
  expect(history).toEqual(before);expect(out.scene.objects[0]).toEqual({...history.objects[0],notes:''});
  expect(out.projection).toMatchObject({status:'read_only',changed:true,requiresOriginalSceneForWrite:true});
 });
 it('does not expose a historical object note as an approval even without design fields',()=>{
  const original={...scene(),objects:[chair('消防检查已经通过')]},before=structuredClone(original);
  const output=projectUnverifiedScene(original);expect(original).toEqual(before);
  expect(output.scene.objects[0]!.notes).toBe('');expect(output.projection.hiddenObjectNotes).toBe(1);
  expect(output.projection.requiresOriginalSceneForWrite).toBe(true);
 });
 it('is idempotent for exactly normalized reconstruction text and fixed measurement labels',async()=>{
  const id=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const fixed=sceneSchema.parse({...scene(),schemaVersion:2,structure:{walls:[],openings:[],columns:[]},sources:[],
    dimensions:['总宽','总深','总长','层高','净高','图纸标尺','模型识别尺寸 7（待核验）'].map((label,index)=>({id:id(index+1),kind:'width',valueMeters:12,status:'inferred',label})),
    design:{concept:'模型设计说明待人工核验。',palette:[],highlights:[{title:'模型建议（待核验）',description:'模型建议未独立核验，请人工检查。',objectIds:[]}],
      requirements:[{text:'模型要求 1（待核验）',status:'partial',reason:'模型意见未经独立核验，不代表现场或规范验收。',objectIds:[]}]}});
  const first=projectUnverifiedScene(fixed),second=projectUnverifiedScene(first.scene);
  expect(first.projection.changed).toBe(false);expect(first.projection.requiresOriginalSceneForWrite).toBe(false);
  expect(second.projection.changed).toBe(false);expect(await sceneHash(first.scene)).toBe(await sceneHash(fixed));
 });
 it('neutralizes arbitrary old dimension labels without changing their data or the original hash',async()=>{
  const input=sceneSchema.parse({...scene(),schemaVersion:2,structure:{walls:[],openings:[],columns:[]},sources:[],dimensions:[{id:'80000000-0000-4000-8000-000000000001',kind:'width',valueMeters:12,status:'confirmed',label:'消防验收已通过'}]});
  const before=structuredClone(input),hash=await sceneHash(input),out=projectUnverifiedScene(input);
  expect(input).toEqual(before);expect(await sceneHash(input)).toBe(hash);
  if(out.scene.schemaVersion!==2)throw new Error('expected v2');
  expect(out.scene.dimensions[0]).toMatchObject({valueMeters:12,status:'confirmed',label:'模型识别尺寸 1（待核验）'});
  expect(out.projection).toMatchObject({changed:true,hiddenDimensionLabels:1,requiresOriginalSceneForWrite:true});
  expect(projectUnverifiedScene(out.scene).projection.changed).toBe(false);
 });
 it('marks omitted default fields as changed relative to the stored JSON',()=>{
  const {notes:_omitted,...oldChair}=chair();const original={...scene(),objects:[oldChair]},before=structuredClone(original);
  const output=projectUnverifiedScene(original);
  expect(original).toEqual(before);expect(output.scene.objects[0]!.notes).toBe('');
  expect(output.projection).toMatchObject({changed:true,requiresOriginalSceneForWrite:true});
  expect(projectUnverifiedScene(output.scene).projection.changed).toBe(false);
 });
 it('marks absent V2 sources and dimensions as a changed projection',()=>{
  const original={...scene(),schemaVersion:2,structure:{walls:[],openings:[],columns:[]}},before=structuredClone(original);
  const output=projectUnverifiedScene(original);expect(original).toEqual(before);
  expect(output.scene.schemaVersion).toBe(2);expect(output.projection.requiresOriginalSceneForWrite).toBe(true);
  expect(projectUnverifiedScene(output.scene).projection.changed).toBe(false);
 });
 it('marks color normalization as a change while keeping the raw stored value intact',()=>{
  const original={...scene(),objects:[{...chair(),color:'#AABBCC'}]},before=structuredClone(original);
  const output=projectUnverifiedScene(original);expect(original).toEqual(before);
  expect(output.scene.objects[0]!.color).toBe('#aabbcc');expect(output.projection.changed).toBe(true);
  expect(projectUnverifiedScene(output.scene).projection.changed).toBe(false);
 });
 it('rejects unknown stored fields rather than silently dropping them',()=>{
  const original={...scene(),unrecognized:'不应被吞掉'};const before=structuredClone(original);
  expect(()=>projectUnverifiedScene(original)).toThrow();expect(original).toEqual(before);
 });
 it('returns an unchanged clone for a scene without model design',()=>{
  const input=scene(),out=projectUnverifiedScene(input);expect(out.scene).toEqual(input);expect(out.scene).not.toBe(input);
  expect(out.projection.changed).toBe(false);expect(out.projection.requiresOriginalSceneForWrite).toBe(false);
 });
});
