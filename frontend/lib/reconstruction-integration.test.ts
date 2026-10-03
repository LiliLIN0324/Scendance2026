/// <reference path="../../supabase/functions/_shared/vendor.d.ts" />
/** Real HTTP + migrated PGlite. Auth, private storage and DeepSeek are explicit TEST DOUBLES. */
import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {type SceneV2} from '../../supabase/functions/_shared/domain';
import {processReconstruction} from '../../supabase/functions/_shared/reconstruction';
import {scene,studio,chair} from '../../tests/fixtures';
import {startLocalServer,testAccounts,testPublicKey} from '../../tests/local-server';
import {backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene} from '../components/room-organizer/lib/backend-adapter';
import {BackendSession,getBackendConfig,type DimensionConstraint,type ReconstructionInput} from './backend-session';

const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY8sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
function measured():SceneV2{const result=layoutToBackendScene(createMeasuredRoomLayout(backendSceneToLayout(scene()),{width:12,depth:10,height:3}));if(result.schemaVersion!==2)throw new Error('expected measured Scene v2');return result;}
const dimensions=():DimensionConstraint[]=>[{id:crypto.randomUUID(),kind:'width',label:'实测总宽',valueMeters:12,status:'confirmed'},{id:crypto.randomUUID(),kind:'depth',label:'实测总深',valueMeters:10,status:'confirmed'},{id:crypto.randomUUID(),kind:'height',label:'实测层高',valueMeters:3,status:'confirmed'}];

describe('reconstruction session → real HTTP API → migrated PGlite (provider mocked)',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>;
 const sessions:BackendSession[]=[];let stages:string[]=[];
 const modelMock:typeof fetch=async(_url,init)=>{
   const body=JSON.parse(String(init?.body));const payload=JSON.parse(body.messages[1].content[0].text);
   const planning=body.thinking.type==='enabled';stages.push(planning?'planning':'recognition');
   const candidate:SceneV2=planning?structuredClone(payload.scene):measured();
   if(!planning){
     expect(body.messages[1].content.some((c:{type:string;image_url?:{url:string}})=>c.type==='image_url'&&c.image_url?.url.startsWith('data:image/png;base64,'))).toBe(true);
     candidate.sources=payload.sources;candidate.dimensions=payload.dimensions;
     candidate.structure.walls[0]!.status='inferred';
   }else{
     expect(body.messages[1].content.some((c:{type:string})=>c.type==='image_url')).toBe(false);
     candidate.objects=[chair('HTTP integration fixture')];candidate.lighting='warm';candidate.finishes={floorColor:'#b49b77',floorPattern:'wood'};
     candidate.design={concept:'木质主题的活动交流区',palette:['#b49b77'],highlights:[{title:'交流角',description:'靠近展示区的小型交流空间',objectIds:[candidate.objects[0]!.id]}],requirements:[{text:'1把椅子',status:'satisfied',reason:'配置一把活动座椅',objectIds:[candidate.objects[0]!.id]}]};
   }
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({scene:candidate,issues:[]})}}],usage:{prompt_tokens:100,completion_tokens:120}});
 };
 beforeAll(async()=>{server=await startLocalServer(0,modelMock,{env:key=>key==='RECONSTRUCTION_MAX_REQUEST_CENTS'?'200':undefined});},30000);
 afterEach(()=>{for(const c of sessions.splice(0))c.dispose();stages=[];});
 afterAll(async()=>{await server?.close();});
 async function login(){const c=new BackendSession(getBackendConfig({url:server.url,anonKey:testPublicKey}));sessions.push(c);await c.signIn(testAccounts[0]!.email,testAccounts[0]!.password);return c;}
 async function setup(){const c=await login(),base=scene(),project=await c.createProject(studio,'图纸重建 HTTP 联调',base);await c.acquireLease(project.id);const source=await c.uploadSource(new Blob([png],{type:'image/png'}),'private-floorplan.png','floorplan');const input:ReconstructionInput={requestId:crypto.randomUUID(),scene:base,sources:[source],dimensions:dimensions(),mode:'redesign',instruction:'木质主题、暖光、1把椅子',selectedIds:[]};return{c,project,input,source};}
 async function ready(c:BackendSession,input:ReconstructionInput,duringPlanning?:()=>void){const first=await c.createReconstruction(input);expect(first.state).toBe('queued');expect(await processReconstruction(server.backend,server.env,modelMock)).toMatchObject({state:'needs_review'});const review=await c.getReconstruction(first.id);expect(review.proposal).toBeNull();expect(review.candidate?.structure.walls.some(w=>w.status!=='confirmed')).toBe(true);const confirmed=structuredClone(review.candidate!);confirmed.structure.walls.forEach(w=>{w.status='confirmed';});const continued=await c.createReconstruction({...input,requestId:crypto.randomUUID(),reviewedScene:confirmed});duringPlanning?.();expect(await processReconstruction(server.backend,server.env,modelMock)).toMatchObject({state:'ready'});const result=await c.getReconstruction(continued.id);expect(result.proposal).toBeTruthy();return result.proposal!;}
 it('uploads private bytes, reviews structure, plans once, applies and restores full v2 with fresh image authorization',async()=>{
   const {c,project,input,source}=await setup();
   // Upload retry is deduplicated server-side and does not consume a source slot.
   expect(await c.uploadSource(new Blob([png],{type:'image/png'}),'private-floorplan.png','floorplan')).toEqual(source);
   expect(await c.listSources()).toEqual([source]);
   const url=await c.sourceImageUrl(source.assetId);expect(new Uint8Array(await (await fetch(url)).arrayBuffer())).toEqual(png);
   const proposal=await ready(c,input);expect(stages).toEqual(['recognition','planning']);expect(c.getSnapshot().revision).toBe(0);expect(c.getSnapshot().draft).toEqual(input.scene);
   const applied=await c.applySceneProposal(proposal,input.scene);expect(applied.acceptedLocally).toBe(true);expect(applied.revision).toBe(1);expect(applied.undoGroup).toBe(proposal.id);expect(applied.previousScene).toEqual(input.scene);
   const editor=backendSceneToLayout(applied.scene,{projectId:project.id});expect(layoutToBackendScene(editor)).toEqual(applied.scene);
   const saved=await c.saveScene(layoutToBackendScene(editor));expect(saved.revision).toBe(2);await c.releaseLease();
   const reopened=await login();expect((await reopened.getProject(project.id)).scene).toEqual(applied.scene);expect(await reopened.listSources()).toEqual([source]);expect(await reopened.sourceImageUrl(source.assetId)).not.toEqual(url);
   expect(JSON.stringify(applied.scene)).not.toContain('data:image');expect(JSON.stringify(applied.scene)).not.toContain('/test-storage/');
   // Reacquire without changing the candidate, then save the exact local undo snapshot.
   await c.acquireLease(project.id);const undone=await c.saveScene(input.scene);expect(undone.revision).toBe(3);expect(undone.scene).toEqual(input.scene);await c.releaseLease();
   expect((await reopened.getProject(project.id)).scene).toEqual(input.scene);
 },30000);
 it('does not overwrite a local draft edited while the reconstruction was running',async()=>{
   const {c,project,input}=await setup();const edited={...input.scene,lighting:'cool' as const};const proposal=await ready(c,input,()=>c.setDraft(edited));
   await expect(c.applySceneProposal(proposal,edited)).rejects.toMatchObject({code:'STALE_PROPOSAL'});expect(c.getSnapshot().draft).toEqual(edited);expect(c.getSnapshot().revision).toBe(0);
   const observer=await login();expect((await observer.getProject(project.id)).scene).toEqual(input.scene);
 },30000);
});
