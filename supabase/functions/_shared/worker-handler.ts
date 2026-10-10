import { processGeneration } from './worker.ts';
import { required, type Env, type Fetcher } from './http.ts';
import { ApiError, sha256 } from './domain.ts';
import type { Backend } from './backend.ts';

export function createWorker(backend:Backend,env:Env,fetcher:Fetcher=fetch) {
  return async(request:Request):Promise<Response>=>{
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    if(request.method!=='POST') return new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers});
    try {
      const secret=required(env,'GENERATION_WORKER_SECRET');
      const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if(!token || await sha256(token)!==await sha256(secret)) return new Response(JSON.stringify({error:'UNAUTHENTICATED'}),{status:401,headers});
      return new Response(JSON.stringify(await processGeneration(backend,env,fetcher)),{headers});
    } catch(error) {
      const unavailable=error instanceof ApiError && error.code==='SERVICE_NOT_CONFIGURED';
      return new Response(JSON.stringify({error:unavailable?'SERVICE_NOT_CONFIGURED':'WORKER_FAILED'}),{status:unavailable?503:500,headers});
    }
  };
}
