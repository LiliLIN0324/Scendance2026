import { compareTextureGeometry, requireTextureSource } from './generation-quality.ts';
import { ApiError } from './domain.ts';
import { assetRecord } from './assets.ts';
import { download, required, type Env, type Fetcher } from './http.ts';
import { hunyuan } from './providers.ts';
import { MAX_GLB_BYTES, validateModel } from './models.ts';
import type { Backend } from './backend.ts';

export async function processGeneration(backend:Backend,env:Env,fetcher:Fetcher=fetch) {
  required(env,'HUNYUAN_API_KEY');
  const job=await backend.jobs(null,'jobs.claim');
  if(!job) return {processed:0};
  const provider=hunyuan(env,fetcher,{providerMode:job.provider_mode,providerModel:job.provider_model});
  const update=(state:string,extra:Record<string,unknown>={})=>backend.jobs(null,'jobs.update',{id:job.id,workerToken:job.worker_token,state,...extra});
  if(Date.now()-Date.parse(job.created_at)>23*60*60*1000) {
    await update('failed',{errorCode:'PROVIDER_TASK_EXPIRED'});
    return {processed:1};
  }
  if(job.state==='submitting') {
    let dispatched=false;
    try {
      let imageUrl:string|undefined,sourceUrl:string|undefined;
      if(job.reference_image_asset_id){
        const image=await backend.scene(job.owner_id,'assets.get',{assetId:job.reference_image_asset_id});
        if(image.owner_id!==job.owner_id||!['png','jpeg'].includes(image.format))throw new ApiError('REFERENCE_IMAGE_FORBIDDEN',403);
        imageUrl=await backend.sign(image.storage_path);
      }
      if(job.source_asset_id){
        const source=await backend.scene(job.owner_id,'assets.get',{assetId:job.source_asset_id});
        if(source.format!=='glb'||!backend.readSourceBytes)throw new ApiError('INVALID_SOURCE_MODEL',422);
        await requireTextureSource(await backend.readSourceBytes(source.storage_path));
        sourceUrl=await backend.sign(source.storage_path);
      }
      dispatched=true;
      const submitted=await provider.submit(job.prompt,{imageUrl,sourceUrl});
      await update('submitted',{providerJobId:submitted.JobId,usage:{requestId:submitted.RequestId}});
    } catch(error) {
      // HTTP 5xx, invalid response, network timeout, or lost DB acknowledgement may all follow a charged submission.
      await update(!dispatched||error instanceof ApiError && error.code==='PROVIDER_REJECTED'?'failed':'submit_unknown',{errorCode:error instanceof ApiError?error.code:'SUBMIT_RESULT_UNKNOWN'});
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
      const metadata:Record<string,unknown>=await validateModel(bytes);
      metadata.generation={kind:job.kind??'text',providerMode:job.provider_mode,providerModel:job.provider_model,referenceImageAssetId:job.reference_image_asset_id??undefined};
      if(job.kind==='texture'){
        const source=await backend.scene(job.owner_id,'assets.get',{assetId:job.source_asset_id});
        if(!backend.readSourceBytes)throw new ApiError('SERVICE_NOT_CONFIGURED',503);
        const quality=await compareTextureGeometry(await backend.readSourceBytes(source.storage_path),bytes);
        if(!quality.geometryPreserved||!quality.uvPreserved)throw new ApiError('TEXTURE_GEOMETRY_CHANGED',422,{quality});
        metadata.parentAssetId=job.source_asset_id;metadata.sourceSha256=source.sha256;metadata.changeMode='texture';
        metadata.textureVariant={validation:quality,procurementStatus:'needs_confirmation'};
      }
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
    await update(invalid?'rejected':expired?'failed':archiving?'archiving':'processing',{errorCode:error instanceof ApiError?error.code:'GENERATION_POLL_FAILED',...(error instanceof ApiError&&error.code==='TEXTURE_GEOMETRY_CHANGED'?{usage:{quality:error.details}}:{})});
  }
  return {processed:1};
}
