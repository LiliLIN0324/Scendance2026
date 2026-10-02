import { z } from 'zod';
import { ImageUtils } from '@gltf-transform/core';
import { ApiError, canonical, catalog, leaseSchema, proposalRequestSchema, randomToken, sceneHash, sceneSchema, sceneWarnings, sha256, uuid } from './domain.ts';
import { assetRecord, importPublicModel, recommendations } from './assets.ts';
import { generateProposal } from './providers.ts';
import { readBounded, required, reserveCost, type Env, type Fetcher } from './http.ts';
import type { Backend } from './backend.ts';

const name=z.string().trim().min(1).max(120);
const idempotency=z.strictObject({requestId:uuid,prompt:z.string().trim().min(1).max(1024)});
const projectBody=(body:unknown,id:string)=>({...z.record(z.string(),z.unknown()).parse(body),projectId:uuid.parse(id)});
const savedScene=z.strictObject({...leaseSchema.shape,scene:sceneSchema});
export function createApi(backend:Backend,env:Env,fetcher:Fetcher=fetch) {
  return async(request:Request):Promise<Response>=>{
    const origin=request.headers.get('origin');
    const allowed=(env('ALLOWED_ORIGINS')??'http://localhost:3000').split(',').map(s=>s.trim());
    const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    if(origin && allowed.includes(origin)) headers.set('Access-Control-Allow-Origin',origin);
    const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
    try {
      if(origin && !allowed.includes(origin)) throw new ApiError('ORIGIN_FORBIDDEN',403);
      if(request.method==='OPTIONS') {
        headers.set('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
        headers.set('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info');
        return new Response(null,{status:204,headers});
      }
      const url=new URL(request.url);
      const path=url.pathname.replace(/^\/functions\/v1\/scene-api/,'').replace(/^\/scene-api/,'').replace(/\/$/,'')||'/';
      const method=request.method;
      const json=async()=>{
        if(!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('JSON_REQUIRED',415);
        try {return JSON.parse(new TextDecoder().decode(await readBounded(request,256_000))) as unknown;}
        catch(e) {if(e instanceof ApiError) throw e; throw new ApiError('INVALID_JSON');}
      };
      if(path==='/health' && method==='GET') return respond({ok:true,schemaVersion:1});
      if(path==='/share/read' && method==='POST') {
        const input=z.strictObject({token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await json());
        const tokenHash=await sha256(input.token);
        const shared=await backend.scene(null,'share.read',{tokenHash});
        shared.assets=await Promise.all(shared.assets.map(async(asset:{storagePath:string;[key:string]:unknown})=>{
          const {storagePath,...metadata}=asset; return {...metadata,url:await backend.sign(storagePath),expiresIn:300};
        }));
        // Recheck after signing, so revocation during a slow storage request also blocks the response.
        await backend.scene(null,'share.read',{tokenHash});
        return respond(shared);
      }
      const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if(!token) throw new ApiError('UNAUTHENTICATED',401);
      const actor=await backend.user(token);
      if(['/assets/import','/assets/floorplan','/catalog/recommendations'].includes(path) && !(await backend.scene(actor,'studios')).length) throw new ApiError('FORBIDDEN',403);
      if(path==='/studios' && method==='GET') return respond(await backend.scene(actor,'studios'));
      if(path==='/catalog' && method==='GET') return respond(catalog);
      if(path==='/projects' && method==='GET') return respond(await backend.scene(actor,'projects.list'));
      if(path==='/projects' && method==='POST') {
        const input=z.strictObject({studioId:uuid,name,scene:sceneSchema}).parse(await json());
        return respond(await backend.scene(actor,'projects.create',input),201);
      }
      const project=path.match(/^\/projects\/([^/]+)(.*)$/);
      if(project) {
        const projectId=uuid.parse(project[1]), tail=project[2];
        if(!tail && method==='GET') return respond(await backend.scene(actor,'projects.get',{projectId}));
        if(!tail && method==='PATCH') {
          const input=z.strictObject({...leaseSchema.shape,name}).parse(await json());
          return respond(await backend.scene(actor,'projects.rename',{...input,projectId}));
        }
        if(tail==='/materials' && method==='GET') return respond((await backend.scene(actor,'projects.get',{projectId})).materials);
        if(tail==='/lease/acquire' && method==='POST') {
          const input=z.strictObject({sessionId:uuid}).parse(await json());
          return respond(await backend.scene(actor,'lease.acquire',{...input,projectId}));
        }
        if(['/lease/renew','/lease/release'].includes(tail) && method==='POST') {
          const input=leaseSchema.omit({expectedRevision:true}).parse(await json());
          return respond(await backend.scene(actor,tail==='/lease/renew'?'lease.renew':'lease.release',{...input,projectId}));
        }
        if(tail==='/scene' && method==='PUT') {
          const input=savedScene.parse(await json());
          return respond({...await backend.scene(actor,'scene.save',{...input,projectId}),warnings:sceneWarnings(input.scene)});
        }
        if(tail==='/proposals' && method==='POST') {
          const input=proposalRequestSchema.parse(projectBody(await json(),projectId));
          if(input.selectedIds.some(id=>!input.scene.objects.some(o=>o.id===id))) throw new ApiError('INVALID_SELECTION',422);
          await backend.scene(actor,'lease.check',input);
          required(env,'DEEPSEEK_API_KEY');
          const reserveCents=reserveCost(env,'AI_MAX_REQUEST_CENTS');
          if(reserveCents<40) throw new ApiError('BILLING_NOT_CONFIGURED',503);
          const reservation=await backend.jobs(actor,'reserve',{requestId:input.requestId,fingerprint:await sha256(canonical(input)),reserveCents});
          if(reservation.reused) {
            if(reservation.state==='complete') return respond(reservation.result);
            throw new ApiError(reservation.state==='reserved'?'AI_IN_PROGRESS':'AI_PREVIOUS_REQUEST_FAILED',409,{requestId:input.requestId});
          }
          try {
            const proposal=await generateProposal(input,env,attempt=>backend.jobs(actor,'text.reserve_call',{id:reservation.id,attempt}),fetcher);
            const stored=await backend.scene(actor,'proposals.store',{
              ...input,id:reservation.id,baseHash:await sceneHash(input.scene),candidate:proposal.scene,explanation:proposal.explanation,warnings:proposal.warnings,
            });
            await backend.jobs(actor,'requests.finish',{id:reservation.id,state:'complete',result:stored,usage:proposal.usage});
            return respond(stored,201);
          } catch(error) {
            await backend.jobs(actor,'requests.finish',{id:reservation.id,state:'failed',result:null,usage:error instanceof ApiError?error.details??{}:{}}).catch(()=>{});
            throw error;
          }
        }
        if(tail==='/proposals/apply' && method==='POST') {
          const input=z.strictObject({...leaseSchema.shape,proposalId:uuid,localRevision:z.number().int().nonnegative(),currentScene:sceneSchema}).parse(await json());
          return respond(await backend.scene(actor,'proposals.apply',{...input,projectId,baseHash:await sceneHash(input.currentScene)}));
        }
        if(tail==='/publish' && method==='POST') {
          const input=z.strictObject({expectedRevision:z.number().int().nonnegative()}).parse(await json());
          const base=required(env,'PUBLIC_APP_URL');
          const shareToken=randomToken();
          const result=await backend.scene(actor,'publish',{...input,projectId,tokenHash:await sha256(shareToken)});
          return respond({...result,url:`${base.replace(/\/$/,'')}/view/#${shareToken}`,token:shareToken},201);
        }
        if(tail==='/shares' && method==='GET') return respond(await backend.scene(actor,'shares.list',{projectId}));
        const share=tail.match(/^\/shares\/([^/]+)$/);
        if(share && method==='DELETE') return respond(await backend.scene(actor,'shares.revoke',{projectId,shareId:uuid.parse(share[1])}));
      }
      if(path==='/assets' && method==='GET') return respond(await backend.scene(actor,'assets.list'));
      const asset=path.match(/^\/assets\/([^/]+)\/url$/);
      if(asset && method==='POST') {
        const a=await backend.scene(actor,'assets.get',{assetId:uuid.parse(asset[1])});
        const {storage_path,...metadata}=a;
        return respond({...metadata,url:await backend.sign(storage_path),expiresIn:300});
      }
      if(path==='/catalog/recommendations' && method==='POST') {
        const input=z.strictObject({theme:z.string().max(500),scene:sceneSchema}).parse(await json());
        return respond(await recommendations(input.theme,input.scene,fetcher));
      }
      if(path==='/assets/import' && method==='POST') {
        const {modelId}=z.strictObject({modelId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)}).parse(await json());
        const {bytes,...properties}=await importPublicModel(modelId,fetcher);
        const record=await assetRecord(actor,bytes,properties);
        await backend.upload(record.storagePath,bytes,'model/gltf-binary');
        return respond(await backend.scene(actor,'assets.register',record),201);
      }
      if(path==='/assets/floorplan' && method==='POST') {
        const mime=request.headers.get('content-type');
        if(mime!=='image/png' && mime!=='image/jpeg') throw new ApiError('UNSUPPORTED_IMAGE',415);
        const bytes=await readBounded(request,5*1024*1024);
        const size=ImageUtils.getSize(bytes,mime);
        if(!size || size.some(n=>n<=0||n>4096)) throw new ApiError('INVALID_IMAGE',422);
        const record=await assetRecord(actor,bytes,{name:'场地平面图',source:'upload',format:mime==='image/png'?'png':'jpeg',metadata:{width:size[0],height:size[1]},license:{type:'user-upload'}});
        await backend.upload(record.storagePath,bytes,mime);
        return respond(await backend.scene(actor,'assets.register',record),201);
      }
      if(path==='/jobs' && method==='POST') {
        const input=idempotency.parse(await json());
        required(env,'HUNYUAN_API_KEY'); required(env,'HUNYUAN_TERMS_REVIEWED_AT'); required(env,'HUNYUAN_TERMS_URL');
        const result=await backend.jobs(actor,'jobs.create',{...input,fingerprint:await sha256(input.prompt),reserveCents:reserveCost(env,'GENERATION_MAX_TASK_CENTS')});
        const {worker_token,worker_until,...safe}=result;
        return respond(safe,result.reused?200:202);
      }
      if(path==='/jobs' && method==='GET') return respond(await backend.jobs(actor,'jobs.list'));
      const job=path.match(/^\/jobs\/([^/]+)(\/added)?$/);
      if(job && !job[2] && method==='GET') return respond(await backend.jobs(actor,'jobs.get',{id:uuid.parse(job[1])}));
      if(job && job[2] && method==='POST') {
        const input=z.strictObject({projectId:uuid}).parse(await json());
        return respond(await backend.jobs(actor,'jobs.added',{...input,id:uuid.parse(job[1])}));
      }
      throw new ApiError('ROUTE_NOT_FOUND',404);
    } catch(error) {
      if(error instanceof z.ZodError) return respond({error:{code:'VALIDATION_ERROR',details:error.issues.map(i=>({path:i.path,message:i.message}))}},400);
      if(error instanceof ApiError) return respond({error:{code:error.code,details:error.details}},error.status);
      // Do not return SDK exceptions, signed URLs, prompts, tokens, or upstream response bodies.
      return respond({error:{code:'INTERNAL_ERROR'}},500);
    }
  };
}
