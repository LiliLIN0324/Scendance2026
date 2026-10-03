import { processReconstruction } from './reconstruction.ts';
import { required, type Env, type Fetcher } from './http.ts';
import { ApiError, sha256 } from './domain.ts';
import type { Backend } from './backend.ts';
export function createReconstructionWorker(backend:Backend,env:Env,fetcher:Fetcher=fetch){return async(request:Request)=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(request.method!=='POST')return new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers});
 try{const secret=required(env,'RECONSTRUCTION_WORKER_SECRET'),token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if(!token||await sha256(token)!==await sha256(secret))return new Response(JSON.stringify({error:'UNAUTHENTICATED'}),{status:401,headers});
  return new Response(JSON.stringify(await processReconstruction(backend,env,fetcher)),{headers});
 }catch(e){return new Response(JSON.stringify({error:e instanceof ApiError?e.code:'WORKER_FAILED'}),{status:e instanceof ApiError?e.status:500,headers});}
};}
