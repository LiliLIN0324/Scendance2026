import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { StyleBundle } from './style-bundles';
/** Palette only. Never call furniture-sets or manufacture inventory/placement from a style. */
export function proposeOutdoorStyle(plan: SitePlanData, bundle: StyleBundle): SitePlanData {
 if(!plan.facilities.length)throw new Error('当前还没有设施可预览配色；请先在分区复用真实物料，再应用这套色板。不会凭风格生成家具模板。');
 const color=bundle.swatches.find(value=>/^#[0-9a-fA-F]{6}$/.test(value))?.toLowerCase();
 if(!color)throw new Error('此色板尚无可保存的HEX颜色，请选现成色板；未修改规划。');
 if(plan.facilities.every(f=>f.color?.toLowerCase()===color))throw new Error('现有设施已经使用这套主色，没有重复修改。');
 return {...plan,facilities:plan.facilities.map(f=>({...f,color}))};
}
