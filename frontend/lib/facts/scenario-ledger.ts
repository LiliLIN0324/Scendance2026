/**
 * 事实、库存与交付的纯审核记录。
 *
 * 不读取场景、不摆放家具、不导出文件、不表示采购、布置或现场验收。
 * 口述数量、场景模型和已核实库存分列；未知项保持未知。
 */

export type EvidenceClass =
  | 'user_statement'
  | 'official_nominal'
  | 'drawing_observation'
  | 'estimate'
  | 'catalog_model'
  | 'verified_stock'
  | 'site_confirmed'
  | 'assumption'
  | 'unavailable';

export type FactStatus = 'confirmed' | 'pending' | 'inferred' | 'unknown';

export interface Dimensions {
  widthM: number;
  depthM: number;
  heightM: number;
}

export interface InventoryLine {
  /** 稳定身份。同名不同身份不能并成一行。 */
  identity: string;
  name: string;
  dimensions: Dimensions | null;
  quantity: number;
  evidence: string;
  source: EvidenceClass;
}

export interface ChairLedgerInput {
  oral: readonly InventoryLine[];
  sceneModels: readonly InventoryLine[];
  verifiedStock: readonly InventoryLine[];
}

export interface ChairShortage {
  identity: string;
  name: string;
  sceneQuantity: number;
  verifiedQuantity: number;
  missing: number;
}

export type StockStatus = 'quantity_met' | 'short' | 'unknown' | 'not_applicable';

export interface ChairLedger {
  oral: InventoryLine[];
  sceneModels: InventoryLine[];
  verifiedStock: InventoryLine[];
  explanations: string[];
  stockStatus: StockStatus;
  unmatchedSceneIdentities: string[];
  shortages: ChairShortage[];
}

export interface FactSnapshot {
  key: string;
  revision: number;
  status: FactStatus;
  source: EvidenceClass;
  /** 展示用原文。未知事实必须为空。 */
  value: string | null;
}

export interface Conclusion {
  id: string;
  status: 'pass' | 'fail' | 'unknown';
  basedOn: readonly { key: string; revision: number }[];
}

export interface ReviewedConclusion extends Conclusion {
  review: 'current' | 'stale' | 'unsupported';
  effectiveStatus: 'pass' | 'fail' | 'unknown' | 'stale';
}

export interface ProtectedObject {
  id: string;
  floorId: string;
  locked: boolean;
  keepPosition: boolean;
  position: { x: number; z: number } | null;
  rotation: number | null;
  elevation: number | null;
}

export interface ProtectionReview {
  status: 'pass' | 'violated' | 'unknown' | 'not_requested';
  missingIds: string[];
  movedIds: string[];
  protectionChangedIds: string[];
  message: string;
}

export interface DeliveryCheck {
  id: string;
  status: 'pass' | 'unknown' | 'not_applicable';
  detail: string;
}

export interface DeliveryAudit {
  execution: 'simulated';
  listMeans: 'generated_not_procured_or_placed';
  planDimensions: { widthM: number; depthM: number; source: EvidenceClass; note: string };
  nominalDimensions: { widthM: number; depthM: number; areaM2: number; source: EvidenceClass; note: string } | null;
  materials: Array<{ identity: string; name: string; quantity: number; source: EvidenceClass }>;
  assumptions: string[];
  checks: DeliveryCheck[];
  unverified: string[];
  tasks: Array<{ id: string; title: string; executed: false }>;
}

export interface FrozenAudit {
  revision: number;
  factRevisions: Readonly<Record<string, number>>;
  audit: DeliveryAudit;
}

export interface SeatCountComparison {
  referenceSeats: number;
  referenceBoundary: string;
  syntheticSeats: number;
  syntheticBoundary: string;
  delta: number;
  calibration: false;
  reason: string;
}

const COLUMN_SOURCE: Record<'oral' | 'sceneModels' | 'verifiedStock', EvidenceClass> = {
  oral: 'user_statement',
  sceneModels: 'catalog_model',
  verifiedStock: 'verified_stock',
};

function finitePositive(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function dimensionsValid(value: Dimensions | null): boolean {
  if (value === null) return true;
  return !!value && finitePositive(value.widthM) && finitePositive(value.depthM) && finitePositive(value.heightM);
}

function lineValid(line: InventoryLine, source: EvidenceClass): boolean {
  return !!line
    && typeof line.identity === 'string' && !!line.identity.trim() && line.identity === line.identity.trim()
    && typeof line.name === 'string' && !!line.name.trim()
    && typeof line.evidence === 'string' && !!line.evidence.trim()
    && line.source === source
    && dimensionsValid(line.dimensions)
    && Number.isSafeInteger(line.quantity) && line.quantity >= 0;
}

function dimensionKey(value: Dimensions | null): string {
  return value ? `${value.widthM}|${value.depthM}|${value.heightM}` : 'unspecified';
}

function groupKey(line: InventoryLine): string {
  return `${line.identity}\u0000${dimensionKey(line.dimensions)}`;
}

function cloneLine(line: InventoryLine): InventoryLine {
  return {
    identity: line.identity,
    name: line.name,
    dimensions: line.dimensions ? { ...line.dimensions } : null,
    quantity: line.quantity,
    evidence: line.evidence,
    source: line.source,
  };
}

/** 三列分开记账。口述数量不参与库存差额。 */
export function accountChairs(input: ChairLedgerInput): ChairLedger {
  const oral = input.oral.map(cloneLine);
  const sceneModels = input.sceneModels.map(cloneLine);
  const verifiedStock = input.verifiedStock.map(cloneLine);
  const explanations = ['口述数量、场景模型和已核实库存是三本账，不能互相代替。'];
  const invalid = (['oral', 'sceneModels', 'verifiedStock'] as const).some(column =>
    input[column].some(line => !lineValid(line, COLUMN_SOURCE[column])));
  const duplicate = (lines: readonly InventoryLine[]) => {
    const seen = new Set<string>();
    return lines.some(line => {
      const key = groupKey(line);
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  };
  if (invalid || duplicate(input.oral) || duplicate(input.sceneModels) || duplicate(input.verifiedStock)) {
    return {
      oral, sceneModels, verifiedStock, explanations: [...explanations, '账目中有无效身份、规格、数量或重复行，库存保持未知。'],
      stockStatus: 'unknown', unmatchedSceneIdentities: sceneModels.map(line => line.identity), shortages: [],
    };
  }
  const oralQuantity = oral.reduce((sum, line) => sum + line.quantity, 0);
  if (oralQuantity > 0) explanations.push(`口述合计 ${oralQuantity}，只保留原话线索；它不是参加人数，也不是可用库存。`);
  if (!sceneModels.length) {
    return {
      oral, sceneModels, verifiedStock, explanations: [...explanations, '当前没有场景模型可核对。核实库存即使有记录，也不表示已经采购或布置。'],
      stockStatus: 'not_applicable', unmatchedSceneIdentities: [], shortages: [],
    };
  }
  const stock = new Map(verifiedStock.map(line => [groupKey(line), line]));
  const unmatchedSceneIdentities: string[] = [];
  const shortages: ChairShortage[] = [];
  for (const line of sceneModels) {
    const found = stock.get(groupKey(line));
    if (!found) {
      unmatchedSceneIdentities.push(line.identity);
      explanations.push(`场景模型「${line.name}」（${line.identity}，${line.quantity} 件）没有同身份、同规格的核实库存，可用数量保持未知。`);
      continue;
    }
    if (found.quantity < line.quantity) {
      const missing = line.quantity - found.quantity;
      shortages.push({ identity: line.identity, name: line.name, sceneQuantity: line.quantity, verifiedQuantity: found.quantity, missing });
      explanations.push(`「${line.name}」场景模型 ${line.quantity} 件，核实库存 ${found.quantity} 件，同规格还差 ${missing} 件。`);
    }
  }
  if (unmatchedSceneIdentities.length) {
    explanations.push('仍有场景模型对不上核实库存，整本账保持未知；已算出的差额只解释对得上的椅型。');
    return { oral, sceneModels, verifiedStock, explanations, stockStatus: 'unknown', unmatchedSceneIdentities, shortages };
  }
  if (shortages.length) {
    return { oral, sceneModels, verifiedStock, explanations, stockStatus: 'short', unmatchedSceneIdentities, shortages };
  }
  explanations.push('场景模型数量未超过同身份、同规格的核实库存。这只比较数量，不表示已经采购、已经布置或现场可用。');
  return { oral, sceneModels, verifiedStock, explanations, stockStatus: 'quantity_met', unmatchedSceneIdentities, shortages };
}

function canSupportPass(fact: FactSnapshot): boolean {
  return fact.status === 'confirmed' && fact.source === 'site_confirmed' && fact.value !== null && !!fact.value.trim();
}

/** 事实修订或未知依据会使相关结论失效。通过只保留在现场确认且版本一致的依据上。 */
export function reviewConclusions(facts: readonly FactSnapshot[], conclusions: readonly Conclusion[]): ReviewedConclusion[] {
  const byKey = new Map(facts.map(fact => [fact.key, fact]));
  return conclusions.map(conclusion => {
    const cited = conclusion.basedOn.map(item => ({ item, fact: byKey.get(item.key) }));
    const missing = cited.some(entry => !entry.fact || entry.fact.revision !== entry.item.revision);
    if (!conclusion.basedOn.length || missing) {
      return { ...conclusion, basedOn: [...conclusion.basedOn], review: missing ? 'stale' : 'unsupported', effectiveStatus: missing ? 'stale' : 'unknown' };
    }
    if (cited.some(entry => !entry.fact || !canSupportPass(entry.fact))) {
      return { ...conclusion, basedOn: [...conclusion.basedOn], review: 'unsupported', effectiveStatus: 'unknown' };
    }
    return { ...conclusion, basedOn: [...conclusion.basedOn], review: 'current', effectiveStatus: conclusion.status };
  });
}

function identifiable(item: ProtectedObject): boolean {
  return !!item && typeof item.id === 'string' && !!item.id.trim() && item.id === item.id.trim()
    && typeof item.floorId === 'string' && !!item.floorId.trim() && typeof item.locked === 'boolean' && typeof item.keepPosition === 'boolean';
}

/** 按物件 ID 与锁定、原位属性核对。数量相同而 ID 不同仍算未保留。 */
export function reviewProtectedObjects(required: readonly ProtectedObject[], candidate: readonly ProtectedObject[]): ProtectionReview {
  if (!required.length) return { status: 'not_requested', missingIds: [], movedIds: [], protectionChangedIds: [], message: '未记录需要按 ID 保留的物件。' };
  if (required.some(item => !identifiable(item)) || candidate.some(item => !identifiable(item))) {
    return { status: 'unknown', missingIds: [], movedIds: [], protectionChangedIds: [], message: '保护名单或候选中的物件身份不完整，暂不能核对。' };
  }
  const requiredIds = new Set<string>();
  for (const item of required) {
    if (requiredIds.has(item.id)) return { status: 'unknown', missingIds: [], movedIds: [], protectionChangedIds: [], message: '保护名单有重复 ID，暂不能核对。' };
    requiredIds.add(item.id);
  }
  const next = new Map<string, ProtectedObject>();
  for (const item of candidate) {
    if (next.has(item.id)) return { status: 'unknown', missingIds: [], movedIds: [], protectionChangedIds: [], message: '候选中有重复 ID，暂不能核对。' };
    next.set(item.id, item);
  }
  const missingIds: string[] = [];
  const movedIds: string[] = [];
  const protectionChangedIds: string[] = [];
  let unknown = false;
  for (const item of required) {
    const found = next.get(item.id);
    if (!found) { missingIds.push(item.id); continue; }
    if (found.locked !== item.locked) protectionChangedIds.push(item.id);
    if (!item.keepPosition) continue;
    const position = found.position;
    if (!item.position || item.rotation === null || item.elevation === null || !position || found.rotation === null || found.elevation === null) {
      unknown = true;
      continue;
    }
    const angleDelta = Math.atan2(Math.sin(item.rotation - found.rotation), Math.cos(item.rotation - found.rotation));
    if (item.floorId !== found.floorId || Math.abs(item.position.x - position.x) > 1e-9 || Math.abs(item.position.z - position.z) > 1e-9 || Math.abs(angleDelta) > 1e-9 || Math.abs(item.elevation - found.elevation) > 1e-9) {
      movedIds.push(item.id);
    }
  }
  if (missingIds.length || movedIds.length || protectionChangedIds.length) {
    return {
      status: 'violated', missingIds, movedIds, protectionChangedIds,
      message: `按 ID 核对未通过：缺失 ${missingIds.length} 件，位置或楼层变化 ${movedIds.length} 件，锁定属性变化 ${protectionChangedIds.length} 件。`,
    };
  }
  if (unknown) return { status: 'unknown', missingIds, movedIds, protectionChangedIds, message: '要求保留原位，但坐标或朝向不完整。' };
  return { status: 'pass', missingIds, movedIds, protectionChangedIds, message: '名单中的物件 ID、锁定和原位要求均仍在。' };
}

const SAFETY_CHECK_IDS = new Set(['door_width', 'door_swing', 'egress', 'fire', 'accessibility', 'approved_capacity', 'inventory_on_site']);

/** 组装一份审核记录。安全类检查没有现场确认时保持未知。 */
export function buildDeliveryAudit(input: {
  planDimensions: DeliveryAudit['planDimensions'];
  nominalDimensions: DeliveryAudit['nominalDimensions'];
  materials: DeliveryAudit['materials'];
  assumptions: readonly string[];
  checks: readonly DeliveryCheck[];
  unverified: readonly string[];
  tasks: readonly { id: string; title: string }[];
  facts: readonly FactSnapshot[];
}): DeliveryAudit {
  const facts = new Map(input.facts.map(fact => [fact.key, fact]));
  const checks = input.checks.map(check => {
    if (!SAFETY_CHECK_IDS.has(check.id)) return { ...check };
    const fact = facts.get(check.id);
    if (check.status === 'not_applicable') return { ...check };
    if (!fact || !canSupportPass(fact)) return { ...check, status: 'unknown' as const, detail: check.detail || '此项没有与当前版本一致的现场确认。' };
    return { ...check };
  });
  const unverified = [...input.unverified];
  if (input.planDimensions.source !== 'site_confirmed') unverified.push('本版平面尺寸不是现场确认值。');
  unverified.push('生成清单不等于已采购或已布置。');
  return {
    execution: 'simulated',
    listMeans: 'generated_not_procured_or_placed',
    planDimensions: { ...input.planDimensions },
    nominalDimensions: input.nominalDimensions ? { ...input.nominalDimensions } : null,
    materials: input.materials.map(item => ({ ...item })),
    assumptions: [...input.assumptions],
    checks,
    unverified: [...new Set(unverified)],
    tasks: input.tasks.map(task => ({ id: task.id, title: task.title, executed: false as const })),
  };
}

export function freezeDeliveryAudit(audit: DeliveryAudit, facts: readonly FactSnapshot[], revision: number): FrozenAudit {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('冻结版本号无效。');
  const factRevisions: Record<string, number> = {};
  for (const fact of facts) {
    if (!fact.key.trim() || !Number.isSafeInteger(fact.revision) || fact.revision < 0 || factRevisions[fact.key] !== undefined) throw new Error('事实版本无效，未冻结。');
    factRevisions[fact.key] = fact.revision;
  }
  return { revision, factRevisions, audit: structuredClone(audit) };
}

/** 刷新只比较冻结时的事实版本。版本变化后旧结论不再当前。 */
export function refreshFrozenAudit(frozen: FrozenAudit, facts: readonly FactSnapshot[]): { status: 'current' | 'stale'; staleKeys: string[] } {
  const current = new Map(facts.map(fact => [fact.key, fact.revision]));
  const staleKeys = Object.entries(frozen.factRevisions).filter(([key, revision]) => current.get(key) !== revision).map(([key]) => key);
  const added = facts.some(fact => frozen.factRevisions[fact.key] === undefined);
  return { status: staleKeys.length || added ? 'stale' : 'current', staleKeys };
}

/** 座位数差异只记录数值。不同边界或未经现场确认时，校准标记保持否。 */
export function compareSeatCounts(input: {
  referenceSeats: number;
  referenceBoundary: string;
  syntheticSeats: number;
  syntheticBoundary: string;
}): SeatCountComparison {
  if (!Number.isSafeInteger(input.referenceSeats) || !Number.isSafeInteger(input.syntheticSeats) || input.referenceSeats < 0 || input.syntheticSeats < 0) {
    throw new Error('座位数无效。');
  }
  const delta = input.syntheticSeats - input.referenceSeats;
  const sameBoundary = input.referenceBoundary === input.syntheticBoundary;
  return {
    ...input,
    delta,
    calibration: false,
    reason: sameBoundary
      ? `两边使用同一边界标签，座位数相差 ${delta}。标签相同仍不是现场测量，不能当作校准。`
      : `参考边界「${input.referenceBoundary}」为 ${input.referenceSeats} 座，合成边界「${input.syntheticBoundary}」为 ${input.syntheticSeats} 座，相差 ${delta}。边界不同，这个差不能当作测量误差或校准结果。`,
  };
}

export const HALL_D5_OFFICIAL = {
  widthM: 16.5,
  depthM: 17.2,
  areaM2: 285,
  ceilingM: 6.35,
  sourceUrl: 'https://www.t-i-forum.co.jp/organizer/facilities/d5/',
  classroomReferenceSeats: 120,
  theaterReferenceSeats: 200,
} as const;

export const HALL_D5_ESTIMATE_RECTANGLE = {
  widthM: 19,
  depthM: 15,
  note: '按公布面积 285㎡ 构造的估算矩形，不是官网标称轮廓，也不是现场测量。',
} as const;

const DESK_CHAIR: Dimensions = { widthM: 0.49, depthM: 0.57, heightM: 0.9 };
const STAFF_CHAIR: Dimensions = { widthM: 0.45, depthM: 0.45, heightM: 0.9 };

export interface HallD5SyntheticCase {
  id: 'hall-d5-public-lecture-synthetic';
  execution: 'simulated';
  event: { title: string; statedHeadcount: 30; note: string };
  chairs: ChairLedger;
  seatComparison: SeatCountComparison;
  facts: FactSnapshot[];
  conclusions: ReviewedConclusion[];
  protection: ProtectionReview;
  delivery: DeliveryAudit;
  frozen: FrozenAudit;
  humanBaseline: { label: string; referenceSeats: 120; note: string };
}

/**
 * 公开场地 Hall D5 加一场合成讲座。
 * 摆放计数 126 抄自既有基准测试的记录，本函数不重新摆放。
 */
export function hallD5SyntheticLecture(): HallD5SyntheticCase {
  const facts: FactSnapshot[] = [
    { key: 'venue_width', revision: 1, status: 'pending', source: 'official_nominal', value: '16.5m' },
    { key: 'venue_depth', revision: 1, status: 'pending', source: 'official_nominal', value: '17.2m' },
    { key: 'area', revision: 1, status: 'pending', source: 'official_nominal', value: '285㎡' },
    { key: 'estimate_width', revision: 1, status: 'inferred', source: 'estimate', value: '19m' },
    { key: 'estimate_depth', revision: 1, status: 'inferred', source: 'estimate', value: '15m' },
    { key: 'door_width', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'door_swing', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'egress', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'fire', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'accessibility', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'approved_capacity', revision: 0, status: 'unknown', source: 'unavailable', value: null },
    { key: 'inventory_on_site', revision: 0, status: 'unknown', source: 'unavailable', value: null },
  ];
  const chairs = accountChairs({
    oral: [{ identity: 'oral:unspecified-chair', name: '椅子', dimensions: null, quantity: 80, evidence: '我们有80把椅子', source: 'user_statement' }],
    sceneModels: [
      { identity: 'catalog:desk-chair-en', name: '课桌椅（英文页目录尺寸）', dimensions: DESK_CHAIR, quantity: 100, evidence: '合成场景中的目录模型，尺寸取官网英文页，不是现场家具。', source: 'catalog_model' },
      { identity: 'catalog:staff-chair', name: '工作人员椅', dimensions: STAFF_CHAIR, quantity: 26, evidence: '合成场景中的另一椅型，用来说明不能按总数轧差。', source: 'catalog_model' },
    ],
    verifiedStock: [{ identity: 'catalog:desk-chair-en', name: '课桌椅（英文页目录尺寸）', dimensions: DESK_CHAIR, quantity: 40, evidence: '合成假定：同规格 40 把。这不是场地方盘点。', source: 'verified_stock' }],
  });
  const conclusions = reviewConclusions(facts, [
    { id: 'egress-clear', status: 'pass', basedOn: [{ key: 'door_width', revision: 0 }, { key: 'egress', revision: 0 }] },
    { id: 'nominal-size-recorded', status: 'pass', basedOn: [{ key: 'venue_width', revision: 1 }, { key: 'venue_depth', revision: 1 }] },
  ]);
  const protection = reviewProtectedObjects(
    [{ id: 'podium-1', floorId: 'hall', locked: true, keepPosition: true, position: { x: 0, z: -6 }, rotation: 0, elevation: 0 }],
    [{ id: 'podium-2', floorId: 'hall', locked: true, keepPosition: true, position: { x: 0, z: -6 }, rotation: 0, elevation: 0 }],
  );
  const delivery = buildDeliveryAudit({
    planDimensions: { widthM: HALL_D5_ESTIMATE_RECTANGLE.widthM, depthM: HALL_D5_ESTIMATE_RECTANGLE.depthM, source: 'estimate', note: HALL_D5_ESTIMATE_RECTANGLE.note },
    nominalDimensions: {
      widthM: HALL_D5_OFFICIAL.widthM, depthM: HALL_D5_OFFICIAL.depthM, areaM2: HALL_D5_OFFICIAL.areaM2, source: 'official_nominal',
      note: '官网同时给出 16.5×17.2m 与 285㎡。两者相乘并不等于 285，原因未核实，不能据此改用估算矩形。',
    },
    materials: [
      { identity: 'catalog:desk-chair-en', name: '课桌椅（英文页目录尺寸）', quantity: 100, source: 'catalog_model' },
      { identity: 'catalog:staff-chair', name: '工作人员椅', quantity: 26, source: 'catalog_model' },
    ],
    assumptions: [
      '活动是合成讲座：口述约 30 人，不是 80 人，也未实际举办。',
      '平面使用 19×15m 估算矩形。',
      '南侧入口位置来自公开图纸观察，门宽和开启方向未知。',
      '课桌椅尺寸取官网英文页；日文页尺寸不同，现场型号未确认。',
      '核实库存中的 40 把是合成假定，不是现场盘点。',
      '没有舞台，也没有复现参考图台前 5m。',
    ],
    checks: [
      { id: 'plan_dimensions', status: 'unknown', detail: '本版平面是估算矩形，官网标称尺寸另列。' },
      { id: 'door_width', status: 'pass', detail: '调用方不得把缺门宽写成通过。' },
      { id: 'door_swing', status: 'unknown', detail: '开启方向未知。' },
      { id: 'egress', status: 'unknown', detail: '疏散未知。' },
      { id: 'fire', status: 'unknown', detail: '消防未核验。' },
      { id: 'accessibility', status: 'unknown', detail: '无障碍未核验。' },
      { id: 'approved_capacity', status: 'unknown', detail: '官网参考人数不是核定容量。' },
      { id: 'inventory_on_site', status: 'pass', detail: '调用方不得把合成库存写成现场盘点。' },
    ],
    unverified: [
      '门宽、开启方向、核定人数、消防、无障碍和现场库存均未核验。',
      '16.5×17.2 与 285㎡ 的算术差异未向场地方核实。',
      '英文页与日文页的椅子规格冲突未决。',
    ],
    tasks: [
      { id: 'task-checkin', title: '核对签到位置' },
      { id: 'task-chairs', title: '按身份清点两类椅子' },
    ],
    facts,
  });
  return {
    id: 'hall-d5-public-lecture-synthetic',
    execution: 'simulated',
    event: { title: 'Hall D5 公开讲座（合成）', statedHeadcount: 30, note: '人数来自构造任务，80 只属于椅子口述。' },
    chairs,
    seatComparison: compareSeatCounts({
      referenceSeats: HALL_D5_OFFICIAL.classroomReferenceSeats,
      referenceBoundary: 'official-classroom-diagram',
      syntheticSeats: 126,
      syntheticBoundary: 'estimate-19x15-placer',
    }),
    facts,
    conclusions,
    protection,
    delivery,
    frozen: freezeDeliveryAudit(delivery, facts, 1),
    humanBaseline: {
      label: '官网课桌参考图',
      referenceSeats: 120,
      note: '参考图为 120 座、每桌 3 人、走道 1.2m、排距 1.4m、台前 5m。既有摆放基准在估算矩形上计数 126 座，且没有舞台。',
    },
  };
}
