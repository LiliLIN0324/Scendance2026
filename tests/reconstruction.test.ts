import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {database,owner,editor,outsider,studio,session,scene,chair} from './fixtures.ts';
import {sceneV2Schema,sceneSchema,sceneWarnings,sceneHash,sha256,canonical,type SceneV2} from '../supabase/functions/_shared/domain.ts';
import {buildProposal} from '../supabase/functions/_shared/ai.ts';
import {structuralViolations,canApplyStructuralChange,dimensionConflicts,measurement} from '../supabase/functions/_shared/structural-geometry.ts';
import {processReconstruction,solveDimensions,reviewIssues,verifyInventoryRequirements} from '../supabase/functions/_shared/reconstruction.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {createReconstructionWorker} from '../supabase/functions/_shared/reconstruction-handler.ts';
import {reconstructionRequestSchema,type ReconstructionRequest} from '../supabase/functions/_shared/reconstruction-contract.ts';

const p=(x:number,z:number)=>({x,z});
export function structuralScene():SceneV2{
 const walls=[[p(0,0),p(12,0)],[p(12,0),p(12,10)],[p(12,10),p(0,10)],[p(0,10),p(0,0)]].map(([start,end])=>({id:crypto.randomUUID(),start,end,thickness:0.2,height:3,kind:'exterior' as const,status:'confirmed' as const}));
 return sceneV2Schema.parse({...scene(),schemaVersion:2,structure:{walls,openings:[],columns:[]},sources:[],dimensions:[]});
}
const dims=()=>['width','depth','height'].map((kind,i)=>({id:crypto.randomUUID(),kind:kind as 'width'|'depth'|'height',valueMeters:[12,10,3][i],status:'confirmed' as const,label:kind}));

describe('deterministic structural geometry',()=>{
 it('rejects rotated furniture penetrating an interior wall and accepts sliding clear',()=>{
  const s=structuralScene(),wall={...s.structure.walls[0],id:crypto.randomUUID(),kind:'interior' as const,start:p(6,0),end:p(6,10)};s.structure.walls.push(wall);
  const o={...chair(),position:p(5.6,5),rotation:45,size:{width:1,depth:1,height:1}};s.objects=[o];
  expect(structuralViolations(s)).toContainEqual(expect.objectContaining({code:'WALL_COLLISION',objectId:o.id,obstacleId:wall.id}));
  const after=structuredClone(s);after.objects[0].position.x=4;expect(canApplyStructuralChange(s,after)).toBe(true);expect(canApplyStructuralChange(after,s)).toBe(false);
 });
 it('respects actual door width, sill and head height',()=>{
  const s=structuralScene(),w={...s.structure.walls[0],id:crypto.randomUUID(),kind:'interior' as const,start:p(0,5),end:p(12,5)};s.structure.walls.push(w);
  s.structure.openings.push({id:crypto.randomUUID(),wallId:w.id,kind:'door',offset:5,width:2,height:2.1,sillHeight:0,status:'confirmed'});
  s.objects=[{...chair(),position:p(6,5)}];expect(structuralViolations(s)).toEqual([]);
  s.objects[0].size.height=2.5;expect(structuralViolations(s).some(v=>v.code==='WALL_COLLISION')).toBe(true);
  s.objects[0].size.height=0.8;s.structure.openings[0].sillHeight=1;expect(structuralViolations(s).some(v=>v.code==='WALL_COLLISION')).toBe(true);
 });
 it('uses concave boundaries and pillars and rejects worsening legacy conflicts',()=>{
  const s=structuralScene();s.venue.shape='polygon';s.venue.polygon=[p(0,0),p(12,0),p(12,10),p(8,10),p(8,4),p(7.9,4),p(7.9,10),p(0,10)];s.objects=[{...chair(),position:p(8,6),size:{width:2,depth:1,height:1}}];
  expect(structuralViolations(s).some(v=>v.code==='OUT_OF_BOUNDS')).toBe(true);
  const b=structuralScene();b.structure.columns=[{id:crypto.randomUUID(),position:p(3,3),size:{width:1,depth:1,height:3},rotation:25,status:'confirmed'}];b.objects=[chair()];expect(structuralViolations(b).some(v=>v.code==='COLUMN_COLLISION')).toBe(true);
  const same=structuredClone(b);same.lighting='warm';expect(canApplyStructuralChange(b,same)).toBe(true);
 });
 it('permits a wall-facing shallow mount and rejects rotation or oversized embedding',()=>{
  const s=structuralScene(),host=s.structure.walls[0];s.objects=[{...chair(),materialId:'display',wallId:host.id,position:p(6,-0.125),size:{width:1,depth:0.05,height:1}}];
  expect(structuralViolations(s)).toEqual([]);s.objects[0].rotation=45;expect(structuralViolations(s).length).toBeGreaterThan(0);
  s.objects[0].rotation=0;s.objects[0].position.z=0;s.objects[0].size.depth=2;expect(structuralViolations(s).some(v=>v.code==='WALL_COLLISION')).toBe(true);
 });
 it('allows AI recoloring a valid exterior mount and deduplicates retained boundary warnings',()=>{
  const s=structuralScene();s.objects=[{...chair(),materialId:'display',wallId:s.structure.walls[0].id,position:p(6,-0.125),size:{width:1,depth:0.05,height:1}}];
  const result=buildProposal(s,'modify',{explanation:'更新展示配色',commands:[{op:'recolor',id:s.objects[0].id,color:'#aabbcc'}]});
  expect(result.scene.objects[0].color).toBe('#aabbcc');expect(result.warnings).toEqual([]);
  s.objects=[{...chair(),position:p(-2,3)}];
  const unchanged=buildProposal(s,'modify',{explanation:'保留待修复物件',commands:[]});
  expect(unchanged.warnings.filter(w=>w.code==='OUT_OF_BOUNDS')).toEqual([{code:'OUT_OF_BOUNDS',ids:[s.objects[0].id]}]);
 });
 it('checks furniture overlap only when their vertical intervals intersect',()=>{
  const s=structuralScene(),ground=chair();s.objects=[ground,{...chair(),id:crypto.randomUUID(),elevation:1}];
  expect(sceneWarnings(s).filter(w=>w.code==='OVERLAP')).toEqual([]);
  s.objects[1].elevation=ground.size.height;expect(sceneWarnings(s).filter(w=>w.code==='OVERLAP')).toEqual([]);
  s.objects[1].elevation=ground.size.height-0.05;expect(sceneWarnings(s).filter(w=>w.code==='OVERLAP')).toHaveLength(1);
  s.objects[0].materialId='carpet';expect(sceneWarnings(s).filter(w=>w.code==='OVERLAP')).toEqual([]);
 });
 it('reports confirmed dimension drift without modifying scene and overrides optimistic counts',()=>{
  const s=structuralScene();s.dimensions=dims();s.venue.width=13;const before=structuredClone(s);expect(dimensionConflicts(s)).toContainEqual(expect.objectContaining({code:'DIMENSION_CONFLICT',actual:13}));expect(s).toEqual(before);
  s.objects=[chair()];s.design={concept:'活动',palette:[],highlights:[],requirements:[{text:'20个座位',status:'satisfied',reason:'模型自称完成',objectIds:[]}]};verifyInventoryRequirements(s,'放20个座位');expect(s.design.requirements[0].status).toBe('partial');expect(s.design.requirements[0].reason).toContain('实际有 1 个');
 });
 it('calibrates a selected part of a wall using image evidence and refuses unsupported correspondence',()=>{
  const s=structuralScene(),image={assetId:crypto.randomUUID(),kind:'floorplan' as const,name:'plan',width:1000,height:500};s.sources=[image];
  const wall=s.structure.walls[0];wall.evidence=[{sourceAssetId:image.assetId,start:p(0,0),end:p(1,0)}];
  const d={id:crypto.randomUUID(),kind:'distance' as const,valueMeters:2,status:'confirmed' as const,label:'墙上局部参考2米',sourceAssetId:image.assetId,targetId:wall.id,start:p(0.1,0),end:p(0.3,0)};
  expect(measurement(s,d)).toBeCloseTo(2.4);const solved=solveDimensions(s,[d]);expect(solved.issues).toEqual([]);expect(solved.scene.venue.width).toBeCloseTo(10);expect(measurement(solved.scene,d)).toBeCloseTo(2);
  expect(measurement(s,{...d,start:p(0.1,0.5),end:p(0.3,0.5)})).toBeUndefined();
  delete wall.evidence;expect(measurement(s,d)).toBeUndefined();expect(solveDimensions(s,[d]).issues[0].code).toBe('DIMENSION_TARGET_REQUIRED');
 });
 it('uses affine floorplan evidence for arbitrary diagonal calibration on a non-square image',()=>{
  const s=structuralScene(),image={assetId:crypto.randomUUID(),kind:'floorplan' as const,name:'wide-plan',width:1000,height:500};s.sources=[image];
  for(const wall of s.structure.walls)wall.evidence=[{sourceAssetId:image.assetId,start:p(wall.start.x/12,wall.start.z/10),end:p(wall.end.x/12,wall.end.z/10)}];
  const actual=Math.hypot(9.6,6),d={id:crypto.randomUUID(),kind:'distance' as const,valueMeters:actual/2,status:'confirmed' as const,label:'任意对角参考',sourceAssetId:image.assetId,start:p(0.1,0.2),end:p(0.9,0.8)};
  expect(measurement(s,d)).toBeCloseTo(actual,10);
  const solved=solveDimensions(s,[d]);expect(solved.issues).toEqual([]);expect(solved.scene.venue.width).toBeCloseTo(6,10);expect(solved.scene.venue.depth).toBeCloseTo(5,10);expect(measurement(solved.scene,d)).toBeCloseTo(d.valueMeters,10);
  expect(solved.scene.structure.walls[0].evidence).toEqual(s.structure.walls[0].evidence);
 });
 it('fits translated and sheared affine floorplan correspondences without requiring a target wall',()=>{
  const s=structuralScene(),image={assetId:crypto.randomUUID(),kind:'floorplan' as const,name:'skewed-plan',width:1000,height:500};s.sources=[image];
  const imagePoint=(world:{x:number;z:number})=>p((100+50*world.x+8*world.z)/image.width,(40+5*world.x+30*world.z)/image.height);
  // Three non-collinear world/image points from two adjacent walls suffice.
  for(const wall of s.structure.walls.slice(0,2))wall.evidence=[{sourceAssetId:image.assetId,start:imagePoint(wall.start),end:imagePoint(wall.end)}];
  const d={id:crypto.randomUUID(),kind:'distance' as const,valueMeters:5,status:'confirmed' as const,label:'跨场地参考',sourceAssetId:image.assetId,start:imagePoint(p(1,1)),end:imagePoint(p(9,7))};
  expect(measurement(s,d)).toBeCloseTo(10,10);const solved=solveDimensions(s,[d]);expect(solved.issues).toEqual([]);expect(measurement(solved.scene,d)).toBeCloseTo(5,10);
 });
 it('rejects degenerate, contradictory and photo affine floorplan evidence for arbitrary references',()=>{
  const s=structuralScene(),image={assetId:crypto.randomUUID(),kind:'floorplan' as const,name:'uncertain-plan',width:1000,height:500};s.sources=[image];
  const d={id:crypto.randomUUID(),kind:'distance' as const,valueMeters:5,status:'confirmed' as const,label:'待核对对角线',sourceAssetId:image.assetId,start:p(0.1,0.2),end:p(0.9,0.8)};
  for(const [i,wall] of s.structure.walls.entries())wall.evidence=[{sourceAssetId:image.assetId,start:p(i/8,i/8),end:p((i+1)/8,(i+1)/8)}];
  expect(measurement(s,d)).toBeUndefined();expect(solveDimensions(s,[d]).issues).toContainEqual(expect.objectContaining({code:'DIMENSION_TARGET_REQUIRED'}));
  for(const wall of s.structure.walls)wall.evidence=[{sourceAssetId:image.assetId,start:p(wall.start.x/12,wall.start.z/10),end:p(wall.end.x/12,wall.end.z/10)}];
  s.structure.walls[0].evidence![0].end.x=0.7;expect(measurement(s,d)).toBeUndefined();
  s.structure.walls[0].evidence![0].end.x=1;s.sources[0].kind='photo';expect(measurement(s,d)).toBeUndefined();
 });
 it('rejects IDs shared between furniture and structural entities',()=>{
  const s=structuralScene();s.objects=[{...chair(),id:s.structure.walls[0].id}];expect(sceneSchema.safeParse(s).success).toBe(false);
 });
 it('never reports model-only aisle claims as verified or mistakes metre widths for counts',()=>{
  const s=structuralScene();s.design={concept:'活动',palette:[],highlights:[],requirements:[{text:'通道净宽1.5米',status:'satisfied',reason:'模型表示满足',objectIds:[]}]};
  verifyInventoryRequirements(s,'通道净宽1.5米；背景板2米宽');expect(s.design.requirements).toHaveLength(1);expect(s.design.requirements[0].status).toBe('partial');expect(s.design.requirements[0].reason).toContain('仍需核对');
  s.design.requirements=[];verifyInventoryRequirements(s,'保留入口疏散动线');expect(s.design.requirements[0].status).toBe('partial');
 });
 it('keeps v1 valid and rejects malformed openings/v2 IDs',()=>{
  expect(sceneSchema.parse(scene()).schemaVersion).toBe(1);const s=structuralScene();s.structure.openings=[{id:crypto.randomUUID(),wallId:s.structure.walls[0].id,kind:'window',offset:11,width:2,height:2,sillHeight:2,status:'confirmed'}];expect(sceneSchema.safeParse(s).success).toBe(false);
 });
 it('solves global dimensions exactly and surfaces conflicting/unknown dimensions',()=>{
  const s=structuralScene();const d=dims();d[0].valueMeters=18;const solved=solveDimensions(s,d);expect(solved.issues).toEqual([]);expect(solved.scene.venue.width).toBe(18);expect(solved.scene.structure.walls[0].end.x).toBe(18);
  expect(solveDimensions(s,[...d,{...d[0],id:crypto.randomUUID(),valueMeters:20}]).issues[0].code).toBe('DIMENSION_CONFLICT');
  expect(solveDimensions(s,[{id:crypto.randomUUID(),kind:'distance',valueMeters:5,status:'confirmed',sourceAssetId:crypto.randomUUID(),start:p(0.1,0.1),end:p(0.8,0.1),label:'标尺'}]).issues[0].code).toBe('DIMENSION_TARGET_REQUIRED');
 });
});

describe('durable reconstruction + v2 persistence',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f?.db.close();});
 const env=(key:string)=>({DEEPSEEK_API_KEY:'test-only',RECONSTRUCTION_MAX_REQUEST_CENTS:'200',RECONSTRUCTION_WORKER_SECRET:'test-worker',ALLOWED_ORIGINS:'https://app.example',PUBLIC_APP_URL:'https://app.example'}[key]);
 async function project(){const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Isolated reconstruction',scene:scene()});const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});return{projectId:project.id,sessionId:session,generation:lease.generation,expectedRevision:0};}
 async function source(projectId:string){const id=crypto.randomUUID();return f.rpc(owner,'sources.register',{projectId,kind:'floorplan',asset:{id,name:'private-floorplan.png',source:'upload',format:'png',storagePath:`${owner}/${id}/test.png`,byteSize:100,sha256:await sha256(id),metadata:{width:100,height:100},license:{type:'user-upload'}}});}
 async function queue(reviewed=true){const lease=await project(),image=await source(lease.projectId),base=scene(),candidate=structuralScene();candidate.sources=[image];candidate.dimensions=dims();const input={...lease,requestId:crypto.randomUUID(),localRevision:0,scene:base,sources:[image],dimensions:candidate.dimensions,mode:'redesign' as const,instruction:'暖色活动场地',selectedIds:[],...(reviewed?{reviewedScene:candidate}:{})};const job=await f.reconstruction(owner,'create',{input,baseHash:await sceneHash(base),fingerprint:await sha256(canonical(input)),reserveCents:200});return{lease,input,job,candidate};}
 it('keeps source grants scoped and enforces atomic twelve-image limit',async()=>{
  const {projectId}=await project();for(let i=0;i<12;i++)await source(projectId);await expect(source(projectId)).rejects.toThrow('SOURCE_LIMIT_EXCEEDED');
  expect((await f.rpc(editor,'sources.list',{projectId})).length).toBe(12);await expect(f.rpc(outsider,'sources.list',{projectId})).rejects.toThrow('PROJECT_NOT_FOUND');
 });
 it('saves/reopens v2 and prevents downgrade and source exposure in shares',async()=>{
  const lease=await project(),s=structuralScene(),image=await source(lease.projectId);s.sources=[image];s.dimensions=dims();s.objects=[chair()];s.finishes={floorColor:'#ffeecc',floorPattern:'wood'};
  await f.rpc(owner,'scene.save',{...lease,scene:s});expect((await f.rpc(owner,'projects.get',lease)).scene).toEqual(s);
  await expect(f.rpc(owner,'scene.save',{...lease,expectedRevision:1,scene:scene()})).rejects.toThrow('SCHEMA_DOWNGRADE_FORBIDDEN');
  const tokenHash=await sha256(crypto.randomUUID());await f.rpc(owner,'publish',{...lease,expectedRevision:1,tokenHash});const shared=await f.rpc(null,'share.read',{tokenHash});expect(shared.scene.sources).toBeUndefined();expect(shared.scene.dimensions).toBeUndefined();expect(JSON.stringify(shared)).not.toContain('private-floorplan');expect(shared.scene.structure).toEqual(s.structure);
 });
 it('rejects forged source ids and reuses identical request without reserving twice',async()=>{
  const {input,job}=await queue();expect((await f.reconstruction(owner,'create',{input,baseHash:await sceneHash(input.scene),fingerprint:await sha256(canonical(input)),reserveCents:200})).id).toBe(job.id);
  await expect(f.reconstruction(owner,'create',{input,fingerprint:'changed',reserveCents:200})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  const lease=await project();await expect(f.reconstruction(owner,'create',{input:{...input,...lease,requestId:crypto.randomUUID()},fingerprint:'new',reserveCents:200})).rejects.toThrow('ASSET_FORBIDDEN');
  // Drain test queue without paid/provider calls.
  const claim=await f.reconstruction(null,'claim');await f.reconstruction(null,'update',{id:claim.id,workerToken:claim.worker_token,state:'failed',errorCode:'TEST_CANCELLED'});
 });
 it('recognition always requires human confirmation; private photos go only to configured provider',async()=>{
  const {input,candidate,job,lease}=await queue(false);let calls=0;
  const fetcher=async(_url:unknown,init?:RequestInit)=>{calls++;const body=JSON.parse(String(init?.body));expect(body.messages[1].content.some((x:{type:string})=>x.type==='image_url')).toBe(true);expect(body.thinking.type).toBe('disabled');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({scene:candidate,issues:[]})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:200}}));};
  const result=await processReconstruction(f.backend,env,fetcher as typeof fetch);expect(result.state).toBe('needs_review');expect(calls).toBe(1);
  const saved=await f.reconstruction(owner,'get',{projectId:lease.projectId,id:job.id});expect(saved.candidate.structure.walls.every((w:{status:string})=>w.status==='detected')).toBe(true);expect(saved.proposal).toBeNull();expect(reviewIssues(saved.candidate,input).length).toBeGreaterThan(0);
 });
 it('plans a reviewed scene, stores candidate, applies once and preserves revision guards',async()=>{
  const {candidate,input,job,lease}=await queue();const output=structuredClone(candidate);output.objects=[chair()];output.lighting='warm';output.design={concept:'暖色交流空间',palette:['#ffffff'],highlights:[{title:'交流点',description:'围绕活动交流',objectIds:[output.objects[0].id]}],requirements:[{text:'暖色',status:'satisfied',reason:'采用暖光',objectIds:[]}]};
  const fetcher=async(_url:unknown,init?:RequestInit)=>{expect(JSON.parse(String(init?.body)).thinking.type).toBe('enabled');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({scene:output,issues:[]})},finish_reason:'stop'}]}));};
  expect(await processReconstruction(f.backend,env,fetcher as typeof fetch)).toMatchObject({state:'ready'});const read=await f.reconstruction(owner,'get',{projectId:lease.projectId,id:job.id});expect(read.proposal.candidate).toEqual(output);
  const apply={...lease,proposalId:job.id,localRevision:0,baseHash:await sceneHash(input.scene)};await expect(f.rpc(owner,'proposals.apply',{...apply,localRevision:1})).rejects.toThrow('STALE_PROPOSAL');
  const saved=await f.rpc(owner,'proposals.apply',apply);expect(saved.scene.schemaVersion).toBe(2);expect(saved.previousScene).toEqual(input.scene);expect(saved.undoGroup).toBe(job.id);
  await expect(f.rpc(owner,'history.restore',{...lease,expectedRevision:1,proposalId:job.id,currentScene:input.scene})).rejects.toThrow('STALE_HISTORY_RESTORE');
  const restored=await f.rpc(owner,'history.restore',{...lease,expectedRevision:1,proposalId:job.id,currentScene:output});expect(restored.scene).toEqual(input.scene);expect(restored.revision).toBe(2);
  await expect(f.rpc(owner,'history.restore',{...lease,expectedRevision:2,proposalId:job.id,currentScene:output})).rejects.toThrow('STALE_HISTORY_RESTORE');
 });
 it('fails unsafe planner mutations without replacing the scene and records reserved calls',async()=>{
  const {candidate,lease}=await queue();candidate.structure.walls[0].height=2;
  const fetcher=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({scene:candidate,issues:[]})},finish_reason:'stop'}]}));
  const result=await processReconstruction(f.backend,env,fetcher as typeof fetch);expect(result.error).toBe('AI_MODIFIED_STRUCTURE');expect((await f.rpc(owner,'projects.get',lease)).scene.schemaVersion).toBe(1);
  expect((await f.db.query('select * from scene_private.reconstruction_calls')).rows.length).toBeGreaterThan(0);
 });
 it('uses expiring provider files for a large photo batch and cleans them up',async()=>{
  const {candidate,input,job,lease}=await queue(false);for(let i=0;i<6;i++)input.sources.push(await source(lease.projectId));candidate.sources=input.sources;
  await f.db.query('update scene_private.reconstruction_jobs set input=$1::jsonb where id=$2',[JSON.stringify(input),job.id]);
  for(const image of input.sources)await f.db.query('update scene_private.assets set byte_size=5242880 where id=$1',[image.assetId]);
  let uploads=0,deletes=0;const fetcher=async(url:unknown,init?:RequestInit)=>{
    if(String(url).endsWith('/files')){expect(init?.body).toBeInstanceOf(FormData);expect((init?.body as FormData).get('expires_after[seconds]')).toBe('3600');return new Response(JSON.stringify({id:`file-api-test${++uploads}`}));}
    if(init?.method==='DELETE'){deletes++;return new Response('{}');}
    expect(JSON.parse(String(init?.body)).messages[1].content.filter((x:{type:string})=>x.type==='file')).toHaveLength(7);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({scene:candidate,issues:[]})},finish_reason:'stop'}]}));
  };
  expect((await processReconstruction({...f.backend,readSourceBytes:async()=>new Uint8Array([1,2,3])},env,fetcher as typeof fetch)).state).toBe('needs_review');expect(uploads).toBe(7);expect(deletes).toBe(7);
 });
 it('requires worker secret and rejects stale claims',async()=>{
  const worker=createReconstructionWorker(f.backend,env);expect((await worker(new Request('https://worker',{method:'POST'}))).status).toBe(401);
  const {job}=await queue();const claim=await f.reconstruction(null,'claim');await expect(f.reconstruction(null,'update',{id:job.id,workerToken:crypto.randomUUID(),state:'failed'})).rejects.toThrow('WORKER_CLAIM_LOST');
  await f.db.query("update scene_private.reconstruction_jobs set worker_until=now()-interval '1 second' where id=$1",[claim.id]);expect(await f.reconstruction(null,'claim')).toBeNull();expect((await f.reconstruction(owner,'get',{projectId:job.project_id,id:job.id})).error_code).toBe('PROVIDER_RESULT_UNKNOWN');
 });
 it('plans an existing confirmed v2 venue without requiring an image or changing geometry',async()=>{
  const lease=await project(),candidate=structuralScene();await f.rpc(owner,'scene.save',{...lease,scene:candidate});
  const input={...lease,expectedRevision:1,requestId:crypto.randomUUID(),localRevision:0,scene:candidate,reviewedScene:candidate,sources:[],dimensions:[],mode:'redesign' as const,instruction:'暖色交流空间',selectedIds:[]};
  expect(reconstructionRequestSchema.safeParse({...input,scene:scene()}).success).toBe(false);
  expect(reconstructionRequestSchema.safeParse({...input,reviewedScene:{...candidate,venue:{...candidate.venue,width:99}}}).success).toBe(false);
  await f.reconstruction(owner,'create',{input,fingerprint:await sha256(canonical(input)),baseHash:await sceneHash(candidate),reserveCents:200});
  const output=structuredClone(candidate);output.lighting='warm';output.design={concept:'暖色交流空间',palette:[],highlights:[],requirements:[]};
  let calls=0;const fetcher=async(_url:unknown,init?:RequestInit)=>{calls++;const body=JSON.parse(String(init?.body));expect(body.thinking.type).toBe('enabled');expect(body.messages[1].content).toHaveLength(1);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({scene:output,issues:[]})},finish_reason:'stop'}]}));};
  expect((await processReconstruction(f.backend,env,fetcher as typeof fetch)).state).toBe('ready');expect(calls).toBe(1);
 });
 it('allows edited no-image review only with verified same-project candidate provenance',async()=>{
  const lease=await project(),base=structuralScene();await f.rpc(owner,'scene.save',{...lease,scene:base});
  const input={...lease,expectedRevision:1,requestId:crypto.randomUUID(),localRevision:0,scene:base,reviewedScene:base,sources:[],dimensions:[],mode:'redesign' as const,instruction:'布局',selectedIds:[]},baseHash=await sceneHash(base);
  const old=await f.reconstruction(owner,'create',{input,fingerprint:await sha256(canonical(input)),baseHash,reserveCents:200});const claim=await f.reconstruction(null,'claim');
  await f.reconstruction(null,'update',{id:old.id,workerToken:claim.worker_token,state:'needs_review',candidate:base,issues:[{code:'REVIEW',message:'请核对'}]});
  const edited=structuredClone(base);edited.structure.walls[0].thickness=0.25;
  const revised={...input,requestId:crypto.randomUUID(),reviewedJobId:old.id,reviewedScene:edited};expect(reconstructionRequestSchema.safeParse((({projectId,...request})=>request)(revised)).success).toBe(true);
  await expect(f.reconstruction(owner,'review.check',{input:revised,baseHash:'tampered'})).rejects.toThrow('STALE_RECONSTRUCTION_REVIEW');
  await expect(f.reconstruction(owner,'review.check',{input:{...revised,reviewedJobId:crypto.randomUUID()},baseHash})).rejects.toThrow('STALE_RECONSTRUCTION_REVIEW');
  expect(await f.reconstruction(owner,'review.check',{input:revised,baseHash})).toEqual({valid:true});
  const next=await f.reconstruction(owner,'create',{input:revised,fingerprint:await sha256(canonical(revised)),baseHash,reserveCents:200});expect(next.state).toBe('queued');
  const finish=await f.reconstruction(null,'claim');await f.reconstruction(null,'update',{id:finish.id,workerToken:finish.worker_token,state:'failed',errorCode:'TEST_CANCELLED'});
 });
 it('unlinks source without deleting history and returns duplicate uploads idempotently',async()=>{
  const lease=await project(),image=await source(lease.projectId);const asset=await f.rpc(owner,'assets.get',{assetId:image.assetId});
  expect((await f.rpc(owner,'sources.find',{projectId:lease.projectId,sha256:asset.sha256,kind:'floorplan'})).assetId).toBe(image.assetId);
  const s=structuralScene();s.sources=[image];s.structure.walls[0].evidence=[{sourceAssetId:image.assetId,start:p(0,0),end:p(1,0)}];await f.rpc(owner,'scene.save',{...lease,scene:s});
  await f.rpc(owner,'sources.unlink',{...lease,assetId:image.assetId});expect(await f.rpc(owner,'sources.list',lease)).toEqual([]);expect((await f.rpc(owner,'projects.get',lease)).scene.sources).toEqual([image]);
  const tokenHash=await sha256(crypto.randomUUID());await f.rpc(owner,'publish',{...lease,expectedRevision:1,tokenHash});const shared=await f.rpc(null,'share.read',{tokenHash});expect(sceneSchema.safeParse(shared.scene).success).toBe(true);expect(JSON.stringify(shared)).not.toContain(image.assetId);
 });
 it('HTTP save blocks new penetration, multipart validates uploads before registration',async()=>{
  const api=createApi(f.backend,env);const lease=await project(),s=structuralScene();await f.rpc(owner,'scene.save',{...lease,scene:s});s.objects=[{...chair(),position:p(0,1)}];
  const response=await api(new Request(`https://backend.example/projects/${lease.projectId}/scene`,{method:'PUT',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({...lease,projectId:undefined,expectedRevision:1,scene:s})}));expect(response.status).toBe(422);
  const form=new FormData();form.set('projectId',lease.projectId);form.set('kind','photo');form.set('file',new File(['not an image'],'bad.webp',{type:'image/webp'}));const upload=await api(new Request('https://backend.example/assets/sources',{method:'POST',headers:{authorization:`Bearer ${owner}`},body:form}));expect(upload.status).toBe(422);
 });
});
