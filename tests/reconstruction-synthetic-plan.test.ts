import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,scene,session,studio} from './fixtures.ts';
import {syntheticFloorplanPng} from './fixtures/synthetic-floorplan.ts';
import {canonical,sceneHash,sceneV2Schema,sha256,type SceneV2} from '../supabase/functions/_shared/domain.ts';
import {processReconstruction} from '../supabase/functions/_shared/reconstruction.ts';

/** The image and recognition response are fabricated; these tests do not measure OCR or VLM accuracy. */
describe('fictional floorplan reconstruction workflow',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  const env=(key:string)=>({DEEPSEEK_API_KEY:'synthetic-only',RECONSTRUCTION_MAX_REQUEST_CENTS:'200'} as Record<string,string>)[key];
  const imageBytes=syntheticFloorplanPng();
  beforeAll(async()=>{f=await database();},30000);
  afterAll(async()=>{await f?.db.close();});

  async function prepare(widthMeters:number|null){
    const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'虚构图纸流程测试',scene:scene()});
    const leaseData=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
    const lease={projectId:project.id,sessionId:session,generation:leaseData.generation,expectedRevision:0};
    const sourceId=crypto.randomUUID();
    const source=await f.rpc(owner,'sources.register',{projectId:project.id,kind:'floorplan',asset:{id:sourceId,name:'synthetic-plan.png',source:'upload',format:'png',storagePath:`${owner}/${sourceId}/synthetic.png`,byteSize:imageBytes.length,sha256:await sha256(sourceId),metadata:{width:320,height:240},license:{type:'user-upload'}}});
    const points=[{x:0,z:0},{x:12,z:0},{x:12,z:10},{x:0,z:10}];
    const normalized=[{x:35/320,z:30/240},{x:285/320,z:30/240},{x:285/320,z:205/240},{x:35/320,z:205/240}];
    const walls=points.map((start,i)=>({id:crypto.randomUUID(),start,end:points[(i+1)%4],height:3,thickness:0.2,kind:'exterior' as const,status:'confirmed' as const,evidence:[{sourceAssetId:source.assetId,start:normalized[i],end:normalized[(i+1)%4]}]}));
    const opening={id:crypto.randomUUID(),wallId:walls[2].id,kind:'door' as const,offset:5,width:1,height:2.1,sillHeight:0,status:'confirmed' as const};
    const window={id:crypto.randomUUID(),wallId:walls[0].id,kind:'window' as const,offset:3,width:1.2,height:1.2,sillHeight:0.9,status:'confirmed' as const};
    const candidate=sceneV2Schema.parse({...scene(),schemaVersion:2,venue:{...scene().venue,width:12,depth:10,height:3,entrances:[]},objects:[],structure:{walls,openings:[opening,window],columns:[]},sources:[source],dimensions:[]});
    const dimensions=widthMeters===null?[]:[{id:crypto.randomUUID(),kind:'width' as const,valueMeters:widthMeters,status:'confirmed' as const,label:'虚构测试参考宽度'}];
    const input={...lease,requestId:crypto.randomUUID(),localRevision:0,scene:scene(),sources:[source],dimensions,mode:'redesign' as const,instruction:'虚构讲座空间，先识别图纸',selectedIds:[]};
    const job=await f.reconstruction(owner,'create',{input,baseHash:await sceneHash(input.scene),fingerprint:await sha256(canonical(input)),reserveCents:200});
    return {lease,input,job,candidate,source};
  }
  async function run(prepared:Awaited<ReturnType<typeof prepare>>,reported:SceneV2){
    let calls=0;
    const backend={...f.backend,readSourceBytes:async()=>imageBytes};
    const mock:typeof fetch=async (_url,init)=>{
      calls++;
      const request=JSON.parse(String(init?.body));
      const image=request.messages[1].content.find((item:{type:string})=>item.type==='image_url');
      expect(image.image_url.url).toBe(`data:image/png;base64,${Buffer.from(imageBytes).toString('base64')}`);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({scene:reported,issues:[]})},finish_reason:'stop'}]}));
    };
    const result=await processReconstruction(backend,env,mock);
    expect(calls).toBe(1);
    const job=await f.reconstruction(owner,'get',{projectId:prepared.lease.projectId,id:prepared.job.id});
    const stored=await f.rpc(owner,'projects.get',prepared.lease);
    expect(stored.scene).toEqual(prepared.input.scene);
    expect(stored.revision).toBe(0);
    return {result,job};
  }

  it('keeps image-sourced walls and opening detected, with unknown scale and door width awaiting review',async()=>{
    const p=await prepare(null),{result,job}=await run(p,p.candidate);
    expect(result.state).toBe('needs_review');expect(job.proposal).toBeNull();
    expect(job.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'SCALE_REQUIRED'}),expect.objectContaining({code:'HEIGHT_REQUIRED'}),expect.objectContaining({code:'STRUCTURE_REVIEW_REQUIRED',targetId:p.candidate.structure.openings[0].id})]));
    expect(job.candidate.sources).toEqual([p.source]);
    expect(job.candidate.structure.walls[0].evidence).toEqual(p.candidate.structure.walls[0].evidence);
    expect(job.candidate.structure.walls.every((w:{status:string})=>w.status==='detected')).toBe(true);
    expect(job.candidate.structure.openings.map((opening:{status:string})=>opening.status)).toEqual(['detected','detected']);
  });

  it('does not silently scale a 1000-fold mismatch between confirmed metres and recognized geometry',async()=>{
    const p=await prepare(0.012),{result,job}=await run(p,p.candidate);
    expect(result.state).toBe('needs_review');expect(job.proposal).toBeNull();
    expect(job.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'SCALE_IMPLAUSIBLE'})]));
    expect(job.candidate.venue.width).toBe(12);
    expect(job.candidate.structure.openings[0].status).toBe('detected');
  });

  it('downgrades a model-asserted confirmed dimension to detected even with a confirmed reference',async()=>{
    const p=await prepare(12);const dimension={id:crypto.randomUUID(),kind:'depth' as const,valueMeters:10,status:'confirmed' as const,label:'虚构识别深度',sourceAssetId:p.source.assetId};
    p.candidate.dimensions=[dimension];const {result,job}=await run(p,p.candidate);
    expect(result.state).toBe('needs_review');expect(job.candidate.dimensions.find((d:{id:string})=>d.id===dimension.id)).toMatchObject({status:'detected',sourceAssetId:p.source.assetId});
    expect(job.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'DIMENSION_REVIEW_REQUIRED',targetId:dimension.id})]));
  });
});
