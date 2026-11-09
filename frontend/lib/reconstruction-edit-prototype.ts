/** Isolated design experiment. Not connected to the application or an authorization boundary. */
import {canonical,sceneSchema,type SceneV2} from '../../supabase/functions/_shared/domain';
import {structuralViolations} from '../../supabase/functions/_shared/structural-geometry';

export type ReviewDifference={path:string;label:string;before:{exists:boolean;value?:unknown};after:{exists:boolean;value?:unknown}};
const LABELS:Record<string,string>={structure:'场地结构',walls:'墙段',openings:'门窗',columns:'柱子',dimensions:'尺寸',venue:'场地',objects:'物件',start:'起点',end:'终点',position:'位置',size:'尺寸',width:'宽度',depth:'深度',height:'高度',thickness:'厚度',status:'核对状态',valueMeters:'数值（米）',offset:'距墙起点',sillHeight:'离地高度',rotation:'旋转角度',x:'X',z:'Z'};
function describe(path:string):string{return path.split('/').slice(1).map(part=>/^\d+$/.test(part)?`第 ${Number(part)+1} 项`:LABELS[part]??part).join(' · ')||'场景';}

/** Prepare only complete, losslessly parsed V2 scenes. Every geometry confirmation is invalidated. */
export function prepareReviewEdit(beforeRaw:unknown,afterRaw:unknown):{candidate:SceneV2;differences:ReviewDifference[]} {
 const jsonSafe=(v:unknown):boolean=>v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&Array.from({length:v.length},(_,i)=>i in v&&jsonSafe(v[i])).every(Boolean)||!!v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&Object.values(v).every(jsonSafe);
 const parse=(raw:unknown)=>{if(!jsonSafe(raw))throw new Error('场景含不可保存的数据');const scene=sceneSchema.parse(raw);if(scene.schemaVersion!==2||canonical(scene)!==canonical(raw))throw new Error('场景版本不完整或解析后发生变化');return scene;};
 const before=parse(beforeRaw),after=parse(afterRaw);
 if(canonical(before.sources)!==canonical(after.sources))throw new Error('来源图片不可在修改候选中变更');
 const candidate:SceneV2={...after,structure:{walls:after.structure.walls.map(w=>({...w,status:'inferred'})),openings:after.structure.openings.map(o=>({...o,status:'inferred'})),columns:after.structure.columns.map(c=>({...c,status:'inferred'}))},dimensions:after.dimensions.map(d=>({...d,status:'inferred'}))};
 sceneSchema.parse(candidate);
 if(structuralViolations(candidate).length)throw new Error('场景与墙、柱或边界冲突');
 const differences:ReviewDifference[]=[];
 const visit=(a:unknown,b:unknown,path:string):void=>{
  if(canonical(a)===canonical(b))return;
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
   const x=a as Record<string,unknown>,y=b as Record<string,unknown>;
   for(const key of [...new Set([...Object.keys(x),...Object.keys(y)])].sort())visit(x[key],y[key],`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`);
  }else if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length){for(let i=0;i<a.length;i++)visit(a[i],b[i],`${path}/${i}`);}
  else differences.push({path:path||'/',label:describe(path),before:a===undefined?{exists:false}:{exists:true,value:a},after:b===undefined?{exists:false}:{exists:true,value:b}});
  if(differences.length>512)throw new Error('修改项过多，请分批核对');
 };
 visit(before,candidate,'');
 return {candidate,differences};
}
