import {sameRecoveryFormValue} from '@/lib/recovery-form-value';
export type DraftPart<T>={status:'captured';value:T}|{status:'none'}|{status:'unavailable';reason:string};
export type DraftImage={id:string;name:string;blob:Blob};
export interface ReadonlyDraftInputs {
 scope:string;
 additionalOmissions?:readonly string[];
 layout:DraftPart<unknown>; conversations:DraftPart<unknown>; brief:DraftPart<unknown>;
 images:DraftPart<readonly DraftImage[]>; environment:DraftPart<unknown>; calibration:DraftPart<unknown>;
}
export interface ReadonlyDraftBundle {json:string;images:readonly DraftImage[]; omissions:readonly string[]}
/** A partial export, never a backup; an unrepresentable part is explicitly omitted. */
export function prepareReadonlyDraftBundle(input:ReadonlyDraftInputs):ReadonlyDraftBundle {
 const omissions:string[]=['此文件不是完整备份，不包含已保存数据、所有模型、云端记录或其他活动。',...(input.additionalOmissions??[])];
 const encode=(name:string,part:DraftPart<unknown>)=>{
  if(part.status==='none')return {status:'none'};
  if(part.status==='unavailable'){omissions.push(`${name}未包含：${part.reason}`);return {status:'unavailable',reason:part.reason};}
  try{const clone=structuredClone(part.value),json=JSON.stringify(clone);if(json===undefined)throw new Error();
   const value:unknown=JSON.parse(json);if(!sameRecoveryFormValue(clone,value))throw new Error();return {status:'captured',value};
  }catch{const reason='资料无法无损序列化';omissions.push(`${name}未包含：${reason}`);return {status:'unavailable',reason};}
 };
 let images:DraftImage[]=[],imageManifest:unknown;
 if(input.images.status==='captured'){
  for(const image of input.images.value){if(!image||typeof image.id!=='string'||typeof image.name!=='string'||!(image.blob instanceof Blob)){
    omissions.push('部分图片原件未包含：原始文件不可读取。');continue;}
   images.push({id:image.id,name:image.name,blob:image.blob});}
  imageManifest={status:'separate-downloads',files:images.map(({id,name,blob})=>({id,name,size:blob.size,type:blob.type}))};
  if(images.length)omissions.push('图片原件未包含在 JSON 中，需逐个点击下载。');
 } else if(input.images.status==='none') imageManifest={status:'none'};
 else {omissions.push(`图片原件未包含：${input.images.reason}`);imageManifest={status:'unavailable',reason:input.images.reason};}
 const sections={layout:encode('布局',input.layout),conversations:encode('未发送对话',input.conversations),brief:encode('需求草稿',input.brief),
  images:imageManifest,environment:encode('场地候选',input.environment),calibration:encode('标定候选',input.calibration)};
 return {json:JSON.stringify({format:'scendance-partial-page-drafts',version:1,scope:input.scope,sections,omissions},null,2),images,omissions};
}
