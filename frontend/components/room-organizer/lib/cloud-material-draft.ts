import { deliveryPrivateText } from '@/lib/delivery-private-text';
import type { RoomLayout } from './types';

const notice = '本文件是当前画布的本机快照，未冻结为云端版本。数字模型不代表实物库存或可预订数量。未包含完整活动需求、点验记录与场地方确认；出口、疏散、消防、无障碍、容量和现场条件均待核验。';
const escape = (value:unknown) => deliveryPrivateText(String(value ?? '')).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
function sourceLabel(source:string):string {
 switch(source){
  case 'builtin':return '内置模型';
  case 'public_library':return '公共模型库';
  case 'generated':return '生成模型';
  case 'cloud_asset':return '云端模型';
  default:return '来源待核验';
 }
}
type DeliveryTools=Pick<typeof import('./scene-delivery'),'deliveryMaterials'|'downloadSceneDelivery'>;

/** A bounded visual draft of the current editor snapshot, never a full handoff or inventory claim. */
export async function exportCloudMaterialDraft({layout,dirty,stillCurrent,load=()=>import('./scene-delivery')}:{
 layout:RoomLayout;dirty:boolean;stillCurrent:()=>boolean;load?:()=>Promise<DeliveryTools>;
}):Promise<void> {
 const check=()=>{if(!stillCurrent())throw new Error('项目、版本、楼层或场景已变化，未导出草案。');};
 check();const tools=await load();check();
 const rows=tools.deliveryMaterials(layout),stamp=new Date().toISOString();
 const body=rows.map(row=>`<tr><td>${escape(row.name)}</td><td>${sourceLabel(row.source)}</td><td>${row.width} × ${row.depth} × ${row.height} 米</td><td>${row.quantity}</td><td>实物规格和可用数量待核验</td></tr>`).join('');
 const saveState=dirty?'工作台状态显示：本次包含尚未保存到云端的更改。':'工作台状态显示：本次读取时无未保存更改。';
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>当前场景物料清单草案</title><style>body{font:16px sans-serif;line-height:1.6;max-width:960px;margin:2em auto;padding:0 1em;color:#202620}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:.5em;text-align:left}</style></head><body><h1>当前场景物料清单草案</h1><p>${notice}</p><p>${saveState}</p><p>场景：${escape(layout.name)} · 生成时间：${escape(stamp)}</p><table><thead><tr><th>模型名称</th><th>模型来源</th><th>标称尺寸（宽 × 深 × 高）</th><th>场景数量</th><th>待核验</th></tr></thead><tbody>${body||'<tr><td colspan="5">当前场景没有可列出的物料。</td></tr>'}</tbody></table><p>已过滤部分可识别的凭据和私密链接，不能保证识别全部敏感信息，请分享前核对。</p></body></html>`;
 check();tools.downloadSceneDelivery(html,'text/html;charset=utf-8','当前场景物料清单_未冻结草案','html');
}
