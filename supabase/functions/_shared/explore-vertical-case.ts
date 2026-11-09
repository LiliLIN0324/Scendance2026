/**
 * 社区讲座的合成纵向案例。
 * 只在内存里走完：读原话 → 选工具 → 看回执 → 修正 → 预览 → 确认 → 回读。
 * 不接入面板、resolver、会话或云端 runner，也不代替房间里的 build-command。
 * 快捷键、按钮和 Agent 只能调用这里的共享命令；bypass 会被拒绝。
 */
import { catalog, sceneSchema, type Scene } from './domain.ts';
import { planDeskChairGroups, type DeskChairLayoutResult } from './agent-seating-layout.ts';
import { findFreeAreas } from './placement-search.ts';
import { readUserAttendance } from './user-attendance.ts';
import { classifyInvocation, suggestionChannel, type ModelToolName } from './explore-tool-matrix.ts';

export const RECEPTION_ID = '50000000-0000-4000-8000-000000000001';
export const LOCKED_ID = '50000000-0000-4000-8000-000000000002';
const HALLUCINATED_ID = '50000000-0000-4000-8000-000000000099';

export const COMMUNITY_LECTURE_TURNS = [
  '你好，我想办一场社区讲座，来的多是长者，资料还没齐',
  '我们有80把椅子，大概30个人来，座位形式先别定',
  '场地还没量。先按12×9米假设看看可能怎么摆，这只是建议',
  '那就按这个建议预览一人一桌，先不要确认',
  '改成28人，把签到桌往左移1米，并出一份物料清单',
  '座位还是先别确认，刚才那个只是建议',
] as const;

export type Actor = 'shortcut' | 'button' | 'agent';
export type IntentKind = 'revise_headcount' | 'move_object' | 'bill_of_materials' | 'explore_layout' | 'defer_layout' | 'report_inventory' | 'assume_venue' | 'preview_seating' | 'hold_confirm';
export type SharedOp = 'execute' | 'confirm' | 'undo';

export type AttendanceFact =
  | { status: 'unknown' }
  | { status: 'approximate' | 'stated'; people: number; evidence: string };

export type InventoryFact = {
  status: 'reported_unverified';
  count: number;
  name: string;
  evidence: string;
  countsAsPeople: false;
  countsAsVerifiedStock: false;
};

export type ExploreMemory = {
  event: { status: 'unknown' | 'stated'; value: string | null; evidence: string | null };
  attendance: AttendanceFact;
  inventory: InventoryFact[];
  audienceTags: Array<'elderly'>;
  mobility: { status: 'unknown' | 'needed' | 'declined'; evidence: string | null };
  layout: { status: 'unknown' | 'suggestion' | 'stated'; value: 'one_desk_one_chair' | null; evidence: string | null };
  venue: { status: 'unknown' | 'assumption'; widthM: number | null; depthM: number | null; evidence: string | null };
  deferred: string[];
  unknowns: string[];
};

export type DraftObject = { id: string; label: string; locked: boolean; position: { x: number; z: number } };
export type MoveCommand = { op: 'move'; id: string; position: { x: number; z: number }; baseRevision: number };
type EditorSnap = { objects: DraftObject[]; pendingPreview: boolean; moveApplied: boolean; revision: number };

export type SharedFailure = 'BYPASS_REJECTED' | 'OBJECT_NOT_FOUND' | 'OBJECT_LOCKED' | 'OUT_OF_BOUNDS' | 'STALE_BASE' | 'NOTHING_TO_CONFIRM' | 'NOTHING_TO_UNDO';
export type SharedOk = { ok: true; actor: Actor; objects: DraftObject[]; pendingPreview: boolean; moveApplied: boolean; revision: number };
export type SharedNo = { ok: false; actor: Actor; code: SharedFailure; objects: DraftObject[]; pendingPreview: boolean; moveApplied: boolean; revision: number };

export type SeparatedEvaluation = {
  toolFeedback: { tool: string; summary: string };
  stateCheck: { summary: string; passed: boolean; shortfall: number | null };
  qualityNote: { summary: string; mayOverrideStateCheck: false };
};

export type TraceEvent = {
  phase: 'read' | 'select' | 'feedback' | 'repair' | 'preview' | 'confirm' | 'readback';
  summary: string;
  actor?: Actor;
};

export type SeatingPreview = {
  requested: number;
  placed: number;
  shortfall: number;
  limitReason: DeskChairLayoutResult['limitReason'];
  unknown: string[];
  applied: false;
  stale: boolean;
  assumption: string;
};

export function initialExploreMemory(): ExploreMemory {
  return refresh({
    event: { status: 'unknown', value: null, evidence: null },
    attendance: { status: 'unknown' },
    inventory: [],
    audienceTags: [],
    mobility: { status: 'unknown', evidence: null },
    layout: { status: 'unknown', value: null, evidence: null },
    venue: { status: 'unknown', widthM: null, depthM: null, evidence: null },
    deferred: [],
    unknowns: [],
  });
}

export function readIntents(text: string): IntentKind[] {
  const intents: IntentKind[] = [];
  if (/(?:大概|大约|约)?\d+\s*(?:个)?人|改成\d+人/.test(text)) intents.push('revise_headcount');
  if (/把|往左|往右|移/.test(text) && /桌|椅|签到/.test(text)) intents.push('move_object');
  if (/清单|物料单/.test(text)) intents.push('bill_of_materials');
  if (/怎么摆|看看可能/.test(text)) intents.push('explore_layout');
  if (/(?:先别定|暂不|先不定|还没定)/.test(text) && /座位|形式|布局|课桌/.test(text)) intents.push('defer_layout');
  if (/\d+\s*把椅子|\d+\s*张(?:桌子|课桌)/.test(text)) intents.push('report_inventory');
  if (/(?:假设|先按|暂按)/.test(text) && /\d+(?:\.\d+)?\s*[×xX]\s*\d+(?:\.\d+)?\s*米/.test(text)) intents.push('assume_venue');
  if (/预览/.test(text) && /一人一桌|一人一套|课桌/.test(text)) intents.push('preview_seating');
  if (/先别确认|不要确认|先不要确认/.test(text)) intents.push('hold_confirm');
  return intents;
}

/** 人数只采用用户原话里的到场人数。家具数量、模型句子都不能写成人数。 */
export function attendanceFromUser(text: string): ReturnType<typeof readUserAttendance> {
  const stripped = text.replace(/\d+\s*位(?:长者|老人|长辈)/g, ' ');
  return readUserAttendance(stripped);
}

export function readTurn(memory: ExploreMemory, text: string): { memory: ExploreMemory; intents: IntentKind[]; reply: string; askedAgain: string[] } {
  const next = structuredClone(memory);
  const intents = readIntents(text);
  if (/讲座/.test(text)) next.event = { status: 'stated', value: /社区讲座/.test(text) ? '社区讲座' : '讲座', evidence: /社区讲座/.test(text) ? '社区讲座' : '讲座' };
  if (/长者|老人|长辈|老年/.test(text) && !/(?:没有|不是).{0,4}(?:长者|老人|长辈)/.test(text)) {
    if (!next.audienceTags.includes('elderly')) next.audienceTags.push('elderly');
  }
  if (/不需要轮椅|没有轮椅|无轮椅/.test(text)) next.mobility = { status: 'declined', evidence: '用户本句明确否定轮椅' };
  else if (/需要轮椅|有轮椅|轮椅使用者|腿脚不便|助行器|拐杖/.test(text)) next.mobility = { status: 'needed', evidence: '用户本句明确提到行动辅助' };
  const inventory = readInventory(text);
  for (const item of inventory) {
    if (!next.inventory.some(saved => saved.evidence === item.evidence)) next.inventory.push(item);
  }
  const attendance = attendanceFromUser(text);
  if (attendance?.status === 'unknown') next.attendance = { status: 'unknown' };
  if (attendance?.status === 'reported') {
    const evidence = attendanceEvidence(text, attendance.people);
    next.attendance = /大概|大约|约|左右|差不多/.test(evidence)
      ? { status: 'approximate', people: attendance.people, evidence }
      : { status: 'stated', people: attendance.people, evidence };
  }
  if (intents.includes('defer_layout')) {
    next.layout = { status: 'unknown', value: null, evidence: null };
    if (!next.deferred.includes('座位形式')) next.deferred.push('座位形式');
  } else if (intents.includes('preview_seating')) {
    next.layout = { status: 'suggestion', value: 'one_desk_one_chair', evidence: '一人一桌' };
  }
  if (intents.includes('hold_confirm') && !next.deferred.includes('座位确认')) next.deferred.push('座位确认');
  const size = text.match(/(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*米/);
  if (size && intents.includes('assume_venue')) {
    next.venue = { status: 'assumption', widthM: Number(size[1]), depthM: Number(size[2]), evidence: size[0] };
  }
  const refreshed = refresh(next);
  const askedAgain = refreshed.deferred.filter(item => item === '座位形式' && /请(?:马上|立即)?(?:选择|决定)座位形式/.test(text));
  return { memory: refreshed, intents, reply: replyFor(refreshed, intents), askedAgain };
}

export function guardModelReply(userText: string, modelText: string): { text: string; dropped: string[] } {
  const attendance = attendanceFromUser(userText);
  const supported = attendance?.status === 'reported' ? attendance.people : null;
  const mobilityAffirmed = /需要轮椅|有轮椅|轮椅使用者|腿脚不便|助行器|拐杖/.test(userText);
  const dropped: string[] = [];
  const kept = modelText.split(/(?<=[。！!])/).map(item => item.trim()).filter(Boolean).filter(sentence => {
    const claimed = [...sentence.matchAll(/(\d{1,5})(?=\s*(?:位|个)?(?:长者|老人|人|位|名))/g)].map(item => Number(item[1]));
    const badPeople = claimed.some(count => count !== supported);
    const badChair = /轮椅/.test(sentence) && !mobilityAffirmed && !/未知|还不知道|不能确定|尚未|不是/.test(sentence);
    const badConfirmed = /已确认|已经定了|库存已核|现场已核对/.test(sentence);
    if (badPeople || badChair || badConfirmed) { dropped.push(sentence); return false; }
    return true;
  });
  return { text: kept.join('') || '这句话里的数量和对象还不能写成已确认事实。', dropped };
}

export function selectTools(memory: ExploreMemory, intents: IntentKind[]): { tools: ModelToolName[]; refused: Array<{ tool: ModelToolName; code: string; source: 'negative_control' | 'selector' }> } {
  const tools: ModelToolName[] = ['get_scene'];
  const refused: Array<{ tool: ModelToolName; code: string; source: 'negative_control' | 'selector' }> = [];
  if (intents.includes('report_inventory')) tools.push('search_resources');
  if (intents.includes('bill_of_materials')) tools.push('get_bom');
  if (intents.includes('preview_seating')) {
    const chairCount = memory.inventory.find(item => item.name === '椅子')?.count;
    if (chairCount != null) refused.push({ tool: 'prepare_seating_candidate', code: 'HEADCOUNT_NOT_FURNITURE', source: 'negative_control' });
    if (memory.layout.status === 'suggestion' && (memory.attendance.status === 'approximate' || memory.attendance.status === 'stated')) tools.push('prepare_seating_candidate', 'find_free_areas');
    else refused.push({ tool: 'prepare_seating_candidate', code: 'LAYOUT_NOT_CHOSEN', source: 'selector' });
  }
  if (memory.layout.value !== 'one_desk_one_chair' || memory.layout.status === 'unknown') {
    refused.push({ tool: 'prepare_shared_seating_candidate', code: 'SHARED_DESK_NOT_REQUESTED', source: 'selector' });
  }
  return { tools: [...new Set(tools)], refused };
}

export function guardSeatingCount(count: number, memory: ExploreMemory): { ok: true; count: number } | { ok: false; code: 'HEADCOUNT_NOT_FURNITURE' } {
  const chairs = memory.inventory.find(item => item.name === '椅子');
  const people = memory.attendance.status === 'unknown' ? null : memory.attendance.people;
  if (chairs && count === chairs.count && count !== people) return { ok: false, code: 'HEADCOUNT_NOT_FURNITURE' };
  if (people == null || count !== people) return { ok: false, code: 'HEADCOUNT_NOT_FURNITURE' };
  return { ok: true, count };
}

export function planMove(text: string, objects: readonly DraftObject[], baseRevision: number): { status: 'unresolved'; reason: string } | { status: 'ready'; command: MoveCommand; axis: 'case_x_minus' | 'case_x_plus' } {
  const hits = objects.filter(object => /签到/.test(text) ? object.label.includes('签到') : false);
  if (hits.length !== 1) return { status: 'unresolved', reason: hits.length === 0 ? '没有唯一的签到桌' : '签到桌不止一件，不能猜是哪一件' };
  const target = hits[0]!;
  if (!/往左|往右/.test(text)) return { status: 'unresolved', reason: '方向还不明确' };
  if (!Number.isInteger(baseRevision) || baseRevision < 0) return { status: 'unresolved', reason: '缺少当前修订号' };
  const delta = /往左/.test(text) ? -1 : 1;
  return {
    status: 'ready',
    axis: delta < 0 ? 'case_x_minus' : 'case_x_plus',
    command: { op: 'move', id: target.id, position: { x: target.position.x + delta, z: target.position.z }, baseRevision },
  };
}

export function createSharedEditor(objects: readonly DraftObject[]) {
  let objectsNow = objects.map(item => ({ ...item, position: { ...item.position } }));
  let pendingPreview = false;
  let moveApplied = false;
  let revision = 0;
  const past: EditorSnap[] = [];
  const view = (actor: Actor): SharedOk => ({ ok: true, actor, objects: objectsNow.map(cloneObject), pendingPreview, moveApplied, revision });
  const fail = (actor: Actor, code: SharedFailure): SharedNo => ({ ok: false, actor, code, objects: objectsNow.map(cloneObject), pendingPreview, moveApplied, revision });
  const snapshot = (): EditorSnap => ({ objects: objectsNow.map(cloneObject), pendingPreview, moveApplied, revision });
  return {
    snapshot,
    execute(actor: Actor, command: MoveCommand, channel: 'shared' | 'bypass'): SharedOk | SharedNo {
      if (channel !== 'shared') return fail(actor, 'BYPASS_REJECTED');
      if (command.baseRevision !== revision) return fail(actor, 'STALE_BASE');
      const target = objectsNow.find(object => object.id === command.id);
      if (!target) return fail(actor, 'OBJECT_NOT_FOUND');
      if (target.locked) return fail(actor, 'OBJECT_LOCKED');
      if (command.position.x < 0 || command.position.z < 0 || command.position.x > 200 || command.position.z > 200) return fail(actor, 'OUT_OF_BOUNDS');
      past.push(snapshot());
      objectsNow = objectsNow.map(object => object.id === command.id ? { ...object, position: { ...command.position } } : object);
      pendingPreview = true;
      moveApplied = false;
      revision += 1;
      return view(actor);
    },
    confirm(actor: Actor, channel: 'shared' | 'bypass'): SharedOk | SharedNo {
      if (channel !== 'shared') return fail(actor, 'BYPASS_REJECTED');
      if (!pendingPreview) return fail(actor, 'NOTHING_TO_CONFIRM');
      past.push(snapshot());
      pendingPreview = false;
      moveApplied = true;
      revision += 1;
      return view(actor);
    },
    undo(actor: Actor, channel: 'shared' | 'bypass'): SharedOk | SharedNo {
      if (channel !== 'shared') return fail(actor, 'BYPASS_REJECTED');
      const previous = past.pop();
      if (!previous) return fail(actor, 'NOTHING_TO_UNDO');
      objectsNow = previous.objects.map(cloneObject);
      pendingPreview = previous.pendingPreview;
      moveApplied = previous.moveApplied;
      revision = previous.revision;
      return view(actor);
    },
  };
}

const sharedActors: readonly Actor[] = ['agent', 'shortcut', 'button'];
const sharedOps: readonly SharedOp[] = ['execute', 'confirm', 'undo'];

/** 三条入口的执行、确认、撤销都先拒绝绕过通道，草稿保持原样。 */
export function rejectBypassChannels(editor: ReturnType<typeof createSharedEditor>, command: MoveCommand) {
  const attempts: Array<{ actor: Actor; op: SharedOp; code: SharedFailure | 'APPLIED'; unchanged: boolean }> = [];
  for (const actor of sharedActors) for (const op of sharedOps) {
    const before = JSON.stringify(editor.snapshot());
    const result = op === 'execute' ? editor.execute(actor, command, 'bypass') : op === 'confirm' ? editor.confirm(actor, 'bypass') : editor.undo(actor, 'bypass');
    attempts.push({ actor, op, code: result.ok ? 'APPLIED' : result.code, unchanged: JSON.stringify(editor.snapshot()) === before });
  }
  return attempts;
}

export function applySeatingPreview(preview: SeatingPreview | null, channel: 'shared' | 'bypass'): { ok: false; code: 'BYPASS_REJECTED' | 'SHORTFALL_BLOCKS_CONFIRM' | 'STALE_PREVIEW' | 'NO_PREVIEW' | 'SUGGESTION_NOT_CONFIRMED' } {
  if (channel !== 'shared') return { ok: false, code: 'BYPASS_REJECTED' };
  return confirmSeating(preview);
}

export function writeConfirmedFact(input: { channel: 'shared' | 'bypass'; kind: 'headcount_from_chairs' | 'suggestion_as_fact' | 'v2_label' }): { ok: false; code: 'BYPASS_REJECTED' | 'HEADCOUNT_NOT_FURNITURE' | 'SUGGESTION_IS_NOT_FACT' | 'V2_DEFAULT_OFF' } {
  if (input.channel !== 'shared') return { ok: false, code: 'BYPASS_REJECTED' };
  if (input.kind === 'headcount_from_chairs') return { ok: false, code: 'HEADCOUNT_NOT_FURNITURE' };
  if (input.kind === 'suggestion_as_fact') return { ok: false, code: 'SUGGESTION_IS_NOT_FACT' };
  return { ok: false, code: 'V2_DEFAULT_OFF' };
}

export function confirmSeating(preview: SeatingPreview | null): { ok: false; code: 'SHORTFALL_BLOCKS_CONFIRM' | 'STALE_PREVIEW' | 'NO_PREVIEW' | 'SUGGESTION_NOT_CONFIRMED' } {
  if (!preview) return { ok: false, code: 'NO_PREVIEW' };
  if (preview.stale) return { ok: false, code: 'STALE_PREVIEW' };
  if (preview.shortfall > 0) return { ok: false, code: 'SHORTFALL_BLOCKS_CONFIRM' };
  return { ok: false, code: 'SUGGESTION_NOT_CONFIRMED' };
}

export function builtinMaterialFeedback(query: string) {
  const hits = catalog.filter(item => item.name.includes(query) || item.id.includes(query));
  return {
    source: 'builtin_catalog' as const,
    hits: hits.map(item => ({ id: item.id, name: item.name, nominalSize: item.size })),
    notice: '这是内置数字物料名录和标称尺寸，不是用户口述的椅子，也不是已核验库存。',
  };
}

export function digitalBom(scene: Scene | null) {
  const counts: Record<string, number> = {};
  for (const object of scene?.objects ?? []) counts[object.materialId] = (counts[object.materialId] ?? 0) + 1;
  return { source: 'digital_scene' as const, counts, notice: '统计的是数字物件。它不是口述数量，也不是可预订库存。' };
}

export function runCommunityLectureCase() {
  const trace: TraceEvent[] = [];
  const evaluations: SeparatedEvaluation[] = [];
  let memory = initialExploreMemory();
  let preview: SeatingPreview | null = null;
  let previewScene: Scene | null = null;
  const editor = createSharedEditor([
    { id: RECEPTION_ID, label: '签到桌', locked: false, position: { x: 2, z: 1 } },
    { id: LOCKED_ID, label: '固定立柱', locked: true, position: { x: 8, z: 1 } },
  ]);
  const v2 = suggestionChannel({ requested: false });
  const v2Forced = suggestionChannel({ requested: true, reproduction: { items: 7, failures: 0, rerunOnCurrentMain: true } });
  const guardedReplies: string[] = [];

  const read = (text: string) => {
    const turn = readTurn(memory, text);
    memory = turn.memory;
    trace.push({ phase: 'read', summary: turn.reply });
    return turn;
  };

  read(COMMUNITY_LECTURE_TURNS[0]);
  trace.push({ phase: 'select', summary: '只读取当前事实，不因为讲座或长者去排座位。' });
  const firstTools = selectTools(memory, readIntents(COMMUNITY_LECTURE_TURNS[0]));
  evaluations.push(evaluation('get_scene', '场地尺寸还没有。', '不能把空白画布当成已测量场地。', false, null, '可以先讨论讲座，不补一张假想平面。'));
  trace.push({ phase: 'feedback', summary: 'get_scene：场地未知。' });

  const second = read(COMMUNITY_LECTURE_TURNS[1]);
  const guarded = guardModelReply(COMMUNITY_LECTURE_TURNS[1], '预计将有80位长者参加。大约30人可以先记下来。');
  guardedReplies.push(guarded.text);
  trace.push({ phase: 'select', summary: `工具：${selectTools(memory, second.intents).tools.join('、')}。` });
  const library = builtinMaterialFeedback('椅子');
  evaluations.push(evaluation('search_resources', library.notice, '名录里的椅子模型数量不是 80，也不是 30 人。', false, null, '模型看起来像椅子，不能当成已经有货。'));
  trace.push({ phase: 'feedback', summary: library.notice });

  read(COMMUNITY_LECTURE_TURNS[2]);
  trace.push({ phase: 'select', summary: '尺寸只记成假设。用户没选课桌，不调用试排。' });
  const exploreTools = selectTools(memory, readIntents(COMMUNITY_LECTURE_TURNS[2]));
  evaluations.push(evaluation('get_scene', `假设场地 ${memory.venue.widthM}×${memory.venue.depthM} 米。`, '假设尺寸还不是实测。', false, null, '先看看怎么摆，只是探索，不是选定形式。'));
  trace.push({ phase: 'feedback', summary: '场地仍是假设，座位形式仍未选定。' });

  const previewTurn = read(COMMUNITY_LECTURE_TURNS[3]);
  const chosen = selectTools(memory, previewTurn.intents);
  trace.push({ phase: 'select', summary: `准备试排。先挡住把 80 把椅子当成人数的调用。` });
  const rejected = guardSeatingCount(memory.inventory.find(item => item.name === '椅子')?.count ?? 0, memory);
  trace.push({ phase: 'feedback', summary: `拒绝人数 ${String(rejected.ok)}：椅子数量不能当作试排人数。` });
  trace.push({ phase: 'repair', summary: '改用用户说的大约 30 人，并标明一人一桌仍是建议。' });
  const accepted = guardSeatingCount(memory.attendance.status === 'unknown' ? 0 : memory.attendance.people, memory);
  if (!accepted.ok) throw new Error(accepted.code);
  const seating = planDeskChairGroups(assumptionScene(memory), seatingInput(accepted.count), seatingId);
  previewScene = seating.scene;
  preview = {
    requested: seating.requested,
    placed: seating.placed,
    shortfall: seating.shortfall,
    limitReason: seating.limitReason,
    unknown: seating.unknown,
    applied: false,
    stale: false,
    assumption: '12×9 米、内置名录标称桌椅、间距均为探索假设。',
  };
  memory = refresh(memory, preview);
  evaluations.push(evaluation(
    'prepare_seating_candidate',
    `请求 ${seating.requested}，放下 ${seating.placed}，缺口 ${seating.shortfall}，原因 ${seating.limitReason ?? '无'}。`,
    '缺口还在，人数不能改成已放下的数量。',
    false,
    seating.shortfall,
    '一人一桌看起来像讲座，但这只是偏好，不能盖过缺口。',
  ));
  trace.push({ phase: 'feedback', summary: `试排回执：放下 ${seating.placed}，缺口 ${seating.shortfall}。` });
  const desk = catalog.find(item => item.id === 'table');
  if (!desk) throw new Error('CATALOG_MISSING');
  const objectCountBeforeSearch = previewScene.objects.length;
  const freeAreas = findFreeAreas(previewScene, { width: desk.size.width, depth: desk.size.depth, height: desk.size.height, clearance: 0.2, limit: 3 });
  const freeAreaUnused = previewScene.objects.length === objectCountBeforeSearch;
  memory = refresh(memory, preview, { freeAreaUnused });
  evaluations.push(evaluation(
    'find_free_areas',
    freeAreas.note,
    `空位候选 ${freeAreas.sites.length} 处。试排缺口仍是 ${preview.shortfall}，没有把候选写进场景。`,
    false,
    preview.shortfall,
    '找到几何空位也不能宣布人数或库存已经满足。',
  ));
  trace.push({ phase: 'feedback', summary: `find_free_areas：${freeAreas.sites.length} 个候选，缺口保持 ${preview.shortfall}。` });
  trace.push({ phase: 'preview', summary: '试排结果只是预览，没有写入已确认方案。' });
  const blocked = confirmSeating(preview);
  const seatingBypass = applySeatingPreview(preview, 'bypass');
  trace.push({ phase: 'confirm', summary: `座位预览不能确认：${blocked.code}。` });

  const compound = read(COMMUNITY_LECTURE_TURNS[4]);
  if (preview) preview = { ...preview, stale: true };
  memory = refresh(memory, preview);
  const staleBlocked = confirmSeating(preview);
  trace.push({ phase: 'confirm', summary: `人数已改，旧试排不能确认：${staleBlocked.code}。` });
  const held = read(COMMUNITY_LECTURE_TURNS[5]);
  memory = refresh(memory, preview, { freeAreaUnused });
  trace.push({ phase: 'select', summary: `同一句保留：${compound.intents.join('、')}。座位确认继续搁置：${held.intents.join('、')}。` });
  const bom = digitalBom(previewScene);
  evaluations.push(evaluation('get_bom', bom.notice, `数字椅子 ${bom.counts.chair ?? 0} 把，口述 80 把，人数 ${attendancePeople(memory) ?? '未知'}。三者不相等。`, false, preview?.shortfall ?? null, '清单完整不能用来宣布库存已经够。'));
  trace.push({ phase: 'feedback', summary: bom.notice });
  const missed = editor.execute('agent', { op: 'move', id: HALLUCINATED_ID, position: { x: 1, z: 1 }, baseRevision: editor.snapshot().revision }, 'shared');
  trace.push({ phase: 'repair', actor: 'agent', summary: `虚构物件被拒绝：${missed.ok ? 'ok' : missed.code}。` });
  const planned = planMove(COMMUNITY_LECTURE_TURNS[4], editor.snapshot().objects, editor.snapshot().revision);
  if (planned.status !== 'ready') throw new Error(planned.reason);
  const bypassLog = rejectBypassChannels(editor, planned.command);
  trace.push({ phase: 'repair', summary: `绕过通道 ${bypassLog.length} 次都没有改草稿。` });
  const shortcutMoved = editor.execute('shortcut', planned.command, 'shared');
  const stale = editor.execute('agent', planned.command, 'shared');
  const replanned = planMove(COMMUNITY_LECTURE_TURNS[4], editor.snapshot().objects, editor.snapshot().revision);
  trace.push({ phase: 'repair', actor: 'agent', summary: `过期命令被拒绝：${stale.ok ? 'ok' : stale.code}。重新读取后的修订号是 ${replanned.status === 'ready' ? replanned.command.baseRevision : '未知'}，没有再往左移一米。` });
  const locked = editor.execute('shortcut', { op: 'move', id: LOCKED_ID, position: { x: 7, z: 1 }, baseRevision: editor.snapshot().revision }, 'shared');
  const bypassConfirm = editor.confirm('button', 'bypass');
  trace.push({ phase: 'preview', actor: 'shortcut', summary: '签到桌移动进入预览。案例把“左”记为 x 减少 1 米，这不是现场方位。' });
  trace.push({ phase: 'feedback', actor: 'shortcut', summary: `锁定物件不能移动：${locked.ok ? 'ok' : locked.code}。确认按钮走旁路也被拒绝：${bypassConfirm.ok ? 'ok' : bypassConfirm.code}。` });
  const confirmed = editor.confirm('button', 'shared');
  const undone = editor.undo('button', 'shared');
  const restored = editor.undo('agent', 'shared');
  const replayed = editor.execute('agent', planned.command, 'shared');
  const reconfirmed = editor.confirm('shortcut', 'shared');
  trace.push({ phase: 'confirm', summary: `移动曾确认：${confirmed.ok}；撤销后回到未移动：x=${restored.objects.find(item => item.id === RECEPTION_ID)?.position.x}；再次确认：${reconfirmed.ok}。` });
  const commandProof = {
    shortcutMoved: shortcutMoved.ok,
    stale: stale.ok ? null : stale.code,
    discardedReplan: replanned.status === 'ready' ? replanned.command : null,
    confirmed: confirmed.ok,
    bypassConfirm: bypassConfirm.ok ? null : bypassConfirm.code,
    undone: undone.ok,
    restoredX: restored.objects.find(item => item.id === RECEPTION_ID)?.position.x ?? null,
    replayed: replayed.ok,
    reconfirmed: reconfirmed.ok,
    finalRevision: editor.snapshot().revision,
  };
  const factWrites = (['headcount_from_chairs', 'suggestion_as_fact', 'v2_label'] as const).flatMap(kind => (['shared', 'bypass'] as const).map(channel => ({ kind, channel, ...writeConfirmedFact({ channel, kind }) })));

  const readback = {
    attendance: memory.attendance,
    inventory: memory.inventory,
    mobility: memory.mobility,
    layout: memory.layout,
    venue: memory.venue,
    unknowns: memory.unknowns,
    deferred: memory.deferred,
    seatingApplied: false,
    seating: preview,
    moveApplied: editor.snapshot().moveApplied,
    objects: editor.snapshot().objects,
    bom,
    factsConfirmed: false,
    freeAreaSites: freeAreas.sites.length,
    layoutHeld: held.memory.layout.status,
  };
  memory = refresh(memory, preview, { freeAreaUnused });
  readback.unknowns = memory.unknowns;
  readback.deferred = memory.deferred;
  trace.push({ phase: 'readback', summary: '回读仍分开保留人数、口述椅子、数字物件、假设场地和未知的行动辅助。' });

  return {
    evidence: 'synthetic_case' as const,
    notEvidenceFor: ['real_model', 'real_venue', 'production_release'] as const,
    memory,
    trace,
    evaluations,
    preview,
    readback,
    editor,
    v2,
    v2Forced,
    guardedReplies,
    toolSelections: { firstTools, exploreTools, chosen },
    blockedSeating: blocked,
    staleBlocked,
    bypassRejected: bypassLog.find(item => item.actor === 'agent' && item.op === 'execute')?.code ?? null,
    bypassLog,
    seatingBypass,
    factWrites,
    freeAreas: { sites: freeAreas.sites.length, note: freeAreas.note, objectCount: previewScene.objects.length },
    missedObject: missed.ok ? null : missed.code,
    lockedRejected: locked.ok ? null : locked.code,
    commandProof,
    library,
  };
}

function evaluation(tool: string, feedback: string, state: string, passed: boolean, shortfall: number | null, quality: string): SeparatedEvaluation {
  return {
    toolFeedback: { tool, summary: feedback },
    stateCheck: { summary: state, passed, shortfall },
    qualityNote: { summary: quality, mayOverrideStateCheck: false },
  };
}

function seatingInput(count: number) {
  const desk = catalog.find(item => item.id === 'table');
  const chair = catalog.find(item => item.id === 'chair');
  if (!desk || !chair) throw new Error('CATALOG_MISSING');
  return {
    layout: 'one_desk_one_chair' as const,
    count,
    deskSize: desk.size,
    chairSize: chair.size,
    deskChairGap: 0.1,
    columnGap: 0.2,
    rowGap: 0.2,
    edgeClearance: 0.2,
  };
}

function assumptionScene(memory: ExploreMemory): Scene {
  if (memory.venue.status !== 'assumption' || memory.venue.widthM == null || memory.venue.depthM == null) throw new Error('VENUE_NOT_ASSUMED');
  return sceneSchema.parse({
    schemaVersion: 1,
    venue: { shape: 'rectangle', width: memory.venue.widthM, depth: memory.venue.depthM, height: 3, entrances: [] },
    objects: [],
    camera: 'overview',
    lighting: 'neutral',
  });
}

function seatingId(index: number): string {
  return `40000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function readInventory(text: string): InventoryFact[] {
  const found: InventoryFact[] = [];
  const push = (count: number, name: string, evidence: string, index: number) => {
    const clause = clauseAt(text, index);
    if (/需要采购|还没有|没有|要买|想买|不是/.test(clause)) return;
    found.push({ status: 'reported_unverified', count, name, evidence, countsAsPeople: false, countsAsVerifiedStock: false });
  };
  for (const match of text.matchAll(/(\d{1,5})把椅子/g)) push(Number(match[1]), '椅子', match[0], match.index ?? 0);
  for (const match of text.matchAll(/(\d{1,5})张(桌子|课桌)/g)) push(Number(match[1]), match[2]!, match[0], match.index ?? 0);
  return found;
}

function clauseAt(text: string, index: number): string {
  let start = 0;
  for (const mark of ['，', ',', '。', '；', ';', '！', '!']) {
    const found = text.lastIndexOf(mark, index);
    if (found >= start) start = found + 1;
  }
  let end = text.length;
  for (const mark of ['，', ',', '。', '；', ';', '！', '!']) {
    const found = text.indexOf(mark, index);
    if (found >= 0 && found < end) end = found;
  }
  return text.slice(start, end);
}

function attendanceEvidence(text: string, people: number): string {
  const clauses = text.split(/[，,。；;！!]/).map(item => item.trim()).filter(Boolean);
  return clauses.find(clause => clause.includes(String(people)) && /人|位|名/.test(clause)) ?? `${people}人`;
}

function attendancePeople(memory: ExploreMemory): number | null {
  return memory.attendance.status === 'unknown' ? null : memory.attendance.people;
}

function refresh(memory: ExploreMemory, preview?: SeatingPreview | null, extras?: { freeAreaUnused?: boolean }): ExploreMemory {
  const unknowns = ['出入口与门扇'];
  if (memory.attendance.status === 'unknown') unknowns.push('本场人数还不知道');
  else unknowns.push('本场人数尚未核定');
  if (memory.attendance.status === 'approximate') unknowns.push('人数是约数，不是核定容量');
  if (memory.inventory.length) unknowns.push('口述椅子数量不是已核验库存');
  if (memory.mobility.status === 'unknown') unknowns.push('行动辅助需求');
  if (memory.layout.status !== 'stated') unknowns.push('座位形式');
  if (memory.venue.status === 'unknown') unknowns.push('场地尺寸');
  if (memory.venue.status === 'assumption') unknowns.push('场地尺寸是假设，不是实测');
  if (preview && preview.shortfall > 0) unknowns.push('试排仍有缺口');
  if (preview?.stale) unknowns.push('人数改过，旧试排已过期');
  if (extras?.freeAreaUnused) unknowns.push('空位候选没有补上试排缺口');
  return { ...memory, unknowns };
}

function replyFor(memory: ExploreMemory, intents: IntentKind[]): string {
  const people = attendancePeople(memory);
  const chairs = memory.inventory.find(item => item.name === '椅子');
  if (intents.includes('bill_of_materials') || intents.includes('move_object')) {
    return `人数改为${people ?? '未知'}。移动和物料清单会分开处理，不会因为后半句要清单就丢掉前半句。`;
  }
  if (intents.includes('preview_seating')) return `按建议预览一人一桌，人数用你说过的 ${people ?? '未知'} 人，不用 ${chairs?.count ?? '椅子'} 把椅子。这仍是预览。`;
  if (intents.includes('hold_confirm')) return '座位先保持为建议，不确认。未知项还留着，也不反复追问。';
  if (intents.includes('assume_venue')) return `先按假设的 ${memory.venue.widthM}×${memory.venue.depthM} 米看看。这不是实测，也不会因此选定课桌式。`;
  if (intents.includes('report_inventory')) {
    const approx = memory.attendance.status === 'approximate' ? '大约 ' : '';
    return `${approx}${people ?? '未知'} 人已记下。${chairs?.count ?? '这些'} 把椅子是你说现有的数量，不是到场人数，也还不是已核验可用库存。座位形式先不定。`;
  }
  if (memory.event.status === 'stated') return '可以先从社区讲座这个想法开始。来的人里有长者，但是否需要轮椅或助行器还不知道。人数、场地、出入口和座位形式都还没定。';
  return '还不能把这句写成已确认事实。';
}

function cloneObject(object: DraftObject): DraftObject {
  return { ...object, position: { ...object.position } };
}

/** 模型工具入口只做分类，不执行。打开物料库不能从这里改场景。 */
export function invokeAsModelTool(name: string) {
  return classifyInvocation(name);
}
