/**
 * 把口述原话、场景计数和候选库存送进三本账。
 * 候选库存的用户填写和假设都不会升成核实库存。
 */
import { GENERATED_LIST_NOTICE, type LedgerChecklistLine } from './delivery-list-guard';
import {
  accountChairs,
  buildDeliveryAudit,
  compareSeatCounts,
  freezeDeliveryAudit,
  reviewConclusions,
  reviewProtectedObjects,
  type ChairLedger,
  type DeliveryAudit,
  type Dimensions,
  type FactSnapshot,
  type FrozenAudit,
  type InventoryLine,
  type ProtectionReview,
  type ReviewedConclusion,
  type SeatCountComparison,
} from './scenario-ledger';

export interface OralReport {
  evidence: string;
  status: 'reported' | 'needs_review';
}

export interface SceneCountInput {
  identity: string;
  name: string;
  widthM: number;
  depthM: number;
  heightM: number;
  quantity: number;
  evidence: string;
}

export interface CandidateStockEntry {
  identity: { kind: string; value: string };
  name: string;
  available: number;
  dimensions: { width: number; depth: number; height: number };
}

export interface CandidateStockInput {
  origin: 'assumption' | 'user_reported';
  entries: readonly CandidateStockEntry[];
}

const ORAL_BLOCK = /采购|租赁|租用|需要|计划|预计|大约|大概|左右|不确定|可能|也许|或许|没有|并非|不是|未有|尚未|待定|至少|至多|是否|[?？]/;

export function oralLinesFromReports(mentions: readonly OralReport[]): { lines: InventoryLine[]; unread: string[] } {
  const lines: InventoryLine[] = [];
  const unread: string[] = [];
  for (const mention of mentions) {
    const evidence = typeof mention?.evidence === 'string' ? mention.evidence.trim() : '';
    const counts = [...evidence.matchAll(/(\d{1,5})把([^\d，,。；;\s]{1,20})/g)];
    const quantity = counts.length === 1 ? Number(counts[0]![1]) : NaN;
    const name = counts[0]?.[2] ?? '';
    if ((mention?.status !== 'reported' && mention?.status !== 'needs_review') || !evidence || ORAL_BLOCK.test(evidence) || counts.length !== 1
      || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000 || !name) {
      unread.push(evidence);
      continue;
    }
    lines.push({
      identity: `oral:${name}`,
      name,
      dimensions: null,
      quantity,
      evidence: mention.status === 'needs_review' ? `${evidence}（需复核）` : evidence,
      source: 'user_statement',
    });
  }
  return { lines, unread };
}

function positive(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export interface InventoryCountRow {
  name: string;
  type: string;
  materialId: string;
  assetVersionId: string | null;
  width: number;
  depth: number;
  height: number;
  quantity: number;
  objectIds: readonly string[];
}

/** 场景清点按资产、物料或类型身份汇总。名称相同不能并成一行。 */
export function sceneCountsFromInventoryRows(rows: readonly InventoryCountRow[]): SceneCountInput[] {
  const groups = new Map<string, SceneCountInput>();
  for (const row of rows) {
    const asset = row.assetVersionId?.trim();
    const material = row.materialId?.trim();
    const type = row.type?.trim();
    const identity = asset ? `asset:${asset}` : material ? `material:${material}` : type ? `type:${type}` : '';
    const ids = row.objectIds.filter(id => typeof id === 'string' && id.trim()).join('、') || '未编号';
    const key = `${identity}|${row.width}|${row.depth}|${row.height}`;
    const prior = groups.get(key);
    if (prior && identity) {
      prior.quantity += row.quantity;
      prior.evidence = `${prior.evidence}；场景物件 ${ids}`;
      continue;
    }
    groups.set(key, {
      identity, name: row.name, widthM: row.width, depthM: row.depth, heightM: row.height, quantity: row.quantity,
      evidence: `场景物件 ${ids}`,
    });
  }
  return [...groups.values()];
}

export function sceneLinesFromCounts(rows: readonly SceneCountInput[]): { lines: InventoryLine[]; rejected: string[] } {
  const lines: InventoryLine[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const identity = typeof row?.identity === 'string' ? row.identity.trim() : '';
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const evidence = typeof row?.evidence === 'string' ? row.evidence.trim() : '';
    const key = `${identity}|${row?.widthM}|${row?.depthM}|${row?.heightM}`;
    if (!identity || !name || !evidence || !positive(row?.widthM) || !positive(row?.depthM) || !positive(row?.heightM)
      || !Number.isSafeInteger(row?.quantity) || row.quantity < 0 || row.quantity > 100000 || seen.has(key)) {
      rejected.push(identity);
      continue;
    }
    seen.add(key);
    lines.push({
      identity, name, evidence, quantity: row.quantity, source: 'catalog_model',
      dimensions: { widthM: row.widthM, depthM: row.depthM, heightM: row.heightM },
    });
  }
  return { lines, rejected };
}

/** 用户填写和假设库存只留下说明，不进入核实列。 */
export function withholdCandidateInventory(candidate: CandidateStockInput | null | undefined): { verifiedStock: InventoryLine[]; note: string | null } {
  if (!candidate) return { verifiedStock: [], note: null };
  const count = Array.isArray(candidate.entries) ? candidate.entries.length : 0;
  const origin = candidate.origin === 'user_reported' ? '用户填写' : candidate.origin === 'assumption' ? '假设' : '无效来源';
  return { verifiedStock: [], note: `候选库存有 ${count} 行${origin}记录，仍不是核实库存。` };
}

export interface AssembledLedger extends ChairLedger {
  unreadOral: string[];
  rejectedScene: string[];
  withheldCandidateNote: string | null;
}

function verifiedLines(lines: readonly InventoryLine[] | undefined): { lines: InventoryLine[]; rejected: boolean } {
  if (!lines?.length) return { lines: [], rejected: false };
  if (lines.some(line => line.source !== 'verified_stock')) return { lines: [], rejected: true };
  return { lines: lines.map(line => ({ ...line, dimensions: line.dimensions ? { ...line.dimensions } : null })), rejected: false };
}

/** 三本账的汇总入口。读不完的口述、入不了账的场景行，都会让结论保持未知。 */
export function assembleThreeLedgers(input: {
  reports?: readonly OralReport[];
  scene?: readonly SceneCountInput[];
  candidate?: CandidateStockInput | null;
  verified?: readonly InventoryLine[];
}): AssembledLedger {
  const oral = oralLinesFromReports(input.reports ?? []);
  const scene = sceneLinesFromCounts(input.scene ?? []);
  const held = withholdCandidateInventory(input.candidate);
  const verified = verifiedLines(input.verified);
  const ledger = accountChairs({ oral: oral.lines, sceneModels: scene.lines, verifiedStock: held.verifiedStock.concat(verified.lines) });
  const explanations = [...ledger.explanations];
  if (oral.unread.length) explanations.push(`${oral.unread.length} 条口述没有形成数量行，不能用其余数字补成完整库存。`);
  if (scene.rejected.length) explanations.push(`${scene.rejected.length} 行场景模型缺少身份、规格或数量，这些行没有入账。`);
  if (held.note) explanations.push(held.note);
  if (verified.rejected) explanations.push('核实列里混入了非核实来源，该列已清空。');
  const incomplete = oral.unread.length > 0 || scene.rejected.length > 0 || verified.rejected;
  return {
    ...ledger,
    explanations,
    stockStatus: incomplete && ledger.stockStatus !== 'not_applicable' ? 'unknown' : ledger.stockStatus,
    unreadOral: oral.unread,
    rejectedScene: scene.rejected,
    withheldCandidateNote: held.note,
  };
}

export function ledgerChecklistLines(ledger: ChairLedger): LedgerChecklistLine[] {
  const noteFor = (line: InventoryLine) => line.evidence;
  return [
    ...ledger.oral.map(line => ({ column: '口述' as const, identity: line.identity, quantity: line.quantity, note: noteFor(line) })),
    ...ledger.sceneModels.map(line => ({ column: '场景模型' as const, identity: line.identity, quantity: line.quantity, note: '场景中的模型数量。规格与采购待确认。' })),
    ...ledger.verifiedStock.map(line => ({ column: '核实库存' as const, identity: line.identity, quantity: line.quantity, note: noteFor(line) })),
  ];
}

/** 供清单测试使用的文本。状态只写待核验，不写已采购或已布置。 */
export function deliveryChecklistText(audit: DeliveryAudit, ledger: ChairLedger): string {
  const rows: string[][] = [['栏目', '身份', '数量', '状态', '说明'], ['清单含义', '', '', '已生成', GENERATED_LIST_NOTICE]];
  for (const line of ledgerChecklistLines(ledger)) rows.push([line.column, line.identity, String(line.quantity), '待核验', `${line.note} ${GENERATED_LIST_NOTICE}`]);
  rows.push(['库存结论', '', '', ledger.stockStatus, ledger.explanations[0] ?? GENERATED_LIST_NOTICE]);
  for (const item of audit.materials) rows.push(['物料', item.identity, String(item.quantity), '规格与采购待确认', GENERATED_LIST_NOTICE]);
  for (const task of audit.tasks) rows.push(['任务', task.id, '', '未执行', task.title]);
  return rows.map(row => row.join('\t')).join('\n');
}

const DESK: Dimensions = { widthM: 0.49, depthM: 0.57, heightM: 0.9 };

export interface GuangzhouLectureCase {
  id: 'guangzhou-meeting-6-health-lecture-synthetic';
  execution: 'simulated';
  event: { title: string; statedHeadcount: 45; note: string };
  chairs: AssembledLedger;
  seatComparison: SeatCountComparison;
  facts: FactSnapshot[];
  conclusions: ReviewedConclusion[];
  protection: ProtectionReview;
  delivery: DeliveryAudit;
  frozen: FrozenAudit;
  checklist: string;
}

/**
 * 广州会议室 6 的合成健康讲座。
 * 剧院参考 80 人与口述 80 把椅子数字相同，仍分属两本账。
 */
export function guangzhouHealthLecture(): GuangzhouLectureCase {
  const facts: FactSnapshot[] = [
    { key: 'venue_width', revision: 1, status: 'pending', source: 'official_nominal', value: '12.9m' },
    { key: 'venue_depth', revision: 1, status: 'pending', source: 'official_nominal', value: '7.1m' },
    { key: 'area', revision: 1, status: 'pending', source: 'official_nominal', value: '93㎡' },
    { key: 'door_width', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'door_swing', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'fire', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'accessibility', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'approved_capacity', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'inventory_on_site', revision: 0, status: 'unknown', source: 'unavailable', value: null },
  ];
  const chairs = assembleThreeLedgers({
    reports: [{ evidence: '我们有80把椅子', status: 'reported' }],
    scene: [{
      identity: 'catalog:desk-chair-en', name: '课桌椅（测试沿用尺寸）', widthM: DESK.widthM, depthM: DESK.depthM, heightM: DESK.heightM,
      quantity: 45, evidence: '合成课桌席使用了 Hall D5 英文页尺寸，广州资料没有公布这套规格。',
    }],
    candidate: {
      origin: 'user_reported',
      entries: [{ identity: { kind: 'type', value: 'chair' }, name: '椅子', available: 80, dimensions: { width: DESK.widthM, depth: DESK.depthM, height: DESK.heightM } }],
    },
  });
  chairs.explanations.push('资料里的剧院参考 80 人，和口述 80 把椅子数字相同，分别是容量参考和口述物料。');
  const conclusions = reviewConclusions(facts, [
    { id: 'capacity-matches-oral', status: 'pass', basedOn: [{ key: 'approved_capacity', revision: 0 }] },
  ]);
  const protection = reviewProtectedObjects(
    [{ id: 'checkin-1', floorId: 'room-6', locked: true, keepPosition: true, position: { x: -4, z: 2 }, rotation: 0, elevation: 0 }],
    [{ id: 'checkin-2', floorId: 'room-6', locked: true, keepPosition: true, position: { x: -4, z: 2 }, rotation: 0, elevation: 0 }],
  );
  const delivery = buildDeliveryAudit({
    planDimensions: { widthM: 12.9, depthM: 7.1, source: 'official_nominal', note: '场地资料标称 12.9×7.1m、93㎡。相乘约为 91.59，与 93 的差异尚未核实。现况待核对。' },
    nominalDimensions: { widthM: 12.9, depthM: 7.1, areaM2: 93, source: 'official_nominal', note: '标称面积与长宽相乘不一致，两数都保留。' },
    materials: [{ identity: 'catalog:desk-chair-en', name: '课桌椅（测试沿用尺寸）', quantity: 45, source: 'catalog_model' }],
    assumptions: [
      '活动是合成的社区健康讲座，口述 45 人、课桌式、有签到台，并未举办。',
      '椅子尺寸沿用其他场地的测试值，不是这间会议室公布的规格。',
      '南墙入口位置是推断，门宽和开启方向未知。',
      '用户填写的 80 把没有升成核实库存。',
    ],
    checks: [
      { id: 'door_width', status: 'unknown', detail: '门宽未知。' },
      { id: 'approved_capacity', status: 'pass', detail: '调用方不得把参考人数写成核定容量。' },
      { id: 'inventory_on_site', status: 'pass', detail: '调用方不得把用户填写写成现场盘点。' },
      { id: 'fire', status: 'unknown', detail: '消防未核验。' },
      { id: 'accessibility', status: 'unknown', detail: '无障碍未核验。' },
    ],
    unverified: ['门宽、开启方向、核定人数、消防、无障碍和现场库存均未核验。', '12.9×7.1 与 93㎡ 的差异未向场地方核实。'],
    tasks: [{ id: 'task-checkin', title: '核对签到台' }, { id: 'task-chairs', title: '按身份清点课桌椅' }],
    facts,
  });
  const checklist = deliveryChecklistText(delivery, chairs);
  return {
    id: 'guangzhou-meeting-6-health-lecture-synthetic',
    execution: 'simulated',
    event: { title: '会议室 6 社区健康讲座（合成）', statedHeadcount: 45, note: '45 是构造的参加人数。剧院参考 80 和口述 80 把椅子都不是这场的核实库存。' },
    chairs,
    seatComparison: compareSeatCounts({
      referenceSeats: 45,
      referenceBoundary: 'official-classroom-reference',
      syntheticSeats: 45,
      syntheticBoundary: 'synthetic-desk-chair-models',
    }),
    facts,
    conclusions,
    protection,
    delivery,
    frozen: freezeDeliveryAudit(delivery, facts, 1),
    checklist,
  };
}
