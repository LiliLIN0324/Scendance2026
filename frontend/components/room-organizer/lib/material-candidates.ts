import {filterOnlineModels,loadOnlineModels,type OnlineModelIndex} from './online-models';

/** A model in the shipped catalogue, not a physical item or an inventory record. */
export interface MaterialCandidate {
  slug:string;
  assetId?:string;
  name:string;
  /** Catalogue dimensions in metres, normalized by the existing library loader. */
  dimensions:{width:number;depth:number;height:number};
}
export type MaterialCandidateResult =
  | {status:'ok';query:string;total:number;items:MaterialCandidate[]}
  | {status:'needs_query'|'invalid'|'unavailable';items:[]};

/** Query the same catalogue as the materials rail; does not load GLBs or call a provider. */
export async function searchMaterialCandidates(query:string,options:{limit?:number;load?:()=>Promise<OnlineModelIndex>}={}):Promise<MaterialCandidateResult> {
  if(typeof query!=='string')return {status:'invalid',items:[]};
  const text=query.trim();
  if(!text)return {status:'needs_query',items:[]};
  if(text.length>120||/[\u0000-\u001f\u007f]/.test(text))return {status:'invalid',items:[]};
  const limit=options.limit??5;
  if(!Number.isSafeInteger(limit)||limit<1||limit>10)return {status:'invalid',items:[]};
  // The shipped Chinese catalogue uses e.g. “餐椅”, rather than “餐椅子”.
  // Keep this spelling normalization narrow; it is not semantic substitution.
  const needle=text.replace(/椅子/g,'椅');
  try {
    const index=await (options.load??loadOnlineModels)();
    const words=needle.toLowerCase().split(/\s+/);
    // Bucket and subcategory labels broaden the rail search; do not let “椅” return stools or sofas solely because they share a category.
    const matches=filterOnlineModels(index.models,needle,'').filter(model=>{
      const fields=[model.name,model.originalName??'',model.slug].join(' ').toLowerCase();
      return words.every(word=>fields.includes(word));
    });
    const items=matches.slice(0,limit).map(model=>({slug:model.slug,...(model.assetId?{assetId:model.assetId}:{}),name:model.name,dimensions:{width:model.width,depth:model.depth,height:model.height}}));
    return {status:'ok',query:text,total:matches.length,items};
  }catch{return {status:'unavailable',items:[]};}
}
