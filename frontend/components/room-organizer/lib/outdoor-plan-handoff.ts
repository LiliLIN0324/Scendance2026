import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { planVersion, type OutdoorBrief } from './outdoor-agent-contract';
export interface OutdoorDraftContext { brief: OutdoorBrief; requirements: string[] }
export function buildOutdoorPlanDraft(plan: SitePlanData, projectId: string, context: OutdoorDraftContext) {
 return structuredClone({schemaVersion:1,kind:'scendance-outdoor-plan-draft',projectId,planVersion:planVersion(plan),plan,brief:context.brief,requirements:context.requirements,limitations:['规划草案，未提供安全、消防或场地授权认证','当前保留的对话原话不代表完整需求清单；已确认结构化事实另见brief','地图像素未送入模型；未知室内通路和门口仍需人工核对','模型和计划数量不代表实物库存或专业点验结果']});
}
export function downloadOutdoorPlanDraft(plan: SitePlanData, projectId: string, context: OutdoorDraftContext): void {
 const text=JSON.stringify(buildOutdoorPlanDraft(plan,projectId,context),null,2);
 const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='outdoor-plan-draft.json';
 try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
