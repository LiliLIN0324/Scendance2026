import { ApiError } from './domain.ts';
import { assetRecord } from './assets.ts';
import { download, required, type Env, type Fetcher } from './http.ts';
import { hunyuan } from './providers.ts';
import { MAX_GLB_BYTES, validateModel } from './models.ts';
import type { Backend } from './backend.ts';

export async function processGeneration(backend:Backend,env:Env,fetcher:Fetcher=fetch) {
  required(env,'HUNYUAN_API_KEY');
  const provider=hunyuan(env,fetcher);
  const job=await backend.jobs(null,'jobs.claim');
  if(!job) return {processed:0};
  const update=(state:string,extra:Record<string,unknown>={})=>backend.jobs(null,'jobs.update',{id:job.id,workerToken:job.worker_token,state,...extra});
  if(Date.now()-Date.parse(job.created_at)>23*60*60*1000) {
    await update('failed',{errorCode:'PROVIDER_TASK_EXPIRED'});
    return {processed:1};
  }
  if(job.state==='submitting') {
    try {
      const submitted=await provider.submit(job.prompt);
      await update('submitted',{providerJobId:submitted.JobId,usage:{requestId:submitted.RequestId}});
    } catch(error) {
      // HTTP 5xx, invalid response, network timeout, or lost DB acknowledgement may all follow a charged submission.
      await update(error instanceof ApiError && error.code==='PROVIDER_REJECTED'?'failed':'submit_unknown',{errorCode:error instanceof ApiError?error.code:'SUBMIT_RESULT_UNKNOWN'});
    }
    return {processed:1};
  }
  let archiving=job.state==='archiving';
  try {
    const result=await provider.query(job.provider_job_id);
    const usage={credits:result.ResultCreditConsumed,details:result.ResultCreditDetails,requestId:result.RequestId};
    if(result.Status==='FAIL') await update('failed',{errorCode:result.ErrorCode||'PROVIDER_FAILED',usage});
    else if(result.Status!=='DONE') await update('processing',{usage});
    else {
      await backend.jobs(null,'jobs.archive_start',{id:job.id,workerToken:job.worker_token});
      archiving=true;
      const file=result.ResultFile3Ds?.find(f=>f.Type.toUpperCase()==='GLB');
      if(!file) throw new ApiError('PROVIDER_NO_GLB',422);
      // Accept only Tencent object-storage domains; never proxy arbitrary URLs or redirects.
      const bytes=await download(file.Url,['.myqcloud.com','.tencentcos.cn','.tencentcos.com'],MAX_GLB_BYTES,fetcher);
      const metadata=await validateModel(bytes);
      const asset=await assetRecord(job.owner_id,bytes,{
        name:job.prompt.slice(0,120),source:'hunyuan',sourceId:job.provider_job_id,
        sourceUrl:'https://cloud.tencent.com/product/ai3d',metadata,
        license:{type:'provider-terms',reviewedAt:required(env,'HUNYUAN_TERMS_REVIEWED_AT'),url:required(env,'HUNYUAN_TERMS_URL')},
      },job.id);
      await backend.upload(asset.storagePath,bytes,'model/gltf-binary');
      await backend.jobs(null,'jobs.complete',{id:job.id,workerToken:job.worker_token,asset,usage});
    }
  } catch(error) {
    const invalid=error instanceof ApiError && [413,422].includes(error.status);
    const expired=Date.now()-Date.parse(job.created_at)>23*60*60*1000;
    await update(invalid?'rejected':expired?'failed':archiving?'archiving':'processing',{errorCode:error instanceof ApiError?error.code:'GENERATION_POLL_FAILED'});
  }
  return {processed:1};
}
