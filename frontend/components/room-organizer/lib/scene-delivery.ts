import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GENERATED_LIST_NOTICE, type LedgerChecklistLine } from '@/lib/facts/delivery-list-guard';
import { assembleThreeLedgers, sceneCountsFromInventoryRows, type AssembledLedger, type CandidateStockInput, type OralReport } from '@/lib/facts/ledger-entries';
import { ensureRecoverableGlbAsset, publicAssetLocalUrl } from '@/lib/public-asset-recovery';
import { handoffSchema, type Handoff } from '../../../../supabase/functions/_shared/delivery-contract';
import { eventOperationsSchema, type EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';
import { createFurnitureModel } from '../three/furniture-builders';
import { disposeOwnedModel, getGlbAssetState, glbAssetKey } from '../three/glb-assets';
import { buildRoom } from '../three/room-builder';
import { buildStructureShell } from '../three/structure-builder';
import { computeWallOpenings } from '../three/wall-openings';
import { layoutToBackendScene } from './backend-adapter';
import { deliverableInventory, layoutProvenanceBreakdown } from './deliverable-inventory';
import { operationReview, OPERATION_PHASE_LABELS, OPERATION_STATUS_LABELS } from './event-operations';
import { localDraftAvailable, redactDeliveryValue, safeDeliveryText } from './local-draft-delivery';
import { REFERENCE_SOURCE_UNVERIFIED } from './reference-source-status';
import { blankHandoff, effectiveHandoffStatus, HANDOFF_STATUS_LABELS } from './scene-handoff';
import type { RoomLayout } from './types';
import type { MaterialCheckinLedger } from '../../../../supabase/functions/_shared/material-checkin-contract';
import type { BackendSession } from '@/lib/backend-session';

export function deliveryScene(layout: RoomLayout) {
  if (layout.scenePreset || layout.floors.some(floor => floor.items.some(item => item.glbNode))) {
    throw new Error('完整场景预设暂不支持交付导出，固定场馆结构和物件会保留在云方案中。');
  }
  if(layout.entrance)throw new Error('当前交付不支持本地建筑入口扩展，请保留原始方案。');
  return layoutToBackendScene(layout);
}
const materialItems = (layout: RoomLayout) => layout.floors.flatMap(floor => floor.items.filter(item => !item.venueEntranceId && !item.structuralOpeningId && !item.structuralColumnId));
export interface DeliveryMaterial {
  name: string; materialId: string; assetVersionId: string | null; source: string;
  width: number; depth: number; height: number; color: string; quantity: number; objectIds: string[];
  procurement: '概念物料，采购待确认' | '规格与采购待确认';
  sourceUrl: string | null; license: string | null; sha256: string | null;
}

/** A version reference is the archived immutable asset ID, never an expiring URL. */
export function deliveryMaterials(layout: RoomLayout): DeliveryMaterial[] {
  // Keep the existing delivery gate (single floor, no preset/entrance extension).
  deliveryScene(layout);
  // Counting lives in one place; this outlet only re-shapes rows for CSV/JSON.
  return deliverableInventory(layout).map(row => ({
    name: row.name, materialId: row.materialId, assetVersionId: row.assetVersionId,
    source: row.source, width: row.width, depth: row.depth, height: row.height, color: row.color,
    quantity: row.quantity, objectIds: row.objectIds, procurement: row.procurement,
    sourceUrl: row.sourceUrl ?? null, license: row.license ?? null, sha256: row.sha256 ?? null,
  }));
}

export interface DeliverySnapshot { id: string; generatedAt: string }
export interface DeliveryExecution extends Omit<Handoff, 'reviewedBasis'> {
  objectId: string; name: string; materialId: string; assetVersionId: string | null;
  floorId: string; floorName: string; size: { width: number; depth: number; height: number };
  position: { x: number; z: number }; rotation: number; elevation: number;
  hasHandoff: boolean; effectiveStatus: Handoff['status'] | 'needs_review';
}

export async function deliveryExecution(layout: RoomLayout): Promise<DeliveryExecution[]> {
  const scene = deliveryScene(layout);
  return Promise.all(scene.objects.map(async object => {
    const floor = layout.floors.find(entry => entry.items.some(item => item.id === object.id))!;
    const item = floor.items.find(entry => entry.id === object.id)!;
    const { reviewedBasis: _localBasis, ...handoff } = handoffSchema.parse(item.handoff ?? blankHandoff());
    return { ...handoff, objectId: object.id, name: item.name, materialId: object.materialId,
      assetVersionId: object.assetId ?? null, floorId: floor.id, floorName: floor.name,
      size: object.size, position: object.position, rotation: object.rotation, elevation: object.elevation ?? 0,
      hasHandoff: !!item.handoff, effectiveStatus: await effectiveHandoffStatus(layout, item.id) };
  }));
}

export interface DeliveryOperation extends Omit<EventOperationTask, 'reviewedBasis'> {
  effectiveStatus: EventOperationTask['status'] | 'needs_review'; missingObjectIds: string[];
  ambiguousObjectIds?: string[]; missingProductionObjectIds?: string[]; ambiguousProductionObjectIds?: string[];
}
export async function deliveryOperations(layout: RoomLayout, checkins?: MaterialCheckinLedger): Promise<{
  schemaVersion: 1; dataKind: 'unspecified' | 'rehearsal' | 'real'; tasks: DeliveryOperation[];
} | null> {
  if (!layout.eventOperations) return null;
  const operations = eventOperationsSchema.parse(layout.eventOperations);
  return { schemaVersion: 1, dataKind: operations.dataKind, tasks: await Promise.all(operations.tasks.map(async task => {
    const { reviewedBasis: _localBasis, ...fields } = task;
    const review = await operationReview(layout, task, checkins);
    return { ...fields, effectiveStatus: review.status, missingObjectIds: review.missingObjectIds,
      ...(review.ambiguousObjectIds?.length ? { ambiguousObjectIds: review.ambiguousObjectIds } : {}),
      ...(review.missingProductionObjectIds?.length ? { missingProductionObjectIds: review.missingProductionObjectIds } : {}),
      ...(review.ambiguousProductionObjectIds?.length ? { ambiguousProductionObjectIds: review.ambiguousProductionObjectIds } : {}),
    };
  })) };
}

/** 场景记录与现场确认是两件事；导出时不推断未记录的审批或安全结论。 */
export function deliveryVerificationScope(scene: ReturnType<typeof deliveryScene>) {
  const sourceById = new Map(scene.schemaVersion === 2 ? scene.sources.map(source => [source.assetId, source] as const) : []);
  const dimensions = scene.schemaVersion === 2 ? scene.dimensions.map((dimension,index) => {
    const source = dimension.sourceAssetId ? sourceById.get(dimension.sourceAssetId) : undefined;
    return {
      id: dimension.id, kind: dimension.kind, label: `尺寸记录 ${index+1}（来源待核验）`, valueMeters: dimension.valueMeters,
      recordedStatus: dimension.status,
      source: source ? { assetId: source.assetId, kind: source.kind, name: source.name } : null,
      sourceNote: source ? '来源与本条尺寸已关联；记录状态不代表场地方确认。' : '此尺寸记录没有关联可用来源，来源待确认。',
    };
  }) : [];
  const doors = scene.schemaVersion === 2
    ? scene.structure.openings.filter(opening => opening.kind === 'door').map(opening => ({
        id: opening.id, widthMeters: opening.width, recordedStatus: opening.status,
        source: '场景门洞记录', openingDirection: 'unknown' as const,
      }))
    : scene.venue.entrances.map(entrance => ({
        id: entrance.id, widthMeters: entrance.width, recordedStatus: 'unknown' as const,
        source: '场景入口记录，来源及确认状态未记录', openingDirection: 'unknown' as const,
      }));
  return {
    state: 'draft_unverified' as const,
    sceneSize: { widthMeters: scene.venue.width, depthMeters: scene.venue.depth, heightMeters: scene.venue.height,
      source: '当前编辑场景', note: '这是图中尺寸，不自动代表现场实测；具体依据见尺寸记录。' },
    dimensions,
    doors,
    checks: [
      { id: 'reference_source', status: 'unknown' as const, note: REFERENCE_SOURCE_UNVERIFIED },
      { id: 'entrances_exits', status: 'unknown' as const, note: doors.length ? '有门或入口记录，但出口用途、数量及现场状态未在此交付包核实。' : '未记录可核对的门或入口；出口信息待确认。' },
      { id: 'door_swing', status: 'unknown' as const, note: '门扇开启方向、铰链及净宽未在此交付包核实。' },
      { id: 'circulation', status: 'unknown' as const, note: '人流、排队、通行净宽与转弯空间未在此交付包核实。' },
      { id: 'fire_accessibility_capacity', status: 'unknown' as const, note: '消防、无障碍及核定容量未在此交付包核验。' },
    ],
    confirmations: {
      venue: 'unknown' as const, execution: 'unknown' as const, authority: 'unknown' as const,
      note: '此交付包未记录与本版本绑定的场地方、执行方或主管部门确认；物件工作单状态不代替这些确认。',
    },
  };
}

const SCOPE_NOTICE = `${REFERENCE_SOURCE_UNVERIFIED}本清单未核验出入口、门扇、人流、消防、无障碍或核定容量；现场与相关方仍需确认。隐私过滤不能保证识别全部敏感信息，请分享前核对。`;

export interface DeliveryInventoryAccounts {
  reports?: readonly OralReport[];
  candidate?: CandidateStockInput | null;
}

/** 用当前场景清点、口述和候选库存组装三本账。候选填写不会变成核实库存。 */
export function deliveryInventoryLedger(layout: RoomLayout, accounts?: DeliveryInventoryAccounts | null): AssembledLedger {
  const scene = sceneCountsFromInventoryRows(deliverableInventory(layout).map(row => ({
    name: row.name, type: row.type, materialId: row.materialId, assetVersionId: row.assetVersionId,
    width: row.width, depth: row.depth, height: row.height, quantity: row.quantity, objectIds: row.objectIds,
  })));
  return assembleThreeLedgers({ reports: accounts?.reports, scene, candidate: accounts?.candidate ?? null });
}

function deliveryLedgerRecord(ledger: AssembledLedger) {
  const line = (item: AssembledLedger['oral'][number]) => ({
    identity: item.identity, name: item.name, quantity: item.quantity, evidence: item.evidence, source: item.source,
    dimensions: item.dimensions,
  });
  return {
    listMeans: 'generated_not_procured_or_placed' as const,
    notice: GENERATED_LIST_NOTICE,
    stockStatus: ledger.stockStatus,
    oral: ledger.oral.map(line),
    sceneModels: ledger.sceneModels.map(line),
    verifiedStock: ledger.verifiedStock.map(line),
    shortages: ledger.shortages,
    unmatchedSceneIdentities: ledger.unmatchedSceneIdentities,
    unreadOral: ledger.unreadOral,
    withheldCandidateNote: ledger.withheldCandidateNote,
  };
}

export async function sceneDeliveryJson(layout: RoomLayout, snapshot?: DeliverySnapshot, checkins?: MaterialCheckinLedger, accounts?: DeliveryInventoryAccounts | null): Promise<string> {
  const scene = deliveryScene(layout);
  const deliverySceneRecord=scene.schemaVersion===2?(({design:_unverifiedDesign,...rest})=>({...rest,objects:rest.objects.map(object=>({...object,notes:''})),dimensions:rest.dimensions.map((dimension,index)=>({...dimension,label:`尺寸记录 ${index+1}（来源待核验）`}))}))(scene):{...scene,objects:scene.objects.map(object=>({...object,notes:''}))};
  const output = { format: 'scendance-scene-delivery', version: 2, units: 'm', upAxis: 'Y',
    coordinateOrigin: 'venue-north-west', name: layout.name, ...(snapshot ? { snapshot } : {}), scene:deliverySceneRecord,
    execution: await deliveryExecution(layout), materials: deliveryMaterials(layout), verificationScope: deliveryVerificationScope(scene),
    operations: await deliveryOperations(layout, checkins), operationsTimeZone: 'Asia/Shanghai',
    source: { kind: 'editor-snapshot', layoutId: layout.id ?? null },
    // 系统生成与结构标记分开；缺失来源不作推断。
    provenance: layoutProvenanceBreakdown(layout),
    inventoryLedger: deliveryLedgerRecord(deliveryInventoryLedger(layout, accounts)),
    note: '原方案自由文字未独立核验，本交付包不包含该部分；原方案记录仍保留。assetVersionId 为归档资产标识；重新打开私有资产仍需项目授权。GLB 不包含编辑器环境光和后处理。生成清单不等于已采购或已布置。' };
  const sanitized=redactDeliveryValue(output);
  return JSON.stringify({ ...(sanitized.value as Record<string,unknown>), privacy: { redactedFields: sanitized.removed, note: '已识别的部分凭据与私密链接已过滤；不能保证识别全部敏感信息，请分享前核对。需要的证据请另行安全提供。' } }, null, 2);
}

function csvField(value: unknown): string {
  const text = typeof value === 'string' ? safeDeliveryText(value) : String(value ?? '');
  const safe = typeof value === 'string' && /^\s*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function sceneDeliveryCsv(layout: RoomLayout, snapshot?: DeliverySnapshot): string {
  const rows: unknown[][] = [['名称','物料类型','资产版本ID','来源','宽/m','深/m','高/m','颜色','数量','物件ID','采购状态','来源页面','许可','SHA256','交付编号','生成时间',SCOPE_NOTICE]];
  for (const item of deliveryMaterials(layout)) rows.push([item.name,item.materialId,item.assetVersionId,item.source,item.width,item.depth,item.height,item.color,item.quantity,item.objectIds.join(';'),item.procurement,item.sourceUrl,item.license,item.sha256,snapshot?.id,snapshot?.generatedAt,'待核验']);
  return '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

export async function sceneExecutionCsv(layout: RoomLayout, snapshot?: DeliverySnapshot): Promise<string> {
  const rows: unknown[][] = [['物件ID','名称','物料类型','资产版本ID','楼层','宽/m','深/m','高/m','X/m','Z/m','旋转/度','离地/m','数量','负责人','期限','验收条件','记录状态','有效状态','证据链接','验收说明','交付编号','生成时间',SCOPE_NOTICE]];
  for (const item of await deliveryExecution(layout)) rows.push([item.objectId,item.name,item.materialId,item.assetVersionId,
    item.floorName,item.size.width,item.size.depth,item.size.height,item.position.x,item.position.z,item.rotation,item.elevation,
    1,item.ownerName,item.dueDate,item.acceptance,HANDOFF_STATUS_LABELS[item.status],
    item.hasHandoff ? HANDOFF_STATUS_LABELS[item.effectiveStatus] : '未分配',item.evidenceUrls.join('\n'),item.evidenceNote,
    snapshot?.id,snapshot?.generatedAt,'待核验']);
  return '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

/**
 * 交付清单：一页列清「本次能带走什么、文件名、件数、缺什么」。
 * 和物料/执行清单共用 deliveryMaterials / deliveryExecution，不另算一套口径。
 * 某类不支持时仍出一行并写明原因，不把失败藏起来。
 */
export async function deliveryManifestCsv(layout: RoomLayout, snapshot?: DeliverySnapshot, ledgerLines?: readonly LedgerChecklistLine[]): Promise<string> {
  let gate = '';
  let materials: DeliveryMaterial[] = [];
  let execution: DeliveryExecution[] = [];
  try {
    deliveryScene(layout);
    materials = deliveryMaterials(layout);
    execution = await deliveryExecution(layout);
  } catch (error) {
    gate = error instanceof Error ? error.message : '当前场景暂不支持交付导出。';
  }
  const floorName = layout.floors[0]?.name ?? '1F';
  const id = snapshot?.id ?? '';
  const when = snapshot?.generatedAt ?? '';
  const tasks = layout.eventOperations?.tasks.length ?? 0;
  // This manifest has only a layout, not the live workspace, storage or export capabilities.
  // A compatible layout alone cannot establish that the corresponding export is ready.
  const status = gate ? '不支持' : '待导出时检查';
  const blank = (value: string, fallback: string) => (value || fallback).replace(/\s+/g, '_');
  const rows: unknown[][] = [['类别','建议文件名','状态','件数','说明','交付编号','生成时间']];
  rows.push(['交付清单 CSV', `${layout.name}_交付清单_${id}.csv`, '可导出', rows.length, '本清单：逐行说明可带走的文件、件数与缺失原因。', id, when]);
  rows.push(['平面图 DXF', `${blank(layout.name, 'Scendance')}_平面_${blank(floorName, '1F')}.dxf`, '待导出时检查', 1, '导出前核对场地结构及物件位置；墙线未按门洞切断，门洞标记、比例及现场尺寸仍需核对。', id, when]);
  rows.push(['平面图打印', `${blank(layout.name, 'Scendance')}_平面_${blank(floorName, '1F')}.pdf`, '待导出时检查', 1, '导出前核对场地结构；在浏览器打印窗口选择「另存为 PDF」，输出比例及现场尺寸仍需核对。', id, when]);
  rows.push(['物料清单 CSV', `${layout.name}_物料清单_${id}.csv`, status, materials.length, gate || '每类名称、尺寸、颜色、数量、资产版本、来源许可与采购状态。', id, when]);
  rows.push(['执行清单 CSV', `${layout.name}_执行清单_${id}.csv`, status, execution.length, gate || '每件工作单负责人、期限、验收条件、证据链接与有效状态。', id, when]);
  rows.push(['场景 JSON', `${layout.name}_场景_${id}.json`, status, 1, gate || '场景、执行记录、物料与活动安排同一份快照，便于复核。', id, when]);
  const localStatus = localDraftAvailable(layout) ? '仅本地活动可导出' : '需先补资料';
  rows.push(['本地待核验草案 JSON', `本地待核验草案_${id}.json`, localStatus, 1, '本地布局及尺寸记录；非云端场景、非恢复备份，不含模型文件与私密链接。', id, when]);
  rows.push(['本地物料草案 CSV', `本地物料草案_${id}.csv`, localStatus, localDraftAvailable(layout) ? deliverableInventory(layout).length : 0, '保留本地楼层、区域与物料数量；规格、库存和现场条件待核验。', id, when]);
  rows.push(['场景 GLB', `${layout.name}_${id}.glb`, gate ? '不支持' : '待导出时检查', execution.length, gate || '资产就绪并重新加载复检通过后导出；不含环境光与后处理，私有模型重开仍需授权。', id, when]);
  rows.push(['活动安排 CSV', `${layout.name}_活动安排_${id}.csv`, layout.eventOperations ? '待导出时检查' : '需先补资料', tasks, layout.eventOperations ? '导出前核对点验资料；任务阶段、负责人、计划与实际时间、关联物件按记录列出。' : '先保存活动安排。', id, when]);
  rows.push(['活动执行资料草案 HTML', `${layout.name}_内部活动交接_${id}.html`, '待导出时检查', 1, '导出前核对工作台、本机记录与点验状态；手工需求未完整包含助手对话需求，请先核对差异。', id, when]);
  rows.push(['执行时间表 HTML', `${layout.name}_执行时间表_${id}.html`, tasks ? '待导出时检查' : '需先补资料', 1, tasks ? '导出前核对工作台、本机记录与点验状态；计划与实际分别保留。' : '先在活动安排中保存任务。', id, when]);
  rows.push(['制作交接 HTML', `${layout.name}_内部制作交接_${id}.html`, '待导出时检查', 1, '导出前核对制作计划及点验；未确定的人员、供应方与费用会明确标出。', id, when]);
  rows.push(['现场与安全核验', '', '待核验', '', SCOPE_NOTICE, id, when]);
  rows.push(['清单含义', '', '已生成', '', GENERATED_LIST_NOTICE, id, when]);
  for (const line of ledgerLines ?? []) {
    const column = line?.column === '口述' || line?.column === '场景模型' || line?.column === '核实库存' ? line.column : '待核验';
    const quantity = Number.isSafeInteger(line?.quantity) && line.quantity >= 0 ? line.quantity : '';
    const identity = typeof line?.identity === 'string' && line.identity.trim() ? line.identity.trim() : '身份待核验';
    const note = typeof line?.note === 'string' && line.note.trim() ? line.note.trim() : '说明待补';
    rows.push([`库存账：${column}`, identity, '待核验', quantity, `${note} ${GENERATED_LIST_NOTICE}`, id, when]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

/** Text schedules remain deliverable even when venue/model exports are unsupported. */
export async function eventOperationsCsv(layout: RoomLayout, snapshot?: DeliverySnapshot, checkins?: MaterialCheckinLedger): Promise<string> {
  const kinds = { unspecified: '未标注', rehearsal: '演练', real: '真实' };
  const operations = await deliveryOperations(layout, checkins);
  const rows: unknown[][] = [['任务编号','任务标题','阶段','负责人','承接团队','计划开始','计划结束','实际开始','实际结束','完成条件','记录状态','有效状态','关联物件编号','缺失物件编号','现场核对说明','证据链接','资料类型','界面输入时区','交付编号','生成时间','场景名称','本地项目编号','歧义物件编号','制作计划缺失物件编号','制作计划歧义物件编号']];
  for (const task of operations?.tasks ?? []) rows.push([task.id,task.title,OPERATION_PHASE_LABELS[task.phase],task.ownerName,
    task.contractorName,task.plannedStartAt,task.plannedEndAt,task.actualStartedAt,task.actualFinishedAt,task.acceptance,
    OPERATION_STATUS_LABELS[task.status],OPERATION_STATUS_LABELS[task.effectiveStatus],task.objectIds.join(';'),task.missingObjectIds.join(';'),
    task.evidenceNote,task.evidenceUrls.join('\n'),kinds[operations!.dataKind],'Asia/Shanghai',snapshot?.id,snapshot?.generatedAt,layout.name,layout.id,
    task.ambiguousObjectIds?.join(';'),task.missingProductionObjectIds?.join(';'),task.ambiguousProductionObjectIds?.join(';')]);
  return '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

/** Reject unsupported local presets/structures through the existing scene adapter. */
export async function prepareDeliveryAssets(layout: RoomLayout, controller?: BackendSession): Promise<void> {
  const scene = deliveryScene(layout);
  const objects = new Map(scene.objects.map(object => [object.id, object]));
  for (const item of materialItems(layout)) {
    const object = objects.get(item.id)!;
    if (!object.assetId) continue;
    const key = glbAssetKey(item) ?? object.assetId;
    if (getGlbAssetState(key).status === 'ready') continue;
    const url = controller?.getSnapshot().user ? (await controller.authorizeAsset(object.assetId)).url : item.glbUrl;
    if (!url && !publicAssetLocalUrl(object.assetId)) throw new Error(`“${item.name}”模型尚未加载，请连接项目后重试。`);
    await ensureRecoverableGlbAsset(key, object.assetId, url, controller?.config?.url);
  }
}

/** 仅匹配当前壳体构建器创建的编辑网格；真正的物料在这个步骤之后才加入场景。 */
function isEditorGrid(child: THREE.Object3D, width: number, depth: number): boolean {
  const mesh=child as THREE.Mesh;
  if(!mesh.isMesh || !(mesh.geometry instanceof THREE.PlaneGeometry) || Array.isArray(mesh.material)
    || !(mesh.material instanceof THREE.MeshBasicMaterial)) return false;
  const parameters=mesh.geometry.parameters,material=mesh.material;
  return parameters.width===width && parameters.height===depth && mesh.userData.type==='wall'
    && mesh.renderOrder===2 && Math.abs(mesh.position.y-.01)<1e-9 && Math.abs(mesh.rotation.x+Math.PI/2)<1e-9
    && Object.prototype.hasOwnProperty.call(mesh,'raycast') && material.transparent && !material.depthWrite
    && !material.toneMapped && material.side===THREE.DoubleSide && material.map instanceof THREE.CanvasTexture;
}

/** Fresh assembly prevents cutaway visibility, selection, ghosting and collision tints leaking into delivery. */
export function assembleDeliveryScene(layout: RoomLayout): THREE.Scene {
  const canonical = deliveryScene(layout);
  const scene = new THREE.Scene();
  scene.name = layout.name || 'Scendance';
  scene.userData = { format: 'scendance-scene-delivery', units: 'm', upAxis: 'Y', coordinateOrigin: 'venue-center' };
  try {
    const floor = layout.floors[0];
    if (canonical.schemaVersion === 2) buildStructureShell(THREE, scene, layout);
    else buildRoom(THREE, { scene, width: layout.width, depth: layout.height, wallHeight: canonical.venue.height,
      floorColor: floor.floorColor, floorPattern: floor.floorPattern ?? 'solid', wallPattern: floor.wallPattern ?? 'solid',
      wallOpenings: computeWallOpenings(floor.items,layout.width,layout.height,canonical.venue.height),
      wallColors: floor.wallColors ?? {}, hiddenWalls: floor.hiddenWalls ?? [], floorPlanImage: null,
      floorPlanOpacity: 0, floorPlanFitMode: 'contain', floorPlan3DEffect: false });
    // 两种壳体各有且仅有一个编辑网格；无法唯一识别时停止导出，避免误删物料或泄漏网格。
    const grids=scene.children.filter(child=>isEditorGrid(child,layout.width,layout.height));
    if(grids.length!==1)throw new Error('无法准确区分场地与编辑网格，未导出场景。');
    const grid=grids[0]!;scene.remove(grid);disposeOwnedModel(grid);
    // Room builders also include editing grid lines. They are not physical deliverables.
    for (const child of [...scene.children]) if ((child as THREE.Line).isLine) { const line=child as THREE.Line;scene.remove(line);line.geometry.dispose();for(const material of Array.isArray(line.material)?line.material:[line.material])material.dispose(); }
    scene.children.forEach((child,index)=>{child.userData.deliveryObjectId=`shell:${index}`;child.userData.deliveryKind='shell';});
    const expected = new Map(canonical.objects.map(object => [object.id, object]));
    for (const item of floor.items) {
      if (item.venueEntranceId) continue;
      const object = expected.get(item.id);
      const model = createFurnitureModel(THREE, item, false);
      if ((item.assetId || item.glbUrl || item.type === 'glb-asset') && model.userData.glbStatus !== 'ready') {
        disposeOwnedModel(model); throw new Error(`“${item.name}”模型尚未就绪，未导出占位物件。`);
      }
      if (!item.position) { disposeOwnedModel(model); throw new Error(`“${item.name}”缺少位置，无法导出。`); }
      model.name = item.name;
      model.position.set(item.position.x, 0, item.position.z);
      model.rotation.y = item.rotation ?? 0;
      if (item.mirrored) model.scale.x *= -1;
      model.userData = { ...model.userData, deliveryObjectId: item.id,
        deliveryKind: object ? 'material' : 'structure', assetVersionId: object?.assetId ?? null };
      scene.add(model);
    }
    scene.updateMatrixWorld(true);
    return scene;
  } catch (error) { disposeOwnedModel(scene); throw error; }
}

type TriangleCheck = { values: number[]; material: string };
type GeometryCheck = { matrix: number[]; triangles: TriangleCheck[]; materials: string[]; bounds: number[] };
/** Pixel IDs are shared across the before/after checks. Hash buckets are only an
 * accelerator: byte equality is checked too, so a checksum collision cannot pass. */
function textureChecks() {
  const images = new Map<unknown, Map<boolean,string>>();
  const pixels = new Map<string,{id:string;data:Uint8Array | Uint8ClampedArray}[]>();
  let nextId = 0;
  return (texture:THREE.Texture):string => {
    const image = texture.image as {width:number;height:number;data?:ArrayLike<number>};
    const cached = images.get(image)?.get(texture.flipY);
    if (cached) return cached;
    const width=image?.width,height=image?.height;
    if (!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>4096*4096) throw new Error('纹理像素无法完整读取，未导出。');
    let data:Uint8Array | Uint8ClampedArray;
    if (image.data) {
      if (texture.format!==THREE.RGBAFormat||texture.type!==THREE.UnsignedByteType||image.data.length!==width*height*4) throw new Error('当前交付不支持此纹理像素格式，未导出。');
      data=Uint8Array.from(image.data);
      if(texture.flipY) {
        const original=data.slice(),row=width*4;
        for(let y=0;y<height;y++)data.set(original.subarray((height-1-y)*row,(height-y)*row),y*row);
      }
    } else {
      if(typeof document==='undefined')throw new Error('纹理像素无法完整读取，未导出。');
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      try {
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('canvas');
        if(texture.flipY){context.translate(0,height);context.scale(1,-1);}
        context.drawImage(image as CanvasImageSource,0,0,width,height);
        data=context.getImageData(0,0,width,height).data;
      } catch {throw new Error('纹理像素无法完整读取，未导出。');}
      finally {canvas.width=0;canvas.height=0;}
    }
    let hash=2166136261;
    for(let i=0;i<data.length;i++)hash=Math.imul(hash^data[i],16777619);
    const key=`${width}:${height}:${hash}`,bucket=pixels.get(key)??[];
    let match=bucket.find(entry=>entry.data.length===data.length&&entry.data.every((value,i)=>value===data[i]));
    if(!match){match={id:String(nextId++),data};bucket.push(match);pixels.set(key,bucket);}
    const byOrientation=images.get(image)??new Map<boolean,string>();byOrientation.set(texture.flipY,match.id);images.set(image,byOrientation);
    return match.id;
  };
}
function materialSignature(material: THREE.Material, pixelId:ReturnType<typeof textureChecks>): string {
  const standard = material as THREE.MeshStandardMaterial;
  const textureSignature = (texture: THREE.Texture | null | undefined) => texture ? {
    pixels:pixelId(texture),colorSpace:texture.colorSpace,
    sampler:[texture.channel,texture.wrapS,texture.wrapT,...texture.offset.toArray(),...texture.repeat.toArray(),texture.rotation].map(value=>Math.round(value*1e5)),
  } : null;
  return JSON.stringify({ color: standard.color?.toArray().map(value => Math.round(value * 1e5)),
    roughness: Math.round((standard.roughness ?? 1) * 1e5), metalness: Math.round((standard.metalness ?? 0) * 1e5),
    opacity: Math.round(material.opacity * 1e5), alphaTest:Math.round(material.alphaTest*1e5), side: material.side,
    emissive:standard.emissive?.toArray().map(value=>Math.round(value*1e5)),emissiveIntensity:Math.round((standard.emissiveIntensity??1)*1e5),
    normalScale:standard.normalMap?standard.normalScale.toArray().map(value=>Math.round(value*1e5)):null,
    aoMapIntensity:standard.aoMap?Math.round(standard.aoMapIntensity*1e5):null,
    textures:Object.fromEntries(Object.entries(material).filter(([,value])=>value instanceof THREE.Texture).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>[name,textureSignature(value as THREE.Texture)])) });
}
function compareValues(a:number[],b:number[]):number {
  for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-7)return a[i]-b[i];
  return 0;
}
function geometryChecks(scene: THREE.Object3D,pixelId:ReturnType<typeof textureChecks>): Map<string, GeometryCheck> {
  scene.updateMatrixWorld(true);
  const result = new Map<string, GeometryCheck>();
  const materialSignatures=new Map<THREE.Material,string>();
  const signature=(material:THREE.Material)=>{
    let value=materialSignatures.get(material);
    if(value===undefined){value=materialSignature(material,pixelId);materialSignatures.set(material,value);}
    return value;
  };
  scene.traverse(object => {
    const id = object.userData.deliveryObjectId as string | undefined;
    if (!id) return;
    if (result.has(id)) throw new Error('导出包含重复物件标识。');
    const triangles: TriangleCheck[] = [], materials: string[] = [];
    object.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.length) throw new Error('当前场景交付只支持静态模型，请先移除骨骼或变形动画物件。');
      const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv'), uv1=mesh.geometry.getAttribute('uv1');
      if (!position) throw new Error('模型缺少顶点，未导出。');
      const signatures=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(signature);
      const index = mesh.geometry.getIndex(),count=index?.count??position.count;
      if(count%3)throw new Error('模型包含非三角面，未导出。');
      for (let i = 0; i < count; i+=3) {
        const vertices=[0,1,2].map(offset=>{
          const vertex=index?index.getX(i+offset):i+offset;
          const point=new THREE.Vector3().fromBufferAttribute(position,vertex).applyMatrix4(mesh.matrixWorld);
          return [point.x,point.y,point.z,uv?.getX(vertex)??-1,uv?.getY(vertex)??-1,uv1?.getX(vertex)??-1,uv1?.getY(vertex)??-1];
        });
        // Cyclic rotations preserve winding; reversing a triangle never does.
        let start=0;
        for(let candidate=1;candidate<3;candidate++){
          const first=compareValues(vertices[candidate],vertices[start]);
          if(first<0||first===0&&compareValues(vertices[(candidate+1)%3],vertices[(start+1)%3])<0)start=candidate;
        }
        const material=signatures[Array.isArray(mesh.material)?mesh.geometry.groups.find(group=>i>=group.start&&i<group.start+group.count)?.materialIndex??0:0];
        triangles.push({values:[...vertices[start],...vertices[(start+1)%3],...vertices[(start+2)%3]],material});
      }
      materials.push(...signatures);
    });
    triangles.sort((a,b)=>a.material.localeCompare(b.material)||compareValues(a.values,b.values));
    const bounds = new THREE.Box3().setFromObject(object);
    result.set(id,{matrix:object.matrixWorld.toArray(),triangles,materials:materials.sort(),bounds:[...bounds.min.toArray(),...bounds.max.toArray()]});
  });
  return result;
}
function verifyChecks(before:Map<string,GeometryCheck>,after:Map<string,GeometryCheck>):number {
  const equal = (a:number[],b:number[]) => a.length === b.length && a.every((value,i) => Number.isFinite(value) && Number.isFinite(b[i]) && Math.abs(value-b[i]) <= 1e-5);
  if (before.size !== after.size) throw new Error('GLB 复检失败：物件数量不一致。');
  for (const [id,a] of before) {
    const b = after.get(id);
    if (!b || !equal(a.matrix,b.matrix) || !equal(a.bounds,b.bounds) || JSON.stringify(a.materials)!==JSON.stringify(b.materials) || a.triangles.length!==b.triangles.length || a.triangles.some((triangle,i)=>triangle.material!==b.triangles[i].material||!equal(triangle.values,b.triangles[i].values))) {
      throw new Error('GLB 复检失败：物件标识、几何、UV、材质或摆放发生变化。');
    }
  }
  return [...before.keys()].filter(id=>!id.startsWith('shell:')).length;
}
/** Compare actual reloaded triangles/UV, texture pixels, materials and placement. */
export function verifyDeliveryReload(source: THREE.Object3D, reloaded: THREE.Object3D): number {
  const pixelId=textureChecks();
  return verifyChecks(geometryChecks(source,pixelId),geometryChecks(reloaded,pixelId));
}

export async function exportDeliveryGlb(layout: RoomLayout, controller?: BackendSession): Promise<{ buffer: ArrayBuffer; objectCount: number }> {
  await prepareDeliveryAssets(layout, controller);
  const scene = assembleDeliveryScene(layout);
  let loaded: THREE.Object3D | undefined;
  try {
    // Run checks before export too, so unsupported skeletons cannot be silently flattened.
    const pixelId=textureChecks(),before=geometryChecks(scene,pixelId);
    // Exporter otherwise re-encodes the loader's original JPEG/WebP MIME type.
    // These textures belong to the fresh delivery scene; the asset cache is unchanged.
    scene.traverse(node=>{
      const mesh=node as THREE.Mesh;if(!mesh.isMesh)return;
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])for(const value of Object.values(material)) {
        if(value instanceof THREE.Texture)value.userData={...value.userData,mimeType:'image/png'};
      }
    });
    const output = await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:false});
    if (!(output instanceof ArrayBuffer)) throw new Error('导出器未返回 GLB 文件。');
    loaded = (await new GLTFLoader().parseAsync(output,'')).scene;
    return {buffer:output,objectCount:verifyChecks(before,geometryChecks(loaded,pixelId))};
  } finally { disposeOwnedModel(scene); if(loaded)disposeOwnedModel(loaded); }
}

export function downloadSceneDelivery(data: BlobPart, type: string, name: string, extension: 'glb'|'json'|'csv'|'html'): void {
  const url = URL.createObjectURL(new Blob([data],{type}));
  const anchor = document.createElement('a');
  anchor.href=url;anchor.download=`${(name||'Scendance').replace(/[\\/:*?"<>|\s]+/g,'_')}.${extension}`;
  try { anchor.click(); } finally { setTimeout(()=>URL.revokeObjectURL(url),0); }
}
