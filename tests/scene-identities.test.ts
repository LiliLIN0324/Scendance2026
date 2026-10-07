import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {sceneSchema,sceneV2Schema,type Scene} from '../supabase/functions/_shared/domain.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {chair,database,owner,scene,session,studio} from './fixtures.ts';
import {backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene,SceneAdapterError} from '../frontend/components/room-organizer/lib/backend-adapter.ts';

const id='abcdef00-0000-4000-8000-000000000001',upper=id.toUpperCase();
const other='abcdef00-0000-4000-8000-000000000002';
const item=(value:string)=>({...chair(),id:value,position:{x:value===id?2:6,z:2}});
const column=(value:string)=>({id:value,position:{x:value===id?8:10,z:5},size:{width:0.5,depth:0.5,height:3},rotation:0,status:'confirmed' as const});
const source=(value:string)=>({assetId:value,kind:'photo' as const,name:'Synthetic source',width:32,height:32});
const dimension=(value:string)=>({id:value,kind:'width' as const,valueMeters:12,status:'confirmed' as const,label:'Synthetic dimension'});
const v2=()=>sceneV2Schema.parse({...scene(),schemaVersion:2,structure:{walls:[],openings:[],columns:[]}});
const entrance=(value:string,x=6)=>({id:value,position:{x,z:0},width:1});

const cases=[
 {name:'V1 objects',make:(alias:string)=>({...scene(),objects:[item(id),item(alias)]})},
 {name:'V2 objects',make:(alias:string)=>({...v2(),objects:[item(id),item(alias)]})},
 {name:'structure entities',make:(alias:string)=>({...v2(),structure:{walls:[],openings:[],columns:[column(id),column(alias)]}})},
 {name:'objects versus structure',make:(alias:string)=>({...v2(),objects:[item(id)],structure:{walls:[],openings:[],columns:[column(alias)]}})},
 {name:'source images',make:(alias:string)=>({...v2(),sources:[source(id),source(alias)]})},
 {name:'dimensions',make:(alias:string)=>({...v2(),dimensions:[dimension(id),dimension(alias)]})},
];

describe('scene UUID identity boundaries',()=>{
 it.each(cases)('rejects UUID case aliases in $name and preserves distinct old IDs',({make})=>{
  const valid=make(other.toUpperCase());
  expect(sceneSchema.parse(valid)).toEqual(valid);
  const duplicate=make(upper),before=JSON.stringify(duplicate);
  expect(sceneSchema.safeParse(duplicate).success).toBe(false);
  if(duplicate.schemaVersion===2)expect(sceneV2Schema.safeParse(duplicate).success).toBe(false);
  expect(JSON.stringify(duplicate)).toBe(before);
 });
 it.each([1,2] as const)('rejects duplicate entrance aliases through the actual V%s adapter',version=>{
  const base=version===1?scene():v2();
  const input={...base,venue:{...base.venue,entrances:[entrance(id,3),entrance(upper,6)]}};
  const before=JSON.stringify(input);
  expect(()=>backendSceneToLayout(input)).toThrow(SceneAdapterError);
  expect(sceneSchema.safeParse(input).success).toBe(false);
  if(version===2)expect(sceneV2Schema.safeParse(input).success).toBe(false);
  expect(JSON.stringify(input)).toBe(before);
 });
 it.each([1,2] as const)('rejects entrance/object UUID aliases through the actual V%s adapter',version=>{
  const base=version===1?scene():v2();
  const input={...base,objects:[item(id)],venue:{...base.venue,entrances:[entrance(upper)]}};
  expect(()=>backendSceneToLayout(input)).toThrow(SceneAdapterError);
  expect(sceneSchema.safeParse(input).success).toBe(false);
  if(version===2)expect(sceneV2Schema.safeParse(input).success).toBe(false);
 });
 it('keeps a normal uppercase entrance through V1 roundtrip and V1-to-V2 migration',()=>{
  const base=scene(),input={...base,objects:[item(other)],venue:{...base.venue,entrances:[entrance(upper)]}};
  const layout=backendSceneToLayout(input);
  expect(layoutToBackendScene(layout).venue.entrances).toEqual(input.venue.entrances);
  const migrated=layoutToBackendScene(createMeasuredRoomLayout(layout,{width:12,depth:10,height:3}));
  expect(migrated.schemaVersion).toBe(2);
  if(migrated.schemaVersion!==2)throw new Error('Expected V2 migration');
  expect(migrated.venue.entrances).toEqual([]);
  expect(migrated.structure.openings.map(opening=>opening.id)).toContain(upper);
 });
 it.each([id,upper])('preserves compatible V2 cached entrance/opening IDs: %s',entranceId=>{
  const base=v2(),wallId=other.toUpperCase();
  const input={...base,venue:{...base.venue,entrances:[entrance(entranceId)]},structure:{
   walls:[{id:wallId,start:{x:0,z:0},end:{x:12,z:0},thickness:0.1,height:3,kind:'exterior' as const,status:'confirmed' as const}],
   openings:[{id,wallId,kind:'door' as const,offset:5.5,width:1,height:2.2,sillHeight:0,status:'confirmed' as const}],columns:[],
  }};
  const output=layoutToBackendScene(backendSceneToLayout(input));
  expect(output.venue.entrances).toEqual(input.venue.entrances);
  if(output.schemaVersion!==2)throw new Error('Expected V2 roundtrip');
  expect(output.structure.openings[0].id).toBe(id);
 });

 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);
 afterAll(async()=>{await f.db.close();});
 it('blocks create and save before storage while a normal uppercase-ID record remains readable',async()=>{
  const api=createApi(f.backend,()=>undefined);
  const request=(path:string,method:string,body?:unknown)=>api(new Request(`https://api.test${path}`,{
   method,headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),
  }));
  const duplicate=cases[0].make(upper);
  const before=(await f.rpc(owner,'projects.list')).length;
  const base=scene();
  const invalidScenes=[duplicate,
   {...base,venue:{...base.venue,entrances:[entrance(id,3),entrance(upper)]}},
   {...base,objects:[item(id)],venue:{...base.venue,entrances:[entrance(upper)]}},
  ];
  for(const invalid of invalidScenes)expect((await request('/projects','POST',{studioId:studio,name:'Duplicate aliases',scene:invalid})).status).toBe(400);
  expect((await f.rpc(owner,'projects.list')).length).toBe(before);
  const valid:Scene={...scene(),objects:[item(upper)]};
  // Seed through the unchanged database path, as an existing record would be.
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Existing uppercase record',scene:valid});
  const created=await request('/projects','POST',{studioId:studio,name:'Normal old record',scene:valid});
  expect(created.status).toBe(201);
  const lease=await (await request(`/projects/${project.id}/lease/acquire`,'POST',{sessionId:session})).json();
  for(const invalid of invalidScenes)expect((await request(`/projects/${project.id}/scene`,'PUT',{sessionId:session,generation:lease.generation,expectedRevision:0,scene:invalid})).status).toBe(400);
  const reopened=await request(`/projects/${project.id}`,'GET');expect(reopened.status).toBe(200);
  const stored=await reopened.json();expect(stored.revision).toBe(0);
  expect(sceneSchema.parse(stored.scene)).toEqual(valid);
  expect(stored.scene.objects[0].id).toBe(upper);
 });
});
