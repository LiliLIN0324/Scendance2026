import { ApiError } from './domain.ts';
import type { GenerationCapabilities } from './generation-contract.ts';
import { parametricParametersSchema, type ParametricParameters } from './parametric-contract.ts';

/**
 * The lanes a 3D asset can come from, ordered cheapest first: the offline archive and the
 * curated CC0 library cost nothing, the parametric builder is a few milliseconds of local CPU and
 * only `hy3d`/`aholo` spend provider credit. Every caller that decides "where does this model come
 * from" goes through `chooseLane` so the cheap-first rule lives in exactly one place. Metered
 * text/image defaults to Aholo Lux3D when configured; legacy HY-3D remains the fallback lane.
 */
export const generationLanes=['offline','library','parametric','hy3d','aholo'] as const;
export type GenerationLane=typeof generationLanes[number];
export const laneCost:Record<GenerationLane,'free'|'metered'>={offline:'free',library:'free',parametric:'free',hy3d:'metered',aholo:'metered'};

export interface LaneRequest {
  kind:'text'|'image'|'texture';
  /** Explicit vendor declaration from the request. Only 'aholo' is accepted. */
  provider?:'aholo'|undefined;
  /**
   * An already-decided deterministic build, declared by the caller (the planning agent's
   * `create_parametric_model` tool, the `/assets/parametric` route or an offline bake request).
   * Never inferred from prompt prose — guessing a family from free text would invent geometry.
   */
  parameters?:unknown;
  /** P3 offline archive hit: the fingerprint that resolved. Only meaningful with `parameters`. */
  offlineFingerprint?:string;
  /** Curated CC0 catalogue hit. */
  libraryAssetId?:string;
}

export interface LaneDecision {
  lane:GenerationLane;
  reason:string;
  cost:'free'|'metered';
  /** False when no lane can serve the request under the current configuration. */
  available:boolean;
}

/** Pure decision function: no env reads, no network, no side effects. */
export function chooseLane(request:LaneRequest,capabilities:GenerationCapabilities):LaneDecision {
  const hy3Available=request.kind==='text'?capabilities.textToModel:request.kind==='image'?capabilities.imageToModel:capabilities.texture;
  const hy3=(reason:string):LaneDecision=>({lane:'hy3d',reason,cost:laneCost.hy3d,available:hy3Available});
  const aholoAvailable=request.kind==='text'?capabilities.aholoTextToModel:request.kind==='image'?capabilities.aholoImageToModel:false;
  const aholo=(reason:string,available=aholoAvailable):LaneDecision=>({lane:'aholo',reason,cost:laneCost.aholo,available});
  // Explicit aholo declaration is a spend decision by the caller; texture has no Lux3D lane.
  if(request.provider==='aholo'&&request.kind!=='texture'){
    return aholo(`请求显式声明 aholo，交由 Lux3D 生成`);
  }
  // Image and texture lanes have no free equivalent: they transform an input that only the
  // provider can consume, so routing them anywhere else would fabricate a result.
  if(request.kind==='texture')return hy3(capabilities.texture?'纹理只能对已有模型重贴图，必须走云端纹理通道':'纹理通道未开放：需要 HUNYUAN_API_MODE=tokenhub 且 HUNYUAN_TEXTURE_ENABLED=true');
  if(request.kind==='image'){
    if(aholoAvailable)return aholo('图生模型优先走 Aholo Lux3D');
    return hy3(capabilities.imageToModel?'Aholo 未配置，图生模型回退 HY-3D 云生成':'图生模型未开放：需要 Aholo Lux3D 或 tokenhub HY-3D');
  }
  if(request.parameters!==undefined){
    const parsed=parametricParametersSchema.safeParse(request.parameters);
    if(!parsed.success)throw new ApiError('INVALID_PARAMETRIC_PARAMETERS',422,{issues:parsed.error.issues});
    const parameters:ParametricParameters=parsed.data;
    if(request.offlineFingerprint)return {lane:'offline',reason:`参数指纹命中离线归档 ${request.offlineFingerprint}，直接取用`,cost:laneCost.offline,available:true};
    return {lane:'parametric',reason:`构型 ${parameters.family} 可由参数化生成器确定性构造，无需调用云`,cost:laneCost.parametric,available:true};
  }
  if(request.libraryAssetId)return {lane:'library',reason:`精选 CC0 模型库已有该物件（${request.libraryAssetId}）`,cost:laneCost.library,available:true};
  if(aholoAvailable)return aholo('没有可用的免费通道，交由 Aholo Lux3D 生成');
  return hy3('没有可用的免费通道，Aholo 未配置，回退 HY-3D 生成');
}
