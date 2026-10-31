import { z } from 'zod';
import { uuid } from './domain.ts';
import type { Env } from './http.ts';

export const generationRequestSchema=z.strictObject({
  requestId:uuid,prompt:z.string().trim().min(1).max(1024),kind:z.enum(['text','image','texture']).default('text'),
  referenceImageAssetId:uuid.optional(),sourceAssetId:uuid.optional(),
  /** Explicit cloud-vendor declaration. Only `aholo` (Lux3D) is accepted; default stays HY-3D. */
  provider:z.enum(['aholo']).optional(),
}).superRefine((input,ctx)=>{
  if(input.kind==='text'&&(input.referenceImageAssetId||input.sourceAssetId))ctx.addIssue({code:'custom',message:'文字生成不能附带图片或源模型'});
  if(input.kind!=='text'&&!input.referenceImageAssetId)ctx.addIssue({code:'custom',path:['referenceImageAssetId'],message:'请选择参考图片'});
  if(input.kind==='texture'&&!input.sourceAssetId)ctx.addIssue({code:'custom',path:['sourceAssetId'],message:'请选择源模型'});
  if(input.kind==='image'&&input.sourceAssetId)ctx.addIssue({code:'custom',path:['sourceAssetId'],message:'图生模型不保留原网格，请使用纹理模式'});
});
export type GenerationRequest=z.infer<typeof generationRequestSchema>;
/**
 * Deterministic record of what was asked and, once archived, what came back.
 * `fingerprint` keeps the legacy request-idempotency meaning; `inputHash` covers
 * the whole identity including the explicit provider so the same requestId can
 * never be audited as one input while carrying two different vendor requests.
 */
export const generationRecordSchema=z.strictObject({
  version:z.literal(1),
  kind:z.enum(['text','image','texture']),
  lane:z.enum(['offline','library','parametric','hy3d','aholo']),
  fingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  inputHash:z.string().regex(/^[a-f0-9]{64}$/),
  promptSha256:z.string().regex(/^[a-f0-9]{64}$/),
  providerMode:z.enum(['tokenhub','legacy','aholo']),
  providerModel:z.enum(['hy-3d-3.0','hy-3d-3.1','hy-3d-texture','lux3d']),
  referenceImageAssetId:uuid.optional(),
  sourceAssetId:uuid.optional(),
});
export type GenerationRecord=z.infer<typeof generationRecordSchema>;
export type GenerationProvider={providerMode:'tokenhub'|'legacy'|'aholo';providerModel:'hy-3d-3.0'|'hy-3d-3.1'|'hy-3d-texture'|'lux3d'};
export function generationCapabilities(env:Env) {
  const mode=env('HUNYUAN_API_MODE')??'tokenhub',model=env('HUNYUAN_MODEL')??'hy-3d-3.0';
  const configured=env('HY3_RETIRED')!=='true'&&Boolean(env('HUNYUAN_API_KEY')&&env('HUNYUAN_TERMS_URL')&&env('HUNYUAN_TERMS_REVIEWED_AT'));
  const supported=(mode==='tokenhub'||mode==='legacy')&&(model==='hy-3d-3.0'||(mode==='tokenhub'&&model==='hy-3d-3.1'));
  const aholoConfigured=Boolean(env('LUX3D_API_KEY')&&env('LUX3D_TERMS_URL')&&env('LUX3D_TERMS_REVIEWED_AT'));
  return {model,textToModel:configured&&supported,imageToModel:configured&&supported&&mode==='tokenhub',texture:configured&&mode==='tokenhub'&&env('HUNYUAN_TEXTURE_ENABLED')==='true',textureRequiresImage:true as const,aholoTextToModel:aholoConfigured,aholoImageToModel:aholoConfigured};
}
export type GenerationCapabilities=ReturnType<typeof generationCapabilities>;
