import { extractPlanSizeFacts } from '@/lib/plan-size-facts';
import { hasDeliveryPrivateLiteral } from '@/lib/delivery-private-text';
import { deliverableInventory, layoutProvenanceBreakdown } from './deliverable-inventory';
import { isRoomLayout } from './schema';
import { layoutToBackendScene } from './backend-adapter';
import { isStructuralMarker } from './structural-layout';
import type { RoomLayout } from './types';
import { unavailablePlanChecklist } from '@/lib/plan-checklist';

/** 本地交接草案不是云端 Scene，也不是可用于恢复的项目备份。 */
export const LOCAL_DRAFT_FORMAT = 'scendance-local-draft-delivery';
const PRIVATE_KEYS = /(?:^glbUrl$|^floorPlanImage$|^(?:image|photo|attachment)$|(?:image|photo|floorplan|attachment).*(?:url|data|base64|bytes|blob|raw)|(?:source|file|raw).*(?:blob|bytes|base64|data)|token|api[_-]?key|secret|password|authorization|credential|cookie)/i;
const CREDENTIAL_TEXT = /(?:\b(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|signature)\s*[:=]\s*\S+|\bbearer\s+[a-z0-9._~-]{8,}|(?:密钥|密码|令牌)\s*[:：=]\s*\S+)/i;

function containsPrivateLink(value: string): boolean {
  if (hasDeliveryPrivateLiteral(value) || CREDENTIAL_TEXT.test(value) || /(?:^|[^a-z0-9_])(?:blob|data|file):/i.test(value)
    || /(?:^|[^a-z0-9+/])(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)[a-z0-9+/=]{16,}/i.test(value)) return true;
  if (/https?%3a%2f%2f/i.test(value) || /(?:^|[^:])\/\/[^\s/]+:[^\s/@]+@/i.test(value)) return true;
  const urls = value.replace(/\\\//g, '/').match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return urls.some(raw => {
    try { const url = new URL(raw); return !!(url.username || url.password || url.search || url.hash || /%(?:3f|23|40)/i.test(raw) || /\/(?:sign|signed)\//i.test(url.pathname) || /\.(?:png|jpe?g|webp|gif|bmp|tiff?|svg)$/i.test(url.pathname)); }
    catch { return true; }
  });
}

export function safeDeliveryText(value: string): string {
  return containsPrivateLink(value) ? '[私密链接或凭据已隐藏]' : value;
}

/** 保留几何及普通字段；剔除模型/底图与私密链接，不能静默将非有限数字变成 null。 */
function sanitizeForDelivery(value: unknown, state: { removed: number }, parents = new Set<object>()): unknown {
  if (typeof value === 'string') {
    if (containsPrivateLink(value)) { state.removed++; return '[私密链接或凭据已隐藏]'; }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('本地草案包含无效数字，请先修正后导出。');
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (parents.has(value)) throw new Error('本地草案包含循环引用，无法导出。');
    parents.add(value);
    const copy = value.map(entry => {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') throw new Error('本地草案包含无法保存的内容，请先核对。');
      return sanitizeForDelivery(entry, state, parents);
    });
    parents.delete(value);
    return copy;
  }
  if (value && typeof value === 'object') {
    if (parents.has(value)) throw new Error('本地草案包含循环引用，无法导出。');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('本地草案包含不支持的内容，请先核对。');
    parents.add(value);
    const copy: Record<string, unknown> = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'designBook' || PRIVATE_KEYS.test(key) || containsPrivateLink(key)) { state.removed++; continue; }
      if (entry === undefined) continue;
      if (key === 'evidenceUrls' && Array.isArray(entry)) {
        const safeUrls = entry.filter((url): url is string => typeof url === 'string' && !containsPrivateLink(url));
        state.removed += entry.length - safeUrls.length;
        copy[key] = safeUrls;
        continue;
      }
      if (typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') throw new Error('本地草案包含无法保存的内容，请先核对。');
      copy[key] = sanitizeForDelivery(entry, state, parents);
    }
    parents.delete(value);
    return copy;
  }
  throw new Error('本地草案包含无法保存的内容，请先核对。');
}

/** 清除导出中的私密链接，保留普通公开链接及原有结构。 */
export function redactDeliveryValue(value: unknown): { value: unknown; removed: number } {
  const state = { removed: 0 };
  const safe = sanitizeForDelivery(value, state);
  return { value: safe, removed: state.removed };
}

export function localDraftAvailable(layout: RoomLayout): boolean {
  return isRoomLayout(layout);
}

/** Check only structure facts; unrelated local zones, assets and extra floors remain exportable. */
function assertDraftStructureConsistent(layout: RoomLayout): void {
  if (!layout.backendSceneV2) return;
  const fail=()=>{throw new Error('场地结构与已确认的记录或图纸依据不一致，未生成交接草案；请保留原始完整备份并在结构面板重新核对。');};
  const first=layout.floors[0];
  if(!first) return fail();
  const source=layout.backendSceneV2;
  const sourceIds=new Set([...source.structure.walls,...source.structure.openings,...source.structure.columns].map(value=>value.id));
  if(layout.floors.slice(1).some(floor=>floor.items.some(item=>isStructuralMarker(item)) || floor.interiorWalls?.some(wall=>sourceIds.has(wall.id)))) return fail();
  const {roof:_roof,terrain:_terrain,entrance:_entrance,scenePreset:_preset,designBook:_book,...base}=layout;
  const {zones:_zones,...floor}=first;
  const structureOnly:RoomLayout={...base,roof:{style:'none'},floors:[{...floor,items:floor.items.filter(isStructuralMarker)}]};
  try { layoutToBackendScene(structureOnly); } catch { fail(); }
}

export function localDraftDeliveryJson(layout: RoomLayout, snapshot?: { id: string; generatedAt: string }): string {
  if (!localDraftAvailable(layout)) throw new Error('当前本地草案数据不完整，无法导出，请先核对。');
  assertDraftStructureConsistent(layout);
  const state = { removed: 0 };
  const sanitizedLayout = sanitizeForDelivery(layout, state);
  if(sanitizedLayout&&typeof sanitizedLayout==='object'&&!Array.isArray(sanitizedLayout)){
    const scene=(sanitizedLayout as Record<string,unknown>).backendSceneV2;
    if(scene&&typeof scene==='object'&&!Array.isArray(scene)){
      const record=scene as Record<string,unknown>;
      if(Object.hasOwn(record,'design')){delete record.design;state.removed++;}
      if(Array.isArray(record.dimensions))record.dimensions.forEach((entry,index)=>{if(entry&&typeof entry==='object'&&!Array.isArray(entry)){(entry as Record<string,unknown>).label=`尺寸记录 ${index+1}（来源待核验）`;state.removed++;}});
      if(Array.isArray(record.objects))record.objects.forEach(entry=>{if(entry&&typeof entry==='object'&&!Array.isArray(entry)&&Object.hasOwn(entry,'notes')){const object=entry as Record<string,unknown>;if(object.notes!=='[私密链接或凭据已隐藏]')object.notes='[原物件备注未核验，已省略]';state.removed++;}});
    }
    const floors=(sanitizedLayout as Record<string,unknown>).floors;
    if(Array.isArray(floors))for(const floor of floors)if(floor&&typeof floor==='object'&&!Array.isArray(floor)&&Array.isArray((floor as Record<string,unknown>).items))for(const item of (floor as {items:unknown[]}).items)if(item&&typeof item==='object'&&!Array.isArray(item)&&Object.hasOwn(item,'notes')){const object=item as Record<string,unknown>;if(object.notes!=='[私密链接或凭据已隐藏]')object.notes='[原物件备注未核验，已省略]';state.removed++;}
  }
  const sizeFacts = layout.floors.map((_, index) => sanitizeForDelivery(extractPlanSizeFacts(layout, index), state));
  for(const floor of sizeFacts)if(floor&&typeof floor==='object'&&!Array.isArray(floor))for(const fact of Object.values(floor))if(fact&&typeof fact==='object'&&!Array.isArray(fact)&&Array.isArray((fact as {records?:unknown}).records))for(const [index,entry] of ((fact as {records:unknown[]}).records).entries())if(entry&&typeof entry==='object'&&!Array.isArray(entry)){const record=(entry as Record<string,unknown>).record;if(record&&typeof record==='object'&&!Array.isArray(record)&&Object.hasOwn(record,'label')){(record as Record<string,unknown>).label=`尺寸记录 ${index+1}（来源待核验）`;state.removed++;}}
  const materials = sanitizeForDelivery(deliverableInventory(layout), state);
  const unplacedItems = sanitizeForDelivery(layout.floors.flatMap(floor => floor.items.filter(item => !item.position).map(item => ({ floorId: floor.id, floorName: floor.name, id: item.id, name: item.name, status: 'unknown' }))), state);
  const safeSnapshot = snapshot ? sanitizeForDelivery(snapshot, state) : undefined;
  return JSON.stringify({
    format: LOCAL_DRAFT_FORMAT, version: 1, units: 'm', coordinateOrigin: 'venue-center', rotationUnit: 'radian',
    ...(safeSnapshot ? { snapshot: safeSnapshot } : {}),
    state: 'draft_unverified', layout: sanitizedLayout, sizeFacts, materials, unplacedItems, provenance: layoutProvenanceBreakdown(layout),
    checks: [
      { id: 'entrances_exits', status: 'unknown', note: '出入口位置、用途及现场状态仍需核对。' },
      { id: 'door_swing', status: 'unknown', note: '门扇开启方向、铰链与净宽仍需核对。' },
      { id: 'circulation', status: 'unknown', note: '排队、通行净宽与转弯空间仍需核对。' },
      { id: 'fire_accessibility_capacity', status: 'unknown', note: '消防、无障碍及核定容量未在此草案中核验。' },
    ],
    candidateChecklist: { scope: '导出未绑定本次候选；不能用于全场安全或规范结论。', entries: unavailablePlanChecklist(),
      functionalNeeds: [{kind:'checkin',status:'unknown',message:'导出未包含活动需求，是否需要签到尚未确认。'},
        {kind:'stage',status:'unknown',message:'导出未包含活动需求，是否需要舞台尚未确认。'}] },
    confirmations: { venue: 'unknown', execution: 'unknown', authority: 'unknown' },
    scope: {
      notice: '这是本地待核验交接草案，不是云端场景或可恢复备份。导出编号仅标识此次导出，不代表版本冻结。尺寸记录的 confirmed 仅代表记录状态，不代表场地方确认。',
      excluded: ['模型文件与加载地址', '图纸及现场图片原件', '历史方案版本', '独立点验账本', '未经独立核验的原方案自由文字'],
      redactedFields: state.removed,
      note: '工作单和活动任务仅保留原记录状态，不代表本版本现场、消防或场地方已确认。隐私过滤不能保证识别全部敏感信息，请分享前核对。需要完整恢复时请另用场景与活动备份。',
    },
  }, null, 2);
}

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  const safe = /^\s*[=+\-@]|^[\t\r\n]/.test(text) && typeof value === 'string' ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function localDraftMaterialsCsv(layout: RoomLayout, snapshot?: { id: string; generatedAt: string }): string {
  if (!localDraftAvailable(layout)) throw new Error('当前本地草案数据不完整，无法导出，请先核对。');
  assertDraftStructureConsistent(layout);
  const state = { removed: 0 };
  const safe = (value: unknown): unknown => value == null ? '' : sanitizeForDelivery(value, state);
  const rows: unknown[][] = [['名称','楼层','区域','物件类型','资产版本ID','来源','宽/m','深/m','高/m','颜色','数量','物件ID','采购状态','位置待确认件数','交付编号','生成时间','现场与安全核验（本文件未绑定候选与活动需求；签到、舞台、出入口、消防及现场条件待核验；隐私过滤不能保证覆盖全部敏感信息，分享前请核对）']];
  for (const row of deliverableInventory(layout)) rows.push([
    safe(row.name),safe(row.floorName),safe(row.zoneName),safe(row.type),safe(row.assetVersionId),safe(row.source),
    row.width,row.depth,row.height,safe(row.color),row.quantity,safe(row.objectIds.join(';')),row.procurement,
    layout.floors.find(floor => floor.id === row.floorId)?.items.filter(item => !item.position && row.objectIds.includes(item.id)).length ?? 0,
    safe(snapshot?.id),safe(snapshot?.generatedAt),'待核验：规格、库存、出入口、消防和现场条件须另行确认；未包含活动需求，签到与舞台是否需要待确认；未绑定候选检查',
  ]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
