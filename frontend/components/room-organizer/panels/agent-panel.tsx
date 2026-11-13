'use client';

import { validateCandidateApply } from '../lib/candidate-apply-validation';
import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import type {PendingCandidateAccess} from '../lib/pending-candidate-registry';

/**
 * 右栏对话优先的 Agent 面板（#agent-panel）+ 画布上的状态层。
 * 一句话开场：敲一句，或在对话里挑活动/场地/人数；客户端解析后铺进预填卡。
 * 出方案：已连接云项目时走现有 AI 生成；否则由 lib/agent-proposal 用现有本地物料组
 * （furniture-sets / surprise）在内存里算一份候选，再按步推给画布做预览。
 * 硬钉（对话四步 ②）：建议 → 画布预览（绿框 = 新位，虚线 = 原位）→「确认布置」/「撤回」。
 * 确认前一个字节都不写场景，所以自动存档与撤销栈看不到提案；确认才一次 applyLayout，撤销一步能整体退回。
 * 第 1 步「读场地」先把确认过的尺度立成可布置壳体（四面外墙 + 主入口 + 层高，见 lib/venue-shell）。
 * 底图只收图片（复用 layout.floorPlanImage）：图纸只当参照，长宽要么说一句「12×9」、要么说「按图纸估」，
 * 未确认前不把米数说成事实（docs/AI-NATIVE-FOR-EXECUTORS.md 对话四步 ①）。
 * 布置方案的入口只有对话。尺寸表单与「让Bingo出方案」那颗大绿钮按 2026-10-26 夜截图钉砍掉了，
 * 卡片退回只读回显，画布上唯一的绿钮是「确认布置」。
 * 物件与场景生成不在这里：物料生成属于物料对话，场景属于空间栏，Bingo 只谈布置与方案。
 */
import { ArrowUp, Check, Clock, Download, FileImage, HelpCircle, Info, Loader2, Lock, Map as MapIcon, Maximize2, MessageCirclePlus, Minimize2, Paperclip, RotateCcw, RotateCw, Sparkles, Square, SquareDashed, TriangleAlert, X } from '@/components/solid-icons';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { modelEnabled, resolveBriefTurn } from '../../../lib/agent-resolver';
import { incompleteUpdateForOutcome, resolvedTurnOutcome, samePersistedHeadcount, sofaOnlyUnhandled } from '../lib/agent-turn-outcome';
import { chipsAfterLayoutPreview, composeProcessStrip, type ProcessFailure } from '../lib/turn-process';
import { toolChipStatus, toolStatusWord, toolTraceRows } from '../lib/tool-trace';
import { isGeneralActivityQuestion, isPureGreeting } from '../lib/general-activity-question';
import { chatUserHistory } from '../lib/chat-user-history';
import { MaterialCandidatesPanel } from './material-candidates-panel';
import { CandidateInventoryPanel } from './candidate-inventory-panel';
import { checkCandidateInventory, type CandidateInventory } from '../lib/candidate-inventory';
import {captureOriginalPreservation,isStandalonePreservationInstruction,preservationIntent,reviewOriginalPreservation} from '../lib/original-preservation';
import { ModelTextDisclosure } from './model-text-disclosure';
import { hasMixedUtilityCommand } from '../lib/utility-shortcut-boundary';
import {reviewLocalRoutes,type LocalRouteInput,type LocalRouteReview} from '../../../lib/local-route-review';
import { applyLayoutCommand, applyLayoutCommandWithRefusals, completeLayoutError } from '../../../lib/build-command';
import {
  extractProposedZoneTypes,
  hasZoneApplyProposal,
  isAffirmativeIntent,
} from '../../../lib/auto-zone-apply';
import type { LayoutPlanDraft, ZoneSemanticType } from '../../../lib/plan-annotation';
import type {UserRouteProvenance} from '../hooks/use-plan-annotations';
import { readReviewReturn, reviewOrbClass, reviewOrbShouldTurnRed } from '../../review-share-page/review-return';
import { localPlanKey } from '../../review-share-page/load-plan';
import { useRoomEditor, useSelectionOptional } from '../contexts';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { countOverlaps, proposeAddition, raiseVenue, replaceVenueWithShell, revisePlan, type AdditionProposal, type PlanProposal, type RevisionProposal, type VenuePlan } from '../lib/agent-proposal';
import { planLocalDeskChairDraft, planLocalSharedDeskDraft } from '../lib/local-seating-draft';
import {reviewLocalSeatingWitness,type LocalSeatingReview} from '../lib/local-seating-witness';
import { eventPreviewScale, isBanquetUtterance, isRoundResizeUtterance, leadOnStandingHall } from '../lib/event-layout-agent';
import { layoutFurnishing } from '../lib/furnishing-select';
import { mergeBanquetTable } from '../lib/table-seat-plan';
import { mergeLocalSeatingSpecs, type SeatingAxis, type SeatingItemFacts } from '../lib/local-seating-specs';
import { mergeSeatingAllocation } from '../lib/seating-allocation';
import { BLANK_VENUE, createBlankVenue } from '../lib/blank-venue';
import { createVenueFromPick, polygonBboxMeters, type AmapPoint } from '../lib/amap-venue';
import {
  boundsAround,
  createResearchArea,
  lookupPlace,
  matchResearchCommand,
  DEFAULT_RESEARCH_RADIUS_M,
  RESEARCH_SATELLITE_STYLE,
  XIHU_LOCAL_CENTER,
  XIHU_LOCAL_NAME,
  XIHU_LOCAL_PLACE,
  XIHU_LOCAL_SPAN_M,
} from '../lib/research-area';
import { matchVenueCommand } from '../lib/venue-intent';
import { searchPlaces, type PlaceSuggestion } from '../lib/place-search';
import { fetchPlaceShape, searchAreas, peekCachedPlaceShape } from '../lib/place-area';
import { fetchPlaceShapeHints, hintedOutlineNames, buildPlaceSearchOptions } from '../lib/place-search-options';
import { normalizeOutlineName } from '../lib/place-shape-quality';
import { isPersistablePlaceShape } from '../lib/place-shape-quality';
import { trueFootprintBoundary } from '../lib/outdoor-venue-sync';
import { fetchRoadNetwork } from '../lib/road-network';
import { buildRouteProposal, matchRouteCommand, type RouteProposal } from '../lib/route-proposal';
import { OutdoorTaskCard, type OutdoorTaskProgress } from '../components/outdoor-task-card';
import { parseOutdoorEventTurn } from '../lib/outdoor-event-turn';
import { outdoorEventIssue } from '../lib/outdoor-event-logic';
import { buildZoneEventProposal, matchZoneCommand, type ZoneEventProposal } from '../lib/zone-event-proposal';
import { buildSubEntranceProposal, matchSubEntranceCommand } from '../lib/sub-entrance';
import type { PlanFacility, PlanNode, PlanRoute, PlanZone, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { ActivitiesGalleryMount } from './activities-gallery-mount';
import { AmapVenuePicker } from './amap-venue-picker';
import { VenuePicker } from './venue-picker';
import { cloudBriefMessage, cloudSeatingAllocation, cloudSeatingSpecs, initialBriefMemory, memoryExtraction, splitConfirmationLead, type BriefMemory, type LayoutMode } from '../lib/brief-agent';
import { type PlanDiagnostic } from '../lib/diagnostics';
import { checkEntranceBlocks } from '../lib/entrance-block-check';
import { PlanPreview } from './plan-preview';
import { readImageAsDataUrl } from '../lib/file-io';
import { proposeReviewFix, reviewLayout, type ReviewIssue, type ReviewSkip } from '../lib/layout-review';
import { localPlan } from '../lib/local-plan';
import { readBriefMemory, writeBriefMemory } from '../lib/assistant-brief-memory';
import { isVenueScaleCurrent, venueDimensionsMismatch, venueScaleBasis } from '../lib/venue-scale-basis';
import { useVenueFactTracker } from '../lib/venue-fact-epoch';
import {useFloorSessionTracker,type FloorSessionToken} from '../lib/floor-session-epoch';
import { checkRequiredSeats, checkRestArea, countSingleSeats } from '../lib/seat-requirement';
import { sameLayoutContent } from '../lib/persistence';
import { layoutStore } from '../hooks/use-layout-store';
import { PLAN_OBSOLETE_COPY, makePlanArtifact, planCoversLayout, planIsApplicable } from '../lib/plan-artifact';
import { buildOutcome, outcomeOfPlan, type RunOutcome } from '../lib/run-outcome';
import { clearLaneActivity, setLaneActivity } from '../lib/lane-status';
import { capturePlanForVenue, type CapturePlan } from '../lib/site-capture';
import { canApplyLayoutGeometry, isStructuralMarker, materialCount, structuralItemCollides, venueArea } from '../lib/structural-layout';
import { floorInventory, summarizeInventory } from '../lib/deliverable-inventory';
import { venueBriefLine } from '../lib/venue-brief-line';
import { requestWalkPointerLock } from '../lib/walk-engage';
import {
  describeExtraction, classifyFile, fileSizeLabel, formatArea, GEN_STEPS, HEADCOUNT_MAX, MATERIAL_REQUEST_HINT, NON_IMAGE_MESSAGE,
  checkDim, CIRCLE_SEATING_NOTE, isClientReviewCommand, isCopyDraftCommand, isDemoBackend, isEstimateCommand, isExportCommand, isGenericMaterialRequest, isGenerateCommand,
  isMaterialListCommand, isReviewCommand, isStopCommand, isVenueSizeOnly, isZoneCommand, layoutGenerateCommand, lightPlanRail, mentionsUnsupportedSeating, normalizeOralSize, parseBriefSentence, parseMaterialRequest, parseRevisionRequest, parseSafeDirectionalMove, parseSafeRotation, parseSafeRecolor, pendingPlanOf,
  prepareAholoAsk, suggestDimsFromArea, suggestDimsFromImageRatio, workingScale,
  type AgentState, type BriefExtraction, type MaterialRequest, type PendingPlan, type RevisionRequest, type VenueIO,
} from '../lib/workbench-agent';
import { proposalDifferences } from '../three/proposal-preview';
import {describeExistingChanges,type ExistingChangeDescription} from '../lib/proposal-existing-changes';
import {
  groupChangeItems, proposalChangeItems, proposalChangeSummary, proposalZoneCount,
  type ProposalChangeItem, type ProposalChangeKind, type ProposalChangeSummary,
} from '../lib/proposal-change-groups';
import { isUnchangedProposal, useStudioAgent, type UnchangedRunResult } from './creative-studio';
import { aholoChatStep, understandingLine } from '../lib/cloud-tool-connection';
import { parseFollowUpOptions, segmentBubbleBlocks } from '../lib/bubble-text';
import { layoutChatHint, revisionRefusalText } from '../lib/layout-feedback';
import { isLux3dLocalProxy } from '../lib/aholo-assets';
import { stageMaterialGenerate } from '../lib/material-generate';
import { REFERENCE_SOURCE_UNVERIFIED } from '../lib/reference-source-status';
import { BingoAuditCard } from './bingo-audit-card';
import { failOpenLocalStep, finishLocalLayoutRun, formatDurationClock, notePriorLayoutTool, pushLocalLayoutStep, requestAgentStop, resetAgentRun } from './agent-chat-store';
import { subscribeComposerPrefill } from './composer-prefill-bus';
import { AgentRunPanel, useAgentRun } from './agent-run-panel';
import { PlanHome, isPlanHome } from './plan-flow';
import { SiteCaptureCard } from './site-capture-card';
import { StyleBundlePanel } from './style-bundle-panel';
import { CapabilitySuggestionCards } from './capability-suggestion-cards';
import { AGENT_INPUT_SUGGESTIONS, BANQUET_INPUT_SUGGESTIONS, SuggestionGhost, useSuggestion } from './typed-suggestion';
import { buildStyleBundleItems, matchStyleBundleCommand, saveStyleRun, STYLE_RUNS_KEY, type StyleBundle } from '../lib/style-bundles';
import { editorItemLimit } from '../lib/scene-presets';
import {
  readSessionBubbles,
  writeSessionBubbles,
  type StoredAssistantBubble,
} from '../lib/assistant-session-bodies';
import { ASSISTANT_SESSION_DEFAULT_TITLE } from '../lib/assistant-sessions';
import {
  assistantSessionExists,
  subscribeActiveAssistantSession, getActiveAssistantSessionId,
  getAssistantSessionBodies,
  replaceAssistantSessionBodies,
  useAssistantSessions, scopedAssistantStorage,
} from '../hooks/use-assistant-sessions';
import { SessionHistoryOverlay } from './session-history-panel';
import { RailAvatar, type RailForm } from './rail-avatar';
import type { RoomLayout } from '../lib/types';
import type { ScaleOrigin } from '../lib/venue-shell';
import type { WorkbenchMode } from '../lib/workbench-mode';
import { BoundaryLineNote, FollowupChips, type BoundaryContext } from './proposal-followup-chips';
import './agent-panel.css';

const MASCOT_DIR = '/assets/assistant/qingguang-3d';

const STEP_DELAY_MS = 420;
/** 云提案有自己的失效条件（基线/需求/编辑权/租约）。确认按钮按住时说的那句，卡片和按钮共用一条。 */
const CLOUD_STALE = '场地、需求或编辑权在这期间变了，这版先别确认，重新出一版。';
/** 本地验收开关：`?agentFail=1` 让出方案这一步故意失败一次，好核对「发现问题」那一态。 */
const forceFail = () => process.env.NODE_ENV !== 'production' && typeof window !== 'undefined'
  && new URL(window.location.href).searchParams.get('agentFail') === '1';

type FileIssue = { kind: 'nonImage' | 'unsupported' | 'tooLarge' | 'readFailed'; name: string; size: number };
export type Bubble = {
  id: string; role: 'user' | 'agent'; text: string; meta?: string; warn?: string; amber?: boolean;
  /** Only model-authored conversation may be used as model history. */
  modelConversation?: boolean;
  materialQueries?: readonly string[];
  /** 清单/文案这种多行回话：不做两行截断，保留换行。 */
  long?: boolean;
  /** 选进来的图纸/照片：跟这条消息一起留在聊天区，不是只把文件名当一行字。 */
  image?: string;
  /** 气泡里的一句话动作：只给「拖了图纸、还差一步就能出方案」这种当场要点的下一步，不当第二套入口。 */
  action?: { label: string; run(): void };
  /**
   * 「要不要我帮你圈区」提议卡：AI 给完硬建议、末尾问一句时挂这个。
   * 渲染成品牌绿描边小卡 + 「好，帮我圈」按钮；落盘时函数被丢，回读不会重现按钮。
   */
  zoneApply?: { run(): void };
  /** S2 T2：审校台专属气泡（体检回执/钉评指路）。Bingo 脸只回放这类，活动脸回放全部。 */
  review?: boolean;
};

/** 落盘时丢掉 action（函数不可序列化）；翻回话只回放文字与附图。 */
function toStoredBubbles(bubbles: readonly Bubble[]): StoredAssistantBubble[] {
  // zoneApply 是闭包，落盘时丢掉；翻回话文字还在，按钮不重现。
  return bubbles.map(({ id, role, text, meta, warn, amber, long, image, modelConversation, materialQueries }) => {
    return {
      id, role, text,
      ...(meta !== undefined ? { meta } : {}),
      ...(warn !== undefined ? { warn } : {}),
      ...(amber ? { amber: true } : {}),
      ...(long ? { long: true } : {}),
      ...(image !== undefined ? { image } : {}),
      ...(role === 'agent' && modelConversation === true ? { modelConversation: true } : {}),
      ...(role === 'agent' && materialQueries?.length ? { materialQueries } : {}),
    } satisfies StoredAssistantBubble;
  });
}

function fromStoredBubbles(rows: readonly StoredAssistantBubble[]): Bubble[] {
  return rows.map(row => ({ ...row }));
}
/** 这一版要按哪组尺度摆：origin 记下米数是谁定的，只有人说过的才敢当事实念出来。 */
type Scale = { length: number; width: number; origin: ScaleOrigin };

/** 只有整句话都能解释为尺寸调整时，才允许绕过方案预览直接改场地。 */
function isExplicitSizeOnly(text: string): boolean {
  const remainder = normalizeOralSize(text.toLowerCase().replace(/[×X＊✕]/g, 'x')).replace(/\d+(?:\.\d+)?\s*(?:米|m)?\s*[×x*]\s*\d+(?:\.\d+)?\s*(?:米|m)?/g, '')
    .replace(/\d+(?:\.\d+)?\s*(?:平方米|平米|平方公尺|㎡|m²|m2)/g, '')
    .replace(/(?:把|将|场地|场馆|空间|长宽|尺寸|大小|面积|室内|户外|室外|的|改成|改为|调整为|调整成|调成|调为|设为|设置为|换成|变成|是|到|为|请|一下|大约|约|左右)/g, '')
    .replace(/[\s，,。.!！：:；;]/g, '');
  return remainder.length === 0;
}

/**
 * 待确认的那一版布置。本地候选和云端 AI 提案在右栏共用同一张卡、同一颗绿钮：
 * 卡片只认这几个数，谁来提案都得先预览、由人点「确认布置」才落盘。
 */
interface ProposalView extends PendingPlan {
  /** 这次运行的结果账单：放进/挪动/撤掉、被拒原因、没动件数与空结果原因。 */
  outcome: RunOutcome;
  source: 'local' | 'cloud';
  /** 本地提案里 Agent 没动的锁定件数。 */
  keptLocked: number;
  /** 放不进新场地、没被采纳的件数。 */
  dropped: number;
  /** 这一版按多少人摆的；加物料这类提案没有人数，就不写。 */
  guests?: number | null;
  /** 实际摆出的座位数（餐桌一组 4 座 + 散椅）。 */
  seats?: number;
  /** 这版已经按「加座」重排过：仍不够就直接报这一版排到几座。 */
  seatPriority?: boolean;
  /** 确认按钮点不动的原因；null = 可以确认。 */
  blocked: string | null;
  /** 这版是体检改法：只挪位置，不新增不删除，卡片和气泡都换一套说法。 */
  review?: boolean;
  /** 体检里锁着或找不到落点、没动的物料名。 */
  skipped?: string[];
  /** 没放进去的件数与原因；有它就按条说，不再只报一个总数。 */
  diagnostics?: PlanDiagnostic[];
  /** Banquet preview keeps the audit ledger off the card. */
  receipt?: 'banquet';
  /** Tables this banquet pass actually placed. */
  placedTables?: number;
  venueChange?: string;
  removedZones?: number;
  restPreview?: string[];
  movementPreview?: string[];
  scalePreview?: string[];
  rotationPreview?: string[];
  recolorPreview?: string[];
  candidateArea?: number;
  comparisonOnly?: boolean;
  /** Zone and seat lines from the script, shown on the card instead of one long bubble. */
  planNotes?: string[];
  seatWarning?: string;
  /** 课桌式官方规格下的诚实上限：按这版排法最多 N 座（要 X）。 */
  seatCeilingNote?: string;
  /** 门口净区被家具压住的警告（来自 entrance-block-check，只提示不拦截）。 */
  entranceWarning?: string;
  annotationWarning?: string;
  functionalWarnings?: string[];
  modelExplanation?: string;
  localDraftDetails?: string[];
  seatingReview?:LocalSeatingReview;
  existingChanges?: ExistingChangeDescription[];
  /** 分组清单：新增 / 挪动 / 撤掉 的带 id 条目，供卡片点选定位；不挂单件批准/拒绝。 */
  changeItems?: ProposalChangeItem[];
  /** 清单上方一行摘要：改动总数、区域数（可派生时）、耗时（有可读字段时），缺项省略。 */
  changeSummary?: ProposalChangeSummary;
}

/** A birthday or banquet session must not keep the launch-party composer example. */
function isBanquetSession(memory: BriefMemory): boolean {
  if (memory.furnishing?.source === 'select_furnishing') return true;
  const table = memory.banquetTable;
  if (table?.shape || table?.width || table?.peoplePerTable) return true;
  const occasion = memory.eventIntent?.occasion ?? memory.event ?? '';
  return /宴|酒会|年会|派对|聚会/.test(occasion);
}

function seatRequirement(layout: RoomLayout | undefined, floorIndex: number, memory: BriefMemory): { blocked: string | null; warning: string | null } {
  const deskSelected=memory.layoutModeConfirmed === true && memory.layoutMode === 'desk-chair';
  const allocation=memory.localSeatingAllocation;
  const allocationNote=allocation?.status==='one_per_desk'?'用户选择每人一桌，实际桌椅配套仍需核验。'
    :allocation?.status==='shared_desk'?`用户要求每桌 ${allocation.peoplePerDesk} 人，实际桌椅配比仍需核验。`
    :'每桌人数尚未确认，实际桌椅配比仍需核验。';
  if (memory.allGuestsSeated !== true) {
    if (!deskSelected) return { blocked: null, warning: null };
    if (memory.allGuestsSeated === false) return { blocked: null, warning: `已说明不要求人人入座。${allocationNote}` };
    if (!Number.isSafeInteger(memory.headcount) || !memory.headcount || memory.headcount < 1) return { blocked: null, warning: `人数尚未确认；${allocationNote}` };
    const seats=countSingleSeats(layout,floorIndex),target=memory.headcountMode === 'must' ? `${memory.headcount} 人` : `约 ${memory.headcount} 人`;
    if (seats === null) return { blocked: null, warning: `按 ${target} 规划课桌椅，候选场地或楼层信息不完整，座席数量待核验。${allocationNote}` };
    const remaining=seats < memory.headcount ? `是否满足 ${target} 的座席需求尚未核对。` : '单人椅数量已达到规划人数，实际用途仍需核对。';
    return { blocked: null, warning: `按 ${target} 规划课桌椅，当前仅识别到 ${seats} 把单人椅。${remaining}其他家具容量、课桌数量和现场条件仍需核验。${allocationNote}` };
  }
  if (!Number.isSafeInteger(memory.headcount) || !memory.headcount || memory.headcount < 1)
    return { blocked: '已要求所有人入座，请先确认人数。', warning: null };
  const check = checkRequiredSeats(layout, floorIndex, memory.headcount, true);
  return { blocked: check.status === 'unknown' ? check.message : null,
    warning: check.status === 'quantity_met' ? `${check.message ?? ''}${memory.headcountMode !== 'must' ? '人数可能变化，请在活动前重新核对座席需求。' : ''}${deskSelected?allocationNote:''}` : null };
}

/** A local object command cannot safely stand in for the unparsed activity requirements in the same utterance. */
function hasMixedActivityRequirements(text: string): boolean {
  const brief = parseBriefSentence(text);
  return brief.headcount !== null || brief.venueIO !== null || brief.lengthM !== null || brief.widthM !== null || brief.areaM2 !== null || brief.event !== null ||
    /(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:人|位|名)/.test(text) ||
    /人数.{0,8}(?:\d+|[零〇一二两三四五六七八九十百千]+)/.test(text) ||
    /(?:需要|不需要|不要|不用|不设|取消|保留|设置|待定|是否|要不要).{0,8}(?:签到|接待|舞台|休息区)/.test(text) ||
    /(?:每人|人人|所有人|全部人).{0,8}(?:坐|入座|座位)/.test(text);
}

/** Only a standalone, unambiguous action confirms the current visible proposal. */
function isExplicitProposalConfirmation(text:string):boolean {
  return /^(?:请|帮我)?(?:确认布置|确认这版(?:方案|布置)?|确认该方案|应用这版(?:方案|布置)?|应用该方案)[。！!]*$/.test(text.replace(/\s+/g,''));
}

/** These local parsers cannot safely interpret negation or a batch of different additions. */
function needsMaterialCommandClarification(text: string, hasRevision: boolean, hasMaterial: boolean): boolean {
  if (!/(?:加|添|放|摆|补|再来)/.test(text)) return false;
  if (/(?:不|没|无|别|勿|暂缓|暂且|可能|也许|或|是否|待定|看情况|[?？])/.test(text)) return true;
  if (hasRevision && hasMaterial) return true;
  const start = text.search(/(?:加|添|放|摆|补|再来)/);
  const additions = text.slice(start).match(/椅子|座椅|餐椅|椅|桌子|餐桌|圆桌|桌|签到台|签到处|接待台|背景板|背景墙|背景|展架|展板|展示架|展台|隔断|屏风|地毯|地垫|装饰道具|绿植|植物|花艺|盆栽|花|落地灯|吊灯|路灯|庭院灯|灯光|射灯|灯|绿树|树/g) ?? [];
  return additions.length > 1;
}

function explicitAdditionCount(text: string): number | null {
  const hit = text.match(/(?:加|添|再放|再来|补|多放|多来)\s*(\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:把|张|个|块|组|盆|件|面|套|排|对|盏|台|支|座|棵)/);
  if (!hit) return null;
  if (/^\d+$/.test(hit[1]!)) return Number(hit[1]);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, digit = 0;
  for (const char of hit[1]!) {
    if (char in digits) digit = digits[char]!;
    else { total += (digit || 1) * (char === '十' ? 10 : char === '百' ? 100 : 1000); digit = 0; }
  }
  return total + digit;
}

function cloudRecoveryMessage(recovery: { revision: number; outcome?: 'pending' | 'committed' | 'cleanup_failed' }): string {
  if (recovery.outcome === 'committed') return `云端已提交第 ${recovery.revision} 版，本机应用结果未能确认。请保留本地草稿并核对版本差异。`;
  if (recovery.outcome === 'cleanup_failed') return '本机核对记录未能清除，请核对云端与本地版本后解除提醒。';
  return '云端提交结果尚不明确，未重复提交。请保留本地草稿并只读核对云端版本。';
}

/** 本地候选那份读数直接搬到卡片上（生成器已经算好了件数与重叠）。 */
function viewOfLocalPlan(plan: PlanProposal, base?: RoomLayout): ProposalView {
  const candidate = plan.layouts.at(-1);
  const venueChange = base && candidate && (Math.abs(base.width - candidate.width) > 1e-6 || Math.abs(base.height - candidate.height) > 1e-6)
    ? `场地将从 ${formatArea(base.width)} × ${formatArea(base.height)} m 改为 ${formatArea(candidate.width)} × ${formatArea(candidate.height)} m`
    : undefined;
  const candidateZoneIds = new Set(candidate?.floors.flatMap(floor => (floor.zones ?? []).map(zone => zone.id)) ?? []);
  const removedZones = base && candidate ? base.floors.flatMap(floor => floor.zones ?? []).filter(zone => !candidateZoneIds.has(zone.id)).length : 0;
  const originalZones = new Set(base?.floors.flatMap(floor => (floor.zones ?? []).map(zone => zone.id)) ?? []);
  const restPreview = base && candidate ? candidate.floors.flatMap(floor => (floor.zones ?? [])
    .filter(zone => !originalZones.has(zone.id) && zone.name.includes('休息'))
    .map(zone => {
      const bench = floor.items.find(item => item.name === '休息长椅（示意）' && item.position
        && item.position.x >= zone.x && item.position.x <= zone.x + zone.w
        && item.position.z >= zone.z && item.position.z <= zone.z + zone.d);
      return `${zone.name}：${formatArea(zone.w)} × ${formatArea(zone.d)} m，中心坐标 (${formatArea(zone.x + zone.w / 2)}, ${formatArea(zone.z + zone.d / 2)}) m（以场地中心为原点）${bench ? `；示意长椅 ${formatArea(bench.width)} × ${formatArea(bench.depth)} m` : ''}`;
    })) : [];
  const movementPreview = base && candidate ? base.floors.flatMap((floor, floorIndex) => floor.items.flatMap(item => {
    const next = candidate.floors[floorIndex]?.items.find(value => value.id === item.id);
    if (!item.position || !next?.position) return [];
    const dx = next.position.x - item.position.x, dz = next.position.z - item.position.z;
    if (Math.abs(dx) < 1e-7 && Math.abs(dz) < 1e-7) return [];
    return [`${item.name}：${dx ? `${dx > 0 ? '右' : '左'}移 ${Math.abs(Number(dx.toFixed(3)))} 米` : ''}${dx && dz ? '，' : ''}${dz ? `${dz > 0 ? '南' : '北'}移 ${Math.abs(Number(dz.toFixed(3)))} 米` : ''}`];
  })) : [];
  const scaleFactor = (plan as PlanProposal & { scaleFactor?: number }).scaleFactor;
  const scalePreview = scaleFactor !== undefined && base && candidate ? base.floors.flatMap((floor, index) => floor.items.flatMap(item => {
    const next = candidate.floors[index]?.items.find(value => value.id === item.id);
    if (!next || (next.width === item.width && next.depth === item.depth && next.height === item.height)) return [];
    const precise = (n: number) => String(Number(n.toFixed(3)));
    const dims = (value: typeof item) => `${precise(value.width)} × ${precise(value.depth)} × ${precise(value.height ?? 0)} 米`;
    return [`${item.name}：缩放 ${scaleFactor} 倍，${dims(item)} → ${dims(next)}`];
  })) : [];
  const rotationOnly = (plan as PlanProposal & { rotationOnly?: boolean }).rotationOnly;
  const rotationPreview = rotationOnly && base && candidate ? base.floors.flatMap((floor,index) => floor.items.flatMap(item => {
    const next=candidate.floors[index]?.items.find(value=>value.id===item.id);
    if(!next || Math.abs((next.rotation??0)-(item.rotation??0))<1e-12)return [];
    const degrees=(rad:number)=>Number((rad*180/Math.PI).toFixed(3));
    return [`${item.name}：旋转角度 ${degrees(item.rotation??0)}° → ${degrees(next.rotation??0)}°`];
  })) : [];
  const recolorOnly = (plan as PlanProposal & { recolorOnly?: boolean }).recolorOnly;
  const recolorPreview = recolorOnly && base && candidate ? base.floors.flatMap((floor,index) => floor.items.flatMap(item => {
    const next=candidate.floors[index]?.items.find(value=>value.id===item.id);
    return next && item.color!==next.color ? [`${item.name}：颜色 ${item.color} → ${next.color}`] : [];
  })) : [];
  const originalOutcome = outcomeOfPlan(plan);
  const outcome = scaleFactor !== undefined || rotationOnly || recolorOnly ? {...originalOutcome,moved:0,empty:null} : originalOutcome;
  const differences = base && candidate ? proposalDifferences(base, candidate) : [];
  const changeItems = proposalChangeItems(differences);
  const changeSummary = proposalChangeSummary(
    changeItems,
    base && candidate ? proposalZoneCount(differences, base, candidate) : null,
  );
  return {
    added: plan.added, removing: plan.removing, changed: plan.moved ?? 0, lockedTouched: 0,
    overlapCount: plan.overlapCount, overlapNames: plan.overlapNames, outcome: venueChange && outcome.empty ? { ...outcome, empty: null } : outcome,
    source: 'local', keptLocked: plan.keptLocked, dropped: plan.dropped, blocked: plan.blocked,
    guests: plan.guests ?? null, seats: plan.seats ?? 0, seatPriority: !!plan.seatPriority,
    ...(plan.receipt === 'banquet' ? { receipt: 'banquet' as const, placedTables: placedBanquetTables(plan, base) } : {}),
    review: plan.kind === 'review', skipped: plan.skipped ?? [], diagnostics: plan.diagnostics ?? [],
    ...(venueChange ? { venueChange } : {}), ...(removedZones ? { removedZones } : {}),
    ...(restPreview.length ? { restPreview } : {}),
    ...(movementPreview.length ? { movementPreview } : {}),
    ...(scalePreview.length ? { scalePreview } : {}),
    ...(rotationPreview.length ? { rotationPreview } : {}),
    ...(recolorPreview.length ? { recolorPreview } : {}),
    ...(base && candidate ? {existingChanges:describeExistingChanges(differences,base,candidate)} : {}),
    ...(changeItems.length ? { changeItems, changeSummary } : {}),
    ...(plan.seatingReview ? {seatingReview:plan.seatingReview} : {}),
    ...(plan.seatCeilingNote ? { seatCeilingNote: plan.seatCeilingNote } : {}),
    ...(candidate ? { candidateArea: venueArea(candidate) } : {}),
    ...((() => {
      const planNotes = ((plan as PlanProposal & { summary?: string[] }).summary ?? []).filter(line => line.trim() && !/尚未确认/.test(line));
      return planNotes.length ? { planNotes } : {};
    })()),
    ...((plan as PlanProposal & {localDraftDetails?:string[]}).localDraftDetails ? {localDraftDetails:(plan as PlanProposal & {localDraftDetails:string[]}).localDraftDetails} : {}),
  };
}

function placedBanquetTables(plan: PlanProposal, base?: RoomLayout): number {
  const candidate = plan.layouts.at(-1);
  if (!candidate) return 0;
  const baseIds = new Set(base?.floors.flatMap(floor => floor.items.map(item => item.id)) ?? []);
  return candidate.floors.reduce((sum, floor, index) => sum + floor.items.filter(item => item.type === 'dining-table' && !item.structuralColumnId && !baseIds.has(item.id) && !structuralItemCollides(item, candidate, index)).length, 0);
}

/** 给这一版钉上内容身份：确认时比内容指纹，不再比对象引用。 */
function withPlanArtifact(plan: PlanProposal, base: RoomLayout): PlanProposal {
  const existingIds = new Set(base.floors.flatMap(floor => floor.items.map(item => item.id)));
  const opId = `procedural-${uid()}`;
  const layouts = plan.layouts.map(layout => ({ ...layout, floors: layout.floors.map(floor => ({ ...floor,
    items: floor.items.map(item => existingIds.has(item.id) || item.provenance?.source === 'procedural'
      ? item : { ...item, provenance: { source: 'procedural' as const, opId } }),
  })) }));
  const candidate = layouts[layouts.length - 1];
  if (!candidate) return plan;
  return {
    ...plan, layouts,
    artifact: makePlanArtifact({
      base, candidate,
      counts: {
        added: plan.added, removed: plan.removing, moved: plan.moved ?? 0,
        keptLocked: plan.keptLocked, dropped: plan.dropped, overlap: plan.overlapCount,
      },
    }),
  };
}

/** 体检改法没动成时，按原因点名：锁着是规矩，找不到落点是能力边界，不能混成一句。 */
function skipCopy(skips: readonly ReviewSkip[]): string {
  const names = (reason: ReviewSkip['reason']): string[] => [...new Set(skips.filter(skip => skip.reason === reason).map(skip => skip.name))];
  const locked = names('locked'), stuck = names('no-spot');
  return [
    locked.length ? `锁着没动：${locked.join('、')}` : '',
    stuck.length ? `附近找不到稳妥落点：${stuck.join('、')}` : '',
  ].filter(Boolean).join('；');
}

export interface LayoutAgentCallbacks {
  workbenchMode: WorkbenchMode;
  onOpenMaterials(): void;
  onSelectMode(mode: WorkbenchMode): void;
  onOpenReview(): void;
  onOpenDelivery(): void;
  /** S2-2 发送钉评链接：生成 /review/#layout= 评审链接，URL 回给面板气泡。 */
  onIssueReviewLink?(): Promise<string | {url:string;isCurrent:()=>boolean} | null>;
  onFit(): void;
  /** 活动简报（完善需求） */
  onOpenBrief?(): void;
  /** 图纸尺寸面板 */
  onOpenReference?(): void;
  /** 现场照片重建 3D 场地 */
  onOpenRebuild?(): void;
  /** 左栏 / 画布上的场地观感（Lux3D） */
  onOpenLux3d?(kind?: 'world' | 'recon', prompt?: string): void;
  /** 生成轨、观感、重建等生成引擎能力是否露出（与 `NEXT_PUBLIC_LUX3D_RAIL` 一致） */
  luxToolsVisible?: boolean;
}

interface AgentValue {
  outdoorTask: OutdoorTaskProgress | null;
  stopOutdoorTask(): void;
  inspectOutdoorFacility(id: string): void;
  manualOutdoorVenueApplied(anchor: NonNullable<SitePlanData['anchor']>): void;
  sessionScope: string;
  isSessionCurrent(): boolean;
  historyReviewRequired: boolean;
  reviewDialogueHistory(): void;
  acceptFreshSession(id:string):void;
  retainedOtherSessionProposal:boolean;
  withdrawRetainedOtherSessionProposal():void;
  unresolvedDialogue: readonly string[];
  withdrawUnresolvedDialogue(text:string): void;
  withdrawAllUnresolved(): void;
  briefBusy: boolean;
  toolPending: boolean;
  processFailed: ProcessFailure | null;
  assertSessionWrite: () => void;
  sessionSaveFailed: boolean;
  understanding: boolean; isUnderstanding(text?:string): boolean; cancelUnderstanding(): void;
  /** A bridge must not clear text when the main conversation cannot accept it. */
  canForward(text:string):boolean;
  cancelledInput: {id:number;text:string}|null; retryUncertain: string|null; confirmUncertainRetry(): void; dismissUncertainRetry(): void; generationQueued:number;
  callbacks: LayoutAgentCallbacks;
  state: AgentState; venueIO: VenueIO; setVenueIO(value: VenueIO): void;

  baseName: string | null; issue: FileIssue | null; dragging: boolean;
  /** 对话已收集字段的只读回显（截图钉 2026-10-26 夜：表单不再当第二套生成入口）。 */
  recap: { event: string | null; guests: string | null; dims: string; note: string | null };
  /** Birthday or banquet: composer examples follow this session, not the launch-party prompt. */
  banquetChat: boolean;
  /** 画布上已经有一个立起来的场地（墙/门/尺寸都是场地真相）：第 ① 步就算过了。 */
  venueUp: boolean;
  progress: number; failed: boolean; overlapCount: number; bubbles: Bubble[];
  /** 只给「这次没出成」那张卡用：重跑上一句，不另开一个生成入口。 */
  retry(): void; stop(): void; resume(): void; regenerate(label?: string): void;
  /** 智能理解瞬态失败的重试卡；null = 不显示。 */
  modelFailure: {text:string;retry:()=>void} | null; dismissModelFailure(): void;
  /** 还没确认的那版布置；null = 没有待确认的提案。只在预览已落稳（proposed）时给出。 */
  proposal: ProposalView | null; confirmProposal(): void; withdrawProposal(): void;
  inventoryWorkspace: ReactNode; inventoryBlocked: boolean; inventoryInvalid: boolean;
  /** 左栏简报的空地文字链：不用先开物料库，一键立 12×8 空壳。 */
  startBlankVenue(): void;
  /** 左轨常驻的地图入口：场地立起来也进得来，返回 null = 场地已换成圈画这块，否则是挡路的原因。 */
  mapPickerOpen: boolean;
  startMapVenuePicker(): void;
  closeMapVenuePicker(): void;
  /** V-1b 场地回显确认卡状态：null=没有待确认的场地意图。 */
  venuePick: { query: string; candidates: PlaceSuggestion[]; loading: boolean; picking: string | null } | null;
  /** V-1c 锚定链：POI 轮廓 → 行政区 → 起步矩形兜底，走 applyMapVenuePick 落壳。 */
  handleVenuePick(place: PlaceSuggestion): void;
  dismissVenuePick(): void;
  /** V-2d 流线提案（预览态）：虚线画在画布上，确认才 applyRoutes 写入（可撤销）。 */
  routeProposal: RouteProposal | null;
  routeBusy: boolean;
  proposeRoutePlan(): void;
  confirmRouteProposal(): void;
  dismissRouteProposal(): void;
  /** V-3 区域提案（预览态）：虚线分区+物料幽灵，确认才 applyZoneProposal 写入（可撤销）。 */
  zoneProposal: ZoneEventProposal | null;
  zoneBusy: boolean;
  proposeZonePlan(): void;
  confirmZoneProposal(): void;
  dismissZoneProposal(): void;
  /** V-4a 子出入口提案：复用 routeProposal 通道（驳线+子口走同一确认卡/applyRoutes）。 */
  proposeSubEntrances(): void;
  /** V-4b 流动模拟开关：开=画布 66ms 步进行人动画（纯视图，不写 plan）。 */
  flowSimActive: boolean;
  startFlowSim(): void;
  stopFlowSim(): void;
  /** 户外画布桥（overlay 注册）：应用流线/区域走 commitPlan、读 plan 取锚点/边界。 */
  registerRouteBridge(bridge: { applyVenue(anchor: NonNullable<SitePlanData['anchor']>, boundary: SitePlanData['boundary']): boolean; beginVenueBoundary(anchor: NonNullable<SitePlanData['anchor']>): boolean; inspectFacility?(id: string): boolean; cancelVenueBoundary?(): void; previewVenuePoint?(place: PlaceSuggestion): void; clearVenuePreview?(): void; applyRoutes(routes: PlanRoute[], nodes: PlanNode[]): boolean; applyZoneProposal(zones: PlanZone[], facilities: PlanFacility[], routes?: PlanRoute[], nodes?: PlanNode[]): boolean; getPlan(): SitePlanData | null } | null): void;
  /** 「换场地 / 新建」弹层：空白场地、我的云项目、新建项目同一个入口。 */
  venuePickerOpen: boolean;
  startVenuePicker(): void;
  closeVenuePicker(): void;
  /** 「按风格配一套」：从库挪到 Bingo 的成套放样入口。 */
  stylePickerOpen: boolean;
  startStylePicker(): void;
  closeStylePicker(): void;
  placeStyleBundle(bundle: StyleBundle): void;
  applyMapVenuePick(pick: { name: string; location: string; polygon: { lng: number; lat: number }[]; flow?: { lng: number; lat: number }[]; satelliteGround?: boolean; satelliteGroundImage?: string }): string | null;
  /** 云端还在写这一版：忙的时候不亮确认。 */
  cloudBusy: boolean;
  /** 上一版云任务还在恢复：最后一帧没稳，不亮确认。 */
  recovering: boolean;
  /** 云端预览已过期或基线变了：不亮确认。 */
  cloudStale: boolean;
  /** 座位不够时的一点击改法：按同一份需求补座重排，仍然只出预览。 */
  addSeats(): void;
  /** T-UI §4-5：导出预览卡。确认前只是卡，点「确认导出」才触发既有导出。 */
  exportPreview: boolean; previewExport(): void; confirmExport(): void; confirmCloudMaterialDraft(): void; dismissExport(): void;
  /** S2-1：几何体检按钮直达（此前唯一入口是口令）。 */
  reviewNow(): void;
  /** S2-2：一键生成钉评链接，气泡回链。离线导出降级为分享菜单次选项。 */
  issueReviewLink(): void;
  acceptFile(file: File): void; retryFile(): void; pickFile(): void;
  /** 选进来、还没发出去的图纸/照片：挂在输入框上，点发送才读进场地。 */
  pendingFile: { name: string; url: string } | null;
  removePendingFile(): void;
  send(text: string): void; rainOn: boolean; previewRain(): void; walkthrough(): void;
  /** 面板自己也要能回话（场景库对话直接把结果说进这场会话），所以把说话口开放出来。 */
  say(bubble: Omit<Bubble, 'id'>): void;
}

const AgentContext = createContext<AgentValue | null>(null);
export function useAgent(): AgentValue { const value = useContext(AgentContext); if (!value) throw new Error('Agent panel unavailable'); return value; }
/** 面板可能单独渲染（测试、工作台抽屉）：没有 Agent 上下文时返回 null，不炸。 */
export function useAgentOptional(): AgentValue | null { return useContext(AgentContext); }

function hasInvalidRetainedZones(layout:RoomLayout):boolean {
  return layout.floors.some(floor=>(floor.zones??[]).some(zone=>
    ![zone.x,zone.z,zone.w,zone.d,layout.width,layout.height].every(Number.isFinite)||zone.w<=0||zone.d<=0||layout.width<=0||layout.height<=0||
    zone.x < -layout.width/2 || zone.z < -layout.height/2 || zone.x+zone.w > layout.width/2 || zone.z+zone.d > layout.height/2));
}
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const wait = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
// Keep unsaved requirements in memory per activity when a write guard prevents persistence.
const volatileSessionMemories = new Map<string, Map<string, BriefMemory>>();
const volatileComposerDrafts = new Map<string, string>();
/** Read-only copy of unsent text in this activity; never clears the live composer. */
export function readonlyComposerDrafts(scope:string):{sessionId:string|null;text:string}[] {
  const result:{sessionId:string|null;text:string}[]=[];
  for(const [key,text] of volatileComposerDrafts){try{const value:unknown=JSON.parse(key);if(Array.isArray(value)&&value[0]===scope&&typeof text==='string'&&text.length)
    result.push({sessionId:typeof value[1]==='string'?value[1]:null,text});}catch{/* unrelated invalid keys are not exported */}}
  return result;
}
export function resetVolatileAssistantMemoriesForTests(): void { volatileSessionMemories.clear(); volatileComposerDrafts.clear(); }
function volatileMemoriesFor(scope: string): Map<string, BriefMemory> {
  let values=volatileSessionMemories.get(scope);
  if(!values){values=new Map();volatileSessionMemories.set(scope,values);}
  return values;
}
/** No recorded brief and no dialogue yet: there is no prior plan for the history gate to protect. */
function layoutMemoryIsBlank(memory: BriefMemory): boolean {
  return memory.headcount === null && memory.event === null && memory.lengthM === null && memory.widthM === null && memory.areaM2 === null
    && memory.layoutModeConfirmed !== true && !memory.layoutModeUnresolved && memory.pendingActivityNeeds.length === 0 && memory.unresolvedActivityNeeds.length === 0
    && !(memory.pendingBasicFacts?.length) && !(memory.reportedInventory?.length) && !memory.pendingGeneration;
}

export function LayoutAgentProvider({ pendingCandidates, sessionScope = 'legacy', isSessionCurrent, confirmVenueSource, callbacks, onVenueIOChange, onPreview, onApply, onApplyResearchArea, onApplyZoneRects, onBriefMemoryChange, onDialogueTurnStart, onDialogueIncompleteChange, onDialogueHistoryReview, assertSessionWrite, zoneDraftRevision = 0, getPlanAnnotationSnapshot, getUserRouteProvenance, handoffExportRequest = 0, children }: { pendingCandidates?:PendingCandidateAccess|undefined; sessionScope?: string; isSessionCurrent?: (() => boolean) | undefined; confirmVenueSource?: ((scope: string) => Promise<{status:'observed';scope:string;digest:string}|{status:'unknown'}>) | undefined; callbacks: LayoutAgentCallbacks; onVenueIOChange?(value: VenueIO): void; onPreview(candidate: RoomLayout | null): void; onApply(next: RoomLayout, options?: { expectedBase?: RoomLayout; preserveProvenance?: boolean; expectedFloor?: FloorSessionToken }): void; onApplyResearchArea?(area: NonNullable<RoomLayout['researchArea']>): void; onBriefMemoryChange?(memory: BriefMemory,sessionId:string|null): void; onDialogueTurnStart?: (()=>()=>void)|undefined; onDialogueIncompleteChange?: ((sessionId:string|null,incomplete:boolean)=>void)|undefined; onDialogueHistoryReview?: ((sessionId:string)=>boolean)|undefined; assertSessionWrite?: (() => void) | undefined; zoneDraftRevision?: number; getPlanAnnotationSnapshot?: (()=>{draft:LayoutPlanDraft|null;revision:number}) | undefined; getUserRouteProvenance?: ((annotationId:string)=>UserRouteProvenance|null) | undefined; /** 「回好自动落区」：把提议的 zoneType 列表直接落到 2D 草案，返回拼好的中文标签串（如「签到区、休息区」）；null = 没接上。 */ onApplyZoneRects?(zones: readonly ZoneSemanticType[]): string | null; /** 分享菜单「导出交接」递增此值，打开既有确认卡，不切执行模式。 */ handoffExportRequest?: number; children: ReactNode }): JSX.Element {
  const { layout, activeFloor, activeFloorIndex, actions, view, setView, collidingIds } = useRoomEditor();
  const studio = useStudioAgent();
  const venueFacts = useVenueFactTracker(layoutStore);
  const sessionCurrentRef = useRef(isSessionCurrent); sessionCurrentRef.current = isSessionCurrent;
  const sessionGuardRef = useRef(assertSessionWrite);
  const sessionGuardRequired = useRef(!!assertSessionWrite);
  if (assertSessionWrite) sessionGuardRequired.current = true;
  sessionGuardRef.current = assertSessionWrite;
  const requireSessionWrite = useCallback(() => {
    if (sessionCurrentRef.current && !sessionCurrentRef.current()) throw new Error('活动会话已切换。');
    if (sessionGuardRef.current) sessionGuardRef.current();
    else if (sessionGuardRequired.current) throw new Error('本机写入凭证已失效。');
  }, []);
  const [sessionSaveFailed, setSessionSaveFailed] = useState(false);
  const assistantSessions = useAssistantSessions(requireSessionWrite, sessionScope);
  const confirmVenueSourceRef = useRef(confirmVenueSource); confirmVenueSourceRef.current = confirmVenueSource;
  const sourceAuthorityRequired = useRef(!!confirmVenueSource); if (confirmVenueSource) sourceAuthorityRequired.current = true;
  const sessionScopeIsCurrent = () => {
    try { if (sessionCurrentRef.current && !sessionCurrentRef.current()) return false; } catch { return false; }
    if (sessionScope === 'legacy') return true;
    const id = layoutStore.getState().layout.id;
    return sessionScope === (id ? `activity:${id}` : 'draft:unidentified');
  };
  // 确认/撤回都是异步云调用，回调里要读最新那一帧的预览状态，不能在闭包里快照。
  const studioRef = useRef(studio); studioRef.current = studio;
  const suppressCancelledCloudPreview=useRef(false);
  const lastStudioBusy=useRef(!!studio?.busy);
  useEffect(()=>{
    if(studio?.busy&&!lastStudioBusy.current)suppressCancelledCloudPreview.current=false;
    lastStudioBusy.current=!!studio?.busy;
  },[studio?.busy]);
  /** 这一次出方案是谁算的：撤回、停一下、换一版都按它分流。 */
  const lastSource = useRef<'local' | 'cloud'>('local');
  /** 云端确认是异步的：`applyPreview` 里清预览的时机不在我们 await 的那一帧，所以等预览变化再播报。 */
  const confirmPending = useRef(false);
  /** 同一份云预览只播报一次，避免表单生成和对话生成各说一遍。 */
  const announcedPreview = useRef<unknown>(null);
  const [venueIO, setVenueIO] = useState<VenueIO>('indoor');

  const [baseName, setBaseName] = useState<string | null>(null);
  const [issue, setIssue] = useState<FileIssue | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lengthText, setLengthRaw] = useState('');
  const [widthText, setWidthRaw] = useState('');
  const [dimsTouched, setDimsTouched] = useState(false);
  // 尺度从哪儿来（画布默认 / 人说过 / 人填的 / 面积折算 / 图纸估算）——决定壳体的置信度，
  // 也决定 Agent 能不能把米数当成事实说出来。
  const [scaleOrigin, setScaleOrigin] = useState<ScaleOrigin>('canvas');
  const planPixels = useRef<{ width: number; height: number } | null>(null);
  // 人嘴里说过的要素（人数/活动名/布置形态），本地模式下就是回放的唯一真相（云端仍走 studio.brief）。
  const [brief, setBrief] = useState<{ event: string | null; guests: number | null; layoutMode: LayoutMode }>({ event: null, guests: null, layoutMode: 'dining' });
  const [banquetChat, setBanquetChat] = useState(false);
  // 异步播报里要读最新那句的人数/活动名，不能读 setBrief 之前那一帧的闭包。
  const briefRef = useRef(brief); briefRef.current = brief;
  // 对话记忆（brief-agent）：人数/尺寸/形态跨句累积，解析失配不再退回开场白。
  const memoryRef = useRef<BriefMemory>(initialBriefMemory());
  const memoryRevision = useRef(0);
  /** 未明确时不擅自添加舞台或签到。 */
  const anchorsRef = useRef({ stage: false, checkin: false });
  const [phase, setPhase] = useState<'idle' | 'generating' | 'paused' | 'failed' | 'proposed' | 'ready' | 'edited'>('idle');
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  // V-1b（2026-11-13）：chat 认出场地意图后的回显确认卡——候选来自双源检索，
  // 点选才走锚定链（先回显再动手，「确认后才写进画布」纪律不破）。query 置空表示
  // 占位反问（'ask'），只回话不开卡。
  const [venuePick, setVenuePick] = useState<{
    epoch: number;
    query: string;
    candidates: PlaceSuggestion[];
    loading: boolean;
    picking: string | null;
  } | null>(null);
  const venuePickSeq = useRef(0);
  // V-2d：流线提案（预览态）——虚线画在画布上（overlay 经 context 读到），确认才写入（可撤销）。
  const [outdoorTask, setOutdoorTask] = useState<OutdoorTaskProgress | null>(null);
  const manualVenueAnchorRef = useRef<SitePlanData['anchor']>(undefined);
  const outdoorRequestRef = useRef<AbortController | null>(null);
  const routeProposalBaseRef = useRef<string | null>(null);
  const zoneProposalBaseRef = useRef<string | null>(null);
  type OutdoorTaskKind = 'venue' | 'route' | 'zone' | 'model' | 'simulation';
  const outdoorEpochRef = useRef(0);
  const outdoorKindRef = useRef<OutdoorTaskKind | null>(null);
  const routeTicketRef = useRef<{ epoch: number; proposal: RouteProposal } | null>(null);
  const zoneTicketRef = useRef<{ epoch: number; proposal: ZoneEventProposal } | null>(null);
  const outdoorScopeRef = useRef(sessionScope);
  outdoorScopeRef.current = sessionScope;
  function beginOutdoorTask(kind: OutdoorTaskKind | null, keepVenue = false): number {
    const epoch = ++outdoorEpochRef.current;
    outdoorKindRef.current = kind;
    if (kind) setOutdoorTask(null);
    outdoorRequestRef.current?.abort(); outdoorRequestRef.current = null;
    venuePickSeq.current += 1;
    if (manualVenueAnchorRef.current) routeBridgeRef.current?.cancelVenueBoundary?.();
    manualVenueAnchorRef.current = undefined;
    if (!keepVenue) { setVenuePick(null); routeBridgeRef.current?.clearVenuePreview?.(); }
    routeTicketRef.current = null; zoneTicketRef.current = null;
    routeProposalBaseRef.current = null; zoneProposalBaseRef.current = null;
    setRouteProposal(null); setZoneProposal(null); setRouteBusy(false); setZoneBusy(false); setFlowSimActive(false);
    return epoch;
  }
  function currentOutdoorTask(epoch: number, kind: OutdoorTaskKind): boolean {
    return outdoorEpochRef.current === epoch && outdoorKindRef.current === kind && outdoorScopeRef.current === sessionScope;
  }
  function stopOutdoorTask() {
    beginOutdoorTask(null);
    setOutdoorTask(current => current ? { ...current, state: 'stopped', action: '本次操作已停止；已应用的规划保持不变。' } : null);
  }
  useEffect(() => () => { outdoorEpochRef.current += 1; outdoorRequestRef.current?.abort(); venuePickSeq.current += 1; }, []);
  useEffect(() => { stopOutdoorTask(); setOutdoorTask(null); }, [sessionScope]);
  const [routeProposal, setRouteProposal] = useState<RouteProposal | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const routeBridgeRef = useRef<{ applyVenue(anchor: NonNullable<SitePlanData['anchor']>, boundary: SitePlanData['boundary']): boolean; beginVenueBoundary(anchor: NonNullable<SitePlanData['anchor']>): boolean; inspectFacility?(id: string): boolean; cancelVenueBoundary?(): void; previewVenuePoint?(place: PlaceSuggestion): void; clearVenuePreview?(): void; applyRoutes(routes: PlanRoute[], nodes: PlanNode[]): boolean; applyZoneProposal(zones: PlanZone[], facilities: PlanFacility[], routes?: PlanRoute[], nodes?: PlanNode[]): boolean; getPlan(): SitePlanData | null } | null>(null);
  // V-3：区域提案（预览态）——虚线分区+物料幽灵，确认才写入（可撤销）。
  const [zoneProposal, setZoneProposal] = useState<ZoneEventProposal | null>(null);
  const [zoneBusy, setZoneBusy] = useState(false);
  // V-4b：流动模拟开关（动画在 canvas 内 ticker，这里只管开/关与回话）。
  const [flowSimActive, setFlowSimActive] = useState(false);
  const [progress, setProgress] = useState(0);
  // T-UI §4-5：导出预览卡只活在这里；确认前不触发任何下载。
  const [exportPreview, setExportPreview] = useState(false);
  // 提案只活在这里：layout 一个字节都不动，所以自动存档、撤销栈、别人的选中态都不受影响。
  const proposal = useRef<PlanProposal | null>(null);
  const proposalSessionRef=useRef<string|null>(null);
  function setLocalProposal(next:PlanProposal|null):void {
    const previous=proposal.current;
    if(next&&pendingCandidates&&!pendingCandidates.register('local',next))throw new Error('活动已变化，未保留旧方案预览。');
    if(!next&&previous)pendingCandidates?.clear('local',previous);
    proposal.current=next;
    proposalSessionRef.current=next?boundSessionId.current:null;
  }
  function withCurrentSeatingReview<T extends PlanProposal>(plan:T,previous:PlanProposal|null):T {
    const relevant=!!previous&&Object.hasOwn(previous,'seatingWitness')||memoryRef.current.layoutModeConfirmed===true&&memoryRef.current.layoutMode==='desk-chair';
    if(!relevant)return plan;
    const witness=previous?.seatingWitness??null;
    return Object.assign(plan,{seatingWitness:witness,seatingReview:reviewLocalSeatingWitness(witness,plan.layouts.at(-1))});
  }
  useEffect(()=>()=>{const current=proposal.current;if(current)pendingCandidates?.clear('local',current);},[pendingCandidates]);
  const localDraftOwner = useRef<{owner:NonNullable<typeof studio>['controller'];actor:string|null;sessionId:string|null;apiUrl:string|null;version:string;annotationRevision:number;annotationSignature:string;annotationReader:()=>{draft:LayoutPlanDraft|null;revision:number};routeReader:((id:string)=>UserRouteProvenance|null)|null;routeSignature:string} | null>(null);
  const annotationSnapshotRef=useRef(getPlanAnnotationSnapshot);annotationSnapshotRef.current=getPlanAnnotationSnapshot;
  const routeProvenanceRef=useRef(getUserRouteProvenance);routeProvenanceRef.current=getUserRouteProvenance;
  const inventoryInput=useRef<{owner:object;scope:string;sessionId:string|null;sequence:number;floorIndex:number;revision:number;candidate:RoomLayout;value:CandidateInventory|undefined}|null>(null);
  const inventoryOwner=useRef<{owner:object|null;serial:number}>({owner:null,serial:0});
  const [,setInventoryRevision]=useState(0);
  const proposalBase = useRef<RoomLayout | null>(null);
  const proposalFloor = useRef<FloorSessionToken|null>(null);
  const floorSession=useFloorSessionTracker(layoutStore);
  function captureFloor(index:number):FloorSessionToken|null {const token=floorSession.capture();return token?.floorIndex===index&&floorSession.isCurrent(token)?token:null;}
  function floorStillCurrent(value:FloorSessionToken|null):boolean {return floorSession.isCurrent(value);}
  function checkProposalFloor():boolean {if(floorStillCurrent(proposalFloor.current))return true;say({role:'agent',amber:true,text:'当前楼层已经切换，这版候选暂保留，请回原楼层重新生成并核对。'});return false;}
  const styleProposal = useRef<{ key: string; memoryRevision: number; draftRevision: number; floorIndex: number; sessionId: string | null } | null>(null);
  const shownSteps = useRef(0);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const bubblesRef = useRef<Bubble[]>([]);
  bubblesRef.current = bubbles;
  /** 当前气泡所绑定的方案会话；切场时先把旧场正文落盘再换。 */
  const boundSessionId = useRef<string | null>(null);
  const sessionMemories = useRef(volatileMemoriesFor(sessionScope));
  const briefTurnSequence = useRef(0);
  const briefTurnTail = useRef<Promise<void>>(Promise.resolve());
  const generationWait = useRef<{promise:Promise<void>;cancel:()=>void}|null>(null);
  const generationFollowups = useRef<Promise<void>>(Promise.resolve());
  const [generationQueued,setGenerationQueued] = useState(0);
  const generationQueuedRef = useRef(0);
  const sendLatest = useRef<(text:string,allowUncertainRetry?:boolean,queued?:boolean,attachment?:{file:File;url:string}|null,history?:Array<{role:'user'|'assistant';text:string}>)=>Promise<void>>(async()=>{});
  const briefRequest = useRef<{controller:AbortController;text:string}|null>(null);
  const researchRequest = useRef<AbortController | null>(null);
  const uncertainInputs = useRef(new Set<string>());
  const pendingModelInputs = useRef(new Set<string>());
  const [understanding,setUnderstanding]=useState(false);
  const [briefBusy,setBriefBusy]=useState(false);
  const [toolPending,setToolPending]=useState(false);
  const [processFailed,setProcessFailed]=useState<ProcessFailure|null>(null);
  const layoutAttempt=useRef(false);
  const cloudAttempt=useRef(false);
  const previewUtterance=useRef<string|null>(null);
  const [cancelledInput,setCancelledInput]=useState<{id:number;text:string}|null>(null);
  const [retryUncertain,setRetryUncertain]=useState<string|null>(null);
  // 模型瞬态失败的可重试提示卡：文案 + 重试回调。
  const [modelFailure,setModelFailure]=useState<{text:string;retry:()=>void}|null>(null);
  const dialogueTurnStartRef=useRef(onDialogueTurnStart);dialogueTurnStartRef.current=onDialogueTurnStart;
  const dialogueIncompleteRef=useRef(onDialogueIncompleteChange);dialogueIncompleteRef.current=onDialogueIncompleteChange;
  const incompleteDialogueTurns=useRef(new Map<string,Set<string>>());
  const [unresolvedDialogue,setUnresolvedDialogue]=useState<readonly string[]>([]);
  const [,setReviewedHistorySession]=useState<string|null>(null);
  const reviewedHistorySessionRef=useRef<string|null>(null);
  const setReviewedHistory=(id:string|null)=>{reviewedHistorySessionRef.current=id;setReviewedHistorySession(id);};
  const freshSessionProof=useRef<string|null>(null);
  const isHistoryReviewRequired=()=>!!onDialogueHistoryReview && (!boundSessionId.current||getActiveAssistantSessionId(sessionScope)!==boundSessionId.current||reviewedHistorySessionRef.current!==boundSessionId.current);
  const historyReviewRequired=isHistoryReviewRequired();
  function acceptFreshSession(id:string):void {
    if(sessionScopeIsCurrent()&&getActiveAssistantSessionId(sessionScope)===id&&!sessionMemories.current.has(id))freshSessionProof.current=id;
  }
  function reviewDialogueHistory():void {
    const id=boundSessionId.current;
    if(!id||!sessionScopeIsCurrent()||getActiveAssistantSessionId(sessionScope)!==id||(incompleteDialogueTurns.current.get(id)?.size??0)>0)return;
    if(studioRef.current?.recoverable||studioRef.current?.applyRecovery||studioRef.current?.reviewingApplyRecovery){say({role:'agent',amber:true,text:'请先查询原任务或核对已提交结果，保留原任务记录后再重新开始。'});return;}
    if(briefRequest.current||generationWait.current||generationQueuedRef.current||studioRef.current?.busy){say({role:'agent',amber:true,text:'当前任务仍在处理，请等待或取消后再重新开始。'});return;}
    if(studioRef.current&&!studioRef.current.discardPreviewForHistoryReview()){say({role:'agent',amber:true,text:'原任务记录或本机存储尚未核对，请先查询原任务或核对已提交结果；旧记录已保留。'});return;}
    runToken.current++;briefTurnSequence.current++;pendingCandidates?.invalidate();dropProposal();
    if(!onDialogueHistoryReview?.(id)){say({role:'agent',amber:true,text:'当前活动或会话正在变化，请稍后重新核对。'});return;}
    setReviewedHistory(id);phaseRef.current='idle';setPhase('idle');setProgress(0);
    say({role:'agent',text:'已按当前记录重新开始；旧预览已收回，请重新生成并核对方案。'});
  }
  /** 导出对话交接前的静默核对：与「按当前记录重新开始」同一套判定，只是不出声、不重置进度。 */
  function freezeDialogueForExport(): boolean {
    const id = boundSessionId.current;
    if (!id || !sessionScopeIsCurrent() || getActiveAssistantSessionId(sessionScope) !== id || (incompleteDialogueTurns.current.get(id)?.size ?? 0) > 0) return false;
    if (studioRef.current?.recoverable || studioRef.current?.applyRecovery || studioRef.current?.reviewingApplyRecovery) return false;
    if (briefRequest.current || generationWait.current || generationQueuedRef.current || studioRef.current?.busy) return false;
    if (studioRef.current && !studioRef.current.discardPreviewForHistoryReview()) return false;
    if (!onDialogueHistoryReview?.(id)) return false;
    setReviewedHistory(id);
    return true;
  }
  const updateDialogueIncomplete=(sessionId:string|null,text:string,incomplete:boolean,provenUnhandled=false)=>{
    const value=text.trim();if(!sessionId||!value||(incomplete&&!provenUnhandled&&isGeneralActivityQuestion(value)))return;
    const entries=incompleteDialogueTurns.current.get(sessionId)??new Set<string>(),was=entries.size>0;
    if(incomplete)entries.add(value);else entries.delete(value);
    if(entries.size)incompleteDialogueTurns.current.set(sessionId,entries);else incompleteDialogueTurns.current.delete(sessionId);
    if(boundSessionId.current===sessionId)setUnresolvedDialogue([...entries]);
    if(was!==(entries.size>0))dialogueIncompleteRef.current?.(sessionId,entries.size>0);
  };
  const withdrawUnresolvedDialogue=(text:string)=>{
    const id=boundSessionId.current;
    if(!id||!sessionScopeIsCurrent()||getActiveAssistantSessionId(sessionScope)!==id||!incompleteDialogueTurns.current.get(id)?.has(text))return;
    updateDialogueIncomplete(id,text,false);
    say({role:'agent',text:'已撤回这项尚未处理的要求。其他要求仍然保留；如需方案，请重新生成并核对。'});
  };
  const withdrawAllUnresolved=()=>{
    const id=boundSessionId.current;
    if(!id||!sessionScopeIsCurrent()||getActiveAssistantSessionId(sessionScope)!==id)return;
    const items=[...(incompleteDialogueTurns.current.get(id)??[])];
    for(const text of items)updateDialogueIncomplete(id,text,false);
    if(items.length)say({role:'agent',text:'已撤回这些尚未处理的要求。如需方案，请重新生成并核对。'});
  };
  function clearFulfilledChip(text:string|null):void {
    const id=boundSessionId.current,value=text?.trim()??'';
    if(!id)return;
    const current=[...(incompleteDialogueTurns.current.get(id)??[])];
    const next=chipsAfterLayoutPreview(current,value?[value]:[]);
    for(const gone of current) if(!next.includes(gone)) updateDialogueIncomplete(id,gone,false);
  }
  /** 确认轮次落地后，队列里以答复词开头的旧条目已被这轮消化，一并移除，不再挡「确认布置」。 */
  function sweepFulfilledConfirmationChips():void {
    const id=boundSessionId.current;
    if(!id)return;
    for(const text of [...(incompleteDialogueTurns.current.get(id)??[])]){
      if(splitConfirmationLead(text))updateDialogueIncomplete(id,text,false);
    }
  }
  function beginLayoutAttempt(text:string,cloud:boolean):void {
    const value=text.trim();
    if(value)previewUtterance.current=value;
    cloudAttempt.current=cloud;
    layoutAttempt.current=true;
    setToolPending(cloud);
    setProcessFailed(null);
  }
  function finishLayoutAttempt(ok:boolean):void {
    if(!layoutAttempt.current)return;
    layoutAttempt.current=false;
    const cloud=cloudAttempt.current;
    setToolPending(false);
    if(ok){setProcessFailed(null);clearFulfilledChip(previewUtterance.current);}
    else setProcessFailed(cloud?'cloud_tool':'preview');
  }
  useEffect(()=>{
    if(phase==='failed')finishLayoutAttempt(false);
    if(phase==='proposed'||phase==='ready')finishLayoutAttempt(true);
  },[phase]);
  function markUnresolvedModification(text:string):void {
    updateDialogueIncomplete(boundSessionId.current,text,true);
    if(phaseRef.current==='proposed'||phaseRef.current==='paused'||studioRef.current?.preview){
      dropProposal();discardCloudPreview();phaseRef.current='idle';setPhase('idle');setProgress(0);
    }
  }
  const dialogueTurnReleases=useRef(new Map<()=>void,{sessionId:string|null;text:string}>());
  useEffect(()=>()=>{for(const [release,pending] of [...dialogueTurnReleases.current]){updateDialogueIncomplete(pending.sessionId,pending.text,true);release();}},[]);
  function cancelUnderstanding():void {
    const request=briefRequest.current;if(!request)return;
    updateDialogueIncomplete(boundSessionId.current,request.text,true);
    uncertainInputs.current.add(request.text);request.controller.abort();
    setCancelledInput({id:Date.now(),text:request.text});
    say({role:'agent',amber:true,text:'已停止等待，本次需求未写入。服务商可能仍在处理或计费；再次发送前请确认。'});
  }
  useEffect(() => () => { briefTurnSequence.current++; runToken.current++; generationWait.current?.cancel();briefRequest.current?.controller.abort();researchRequest.current?.abort(); resetAgentRun(); }, []);
  const briefFallbackNotified = useRef(false);
  const touchActiveSessionRef = useRef(assistantSessions.touchActiveSession);
  touchActiveSessionRef.current = assistantSessions.touchActiveSession;
  const lastFile = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  /** 选进来、还没发出去的图纸/照片：先摆在输入框里，等一句需求再一起发。 */
  const [pendingFile, setPendingFile] = useState<{ file: File; url: string } | null>(null);
  const runToken = useRef(0);
  const seed = useRef(1);
  const colliding = useRef(collidingIds); colliding.current = collidingIds;
  const live = useRef(layout); live.current = layout;
  const floorIndexRef = useRef(activeFloorIndex); floorIndexRef.current = activeFloorIndex;
  const zoneDraftRevisionRef = useRef(zoneDraftRevision); zoneDraftRevisionRef.current = zoneDraftRevision;
  const dragDepth = useRef(0);

  const lengthCheck = checkDim(lengthText, '长度');
  const widthCheck = checkDim(widthText, '宽度');
  const dimsInvalid = (!lengthCheck.ok && !lengthCheck.empty) || (!widthCheck.ok && !widthCheck.empty);
  const hasBase = baseName !== null;

  const persistBubbles = useCallback((sessionId: string | null, next: readonly Bubble[]) => {
    if (!sessionId || !sessionScopeIsCurrent()) return;
    const written = writeSessionBubbles(getAssistantSessionBodies(sessionScope), sessionId, toStoredBubbles(next));
    if (!replaceAssistantSessionBodies(written, requireSessionWrite, sessionScope)) setSessionSaveFailed(true);
  }, [requireSessionWrite, sessionScope]);

  const say = useCallback((bubble: Omit<Bubble, 'id'>) => {
    if (!sessionScopeIsCurrent()) return;
    // S4 A 档：副作用从 setBubbles updater 体内剥出到 say 函数体，避免渲染期双跑落盘/emit。
    const text = foldConflictBubble(bubble.text);
    const prev = bubblesRef.current;
    const last = prev.at(-1);
    // One click was posting the same overlap refusal twice. A second identical refusal stays one bubble.
    if (last?.role === 'agent' && last.text === text && text.includes('件没写上')) return;
    const next = [...prev.slice(-30), { id: uid(), ...bubble, text }];
    bubblesRef.current = next;
    setBubbles(next);
    persistBubbles(boundSessionId.current, next);
    touchActiveSessionRef.current();
  }, [persistBubbles]);

  useEffect(()=>subscribeActiveAssistantSession(sessionScope,(nextId)=>{
    if(onDialogueHistoryReview&&nextId!==boundSessionId.current){setReviewedHistory(null);freshSessionProof.current=null;}
    pendingCandidates?.invalidate();
    briefTurnSequence.current++;runToken.current++;
    researchRequest.current?.abort();
    if (nextId !== boundSessionId.current) { stopOutdoorTask(); setOutdoorTask(null); }
    if(nextId!==boundSessionId.current&&proposal.current){hidePreview();phaseRef.current='idle';setPhase('idle');setProgress(0);}
    if(generationWait.current||localDraftOwner.current){suppressCancelledCloudPreview.current=true;generationWait.current?.cancel();dropProposal();phaseRef.current='idle';setPhase('idle');setProgress(0);}
  }),[sessionScope,pendingCandidates]);
  useEffect(()=>{
    const controller=studioRef.current?.controller;
    if(!controller?.getSnapshot||!controller.subscribe)return;
    let actor=controller.getSnapshot().user?.id??null;
    return controller.subscribe(()=>{
      const next=controller.getSnapshot().user?.id??null;if(next===actor)return;actor=next;
      pendingCandidates?.invalidate();
      briefTurnSequence.current++;runToken.current++;
      researchRequest.current?.abort();
      if(generationWait.current||localDraftOwner.current){suppressCancelledCloudPreview.current=true;generationWait.current?.cancel();dropProposal();phaseRef.current='idle';setPhase('idle');setProgress(0);}
      if(briefRequest.current){updateDialogueIncomplete(boundSessionId.current,briefRequest.current.text,true);uncertainInputs.current.add(briefRequest.current.text);briefRequest.current.controller.abort();}
    });
  },[studio?.controller,pendingCandidates]);

  function saveMemory(memory: BriefMemory): boolean {
    if (!sessionScopeIsCurrent()) return false;
    if (JSON.stringify({ ...memoryRef.current, askedScale: false }) !== JSON.stringify({ ...memory, askedScale: false })) memoryRevision.current++;
    memoryRef.current = memory;
    onBriefMemoryChange?.(memory,boundSessionId.current);
    const id = boundSessionId.current;
    if (id) sessionMemories.current.set(id, memory);
    const saved = !!id && writeBriefMemory(id, memory, scopedAssistantStorage(sessionScope), requireSessionWrite);
    if (id && !saved) say({ role: 'agent', amber: true, text: '这次需求暂时无法保存在本机，当前输入保留在页面中，请先备份。' });
    return saved;
  }

  // 点历史 / 新开会话：换 activeId 时把气泡切到对应正文；新场没有正文就是空对话。
  function grantEmptyLayoutReview(sessionId: string | null, dialogue: readonly { id: string }[], memory: BriefMemory): void {
    if (!sessionId || !onDialogueHistoryReview || reviewedHistorySessionRef.current === sessionId) return;
    if (dialogue.length || !layoutMemoryIsBlank(memory) || (incompleteDialogueTurns.current.get(sessionId)?.size ?? 0) > 0) return;
    const cloud = studioRef.current;
    if (cloud?.preview || cloud?.recoverable || cloud?.applyRecovery || cloud?.busy || cloud?.reviewingApplyRecovery) return;
    if (!sessionScopeIsCurrent() || getActiveAssistantSessionId(sessionScope) !== sessionId) return;
    // Nothing old to withdraw. A stored run marker still refuses, and the gate stays up.
    if (cloud && !cloud.discardPreviewForHistoryReview()) return;
    if (!onDialogueHistoryReview(sessionId)) return;
    setReviewedHistory(sessionId);
  }
  const studioReviewReady = !studio?.preview && !studio?.recoverable && !studio?.applyRecovery && !studio?.busy && !studio?.reviewingApplyRecovery;
  useEffect(() => {
    if (!assistantSessions.ready || !sessionScopeIsCurrent()) return;
    const nextId = assistantSessions.activeId;
    const prevId = boundSessionId.current;
    if (prevId === nextId) { grantEmptyLayoutReview(nextId, bubblesRef.current, memoryRef.current); return; }
    setReviewedHistory(null);
    briefTurnSequence.current += 1;
    if(briefRequest.current){updateDialogueIncomplete(prevId,briefRequest.current.text,true);uncertainInputs.current.add(briefRequest.current.text);briefRequest.current.controller.abort();say({role:'agent',amber:true,text:'切换会话后已停止等待；服务商可能仍在处理或计费。'});}
    setCancelledInput(null);setRetryUncertain(null);
    briefFallbackNotified.current = false;
    if (prevId && assistantSessionExists(prevId, sessionScope)) persistBubbles(prevId, bubblesRef.current);
    if (prevId && assistantSessionExists(prevId, sessionScope)) sessionMemories.current.set(prevId, {...memoryRef.current,pendingGeneration:undefined});
    boundSessionId.current = nextId;
    setUnresolvedDialogue(nextId?[...(incompleteDialogueTurns.current.get(nextId)??[])]:[]);
    const nextMemory = (nextId && (sessionMemories.current.get(nextId) ?? readBriefMemory(nextId, scopedAssistantStorage(sessionScope)))) || initialBriefMemory();
    memoryRef.current = nextMemory;
    onBriefMemoryChange?.(nextMemory,nextId);
    if(nextId&&freshSessionProof.current===nextId){
      freshSessionProof.current=null;
      // A fresh conversation must not inherit a previous conversation's cloud
      // candidate or discard an unknown run while granting its exemption.
      if((!studioRef.current||studioRef.current.discardPreviewForHistoryReview())&&onDialogueHistoryReview?.(nextId))setReviewedHistory(nextId);
    } else freshSessionProof.current=null;
    const nextBrief = { event: nextMemory.event, guests: nextMemory.headcount, layoutMode: nextMemory.layoutMode };
    briefRef.current = nextBrief;
    setBrief(nextBrief);
    setBanquetChat(isBanquetSession(nextMemory));
    anchorsRef.current = { stage: nextMemory.zoneNeeds.stage === true, checkin: nextMemory.zoneNeeds.checkin === true };
    const loaded = nextId
      ? fromStoredBubbles(readSessionBubbles(getAssistantSessionBodies(sessionScope), nextId))
      : [];
    bubblesRef.current = loaded;
    setBubbles(loaded);
    grantEmptyLayoutReview(nextId, loaded, nextMemory);
  }, [assistantSessions.ready, assistantSessions.activeId, persistBubbles, studioReviewReady]);

  /** 对话记忆 → 右栏回放与生成条件共用的那份真相（人数/活动名/布置形态）。 */
  function syncMemory(memory: BriefMemory): void {
    const next = { event: memory.event, guests: memory.headcount, layoutMode: memory.layoutMode };
    briefRef.current = next;
    setBrief(next);
    setBanquetChat(isBanquetSession(memory));
  }

  function factScaleBound(memory: BriefMemory): boolean {
    if (sessionScope === 'legacy' || (memory.lengthM === null && memory.widthM === null && memory.areaM2 === null)) return true;
    return venueFacts.isCurrent(memory.venueFactToken);
  }
  function sourceScaleBound(memory: BriefMemory): boolean {
    if (!sourceAuthorityRequired.current || (memory.lengthM === null && memory.widthM === null && memory.areaM2 === null)) return true;
    const rawScope=layoutStore.getState().layout.id;
    return !!confirmVenueSourceRef.current && !!rawScope && memory.venueSourceScope === rawScope && typeof memory.venueSourceDigest === 'string' && /^[0-9a-f]{64}$/i.test(memory.venueSourceDigest);
  }

  // A venue change invalidates the associated scale even before the next message.
  useEffect(() => {
    if (sessionScope === 'legacy' || !sessionScopeIsCurrent()) return;
    const old=memoryRef.current;
    if (old.scaleNeedsReconfirmation || (isVenueScaleCurrent(old,layout) && sourceScaleBound(old) && factScaleBound(old))) return;
    const previousVenueScale=old.previousVenueScale ?? {lengthM:old.lengthM,widthM:old.widthM,areaM2:old.areaM2};
    const stale={...old,lengthM:null,widthM:null,areaM2:null,scaleNeedsReconfirmation:true,previousVenueScale};
    saveMemory(stale);syncMemory(stale);setLengthRaw('');setWidthRaw('');setScaleOrigin('canvas');
    runToken.current++;
    if (proposal.current) { dropProposal(); setPhase('idle'); }
    const prior=previousVenueScale.lengthM !== null && previousVenueScale.widthM !== null ? `${formatArea(previousVenueScale.lengthM)} × ${formatArea(previousVenueScale.widthM)} 米` : previousVenueScale.areaM2 !== null ? `${formatArea(previousVenueScale.areaM2)} 平方米` : '未记录';
    say({role:'agent',amber:true,text:`场地已变化，旧场地记录为 ${prior}，不能自动沿用。请重新说明当前场地尺寸。`});
  }, [layout,sessionScope,venueFacts.token]);

  /**
   * 对话里说的人数/活动名也写进左栏「活动需求」：那边不再是生成入口，但还得能回看、保存。
   * 左右两边共用 HEADCOUNT_MAX；超出解析上限的数不会走到这里。
   */
  function syncStudioBrief(extraction: BriefExtraction): string | null {
    const apply = studioRef.current?.setBrief;
    if (!apply) return null;
    const guests = extraction.headcount;
    if (!extraction.event && guests === null) return null;
    const inRange = guests !== null && guests >= 1 && guests <= HEADCOUNT_MAX;
    apply(current => ({
      ...current,
      ...(extraction.event ? { event: extraction.event, eventConfirmed: true } : {}),
      ...(inRange && guests !== null ? { guests, guestsConfirmed: true } : {}),
    }));
    return guests !== null && !inRange ? `人数超出左栏范围（1–${HEADCOUNT_MAX}），这个数先留在右栏，左边没改。` : null;
  }

  /** 画布当前这一层的物料，按名字汇总：清单、文案都读同一份计数模型，不另存一份物料表。 */
  function floorRows(from: RoomLayout = live.current): { rows: Array<{ name: string; count: number }>; total: number; locked: number } {
    const index = Math.min(activeFloorIndex, Math.max(0, from.floors.length - 1));
    const floor = from.floors[index];
    if (!floor) return { rows: [], total: 0, locked: 0 };
    const summary = summarizeInventory(floorInventory(floor));
    const rows = summary.map(row => ({
      // 现有家具库的默认名是英文：对话里只换掉这两个默认名，人改过的名字原样念。
      name: row.name === 'Dining Chair' ? '椅子' : row.name === 'Dining Table' ? '桌子' : row.name,
      count: row.quantity,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    return {
      rows,
      total: summary.reduce((sum, row) => sum + row.quantity, 0),
      locked: summary.reduce((sum, row) => sum + row.lockedCount, 0),
    };
  }

  function copyText(text: string, done: string): void {
    const legacyCopy = (): boolean => {
      try {
        const area = document.createElement('textarea');
        area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch { return false; }
    };
    const succeed = () => say({ role: 'agent', text: done });
    const fail = () => say({ role: 'agent', amber: true, text: '剪贴板没写成，选中这段自己复制一下。' });
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) { if (legacyCopy()) succeed(); else fail(); return; }
    void clipboard.writeText(text).then(succeed).catch(() => { if (legacyCopy()) succeed(); else fail(); });
  }

  /** 清单和文案里的米数跟复盘卡同一条规矩：人给过尺度、或壳体立起来了才算数。 */
  function confirmedArea(): number | null {
    return venueUp || scaleOrigin === 'stated' || scaleOrigin === 'typed' ? venueArea(live.current) : null;
  }

  /** 「出物料清单」：直接读物料汇总，不另开一套表单；有一版本地预览时按预览版算。 */
  function replyMaterialList(): void {
    const pendingPlan = proposal.current;
    const cloudPending = !pendingPlan && !!studioRef.current?.preview;
    const source = pendingPlan ? pendingPlan.layouts[pendingPlan.layouts.length - 1]! : live.current;
    const { rows, total, locked } = floorRows(source);
    if (!total) {
      say({ role: 'agent', long: true, text: '画布上还没有物料，清单是空的。\n说一句「出方案」我先摆一版，或者说「加两把椅子」直接往上加。' });
      return;
    }
    const area = confirmedArea();
    const text = [
      `物料清单 · ${area === null ? '' : `${formatArea(area)} ㎡ · `}${pendingPlan ? '预览版 · ' : ''}${total} 件`,
      ...rows.map(row => `· ${row.name} ×${row.count}`),
      ...(locked ? [`锁定的 ${locked} 件也在上面。`] : []),
      ...(pendingPlan ? ['这版还在预览，清单按预览版算；点「确认布置」才写进画布。'] : []),
      ...(cloudPending ? ['云端这一版还没确认，这份清单只算画布上已有的物料。'] : []),
      '要 CSV 去左栏「执行资料」导出。',
    ].filter(Boolean).join('\n');
    say({ role: 'agent', long: true, text, action: { label: '复制清单', run: () => copyText(text, '清单复制好了。') } });
  }

  /** 「写段文案」：用已收集的活动名/人数/场地/物料起一份草稿，只在对话里，不写进任何资料。 */
  function replyDraft(): void {
    const event = briefRef.current.event ?? (studioRef.current?.brief.eventConfirmed === true ? studioRef.current.brief.event : null) ?? '这场活动';
    const guests = briefRef.current.guests ?? (studioRef.current?.brief.guestsConfirmed === true ? studioRef.current.brief.guests : null) ?? null;
    const pendingPlan = proposal.current;
    const source = pendingPlan ? pendingPlan.layouts[pendingPlan.layouts.length - 1]! : live.current;
    const { rows, total } = floorRows(source);
    const io = venueIO === 'indoor' ? '室内' : '户外';
    const area = confirmedArea();
    const materials = total
      ? `现场已经排了 ${total} 件物料：${rows.slice(0, 4).map(row => `${row.name} ×${row.count}`).join('、')}${rows.length > 4 ? ' 等' : ''}。`
      : '现场物料还在排，这一版先把场地留出来。';
    const text = [
      `【${event}】`,
      `${io}${area === null ? '，场地尺寸还没定' : ` ${formatArea(area)} ㎡`}${guests ? `，${guests} 人` : ''}。`,
      materials,
      '细节还在调，先把这一版发你看看。',
      '',
      `（草稿只在对话里${pendingPlan ? '，按预览版物料写' : ''}；没写进活动资料；要改哪句直接说。）`,
    ].join('\n');
    say({ role: 'agent', long: true, text, action: { label: '复制草稿', run: () => copyText(text, '草稿复制好了。') } });
  }

  /** 「换区」：画布没有分区这一层，也没有可点的换区入口；先说清楚，再给现在做得到的下一步。 */
  function replyZone(): void {
    say({ role: 'agent', long: true, text: '换区现在没有可点的控件：画布只有一整块场地，没有分区可切，按区域整组搬物料也还没有入口。\n要换布局就说「换一版」；单件位置在画布上直接拖。这条先记进暂留清单。' });
  }

  /**
   * 「看看哪里有问题」：只读画布几何，报挤/压墙柱/出界/挡门前留空/拉不开。
   * 这不是合规审查——没有消防、疏散、无障碍这些依据，也不下那种结论。
   */
  function reviewNow(): void {
    if (phaseRef.current === 'generating') { say({ role: 'agent', review: true, amber: true, text: '还在出这一版：等它出来，或先说「停一下」，我再体检。' }); return; }
    if (proposal.current || studioRef.current?.preview) { say({ role: 'agent', review: true, amber: true, text: '还有一版没确认：先点「确认布置」或「撤回」，我再按落盘后的画布体检。' }); return; }
    const report = reviewLayout(live.current, floorIndexRef.current);
    if (report.checked === 0) {
      say({ role: 'agent', review: true, long: true, text: '这一层还没有物料可看。先说一句「出方案」摆一版，或者说「加两把椅子」，我再体检。' });
      return;
    }
    const notes = report.notes.length ? `\n${report.notes.join('\n')}` : '';
    if (report.clean) {
      say({ role: 'agent', review: true, long: true, text: `检查了 ${report.checked} 件：本次未发现这些几何问题。检查只覆盖已建模物件，不代表现场安全或规范验收。${notes}` });
      return;
    }
    say({ role: 'agent', review: true, long: true, text: `我按画布几何看了一遍 ${report.checked} 件，找到 ${report.issues.length} 条：\n只报挤、压墙/柱、出界、挡门前留空和座椅拉不开，不是合规审查。${notes}` });
    const actionable = report.issues.filter(issue => !!issue.fix);
    for (const issue of actionable.slice(0, 3)) {
      say({ role: 'agent', review: true, text: `${issue.title}。${issue.detail}`, action: { label: `按这条改：${issue.fix!.label}`, run: () => applyReviewFix(issue) } });
    }
    const rest = actionable.length - Math.min(3, actionable.length);
    if (rest > 0) say({ role: 'agent', review: true, amber: true, text: `还有 ${rest} 条没展开：先把上面这几条改了，再说一句「看看哪里有问题」，我接着看。` });
  }

  /** S2-2：审校台「发送钉评链接」。生成 /review/#layout= 链接并由气泡回链，甲方钉评与回执沿既有 share-pins/review-return 回到审校台。 */
  const reviewLinkPending=useRef(false);
  async function issueReviewLink(): Promise<void> {
    if(reviewLinkPending.current)return;
    if (proposal.current || studioRef.current?.preview) { say({ role: 'agent', amber: true, text: '还有一版没确认：先点「确认布置」或「撤回」，链接要冻结落盘后的这一版。' }); return; }
    const floor=floorSession.capture(),start=layoutStore.getState();
    if(!sessionScopeIsCurrent()||!floorSession.isCurrent(floor)){say({role:'agent',review:true,amber:true,text:'活动或楼层正在切换，请重新准备评审链接。'});return;}
    let baseline:RoomLayout;try{baseline=structuredClone(start.layout);}catch{say({role:'agent',review:true,amber:true,text:'当前方案无法完整核对，未准备链接。'});return;}
    const stillCurrent=()=>{try{const now=layoutStore.getState();return sessionScopeIsCurrent()&&floorSession.isCurrent(floor)&&now.revision===start.revision&&sameRecoveryFormValue(now.layout,baseline);}catch{return false;}};
    reviewLinkPending.current=true;
    try {
      const result=await callbacks.onIssueReviewLink?.()??null;
      if(!sessionScopeIsCurrent())return;
      if(!result){say({role:'agent',review:true,amber:true,text:'评审链接未准备好，未复制；请核对本机评审记录。'});return;}
      if(typeof result==='string'||typeof result.url!=='string'||!result.url.trim()||!stillCurrent()||typeof result.isCurrent!=='function'||!result.isCurrent()){
        say({role:'agent',review:true,amber:true,text:'活动或方案已变化，或当前版本无法核对；旧评审记录如已写入会保留，链接未复制。'});return;
      }
      say({ role: 'agent', review: true, text: '评审链接已准备好。请在下方「本机评审记录」复制链接发给对方；对方的意见仅保存在对方浏览器，不会自动回到这里，请另行收集。' });
    } catch { if(sessionScopeIsCurrent())say({role:'agent',review:true,amber:true,text:'评审链接结果暂时无法核对；旧评审记录如已写入会保留，链接未复制。'}); }
    finally{reviewLinkPending.current=false;}
  }

  /**
   * 点一条改法：按现在这一帧重新体检，仍然成立才算候选；只铺预览，不写画布。
   * 算不出来、或者锁着没动，都如实说，不硬挪。
   */
  function applyReviewFix(issue: ReviewIssue): void {
    if (phaseRef.current === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：等它出来，或先说「停一下」，我再改。' }); return; }
    if (proposal.current || studioRef.current?.preview) { say({ role: 'agent', amber: true, text: '还有一版没确认：先点「确认布置」或「撤回」，我再试下一条。' }); return; }
    const base = live.current;
    const index = floorIndexRef.current;
    const floor=captureFloor(index);if(!floor){say({role:'agent',amber:true,text:'当前楼层已变化，请重新核对。'});return;}
    const freshReport = reviewLayout(base, index);
    const fresh = freshReport.issues.find(candidate => candidate.id === issue.id)
      ?? freshReport.issues.find(candidate => candidate.kind === issue.kind && candidate.itemIds.some(id => issue.itemIds.includes(id)));
    if (!fresh || !fresh.fix) { say({ role: 'agent', amber: true, text: '画布刚变过，这条现在不成立了。再说一句「看看哪里有问题」，我重新体检。' }); return; }
    const result = proposeReviewFix(base, index, fresh);
    if (!result) { say({ role: 'agent', amber: true, text: '这条我算不出稳妥改法，先不硬挪。自己拖一下，或把周围腾一点空间再试。' }); return; }
    if (result.moved === 0) {
      const why = skipCopy(result.skipped);
      const locked = result.skipped.some(skip => skip.reason === 'locked');
      say({ role: 'agent', amber: true, long: true, text: `这条没改成：${why || '附近找不到不压墙、不碰别的物料的落点'}。${locked ? '锁着的先解锁再试，或自己拖一下。' : '先自己拖一下，或把周围腾一点空间。'}` });
      return;
    }
    const resultFloor = result.layout.floors[Math.min(index, result.layout.floors.length - 1)];
    const byId = new Map((resultFloor?.items ?? []).map(item => [item.id, item] as const));
    const remainingOverlapIds = new Set(result.remaining.filter(item => item.kind === 'overlap').flatMap(item => item.itemIds));
    const plan: PlanProposal = {
      layouts: [base, result.layout],
      added: 0, removing: 0, keptLocked: 0, dropped: 0,
      overlapCount: remainingOverlapIds.size,
      overlapNames: [...remainingOverlapIds].map(id => byId.get(id)?.name).filter((name): name is string => !!name),
      blocked: null,
      guests: null, seats: 0,
      moved: result.moved,
      kind: 'review',
      skipped: [...new Set(result.skipped.map(skip => skip.name))],
    };
    proposalFloor.current=floor;setLocalProposal(withPlanArtifact(withCurrentSeatingReview(plan,null), base)); proposalBase.current = structuredClone(base);
    // 画布本来就是改之前的样子，省掉基线那一帧，直接看挪完的结果。
    shownSteps.current = 1;
    lastSource.current = 'local';
    const rest = result.remaining.length ? `（改完还剩 ${result.remaining.length} 条要处理）` : '';
    trackGeneration(presentProposal(++runToken.current, `按这条改：${fresh.fix.label}${rest}。`));
  }

  /** 风格套先构造完整候选，确认前不修改画布。 */
  function placeStyleBundleNow(bundle: StyleBundle): void {
    if (phase === 'generating') {
      say({ role: 'agent', amber: true, text: '还在出这一版：等它出来，或先说「停一下」，我再配一套。' });
      return;
    }
    if (proposal.current || studioRef.current?.preview) {
      say({ role: 'agent', amber: true, text: '还有一版没确认：先点「确认布置」或「撤回」，我再配一套。' });
      return;
    }
    const base = live.current;
    const floorIndex = floorIndexRef.current;
    const floorToken=captureFloor(floorIndex);if(!floorToken){say({role:'agent',amber:true,text:'当前楼层已变化，请重新核对。'});return;}
    const floor = base.floors[floorIndex];
    if (!floor) { say({ role: 'agent', amber: true, text: '当前楼层不可用，本次没有修改画布。' }); return; }
    const built = buildStyleBundleItems(bundle, { width: base.width, depth: base.height });
    if (!built.ok) { say({ role: 'agent', amber: true, text: built.message }); return; }
    if (materialCount(floor.items) + built.items.length > editorItemLimit(base)) {
      say({ role: 'agent', amber: true, text: '这一套超过当前物料数量上限，本次没有修改画布。' }); return;
    }
    const candidate: RoomLayout = { ...base, floors: base.floors.map((item, index) => index === floorIndex ? { ...item, items: [...item.items, ...built.items] } : item) };
    if (!canApplyLayoutGeometry(base, candidate)) { say({ role: 'agent', amber: true, text: '这一套与场地或现有物料冲突，本次没有修改画布。' }); return; }
    const checked = applyLayoutCommandWithRefusals(applyLayoutCommand({ layout: candidate }), { layout: base });
    const error = completeLayoutError(checked);
    if (error) { say({ role: 'agent', amber: true, text: `${error} 本次没有修改画布。` }); return; }
    const plan: PlanProposal = { layouts: [base, checked.nextLayout], added: built.items.length, removing: 0,
      keptLocked: floor.items.filter(item => item.locked && !isStructuralMarker(item)).length,
      dropped: 0, overlapCount: 0, overlapNames: [], blocked: null };
    proposalBase.current = structuredClone(base);proposalFloor.current=floorToken;
    setLocalProposal(withPlanArtifact(withCurrentSeatingReview(plan,null), base));
    styleProposal.current = { key: bundle.key, memoryRevision: memoryRevision.current, draftRevision: zoneDraftRevisionRef.current, floorIndex, sessionId: boundSessionId.current };
    shownSteps.current = 1;
    setStylePickerOpen(false);
    trackGeneration(presentProposal(++runToken.current, `「${bundle.name}」的候选：新增 ${built.items.length} 件，原有物件保留；`));
  }

  /**
   * 「加两把椅子」：只把点名的那几件放进空位，仍然只出候选、不写画布。
   * 已经有一版本地预览时，就接在这一版上继续加，不再让人先确认一遍。
   */
  function addMaterials(request: MaterialRequest): void {
    if (phaseRef.current === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：等它出来，或先说「停一下」，我再加物料。' }); return; }
    if (proposal.current === null && studioRef.current?.preview) {
      say({ role: 'agent', amber: true, text: '云端这一版还没确认：先点「确认布置」或「撤回」，我再往上加。' });
      return;
    }
    const pending = proposal.current;
    if(pending&&!checkProposalFloor())return;
    const floorToken=pending?proposalFloor.current:captureFloor(activeFloorIndex);
    if(!floorToken){say({role:'agent',amber:true,text:'当前楼层已变化，请重新核对。'});return;}
    const base = pending ? pending.layouts[pending.layouts.length - 1]! : live.current;
    let plan: AdditionProposal;
    try { plan = proposeAddition({ base, floorIndex: activeFloorIndex, requests: [request] }); }
    catch (error) {
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这版加不进去，先挪一下物料再试。' });
      return;
    }
    const placed = plan.accepted[0]?.placed ?? 0;
    if (!placed) {
      say({ role: 'agent', amber: true, text: `画布上没有能放下${request.name}的空位（${request.count} 件都没放下）。先收几件，或者说「换一版」留出空地，我再加。` });
      return;
    }
    if (!pending) {proposalBase.current = structuredClone(live.current);proposalFloor.current=floorToken;}
    setLocalProposal(withPlanArtifact(withCurrentSeatingReview(plan,pending), proposalBase.current ?? live.current));
    // 画布本来就是「加之前」的样子：省掉基线那一帧，直接看加上之后的结果。
    shownSteps.current = 1;
    const lead = placed < request.count
      ? `按你说的加 ${request.count} 件${request.name}，只放得下 ${placed} 件：`
      : pending ? `在这版上又加了${request.name}：` : `按你说的加了${request.name}：`;
    trackGeneration(presentProposal(++runToken.current, lead));
  }

  /**
   * `plan.revise` 的接缝：按 itemId/角色做增量修改，复用同一张预览卡；
   * 确认前不写画布，确认后仍是一次 applyLayout（撤销一步整步退回）。
   */
  function reviseMaterials(request: RevisionRequest): void {
    if (phaseRef.current === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：等它出来，或先说「停一下」，我再改。' }); return; }
    if (proposal.current === null && studioRef.current?.preview) {
      say({ role: 'agent', amber: true, text: '云端这一版还没确认：先点「确认布置」或「撤回」，我再改。' });
      return;
    }
    const pending = proposal.current;
    if(pending&&!checkProposalFloor())return;
    const floorToken=pending?proposalFloor.current:captureFloor(activeFloorIndex);
    if(!floorToken){say({role:'agent',amber:true,text:'当前楼层已变化，请重新核对。'});return;}
    const base = pending ? pending.layouts[pending.layouts.length - 1]! : live.current;
    let plan: RevisionProposal;
    const reviewSeating=!!pending&&Object.hasOwn(pending,'seatingWitness')||memoryRef.current.layoutModeConfirmed===true&&memoryRef.current.layoutMode==='desk-chair';
    pushLocalLayoutStep('revise', 'running');
    try { plan = revisePlan({ base, floorIndex: activeFloorIndex, ops: request.ops, bands: request.bands, ...(reviewSeating?{seatingWitness:pending?.seatingWitness??null}:{}) }); }
    catch (error) {
      pushLocalLayoutStep('revise', 'error', '这版改不动');
      finishLocalLayoutRun();
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这版改不动，先说一下场地长宽或挪开锁着的物件。' });
      return;
    }
    if (request.ops.length === 1 && request.ops[0]?.kind === 'move' && request.ops[0].delta && plan.applied) {
      const finalFloor = plan.layouts.at(-1)?.floors[activeFloorIndex];
      const beforeFloor = base.floors[activeFloorIndex];
      const requested = request.ops[0].delta;
      const matches = beforeFloor?.items.some(before => {
        const after = finalFloor?.items.find(item => item.id === before.id);
        return before.position && after?.position &&
          Math.abs(after.position.x - before.position.x - requested.x) < 1e-7 &&
          Math.abs(after.position.z - before.position.z - requested.z) < 1e-7;
      });
      if (!matches) { say({role:'agent',amber:true,text:'当前画布精度无法准确完成这个移动距离，请改用厘米整数或手动核对；本次没有修改画布。'}); return; }
    }
    if (request.ops.length === 1 && request.ops[0]?.kind === 'rotate' && plan.applied) {
      const finalFloor=plan.layouts.at(-1)?.floors[activeFloorIndex], beforeFloor=base.floors[activeFloorIndex];
      const radians=request.ops[0].deltaDeg*Math.PI/180;
      const matches=beforeFloor?.items.some(before=>{const after=finalFloor?.items.find(item=>item.id===before.id);
        return after && Math.abs((after.rotation??0)-(before.rotation??0)-radians)<1e-9;});
      if(!matches){say({role:'agent',amber:true,text:'当前画布精度无法准确完成这个旋转角度；请调整后重试，本次没有修改画布。'});return;}
    }
    if (!plan.applied) {
      pushLocalLayoutStep('revise', 'error', '这步没改成');
      finishLocalLayoutRun();
      say({ role: 'agent', amber: true, text: revisionRefusalText(plan.conflicts) });
      return;
    }
    pushLocalLayoutStep('revise', 'done');
    finishLocalLayoutRun();
    if (!pending) {proposalBase.current = structuredClone(live.current);proposalFloor.current=floorToken;}
    const scaleOnly = request.ops.length === 1 && request.ops[0]?.kind === 'scale' ? request.ops[0].factor : undefined;
    const rotationOnly = request.ops.length === 1 && request.ops[0]?.kind === 'rotate';
    const recolorOnly = request.ops.length === 1 && request.ops[0]?.kind === 'recolor';
    setLocalProposal(withPlanArtifact(Object.assign(plan,scaleOnly !== undefined ? {scaleFactor:scaleOnly} : rotationOnly ? {rotationOnly:true} : recolorOnly ? {recolorOnly:true} : {}), proposalBase.current ?? live.current));
    // 画布本来就是「改之前」的样子：省掉基线那一帧，直接看改完的结果。
    shownSteps.current = 1;
    const bits = [
      plan.moved ? `${scaleOnly !== undefined ? '缩放' : rotationOnly ? '旋转' : recolorOnly ? '改色' : '挪/转'} ${plan.moved} 件` : '',
      plan.added ? `加了 ${plan.added} 件` : '',
      plan.removing ? `删了 ${plan.removing} 件` : '',
    ].filter(Boolean);
    const miss = plan.conflicts.length ? `；${plan.conflicts.length} 处没落：${plan.conflicts.map(conflict => conflict.message).join('、')}` : '';
    trackGeneration(presentProposal(++runToken.current, `按你说的改了 ${bits.join('，')}${miss}，只动了这几件：`));
  }

  // 长宽只在生成时由壳体那一步写进场地。以前这里还会跟着输入框把 layout 改一遍，
  // 表单砍掉后没人再改它，留着只会在出方案途中再动一次画布，把刚出的预览判成「被改过」作废。

  useEffect(() => () => { runToken.current++; }, []);

  const state: AgentState = dragging ? 'dragHover'
    : phase === 'generating' ? 'generating' : phase === 'paused' ? 'generatePaused' : phase === 'failed' ? 'generateFailed'
    : phase === 'edited' ? 'planEdited' : phase === 'ready' ? 'planReady'
    : phase === 'proposed' ? 'planProposed'
    : hasBase && dimsTouched && dimsInvalid ? 'dimsInvalid'
    : issue ? (issue.kind === 'nonImage' ? 'nonImageRejected' : issue.kind === 'tooLarge' ? 'fileTooLarge' : issue.kind === 'readFailed' ? 'fileReadFailed' : 'fileUnsupported')
    : hasBase ? (lengthCheck.ok && widthCheck.ok ? 'baseReady' : 'baseNoDims') : 'empty';

  /** 把一句话解析出的要素铺到画布：场地类型、时段、长宽（面积按 4:3 折算）。 */
  const applyExtraction = useCallback((extraction: { venueIO: VenueIO | null; timeOfDay: number | null; lengthM: number | null; widthM: number | null; areaM2: number | null }) => {
    if (extraction.venueIO) {
      setVenueIO(extraction.venueIO);
      onVenueIOChange?.(extraction.venueIO);
      if (extraction.venueIO === 'indoor') setView(current => (current.weather === 'rain' ? { ...current, weather: 'clear' } : current));
    }
    if (extraction.timeOfDay !== null) setView(current => ({ ...current, timeOfDay: extraction.timeOfDay! }));
    if (extraction.lengthM !== null && extraction.widthM !== null) {
      setLengthRaw(String(extraction.lengthM)); setWidthRaw(String(extraction.widthM)); setDimsTouched(true);
      setScaleOrigin('stated');
    } else if (extraction.areaM2 !== null) {
      const dims = suggestDimsFromArea(extraction.areaM2);
      setLengthRaw(String(dims.length)); setWidthRaw(String(dims.width)); setDimsTouched(true);
      setScaleOrigin('area');
    }
  }, [onVenueIOChange, setView]);

  /** 说过/填过的数字合法才算确认过尺度；否则退回画布当前大小，别把空地当成场地真相。 */
  function readScale(): Scale {
    if (lengthCheck.ok && widthCheck.ok) return { length: lengthCheck.value, width: widthCheck.value, origin: scaleOrigin };
    return { length: live.current.width, width: live.current.height, origin: 'canvas' };
  }

  /**
   * 一句话里刚说的尺度要当场用上：setState 还没渲染，读 lengthCheck 会拿到旧值，
   * 所以「一句话 → 方案预览」这条路把解析结果直接算成尺度传给生成器。
   */
  function venueIsUp(layout: RoomLayout = live.current): boolean {
    const floor = layout.floors[Math.min(activeFloorIndex, Math.max(0, layout.floors.length - 1))];
    return layout.backendSceneV2 !== undefined || layout.backendVenue !== undefined || layout.scenePreset !== undefined || (floor?.interiorWalls?.length ?? 0) > 0;
  }

  function scaleFrom(extraction: BriefExtraction): Scale & { fromVenue: boolean } {
    return workingScale(extraction, { width: live.current.width, height: live.current.height, venueUp: venueIsUp() }, scaleOrigin);
  }

  /** 「按图纸估」：底图只当参照，折出来的长宽是估的，说完就按它出预览，说错了再讲一句新的。 */
  function estimateFromPlan(): Scale | null {
    const pixels = planPixels.current;
    if (!pixels) { say({ role: 'agent', amber: true, text: '还没拖图纸，我按不出比例。说一句「12×9」或「300 平米」，我就按它立场地。' }); return null; }
    // 人说过面积就用说的折，画布当前大小只在谁都没说过时兜底——否则「300 平米」白说了一场。
    const stated = memoryRef.current.areaM2;
    const dims = suggestDimsFromImageRatio(pixels.width, pixels.height, stated ?? live.current.width * live.current.height);
    setLengthRaw(String(dims.length)); setWidthRaw(String(dims.width)); setDimsTouched(true);
    setScaleOrigin('plan');
    say({ role: 'agent', text: `${stated !== null ? `按图纸比例和你说的 ${formatArea(stated)} ㎡` : '按图纸比例'}估的 ${formatArea(dims.length)} × ${formatArea(dims.width)} m，先按它出一版。这是估的：不对就再说一句长宽。` });
    return { length: dims.length, width: dims.width, origin: 'plan' };
  }

  /** 拖完图纸只想点一下就往下走：估尺寸和出预览是一件事，别再让人补一句话。 */
  function estimateAndGenerate(): void {
    const scale = estimateFromPlan();
    if (scale) runGeneration(null, seed.current, '图纸比例估的尺寸', scale);
  }

  /** 「调研西湖」：地名查坐标 → 参考底图铺进 3D（researchArea），同一张图作为气泡图片回进对话。 */
  async function runResearchCommand(query: string): Promise<void> {
    if (query === 'ask') {
      say({ role: 'agent', text: '调研哪一片？说个地名就行，比如「调研西湖」。' });
      return;
    }
    // Only the latest request can replace this activity's single reference map.
    researchRequest.current?.abort();
    if (!onApplyResearchArea) { say({role:'agent',amber:true,text:'当前工作台暂不支持应用调研底图。'}); return; }
    const researchSession = getActiveAssistantSessionId(sessionScope);
    const researchToken = runToken.current;
    say({ role: 'agent', text: `正在查「${query}」的位置…` });
    const controller = new AbortController();
    researchRequest.current = controller;
    const current = () => researchRequest.current === controller && researchToken === runToken.current && sessionScopeIsCurrent() && getActiveAssistantSessionId(sessionScope) === researchSession;
    let timeout: number | undefined;
    let removeAbortListener = () => {};
    let unsubscribeMap = () => {};
    try {
      // Track the venue identity/geometry as well as map placement, while the
      // shared venue basis excludes ordinary furniture. Compare the potentially
      // large floor-plan image separately rather than serializing it on every
      // store event. The monotonic flag catches A→B→A.
      const mapKey = (value: RoomLayout) => {
        const {floorPlanImage:_image,...withoutImage}=value;
        return JSON.stringify({venue:venueScaleBasis(withoutImage),researchArea:value.researchArea ?? null,sceneAnchor:value.sceneAnchor ?? null,
          mapGroundPolygon:value.mapGroundPolygon ?? null,mapLngLat:value.mapLngLat ?? null,mapGroundFrame:value.mapGroundFrame ?? null,
          satelliteGroundRef:value.satelliteGroundRef ?? null,floorPlanFitMode:value.floorPlanFitMode ?? null});
      };
      const initialLayout = layoutStore.getState().layout;
      const baseline = mapKey(initialLayout), baselineImage = initialLayout.floorPlanImage ?? null;
      let mapChanged = false;
      const matchesMap = (value: RoomLayout) => (value.floorPlanImage ?? null) === baselineImage && mapKey(value) === baseline;
      unsubscribeMap = layoutStore.subscribe(state => {
        try { if(!mapChanged && !matchesMap(state.layout))mapChanged = true; }
        catch { mapChanged = true; }
      });
      const mapCurrent = () => {
        try { return !mapChanged && matchesMap(layoutStore.getState().layout); }
        catch { return false; }
      };
      // Include script loading in the bound; its own timeout begins only after
      // the map SDK has loaded. A late response must never apply a map.
      const result = await Promise.race([
        lookupPlace(query, controller.signal).then(value => ({ kind: 'result' as const, value })),
        new Promise<{kind:'timeout'}>(resolve => { timeout = window.setTimeout(() => resolve({kind:'timeout'}), 12_000); }),
        new Promise<{kind:'cancelled'}>(resolve => {
          const cancelled=()=>resolve({kind:'cancelled'});
          if(controller.signal.aborted)cancelled();
          else { controller.signal.addEventListener('abort',cancelled,{once:true});removeAbortListener=()=>controller.signal.removeEventListener('abort',cancelled); }
        }),
      ]);
      if (!current()) return;
      if (result.kind === 'cancelled') return;
      if (result.kind === 'timeout') {
        controller.abort();
        say({role:'agent',amber:true,text:'调研查询超时，本次没有铺设底图；请稍后重试或手动选址。'});
        return;
      }
      const place = result.value;
      if (!place) {
        say({ role: 'agent', amber: true, text: `没查到「${query}」。换个更准的地名再试，或点「地图选址」手动圈一块。` });
        return;
      }
      if (!mapCurrent()) {
        say({role:'agent',amber:true,text:'场地、底图或场景锚点已变化，本次调研结果未覆盖当前选择；请重新调研。'});
        return;
      }
      const area = createResearchArea(place);
      // 落盘走专用路径，从 store 现取布局；不覆盖查询期间新选择的底图或锚点。
      try {
        requireSessionWrite();
        if (!current()) return;
        if (!mapCurrent()) {
          say({role:'agent',amber:true,text:'场地、底图或场景锚点已变化，本次调研结果未覆盖当前选择；请重新调研。'});
          return;
        }
        onApplyResearchArea(area);
      } catch { say({role:'agent',amber:true,text:'当前活动无法写入调研底图，请检查编辑权后重试。'}); return; }
      setView(current => ({ ...current, view2D: false }));
      say({
        role: 'agent',
        image: area.imageUrl,
        meta: '参考底图 · 不可作重建素材',
        text: `调研底图铺好了：${area.name}${area.address ? `（${area.address}）` : ''}。中心 ${area.center.lng.toFixed(5)}, ${area.center.lat.toFixed(5)}，半径 ${area.radiusM} m、约 ${area.widthM}×${area.depthM} m。3D 地面上那张图和这里贴的是同一张，可以直接在上面定点圈场地。`,
      });
    } catch {
      if (current()) say({role:'agent',amber:true,text:'调研查询暂时不可用，本次没有铺设底图；请稍后重试或手动选址。'});
      return;
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      removeAbortListener();
      unsubscribeMap();
      if(researchRequest.current === controller)researchRequest.current = null;
    }
  }

  // V-1b：场地候选检索（双源：本机高德+天地图 / 线上高德）。失败静默为空，
  // 卡片自己显示「没搜到」；seq 防旧请求的迟到结果覆盖新问题。
  useEffect(() => {
    if (!venuePick?.loading || !venuePick.query || outdoorKindRef.current !== 'venue') return;
    const epoch = venuePick.epoch;
    const seq = ++venuePickSeq.current;
    const query = venuePick.query;
    const controller = new AbortController();
    outdoorRequestRef.current?.abort(); outdoorRequestRef.current = controller;
    Promise.all([
      searchPlaces(query, { limit: 5, center: routeBridgeRef.current?.getPlan()?.anchor ?? null, signal: controller.signal }),
      fetchPlaceShapeHints(query, { signal: controller.signal }),
    ]).then(([places, hints]) => {
      const names = hintedOutlineNames(hints);
      for (const place of places) if (peekCachedPlaceShape(place.name, place)) names.add(normalizeOutlineName(place.name.split('|')[0] ?? ''));
      return buildPlaceSearchOptions({ query, areas: [], places, recent: [], outlinedNames: names }).flatMap(option => option.kind === 'place' ? [option.place] : []);
    })
      .then(candidates => {
        if (seq !== venuePickSeq.current || !currentOutdoorTask(epoch, 'venue') || controller.signal.aborted) return;
        setVenuePick(current => (current && current.query === query ? { ...current, candidates, loading: false } : current));
        setOutdoorTask({ intent: `在「${query}」做设计`, state: candidates.length ? 'confirm' : 'blocked', action: candidates.length ? '选择真实场地，确认后才锚定' : '没有候选，请补充城市或地址', steps: ['理解场地名', '检索候选地点'], prompts: candidates.length ? [] : [`在杭州${query}做设计`] });
      })
      .catch(() => {
        if (seq !== venuePickSeq.current || !currentOutdoorTask(epoch, 'venue') || controller.signal.aborted) return;
        setVenuePick(current => (current && current.query === query ? { ...current, candidates: [], loading: false } : current));
      });
  }, [venuePick?.loading, venuePick?.query, venuePick?.epoch]);

  // V-1c：真实面→行政区→原位手画。只写同一份 SitePlan，不虚构矩形或重建另一张场地。
  async function handleVenuePick(place: PlaceSuggestion): Promise<void> {
    if (!venuePick || venuePick.picking) return;
    const epoch = beginOutdoorTask('venue', true);
    routeBridgeRef.current?.previewVenuePoint?.(place);
    const pickSeq = ++venuePickSeq.current;
    const pickBase = JSON.stringify(routeBridgeRef.current?.getPlan());
    const controller = new AbortController();
    outdoorRequestRef.current?.abort(); outdoorRequestRef.current = controller;
    setOutdoorTask({ intent: `在「${place.name}」做设计`, state: 'working', action: '查询真实占地边界；未命中转手画', steps: ['理解场地名', '候选地点已确认'] });
    setVenuePick(current => (current ? { ...current, picking: place.name } : current));
    const near = { lng: place.lng, lat: place.lat };
    const spanMeters = (polygon: [number, number][]): number => {
      let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
      for (const [lng, lat] of polygon) {
        west = Math.min(west, lng); east = Math.max(east, lng);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
      return Math.max((east - west) * 85000, (north - south) * 111132);
    };
    let polygon: [number, number][] | null = null;
    let source = 'rect';
    try {
      const shape = await fetchPlaceShape(place.name, { near, signal: controller.signal });
      if (shape && isPersistablePlaceShape(shape) && spanMeters(shape.polygon) <= 9000) { polygon = shape.polygon; source = 'osm'; }
    } catch { /* 静默降级 */ }
    if (!polygon && !controller.signal.aborted) {
      try {
        const areas = await searchAreas(place.name, { near, signal: controller.signal });
        const area = areas.find(entry => entry.polygon.length >= 3);
        if (area && spanMeters(area.polygon) <= 9000) { polygon = area.polygon; source = 'area'; }
      } catch { /* 静默降级 */ }
    }
    if (!currentOutdoorTask(epoch, 'venue') || controller.signal.aborted || pickSeq !== venuePickSeq.current) return;
    const bridge = routeBridgeRef.current;
    if (pickBase !== JSON.stringify(bridge?.getPlan())) { setVenuePick(null); setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '查询期间规划发生变化，未更换场地，请重新确认', steps: [] }); return; }
    const anchor = { lng: place.lng, lat: place.lat, crs: 'gcj-02' as const, source: 'lookup' as const };
    const boundary = polygon ? trueFootprintBoundary(polygon.map(([lng, lat]) => ({ lng, lat })), anchor) : null;
    setVenuePick(null);
    if (!bridge) {
      setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '请先打开当前户外规划，未更改场地', steps: [] });
      say({ role: 'agent', amber: true, text: '请先打开「户外规划」，本次没有改动场地。' });
      return;
    }
    if (!boundary) {
      if (!bridge.beginVenueBoundary(anchor)) { setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '已有规划不能直接更换地理锚点，请先新建户外活动；当前内容保持不变', steps: [] }); return; }
      manualVenueAnchorRef.current = anchor;
      setOutdoorTask({ intent: `在「${place.name}」做设计`, state: 'blocked', action: '请在地图手画并闭合边界；未写入新场地', steps: ['候选地点已确认', '自动轮廓未命中，启用手画'] });
      say({ role: 'agent', text: '没找到可用的真实边界，已定位到候选地点。请在户外地图逐点手画并闭合边界；闭合前不写入新锚点，不虚构 300m 方块。Esc 可取消。' });
      return;
    }
    if (bridge.applyVenue(anchor, boundary)) {
      setOutdoorTask({ intent: `在「${place.name}」做设计`, state: 'done', action: '真实边界与锚点已写入，2D/3D 同步', steps: ['地点已确认', '取得真实边界', '应用场地'], prompts: ['排一下流线'] });
      say({ role: 'agent', text: `已在户外规划设为「${place.name}」，边界来源：${source === 'osm' ? 'OSM 占地轮廓' : '行政区选区'}。2D/3D 共用这份规划，可撤销，未清除任何已有内容。` });
    } else setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '已有规划不能直接换地理锚点，或画布暂不可写；本次未更改，请先新建户外活动', steps: [] });

  }

  // V-2c：流线提案生成——读当前户外 plan（锚点/边界由 overlay 桥供给），路网 bbox 取边界最大跨度+余量。
  async function proposeRoutePlan(): Promise<void> {
    const epoch = beginOutdoorTask('route');
    const plan = routeBridgeRef.current?.getPlan() ?? null;
    if (!plan?.anchor || plan.boundary.length < 3) {
      say({ role: 'agent', amber: true, text: '还没有可排流线的场地——先说一句「在XX做设计」把场地立起来，再排流线。' });
      return;
    }
    const controller = new AbortController();
    outdoorRequestRef.current?.abort(); outdoorRequestRef.current = controller;
    const base = JSON.stringify(plan);
    setZoneProposal(null); setRouteProposal(null);
    setOutdoorTask({ intent: '根据真实道路安排流线和出入口', state: 'working', action: '读取场地周边路网', steps: ['读取当前场地边界'] });
    setRouteBusy(true);
    try {
      let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
      for (const point of plan.boundary) {
        west = Math.min(west, point.x); east = Math.max(east, point.x);
        south = Math.min(south, point.y); north = Math.max(north, point.y);
      }
      const spanM = Math.max(east - west, north - south) * 0.75 + 300;
      say({ role: 'agent', text: '正在读这一带的路网，排一版人流/车流/后勤流线和出入口…' });
      const { roads } = await fetchRoadNetwork({ lng: plan.anchor.lng, lat: plan.anchor.lat }, spanM, { signal: controller.signal });
      if (!currentOutdoorTask(epoch, 'route') || controller.signal.aborted || outdoorRequestRef.current !== controller) return;
      if (JSON.stringify(routeBridgeRef.current?.getPlan()) !== base) {
        setOutdoorTask({ intent: '安排流线和出入口', state: 'blocked', action: '读取期间场地发生变化，旧结果已丢弃，请重新生成', steps: [], prompts: ['排一下流线'] });
        return;
      }
      const proposal = buildRouteProposal({
        boundary: plan.boundary,
        anchor: { lng: plan.anchor.lng, lat: plan.anchor.lat },
        roads,
      });
      if (!proposal) {
        setOutdoorTask({ intent: '安排流线和出入口', state: 'blocked', action: '没有可用路网，未编造道路；稍后重试或手画', steps: ['读取当前场地边界'] });
        say({ role: 'agent', amber: true, text: '这一带的路网暂时拿不到（OSM 忙或没收录道路）——稍后再说一次「排流线」，或先用画布手画。' });
        return;
      }
      routeProposalBaseRef.current = base;
      routeTicketRef.current = { epoch, proposal };
      setRouteProposal(proposal);
      setOutdoorTask({ intent: '安排流线和出入口', state: 'confirm', action: '虚线预览就绪，确认才写入', steps: ['读取真实路网', '按等级区分人行/车行/后勤', '生成流线与入口预览'] });
      say({ role: 'agent', text: `路网读到了：草拟 ${proposal.routes.length} 条流线（人行 ${proposal.summary.pedestrian}/车行 ${proposal.summary.vehicle}/后勤 ${proposal.summary.service}）+ ${proposal.summary.entrances} 个出入口。画布上的虚线是预览——点「应用」才真正写入，整批可撤销。` });
    } catch {
      if (!currentOutdoorTask(epoch, 'route') || controller.signal.aborted) return;
      setOutdoorTask({ intent: '安排流线和出入口', state: 'blocked', action: '路网服务暂时不可用，本次未生成提案', steps: [] });
      say({ role: 'agent', amber: true, text: '路网服务暂时不可用，这次没有生成提案；稍后再试一次。' });
    } finally {
      if (currentOutdoorTask(epoch, 'route') && outdoorRequestRef.current === controller) setRouteBusy(false);
    }
  }

  function confirmRouteProposal(): void {
    const proposal = routeProposal;
    const ticket = routeTicketRef.current;
    if (!proposal || !ticket || ticket.proposal !== proposal || !currentOutdoorTask(ticket.epoch, 'route')) return;
    if (routeProposalBaseRef.current !== JSON.stringify(routeBridgeRef.current?.getPlan())) {
      setRouteProposal(null);
      setOutdoorTask({ intent: '安排流线和出入口', state: 'blocked', action: '场地/内容已变化，旧提案已失效，请重新生成', steps: [], prompts: ['排一下流线'] });
      return;
    }
    const ok = routeBridgeRef.current?.applyRoutes(proposal.routes, proposal.nodes) ?? false;
    if (ok) { routeTicketRef.current = null; routeProposalBaseRef.current = null; setRouteProposal(null); setOutdoorTask({ intent: '安排流线和出入口', state: 'done', action: '已应用，可整批撤销', steps: ['虚线预览', '用户确认', '写入正式流线与入口'], prompts: ['45 人讲座', '80 人市集'] }); }
    if (ok) say({ role: 'agent', text: `已应用 ${proposal.routes.length} 条流线和 ${proposal.nodes.length} 个出入口——虚线变实线了，Ctrl+Z 可整批撤销。` });
    else say({ role: 'agent', amber: true, text: '画布还没准备好（户外规划卡没开？），提案先留着；打开户外规划再说一次「排流线」。' });
  }

  function dismissRouteProposal(): void {
    const ticket = routeTicketRef.current;
    if (!ticket || ticket.proposal !== routeProposal || !currentOutdoorTask(ticket.epoch, 'route')) return;
    beginOutdoorTask(null);
    setOutdoorTask(current => current ? { ...current, state: 'stopped', action: '已放弃预览，未写入' } : null);
    say({ role: 'agent', text: '这版流线提案已放弃，画布上的虚线撤掉了。' });
  }

  // V-3：区域→事件→物料提案——brief 里的活动名/人数进配比，出入口决定入场朝向。
  function proposeZonePlan(): void {
    const epoch = beginOutdoorTask('zone');
    const plan = routeBridgeRef.current?.getPlan() ?? null;
    if (!plan?.anchor || plan.boundary.length < 3) {
      say({ role: 'agent', amber: true, text: '还没有可分区的场地——先说一句「在XX做设计」把场地立起来，再分区。' });
      return;
    }
    setRouteProposal(null); setZoneProposal(null);
    setZoneBusy(true);
    try {
      const memory = memoryRef.current;
      const issue = outdoorEventIssue(memory.event ?? null, memory.headcount ?? null);
      if (issue) { setOutdoorTask({ intent: '按活动需求分区与放置物料', state: 'blocked', action: issue, steps: ['读取当前场地'], prompts: ['45 人讲座', '80 人市集'] }); say({ role: 'agent', amber: true, text: issue }); return; }
      if (!plan.nodes.some(node => node.kind !== 'exit' && !/子口|子出入口/u.test(node.name + node.notes))) { setOutdoorTask({ intent: '按活动需求安排区域', state: 'blocked', action: '先确认真实场地入口，才能安排签到、观众方向与接驳', steps: ['记录活动类型与人数'], prompts: ['排一下流线'] }); return; }
      const proposal = buildZoneEventProposal({
        boundary: plan.boundary,
        nodes: plan.nodes,
        brief: { event: memory.event ?? null, guests: memory.headcount ?? null },
        existingFacilities: plan.facilities,
        existingRoutes: plan.routes,
      });
      if (!proposal) {
        setOutdoorTask({ intent: `${memory.headcount ?? ''} 人${memory.event ?? '活动'}`, state: 'blocked', action: '当前场地/通道条件放不下这版需求；请减少人数或调整场地，未生成布局', steps: ['核对活动类型与人数', '检查占地、通道与交通冲突'] });
        say({ role: 'agent', amber: true, text: '当前真实边界内找不到容纳该人数、避让现有设施/车流后勤、并连接入口的活动区。本次没有生成布局；可减少人数、调整边界或先修正流线，不会硬塞固定模板。' });
        return;
      }
      if (!currentOutdoorTask(epoch, 'zone')) return;
      zoneProposalBaseRef.current = JSON.stringify(plan);
      zoneTicketRef.current = { epoch, proposal };
      setZoneProposal(proposal);
      setOutdoorTask({ intent: `${memory.headcount ?? ''} 人${memory.event ?? '活动'}`, state: 'confirm', action: '区域、物料与人行通道预览就绪，确认才写入', steps: ['核对活动类型与人数', '检查真实边界与交通冲突', '排布物料并留出通道'] });
      say({ role: 'agent', text: `分区草案好了：${proposal.summary.zones} 个区域（${proposal.zones.some(z => z.semantic === 'stage') ? '签到→观众→舞台' : '签到→市集通道→摊位'}）+ ${proposal.summary.facilities} 件物料。画布上的虚线框是预览——点「应用」才写入，可整批撤销。` });
    } catch {
      say({ role: 'agent', amber: true, text: '分区提案生成失败；稍后再说一次「分区」。' });
    } finally {
      setZoneBusy(false);
    }
  }

  function confirmZoneProposal(): void {
    const proposal = zoneProposal;
    const ticket = zoneTicketRef.current;
    if (!proposal || !ticket || ticket.proposal !== proposal || !currentOutdoorTask(ticket.epoch, 'zone')) return;
    if (zoneProposalBaseRef.current !== JSON.stringify(routeBridgeRef.current?.getPlan())) {
      setZoneProposal(null); setOutdoorTask({ intent: '活动分区与物料', state: 'blocked', action: '场地/内容已变化，旧提案已失效，请重新生成', steps: [] }); return;
    }
    const ok = routeBridgeRef.current?.applyZoneProposal(proposal.zones, proposal.facilities, proposal.routes, proposal.nodes) ?? false;
    if (ok) { zoneTicketRef.current = null; zoneProposalBaseRef.current = null; setZoneProposal(null); setOutdoorTask({ intent: '活动分区与物料', state: 'done', action: '已应用。选设施可切模型/生成/上传；选区域可编辑事件', steps: ['区域物料预览', '用户确认', '写入同一份户外规划'], focusFacilityId: (proposal.facilities.find(f => f.name.includes('舞台')) ?? proposal.facilities[0])?.id, prompts: ['补子出入口', '开始模拟'] }); }
    if (ok) say({ role: 'agent', text: `已应用 ${proposal.summary.zones} 个区域和 ${proposal.summary.facilities} 件物料——虚线变实线了，Ctrl+Z 可整批撤销。要改某个区的事件，选中分区在属性卡里改。` });
    else say({ role: 'agent', amber: true, text: '画布还没准备好（户外规划卡没开？），提案先留着；打开户外规划再说一次「分区」。' });
  }

  function dismissZoneProposal(): void {
    const ticket = zoneTicketRef.current;
    if (!ticket || ticket.proposal !== zoneProposal || !currentOutdoorTask(ticket.epoch, 'zone')) return;
    beginOutdoorTask(null);
    setOutdoorTask(current => current ? { ...current, state: 'stopped', action: '已放弃预览，未写入' } : null);
    say({ role: 'agent', text: '这版分区提案已放弃，画布上的虚线撤掉了。' });
  }

  // V-4a：子出入口提案——给每个分区接驳最近的主流线（复用 routeProposal 确认卡与 applyRoutes）。
  function proposeSubEntrances(): void {
    const epoch = beginOutdoorTask('route');
    const plan = routeBridgeRef.current?.getPlan() ?? null;
    if (!plan) {
      say({ role: 'agent', amber: true, text: '画布还没准备好（户外规划卡没开？），打开户外规划再补子出入口。' });
      return;
    }
    if (plan.zones.length === 0 || plan.routes.length === 0) {
      say({ role: 'agent', amber: true, text: '子出入口要「分区」和「流线」都在才能接——先排流线、分区，再补子口。' });
      return;
    }
    const proposal = buildSubEntranceProposal(plan);
    if (!proposal) {
      say({ role: 'agent', amber: true, text: '没找到能接驳的分区——流线都离分区太远（>120m），或者子口位已经被占了。' });
      return;
    }
    routeProposalBaseRef.current = JSON.stringify(plan);
    setZoneProposal(null);
    setOutdoorTask({ intent: '补子出入口与接驳线', state: 'confirm', action: '虚线预览就绪，确认后可模拟分流', steps: ['读取分区与主流线', '寻找近邻接驳点', '生成子口与驳线'] });
    const routeDraft = { routes: proposal.routes, nodes: proposal.nodes, summary: { pedestrian: proposal.routes.filter(route => route.kind === 'pedestrian').length, vehicle: proposal.routes.filter(route => route.kind === 'vehicle').length, service: proposal.routes.filter(route => route.kind === 'service').length, entrances: proposal.nodes.length } };
    routeTicketRef.current = { epoch, proposal: routeDraft };
    setRouteProposal(routeDraft);
    say({ role: 'agent', text: `子出入口草案：${proposal.summary.spurs} 条驳线 + ${proposal.nodes.length} 个子口（${proposal.summary.skippedFar} 个分区离流线太远没接）。虚线是预览——应用后人流就能从区口进出主流线。` });
  }

  // V-4b：流动模拟开关（动画在 canvas ticker；这里校验流线在不在并回话）。
  function startFlowSim(): void {
    if (flowSimActive) {
      say({ role: 'agent', text: '模拟已经在跑了——画布上的小点就是人流。说「停止模拟」结束。' });
      return;
    }
    beginOutdoorTask('simulation');
    const plan = routeBridgeRef.current?.getPlan() ?? null;
    if (!plan || plan.routes.length === 0) {
      say({ role: 'agent', amber: true, text: '还没有流线可模拟——先「排一下流线」并应用，再开始模拟。' });
      return;
    }
    setRouteProposal(null); setZoneProposal(null);
    setFlowSimActive(true);
    setOutdoorTask({ intent: '查看流动示意', state: 'working', stopLabel: '停止模拟', action: '2D 流动示意已开启；不写入规划，不代表容量/疏散评估', steps: ['读取已应用流线', '启动真实画布动画'] });
    say({ role: 'agent', text: `流动模拟开始了：${plan.routes.length} 条流线上的小点就是人流/车流，线色深浅=密度。这是预览动画，不写入方案；说「停止模拟」结束。` });
  }

  function stopFlowSim(): void {
    if (!flowSimActive) return;
    beginOutdoorTask(null);
    setOutdoorTask({ intent: '查看流动示意', state: 'stopped', action: '动画已停止，规划数据未改动', steps: ['停止画布动画'], prompts: ['开始模拟'] });
    say({ role: 'agent', text: '流动模拟停了。要再看就说「开始模拟」。' });
  }

  /** 场地圈画应用（原 value 内联体，V-1c 提为具名函数：chat 锚定链与地图选址共用同一落壳路径）。 */
  function applyVenuePick(pick: { name: string; location: string; polygon: AmapPoint[]; satelliteGround?: boolean; satelliteGroundImage?: string }): string | null {
    if (phase === 'generating') { const reason = '还在出这一版：先停一下，再圈场地。'; say({ role: 'agent', amber: true, text: reason }); return reason; }
    const was2D = view.view2D;
    try {
      const base = layoutStore.getState().layout;
      if (base.floors.length !== 1) throw new Error('当前方案有多个楼层，圈场地会丢失已有内容；请保留原方案并先核对。');
      const { layout, cleared } = createVenueFromPick(base, pick);
      const preservation = validateCandidateApply(base, layout, activeFloorIndex);
      if (!preservation.ok) throw new Error(preservation.reason);
      for (const floor of base.floors) for (const item of floor.items) {
        const candidate = layout.floors.find(value => value.id === floor.id)?.items.find(value => value.id === item.id);
        if (!candidate || !sameRecoveryFormValue(item, candidate)) throw new Error(`圈场地会改变或移除「${item.name}」，本次未应用；请先保留原方案并核对。`);
      }
      // 圈在平湖秋月这一片里：自动垫上这一片的卫星底图；圈在别处就沿用现有底图。
      const localBounds = boundsAround(XIHU_LOCAL_CENTER, XIHU_LOCAL_SPAN_M);
      const { west, east, south, north } = localBounds;
      const withinWestLake = pick.polygon.every(({ lng, lat }) => lng >= west && lng <= east && lat >= south && lat <= north);
      const researchArea = withinWestLake
        ? layout.researchArea?.name === XIHU_LOCAL_NAME
          ? layout.researchArea
          : createResearchArea(XIHU_LOCAL_PLACE, DEFAULT_RESEARCH_RADIUS_M, RESEARCH_SATELLITE_STYLE)
        : layout.researchArea;
      onApply(researchArea ? { ...layout, researchArea } : layout, { expectedBase: base });
      runToken.current++; if (proposal.current) dropProposal(); discardCloudPreview(); setPhase('idle'); setProgress(0);
      setVenueIO('outdoor');
      onVenueIOChange?.('outdoor');
      if (was2D) setView(current => ({ ...current, view2D: true }));
      if (pick.satelliteGround) {
        setView(current => ({ ...current, showReferenceImage: true, referenceImageOpacity: layout.floorPlanOpacity ?? 0.55 }));
      }
      const dims = polygonBboxMeters(pick.polygon);
      const clamped = dims.width > 100 || dims.depth > 100;
      const dropped = cleared ? `${cleared} 件物料放不下先撤了` : '物料照常摆';
      const polyNote = (layout.backendVenue?.shape === 'polygon' || layout.backendSceneV2?.venue.shape === 'polygon')
        ? '，壳体按圈画真轮廓（非仅外接矩形）'
        : '';
      const satNote = withinWestLake
        ? '；已铺上平湖秋月这一片的卫星底图，蓝线标出活动范围'
        : pick.satelliteGround ? '；已开启卫星参考底图'
        : '';
      say({ role: 'agent', text: `户外场地已生成：${pick.name} · 真实范围 ${Math.round(dims.width)} × ${Math.round(dims.depth)} m（外接矩形报米）${polyNote}${clamped ? '，布置壳取其中一块规划区（等比缩轮廓）' : ''}，${dropped}${satNote}。下一步可在「空间」查看实景，或重新打开地图选址，按采集单拍摄本场素材。` });
      return null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : '地图场地没立起来，再试一次。';
      say({ role: 'agent', amber: true, text: reason });
      return reason;
    }
  }

  // 画布上有墙体/场地真相 = 第 ① 步已经过了；撤回或作废不会把它拆掉，进度和尺寸读数都靠它。
  // 模板场馆也是立起来的场地：角标和简报要能报出它的米数。
  const venueUp = layout.backendSceneV2 !== undefined || layout.backendVenue !== undefined || layout.scenePreset !== undefined || (activeFloor.interiorWalls?.length ?? 0) > 0;

  // 模板/空壳自带固定长宽：载入或被尺寸改写后，把读数同步成场地的真实米数，
  // 否则角标报了米数、卡片还空着，人一说话又按旧读数算。
  const venueDimsStamp = useRef('');
  const lengthValue = lengthCheck.ok ? lengthCheck.value : null;
  const widthValue = widthCheck.ok ? widthCheck.value : null;
  useEffect(() => {
    const stamp = layout.scenePreset ? `preset:${layout.scenePreset}:${layout.width}x${layout.height}`
      : layout.backendSceneV2 ? `shell:${layout.width}x${layout.height}` : '';
    if (!stamp || stamp === venueDimsStamp.current) return;
    venueDimsStamp.current = stamp;
    const matches = lengthValue !== null && widthValue !== null
      && Math.abs(lengthValue - layout.width) < 1e-6 && Math.abs(widthValue - layout.height) < 1e-6;
    if (!matches) { setLengthRaw(String(layout.width)); setWidthRaw(String(layout.height)); setScaleOrigin('typed'); }
    setDimsTouched(true);
  }, [layout.scenePreset, layout.backendSceneV2, layout.width, layout.height, lengthValue, widthValue]);

  /**
   * 云端 AI 返回的那一版，折成右栏同一套读数：服务端只说「哪些物件变了」和场地检查警告，
   * 件数与重叠名在这里算。基线（场景 / 需求 / 编辑权）变了或过期就不许确认；
   * 动了锁着的物料同样按住确认——Agent 不该改锁着的东西（卡 §4.4）。
   */
  const cloudViewOf = useCallback((preview: NonNullable<typeof studio>['preview']): ProposalView | null => {
    if (!preview) return null;
    const byId = new Map(preview.layout.floors.flatMap(floor => floor.items.map(item => [item.id, item] as const)));
    const differences=proposalDifferences(preview.base,preview.layout);
    const plan = pendingPlanOf(
      differences.map(change => ({
        kind: change.kind,
        locked: !!(change.before?.item.locked || change.after?.item.locked),
      })),
      preview.proposal.warnings,
      id => byId.get(id)?.name ?? '物件',
    );
    const current = studioRef.current;
    const memory = memoryRef.current;
    const seatCheck = seatRequirement(preview.layout, activeFloorIndex, memory);
    const restCheck = checkRestArea(preview.layout, activeFloorIndex, memory.zoneNeeds.rest === true);
    const requirementError = current?.candidateRequirementError?.(preview.base, preview.layout);
    const annotationWarning = current?.candidateAnnotationAdvisory?.(preview);
    const changeItems = proposalChangeItems(differences);
    const changeSummary = proposalChangeSummary(changeItems, proposalZoneCount(differences, preview.base, preview.layout));
    const comparisonOnly=isUnchangedProposal(preview.proposal);
    const blocked = current?.applyRecovery ? cloudRecoveryMessage(current.applyRecovery)
      : current?.expired ? '这版已经过期了，重新出一版再看。'
      : current?.stale ? CLOUD_STALE
      : comparisonOnly ? '这版未改变场景，仅供对照；可选择其他方案或重新生成。'
      : plan.lockedTouched ? `这版动了 ${plan.lockedTouched} 件锁着的物料：我不改锁着的东西，先解锁或换一版。`
      : requirementError ? requirementError
      : seatCheck.blocked ? seatCheck.blocked
      : restCheck.status === 'unknown' ? restCheck.message
      : null;
    return {
      ...plan, source: 'cloud', keptLocked: 0, dropped: 0, blocked, comparisonOnly, candidateArea: venueArea(preview.layout),
      existingChanges:describeExistingChanges(differences,preview.base,preview.layout),
      ...(changeItems.length ? { changeItems, changeSummary } : {}),
      ...(typeof preview.proposal.explanation==='string'&&preview.proposal.explanation.trim()?{modelExplanation:preview.proposal.explanation}:{}),
      ...(seatCheck.warning ? { seatWarning: seatCheck.warning } : {}),
      ...(annotationWarning && annotationWarning!==blocked ? { annotationWarning } : {}),
      outcome: {...buildOutcome({
        added: plan.added, removing: plan.removing, changed: plan.changed, keptLocked: 0, dropped: 0,
        blocked, lockedTouched: plan.lockedTouched,changedLabel:'调整',
      }),...(comparisonOnly?{empty:'这版未改变场景，仅供对照。'}:{})},
    };
  }, [activeFloorIndex]);
  const cloudProposal = useMemo(() => cloudViewOf(studio?.preview ?? null), [cloudViewOf, studio?.preview, studio?.stale, studio?.expired, studio?.applyRecovery, brief]);
  const localProposal = proposal.current ? viewOfLocalPlan(proposal.current, proposalBase.current ?? undefined) : null;
  const localSeats = proposal.current ? seatRequirement(proposal.current.layouts.at(-1), activeFloorIndex, memoryRef.current) : null;
  const localPreservation = proposal.current ? reviewOriginalPreservation(memoryRef.current.originalPreservation,proposal.current.layouts.at(-1)) : null;
  const cloudPreservation = !proposal.current && studio?.preview ? reviewOriginalPreservation(memoryRef.current.originalPreservation,studio.preview.layout) : null;
  const localEntrance = proposal.current?.layouts.at(-1) ? checkEntranceBlocks(proposal.current.layouts.at(-1)!) : null;
  const cloudEntrance = !proposal.current && studio?.preview ? checkEntranceBlocks(studio.preview.layout) : null;
  const pendingProposal: ProposalView | null = localProposal ? { ...localProposal,
    blocked: localProposal.blocked ?? localSeats?.blocked ?? (localPreservation?.status==='violated'||localPreservation?.status==='unknown'?localPreservation.message:null),
    ...(localSeats?.warning ? { seatWarning: localSeats.warning } : {}),
    ...(localEntrance?.message ? { entranceWarning: localEntrance.message } : {}) } : cloudProposal ? {...cloudProposal,
      blocked:cloudProposal.blocked ?? (cloudPreservation?.status==='violated'||cloudPreservation?.status==='unknown'?cloudPreservation.message:null),
      ...(cloudEntrance?.message ? { entranceWarning: cloudEntrance.message } : {})} : null;
  const activeProposal: ProposalView | null = pendingProposal ? { ...pendingProposal,
    functionalWarnings: [memoryRef.current.zoneNeeds.checkin === null || memoryRef.current.unresolvedActivityNeeds.includes('checkin') ? '签到需求尚未确认。' : null,
      memoryRef.current.unresolvedActivityNeeds.includes('rest') ? '休息区需求尚未确认。' : null,
      memoryRef.current.zoneNeeds.stage === null || memoryRef.current.unresolvedActivityNeeds.includes('stage') ? '舞台需求尚未确认。' : null,
      memoryRef.current.unresolvedActivityNeeds.includes('all_seated') ? '是否所有人入座尚未确认。' : null].filter((value): value is string => value !== null),
  } : null;

  // The inventory input belongs to one concrete local or cloud candidate, not to a model name.
  function inventoryTarget():{owner:object;candidate:RoomLayout}|null {
    const local=proposal.current;
    if(local){const candidate=local.layouts.at(-1);return candidate?{owner:local,candidate}:null;}
    const cloud=studioRef.current?.preview;
    return cloud?{owner:cloud,candidate:cloud.layout}:null;
  }
  function inventoryFor(target:{owner:object;candidate:RoomLayout}):CandidateInventory|undefined {
    const stored=inventoryInput.current,current=layoutStore.getState();
    if(stored&&stored.owner===target.owner&&stored.scope===sessionScope&&stored.sessionId===boundSessionId.current&&stored.sequence===briefTurnSequence.current&&
      getActiveAssistantSessionId(sessionScope)===stored.sessionId&&stored.floorIndex===current.activeFloorIndex&&stored.revision===current.revision){
      try{if(sameRecoveryFormValue(stored.candidate,target.candidate))return stored.value;}catch{return undefined;}
    }
    const cloud=studioRef.current?.preview;
    if(cloud&&target.owner===cloud){const bound=studioRef.current?.getBoundCandidateInventory?.(cloud);if(bound)return bound;}
    return studioRef.current?.getSessionInventory?.(target.candidate,sessionScope,boundSessionId.current);
  }
  const inventoryTargetForRender=phase==='proposed'?inventoryTarget():null;
  if(inventoryOwner.current.owner!==(inventoryTargetForRender?.owner??null))inventoryOwner.current={owner:inventoryTargetForRender?.owner??null,serial:inventoryOwner.current.serial+1};
  const inventoryState=layoutStore.getState(),inventorySerial=inventoryOwner.current.serial;
  const inventorySession=boundSessionId.current,inventorySequence=briefTurnSequence.current;
  let inventorySnapshot:RoomLayout|null=null;
  try{if(inventoryTargetForRender)inventorySnapshot=structuredClone(inventoryTargetForRender.candidate);}catch{/* uncopyable candidate cannot accept a bound count */}
  const inventoryCheck=inventoryTargetForRender?checkCandidateInventory(inventoryTargetForRender.candidate,inventoryFor(inventoryTargetForRender)):null;
  const inventoryWorkspace:ReactNode=inventoryTargetForRender&&inventorySnapshot?<CandidateInventoryPanel
    key={inventorySerial}
    candidate={inventoryTargetForRender.candidate}
    initialInventory={inventoryFor(inventoryTargetForRender)}
    sessionMemory={!!studioRef.current?.canRememberSessionInventory?.(sessionScope,inventorySession)}
    scope={JSON.stringify([sessionScope,inventorySession,inventoryState.activeFloorIndex,inventoryState.revision,inventorySerial])}
    onChange={value=>{
      const current=layoutStore.getState(),target=inventoryTarget();
      if(!target||target.owner!==inventoryTargetForRender.owner||inventoryOwner.current.serial!==inventorySerial||!sessionScopeIsCurrent()||
        boundSessionId.current!==inventorySession||briefTurnSequence.current!==inventorySequence||getActiveAssistantSessionId(sessionScope)!==inventorySession||
        current.activeFloorIndex!==inventoryState.activeFloorIndex||current.revision!==inventoryState.revision||!inventorySnapshot)return;
      try{if(!sameRecoveryFormValue(inventorySnapshot,target.candidate))return;}
      catch{return;}
      inventoryInput.current=value?{owner:target.owner,scope:sessionScope,sessionId:inventorySession,sequence:inventorySequence,floorIndex:current.activeFloorIndex,revision:current.revision,candidate:inventorySnapshot,value:structuredClone(value)}:null;
      const cloud=studioRef.current?.preview;
      const bound=!(cloud&&target.owner===cloud)||!!studioRef.current?.setCandidateInventory?.(cloud,value,sessionScope,inventorySession);
      if(!bound&&value)say({role:'agent',amber:true,text:'物料数量未能绑定当前候选，请重新核对后确认。'});
      if(bound)studioRef.current?.rememberSessionInventory?.(target.candidate,value,sessionScope,inventorySession);
      setInventoryRevision(n=>n+1);
    }}/>:null;

  async function acceptFile(file: File): Promise<void> {
    lastFile.current = file;
    const verdict = classifyFile(file);
    if (verdict !== 'image') {
      setIssue({ kind: verdict, name: file.name, size: file.size });
      say({ role: 'user', text: file.name, warn: verdict === 'nonImage' ? `${(file.name.split('.').pop() ?? '').toUpperCase()} 暂时放不了` : verdict === 'tooLarge' ? `${fileSizeLabel(file.size)} · 超过 20 MB` : '格式不支持' });
      say({ role: 'agent', amber: true, text: verdict === 'nonImage' ? NON_IMAGE_MESSAGE : verdict === 'tooLarge' ? '文件太大，压到 20 MB 以内再拖进来。' : '这个格式读不了，换成 PNG 或 JPG 图片。' });
      return;
    }
    try {
      const url = await readImageAsDataUrl(file);
      let pixels = { width: 0, height: 0 };
      await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => { pixels = { width: image.naturalWidth, height: image.naturalHeight }; image.naturalWidth > 0 ? resolve() : reject(new Error('empty')); }; image.onerror = () => reject(new Error('decode')); image.src = url; });
      actions.setFloorPlan(url);
      setView(current => ({ ...current, showReferenceImage: true, referenceImageOpacity: 0.6 }));
      setIssue(null); setBaseName(file.name);
      // 图纸只当参照：不把按比例折出来的数字悄悄填进卡片，也不说成「读到的尺寸」。
      planPixels.current = { width: pixels.width, height: pixels.height };
      say({ role: 'user', text: file.name, meta: '图片 · 1 页', image: url });
      // 拖图也算主入口：说过尺度就照它出一版；没说过就只差一步，给一个当场能点的「按图纸估一版」。
      if (lengthCheck.ok && widthCheck.ok) {
        const scale: Scale = { length: lengthCheck.value, width: widthCheck.value, origin: scaleOrigin };
        say({ role: 'agent', text: `底图铺好了，只当参照。按你说的 ${formatArea(scale.length)} × ${formatArea(scale.width)} m 先出一版，画布上是预览。` });
        runGeneration(null, seed.current, '', scale);
      } else {
        say({ role: 'agent', text: '底图铺好了，它只当参照，我读不出真实米数。要么说一句「12×9」，要么让我按图纸比例估一版。',
          action: { label: '按图纸估一版', run: estimateAndGenerate } });
        queueMicrotask(() => document.getElementById('ap-input')?.focus());
      }
    } catch {
      setIssue({ kind: 'readFailed', name: file.name, size: file.size });
      say({ role: 'user', text: file.name, warn: '没读出来' });
      say({ role: 'agent', amber: true, text: '文件没读出来，可能损坏了，再试一次？' });
    }
  }

  /** 选文件先挂到输入框，不进对话、不改画布；点发送才按原来的链路读进场地。 */
  async function stageFile(file: File): Promise<void> {
    const verdict = classifyFile(file);
    if (verdict !== 'image') { await acceptFile(file); return; }
    try {
      const url = await readImageAsDataUrl(file);
      setIssue(null);
      setPendingFile({ file, url });
    } catch {
      await acceptFile(file);
    }
  }

  // 拖文件到画布或右栏：只认 Files，不干扰物料拖放。
  useEffect(() => {
    if (callbacks.workbenchMode !== 'layout') return undefined;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const enter = (event: DragEvent) => { if (!hasFiles(event)) return; dragDepth.current++; setDragging(true); };
    const leave = (event: DragEvent) => { if (!hasFiles(event)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
    const over = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); dragDepth.current = 0; setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file && phaseRef.current !== 'generating') void stageFile(file);
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [callbacks.workbenchMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const phaseRef = useRef(phase); phaseRef.current = phase;

  // 提案算的是「从这一帧场景出发」的候选：人手动改过物料或场地，旧候选就不再代表现状，作废。
  // 有身份就比内容指纹；没有身份（旧数据）才退回对象引用。
  const pendingPhase = phase === 'proposed' || phase === 'paused';
  useEffect(() => {
    if (!pendingPhase) return;
    const plan = proposal.current;
    if (!plan) return;
    if (proposalBase.current && (proposalBase.current.id !== live.current.id || !sameLayoutContent(proposalBase.current, live.current))) {
      invalidateProposal('场景在这期间改过了'); return;
    }
    if (plan.artifact) {
      const check = planIsApplicable(plan.artifact, live.current);
      if (!check.ok) invalidateProposal(PLAN_OBSOLETE_COPY[check.reason]);
      return;
    }
    if (!proposalBase.current) return;
  }, [layout, pendingPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // T-UI：确认后的「这一版布置」卡只代表确认那一帧的画布。人点撤销或手动拖改后，
  // 画布已经变了，右栏不能还停在 planReady——卡片收回、阶段归零（修 T-03 §6.1 的同步洞）。
  const planShownLayout = useRef<RoomLayout | null>(null);
  const planShownPhase = phase === 'ready' || phase === 'edited';
  useEffect(() => {
    if (!planShownPhase) { planShownLayout.current = null; return; }
    if (!planShownLayout.current) { planShownLayout.current = layout; return; }
    // 用内容比较而不是对象 identity：reducer 可能包一层新对象，撤销/手动拖改才是真变了。
    if (!sameLayoutContent(layout, planShownLayout.current)) {
      planShownLayout.current = null;
      setPhase('idle'); setProgress(0);
      say({ role: 'agent', text: '画布改过了（撤销或手动调整），「这一版布置」的卡我收了；要再出一版随时说。' });
    }
  }, [layout, planShownPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 第 1 步的壳体播报：尺寸、墙与门、层高来源，一句一句照实说。 */
  /** 模板是固定 GLB 外壳：改尺寸时明说已经离开模板，别让人以为只是把体育馆拉长了。 */
  function presetShellNote(venue: VenuePlan): string {
    const size = `${formatArea(venue.scene.venue.width)} × ${formatArea(venue.scene.venue.depth)} m`;
    return `已离开模板，按新尺寸 ${size} 立了矩形场地。`;
  }

  /** 纯改尺寸只动壳：一句短的，不拉着人再确认一遍布置。 */
  function sizeOnlyNote(venue: VenuePlan, leavingPreset: boolean): string {
    if (leavingPreset) return presetShellNote(venue);
    const size = `${formatArea(venue.scene.venue.width)} × ${formatArea(venue.scene.venue.depth)} m`;
    return `场地改成 ${size}。`;
  }

  /** 预览收回：画布退回确认前的样子，提案本身留着，还能接着摆。 */
  function hidePreview(): void { onPreview(null); }

  function dropProposal(): void {
    hidePreview();
    setLocalProposal(null); proposalBase.current = null; proposalFloor.current=null; styleProposal.current = null; shownSteps.current = 0;
    localDraftOwner.current = null;
  }

  /** 云端那一版也不要留：撤回/改需求之后，画布上不该还挂着上一版的绿框。 */
  function discardCloudPreview(): void {
    confirmPending.current = false;
    if (studioRef.current?.preview) studioRef.current.discardPreview();
  }

  /**
   * 把候选一帧一帧推到画布上当预览：绿框 = 新摆的，红框 = 要撤掉的，虚线 = 原位。
   * 全程只调 onPreview，不 dispatch —— 自动存档与撤销栈都看不到它。
   */
  async function presentProposal(token: number, lead?: string): Promise<void> {
    const plan = proposal.current;
    if (!plan) return;
    const intro = lead ?? (plan.kind === 'review' ? '这版改法。' : '先出一版可拖的初稿。');
    if (plan.kind === 'review') pushLocalLayoutStep('revise', 'running');
    phaseRef.current='generating';setPhase('generating');
    for (let step = shownSteps.current; step < plan.layouts.length; step++) {
      if (!sessionScopeIsCurrent()) return;
      if(localDraftOwner.current&&!localDraftAllowed(localDraftOwner.current.owner,localDraftOwner.current)){
        dropProposal();failOpenLocalStep('这版没出成');phaseRef.current='failed';setPhase('failed');
        say({role:'agent',amber:true,text:'云端连接或本机活动状态已变化，本地草案预览已收回；画布未改。'});return;
      }
      if(!checkProposalFloor()){failOpenLocalStep('这版没出成');setPhase('proposed');return;}
      onPreview(plan.layouts[step]!);
      setProgress(step + 1);
      shownSteps.current = step + 1;
      await wait(step === plan.layouts.length - 1 ? 120 : STEP_DELAY_MS);
      if (token !== runToken.current || !sessionScopeIsCurrent()) return;
      if(localDraftOwner.current&&!localDraftAllowed(localDraftOwner.current.owner,localDraftOwner.current)){
        dropProposal();failOpenLocalStep('这版没出成');phaseRef.current='failed';setPhase('failed');
        say({role:'agent',amber:true,text:'云端连接或本机活动状态已变化，本地草案预览已收回；画布未改。'});return;
      }
      if(!checkProposalFloor()){failOpenLocalStep('这版没出成');setPhase('proposed');return;}
    }
    pushLocalLayoutStep(plan.kind === 'review' ? 'revise' : 'preview', 'done');
    pushLocalLayoutStep('validate', 'running');
    await wait(120);
    if (token !== runToken.current || !sessionScopeIsCurrent()) return;
    const overlapNote = plan.overlapCount > 0 ? '有物料叠在一起' : undefined;
    pushLocalLayoutStep('validate', plan.overlapCount > 0 || plan.blocked ? 'error' : 'done', overlapNote);
    finishLocalLayoutRun();
    phaseRef.current='proposed';setPhase('proposed');
    if (plan.receipt === 'banquet') return;
    const planView = viewOfLocalPlan(plan, proposalBase.current ?? undefined);
    const tail = planView.review ? '还没落盘。点「确认布置」才挪。' : '还没落盘，点确认才写进画布。';
    const hint = layoutChatHint(plan);
    say({ role: 'agent', amber: !!planView.blocked || !!hint, text: planView.blocked
      ? `这版先看着改。确认先不亮。${hint ? hint : ''}`
      : `${intro}${tail}${hint ? hint : ''}` });
  }

  /**
   * 立壳被挡下 = 场地一个字节都没变：尺寸读数退回画布真实米数。
   * 不然简报会挂着刚被拒掉的「200 × 150 m」，而画布还是原来那块地，两处对不上。
   */
  function revertScaleToCanvas(): void {
    const { width, height } = live.current;
    setLengthRaw(String(width)); setWidthRaw(String(height)); setScaleOrigin('canvas');
  }

  /**
   * 纯改尺寸：只落壳，不开进度、预览卡或绿钮。场地一变，旧提案就不再代表画布，
   * 这里静默收回（不另发「预览作废」的恐吓条），由用户自己的改尺寸动作说了算。
   */
  function resizeVenueOnly(scale: Scale, indoorOutdoor: VenueIO = venueIO, previousMemory?: BriefMemory): void {
    const rejectResize = (message: string) => {
      revertScaleToCanvas();
      if (previousMemory) { saveMemory(previousMemory); syncMemory(previousMemory); }
      say({ role: 'agent', amber: true, text: message });
    };
    if (phase === 'generating') { rejectResize('还在出这一版：先停一下，再改场地尺寸。'); return; }
    const before = live.current;
    const size = `${formatArea(scale.length)} × ${formatArea(scale.width)} m`;
    if (Math.abs(before.width - scale.length) < 1e-6 && Math.abs(before.height - scale.width) < 1e-6) {
      say({ role: 'agent', text: `场地已经是 ${size}，没动。` });
      return;
    }
    runToken.current++;
    // 没有挂着的提案就不必回调 onPreview(null)：空改尺寸不该惊动画布。
    if (proposal.current) dropProposal();
    discardCloudPreview();
    setPhase('idle'); setProgress(0);
    const input = { base: before, floorIndex: activeFloorIndex, widthM: scale.length, depthM: scale.width, indoorOutdoor, scaleOrigin: scale.origin };
    let venue: VenuePlan | null = null;
    try {
      venue = (before.scenePreset || before.backendSceneV2 ? replaceVenueWithShell(input) : null) ?? raiseVenue(input);
    } catch (error) {
      rejectResize(error instanceof Error ? error.message : '这个尺度我立不起来，说一句「12×9」这样告诉我新的长宽。');
      return;
    }
    if (!venue) {
      rejectResize('这个场地是导入或生成的复杂结构，不能只改外框；要换尺寸得先重新立一块矩形空地。');
      return;
    }
    if(hasInvalidRetainedZones(venue.layout)){rejectResize('现有区域超出新场地范围或坐标不完整，场地没有更改。请先调整区域，再修改尺寸。');return;}
    const survivingItems = new Set(venue.layout.floors.flatMap(floor => floor.items.map(item => item.id)));
    const lostItems = before.floors.flatMap(floor => floor.items).filter(item => !isStructuralMarker(item) && !survivingItems.has(item.id));
    const survivingZones = new Set(venue.layout.floors.flatMap(floor => (floor.zones ?? []).map(zone => zone.id)));
    const lostZones = before.floors.flatMap(floor => floor.zones ?? []).filter(zone => !survivingZones.has(zone.id));
    if (lostItems.length || lostZones.length) {
      const lost = [lostItems.length ? `${lostItems.length} 件已有物料` : null, lostZones.length ? `${lostZones.length} 个已有区域` : null].filter(Boolean).join('和');
      rejectResize(`改成 ${size} 会移除 ${lost}，场地没有更改。请先调整物料或区域，再修改尺寸。`);
      return;
    }
    // 落盘走同一个确认回调（撤销/存快照都在里面），但只改外框不该把人从 2D 拽回 3D。
    const was2D = view.view2D;
    try { onApply(venue.layout); }
    catch (error) {
      rejectResize(error instanceof Error ? error.message : '这个尺度落不下来，先挪一下物料再改。');
      return;
    }
    if (sessionScope !== 'legacy' && (memoryRef.current.lengthM !== null || memoryRef.current.areaM2 !== null)) saveMemory({...memoryRef.current,venueScaleBasis:venueScaleBasis(venue.layout),venueFactToken:venueFacts.capture() ?? undefined,scaleNeedsReconfirmation:false});
    if (was2D) setView(current => ({ ...current, view2D: true }));
    say({ role: 'agent', text: sizeOnlyNote(venue, !!before.scenePreset) });
  }

  /** 左栏简报的「空白场地」文字链：和模板轨首卡同一块 12×8 空壳，不用先开物料库。 */
  function startBlankVenue(): void {
    if (phase === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：先停一下，再换空地。' }); return; }
    const before = live.current;
    const materialCount = before.floors.reduce((count, floor) => count + floor.items.filter(item => !isStructuralMarker(item)).length, 0);
    const zoneCount = before.floors.reduce((count, floor) => count + (floor.zones?.length ?? 0), 0);
    const recordedVenue = !!(before.scenePreset || before.venueScan || before.floorPlanImage || before.researchArea || before.sceneAnchor ||
      (before.backendVenue && !before.backendSceneV2) ||
      before.floors.length > 1 || before.floors.some(floor => (floor.interiorWalls ?? []).some(wall => wall.kind !== 'exterior')) ||
      (before.backendSceneV2 && (before.backendSceneV2.sources.length || before.backendSceneV2.structure.columns.length ||
        before.backendSceneV2.structure.walls.some(wall => wall.status !== 'inferred') ||
        before.backendSceneV2.structure.openings.some(opening => opening.status !== 'inferred'))));
    if (materialCount || zoneCount || recordedVenue) {
      const details = [materialCount ? `${materialCount} 件物料` : null, zoneCount ? `${zoneCount} 个区域` : null,
        recordedVenue ? '已有场地资料' : null].filter(Boolean).join('、');
      say({ role: 'agent', amber: true, text: `当前场景包含${details}，直接换成空白空间会丢失这些内容，本次没有更改。请先备份并另建场景。` });
      return;
    }
    runToken.current++;
    if (proposal.current) dropProposal();
    discardCloudPreview();
    setPhase('idle'); setProgress(0);
    const was2D = view.view2D;
    try {
      onApply(createBlankVenue(live.current));
      if (was2D) setView(current => ({ ...current, view2D: true }));
      say({ role: 'agent', text: `空白空间立好了：${BLANK_VENUE.width} × ${BLANK_VENUE.depth} m，要调尺寸就说「改成 15×10」。` });
    } catch (error) {
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '空白空间没立起来，再试一次。' });
    }
  }

  function readLocalDraftAnnotations():{revision:number;signature:string;hasUnmodelled:boolean;hasDoor:boolean;routes:LocalRouteInput[];routeSignature:string;routeReader:((id:string)=>UserRouteProvenance|null)|null;reader:()=>{draft:LayoutPlanDraft|null;revision:number}}|null {
    const reader=annotationSnapshotRef.current;if(!reader)return null;
    try{
      const snapshot=reader();if(!snapshot||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0)return null;
      const draft=snapshot.draft;
      if(draft!==null&&(!draft||!Array.isArray(draft.annotations)||!Array.isArray(draft.stages)||!sameRecoveryFormValue(draft,draft)))return null;
      if(draft?.annotations.some(annotation=>!annotation||!['zone','route','measure','door'].includes(annotation.kind)||!annotation.geometry||
        ({zone:'rect',route:'polyline',measure:'measure',door:'door'} as const)[annotation.kind]!==annotation.geometry.kind))return null;
      const signature=JSON.stringify(draft);if(typeof signature!=='string')return null;
      const routeReader=routeProvenanceRef.current??null;
      const routes:LocalRouteInput[]=(draft?.annotations??[]).filter(annotation=>annotation.kind==='route').map(annotation=>{
        const provenance=routeReader?.(annotation.id);
        return provenance?.source==='user'&&provenance.sourceBasis==='unknown'&&typeof provenance.floorId==='string'&&!!provenance.floorId.trim()
          ?{annotation,source:'user',floorId:provenance.floorId}:{annotation,source:'unknown',floorId:null};
      });
      const routeSignature=JSON.stringify(routes.map(route=>({id:route.annotation.id,source:route.source,floorId:route.floorId})));
      return {revision:snapshot.revision,signature,hasUnmodelled:!!draft?.annotations.some(annotation=>annotation.kind==='zone')||!!draft?.stages.length,
        hasDoor:!!draft?.annotations.some(annotation=>annotation.kind==='door'),routes,routeSignature,routeReader,reader};
    }catch{return null;}
  }
  function localDraftAnnotationsCurrent(authority:{annotationRevision:number;annotationSignature:string;annotationReader:()=>{draft:LayoutPlanDraft|null;revision:number};routeReader:((id:string)=>UserRouteProvenance|null)|null;routeSignature:string}):boolean {
    const current=readLocalDraftAnnotations();
    return !!current&&current.reader===authority.annotationReader&&current.revision===authority.annotationRevision&&current.signature===authority.annotationSignature&&current.routeReader===authority.routeReader&&current.routeSignature===authority.routeSignature;
  }
  function assessLocalDraftRoutes(base:RoomLayout,candidate:RoomLayout,annotations:NonNullable<ReturnType<typeof readLocalDraftAnnotations>>,floorIndex:number):LocalRouteReview {
    return reviewLocalRoutes(base,candidate,annotations.routes,base.floors[floorIndex]?.id??null);
  }
  function localDraftRouteBlock(review:LocalRouteReview):string|null {
    if(review.violations.length)return `路线中心线与 ${review.violations.length} 处模型包围占地新增或加重相交，请调整后重新生成。${review.centerlineCoverage==='incomplete'?'其他路线或物件信息仍未完整核对。':''}`;
    if(review.centerlineCoverage==='incomplete')return '当前版本尚未将已有路线、区域或阶段纳入组团计算，暂只能预览。';
    return null;
  }
  function localDraftAllowed(owner: NonNullable<typeof studio>['controller'],authority?:{actor:string|null;sessionId:string|null;apiUrl:string|null;version:string;annotationRevision:number;annotationSignature:string;annotationReader:()=>{draft:LayoutPlanDraft|null;revision:number};routeReader:((id:string)=>UserRouteProvenance|null)|null;routeSignature:string}): boolean {
    const current=studioRef.current;
    try {
      const snapshot=owner.getSnapshot();
      return sessionScope.startsWith('activity:') && sessionScopeIsCurrent() && current?.controller===owner &&
        current.connection!=='项目已连接' && !current.busy && !current.recoverable && !current.applyRecovery &&
        isLocalActivityWorkspace(owner) && owner.canCreateUnboundLocalDraft() && (!authority || (()=>{
          return (snapshot.user?.id??null)===authority.actor && (snapshot.sessionId??null)===authority.sessionId && (owner.config?.apiUrl??null)===authority.apiUrl && owner.localDraftAuthorityVersion()===authority.version &&
            localDraftAnnotationsCurrent(authority);
        })());
    } catch { return false; }
  }

  /** An explicit local-only candidate never enters the cloud scene contract. */
  async function runLocalSeatingDraft(token:number,scale:Scale,note:string):Promise<void> {
    const owner=studioRef.current?.controller,base=live.current;
    if(!owner||!localDraftAllowed(owner)) { say({role:'agent',amber:true,text:'本地草案需要独立的本机活动；请先结束云端连接或等待正在进行的云端操作，原场景未改。'});setPhase('failed');return; }
    const annotations=readLocalDraftAnnotations();
    if(!annotations){say({role:'agent',amber:true,text:'当前路线与区域标注无法完整读取，本地草案暂不能生成；原场景未改。'});setPhase('failed');return;}
    const initial=owner.getSnapshot(),authority={owner,actor:initial.user?.id??null,sessionId:initial.sessionId??null,apiUrl:owner.config?.apiUrl??null,version:owner.localDraftAuthorityVersion(),annotationRevision:annotations.revision,annotationSignature:annotations.signature,annotationReader:annotations.reader,routeReader:annotations.routeReader,routeSignature:annotations.routeSignature};
    if(memoryRef.current.layoutModeConfirmed!==true||memoryRef.current.layoutMode!=='desk-chair'||!memoryRef.current.headcount){say({role:'agent',amber:true,text:'请先明确人数并选择课桌椅布置，再生成本地草案。'});setPhase('failed');return;}
    const allocation=memoryRef.current.localSeatingAllocation;
    if(allocation?.status==='shared_desk'&&allocation.peoplePerDesk!==2){
      say({role:'agent',amber:true,text:`已记下每桌 ${allocation.peoplePerDesk} 人；当前本地一人一桌工具暂不支持这种组团，本次没有生成。可继续探索共桌方案，或明确选择每人一桌。`});setPhase('failed');return;
    }
    if(allocation?.status==='unknown'){
      say({role:'agent',amber:true,text:'每桌人数尚不明确，请说明是每人一桌还是多人共桌；本次没有按一人一桌生成。'});setPhase('failed');return;
    }
    if(memoryRef.current.zoneNeeds.stage===true||memoryRef.current.zoneNeeds.checkin===true||memoryRef.current.zoneNeeds.rest===true||memoryRef.current.mobilityRequirement?.decision==='needed'){
      say({role:'agent',amber:true,text:'本地课桌椅草案暂不能同时满足已提出的舞台、签到、休息或行动辅助要求，请先调整需求或采用其他方案。'});setPhase('failed');return;
    }
    if(Math.abs(base.width-scale.length)>1e-6||Math.abs(base.height-scale.width)>1e-6){say({role:'agent',amber:true,text:'本地草案不会改变已有场地；请先核对并调整当前场地尺寸。'});setPhase('failed');return;}
    void note;
    const dimensions=(facts:SeatingItemFacts|undefined,inventory:SeatingItemFacts|undefined,defaultChosen:boolean,defaults:{width:number;depth:number;height:number})=>{
      const result={...defaults},unknown:SeatingAxis[]=[],unselected:SeatingAxis[]=[];
      for(const axis of ['width','depth','height'] as const){const fact=facts?.[axis];if(!fact){if(inventory?.[axis]&&!defaultChosen)unselected.push(axis);continue;}
        if(fact.status!=='reported'||typeof fact.valueM!=='number'||!Number.isFinite(fact.valueM)||fact.valueM<=0){unknown.push(axis);continue;}
        result[axis]=fact.valueM;
      }
      return {value:result,unknown,unselected};
    };
    const shared=allocation?.status==='shared_desk'&&allocation.peoplePerDesk===2;
    const saved=memoryRef.current.localSeatingSpecs,desk=dimensions(saved?.desk,saved?.unselected?.desk,!!saved?.defaults?.desk,{width:shared?1.2:.6,depth:.45,height:.75}),chair=dimensions(saved?.chair,saved?.unselected?.chair,!!saved?.defaults?.chair,{width:.49,depth:.57,height:.9});
    const axisLabel:Record<SeatingAxis,string>={width:'宽度',depth:'深度',height:'高度'};
    if(desk.unknown.length||chair.unknown.length||desk.unselected.length||chair.unselected.length){
      const missing=[...desk.unknown.map(axis=>`桌子${axisLabel[axis]}`),...chair.unknown.map(axis=>`椅子${axisLabel[axis]}`)];
      const waiting=[...desk.unselected.map(axis=>`桌子${axisLabel[axis]}`),...chair.unselected.map(axis=>`椅子${axisLabel[axis]}`)];
      const waitingTarget=desk.unselected.length?'桌子':'椅子',waitingAxis=desk.unselected[0]??chair.unselected[0];
      const waitingFact=waitingAxis?(desk.unselected.length?saved?.unselected?.desk?.[waitingAxis]:saved?.unselected?.chair?.[waitingAxis]):undefined;
      const choose=waitingFact?.status==='reported'&&waitingFact.valueM!==null&&waitingAxis
        ?`可以说“使用现有${waitingTarget}${axisLabel[waitingAxis]}${waitingFact.valueM}米”，或说“${waitingTarget}按默认规格”。`
        :`请带单位明确选用规格，或说“${waitingTarget}按默认规格”。`;
      say({role:'agent',amber:true,text:`${missing.length?`${missing.join('、')}尚未明确，请带单位重新说明。`:''}${waiting.length?`${waiting.join('、')}只记录为现有物料线索，尚未选择用于这版方案；${choose}`:''}本次没有按默认规格生成。`});setPhase('failed');return;
    }
    const floorToken=captureFloor(activeFloorIndex);if(!floorToken){say({role:'agent',amber:true,text:'当前楼层已变化，请重新核对。'});setPhase('failed');return;}
    try {
      const input={floorIndex:activeFloorIndex,mode:'one_desk_one_chair' as const,count:memoryRef.current.headcount,
        desk:desk.value,chair:chair.value,
        deskChairGap:.1,columnGap:.3,rowGap:.5,edgeClearance:.3,
        assumptions:{count:'user' as const,deskSize:('width' in (saved?.desk??{})&&'depth' in (saved?.desk??{})&&'height' in (saved?.desk??{})?'user' as const:'assumption' as const),chairSize:('width' in (saved?.chair??{})&&'depth' in (saved?.chair??{})&&'height' in (saved?.chair??{})?'user' as const:'assumption' as const),deskChairGap:'assumption' as const,columnGap:'assumption' as const,rowGap:'assumption' as const,edgeClearance:'assumption' as const}};
      const result=shared?planLocalSharedDeskDraft(base,{...input,mode:'two_people_per_desk',chairGap:.1,assumptions:{...input.assumptions,chairGap:'assumption'}},uid):planLocalDeskChairDraft(base,input,uid);
      const placedTables='placedTables' in result?result.placedTables:result.placed;
      const requestedTables='requestedTables' in result?result.requestedTables:result.requested;
      if(!result.placed){
        const reason=result.limitReason==='object_limit'?'本机场景物件已达上限':result.limitReason==='no_placement'?'当前排布没有找到可放位置':result.limitReason==='scan_limit'?'本次搜索达到计算上限':result.limitReason==='preset_unverified'?'预设或扫描结构尚未核对':'场地几何待核验';
        say({role:'agent',amber:true,text:`本地草案暂未生成：${reason}，场景未改；${shared?`需求 ${result.requested} 人、${requestedTables} 桌，已排 0 人、0 桌，尚缺 ${result.shortfall} 人；`:''}${result.unknown.join('、')}仍需核验。`});setPhase('failed');return;
      }
      if(token!==runToken.current||!localDraftAllowed(owner,authority)||!floorStillCurrent(floorToken)||!sameLayoutContent(base,live.current)){
        say({role:'agent',amber:true,text:'活动、云端连接或场景已变化，本地草案未应用。'});setPhase('failed');return;
      }
      const overlaps=countOverlaps(result.layout,activeFloorIndex);
      const markedDoor=!!base.entrance&&base.entrance.door!==false||!!base.backendVenue?.entrances.length||
        !!base.backendSceneV2?.venue.entrances.length||!!base.backendSceneV2?.structure.openings.some(opening=>opening.kind==='door')||
        base.floors.some(floor=>floor.items.some(item=>item.type==='door'||!!item.venueEntranceId));
      const routeReview=assessLocalDraftRoutes(base,result.layout,annotations,activeFloorIndex);
      const limitations=[annotations.hasUnmodelled?'当前版本尚未将已有路线、区域或阶段纳入组团计算，暂只能预览。':null,localDraftRouteBlock(routeReview)].filter((item,index,items):item is string=>!!item&&items.indexOf(item)===index);
      const routeNotices=annotations.routes.length?[
        '仅核对手绘路线中心线与数字模型包围占地；图纸原件、路线净宽、门、疏散、消防、无障碍和现场条件仍需核验。',
        ...(routeReview.existing.length?[`原场景已有 ${routeReview.existing.length} 处路线与模型包围占地相交，不归因于本次新增；仍需核对。`]:[]),
        ...(routeReview.contacts.length?['路线与模型包围占地边缘接触，实际净宽仍需核对。']:[]),
      ]:[];
      const doorNotice=markedDoor||annotations.hasDoor?'图中门洞或入口未纳入本次组团净空检查；门位、宽度和开启情况仍需核验，本版只是探索草案，不代表安全通过或可交付。':null;
      const dimensionLine=(name:string,size:{width:number;depth:number;height:number},facts:SeatingItemFacts|undefined)=>`${name} ${(['width','depth','height'] as const).map(axis=>`${size[axis]}（${facts?.[axis]?.status==='reported'?'用户提供':'假设'}）`).join(' × ')} 米`;
      const localDraftDetails=[shared?`本机草案：需求 ${result.requested} 人、${requestedTables} 桌；本次排了 ${result.placed} 人、${placedTables} 桌、${result.placed} 把椅子，尚缺 ${result.shortfall} 人；未同步云端，也未确认本机持久化。`:`本机草案：本次排了 ${result.placed} / ${result.requested} 套，尚缺 ${result.shortfall} 套；未同步云端，也未确认本机持久化。`,
        shared?'每桌 2 人：用户明确选择；实际桌椅仍需核验。':allocation?.status==='one_per_desk'?'每人一桌：用户明确选择；实际桌椅仍需核验。':'每人一桌：本次探索假设，用户尚未指定，可随时修改。',
        `示意尺寸：${dimensionLine(shared?'双人桌':'单人桌',desk.value,saved?.desk)}；${dimensionLine('椅子',chair.value,saved?.chair)}；实物待核验。`,
        `示意间距：桌椅 0.1 米、${shared?'椅间 0.1 米、':''}列间 0.3 米、排间 0.5 米、距边 0.3 米，均为假设；不代表通行或规范结论。`,
        ...(shared&&result.shortfall?[`${result.limitReason==='object_limit'?'已触及本机场景物件数量上限':result.limitReason==='scan_limit'?'本次搜索达到计算上限':'本次排布未找到更多位置'}，不代表场地最大容量。`]:[]),
        `${result.unknown.join('、')}仍需核验。`,...(doorNotice?[doorNotice]:[]),...routeNotices,...limitations];
      const plan:PlanProposal & {localDraftDetails:string[]}={layouts:[result.layout],added:result.placed+placedTables,removing:0,
        keptLocked:base.floors[activeFloorIndex]?.items.filter(item=>item.locked&&!isStructuralMarker(item)).length??0,
        dropped:result.shortfall+(requestedTables-placedTables),overlapCount:overlaps.count,overlapNames:overlaps.names,blocked:limitations.join(' ')||null,
        guests:result.requested,seats:result.placed,localDraftDetails,seatingWitness:result.seatingWitness,seatingReview:reviewLocalSeatingWitness(result.seatingWitness,result.layout)};
      proposalFloor.current=floorToken;setLocalProposal(withPlanArtifact(plan,base));proposalBase.current=structuredClone(base);
      localDraftOwner.current=authority;shownSteps.current=0;
      await presentProposal(token,'先看本机课桌椅草案：');
    }catch(error){say({role:'agent',amber:true,text:error instanceof Error?error.message:'本地草案暂不能生成，原场景未改。'});setPhase('failed');}
  }

  /** 场地和布置都先在内存中生成，确认时连同物料变化一次应用。 */
  async function runLocal(token: number, variant: number, scale: Scale, seatPriority = false, localDraftNote?:string): Promise<void> {
    if(localDraftNote!==undefined){await runLocalSeatingDraft(token,scale,localDraftNote);return;}
    pushLocalLayoutStep('preview', 'running');
    const chosen = layoutFurnishing(memoryRef.current.furnishing, memoryRef.current.banquetTable);
    if (chosen) notePriorLayoutTool('select_furnishing', chosen.reason);
    const before = live.current;
    const floorToken=captureFloor(activeFloorIndex);if(!floorToken){failOpenLocalStep('这版没出成');say({role:'agent',amber:true,text:'当前楼层已变化，请重新核对。'});setPhase('failed');return;}
    const input = { base: before, floorIndex: activeFloorIndex, widthM: scale.length, depthM: scale.width, indoorOutdoor: venueIO, scaleOrigin: scale.origin };
    // 模板是固定 GLB 外壳，拉伸它只会看起来「什么都没变」：尺寸一变就卸模板、按新尺寸立矩形空壳。
    const resized = Math.abs(before.width - scale.length) > 1e-6 || Math.abs(before.height - scale.width) > 1e-6;
    const leavingPreset = resized && !!before.scenePreset;
    let venue: VenuePlan | null;
    try { venue = (resized ? replaceVenueWithShell(input) : null) ?? raiseVenue(input); }
    catch (error) {
      revertScaleToCanvas();
      failOpenLocalStep('这版没出成');
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这个尺度我立不起来，说一句「12×9」这样告诉我新的长宽。' });
      setPhase('failed'); return;
    }
    if (!venue && resized) {
      revertScaleToCanvas();
      failOpenLocalStep('这版没出成');
      say({ role: 'agent', amber: true, text: '当前场地结构不能只改外框，请先确认场地尺寸或重新建立场地。' });
      setPhase('failed'); return;
    }
    if(venue && hasInvalidRetainedZones(venue.layout)){revertScaleToCanvas();failOpenLocalStep('这版没出成');say({role:'agent',amber:true,text:'现有区域超出新场地范围或坐标不完整，请先调整区域再生成。'});setPhase('failed');return;}
    const candidateBase = venue?.layout ?? before;
    if (venue) {
      const shellSummary = leavingPreset ? '将离开模板，改用矩形场地。' : '场地按这个尺寸准备好了。';
      say({ role: 'agent', text: `${shellSummary}确认后才写入。` });
      await wait(STEP_DELAY_MS); if (token !== runToken.current || !sessionScopeIsCurrent()) return;
      if (!floorStillCurrent(floorToken)) {failOpenLocalStep('这版没出成');say({role:'agent',amber:true,text:'楼层在准备期间已变化，请重新生成。'});setPhase('failed');return;}
      if (!sameLayoutContent(before, live.current)) {
        failOpenLocalStep('这版没出成');
        say({ role: 'agent', amber: true, text: '场景在准备期间发生变化，这版没有应用；请按当前场景重新生成。' });
        setPhase('failed'); return;
      }
    }
    let plan: PlanProposal;
    const anchors = anchorsRef.current;
    const banquet=memoryRef.current.banquetTable;
    const perTable=banquet?.peoplePerTable??((memoryRef.current.seatingShape==='ring'||memoryRef.current.layoutMode==='desk-chair')&&memoryRef.current.localSeatingAllocation?.status==='shared_desk'?memoryRef.current.localSeatingAllocation.peoplePerDesk:undefined);
    const tableRequest=banquet||perTable?{...(banquet?.shape?{shape:banquet.shape}:{}),...(banquet?.width!==undefined?{width:banquet.width}:{}),...(banquet?.depth!==undefined?{depth:banquet.depth}:{}),...(perTable?{peoplePerTable:perTable}:{})}:undefined;
    const furnishing=layoutFurnishing(memoryRef.current.furnishing, banquet);
    const priorBanquetSeats = furnishing && seatPriority ? priorCardSeats.current : null;
    try { plan = localPlan({ base: candidateBase, floorIndex: activeFloorIndex, widthM: scale.length, depthM: scale.width, variant, guests: briefRef.current.guests, seatPriority, layoutMode: briefRef.current.layoutMode, ...(memoryRef.current.seatingShape ? { seatingShape: memoryRef.current.seatingShape } : {}), ...(tableRequest ? { table: tableRequest } : {}), ...(furnishing ? { furnishing } : {}), stage: anchors.stage, checkin: anchors.checkin, requireSeats: memoryRef.current.allGuestsSeated === true, requireRest: memoryRef.current.zoneNeeds.rest === true,
      functionalNeeds: { checkin: memoryRef.current.zoneNeeds.checkin, stage: memoryRef.current.zoneNeeds.stage }, mobilityRequired:memoryRef.current.mobilityRequirement?.decision==='needed', ...(memoryRef.current.mobilityRequirement?.decision==='needed'?{mobilityEvidence:memoryRef.current.mobilityRequirement.evidence}:{}) }); }
    catch (error) {
      failOpenLocalStep('这版没出成');
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这个尺度我摆不出来，说一句「12×9」这样告诉我新的长宽。' });
      setPhase('failed'); return;
    }
    const final = plan.layouts.at(-1);
    if (!final) { failOpenLocalStep('这版没出成'); setPhase('failed'); say({ role: 'agent', amber: true, text: '这次没有生成可审阅的方案，场景没有改变。' }); return; }
    const differences = proposalDifferences(before, final);
    const removing = differences.filter(change => change.kind === 'removed' && change.before && !isStructuralMarker(change.before.item)).length;
    const added = differences.filter(change => change.kind === 'added' && change.after && !isStructuralMarker(change.after.item)).length;
    const lockedChanged = differences.filter(change => change.before?.item.locked && !isStructuralMarker(change.before.item)).length;
    plan = { ...plan, removing, added, ...(lockedChanged ? { blocked: `这版会改动 ${lockedChanged} 件锁定物料，请调整后重新生成。` } : {}), ...(furnishing ? { receipt: 'banquet' as const } : {}) };
    if (priorBanquetSeats !== null && (plan.seats ?? 0) <= priorBanquetSeats && !lockedChanged) {
      const honest = '室内已经排满，这版加不进更多整桌。';
      plan = { ...plan, seatPriority: true, blocked: plan.blocked?.includes('加不进更多') ? plan.blocked : `${honest}${plan.blocked ?? ''}` };
    }
    if(!floorStillCurrent(floorToken)){failOpenLocalStep('这版没出成');say({role:'agent',amber:true,text:'楼层在准备期间已变化，请重新生成。'});setPhase('failed');return;}
    proposalFloor.current=floorToken;setLocalProposal(withPlanArtifact(withCurrentSeatingReview(plan,null), before)); proposalBase.current = structuredClone(before); shownSteps.current = 0;
    await presentProposal(token);
  }

  /** 确认才写 objects：本地一次 applyLayout，进撤销栈，撤销一步能整体退回来。 */
  function confirmProposal(): void {
    if(isHistoryReviewRequired()){say({role:'agent',amber:true,text:'请先核对历史需求并重新生成，再确认布置。'});return;}
    const sessionId=boundSessionId.current;
    if(proposal.current&&proposalSessionRef.current!==sessionId){say({role:'agent',amber:true,text:'这版来自其他会话，不能在当前会话确认；请先撤回旧方案并重新生成。'});return;}
    if(sessionId&&(incompleteDialogueTurns.current.get(sessionId)?.size??0)>0){
      say({role:'agent',amber:true,text:'还有尚未处理的要求，请逐项核对后再生成和确认。'});return;
    }
    if(generationQueuedRef.current>0||generationWait.current||briefRequest.current||pendingModelInputs.current.size>0){
      say({role:'agent',amber:true,text:'还有消息或方案正在处理，请等当前要求处理完成后再确认。'});return;
    }
    if(localDraftOwner.current&&!localDraftAnnotationsCurrent(localDraftOwner.current)){
      say({role:'agent',amber:true,text:'路线、区域或门标注已变化或无法核对，本地草案未应用；请重新生成。'});return;
    }
    if(localDraftOwner.current && !localDraftAllowed(localDraftOwner.current.owner,localDraftOwner.current)){
      say({role:'agent',amber:true,text:'云端连接或本机活动状态已变化，本地草案未应用；请重新核对。'});return;
    }
    if (sessionScope !== 'legacy' && (!isVenueScaleCurrent(memoryRef.current,layoutStore.getState().layout) || !sourceScaleBound(memoryRef.current) || !factScaleBound(memoryRef.current))) { say({role:'agent',amber:true,text:'场地已变化，旧场地尺寸需要重新说明后才能确认。'}); return; }
    if (!sessionScopeIsCurrent()) { say({role:'agent',amber:true,text:'活动已切换，请在当前活动重新核对方案。'}); return; }
    if (callbacks.workbenchMode !== 'layout') {
      say({ role: 'agent', text: '现在不改布置。这一版先留着，回到布置对话再确认。' });
      return;
    }
    if(proposal.current&&!checkProposalFloor())return;
    if ((proposal.current?.kind !== 'review' && !styleProposal.current && memoryRef.current.layoutModeConfirmed !== true) || memoryRef.current.pendingBasicFacts?.length || memoryRef.current.layoutModeUnresolved || memoryRef.current.pendingActivityNeeds.length || memoryRef.current.unresolvedActivityNeeds.length || memoryRef.current.mobilityNeedsClarification || memoryRef.current.mobilityRequirement?.decision==='unknown') {
      say({ role: 'agent', amber: true, text: '还有需求待确认，请先核对后再确认布置。' });
      return;
    }
    const inventoryCandidate=inventoryTarget();
    if(inventoryCandidate){
      const check=checkCandidateInventory(inventoryCandidate.candidate,inventoryFor(inventoryCandidate));
      if(check.status==='violated'||inventoryFor(inventoryCandidate)?.invalidInput){say({role:'agent',amber:true,text:check.message});return;}
    }
    const plan = proposal.current;
    if (!plan) {
      const preservation=reviewOriginalPreservation(memoryRef.current.originalPreservation,studioRef.current?.preview?.layout);
      if(preservation.status==='violated'||preservation.status==='unknown'){say({role:'agent',amber:true,text:preservation.message ?? '原物保留要求尚未核对。'});return;}
      confirmCloud(); return;
    }
    const currentState = layoutStore.getState();
    const currentLayout = currentState.layout;
    const expectedBase = proposalBase.current;
    if (!expectedBase || expectedBase.id !== currentLayout.id || !sameLayoutContent(expectedBase, currentLayout)) {
      invalidateProposal('场景在这期间改过了'); return;
    }
    const style = styleProposal.current;
    if (style && (style.memoryRevision !== memoryRevision.current || style.draftRevision !== zoneDraftRevisionRef.current || style.floorIndex !== currentState.activeFloorIndex || style.sessionId !== boundSessionId.current)) {
      invalidateProposal('活动需求、区域草案或楼层已经变化'); return;
    }
    if (plan.blocked) { say({ role: 'agent', amber: true, text: plan.blocked }); return; }
    const final = plan.layouts[plan.layouts.length - 1];
    if (!final) { invalidateProposal('这一版没有可落盘的候选'); return; }
    const preservation=reviewOriginalPreservation(memoryRef.current.originalPreservation,final);
    if(preservation.status==='violated'||preservation.status==='unknown'){say({role:'agent',amber:true,text:preservation.message ?? '原物保留要求尚未核对。'});return;}
    const seatCheck = seatRequirement(final, activeFloorIndex, memoryRef.current);
    if (seatCheck.blocked) { say({ role: 'agent', amber: true, text: seatCheck.blocked }); return; }
    if (plan.artifact) {
      const check = planIsApplicable(plan.artifact, currentLayout);
      if (!check.ok) { invalidateProposal(PLAN_OBSOLETE_COPY[check.reason]); return; }
      if (!planCoversLayout(plan.artifact, final)) { invalidateProposal(PLAN_OBSOLETE_COPY['layout-mismatch']); return; }
    }
    const floor=proposalFloor.current!;
    // No asynchronous work may separate this final fence from the local apply.
    if(localDraftOwner.current && !localDraftAllowed(localDraftOwner.current.owner,localDraftOwner.current)){
      say({role:'agent',amber:true,text:'云端连接或本机活动状态已变化，本地草案未应用；请重新核对。'});return;
    }
    if(localDraftOwner.current){
      const annotations=readLocalDraftAnnotations();
      if(!annotations){say({role:'agent',amber:true,text:'路线资料无法核对，本地草案未应用。'});return;}
      const routeBlock=localDraftRouteBlock(assessLocalDraftRoutes(currentLayout,final,annotations,currentState.activeFloorIndex));
      if(routeBlock){say({role:'agent',amber:true,text:routeBlock});return;}
    }
    pushLocalLayoutStep('confirm', 'running');
    try { onApply(final, { expectedBase, preserveProvenance: true, expectedFloor:floor }); }
    catch (error) {
      const raw = error instanceof Error ? error.message : '这版放不下，先挪一下场地或物料再重出一版。';
      pushLocalLayoutStep('confirm', 'error', /包围盒重叠|件物料存在冲突/.test(raw) ? '椅子和圆桌叠在一起' : '这版没写上');
      finishLocalLayoutRun();
      say({ role: 'agent', amber: true, text: raw });
      return;
    }
    pushLocalLayoutStep('confirm', 'done');
    pushLocalLayoutStep('applied', 'done');
    finishLocalLayoutRun();
    if (sessionScope !== 'legacy' && (memoryRef.current.lengthM !== null || memoryRef.current.areaM2 !== null)) saveMemory({...memoryRef.current,venueScaleBasis:venueScaleBasis(final),venueFactToken:venueFacts.capture() ?? undefined,scaleNeedsReconfirmation:false});
    let styleHistoryFailed = false;
    if (style) {
      try {
        const storage = window.localStorage;
        const saved = saveStyleRun(style.key, storage);
        styleHistoryFailed = storage.getItem(STYLE_RUNS_KEY) !== JSON.stringify(saved);
      } catch { styleHistoryFailed = true; }
    }
    const added = plan.added;
    const finalFloor = final.floors[Math.min(activeFloorIndex, final.floors.length - 1)];
    const total = finalFloor ? finalFloor.items.filter(item => !isStructuralMarker(item)).length : added;
    const review = plan.kind === 'review';
    const moved = plan.moved ?? 0;
    const skipped = plan.skipped?.length ?? 0;
    const localExploration=!!localDraftOwner.current;
    dropProposal();
    clearFulfilledChip(previewUtterance.current);
    setPhase('ready'); setProgress(GEN_STEPS.length);
    say({ role: 'agent', text: review
      ? `确认了：${moved} 件换了位置，其他没动${skipped ? `；还有 ${skipped} 件没动（锁着或没找到落点）` : ''}。不想要就撤销一步，整体退回原位。`
      : localExploration ? `已写入本机画布：这一版一共 ${total} 件物料，可撤销；尚未确认本机持久化，也未同步云端。门、路线、消防、无障碍和现场条件仍需核验，这只是探索草案，不代表安全通过或可交付。`
      : `写进画布了：这一版一共 ${total} 件物料，都能直接拖；不想要就撤销一步，整体退回来。` });
    if (styleHistoryFailed) say({ role: 'agent', amber: true, text: '布置已应用，但风格历史未能保存。' });
    callbacks.onFit();
  }

  /**
   * 云端那一版的确认也只走这颗绿钮。`applyPreview` 成功会把预览清空、失败留下预览和一句原因，
   * 两者都要等它自己那一帧渲染完才读得到，所以这里只按下开关，结果交给下面的 effect 照实播报。
   */
  function confirmCloud(): void {
    const current = studioRef.current;
    if (!current?.preview) { say({ role: 'agent', amber: true, text: '这版已经不在预览里了，重新出一版再确认。' }); return; }
    if (confirmPending.current) { say({role:'agent',text:'这版正在确认，请稍候；不会重复提交。'}); return; }
    if (current.stale || current.expired) { say({ role: 'agent', amber: true, text: CLOUD_STALE }); return; }
    const check = cloudViewOf(current.preview);
    if (check?.blocked) { say({ role: 'agent', amber: true, text: check.blocked }); return; }
    // 云端还在写、或上一版还在恢复：最后一帧没稳，按下确认不会有回音。
    if (current.busy || current.recoverable) { say({ role: 'agent', text: '这一版还没稳，等它停住再点确认。' }); return; }
    confirmPending.current = true;
    void current.applyPreview();
  }

  useEffect(() => {
    if (!confirmPending.current) return;
    const current = studioRef.current;
    if (!current || current.busy) return;
    confirmPending.current = false;
    if (current.applyRecovery) {
      setPhase('idle'); setProgress(0);
      say({ role: 'agent', amber: true, text: cloudRecoveryMessage(current.applyRecovery) });
      return;
    }
    if (current.preview) {
      say({ role: 'agent', amber: true, text: current.notice ? `没写进画布：${current.notice}` : '这版没写进画布，画布还是你确认前的样子。改一下场地或重新出一版。' });
      return;
    }
    clearFulfilledChip(previewUtterance.current);
    setPhase('ready'); setProgress(GEN_STEPS.length);
    say({ role: 'agent', amber: !!current.notice, text: `写进画布了，物料都能直接拖；不想要就撤销一步，整体退回来。${current.notice ? ` ${current.notice}。` : ''}` });
    callbacks.onFit();
  }, [studio?.preview, studio?.busy, studio?.applyRecovery]); // eslint-disable-line react-hooks/exhaustive-deps

  // 深工具（活动需求表）走出的云预览也要落到这张卡上，否则画布有预览、右栏没有唯一的确认。
  useEffect(() => {
    const preview = studio?.preview ?? null;
    if (!preview) { announcedPreview.current = null; return; }
    if(suppressCancelledCloudPreview.current)return;
    if (phase === 'paused' || (phase === 'generating' && (lastSource.current !== 'cloud' || studio?.busy || studio?.recoverable))) return;
    if (proposal.current) return;
    adoptCloudProposal();
  }, [studio?.preview, studio?.stale, studio?.expired, studio?.busy, studio?.recoverable, studio?.applyRecovery, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function withdrawProposal(): void {
    const cloud = proposal.current === null && !!studioRef.current?.preview;
    const review = proposal.current?.kind === 'review';
    dropProposal(); discardCloudPreview();
    setPhase('idle'); setProgress(0);
    say({ role: 'agent', text: review
      ? '撤了：预览收回，物件都还在原位。想再体检就说一句「看看哪里有问题」。'
      : `撤了，物料没动${cloud ? '，云端那一版也作废了' : ''}。想再看一版就说「换一版」。` });
  }

  /** 人工改过场景 → 旧提案失效（对齐现有 propose/apply 契约）。 */
  function invalidateProposal(reason: string): void {
    dropProposal(); setPhase('idle'); setProgress(0);
    say({ role: 'agent', amber: true, text: `${reason}，这版预览先作废。说一句「看看哪里有问题」或「换一版」，我按现在的场地重新来。` });
  }

  /** 云端算完这一趟，把它的预览接到右栏这张卡上；没有可确认的一版就返回 false。 */
  function adoptCloudProposal(): boolean {
    if(suppressCancelledCloudPreview.current)return false;
    const preview = studioRef.current?.preview ?? null;
    const view = cloudViewOf(preview);
    if (!view) return false;
    if (announcedPreview.current === preview && phaseRef.current === 'proposed') return true;
    announcedPreview.current = preview;
    lastSource.current = 'cloud';
    setProgress(GEN_STEPS.length); setPhase('proposed');
    say({ role: 'agent', amber: !!view.blocked, text: view.blocked
      ? `云端给了一版，结果明细在下面。${view.blocked}`
      : '云端给了一版，结果明细在下面。画布上是预览，还没落盘，点「确认布置」才写进画布。' });
    return true;
  }

  /** 把需求原话说给云端，并要它只回一份待确认的提案（requirePreview：确认前 objects 不落盘）。 */
  async function cloudRun(note: string): Promise<UnchangedRunResult|void> {
    const current = studioRef.current;
    if (!current) return;
    const allocation=cloudSeatingAllocation(memoryRef.current);
    const specs=cloudSeatingSpecs(memoryRef.current);
    return await current.generate(cloudBriefMessage(note || '请出布置方案', memoryRef.current), { requirePreview: true,...(allocation?{seatingAllocation:allocation}:{}),...(specs?{seatingSpecs:specs}:{}) });
  }

  function cloudScaleMatches(scale:Scale):boolean {
    const current=layoutStore.getState().layout;
    const memory=memoryRef.current;
    const mismatch=venueDimensionsMismatch(memory,current);
    if(mismatch){say({role:'agent',amber:true,text:mismatch});return false;}
    // Area-derived dimensions are only a preview convention, not the user's requested shape.
    if(scale.origin==='area'){
      if(memory.areaM2!==null)return true;
      say({role:'agent',amber:true,text:'场地面积暂时无法核对，请先重新说明活动面积。'});return false;
    }
    if(Math.abs(current.width-scale.length)<=1e-6&&Math.abs(current.height-scale.width)<=1e-6)return true;
    say({role:'agent',amber:true,text:`你要求按 ${formatArea(scale.length)} × ${formatArea(scale.width)} 米布置，但当前场地是 ${formatArea(current.width)} × ${formatArea(current.height)} 米。本次没有提交生成，请先在空间中调整或重新确认场地尺寸。`});
    return false;
  }

  /** 出方案：连着云项目就让云端真 AI 算这一版，否则本地算候选。两条都停在「这版还在预览」。 */
  async function startGeneration(token: number, variant: number, note: string, scale: Scale, seatPriority = false): Promise<void> {
    if(isHistoryReviewRequired()){say({role:'agent',amber:true,text:'请先核对历史需求，再重新生成方案。'});setPhase('failed');return;}
    if (memoryRef.current.layoutModeConfirmed !== true || memoryRef.current.pendingBasicFacts?.length || memoryRef.current.layoutModeUnresolved || memoryRef.current.pendingActivityNeeds.length || memoryRef.current.unresolvedActivityNeeds.some(kind=>!(memoryRef.current.deferredActivityNeeds??[]).includes(kind)) || memoryRef.current.mobilityNeedsClarification || memoryRef.current.mobilityRequirement?.decision==='unknown') {
      say({ role: 'agent', amber: true, text: '还有需求待确认，请先核对后再生成方案。' });
      setPhase('failed'); return;
    }
    try {
      if (forceFail()) throw new Error('forced');
      if(/(?:本地|本机)草案/.test(note)) {
        lastSource.current='local';
        await runLocal(token,variant,scale,seatPriority,note);
        return;
      }
      if (studioRef.current?.connection === '项目已连接' && memoryRef.current.furnishing?.source !== 'select_furnishing') {
        if(!cloudScaleMatches(scale)){setPhase('failed');return;}
        suppressCancelledCloudPreview.current=false;
        lastSource.current = 'cloud'; setProgress(1);
        const conversationId=getActiveAssistantSessionId(sessionScope),boundId=boundSessionId.current;
        const result=await cloudRun(note);
        if(token===runToken.current&&sessionScopeIsCurrent()&&boundSessionId.current===boundId&&getActiveAssistantSessionId(sessionScope)===conversationId){
          if(result?.kind==='unchanged'){setPhase('idle');setProgress(0);say({role:'agent',amber:true,text:result.message});}
          else if(!adoptCloudProposal())setPhase('failed');
        }
        return;
      }
      lastSource.current = 'local';
      await runLocal(token, variant, scale, seatPriority);
    }
    catch { if (token === runToken.current) { failOpenLocalStep('这版没出成'); setPhase('failed'); } }
  }

  /** Wait only for the current run; an unresponsive provider must not block chat forever. */
  function trackGeneration(task:Promise<void>):void {
    generationWait.current?.cancel();
    const token=runToken.current;let release!:()=>void;
    const interrupted=new Promise<void>(resolve=>{release=resolve;});
    // Cloud tasks have a 90-second server deadline; let their status settle before cancelling.
    const waitMs=studioRef.current?.connection==='项目已连接'?100_000:60_000;
    const timer=window.setTimeout(()=>{
      if(token===runToken.current){runToken.current++;setPhase('failed');if(lastSource.current==='cloud')void studioRef.current?.cancelRun();say({role:'agent',amber:true,text:'这次生成等待超时，画布未自动应用；服务商可能仍在处理，请核对后再试。'});}
      release();
    },waitMs);
    const entry={promise:Promise.resolve(),cancel:release};
    entry.promise=Promise.race([task,interrupted]).catch(()=>{if(token===runToken.current){setPhase('failed');say({role:'agent',amber:true,text:'这次生成未完成，请核对后重试。'});}}).finally(()=>{window.clearTimeout(timer);if(generationWait.current===entry)generationWait.current=null;});
    generationWait.current=entry;
  }
  async function waitForGeneration():Promise<void> {
    for(;;){const current=generationWait.current;if(!current)return;await current.promise;}
  }

  /** 生成只有一次触发：对话。这里是被认可后真正跑那一趟的唯一入口，画布上只出预览。 */
  const localDraftIntent = useRef<string|null>(null);
  /** Seat count on the card before add-seats clears it. `dropProposal` runs first otherwise. */
  const priorCardSeats = useRef<number | null>(null);
  function runGeneration(label: string | null, variant: number, note: string, scale: Scale, seatPriority = false): void {
    if (!sessionScopeIsCurrent()) return;
    if (sessionScope !== 'legacy' && (!isVenueScaleCurrent(memoryRef.current,layoutStore.getState().layout) || !sourceScaleBound(memoryRef.current) || !factScaleBound(memoryRef.current))) { finishLayoutAttempt(false); say({role:'agent',amber:true,text:'场地已变化，请重新说明当前场地尺寸。'}); return; }
    priorCardSeats.current = seatPriority && typeof proposal.current?.seats === 'number' ? proposal.current.seats : null;
    beginLayoutAttempt(previewUtterance.current || note || label || '', memoryRef.current.furnishing?.source !== 'select_furnishing' && studioRef.current?.connection === '项目已连接');
    localDraftIntent.current=/(?:本地|本机)草案/.test(note)?note:null;
    const token = ++runToken.current;
    if (label) say({ role: 'user', text: label });
    setIssue(null); dropProposal(); discardCloudPreview(); setExportPreview(false); phaseRef.current='generating';setPhase('generating'); setProgress(0);
    trackGeneration(startGeneration(token, variant, note, scale, seatPriority));
  }

  /** 「这次没出成」那张卡上的重试：拿现在的读数再跑一遍，不另算一个入口。 */
  function standingHall(): { length: number; width: number } | null {
    if (!venueIsUp()) return null;
    return { length: live.current.width, width: live.current.height };
  }
  function shellVenueIO(layout: RoomLayout): 'indoor' | 'outdoor' | null {
    const value = layout.backendSceneV2?.venue?.site?.indoorOutdoor;
    return value === 'indoor' || value === 'outdoor' ? value : null;
  }
  function followUpScale(): Scale {
    const canvas = readScale();
    const picked = eventPreviewScale({ ...canvas, fromVenue: venueIsUp() }, memoryRef.current, standingHall());
    return { length: picked.length, width: picked.width, origin: picked.origin };
  }
  function retry(): void { runGeneration('重试', seed.current, localDraftIntent.current??'', followUpScale()); }
  /** 停一下：只收预览，画布退回确认前状态；提案留着，「接着摆」能续上。 */
  function stop(): void {
    if (phaseRef.current !== 'generating' && !generationWait.current) return;
    if (lastSource.current === 'cloud') requestAgentStop();
    layoutAttempt.current=false;setToolPending(false);
    runToken.current++;
    generationWait.current?.cancel();
    const current = studioRef.current;
    if (lastSource.current === 'cloud' && current) {
      suppressCancelledCloudPreview.current=true;
      void current.cancelRun();
      phaseRef.current='idle';setPhase('idle'); setProgress(0);
      say({ role: 'agent', text: '已请求停止云端任务，画布没动；服务商可能仍在处理或计费，请核对状态。' });
      return;
    }
    const local = proposal.current !== null;
    if (local) hidePreview();
    phaseRef.current='paused';setPhase('paused');
    say({ role: 'agent', text: local ? '先停在这儿了，预览收回、画布没动。要接着看就点「接着摆」。' : '先停在这儿了，画布没动。' });
  }
  function resume(): void {
    if (phase !== 'paused') return;
    if (proposal.current) { trackGeneration(presentProposal(++runToken.current)); return; }
    regenerate('接着摆');
  }
  function regenerate(label = '换一版'): void {
    seed.current += 1;
    runGeneration(label, seed.current, localDraftIntent.current??(label === '换一版' ? '换一版不同的布局' : ''), followUpScale());
  }
  /** 座位不够时的一点击改法：同一份需求按座位优先重排，仍然只出预览，确认前不落盘。 */
  function addSeats(): void {
    runGeneration('加座，再排一版', seed.current, '', followUpScale(), true);
  }

  /** T-UI §4-5：导出/交接意图先落预览卡，确认后才在本机直接生成；不跳执行页。 */
  /** 生成中、云端忙、恢复中、预览过期或基线变了：最后一帧没稳，不亮任何确认。 */
  function previewUnsettled(): boolean {
    const current = studioRef.current;
    if (phaseRef.current === 'generating' || phaseRef.current === 'paused') return true;
    if (current?.busy || current?.recoverable) return true;
    return !!(current?.preview && (current.stale || current.expired));
  }

  /** Export reads the applied layout; a visible candidate is a different version. */
  function pendingCandidateBlocksExport(): boolean {
    return proposal.current !== null || !!studioRef.current?.preview;
  }

  function refusePendingCandidateExport(): boolean {
    if (!pendingCandidateBlocksExport()) return false;
    setExportPreview(false);
    say({ role: 'agent', amber: true, text: '当前有尚未应用的方案预览；导出读取的是原场景。请先确认布置或撤回预览，再导出。' });
    return true;
  }

  function proposeExport(): void {
    if (refusePendingCandidateExport()) return;
    if (previewUnsettled()) {
      say({ role: 'agent', amber: true, text: '这一版还没稳，确认先不亮。等预览停住再说导出。' });
      return;
    }
    setExportPreview(true);
    say({ role: 'agent', text: '执行资料草案使用执行页已保存的手工需求、物料、制作和点验，不完整包含本次对话需求。请对照当前对话及现场条件核对后再交付。' });
  }

  function confirmExport(): void {
    if (refusePendingCandidateExport()) return;
    if (previewUnsettled()) { setExportPreview(false); say({role:'agent',amber:true,text:'当前方案仍在处理，请完成后再导出。'}); return; }
    setExportPreview(false);
    const studio = studioRef.current;
    if (!studio?.exportActivity) {
      say({ role: 'agent', amber: true, text: '导出入口还没就绪，稍后再试。' });
      return;
    }
    // 对话交接要求「按当前记录核对过」的冻结标记；「确认导出」本身就是核对动作，
    // 先按同一套判定补上这一步再生成，而不是让导出吃一条无法理解的报错。
    if (isHistoryReviewRequired() && !freezeDialogueForExport()) {
      say({ role: 'agent', amber: true, text: '对话记录还没核对完成（有待处理的要求或任务进行中），未生成交接文件。处理完再导出。' });
      return;
    }
    say({ role: 'agent', text: '好，我在本机生成执行资料草案。' });
    void studio.exportActivity().then(() => {
      say({ role: 'agent', text: '执行资料草案已发起下载，可离线打开与打印。请核对手工需求与当前对话；出口、尺度、通行、消防和无障碍等条件仍需核验。' });
    }).catch(error => {
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '导出没成，资料都还在，再试一次。' });
    });
  }

  function confirmCloudMaterialDraft(): void {
    if(refusePendingCandidateExport())return;
    if(previewUnsettled()){say({role:'agent',amber:true,text:'这一版还没稳，请先处理预览再导出草案。'});return;}
    const studio=studioRef.current;
    if(!studio?.cloudMaterialDraftAvailable || !studio.exportCloudMaterialDraft){say({role:'agent',amber:true,text:'当前没有可导出的云项目物料草案。'});return;}
    void studio.exportCloudMaterialDraft().then(()=>{
      if(!sessionScopeIsCurrent())return;
      setExportPreview(false);say({role:'agent',text:'当前场景物料清单草案已发起下载。文件未冻结，不包含完整活动需求与点验；模型、实物和现场条件仍需核验。'});
    }).catch(error=>{if(sessionScopeIsCurrent())say({role:'agent',amber:true,text:error instanceof Error?error.message:'物料草案未导出，请核对当前项目后重试。'});});
  }

  function dismissExport(): void {
    setExportPreview(false);
    say({ role: 'agent', text: '好，先不导出。要导的时候说一声就行。' });
  }

  const handledHandoffExport = useRef(handoffExportRequest);
  useEffect(() => {
    if (handoffExportRequest === handledHandoffExport.current) return;
    handledHandoffExport.current = handoffExportRequest;
    if (handoffExportRequest > 0) proposeExport();
  }, [handoffExportRequest]);

  /** Read-only questions share the existing turn queue; they never mutate the brief or scene. */
  async function answerGeneralQuestion(text:string):Promise<void> {
    const controller=studioRef.current?.controller;
    if(!controller || typeof controller.assistantChat!=='function') {say({role:'agent',amber:true,text:'活动问答暂未连接，问题已保留。'});return;}
    const request={controller:new AbortController(),text};
    const session=boundSessionId.current,sequence=briefTurnSequence.current,prior=briefTurnTail.current;
    if(!session||getActiveAssistantSessionId(sessionScope)!==session){say({role:'agent',amber:true,text:'会话正在切换，请在当前会话重新发送。'});return;}
    const history=chatUserHistory(bubblesRef.current.slice(0,-1),text);
    pendingModelInputs.current.add(text);
    let release!:()=>void;
    briefTurnTail.current=new Promise<void>(resolve=>{release=resolve;});
    const current=()=>!request.controller.signal.aborted&&sessionScopeIsCurrent()&&boundSessionId.current===session&&getActiveAssistantSessionId(sessionScope)===session&&briefTurnSequence.current===sequence;
    try {
      await prior;await waitForGeneration();if(!current())return;
      briefRequest.current=request;setUnderstanding(true);
      const cancelled=new Promise<never>((_,reject)=>request.controller.signal.addEventListener('abort',()=>reject(new DOMException('已停止等待','AbortError')),{once:true}));
      const result=await Promise.race([controller.assistantChat(text,history,request.controller.signal),cancelled]);
      if(!current())return;
      if(result.status==='ok')say({role:'agent',text:result.answer,modelConversation:true});
      else {
        if(result.status==='timeout'||result.status==='provider_error')uncertainInputs.current.add(text);
        const message=result.status==='invalid'?'问题或近期对话中含链接、敏感信息或超出长度，请调整后再试。':result.status==='disabled'||result.status==='unavailable'?'活动问答暂未启用，问题已保留。':'这次问答没有完成；服务商可能仍在处理或计费，请核对后再试。';
        say({role:'agent',amber:true,text:message});
      }
    } catch {
      if(current()){uncertainInputs.current.add(text);say({role:'agent',amber:true,text:'这次问答没有完成；服务商可能仍在处理或计费，请核对后再试。'});}
    } finally {pendingModelInputs.current.delete(text);if(briefRequest.current===request){briefRequest.current=null;setUnderstanding(false);}release();}
  }

  async function sendCore(text: string, allowUncertainRetry=false, queued=false, queuedAttachment?:{file:File;url:string}|null, queuedHistory?:Array<{role:'user'|'assistant';text:string}>): Promise<void> {
    if (pendingModelInputs.current.has(text.trim())) return;
    if (!allowUncertainRetry && uncertainInputs.current.has(text.trim())) {setRetryUncertain(text.trim());return;}
    if (!sessionScopeIsCurrent()) { say({role:'agent',amber:true,text:'活动已切换，请在当前活动重新发送。'}); return; }
    // 图纸/照片先在输入框里等：这一句发出去时才算读过、才铺底图；纯发文件也算一步。
    const attachment = queued ? queuedAttachment??null : pendingFile;
    if (attachment) setPendingFile(null);
    const trimmed = text.trim();
    if (!trimmed && !attachment) return;
    if (!attachment && isExplicitProposalConfirmation(trimmed)) {
      if(!queued)say({role:'user',text:trimmed});
      if(queued||briefRequest.current||pendingModelInputs.current.size>0||generationWait.current){
        say({role:'agent',amber:true,text:'当前还有请求在处理，请等当前预览稳定后重新确认；本次没有应用。'});return;
      }
      const memory=memoryRef.current;
      if(memory.pendingBasicFacts?.length||memory.pendingActivityNeeds.length||memory.unresolvedActivityNeeds.length||memory.layoutModeUnresolved||memory.mobilityNeedsClarification||memory.mobilityRequirement?.decision==='unknown'){
        say({role:'agent',amber:true,text:'还有需求待确认，请先核对后再确认布置。'});return;
      }
      if(phaseRef.current!=='proposed'||(!proposal.current&&!studioRef.current?.preview)){
        say({role:'agent',amber:true,text:'当前没有可确认的布置预览。说一下想怎么摆，我再出一版给你确认。'});return;
      }
      confirmProposal();return;
    }
    if(memoryRef.current.pendingGeneration && !/^(对|是|确认|没错|是的|好的|可以)$/.test(trimmed)){
      saveMemory({...memoryRef.current,pendingGeneration:undefined});
    }
    if(!queued&&generationWait.current&&isStopCommand(trimmed)){
      say({role:'user',text:trimmed});stop();return;
    }
    if(!queued && researchRequest.current && isStopCommand(trimmed)){
      say({role:'user',text:trimmed});researchRequest.current.abort();say({role:'agent',text:'已停止调研，本次没有铺设底图。'});return;
    }
    if(!queued&&generationWait.current){
      if(trimmed)say({role:'user',text:trimmed});
      const history=chatUserHistory(bubblesRef.current.slice(0,-1),trimmed);
      const session=boundSessionId.current,sequence=briefTurnSequence.current,floor=floorSession.capture();
      generationQueuedRef.current++;
      setGenerationQueued(value=>value+1);
      const work=async()=>{
        try{
          await waitForGeneration();
          await briefTurnTail.current;
          if(!sessionScopeIsCurrent()||session!==boundSessionId.current||sequence!==briefTurnSequence.current||!floorSession.isCurrent(floor))return;
          await sendLatest.current(trimmed,allowUncertainRetry,true,attachment,history);
          await waitForGeneration();
        }finally{generationQueuedRef.current=Math.max(0,generationQueuedRef.current-1);setGenerationQueued(value=>Math.max(0,value-1));}
      };
      const next=generationFollowups.current.then(work,work);generationFollowups.current=next.catch(()=>{});return next;
    }
    if (attachment) {
      await acceptFile(attachment.file);
      if (!sessionScopeIsCurrent() || !trimmed) return;
    }
    // 「停一下」是命令，不是需求：正在摆就停手，摆好了还没确认就撤回，别把它当成一句话记进简报。
    if (isStopCommand(trimmed) && (phase === 'generating' || phase === 'proposed' || phase === 'paused')) {
      if(!queued)say({ role: 'user', text: trimmed });
      if (phase === 'generating') stop(); else withdrawProposal();
      return;
    }
    if(!queued)say({ role: 'user', text: trimmed });
    if (isBanquetUtterance(trimmed) || isBanquetSession(memoryRef.current)) setBanquetChat(true);
    if(isPureGreeting(trimmed)){say({role:'agent',text:'你好，我可以帮你梳理活动需求、查看方案或准备布置。'});return;}
    const keepOriginals=preservationIntent(trimmed);
    if(keepOriginals){
      if(keepOriginals.keepAll){
        const requirement=captureOriginalPreservation(layoutStore.getState().layout,trimmed,keepOriginals.keepPositions);
        if(!requirement){say({role:'agent',amber:true,text:'当前活动或原物身份无法核对，请先保存活动后重新说明保留要求。'});return;}
        saveMemory({...memoryRef.current,originalPreservation:requirement});syncMemory(memoryRef.current);
        say({role:'agent',text:keepOriginals.keepPositions?'已记录：保留当前原有物件，且位置和方向不变。':'已记录：保留当前原有物件，不删除；是否移动仍按你的后续要求处理。'});
      }else{
        const {originalPreservation:_removed,...rest}=memoryRef.current;
        saveMemory(rest);syncMemory(memoryRef.current);
        say({role:'agent',text:'已取消此前的全部原物保留要求；这不会自动删除物件。'});
      }
      if(isStandalonePreservationInstruction(trimmed))return;
    }
    const unifiedConversation=process.env.NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED==='1';
    const turnHistory=queued?(queuedHistory??[]):chatUserHistory(bubblesRef.current.slice(0,-1),trimmed);
    if(!unifiedConversation && process.env.NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED==='1' && !attachment && isGeneralActivityQuestion(trimmed)) {await answerGeneralQuestion(trimmed);return;}
    const mixedUtility=hasMixedUtilityCommand(trimmed);
    if(mixedUtility)updateDialogueIncomplete(boundSessionId.current,trimmed,true);
    if (callbacks.workbenchMode !== 'layout') {
      if(mixedUtility){say({role:'agent',amber:true,text:'这句话包含多项要求，请回到活动对话继续；原话已保留，本次没有执行。'});return;}
      if (isClientReviewCommand(trimmed)) {
        callbacks.onOpenReview();
        say({ role: 'agent', text: '评审页在左边开了：离线 HTML 或云端只读链接，都由你发。' });
        return;
      }
      if (isExportCommand(trimmed)) { proposeExport(); return; }
      if (isMaterialListCommand(trimmed)) { replyMaterialList(); return; }
      say({ role: 'agent', text: '这里只看方案，不改布置。要挪物料，回到布置对话再说。' });
      return;
    }
    if(mixedUtility)say({role:'agent',amber:true,text:'我先理解这句话中的活动需求；清单、检查、评审或导出操作暂未执行。'});
    if(!mixedUtility){
    // 当前户外任务优先承接自然确认/取消，不要求按钮或暗号，也不派给第二个 Agent。
    if (isStopCommand(trimmed) && (venuePick || routeBusy || routeProposal || zoneProposal || flowSimActive || manualVenueAnchorRef.current)) { stopOutdoorTask(); return; }
    if (/不要(?:这版|这个|方案)|取消(?:预览|这版)|放弃(?:这版|预览)/u.test(trimmed)) {
      if (routeProposal) { dismissRouteProposal(); return; }
      if (zoneProposal) { dismissZoneProposal(); return; }
    }
    if (venuePick && !venuePick.loading && !venuePick.picking) {
      const ordinal = trimmed.match(/(?:第|选|用|就)([一二三四五12345])(?:个|项)?/u)?.[1];
      const index = ordinal ? '一二三四五'.indexOf(ordinal) >= 0 ? '一二三四五'.indexOf(ordinal) : Number(ordinal) - 1 : -1;
      const named = venuePick.candidates.filter(place => trimmed.includes(place.name));
      const selected = index >= 0 ? venuePick.candidates[index] : named.length === 1 ? named[0] : undefined;
      if (selected) { await handleVenuePick(selected); return; }
      if (isAffirmativeIntent(trimmed)) {
        if (venuePick.candidates.length === 1) await handleVenuePick(venuePick.candidates[0]!);
        else say({ role: 'agent', text: '请告诉我是哪个候选地点（名称或第几个），以免认错场地。' });
        return;
      }
    }
    // 「回好自动落区」：用户直接说「好 / 可以 / 圈吧」时，若上一条 agent 给过「要不要帮你圈出来」提议，
    // 就在这里把默认 zone 矩形落到 2D 草案，不再走 brief-agent 解析。非 layout 模式不触发，避免误动画布。
    if (isAffirmativeIntent(trimmed)) {
      if (outdoorKindRef.current === 'route' && routeProposal) { confirmRouteProposal(); return; }
      if (outdoorKindRef.current === 'zone' && zoneProposal) { confirmZoneProposal(); return; }
      const lastAgent = [...bubblesRef.current].reverse().find(b => b.role === 'agent');
      if (lastAgent && hasZoneApplyProposal(lastAgent.text)) {
        if (lastAgent.zoneApply) lastAgent.zoneApply.run();
        else say({ role: 'agent', amber: true, text: '这条区域建议已过期，请重新说明需要的区域。' });
        return;
      }
    }
    // 「按图纸估」= 说完了就往下走：估完尺寸直接出预览，不再让人补一句「出方案」。
    if (isEstimateCommand(trimmed)) {
      // 「300 平米，按图纸估」是一句话里的两件事：这句的面积要先记进记忆，估算才不会退回画布上的旧尺寸。
      const statedArea = parseBriefSentence(trimmed).areaM2;
      if (statedArea !== null) saveMemory({ ...memoryRef.current, areaM2: statedArea });
      estimateAndGenerate();
      return;
    }
    // 「调研西湖」：先把地名换成坐标，查到的参考底图铺进 3D，同一张图也贴进对话。
    const researchQuery = matchResearchCommand(trimmed);
    if (researchQuery) {
      await runResearchCommand(researchQuery);
      return;
    }
    // V-1a：场地意图先于 brief 管线——「在潮乐之城去做设计」不是活动描述，是选场地。
    // 'ask' = 说了场地但没说清是哪儿，反问一句；抓到地名则开回显确认卡（V-1b）。
    const venueName = matchVenueCommand(trimmed);
    if (venueName === 'ask') {
      beginOutdoorTask('venue');
      say({ role: 'agent', amber: true, text: '想在哪块场地做？说一个场地名（比如「在西湖做设计」），我帮你找出来确认。' });
      return;
    }
    if (venueName) {
      const epoch = beginOutdoorTask('venue');
      setOutdoorTask({ intent: `在「${venueName}」做设计`, state: 'working', action: '检索场地候选', steps: ['理解场地名'] });
      setVenuePick({ epoch, query: venueName, candidates: [], loading: true, picking: null });
      say({ role: 'agent', text: `我理解为「${venueName}」，先找一下这个场地——下面点一个候选确认是真实场地，我再把它设为活动场地。` });
      return;
    }
    // V-2c/d：流线提案——「排流线/自动排入口」读路网生成草案，虚线预览等确认。
    if (matchRouteCommand(trimmed)) {
      await proposeRoutePlan();
      return;
    }
    // V-3：区域提案——「分区/排区域」按入场朝向分带生成区域+物料草案，虚线预览等确认。
    const outdoorEventTurn = routeBridgeRef.current?.getPlan() ? parseOutdoorEventTurn(trimmed, memoryRef.current.event ?? null) : null;
    if (matchZoneCommand(trimmed) || outdoorEventTurn) {
      const stated = parseBriefSentence(trimmed);
      if (outdoorEventTurn) saveMemory({ ...memoryRef.current,
        ...(outdoorEventTurn.event ? { event: outdoorEventTurn.event } : {}),
        ...(outdoorEventTurn.headcount != null ? { headcount: outdoorEventTurn.headcount } : {}) });
      else saveMemory({ ...memoryRef.current, ...(stated.event ? { event: stated.event } : {}), ...(stated.headcount ? { headcount: stated.headcount } : {}) });
      await proposeZonePlan();
      return;
    }
    // 模型需求仍由同一个 Agent 接收；只定位设施与原位候选，不自动创建收费任务。
    if (routeBridgeRef.current?.getPlan() && ((/模型|三维|3D/iu.test(trimmed) && /查看|看看|换|生成|上传/iu.test(trimmed)) || (/生成|上传/iu.test(trimmed) && routeBridgeRef.current.getPlan()!.facilities.some(f => trimmed.includes(f.name))))) {
      beginOutdoorTask('model');
      const facilities = routeBridgeRef.current.getPlan()!.facilities;
      const target = facilities.find(f => trimmed.includes(f.name))
        ?? facilities.find(f => /舞台|讲台/u.test(trimmed) && /舞台|讲台/u.test(f.name))
        ?? (facilities.length === 1 ? facilities[0] : undefined);
      if (target && routeBridgeRef.current.inspectFacility?.(target.id)) {
        setOutdoorTask({ intent: trimmed, state: 'ready', action: `已选中「${target.name}」，在属性卡查看候选、生成或上传；不会自动收费`, steps: ['确认当前户外设施'], focusFacilityId: target.id });
      } else setOutdoorTask({ intent: trimmed, state: 'blocked', action: '请先在画布选中目标设施，或告诉我它的名称；不会另起生成任务', steps: [] });
      return;
    }
    // V-4a：子出入口——「补子出入口」给已有分区接驳主流线（复用流线提案通道）。
    if (matchSubEntranceCommand(trimmed)) {
      await proposeSubEntrances();
      return;
    }
    // V-4b：流动模拟开关。
    if (/开始模拟|启动模拟|模拟人流|流动模拟|跑一下模拟/u.test(trimmed)) {
      startFlowSim();
      return;
    }
    if (/停止模拟|停下模拟|关掉模拟|结束模拟/u.test(trimmed)) {
      stopFlowSim();
      return;
    }
    // 左栏那几件事先改走对话：加物料、出清单、写文案、换区，不再开第二套表单页。
    const aholo = prepareAholoAsk(trimmed);
    if (aholo) {
      const step = aholoChatStep(aholo.kind, {
        spaceEntry: Boolean(callbacks.luxToolsVisible && callbacks.onOpenLux3d),
        materialReady: studioRef.current?.connection === '项目已连接' || isLux3dLocalProxy(),
      }, aholo.title === '图片物件');
      if (step.start === 'space-world') callbacks.onOpenLux3d?.('world', aholo.prompt);
      else if (step.start === 'space-recon') callbacks.onOpenLux3d?.('recon', aholo.prompt);
      else if (step.start === 'material') {
        if (routeBridgeRef.current?.getPlan()) { setOutdoorTask({ intent: trimmed, state: 'blocked', action: '请先选中户外设施，在同一属性卡查看候选、生成或上传；本次未另起收费任务', steps: [] }); return; }
        stageMaterialGenerate({ kind: aholo.title === '图片物件' ? 'image' : 'text', prompt: aholo.prompt });
        callbacks.onOpenMaterials();
      }
      say({ role: 'agent', text: step.text });
      return;
    }
    // 按对象改（挪舞台/加灯/删除）走增量命令；普通「加两把椅子」仍走下面的物料请求。
    const mentionsRecolor=/(?:换成|改成|变成|换为|改为|涂成|刷成)[^，。；,;]{1,16}色|(?:涂成|刷成)/.test(trimmed.replace(/\s+/g,''));
    const safeRecolor=mentionsRecolor?parseSafeRecolor(trimmed):null;
    if(mentionsRecolor&&!safeRecolor){markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'颜色或要求不明确，请单独说明物件和要改成的颜色；本次没有修改画布。'});return;}
    const mentionsRotation=/(?:旋转|转动|顺时针|逆时针|(?:把|将).{1,20}转\d)/.test(trimmed.replace(/\s+/g,''));
    const safeRotation=mentionsRotation?parseSafeRotation(trimmed):null;
    if(mentionsRotation&&!safeRotation){markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'旋转方向、角度或要求不明确，请单独说明物件、顺时针或逆时针和准确角度；本次没有修改画布。'});return;}
    const directionalMove = /(?:往|向|朝)(?:东|西|南|北|左|右|前|后)(?:边|侧|方)?(?:挪|移动|平移|移|搬)|(?:挪|移动|平移|移|搬)(?:到|至)?(?:东|西|南|北|左|右|前|后)/.test(trimmed.replace(/\s+/g,''));
    const safeMove = directionalMove ? parseSafeDirectionalMove(trimmed) : null;
    if (directionalMove && !safeMove && hasMixedActivityRequirements(trimmed)) {
      markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'这句话同时包含物件修改和活动需求，请分开发送；本次没有修改画布或需求。'}); return;
    }
    if (directionalMove && !safeMove) {
      markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'移动距离或要求不明确，请单独说明物件、方向和准确距离（米、厘米或毫米）；本次没有修改画布。'}); return;
    }
    const revision = safeMove ? {ops:[safeMove],bands:[]} : safeRotation ? {ops:[safeRotation],bands:[]} : safeRecolor ? {ops:[safeRecolor],bands:[]} : parseRevisionRequest(trimmed);
    if (/(?:放大|缩小|缩放|变大|变小)/.test(trimmed)) {
      const scale = revision?.ops.length === 1 && revision.ops[0]?.kind === 'scale' ? revision.ops[0] : null;
      if (!scale || /(?:不要|不用|别|勿|暂不|暂时|不确定|可能|也许|是否|待定|看情况|[?？，,；;])/.test(trimmed) ||
        (/缩小|变小/.test(trimmed) && scale.factor >= 1) || (/放大|变大/.test(trimmed) && scale.factor <= 1)) {
        markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'缩放倍数或要求不明确，请单独说明物件与准确倍数或百分比；本次没有修改画布。'}); return;
      }
    }
    const request = parseMaterialRequest(trimmed);
    const count = explicitAdditionCount(trimmed);
    const additionLimit = revision?.ops.some(op => op.kind === 'add') ? 20 : 50;
    if ((revision || request) && count !== null && (!Number.isSafeInteger(count) || count < 1 || count > additionLimit)) {
      markUnresolvedModification(trimmed);say({ role: 'agent', amber: true, text: `你要求添加 ${count} 件，单次支持 1 至 ${additionLimit} 件；请调整数量后重试，本次没有修改画布。` }); return;
    }
    if ((revision || request) && needsMaterialCommandClarification(trimmed, !!revision, !!request)) {
      markUnresolvedModification(trimmed);say({ role: 'agent', amber: true, text: '物料增减的意思尚不明确，请逐件说明要加什么；本次没有修改画布。' }); return;
    }
    if (revision) {
      if (hasMixedActivityRequirements(trimmed)) { markUnresolvedModification(trimmed);say({ role: 'agent', amber: true, text: '这句话同时包含物件修改和活动需求，请分开发送；本次没有修改画布或需求。' }); return; }
      reviseMaterials(revision); return;
    }
    if (request) {
      if (hasMixedActivityRequirements(trimmed)) { markUnresolvedModification(trimmed);say({ role: 'agent', amber: true, text: '这句话同时包含物件修改和活动需求，请分开发送；本次没有修改画布或需求。' }); return; }
      addMaterials(request); return;
    }
    const styleCmd = matchStyleBundleCommand(trimmed, window.localStorage);
    if (styleCmd === 'open') {
      setStylePickerOpen(true);
      say({ role: 'agent', text: '选一套风格：奶油会客、深木就餐或清透办公。' });
      return;
    }
    if (styleCmd) {
      placeStyleBundleNow(styleCmd);
      return;
    }
    if (isMaterialListCommand(trimmed)) { replyMaterialList(); return; }
    if (isGenericMaterialRequest(trimmed)) { say({ role: 'agent', text: MATERIAL_REQUEST_HINT }); return; }
    if (isCopyDraftCommand(trimmed)) { replyDraft(); return; }
    if (isZoneCommand(trimmed)) { replyZone(); return; }
    if (isReviewCommand(trimmed)) { reviewNow(); return; }
    // 客户评审是深工具，但入口仍是一句话：打开评审页，不在左栏另起表单。
    if (isClientReviewCommand(trimmed)) {
      callbacks.onOpenReview();
      say({ role: 'agent', text: '评审页在左边开了：离线 HTML 或云端只读链接，都由你发。' });
      return;
    }
    // 导出/交接：先出预览卡，不直接下载（T-UI §4-5）。
    if (isExportCommand(trimmed)) { proposeExport(); return; }
    }
    const command = mixedUtility ? null : isGenerateCommand(trimmed);
    // 布置跟进先留着当前预览。生成开始才会换成新的一版；还差事实时确认入口还在。
    const relatedLayout = !mixedUtility && layoutGenerateCommand(trimmed) !== null;
    if (!unifiedConversation && !relatedLayout && (phase === 'proposed' || phase === 'paused')) { dropProposal(); discardCloudPreview(); setPhase('idle'); setProgress(0); }
    // 对话核心：真模型（scene-api /brief/extract，key 在 Supabase secrets）优先提槽位，
    // 失败/未配置自动回退规则版；记忆合并、防复读、出方案闸门都在 brief-agent 状态机里。
    if(pendingModelInputs.current.has(trimmed)){say({role:'agent',amber:true,text:'这句需求仍在处理中，请等待结果。'});return;}
    const activeRequest={controller:new AbortController(),text:trimmed};
    const trackModel=!!(modelEnabled() && studioRef.current?.controller);if(trackModel)pendingModelInputs.current.add(trimmed);
    if(trackModel && !briefRequest.current){briefRequest.current=activeRequest;setUnderstanding(true);}
    const turnSessionId = boundSessionId.current;
    const turnSequence = briefTurnSequence.current;
    const priorTurn = briefTurnTail.current;
    let releaseTurn!: () => void;
    briefTurnTail.current = new Promise<void>((resolve) => { releaseTurn = () => {setBriefBusy(false);if(trackModel)pendingModelInputs.current.delete(trimmed);if(briefRequest.current===activeRequest){briefRequest.current=null;setUnderstanding(false);}resolve();}; });
    setBriefBusy(true);
    setProcessFailed(null);
    await priorTurn;
    await waitForGeneration();
    if (activeRequest.controller.signal.aborted || !sessionScopeIsCurrent() || boundSessionId.current !== turnSessionId || briefTurnSequence.current !== turnSequence) { releaseTurn(); return; }
    if(modelEnabled() && studioRef.current?.controller && !briefRequest.current){briefRequest.current=activeRequest;setUnderstanding(true);}
    const beforeSpecs=memoryRef.current;
    const nextSpecs=mergeLocalSeatingSpecs(beforeSpecs.localSeatingSpecs,trimmed);
    const nextAllocation=mergeSeatingAllocation(beforeSpecs.localSeatingAllocation,trimmed);
    const nextBanquet=mergeBanquetTable(beforeSpecs.banquetTable,trimmed);
    const specsUnchanged=JSON.stringify(nextSpecs)===JSON.stringify(beforeSpecs.localSeatingSpecs)&&JSON.stringify(nextAllocation)===JSON.stringify(beforeSpecs.localSeatingAllocation)&&JSON.stringify(nextBanquet)===JSON.stringify(beforeSpecs.banquetTable);
    let previousMemory=specsUnchanged?beforeSpecs:{...beforeSpecs,localSeatingSpecs:nextSpecs,localSeatingAllocation:nextAllocation,...(nextBanquet?{banquetTable:nextBanquet}:{})};
    if(previousMemory!==beforeSpecs){
      // Keep the current banquet preview up until a diameter change has a new one.
      if(!isRoundResizeUtterance(trimmed, beforeSpecs) && (phaseRef.current==='proposed'||phaseRef.current==='paused')){dropProposal();discardCloudPreview();setPhase('idle');setProgress(0);}
      saveMemory(previousMemory);syncMemory(previousMemory);
    }
    const turnVenueBasis = venueScaleBasis(layoutStore.getState().layout);
    const turnVenueFact=venueFacts.capture();
    if(sessionScope !== 'legacy' && !turnVenueFact){say({role:'agent',amber:true,text:'场地状态正在核对，请稍后重试。'});releaseTurn();return;}
    let staleScale = sessionScope !== 'legacy' && (!isVenueScaleCurrent(previousMemory,layoutStore.getState().layout) || !sourceScaleBound(previousMemory) || !factScaleBound(previousMemory));
    // 用户没报新尺寸/室内外时，画布 revision 漂移（确认布置、摆家具）不该把跟句拦成「场地已变化」。
    // 静默把 basis 重绑到当前画布，继续正常理解；只有用户真说了尺寸/室内外才走硬门禁。
    if (staleScale) {
      const stated = parseBriefSentence(trimmed);
      const userStatedScale = stated.lengthM !== null || stated.widthM !== null || stated.areaM2 !== null || stated.venueIO !== null;
      if (!userStatedScale && previousMemory.lengthM !== null && previousMemory.widthM !== null) {
        previousMemory = { ...previousMemory, venueScaleBasis: turnVenueBasis, scaleNeedsReconfirmation: false, previousVenueScale: undefined };
        saveMemory(previousMemory); syncMemory(previousMemory);
        staleScale = false;
      }
    }
    const previousVenueScale = previousMemory.previousVenueScale ?? {lengthM:previousMemory.lengthM,widthM:previousMemory.widthM,areaM2:previousMemory.areaM2};
    const resolverMemory = staleScale ? {...previousMemory,lengthM:null,widthM:null,areaM2:null,scaleNeedsReconfirmation:true,previousVenueScale,pendingGeneration:undefined} : previousMemory;
    let turn: Awaited<ReturnType<typeof resolveBriefTurn>>;
    try {
      turn = await resolveBriefTurn(trimmed, resolverMemory, {
        venueUp, scaleTyped: lengthCheck.ok && widthCheck.ok, hasBase, command,
      }, studioRef.current?.controller ?? null, activeRequest.controller.signal, unifiedConversation ? {history:turnHistory} : undefined);
      if(turn.modelNotice?.includes('可能仍会计费'))uncertainInputs.current.add(trimmed);
      if(briefRequest.current===activeRequest){briefRequest.current=null;setUnderstanding(false);}
    } catch (error) { setProcessFailed('understanding'); releaseTurn(); if(activeRequest.controller.signal.aborted)return;throw error; }
    if (!sessionScopeIsCurrent() || boundSessionId.current !== turnSessionId || briefTurnSequence.current !== turnSequence) { releaseTurn(); return; }
    const outcome=resolvedTurnOutcome(turn,previousMemory,mixedUtility,trimmed);
    if(outcome.kind==='failed')setProcessFailed('understanding');
    const incompleteUpdate=incompleteUpdateForOutcome(outcome);
    const unhandledRequirement=turn.unhandled?.some(item=>(item.kind==='action'||item.kind==='other')&&!!item.evidence&&trimmed.includes(item.evidence))??false;
    if(incompleteUpdate==='mark')updateDialogueIncomplete(turnSessionId,trimmed,true,unhandledRequirement);
    if(unifiedConversation&&unhandledRequirement&&(phaseRef.current==='proposed'||phaseRef.current==='paused')){
      dropProposal();discardCloudPreview();phaseRef.current='idle';setPhase('idle');setProgress(0);
      say({role:'agent',amber:true,text:'这项操作尚未执行，旧方案预览已收回。请带上这项要求重新生成，再核对修改。'});
    }
    if(turn.readOnlyReply){
      // 模型已作答的纯提问不再挂「尚未执行」黄条：回答本身就是处理结果；
      // 只有夹带动作/其他未执行项时才提醒。
      const allQuestionsAnswered=!!turn.text&&!!turn.unhandled?.length&&turn.unhandled.every(item=>item.kind==='question');
      if(turn.unhandled?.length&&!allQuestionsAnswered&&!sofaOnlyUnhandled(turn,trimmed))say({role:'agent',amber:true,text:`以下内容尚未执行或仍需核对：${turn.unhandled.map(item=>`「${item.evidence}」`).join('、')}。`});
      say({role:'agent',text:turn.text,modelConversation:true,...(turn.materialQueries?.length?{materialQueries:turn.materialQueries}:{})});releaseTurn();return;
    }
    if (sessionScope !== 'legacy' && (turnVenueBasis !== venueScaleBasis(layoutStore.getState().layout) || !venueFacts.isCurrent(turnVenueFact))) {
      say({role:'agent',amber:true,text:'场地在理解需求期间发生变化，请重新说明当前场地尺寸。'});releaseTurn();return;
    }
    const scaleRestated = (turn.extraction.lengthM !== null && turn.extraction.widthM !== null) || turn.extraction.areaM2 !== null;
    const scalePending = turn.memory.pendingBasicFacts?.some(fact=>fact.key==='lengthM'||fact.key==='widthM'||fact.key==='areaM2');
    let sourceProof: {scope:string;digest:string}|undefined;
    if(sessionScope !== 'legacy' && scaleRestated && !scalePending && sourceAuthorityRequired.current && !confirmVenueSourceRef.current){
      say({role:'agent',amber:true,text:'场地来源暂时无法核对，请核对来源后重新说明尺寸；原需求未修改。'});releaseTurn();return;
    }
    if(sessionScope !== 'legacy' && scaleRestated && !scalePending && confirmVenueSourceRef.current){
      const sourceRevision=zoneDraftRevisionRef.current, authority=confirmVenueSourceRef.current, rawSourceScope=layoutStore.getState().layout.id;
      if(!rawSourceScope){say({role:'agent',amber:true,text:'场地来源尚无明确活动标识，请先保存活动后重新说明尺寸。'});releaseTurn();return;}
      let sourceTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const observed=await Promise.race([authority(rawSourceScope),new Promise<never>((_,reject)=>{sourceTimeout=setTimeout(()=>reject(new Error('来源核对超时')),12000);})]);
        if (!sessionScopeIsCurrent() || boundSessionId.current !== turnSessionId || briefTurnSequence.current !== turnSequence ||
            turnVenueBasis !== venueScaleBasis(layoutStore.getState().layout) || !venueFacts.isCurrent(turnVenueFact) || layoutStore.getState().layout.id !== rawSourceScope || sourceRevision !== zoneDraftRevisionRef.current || authority !== confirmVenueSourceRef.current) { releaseTurn(); return; }
        if(observed.status!=='observed' || observed.scope!==rawSourceScope || !/^[0-9a-f]{64}$/i.test(observed.digest)) {
          say({role:'agent',amber:true,text:'场地来源暂时无法核对，请核对来源后重新说明尺寸；原需求未修改。'});releaseTurn();return;
        }
        sourceProof={scope:observed.scope,digest:observed.digest};
      } catch {
        if(sessionScopeIsCurrent() && boundSessionId.current===turnSessionId && briefTurnSequence.current===turnSequence)
          say({role:'agent',amber:true,text:'场地来源暂时无法核对，请核对来源后重新说明尺寸；原需求未修改。'});
        releaseTurn(); return;
      } finally { if(sourceTimeout !== undefined) clearTimeout(sourceTimeout); }
    }
    if(sessionScope !== 'legacy' && scaleRestated && !scalePending){
      const {previousVenueScale:_old,...rest}=turn.memory;
      turn={...turn,memory:{...rest,venueScaleBasis:turnVenueBasis,venueFactToken:turnVenueFact ?? undefined,scaleNeedsReconfirmation:false,...(sourceProof?{venueSourceScope:sourceProof.scope,venueSourceDigest:sourceProof.digest}:{})}};
    } else if(staleScale){
      turn={...turn,memory:{...turn.memory,scaleNeedsReconfirmation:true,previousVenueScale}};
      saveMemory(turn.memory);syncMemory(turn.memory);
      const old=previousVenueScale.lengthM !== null && previousVenueScale.widthM !== null ? `${formatArea(previousVenueScale.lengthM)} × ${formatArea(previousVenueScale.widthM)} 米` : previousVenueScale.areaM2 !== null ? `${formatArea(previousVenueScale.areaM2)} 平方米` : '未记录';
      say({role:'agent',amber:true,text:`场地已变化，旧场地记录为 ${old}，不能自动沿用。请重新说明当前场地尺寸。`});releaseTurn();return;
    }
    if ((turn.modelNotice?.includes('可能仍会计费') || !briefFallbackNotified.current) && (turn.resolution === 'failed' || turn.resolution === 'unavailable' || turn.resolution === 'not_connected')) {
      briefFallbackNotified.current = true;
      say({ role: 'agent', amber: true, text: turn.modelNotice ?? '这次暂时只能识别基本信息，复杂要求请核对后再出方案。' });
    }
    // 瞬态失败（网络/超时/400/429/5xx）：给一张可一键重试的卡，把原句重发；配置类失败不挂。
    if (turn.modelRetryable && turn.modelNotice) {
      const retryText = trimmed;
      setModelFailure({ text: turn.modelNotice, retry: () => { if (!briefRequest.current) void send(retryText); } });
    } else {
      setModelFailure(null);
    }
    const memorySaved=saveMemory(turn.memory);
    releaseTurn();
    if(unifiedConversation && turn.kind !== 'generate' && (phaseRef.current==='proposed'||phaseRef.current==='paused') && !sameRecoveryFormValue({...previousMemory,askedScale:false},{...turn.memory,askedScale:false})) {dropProposal();discardCloudPreview();setPhase('idle');setProgress(0);}
    const extraction = turn.extraction;
    const merged = memoryExtraction(turn.memory);
    // 人数 / 类型 / 室内外 / 长宽先写进左栏简报，再决定出不出预览。云端忙也不能把这句漏掉。
    applyExtraction(extraction);
    syncMemory(turn.memory);
    // The model result is only eligible to clear an old item after the venue
    // fences, the memory write, and a readback of the fact all succeeded.
    if(incompleteUpdate==='clear_current' && memorySaved && turnSessionId && sessionScopeIsCurrent() &&
      boundSessionId.current===turnSessionId && briefTurnSequence.current===turnSequence &&
      (sessionScope==='legacy' || (turnVenueBasis===venueScaleBasis(layoutStore.getState().layout) && venueFacts.isCurrent(turnVenueFact))) &&
      samePersistedHeadcount(readBriefMemory(turnSessionId,scopedAssistantStorage(sessionScope)),turn.memory))
      updateDialogueIncomplete(turnSessionId,trimmed,false);
    if(turn.resolution==='confirmation' && memorySaved && turnSessionId && sessionScopeIsCurrent() && boundSessionId.current===turnSessionId)
      sweepFulfilledConfirmationChips();
    const briefNote = syncStudioBrief(merged);
    const suffix = briefNote ? ` ${briefNote}` : '';
    const anchors = { checkin: turn.memory.zoneNeeds.checkin === true, stage: turn.memory.zoneNeeds.stage === true };
    anchorsRef.current = anchors;
    const statedScale = scaleFrom(merged);
    const chosenScale = eventPreviewScale(statedScale, turn.memory, turn.memory.furnishing ? standingHall() : null);
    const scale = { ...statedScale, length: chosenScale.length, width: chosenScale.width, origin: chosenScale.origin, fromVenue: chosenScale.keptHall || statedScale.fromVenue };
    let previewLead = turn.previewLead;
    if (chosenScale.keptHall && previewLead) {
      const shellIO = shellVenueIO(live.current);
      const spokenLength = turn.extraction.lengthM;
      const spokenWidth = turn.extraction.widthM;
      const spokenArea = turn.memory.agentVenue ? null : turn.memory.areaM2;
      const boundFact = venueFacts.capture();
      const keptMemory = {
        ...turn.memory,
        lengthM: chosenScale.length,
        widthM: chosenScale.width,
        venueScaleBasis: venueScaleBasis(layoutStore.getState().layout),
        scaleNeedsReconfirmation: false,
        ...(boundFact ? { venueFactToken: boundFact } : {}),
        ...(shellIO ? { venueIO: shellIO } : {}),
      };
      delete keptMemory.agentVenue;
      turn = { ...turn, memory: keptMemory };
      saveMemory(keptMemory);
      syncMemory(keptMemory);
      if (shellIO) { setVenueIO(shellIO); onVenueIOChange?.(shellIO); }
      setLengthRaw(''); setWidthRaw(''); setDimsTouched(false); setScaleOrigin('canvas');
      previewLead = leadOnStandingHall(previewLead, { length: chosenScale.length, width: chosenScale.width }, {
        length: spokenLength,
        width: spokenWidth,
        area: spokenArea,
      });
    } else if (previewLead && !chosenScale.assumed && /场地没说/.test(previewLead)) {
      previewLead = previewLead.replace(/场地没说，我先按(?:室内|户外) \S+ 米/, `按现在的场地 ${formatArea(chosenScale.length)}×${formatArea(chosenScale.width)} 米`);
    }
    const zoneBit = [anchors.stage ? '舞台' : null, anchors.checkin ? '签到' : null].filter(Boolean).join('、');
    const mentionedZone = (kind: 'stage' | 'checkin', word: RegExp) => turn.memory.unresolvedActivityNeeds.includes(kind) || word.test(trimmed);
    const unspecified = [turn.memory.zoneNeeds.stage === null && !anchors.stage && mentionedZone('stage', /舞台/) ? '舞台' : null,
      turn.memory.zoneNeeds.checkin === null && !anchors.checkin && mentionedZone('checkin', /签到/) ? '签到区' : null].filter(Boolean);
    const summary = `${describeExtraction(merged, scale)}${scale.fromVenue ? ' · 按现在的场地' : ''}`;
    const carried = extraction.headcount === null && turn.memory.headcount !== null && !summary.includes(String(turn.memory.headcount))
      ? ` · 沿用 ${turn.memory.headcount} 人` : '';
    const mentionedNewMaterial=(turn.memory.reportedInventory??[]).some(item=>!(previousMemory.reportedInventory??[]).some(old=>old.evidence===item.evidence));
    if (mentionsUnsupportedSeating(trimmed) && !turn.readOnlyReply) say({ role: 'agent', text: CIRCLE_SEATING_NOTE });
    if(turn.modelReply && turn.modelReply!==turn.text)say({role:'agent',text:`建议：${turn.modelReply}`,modelConversation:true,...(turn.materialQueries?.length?{materialQueries:turn.materialQueries}:mentionedNewMaterial?{action:{label:'查看物料库',run:callbacks.onOpenMaterials}}:{})});
    const sofaAsk=sofaOnlyUnhandled(turn,trimmed);
    if(sofaAsk&&turn.kind==='generate'){say({role:'agent',text:'沙发不是可选的布置方式。请选择圆桌或课桌椅；其他摆法需要说明，可能需要人工调整。'});return;}
    if(turn.unhandled?.length&&!sofaAsk){say({role:'agent',amber:true,text:`以下内容尚未执行或仍需核对：${turn.unhandled.map(item=>`「${item.evidence}」`).join('、')}。`});if(turn.kind==='generate')return;}
    if(mixedUtility){say({role:'agent',text:turn.text||'活动需求已记录，请核对；其他操作尚未执行。',...(turn.usesModelText?{modelConversation:true}:{}),...(turn.usesModelText&&turn.materialQueries?.length?{materialQueries:turn.materialQueries}:turn.usesModelText&&mentionedNewMaterial?{action:{label:'查看物料库',run:callbacks.onOpenMaterials}}:{})});return;}
    // 只说「改成 15×10」= 只动场地壳：不排布置、不出预览卡、不亮确认绿钮。
    // 例外：这是在补答追问的尺寸时，报完尺寸就该直接出方案。
    if (!command && !turn.filledScaleAsk && isVenueSizeOnly(extraction) && isExplicitSizeOnly(trimmed)) {
      resizeVenueOnly(scaleFrom(extraction), extraction.venueIO ?? turn.memory.venueIO ?? venueIO, previousMemory);
      return;
    }
    if (turn.kind !== 'generate') {
      // AI 回复末尾问「要不要我帮你圈出来」时，挂一张绿描边提议卡；点按钮等价于用户回「好」。
      const zoneProposal = hasZoneApplyProposal(turn.text);
      const proposalLayout = live.current;
      const proposalLayoutRevision = layoutStore.getState().revision;
      const proposalMemoryRevision = memoryRevision.current;
      const proposalDraftRevision = zoneDraftRevisionRef.current;
      let proposalConsumed = false;
      const proposalFloorIndex = floorIndexRef.current;
      const proposalSessionId = boundSessionId.current;
      say({
        role: 'agent',
        text: turn.text,
        ...(turn.usesModelText?{modelConversation:true}:{}),
        ...(turn.usesModelText&&turn.materialQueries?.length?{materialQueries:turn.materialQueries}:turn.usesModelText&&mentionedNewMaterial?{action:{label:'查看物料库',run:callbacks.onOpenMaterials}}:{}),
        ...(zoneProposal
          ? {
              zoneApply: {
                run: () => {
                  if (proposalConsumed || zoneDraftRevisionRef.current !== proposalDraftRevision ||
                      layoutStore.getState().revision !== proposalLayoutRevision || memoryRevision.current !== proposalMemoryRevision ||
                      proposalFloorIndex !== floorIndexRef.current || proposalSessionId !== boundSessionId.current ||
                      proposalLayout.id !== live.current.id || !sameLayoutContent(proposalLayout, live.current)) {
                    say({ role: 'agent', amber: true, text: '场地或需求已变化，这条区域建议已过期，请重新说明需要的区域。' });
                    return;
                  }
                  const zones = extractProposedZoneTypes(turn.text).filter((zone) => (zone !== 'checkin' && zone !== 'rest') || memoryRef.current.zoneNeeds[zone] !== false);
                  const labels = onApplyZoneRects?.(zones) ?? null;
                  if (labels) { proposalConsumed = true; say({ role: 'agent', text: `已经在 2D 上圈好${labels}，去画布看一眼？` }); }
                  else say({ role: 'agent', amber: true, text: '这次没有圈区，请核对场地和需求后重新生成区域建议。' });
                },
              },
            }
          : {}),
      });
      return;
    }
    beginLayoutAttempt(trimmed, studioRef.current?.connection === '项目已连接');
    if(isHistoryReviewRequired()){finishLayoutAttempt(false);say({role:'agent',amber:true,text:'请先核对历史需求，再重新生成方案。'});return;}
    const originalRequest=turn.resumeInstruction??trimmed;
    if(/(?:本地|本机)草案/.test(originalRequest)){
      const variant=command==='again'?(seed.current+=1,seed.current):seed.current;
      runGeneration(null,variant,originalRequest,scale);
      return;
    }
    const cloud = studioRef.current;
    if (!turn.memory.furnishing && cloud?.connection === '项目已连接') {
      // 连着云就只走云预览。忙或恢复中若退回本地生成，会在云端还没稳时亮一颗确认。
      if (cloud.busy || cloud.recoverable) {
        finishLayoutAttempt(false);
        say({ role: 'agent', amber: true, text: '正在调用云端工具未完成：上一版仍在处理，确认先不亮。' });
        return;
      }
      if(!cloudScaleMatches(scale)){finishLayoutAttempt(false);return;}
      if (briefNote) say({ role: 'agent', text: briefNote });
      const token = ++runToken.current;
      suppressCancelledCloudPreview.current=false;
      lastSource.current='cloud';phaseRef.current='generating';setPhase('generating');setExportPreview(false);
      const seatingAllocation=cloudSeatingAllocation(turn.memory);
      const seatingSpecs=cloudSeatingSpecs(turn.memory);
      const conversationId=getActiveAssistantSessionId(sessionScope),boundId=boundSessionId.current;
      beginLayoutAttempt(trimmed, true);
      trackGeneration(cloud.generate(cloudBriefMessage(turn.resumeInstruction ?? (command === 'again' ? '换一版不同的布局' : trimmed), turn.memory), { requirePreview: true,...(seatingAllocation?{seatingAllocation}:{}),...(seatingSpecs?{seatingSpecs}:{}) }).then(result => {
        if(token!==runToken.current||!sessionScopeIsCurrent()||boundSessionId.current!==boundId||getActiveAssistantSessionId(sessionScope)!==conversationId){finishLayoutAttempt(false);return;}
        if(result?.kind==='unchanged'){finishLayoutAttempt(false);setPhase('idle');setProgress(0);say({role:'agent',amber:true,text:result.message});}
        else if (!adoptCloudProposal()) setPhase(current => (current === 'generating' ? 'failed' : current === 'ready' ? 'edited' : current));
      }));
      return;
    }
    const zoneLine = `${zoneBit ? `${zoneBit}先占位。` : ''}${unspecified.length ? `${unspecified.join('、')}尚未说明，这版暂不包含。` : ''}`;
    const rail = lightPlanRail(trimmed);
    const railBit = rail ? `${rail.join('→')}。确认前不落盘。` : '';
    say({ role: 'agent', text: previewLead
      ? previewLead
      : turn.filledScaleAsk
      ? `记下了：${summary}${carried}。${zoneLine}${railBit}先出预览，确认后才写入。${suffix}`
      : `按这些先出一版：${summary}${carried}。${zoneLine}${railBit}${suffix}` });
    const variant = command === 'again' ? (seed.current += 1, seed.current) : seed.current;
    runGeneration(null, variant, command === 'again' ? '换一版不同的布局' : '', scale);
  }
  /** The fence starts synchronously on submit, including turns waiting in the queue. */
  async function send(text:string,allowUncertainRetry=false,queued=false,queuedAttachment?:{file:File;url:string}|null,queuedHistory?:Array<{role:'user'|'assistant';text:string}>):Promise<void>{
    let finish=()=>{};
    if(text.trim()||(queued?queuedAttachment:pendingFile)){
      try{
        const begin=dialogueTurnStartRef.current;
        if(begin){
          const release=begin();if(typeof release!=='function')throw new Error('invalid dialogue fence');
          finish=()=>{if(dialogueTurnReleases.current.delete(finish))release();};
          dialogueTurnReleases.current.set(finish,{sessionId:boundSessionId.current,text});
        }
      }catch{updateDialogueIncomplete(boundSessionId.current,text,true);if(!queued&&text.trim())say({role:'user',text:text.trim()});say({role:'agent',amber:true,text:'对话状态暂时无法核对，请稍后重试。'});return;}
    }
    const turnSession=boundSessionId.current;
    try{await sendCore(text,allowUncertainRetry,queued,queuedAttachment,queuedHistory);await waitForGeneration();}
    catch(error){updateDialogueIncomplete(turnSession,text,true);throw error;}finally{finish();}
  }
  sendLatest.current=send;

  // 提案态的重叠算在候选上；落盘之后才算画布上的（编辑器那份 collidingIds 这时候还是旧的）。
  const overlapCount = phase === 'proposed' ? activeProposal?.overlapCount ?? 0
    : phase === 'ready' || phase === 'edited' || phase === 'paused' ? activeFloor.items.filter(item => collidingIds.has(item.id)).length : 0;

  // 回显只读：填过/说过用说的；没说过就报画布当前的米数——角标一直报真实尺寸，
  // 简报不能还写「尺寸还没定」，两处对不上会让人以为场地没立起来。
  // 面积折算与图纸估算是推出来的，后缀必须跟着走，不能静态数字装成场地真相。
  const stated = lengthCheck.ok && widthCheck.ok ? `${formatArea(lengthCheck.value)} × ${formatArea(widthCheck.value)} m` : null;
  // Each field has independent provenance; saving another field does not confirm a default.
  const formBrief = studio?.brief;
  const guests = brief.guests ?? (formBrief?.guestsConfirmed === true ? formBrief.guests : null);
  const recap = {
    event: brief.event ?? (formBrief?.eventConfirmed === true ? formBrief.event : null),
    guests: guests ? `${guests} 人` : null,
    dims: `${venueIO === 'indoor' ? '室内' : '户外'} · ${stated
      ? `${stated}${scaleOrigin === 'area' ? ' 折算' : scaleOrigin === 'plan' ? ' 估的' : ''}`
      : `${formatArea(layout.width)} × ${formatArea(layout.height)} m`}`,
    note: hasBase && scaleOrigin === 'plan' ? '图纸只当参照，这个数是我估的' : null,
  };

  const value: AgentValue = {
    sessionScope, isSessionCurrent: sessionScopeIsCurrent, historyReviewRequired,reviewDialogueHistory,acceptFreshSession,retainedOtherSessionProposal:!!proposal.current&&proposalSessionRef.current!==boundSessionId.current,withdrawRetainedOtherSessionProposal:()=>{if(proposal.current&&proposalSessionRef.current!==boundSessionId.current){dropProposal();setPhase('idle');say({role:'agent',text:'已撤回其他会话中未确认的旧方案。'});}},unresolvedDialogue,withdrawUnresolvedDialogue,withdrawAllUnresolved,briefBusy,toolPending,processFailed,understanding, generationQueued, isUnderstanding:(text)=>text===undefined ? briefRequest.current!==null : pendingModelInputs.current.has(text.trim()),
    canForward:(text)=>{const value=text.trim(),session=boundSessionId.current;return !!value&&!!session&&sessionScopeIsCurrent()&&getActiveAssistantSessionId(sessionScope)===session&&!pendingModelInputs.current.has(value)&&!uncertainInputs.current.has(value);},cancelUnderstanding,
    cancelledInput, retryUncertain, confirmUncertainRetry:()=>{const text=retryUncertain;if(!text||briefRequest.current)return;setRetryUncertain(null);void send(text,true);}, dismissUncertainRetry:()=>setRetryUncertain(null), assertSessionWrite: requireSessionWrite, sessionSaveFailed: sessionSaveFailed || assistantSessions.saveFailed, callbacks, state, venueIO, baseName, issue, dragging, recap, banquetChat, venueUp,
    setVenueIO: next => { setVenueIO(next); onVenueIOChange?.(next); if (next === 'indoor' && view.weather === 'rain') setView(current => ({ ...current, weather: 'clear' })); },
    progress, failed: phase === 'failed', overlapCount, bubbles, retry, stop, resume, regenerate,
    modelFailure, dismissModelFailure: () => setModelFailure(null),
    // 生成中与暂停在逐帧预览里：这一版还没长完，不给出可确认的卡片。
    proposal: phase === 'proposed' ? activeProposal : null, inventoryWorkspace, inventoryBlocked: inventoryCheck?.status==='violated'||!!(inventoryTargetForRender&&inventoryFor(inventoryTargetForRender)?.invalidInput), inventoryInvalid:!!(inventoryTargetForRender&&inventoryFor(inventoryTargetForRender)?.invalidInput),
    confirmProposal, withdrawProposal, cloudBusy: !!studio?.busy, recovering: !!studio?.recoverable,
    cloudStale: !!(studio?.preview && (studio.stale || studio.expired)), addSeats, startBlankVenue,
    mapPickerOpen, startMapVenuePicker: () => { setMapPickerOpen(value => !value); }, closeMapVenuePicker: () => setMapPickerOpen(false),
    venuePickerOpen, startVenuePicker: () => setVenuePickerOpen(true), closeVenuePicker: () => setVenuePickerOpen(false),
    stylePickerOpen,
    startStylePicker: () => { setStylePickerOpen(true); setMapPickerOpen(false); setVenuePickerOpen(false); },
    closeStylePicker: () => setStylePickerOpen(false),
    placeStyleBundle: placeStyleBundleNow,
    applyMapVenuePick: applyVenuePick,
    venuePick,
    handleVenuePick: place => { void handleVenuePick(place); },
    dismissVenuePick: stopOutdoorTask,
    outdoorTask,
    manualOutdoorVenueApplied: anchor => {
      const pending = manualVenueAnchorRef.current;
      if (!pending || pending.lng !== anchor.lng || pending.lat !== anchor.lat) return;
      manualVenueAnchorRef.current = undefined;
      setOutdoorTask({ intent: '手动确认真实场地', state: 'done', action: '手画边界已闭合并写入同一份规划；2D/3D 同步，可撤销', steps: ['地点已确认', '手画闭合并通过边界校验', '提交锚点与边界'], prompts: ['排一下流线'] });
    },
    inspectOutdoorFacility: id => { if (!routeBridgeRef.current?.inspectFacility?.(id)) setOutdoorTask(current => current ? { ...current, state: 'blocked', action: '该设施已不在当前户外方案，请重新选择画布中的设施', focusFacilityId: undefined } : null); },
    stopOutdoorTask,
    routeProposal,
    routeBusy,
    proposeRoutePlan: () => { void proposeRoutePlan(); },
    confirmRouteProposal,
    dismissRouteProposal,
    zoneProposal,
    zoneBusy,
    proposeZonePlan: () => { void proposeZonePlan(); },
    confirmZoneProposal,
    dismissZoneProposal,
    proposeSubEntrances: () => { void proposeSubEntrances(); },
    flowSimActive,
    startFlowSim,
    stopFlowSim,
    registerRouteBridge: bridge => { routeBridgeRef.current = bridge; },
    exportPreview, previewExport: proposeExport, confirmExport, confirmCloudMaterialDraft, dismissExport, reviewNow, issueReviewLink,
    acceptFile: file => { void acceptFile(file); }, retryFile: () => { if (lastFile.current) void acceptFile(lastFile.current); }, pickFile: () => fileInput.current?.click(),
    pendingFile: pendingFile ? { name: pendingFile.file.name, url: pendingFile.url } : null,
    removePendingFile: () => setPendingFile(null),
    send, say, rainOn: view.weather === 'rain',
    previewRain: () => setView(current => ({ ...current, weather: 'rain', view2D: false })),
    walkthrough: () => {
      setView(current => ({ ...current, walkthroughMode: true, view2D: false, measurementMode: false, drawWallMode: false }));
      requestWalkPointerLock();
    },
  };
  return <AgentContext.Provider value={value}>
    {children}
    <input ref={fileInput} type="file" hidden aria-hidden="true" tabIndex={-1} accept="image/png,image/jpeg,image/webp,.pdf,.dxf,.dwg" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void stageFile(file); }}/>
  </AgentContext.Provider>;
}

/* ───────────────────────── 右栏 ───────────────────────── */

/**
 * 这些状态算「出了问题」。Bingo 那颗点与活动那格都靠它爆红。
 * 同一个列表只写一份，别一边改了另一边忘了。
 */
const FAILED_STATES: readonly AgentState[] = ['generateFailed', 'dimsInvalid', 'nonImageRejected', 'fileUnsupported', 'fileTooLarge', 'fileReadFailed'];

/** Bingo形象对应的状态。点头像或这行字，回到这一态该做的事。 */
export function bingoHeaderStatus(agent: AgentValue, mode: WorkbenchMode): { text: string; tone: 'idle' | 'busy' | 'ask' | 'ok' | 'warn'; hint: string } {
  if (mode === 'review') return { text: '评审', tone: 'ask', hint: '钉在画布上，对话还在' };
  if (mode === 'delivery') return { text: '执行', tone: 'idle', hint: '回到输入' };
  if (mode !== 'layout') return { text: '空闲', tone: 'idle', hint: '回到输入' };
  const s = agent.state;
  if (s === 'generating') return { text: '生成中', tone: 'busy', hint: '看进度' };
  if (s === 'generatePaused') return { text: '先停着', tone: 'ask', hint: '接着摆或撤回' };
  if (FAILED_STATES.includes(s)) {
    return { text: '没出成', tone: 'warn', hint: '看原因' };
  }
  if (s === 'planProposed') {
    const issue = agent.proposal?.blocked || (agent.proposal?.review && agent.proposal.overlapCount > 0);
    return issue ? { text: '发现问题', tone: 'warn', hint: '看这版' } : { text: '等你确认', tone: 'ask', hint: '去确认布置' };
  }
  if (s === 'planReady' || s === 'planEdited') {
    return agent.overlapCount > 0 ? { text: '发现问题', tone: 'warn', hint: '看这一版' } : { text: '已出方案', tone: 'ok', hint: '看这一版' };
  }
  return { text: '空闲', tone: 'idle', hint: '回到输入' };
}

/**
 * Bingo头像按状态切独立切图（`qingguang-3d-40-{ask|done|issue}`）：
 * 禁把角标叠画在头像上，所以状态靠换图，不用徽标。
 */
function mascotOf(agent: AgentValue, mode: WorkbenchMode): string {
  if (mode !== 'layout') return `${MASCOT_DIR}-40-done.png`;
  const s = agent.state;
  if (s === 'planReady' || s === 'planEdited') return `${MASCOT_DIR}-40-${agent.overlapCount > 0 ? 'issue' : 'done'}.png`;
  if (s === 'planProposed') {
    const issue = agent.proposal?.blocked || (agent.proposal?.review && agent.proposal.overlapCount > 0);
    return `${MASCOT_DIR}-40-${issue ? 'issue' : 'ask'}.png`;
  }
  if (s === 'generating' || s === 'generatePaused') return `${MASCOT_DIR}-40-ask.png`;
  if (s === 'generateFailed' || s === 'dimsInvalid' || s === 'nonImageRejected' || s === 'fileUnsupported' || s === 'fileTooLarge' || s === 'fileReadFailed') return `${MASCOT_DIR}-40-issue.png`;
  return `${MASCOT_DIR}-40.png`;
}

export type BriefTool = { id: string; label: string; hint: string; icon: ReactNode; group?: 'venue' | 'docs'; onOpen(): void };

/**
 * 活动简报的事实卡。工作台不再把它挂在左栏——场地一行在顶栏 `VenueBriefLine`。
 * 这张卡仍给对话测试用：「这块场地从哪来」把图纸与地图并列，场地立起来后也不消失。
 */
/** 顶栏状态行：只在布置态占一行。评审不带「从哪来」，执行不带布置简报。 */
export function VenueBriefLine(): JSX.Element | null {
  const agent = useAgent();
  if (agent.callbacks.workbenchMode !== 'layout') return null;
  const line = venueBriefLine(agent.recap);
  return <span className="sc-venue-brief" role="status" aria-label="场地简报" title={line}>{line}</span>;
}

/**
 * 左栏活动简报：只读，数字全部来自对话与当前画布。
 * 「这块场地从哪来」把量出场地的两条路（图纸与照片 / 地图圈画）并列钉在左边，场地立起来后也不消失——重圈是替换。
 * 评审和执行不占左轨，从分享菜单打开。模板·物料走底栏；这里不放输入框、不放生成按钮、不摆说明书。
 */
export function ActivityBrief({ tools }: { tools: readonly BriefTool[] }): JSX.Element {
  const agent = useAgent();
  const { layout, activeFloor } = useRoomEditor();
  const { event, guests, dims, note } = agent.recap;
  const items = materialCount(activeFloor.items);
  const known = agent.venueUp;
  const noteLines = [
    dims,
    known ? `${formatArea(venueArea(layout))} m²` : null,
  ].filter(Boolean).join(' · ');
  const status = agent.exportPreview
    ? '导出预览还没确认'
    : agent.proposal
      ? '这版还没确认'
      : '';
  const venueRows = tools.filter(tool => tool.group === 'venue');
  const docsRows = tools.filter(tool => tool.group !== 'venue');
  return <section className="sc-brief" aria-label="活动简报">
    <strong className="sc-brief-title">{layout.name || event || '未命名活动'}</strong>
    <dl className="sc-brief-rows">
      <div><dt>活动</dt><dd>{event || <em>还没说</em>}</dd></div>
      <div><dt>人数</dt><dd>{guests || <em>还没说</em>}</dd></div>
      <div><dt>场地</dt><dd>{noteLines}</dd></div>
      <div><dt>物料</dt><dd>{items ? `${items} 件` : <em>还没排</em>}</dd></div>
    </dl>
    {agent.baseName && <p className="sc-brief-note">底图 · {agent.baseName} · 仅作参照</p>}
    {note && <p className="sc-brief-note">{note}</p>}
    {status && <p className="sc-brief-status"><span aria-hidden="true"/>{status}</p>}
    <div className="sc-brief-venue-ways" role="group" aria-label="这块场地从哪来">
      <p className="sc-brief-tool-group-label">这块场地从哪来</p>
      <div className="sc-brief-tool-list">
        {venueRows.map(tool => <button key={tool.id} type="button" title={tool.hint} onClick={tool.onOpen}>{tool.icon}<span>{tool.label}</span></button>)}
        <button type="button" title={known ? '重新圈一块会替换现在的场地' : '搜地点 → 在卫星图上圈出边界 → 生成户外场地'} onClick={agent.startMapVenuePicker}><MapIcon size={16} aria-hidden="true"/><span>地图圈画</span></button>
        {/* 室内「空白空间 · 12×8m」立壳入口已退役：选址统一走地图圈画；空白草稿由场地选择弹层「从空白开始」承担。 */}
      </div>
    </div>
    {docsRows.length > 0 && <details className="sc-brief-tools">
      <summary>更多资料</summary>
      <div className="sc-brief-tool-groups">
        <div className="sc-brief-tool-group" role="group" aria-label="文书">
          <p className="sc-brief-tool-group-label">文书</p>
          <div className="sc-brief-tool-list">
            {docsRows.map(tool => <button key={tool.id} type="button" title={tool.hint} onClick={tool.onOpen}>{tool.icon}<span>{tool.label}</span></button>)}
          </div>
        </div>
      </div>
    </details>}
  </section>;
}

/**
 * 左轨那颗常驻「地图」：圈画是这块场地第一步，只藏在简报的一张卡里，收起左栏就找不着了。
 * 再点一次就把浮层收回去，跟简报里那条链共用同一个开关。
 * （2026-11-12 画布上的「选活动区域」浮条已撤：与这颗常驻钮同开关，浮在 3D 上重复且突兀。）
 */
export function MapRailButton(): JSX.Element {
  const agent = useAgent();
  return <nav className="sc-rail-tool-group" aria-label="地图选址">
    <button type="button" className={`sc-rail-tool${agent.mapPickerOpen ? ' is-active' : ''}`} aria-pressed={agent.mapPickerOpen} aria-label="地图选址"
      data-tip="地图" title={agent.venueUp ? '重新圈一块会替换现在的场地' : '搜地点 → 在卫星图上圈出边界 → 生成户外场地'} onClick={agent.startMapVenuePicker}><MapIcon size={24} aria-hidden="true"/></button>
  </nav>;
}

/** 活动脸的快捷能力：活动级选址 + 风格套。S1 后这里是唯一的布置生成对话入口。 */
/** V-1b 场地回显确认卡：候选来自双源检索；点选=确认真实场地并走 V-1c 锚定链。 */
function VenueConfirmCard({ state, onPick, onDismiss }: {
  state: { query: string; candidates: PlaceSuggestion[]; loading: boolean; picking: string | null };
  onPick: (place: PlaceSuggestion) => void;
  onDismiss: () => void;
}): JSX.Element {
  return <section className="ap-card ap-venue-card" aria-label="场地确认">
    <p className="ap-lead-title">我理解为「{state.query}」，设为场地？</p>
    <p className="ap-lead-body">点一个候选确认是真实场地；确认后我会立壳、铺底图并把边界框出来。都不是就换个说法再说一句（可带上城市）。</p>
    {state.loading && <p className="ap-agent-line" role="status">正在找「{state.query}」的候选场地…</p>}
    {!state.loading && state.candidates.length === 0 && <p className="ap-agent-line">没搜到候选场地。换个说法再说一句，或点右栏「地图选址」手动圈。</p>}
    {state.picking && <p role="status">正在查找真实边界（最多约 85 秒）；超时将转为手画，不会编造边界。</p>}
    {state.candidates.length > 0 && <div className="ap-option-pick">
      {state.candidates.map(place => (
        <button
          key={place.id}
          type="button"
          className="ap-option-row"
          disabled={state.picking !== null}
          onClick={() => onPick(place)}
        >
          <span className="ap-venue-option-text">
            <span className="ap-venue-option-name">{place.name}</span>
            {place.address && <span className="ap-venue-option-addr">{place.address}</span>}
          </span>
          {state.picking === place.name && <span className="ap-option-row-mark">确认中…</span>}
        </button>
      ))}
    </div>}
    {!state.loading && state.candidates.length > 0 && (
      <button type="button" className="chip" onClick={onDismiss}>都不是，换个说法</button>
    )}
  </section>;
}

/** V-2d 流线提案确认卡：虚线预览在画布上，应用才 commitPlan（整批可撤销）。 */
function RouteConfirmCard({ summary, routes, busy, onConfirm, onDismiss }: {
  summary: { pedestrian: number; vehicle: number; service: number; entrances: number };
  routes: number;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}): JSX.Element {
  return <section className="ap-card ap-venue-card" aria-label="流线提案确认">
    <p className="ap-lead-title">这版流线要应用吗？</p>
    <p className="ap-lead-body">草拟 {routes} 条（人行 {summary.pedestrian} · 车行 {summary.vehicle} · 后勤 {summary.service}）+ {summary.entrances} 个出入口。画布上的虚线是预览——应用后变实线，Ctrl+Z 可整批撤销。</p>
    <div className="ap-option-pick">
      <button type="button" className="ap-option-row" disabled={busy} onClick={onConfirm}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">应用这版流线</span></span>
        {busy && <span className="ap-option-row-mark">应用中…</span>}
      </button>
      <button type="button" className="ap-option-row" disabled={busy} onClick={onDismiss}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">放弃这版</span></span>
      </button>
    </div>
  </section>;
}

/** V-3 区域提案确认卡：虚线分区+物料幽灵在画布，应用才 commitPlan（整批可撤销）。 */
function ZoneConfirmCard({ proposal, busy, onConfirm, onDismiss }: {
  proposal: ZoneEventProposal;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}): JSX.Element {
  return <section className="ap-card ap-venue-card" aria-label="区域提案确认">
    <p className="ap-lead-title">这版分区要应用吗？</p>
    <p className="ap-lead-body">草拟 {proposal.summary.zones} 个区域 + {proposal.summary.facilities} 件物料（签到→观众→舞台按入场朝向分带）。画布上的虚线框是预览——应用后变实线，Ctrl+Z 可整批撤销。</p>
    {proposal.summary.warnings?.map(warning => <p className="ap-lead-body" key={warning}>{warning}</p>)}
    <div className="ap-option-pick">
      <button type="button" className="ap-option-row" disabled={busy} onClick={onConfirm}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">应用这版分区</span></span>
        {busy && <span className="ap-option-row-mark">应用中…</span>}
      </button>
      <button type="button" className="ap-option-row" disabled={busy} onClick={onDismiss}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">放弃这版</span></span>
      </button>
    </div>
  </section>;
}

function AgentCapabilityPrompts({ onPrefill }: { onPrefill(text: string): void }): JSX.Element {
  return (
    <div id="ap-capabilities" className="ap-capabilities">
      <p className="ap-capability-label">你可以做什么</p>
      <CapabilitySuggestionCards onPrefill={onPrefill}/>
    </div>
  );
}

/**
 * 盖住画布的地图浮层：圈边界要看得清地块，左栏那条窄缝里一个像素就是一米多。
 * 场地已经立起来时同样进这里重圈——替换走 raiseVenue 那条老规矩，放得下的物料留着，放不下才撤并报数。
 */
export function MapVenueOverlay({ onReconUpload, onVenueSaved }: {
  /** 采集单拍完的素材要交给生成引擎重建；重建入口可达时才传，按钮不会指向打不开的面板。 */
  onReconUpload?: ((preset: { name: string; hint: string }) => void) | undefined;
  onVenueSaved?: (() => void) | undefined;
}): JSX.Element | null {
  const agent = useAgent();
  const [wide, setWide] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [capture, setCapture] = useState<{ plan: CapturePlan; polygon: AmapPoint[]; name: string; location: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(agent.mapPickerOpen, panel, {
    trap: true,
    onEscape: () => { if (wide) setWide(false); else agent.closeMapVenuePicker(); },
  });
  // 上次挡路的原因不该跟着下一次打开一起回来。采集单留着——关浮层再开还能看见刚才那份，重圈一份才换掉。
  useEffect(() => { if (!agent.mapPickerOpen) setBlocked(null); }, [agent.mapPickerOpen]);
  const { layout } = useRoomEditor();
  if (!agent.mapPickerOpen) return null;
  const upload = onReconUpload && capture
    ? () => {
        onReconUpload({
          name: capture.name,
          hint: `${capture.plan.mode === 'flow' ? '沿流线 ' : ''}${capture.plan.stops.length} 个站位 · 共 ${capture.plan.shots} 张${capture.plan.preferVideo ? '，或一段绕场视频' : ''}`,
        });
        agent.closeMapVenuePicker();
      }
    : undefined;
  return <div className={`sc-map-overlay${wide ? ' is-wide' : ''}`} ref={panel} role="dialog" aria-modal="true" aria-label="地图选址" tabIndex={-1}>
    <div className="sc-map-head">
      <strong>地图选址</strong>
      <span className="sc-note">{agent.venueUp ? '重新圈一块会替换现在的场地。' : '搜地点 → 在卫星图上圈出边界 → 生成户外场地。'}</span>
      <button type="button" className="sc-button" aria-label={wide ? '退出全屏' : '全屏'} data-tip={wide ? '退出全屏' : '全屏'} title={wide ? '退出全屏' : '全屏'} onClick={() => setWide(value => !value)}>{wide ? <Minimize2 size={16} aria-hidden="true"/> : <Maximize2 size={16} aria-hidden="true"/>}</button>
      <button type="button" className="sc-button" aria-label="关闭" data-tip="关闭" title="关闭" onClick={agent.closeMapVenuePicker}><X size={16} aria-hidden="true"/></button>
    </div>
    {blocked && <p className="sc-map-blocked" role="alert">{blocked}</p>}
    <AmapVenuePicker grow onClose={agent.closeMapVenuePicker} {...(layout.mapGroundPolygon ? { savedPolygon: layout.mapGroundPolygon } : {})} onPick={pick => {
      const reason = agent.applyMapVenuePick(pick);
      setBlocked(reason);
      // 场地没立起来就不出采集单——那份站位对应的地块并不存在。
      setCapture(reason ? null : { plan: capturePlanForVenue(pick.polygon, pick.flow), polygon: pick.polygon, name: pick.name, location: pick.location });
      if (!reason) {
        onVenueSaved?.();
        agent.closeMapVenuePicker();
      }
    }} />
    {capture && <SiteCaptureCard plan={capture.plan} polygon={capture.polygon} name={capture.name} location={capture.location} onUpload={upload}/>}
  </div>;
}

/**
 * 「换场地 / 新建」弹层：与地图浮层同款盖画布。云项目同标签 router.push（认证按标签页存），
 * 空白 / 新建 / 地图选址统一建本机地图草稿并进 2D 规划；没工作室时静默建「个人工作室」。
 */
export function VenuePickerOverlay(): JSX.Element | null {
  const agent = useAgent();
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(agent.venuePickerOpen, panel, { trap: true, onEscape: agent.closeVenuePicker });
  if (!agent.venuePickerOpen) return null;
  return <div className="sc-venue-overlay" ref={panel} role="dialog" aria-modal="true" aria-label="换场地 / 新建" tabIndex={-1}>
    <div className="sc-map-head">
      <strong>换场地 / 新建</strong>
      <span className="sc-note">空白选址进 2D 规划后再画边界；云项目同标签打开，进度都在。</span>
      <button type="button" className="sc-button" aria-label="关闭" data-tip="关闭" title="关闭" onClick={agent.closeVenuePicker}><X size={16} aria-hidden="true"/></button>
    </div>
    <VenuePicker onClose={agent.closeVenuePicker} />
  </div>;
}

function ToolCallTrace({ line, rows, understanding, onStop }: {
  line: string | null;
  rows: ReturnType<typeof toolTraceRows>;
  understanding: boolean;
  onStop(): void;
}): JSX.Element | null {
  const status = toolChipStatus(line);
  const running = rows.some(row => row.status === 'running') || status === 'running';
  const failed = [...rows].reverse().find(row => row.status === 'error');
  const [opened, setOpened] = useState(running);
  useEffect(() => { setOpened(running); }, [running]);
  if (!line && rows.length === 0 && !failed) return null;
  return <section className="ap-tools" aria-label="工具调用">
    {line && status && <p role="status" className={`ap-tool-chip is-${status}`}>
      <span className="ap-tool-state">{toolStatusWord(status)}</span>
      <span>{line}</span>
      {understanding && line === '正在理解活动需求…' && <button type="button" onClick={onStop}>停止等待</button>}
    </p>}
    {!line && failed && <p role="status" className="ap-tool-chip is-error">
      <span className="ap-tool-state">未完成</span>
      <button type="button" onClick={() => setOpened(value => !value)}>{failed.result || failed.name}</button>
    </p>}
    {rows.length > 0 && <details open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
      <summary>执行过程</summary>
      <ol className="ap-tool-rows">
        {rows.map((row, index) => <li key={row.id} className={`ap-tool-row is-${row.status}`}>
          <span className="ap-tool-row-no" aria-hidden="true">{index + 1}</span>
          <div className="ap-tool-row-body">
            <div className="ap-tool-row-line">
              <span className="ap-tool-row-name">{row.name}</span>
              <span className="ap-tool-row-stat">{toolStatusWord(row.status)}</span>
            </div>
            <div className="ap-tool-row-detail">{row.result}</div>
          </div>
        </li>)}
      </ol>
    </details>}
  </section>;
}

function Bubbles({ agent, reviewOnly = false, onPickOption }: { agent: AgentValue; reviewOnly?: boolean; onPickOption: (text: string) => void }): JSX.Element {
  const list = reviewOnly ? agent.bubbles.filter(bubble => bubble.review) : agent.bubbles;
  return <>{list.map((bubble, bubbleIndex) => {
    const followups = bubble.role === 'agent' ? parseFollowUpOptions(bubble.text) : [];
    const laterUserTexts = list.slice(bubbleIndex + 1).filter(b => b.role === 'user').map(b => b.text.trim());
    const pickedOption = followups.find(option => laterUserTexts.includes(option));
    const settled = pickedOption !== undefined;
    return bubble.role === 'user'
    ? <div key={bubble.id} className={`ap-user${bubble.meta || bubble.warn ? ' is-file' : ''}`}>{(bubble.meta || bubble.warn) && <FileImage size={16} aria-hidden="true"/>}<div><strong>{bubble.text}</strong>{bubble.image && <img className="ap-msg-image" src={bubble.image} alt={bubble.text}/>}{bubble.meta && <small>{bubble.meta}</small>}{bubble.warn && <small className="ap-warn"><span aria-hidden="true">!</span>{bubble.warn}</small>}</div></div>
    : <div key={bubble.id} className="ap-turn"><div className={`ap-agent${bubble.amber ? ' is-amber' : ''}${bubble.long ? ' is-long' : ''}`}>
        {segmentBubbleBlocks(bubble.text).map((block, index) => block.kind === 'list'
          ? <ol key={index} className="ap-agent-list">{block.items!.map((item, itemIndex) => <li key={itemIndex} className="ap-agent-list-item">{item}</li>)}</ol>
          : <span key={index} className="ap-agent-line">{block.text}</span>)}
      </div>
      {followups.length > 0 && (
        <div className="ap-option-pick" role="group" aria-label="可选回复">
          {followups.map(option => {
            const picked = option === pickedOption;
            return <button key={option} type="button" className={`ap-option-row${picked ? ' is-picked' : ''}${settled && !picked ? ' is-dim' : ''}`} disabled={settled} onClick={() => onPickOption(option)}>
              <span className="ap-option-row-cap">{option}</span>
              {picked && <span className="ap-option-row-mark"><Check size={11} aria-hidden="true"/>已选</span>}
            </button>;
          })}
        </div>
      )}
      {bubble.zoneApply && (
        <div className="ap-zone-proposal">
          <span className="ap-blocked-stamp"><SquareDashed size={12} aria-hidden="true"/>圈区域</span>
          <p className="ap-zone-proposal__hint">要不要直接在 2D 上把提议的区域圈出来？</p>
          <button type="button" className="ap-zone-proposal__btn" onClick={bubble.zoneApply.run}>好，帮我圈</button>
        </div>
      )}
      {bubble.action && <button type="button" className="ap-bubble-action" onClick={bubble.action.run}>{bubble.action.label}</button>}
      {bubble.materialQueries?.map(query=><MaterialCandidatesPanel key={`${agent.sessionScope}:${getActiveAssistantSessionId(agent.sessionScope)??''}:${bubble.id}:${query}`} query={query} onOpenLibrary={()=>agent.callbacks.onOpenMaterials()}/>)}
    </div>;
  })}</>;
}

function GenProgress({ agent, paused, hidden }: { agent: AgentValue; paused?: boolean; hidden?: boolean }): JSX.Element | null {
  // 真实步骤时间线在场时，这套写死的步骤条让位——不同时摆两套进度。
  if (hidden) return null;
  return <div className={`ap-card ap-progress-card${paused ? ' is-paused' : ''}`} id="gen-progress">
    <span className="ap-progress-stamp"><Clock size={12} aria-hidden="true"/>{paused ? '已暂停' : '生成中'}</span>
    <p className="ap-progress-note">{paused ? '布置预览已暂停' : '正在准备布置预览'}</p>
    <div className="ap-progress-actions">
      {paused
        ? <>
            <button type="button" className="chip" onClick={agent.resume}>接着摆</button>
            <button type="button" className="chip btn-outline" onClick={agent.withdrawProposal}>不要了</button>
          </>
        : <button type="button" className="ap-link" onClick={agent.stop}>停一下</button>}
    </div>
  </div>;
}

/** One overlap refusal, not the long double sentence confirm used to paste twice. */
function foldConflictBubble(text: string): string {
  const count = text.match(/有 (\d+) 件物料存在冲突/);
  if (!count) return text;
  const why = text.match(/落点不合法：(.+)$/);
  const reason = (why?.[1] ?? '和旁边的物料叠在一起').replace(/。$/, '');
  return `${count[1]} 件没写上。${reason}。这次没有写入。`;
}

/** 这一轮候选卡上的决策留痕：批准 / 拒绝，只活在当前面板内存里，不落后端。 */
type ProposalDecision = 'approved' | 'rejected';

/* ── Web Speech API 最小本地收口：TS DOM 库未带 SpeechRecognition，类型只在本文件内，不写全局 d.ts。 ── */
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionInstanceLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
interface SpeechRecognitionCtorLike { new(): SpeechRecognitionInstanceLike }
function getSpeechRecognitionCtor(): SpeechRecognitionCtorLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtorLike; webkitSpeechRecognition?: SpeechRecognitionCtorLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 麦克风图标：仓库 solid-icons 未收录，本地内联一笔，Stroke 跟其他线性图标一致。 */
function MicIcon({ size = 18, 'aria-hidden': ariaHidden }: { size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
    </svg>
  );
}

/**
 * 提案分组清单：新增 / 挪动 / 撤掉 三组可点条目，点选只做选中定位，
 * 不挂任何单件批准/拒绝按钮；整版二元决策仍由卡片底部按钮行负责。
 */
function ProposalChangeList({ items, summary, onLocate }: {
  items: ProposalChangeItem[];
  summary: ProposalChangeSummary;
  onLocate(id: string): void;
}): JSX.Element {
  const groups = groupChangeItems(items);
  const meta: { kind: ProposalChangeKind; title: string }[] = [
    { kind: 'added', title: '新增' },
    { kind: 'moved', title: '挪动' },
    { kind: 'removed', title: '撤掉' },
  ];
  const summaryParts = [`改动 ${summary.total} 处`];
  if (summary.zoneCount != null) summaryParts.push(`涉及 ${summary.zoneCount} 个区域`);
  if (summary.elapsedMs != null) summaryParts.push(`用时 ${formatDurationClock(summary.elapsedMs)}`);
  return (
    <div className="ap-change-list">
      <p className="ap-note ap-change-summary">{summaryParts.join(' · ')}</p>
      {meta.map(({ kind, title }) => {
        const entries = groups[kind];
        if (entries.length === 0) return null;
        return (
          <details className="ap-change-group" key={kind}>
            <summary>{title}（{entries.length}）</summary>
            <ul>
              {entries.map(entry => (
                <li key={entry.id}>
                  <button type="button" className="ap-change-item" onClick={() => onLocate(entry.id)}>
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

/** 预览态：主钮「确认布置」，次钮「不用」；决策后原地留成徽章，一屏只留一个深主钮。 */
function ProposalCard({ agent, onPrefill, decision, onApprove, onReject }: {
  agent: AgentValue;
  onPrefill?: (text: string) => void;
  decision?: ProposalDecision | null;
  onApprove?: () => void;
  onReject?: () => void;
}): JSX.Element | null {
  const { layout } = useRoomEditor();
  const selection = useSelectionOptional();
  const plan = agent.proposal;
  if (!plan) return null;
  const names = plan.overlapNames.slice(0, 3).join('、');
  const review = !!plan.review;
  const guests = plan.guests && plan.guests > 0 ? plan.guests : 0;
  const seats = plan.seats ?? 0;
  const short = guests > 0 && seats < guests;
  const banquet = plan.receipt === 'banquet';
  const followupCtx: BoundaryContext = { guests, seats, short, banquet, review };
    // 云端还在写、或上一版还在恢复：最后一帧没稳，不亮确认。blocked / stale 同样不亮。
    const hold = agent.cloudBusy || agent.recovering;
  // 紧凑统计：座位 / 场地 / 物料 三件，数字大标签小。
  const areaValue = formatArea(plan.candidateArea ?? venueArea(layout));
  const placedCount = plan.outcome.placed ?? 0;
  const removedCount = plan.outcome.removed ?? 0;
  const movedCount = plan.outcome.moved ?? 0;
  // 状态徽章：绿=已干净，橙=待核验。一行排开，不写长段落。
  type Pill = { tone: 'ok' | 'warn'; label: string };
  const pills: Pill[] = [];
  if (plan.overlapCount > 0) pills.push({ tone: 'warn', label: `${plan.overlapCount} 件重叠` });
  else if (!plan.blocked) pills.push({ tone: 'ok', label: '无重叠' });
  if (short) pills.push({ tone: 'warn', label: `座位还差 ${guests - seats}` });
  else if (guests > 0) pills.push({ tone: 'ok', label: '座位够了' });
  if (plan.seatingAllocationUnverified || plan.seatingSpecsUnverified || plan.seatingHeadcountUnverified) {
    pills.push({ tone: 'warn', label: '座位待核验' });
  }
  if (plan.safetyChecksUnknown) pills.push({ tone: 'warn', label: '安全待核' });
  if (plan.entranceWarning) pills.push({ tone: 'warn', label: '门口净区待查' });
  const pillRow = pills.slice(0, 5);
  return <div className="ap-card ap-plan" id="plan-proposal" data-tour="proposal-card">
    <strong>{plan.comparisonOnly ? '原场景对照' : review ? '改法预览' : '这版还在预览'}</strong>
    {layout && !plan.comparisonOnly && <div className="ap-plan-thumb" aria-hidden="true"><PlanPreview layout={layout}/></div>}
    {guests > 0 && !banquet && <div className="ap-seats-meter" aria-hidden="true"><div className="ap-seats-meter-fill" style={{ width: `${Math.min(100, Math.round((seats / Math.max(guests, 1)) * 100))}%` }} data-short={short ? 'true' : undefined}/></div>}
    <div className="ap-stats ap-plan-stats">
      {banquet && <div className="ap-stat"><b>{plan.placedTables ?? 0}</b><span>桌</span></div>}
      {guests > 0 && <div className="ap-stat" data-short={short ? 'true' : undefined}>
        <b>{seats}<span className="ap-stat-of">/{guests}</span></b>
        <span>{banquet ? '座位' : '座位 / 目标'}</span>
      </div>}
      <div className="ap-stat"><b>{areaValue}</b><span>㎡ 场地</span></div>
      {(placedCount > 0 || removedCount > 0 || movedCount > 0) && <div className="ap-stat">
        <b>{placedCount > 0 ? `+${placedCount}` : '·'}{removedCount > 0 ? ` -${removedCount}` : ''}{movedCount > 0 ? ` 挪${movedCount}` : ''}</b>
        <span>新增 / 撤掉</span>
      </div>}
    </div>
    {pillRow.length > 0 && <div className="ap-pills" role="status">
      {pillRow.map(pill => <span key={pill.label} className={`ap-pill ap-pill-${pill.tone}`}>{pill.label}</span>)}
    </div>}
    {plan.changeItems && plan.changeItems.length > 0 && plan.changeSummary && (
      <ProposalChangeList
        items={plan.changeItems}
        summary={plan.changeSummary}
        onLocate={id => selection?.selectOnly(id, { keepPanel: true })}
      />
    )}
    <BoundaryLineNote plan={plan} ctx={followupCtx}/>
    {plan.venueChange && <p className="ap-warn-line">{plan.venueChange}；确认前不会修改场地。</p>}
    {!!plan.removedZones && <p className="ap-warn-line">这版将移除 {plan.removedZones} 个已有区域标注。</p>}
    {short && !plan.localDraftDetails && (!plan.seatPriority || (banquet && !/加不进更多/.test(plan.blocked ?? ''))) && <div className="ap-error-actions ap-seat-fix"><button type="button" className="chip btn-outline" onClick={agent.addSeats}>加座，再排一版</button></div>}
    {plan.blocked && <p className="ap-warn-line"><span aria-hidden="true">!</span>{plan.blocked}</p>}
    {agent.inventoryBlocked && <p role="alert">{agent.inventoryInvalid?'物料数量输入无效，请更正或清空后再确认。':'已填写的物料数量不足，请调整数量或方案后再确认。'}</p>}
    {hold
      ? <p className="ap-small" id="plan-busy" role="status">{agent.recovering && !agent.cloudBusy ? '上一版还在恢复，确认先不亮。' : '正在整理这一版…'}</p>
      : decision === 'approved'
        ? <div className="ap-decision-row" aria-label="本版已批准">
            <span className="ap-decision-badge is-approved"><Check size={14} aria-hidden="true"/>已批准</span>
          </div>
        : decision === 'rejected'
          ? <div className="ap-decision-row" aria-label="本版已拒绝">
              <span className="ap-decision-badge is-rejected"><X size={14} aria-hidden="true"/>你拒绝了</span>
            </div>
          : <>
          {!plan.blocked && !agent.inventoryBlocked && !agent.exportPreview && <button id="step-cta" type="button" className="btn-primary" data-tour="confirm-plan" onClick={() => { onApprove?.(); agent.confirmProposal(); }}>确认布置</button>}
          <div id="cta-hint" className="ap-error-actions">
            <button type="button" className="chip btn-outline" onClick={() => { onReject?.(); agent.withdrawProposal(); }}>不用</button>
            {!review && <button type="button" className="chip btn-outline" onClick={() => agent.regenerate()}>换一版</button>}
          </div>
          <FollowupChips plan={plan} ctx={followupCtx} onPrefill={onPrefill}/>
        </>}
    {!banquet && <div className="ap-notes">
      {plan.source === 'local' && plan.added > 0 && <p className="ap-note">新增物料由系统规则生成。</p>}
      {plan.planNotes?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.recolorPreview?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.rotationPreview?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.scalePreview?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.movementPreview?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.restPreview?.map(line => <p className="ap-note" key={line}>{line}；通行和消防条件待核验。</p>)}
      {short && !plan.localDraftDetails && plan.seatPriority && <p className="ap-note" id="plan-seat-cap">这次排到 {seats} 座，仍缺 {guests - seats} 座；可尝试调整物料规格、功能区或场地，再核对方案。</p>}
      {plan.overlapCount > 0 && <p className="ap-warn-line"><span aria-hidden="true">!</span>{review ? '改完还剩 ' : ''}{plan.overlapCount} 件挤在一起或压到墙：{names}{plan.overlapNames.length > 3 ? ' 等' : ''}。</p>}
      {plan.seatingReview?.status==='broken' && <p className="ap-note" role="status">原生成的桌椅配套有 {plan.seatingReview.brokenGroups} 组缺少物件；仍保留原配套关系的椅子有 {plan.seatingReview.intactChairs} 把，实际座位及现场条件仍需核验。</p>}
      {plan.seatingReview?.status==='unknown' && <p className="ap-note" role="status">桌椅配套关系尚未核验，不能只按椅子数量认定座位充足；请检查桌椅对应关系。</p>}
      {plan.localDraftDetails?.map(line=><p className="ap-note" key={line}>{line}</p>)}
      {plan.seatWarning && <p className="ap-note">{plan.seatWarning}</p>}
      {plan.seatCeilingNote && <p className="ap-note" role="status">{plan.seatCeilingNote}</p>}
      {plan.annotationWarning && <p className="ap-note" role="status">{plan.annotationWarning}</p>}
      {plan.functionalWarnings?.map(message => <p className="ap-note" key={message}>{message}</p>)}
      {!!plan.existingChanges?.length && <details className="ap-existing-changes">
        <summary>对现有物料的改动（{plan.existingChanges.length} 件）</summary>
        <p>确认后将修改现有物料；目前仅为预览，尚未应用。位置以场地中心为原点。</p>
        <ul>{plan.existingChanges.map(change=><li key={change.id}>{change.text}</li>)}</ul>
      </details>}
      <p className="ap-note">{REFERENCE_SOURCE_UNVERIFIED}</p>
    </div>}
    {banquet && short && !plan.localDraftDetails && plan.seatPriority && !/加不进更多/.test(plan.blocked ?? '') && <p id="plan-seat-cap">这次排到 {seats} 座，仍缺 {guests - seats} 座；可尝试调整物料规格、功能区或场地，再核对方案。</p>}
    {plan.modelExplanation && <ModelTextDisclosure><p>{plan.modelExplanation}</p></ModelTextDisclosure>}
    {!banquet && agent.inventoryWorkspace}
  </div>;
}

/**
 * 左轨四个工作入口：活动（内部 id 沿用 'door'）、Bingo 审校、空间、物料。
 * 活动是唯一的 Agent；其他入口同时提供人工操作与可逐步接入的工具能力。
 */
export type AgentId = 'door' | 'bingo' | 'space' | 'material';

export const AGENT_META: Record<AgentId, { name: string; form: RailForm; role: string }> = {
  door: { name: '活动', form: 'door', role: '活动需求、布置生成与方案确认' },
  bingo: { name: 'Bingo', form: 'ball', role: '方案审校、问题钉与客户评审' },
  space: { name: '空间', form: 'cube', role: '选址后的场地结构、图纸与环境' },
  material: { name: '物料', form: 'pyramid', role: '物件规格、模型与生成' },
};

export function AgentPanel({ onClose, headerAvatarRef, headerAvatarVisible = true, activeAgent = 'door', spaceSlot, materialSlot, bingoSlot, chatSlot, className, style, floatBar, floatFooter, onHeaderPointerDown }: {
  onClose?(): void;
  /** 顶栏头像位置：飞入动画从这里起飞/降落。 */
  headerAvatarRef?: RefObject<HTMLSpanElement>;
  /** 头像到位后再显形，飞行那 260ms 由固定层顶着。 */
  headerAvatarVisible?: boolean;
  /** 当前 agent。四格共用一个面板，切换只换身份和卡片。 */
  activeAgent?: AgentId;
  /** 空间卡片：场地、模板、环境。 */
  spaceSlot?: ReactNode;
  /** 物料卡片：物料库与生成。 */
  materialSlot?: ReactNode;
  /** Bingo 卡片：规划信息（统计/清单/问题/图例）合入审校台，不再单占左轨。 */
  bingoSlot?: ReactNode;
  /** 活动/空间/物料各自的对话区（Bingo 用自带的真对话，不传）。 */
  chatSlot?: ReactNode;
  /** 2026-11-11：被抓成独立小窗时的额外类名（is-detached，定位与尺寸走 --sc-float-* 变量）。 */
  className?: string;
  /** 独立小窗的 CSS 变量（--sc-float-x/y/w/h）。 */
  style?: React.CSSProperties;
  /** 独立小窗顶部的拖动条（拖动移动 + 收回按钮由调用方提供）。 */
  floatBar?: ReactNode;
  /** 独立小窗右下角的缩放抓手（由调用方提供，定位 absolute）。 */
  floatFooter?: ReactNode;
  /** 2026-11-11：住在左栏时按住标题往栏外拖 → 直接抓成独立小窗（由调用方接管拖拽逻辑）。 */
  onHeaderPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
} = {}): JSX.Element {
  const agent = useAgent();
  const studio = useStudioAgent();
  const assistantSessions = useAssistantSessions(agent.assertSessionWrite, agent.sessionScope);
  const [showHistory, setShowHistory] = useState(false);
  // 候选卡决策留痕：只在本机这一轮内存里，刷新/换会话即清，不写后端。
  const [proposalDecision, setProposalDecision] = useState<ProposalDecision | null>(null);
  const { layout, activeFloor } = useRoomEditor();
  const mode = agent.callbacks.workbenchMode;
  const draftKey=JSON.stringify([agent.sessionScope,assistantSessions.activeId]);
  const [draftState,setDraftState]=useState(()=>({key:draftKey,value:volatileComposerDrafts.get(draftKey)??''}));
  const [footDetailOpen,setFootDetailOpen]=useState(false);
  const draft=draftState.key===draftKey ? draftState.value : volatileComposerDrafts.get(draftKey)??'';
  const setDraft=(value:string)=>{ if(value)volatileComposerDrafts.set(draftKey,value);else volatileComposerDrafts.delete(draftKey);setDraftState({key:draftKey,value}); };
  const restoredCancellation=useRef<number|null>(null);
  useEffect(()=>{const cancelled=agent.cancelledInput;if(!cancelled||restoredCancellation.current===cancelled.id)return;restoredCancellation.current=cancelled.id;if(!draft.trim())setDraft(cancelled.text);},[agent.cancelledInput]);
  // 语音转文字：点一下开始拾音、再点停止；结果 append 到现有 draft 后，不覆盖。
  const toggleMic = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (recognitionRef.current) { recognitionRef.current.stop(); return; }
    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0]?.transcript ?? '';
      const text = transcript.trim();
      if (!text) return;
      const current = volatileComposerDrafts.get(draftKey) ?? '';
      setDraft(current.trim() ? `${current.trim()} ${text}` : text);
    };
    recognition.onend = () => { recognitionRef.current = null; setListening(false); };
    recognition.onerror = () => { recognitionRef.current = null; setListening(false); };
    recognitionRef.current = recognition;
    setListening(true);
    try { recognition.start(); } catch { recognitionRef.current = null; setListening(false); }
  }, [draftKey]);
  // 卸载时别把麦克风挂在后台。
  useEffect(() => () => { recognitionRef.current?.abort(); recognitionRef.current = null; }, []);
  const feed = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 树外入口（选中物件弹层）经预填总线把指令送进既有 composer：
  // 并入现有草稿（空格追加、不覆盖），聚焦输入框；不自动发送，仍走原提案审批链。
  useEffect(() => subscribeComposerPrefill((text) => {
    const current = volatileComposerDrafts.get(draftKey) ?? '';
    setDraft(current.trim() ? `${current.trim()} ${text}` : text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }), [draftKey]);
  // 语音拾音：识别器实例与拾音中标记，纯本机内存，不落后端。
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const [listening, setListening] = useState(false);
  const speechSupported = getSpeechRecognitionCtor() !== null;
  const demo = isDemoBackend();
  // 第 8 批：真实运行账本（云端 AgentRun 写进来的真步骤/真轮数）。
  const runState = useAgentRun();
  const items = materialCount(activeFloor.items);
  // 空会话要让人先看见顶上那句指路，别一进来就滚到底。
  useEffect(() => {
    if (agent.bubbles.length === 0 && mode === 'layout') return;
    feed.current?.scrollTo?.({ top: feed.current.scrollHeight });
  }, [agent.bubbles.length, agent.state, mode]);
  const generating = agent.state === 'generating';
  const localStageLine = runState.scope === 'layout'
    ? runState.stepLog.find(step => step.outcome === 'running')?.thought ?? null
    : null;
  const processText = composeProcessStrip({
    understanding: agent.understanding || agent.briefBusy,
    generating,
    cloudRunning: runState.scope === 'layout' && runState.isRunning && runState.eventLog.length > 0,
    cloudRound: runState.thoughtCount,
    cloudTool: agent.toolPending,
    failed: generating || agent.understanding || agent.briefBusy ? null : agent.processFailed,
    stageLine: agent.toolPending ? null : localStageLine,
  });
  // 每格只说它自己那一层的事：活动、Bingo、空间、物料共用同一份配置。
  const suggestion = useSuggestion(activeAgent === 'door' && agent.banquetChat ? BANQUET_INPUT_SUGGESTIONS : AGENT_INPUT_SUGGESTIONS[activeAgent]);
  // 引导层与 placeholder 只能出现一个，否则两层灰字会叠在一起。
  // 待确认 / 暂停 / 圈选态让位给状态专属 placeholder，不再打例句。
  const proposed = agent.state === 'planProposed';
  const paused = agent.state === 'generatePaused';
  const planShown = agent.state === 'planReady' || agent.state === 'planEdited';
  const ghostVisible = mode === 'layout' && !draft.trim() && !generating && !proposed && !paused && !agent.mapPickerOpen;
  // 输入框 placeholder 随状态五套切换；review/delivery/banquet 既有分支保留在后。
  const composerPlaceholder = agent.mapPickerOpen
    ? '请在地图上圈选范围'
    : generating ? '为下一步添加备注'
    : proposed ? '或用文字回答'
    : paused ? '补充说明后继续'
    : mode === 'review' ? '说一句，比如「准备客户评审」'
    : mode === 'delivery' ? '说一句，比如「导出给搭建方」'
    : agent.banquetChat ? '说一句，比如「加座，再排一版」'
    : '说一句，比如「80 人发布会，室内 12×9」';
  // 发送键双态：空且无附件 → 麦克风；有字（或带附件）→ 箭头。理解中禁用，既有闸门不动。
  const hasDraft = draft.trim().length > 0;
  const canSend = !agent.isUnderstanding(draft) && (hasDraft || !!agent.pendingFile);
  const showMic = !hasDraft && !agent.pendingFile;
  const preStates = !generating && !proposed && !paused && !planShown && agent.state !== 'generateFailed';
  // 回看不编数字：人没说人数就不写「0 人」。读数只算一次，回显卡和落盘那行共用。
  const recap = [agent.recap.event, agent.recap.guests, agent.recap.dims].filter(Boolean).join(' · ');
  const sessionTitle = assistantSessions.activeSession?.title ?? ASSISTANT_SESSION_DEFAULT_TITLE;
  const meta = AGENT_META[activeAgent];
  const bingo = activeAgent === 'bingo';
  // 内部 id 仍是 'door'：这里用语义别名，S4 再做标识符级重命名。
  const activity = activeAgent === 'door';
  /** 活动与 Bingo 共用同一场对话的气泡与底部；布置生成 chrome 只在活动脸出现。 */
  const conversation = bingo || activity;

  // 状态头三件套：色调 + 图标 + 短文案；拿不到明确阶段就回退现有头部样式，不硬造状态。
  const headStatus: { tone: 'ask' | 'think' | 'run' | 'paused' | 'stopped'; label: string; icon: ReactNode } | null = (() => {
    if (mode !== 'layout' || !activity) return null;
    const s = agent.state;
    if (s === 'planProposed') return { tone: 'ask', label: '等你确认', icon: <HelpCircle size={15} aria-hidden="true" /> };
    if (agent.understanding || agent.briefBusy) return { tone: 'think', label: '正在思考', icon: <Sparkles size={15} aria-hidden="true" /> };
    if (s === 'generating') return { tone: 'run', label: '施工中', icon: <Loader2 size={15} className="cr-spin" aria-hidden="true" /> };
    if (s === 'generatePaused') return { tone: 'paused', label: '已暂停', icon: <span className="ap-pause-glyph" aria-hidden="true"><i /><i /></span> };
    if (FAILED_STATES.includes(s)) return { tone: 'stopped', label: '已停止', icon: <Square size={14} aria-hidden="true" /> };
    return null;
  })();

  // 新一轮候选进来 / 换会话：清掉上一轮的决策留痕（纯内存态）。
  useEffect(() => { if (agent.proposal) setProposalDecision(null); }, [agent.proposal]);
  useEffect(() => { setProposalDecision(null); }, [assistantSessions.activeId]);
  // 批准被既有闸门拦下时提案仍在、状态仍是待确认：别把徽章留成已批准。
  useEffect(() => {
    if (proposalDecision === 'approved' && agent.state === 'planProposed' && agent.proposal) setProposalDecision(null);
  }, [agent.state, agent.proposal, proposalDecision]);

  // 活动那格常亮；这场对话出问题就爆红，别让人以为它还好好活着。（lane id 仍为内部字面量 'door'）
  useEffect(() => {
    if (FAILED_STATES.includes(agent.state)) setLaneActivity('door', 'workbench-agent', 'warn', '这一单没出成');
    else clearLaneActivity('door', 'workbench-agent');
  }, [agent.state]);

  useEffect(() => {
    setShowHistory(false);
  }, [assistantSessions.activeId]);

  return <aside id="agent-panel" className={`sc-agent-panel${className ? ` ${className}` : ''}`} style={style} data-state={activity ? (mode === 'layout' ? agent.state : mode) : activeAgent} data-venue-io={agent.venueIO} aria-label={meta.name} tabIndex={-1}>
    {floatBar}
    <header className="ap-head ap-session-head" data-tone={headStatus?.tone} onPointerDown={onHeaderPointerDown}>
      <div className="ap-session-identity">
        <span ref={headerAvatarRef} className={`ap-session-avatar-slot${headerAvatarVisible ? ' is-visible' : ''}`}>
          <RailAvatar key={activeAgent} form={meta.form} size={36} />
        </span>
        <h1 className="ap-session-title" title={activity ? sessionTitle : meta.name}>{activity ? sessionTitle : meta.name}</h1>
        {headStatus && <span className={`ap-head-status ap-head-status--${headStatus.tone}`} role="status">
          {headStatus.icon}<span>{headStatus.label}</span>
        </span>}
      </div>
      <div className="ap-session-actions">
        {activeAgent === 'space' && <details className="sc-space-library-menu">
          <summary aria-label="场地资料" data-tip="场地资料"><Paperclip size={17} aria-hidden="true"/></summary>
          <div className="sc-space-library-menu-content">
            <button type="button" className="chip" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); agent.startVenuePicker(); }}>新建/换场地</button>
            <button type="button" className="chip" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); agent.callbacks.onOpenReference?.(); }}>图纸与照片</button>
          </div>
        </details>}
        {activity && <>
        <button
          type="button"
          className={`ap-icon-btn${showHistory ? ' is-on' : ''}`}
          aria-expanded={showHistory}
          aria-label="会话历史"
          data-tip="会话历史"
          onClick={() => setShowHistory(value => !value)}
        >
          <Clock size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ap-icon-btn"
          aria-label="新开会话"
          data-tip="新开会话"
          onClick={() => { const created=assistantSessions.openSession(); if(created?.verifiedFresh)agent.acceptFreshSession(created.id); setShowHistory(false); inputRef.current?.focus(); }}
        >
          <MessageCirclePlus size={18} aria-hidden="true" />
        </button>
        </>}
        {onClose && (
          <button type="button" className="ap-icon-btn ap-close" aria-label={`收起 ${meta.name}`} data-tip={`收起 ${meta.name}`} onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
    <div className="ap-body">
      {activity && <SessionHistoryOverlay open={showHistory} scope={agent.sessionScope} assertWrite={agent.assertSessionWrite} onClose={() => setShowHistory(false)} onSelect={() => { /* 正文由 LayoutAgentProvider 跟 activeId 切换 */ }} />}
    {conversation ? <div className="ap-feed" ref={feed} aria-live="polite">
      {demo && <p className="ap-demo-note" role="note">本机试用 · {modelEnabled() && studio?.controller ? '可尝试智能对话，是否可用以实际运行结果为准。' : '当前对话使用本机规则理解，其他能力以实际运行结果为准。'}</p>}
      {/* S1.1 活动开场画廊：仅活动脸 layout 模式挂载，Bingo/空间/物料脸不进。 */}
      {activity && mode === 'layout' && <ActivitiesGalleryMount/>}
      {/* T2：空态话术按脸分——活动脸是布置引导，Bingo 脸是审校引导，不再共用「先说一句」。 */}
      {mode === 'layout' && agent.state !== 'generating' && (bingo ? agent.bubbles.filter(b => b.review).length === 0 : agent.bubbles.length === 0) && <div className="ap-lead">
        <p className="ap-lead-title">{bingo ? '这边只管审校' : '先说一句就行'}</p>
        <p className="ap-lead-body">{bingo ? '点「立即体检」查看几何问题，或准备客户评审。对方的意见保存在对方浏览器，不会自动回到这里。' : '点一句例子，或自己说；听懂了会回显，确认后才写进画布。'}</p>
      </div>}
      {activity && mode === 'layout' && isPlanHome(agent.state, layout, agent.proposal !== null) && (
        <PlanHome
          draft={draft}
          onPickExample={sentence => { setDraft(sentence); requestAnimationFrame(() => inputRef.current?.focus()); }}
          onGenerate={sentence => { if (!agent.isSessionCurrent()) return; setDraft(''); void agent.send(sentence); }}
        />
      )}
      {activity && mode === 'layout' && planShown && <p className="ap-recap recap-done"><Check size={16} aria-hidden="true"/>{recap}</p>}
      {/* T3 封堵：review/delivery 旧模式门已由 demoteLegacyMode 收编，评审只走分享链接，旧 review/delivery 槽与话术随刀删除。 */}
      {/* T2：Bingo 脸只回放审校气泡（体检回执/钉评指路），不再共享活动脸的布置生成对话。 */}
      <Bubbles agent={agent} reviewOnly={bingo} onPickOption={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}/>
      {agent.outdoorTask && <OutdoorTaskCard task={agent.outdoorTask}
        canStop={Boolean(agent.venuePick?.loading || agent.venuePick?.picking || agent.routeBusy || agent.flowSimActive)}
        onInspectFacility={agent.inspectOutdoorFacility} onStop={agent.stopOutdoorTask} onPrefill={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}>
      {agent.venuePick && <VenueConfirmCard
        state={agent.venuePick}
        onPick={place => agent.handleVenuePick(place)}
        onDismiss={() => agent.dismissVenuePick()}
      />}
      {/* V-2d 流线提案确认卡：虚线预览在画布，应用才写入（可撤销）。 */}
      {!agent.venuePick && agent.routeProposal && <RouteConfirmCard
        summary={agent.routeProposal.summary}
        routes={agent.routeProposal.routes.length}
        busy={agent.routeBusy}
        onConfirm={() => agent.confirmRouteProposal()}
        onDismiss={() => agent.dismissRouteProposal()}
      />}
      {/* V-3 区域提案确认卡：虚线分区+物料幽灵在画布，应用才写入（可撤销）。 */}
      {!agent.venuePick && !agent.routeProposal && agent.zoneProposal && <ZoneConfirmCard
        proposal={agent.zoneProposal}
        busy={agent.zoneBusy}
        onConfirm={() => agent.confirmZoneProposal()}
        onDismiss={() => agent.dismissZoneProposal()}
      />}
      </OutdoorTaskCard>}
      {activity && mode === 'layout' && <ToolCallTrace line={processText} rows={runState.scope === 'layout' && runState.eventLog.length > 0 ? [] : toolTraceRows({ isRunning: runState.isRunning, events: runState.eventLog, steps: runState.stepLog })} understanding={agent.understanding} onStop={agent.cancelUnderstanding}/>}
      {/* 云端真跑时由 AgentRunPanel 接管：真步骤时间线 + 停止确认行 + 过往任务归档；
          processText 状态条保留在 ToolCallTrace，避免两份「执行过程」列表。 */}
      {activity && mode === 'layout' && <AgentRunPanel scope="layout" controls steerInputId="ap-input"/>}
      {activity && agent.historyReviewRequired && <section className="ap-card ap-status-card ap-blocked-card" aria-label="历史需求待核对">
        <span className="ap-blocked-stamp"><Lock size={12} aria-hidden="true"/>待核对</span>
        <p className="ap-blocked-note">当前记录还未核对。</p>
        <button type="button" className="btn-primary" disabled={agent.unresolvedDialogue.length>0 || agent.understanding || agent.generationQueued>0} onClick={agent.reviewDialogueHistory}>按当前记录重新开始</button>
      </section>}
      {activity && agent.retainedOtherSessionProposal && <section className="ap-card ap-blocked-card" aria-label="其他会话的旧方案">
        <span className="ap-blocked-stamp"><RotateCcw size={12} aria-hidden="true"/>旧方案</span>
        <p className="ap-blocked-note">其他会话有未确认的旧方案，当前会话不能应用；撤回后可以继续生成或导出。</p>
        <div className="ap-blocked-actions">
          <button type="button" className="chip" onClick={agent.withdrawRetainedOtherSessionProposal}>撤回其他会话旧方案</button>
        </div>
      </section>}
      {activity && agent.unresolvedDialogue.length>0 && <section className="ap-card ap-pending-card" aria-label="尚未处理的要求">
        <span className="ap-blocked-stamp">待处理 · {agent.unresolvedDialogue.length}</span>
        <ul className="ap-pending-chips">
          {agent.unresolvedDialogue.map(text => <li key={text}><span title={text}>{text}</span><button type="button" className="ap-pending-x" aria-label={`撤回：${text}`} onClick={() => agent.withdrawUnresolvedDialogue(text)}>×</button></li>)}
        </ul>
        <div className="ap-pending-foot">
          <button type="button" className="ap-text-action" onClick={agent.withdrawAllUnresolved}>全部撤回</button>
        </div>
      </section>}
      {/* S2-1 审校状态台：体检/客户评审/导出三钮直达，零新 state；composer 摘除属 T2，本刀不动。 */}
      {bingo && <div className="ap-card ap-status-panel" aria-label="审校状态台">
        <span className="ap-blocked-stamp">审校状态</span>
        <div className="ap-chips">
          <button type="button" className="chip btn-outline" onClick={() => agent.reviewNow()}>立即体检</button>
          <button type="button" className="chip btn-outline" onClick={agent.callbacks.onOpenReview}>准备客户评审</button>
          <button type="button" className="chip btn-outline" onClick={() => agent.issueReviewLink()}>发送钉评链接</button>
        </div>
      </div>}
      {bingo && <BingoAuditCard scopeKey={agent.sessionScope} isCurrent={agent.isSessionCurrent}/>}
      {/* 布置生成态只属于活动脸；Bingo 脸 S2 再接审校工作台，中间态不挂生成卡片。 */}
      {activity && mode === 'layout' && <>
        {studio?.applyRecovery && <section className="ap-card ap-error-card" role="alert">
          <span className="ap-error-stamp"><TriangleAlert size={12} aria-hidden="true"/>待核对</span>
          <p className="ap-error-summary">{cloudRecoveryMessage(studio.applyRecovery)}</p>
          <div className="ap-error-actions">
            <button type="button" className="chip" disabled={studio.busy || studio.reviewingApplyRecovery} onClick={() => void studio.reviewApplyRecovery()}>
              {studio.reviewingApplyRecovery ? '正在只读核对…' : '只读核对云端版本'}
            </button>
          </div>
          {studio.applyRecoveryReview && <>
            <p className="ap-blocked-note">{studio.applyRecoveryReview.message}</p>
            <div className="ap-error-actions">
              <button type="button" className="chip btn-outline" disabled={studio.busy || studio.reviewingApplyRecovery} onClick={() => void studio.acknowledgeApplyRecovery()}>
                {studio.applyRecoveryReview.status === 'unknown' ? '我已手动核对，解除提醒' : '已查看核对结果，解除提醒'}
              </button>
            </div>
          </>}
        </section>}
        {preStates && agent.issue && <div className="ap-chips">{agent.issue.kind === 'readFailed' ? <><button type="button" className="chip is-on" onClick={agent.retryFile}>重试</button><button type="button" className="chip" onClick={agent.pickFile}>换个文件</button></> : <button type="button" className="chip is-on" onClick={agent.pickFile}>重新选文件</button>}</div>}
        {/* 第 8 批：云端真跑时用真实步骤时间线（真实进度句 + 真实模型轮数 + 真实耗时），
            没有真实运行（本机规则模式）才回退到那套写死的步骤条。 */}
        {(generating || paused) && <GenProgress agent={agent} paused={paused} hidden={runState.scope === 'layout' && runState.eventLog.length > 0}/>}
        {agent.state === 'generateFailed' && <section id="inline-error" className="ap-card ap-error-card" role="alert">
          <span className="ap-error-stamp"><TriangleAlert size={12} aria-hidden="true"/>未完成</span>
          <p className="ap-error-summary">这次未完成，原场景未自动应用。请先查看任务状态或提示，再决定下一步。</p>
          <div className="ap-error-actions">
            <button type="button" className="chip" onClick={agent.retry}><RotateCw size={14} aria-hidden="true"/>重试</button>
            <button type="button" className="chip btn-outline" onClick={() => { const input = document.getElementById('ap-input'); input?.focus(); }}>改一句再说</button>
          </div>
        </section>}
        {agent.modelFailure && <section className="ap-card ap-error-card" role="alert">
          <span className="ap-error-stamp"><TriangleAlert size={12} aria-hidden="true"/>智能理解</span>
          <p className="ap-error-summary">{agent.modelFailure.text}</p>
          <div className="ap-error-actions">
            <button type="button" className="chip" onClick={() => { const retry = agent.modelFailure?.retry; agent.dismissModelFailure(); retry?.(); }}><RotateCw size={14} aria-hidden="true"/>重试云端理解</button>
            <button type="button" className="chip btn-outline" onClick={() => { agent.dismissModelFailure(); document.getElementById('ap-input')?.focus(); }}>改一句再说</button>
          </div>
        </section>}
        {proposed && <ProposalCard agent={agent} decision={proposalDecision} onApprove={() => setProposalDecision('approved')} onReject={() => setProposalDecision('rejected')} onPrefill={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}/>}
        {!proposed && proposalDecision === 'rejected' && (
          <section className="ap-card ap-plan ap-decision-card" aria-label="本版已拒绝">
            <span className="ap-decision-badge is-rejected"><X size={14} aria-hidden="true"/>你拒绝了</span>
          </section>
        )}
        {planShown && <>
          <div className="ap-card ap-plan" id="plan-summary">
            <span className="ap-blocked-stamp"><MapIcon size={12} aria-hidden="true"/>布置</span>
            <strong>这一版布置</strong>
            <div className="ap-stats">
              <div className="ap-stat"><b>{formatArea(venueArea(layout))}</b><span>㎡ 场地</span></div>
              <div className="ap-stat"><b>{items}</b><span>件物料</span></div>
            </div>
            {agent.overlapCount > 0 ? <p className="ap-warn-line"><span aria-hidden="true">!</span>{agent.overlapCount} 件物料重叠或超出场地，画布上已用黄色标出。</p> : <p className="ap-ok-line">当前检查未发现物料重叠；场地和通行仍需核对。</p>}
            <div className="ap-chips">
              <button type="button" className="chip" onClick={() => agent.regenerate()}>换一版</button>
              <button type="button" className="chip" onClick={agent.callbacks.onOpenMaterials}>我来调</button>
              <button type="button" className="chip btn-outline" onClick={agent.walkthrough}>第一人称漫游</button>
              <button type="button" className="chip btn-outline" onClick={agent.callbacks.onOpenDelivery}>导出与交接</button>
            </div>
          </div>
        </>}
      </>}
      {agent.exportPreview && <div className="ap-card ap-export-card" id="export-preview">
        <span className="ap-blocked-stamp"><Download size={12} aria-hidden="true"/>导出</span>
        <strong>导出执行资料草案</strong>
        <p className="ap-blocked-note">包含执行页已保存的手工需求、物料工作单、制作计划和数量点验；不完整包含对话需求，交付前请逐项核对。</p>
        {agent.proposal || !!studio?.preview
          ? <p className="ap-blocked-note" role="status">当前有尚未应用的方案预览；请先确认布置或撤回预览，再导出。</p>
          : generating || paused || agent.cloudBusy || agent.recovering || agent.cloudStale || !!studio?.applyRecovery
          ? <p className="ap-blocked-note" role="status">这一版还没稳，确认先不亮。</p>
          : studio?.cloudMaterialDraftAvailable ? <p className="ap-blocked-note">云项目暂不支持此执行资料草案，可先导出下方物料草案。</p>
          : <button type="button" className="btn-primary" onClick={agent.confirmExport}>确认导出</button>}
        {studio?.cloudMaterialDraftAvailable && !agent.proposal && !studio.preview && !generating && !paused && !agent.cloudBusy && !agent.recovering && !agent.cloudStale && !studio.applyRecovery && <>
          <button type="button" className="chip" onClick={agent.confirmCloudMaterialDraft}>导出当前场景物料清单草案</button>
          <p className="ap-blocked-note">本机快照，未冻结；不含完整需求、点验及场地方确认。模型与实物库存、现场条件均需核验。</p>
        </>}
        <div className="ap-error-actions">
          <button type="button" className="chip btn-outline" onClick={agent.dismissExport}>先不了</button>
        </div>
      </div>}
    </div>
    : <div key={activeAgent} className={`ap-agent-surface is-${activeAgent}`}>
      {activeAgent === 'space' && spaceSlot}
      {activeAgent === 'material' && materialSlot}
    </div>}
    {activeAgent === 'bingo' && bingoSlot}
    {!conversation && chatSlot}
    </div>
    {/* T2：输入条、风格套与能力提示只属于活动脸；Bingo 脸纯审校台，无输入框。 */}
    {activity && <>
        {/* 活动脸统管活动级选址与布置风格套；Bingo 不再保留布置生成入口。 */}
        {mode === 'layout' && activity && agent.stylePickerOpen && (
          <StyleBundlePanel
            disabled={generating}
            onClose={agent.closeStylePicker}
            onPick={bundle => agent.placeStyleBundle(bundle)}
          />
        )}
        {mode === 'layout' && activity && <AgentCapabilityPrompts onPrefill={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}/>}
        <form id="composer" className="ap-composer" onSubmit={event => { event.preventDefault(); if (!agent.isSessionCurrent() || agent.isUnderstanding(draft)) return; void agent.send(draft); setDraft(''); }}>
        <label className="sr-only" htmlFor="ap-input">告诉 Agent 要改的</label>
        <div className="ap-composer-field ap-panel-field">
        {ghostVisible && <SuggestionGhost className="ap-ghost" full={suggestion.full} shown={suggestion.shown} onPick={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}/>}
        <textarea id="ap-input" data-tour="chat-input" aria-describedby="ap-data-notice" ref={inputRef} rows={2} value={draft} maxLength={600} placeholder={ghostVisible ? '' : composerPlaceholder} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Tab' && mode === 'layout' && !draft.trim()) { event.preventDefault(); setDraft(suggestion.full); return; }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!agent.isSessionCurrent() || agent.isUnderstanding(draft)) return; void agent.send(draft); setDraft(''); }
        }}/>
        {agent.pendingFile && <div className="sc-chat-file ap-file-chip">
          <img className="sc-chat-file-thumb" src={agent.pendingFile.url} alt=""/>
          <span className="sc-chat-file-name">{agent.pendingFile.name}</span>
          <button type="button" className="sc-chat-file-remove" aria-label="移除附件" onClick={agent.removePendingFile}><X size={14} aria-hidden="true"/></button>
        </div>}
        {agent.generationQueued>0&&<p role="status" className="ap-field-note">还有 {agent.generationQueued} 条消息排队，正在按顺序处理。</p>}
        {agent.retryUncertain && <div role="alert" className="ap-field-alert"><p>上一次请求结果未知，服务商可能仍在处理或计费。再次发送可能产生额外费用；刷新或其他页面无法识别本次记录。</p><button type="button" onClick={agent.confirmUncertainRetry}>确认再次发送</button><button type="button" onClick={agent.dismissUncertainRetry}>暂不发送</button></div>}
        {agent.sessionSaveFailed && <p role="status" className="ap-field-note">会话未能保存在本机，当前内容仍在页面中，请先备份。</p>}
        <button type="button" className="ap-foot-info ap-panel-info" aria-expanded={footDetailOpen} aria-label="数据与隐私说明" onClick={() => setFootDetailOpen(current => !current)}><Info size={12} aria-hidden="true"/></button>
        {showMic ? (
          <button
            type="button"
            className={`ap-send ap-panel-send ap-mic${listening ? ' is-listening' : ''}`}
            aria-label={listening ? '停止语音输入' : '语音输入'}
            aria-pressed={listening}
            data-tour="chat-mic"
            disabled={!speechSupported}
            onClick={toggleMic}
          >
            <MicIcon size={18} aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="ap-send ap-panel-send" aria-label="发送" data-tour="chat-send" disabled={!canSend}><ArrowUp size={18}/></button>
        )}
        </div>
        <p className="ap-foot">
          <span id="ap-data-notice" className="ap-foot-detail" hidden={!footDetailOpen}>{understandingLine(Boolean(modelEnabled() && studio?.controller))}</span>
          <span className="ap-foot-detail" hidden={!footDetailOpen}>未发送的草稿只暂存在当前页面，刷新或关闭后会丢失。</span>
          {(process.env.NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED==='1'||process.env.NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED==='1') && <span className="ap-foot-detail" hidden={!footDetailOpen}>近期对话也会发给模型。</span>}
        </p>
      </form>
      </>}
      {floatFooter}
  </aside>;
}

/* ───────────────────────── 画布状态层 ───────────────────────── */

/**
 * Agent 栏关掉后留在画布右上角的浮窗卡片。
 * 支持全窗口任意拖动——mousedown 在卡片 body 上按住即可拖，释放后停在原位。
 * 拖动距离 < 5px 视为点击，触发 onOpen 打开面板。
 */
export function AgentReopenCard({ onOpen }: { onOpen(): void }): JSX.Element {
  const agent = useAgent();
  const { layout } = useRoomEditor();
  const mode = agent.callbacks.workbenchMode;
  const status = bingoHeaderStatus(agent, mode);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // 评审页「完成评审」的本机回执。R2：红环只认当前方案（localPlanKey）的回执，跨方案/sample 不亮。
  const [reviewReturned, setReviewReturned] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  useEffect(() => {
    const sync = () => {
      try {
        setReviewReturned(reviewOrbShouldTurnRed(readReviewReturn(window.localStorage), localPlanKey(layout)));
      } catch {
        setReviewReturned(false);
      }
    };
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [layout]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const card = e.currentTarget as HTMLElement;
    card.setPointerCapture(e.pointerId);
    const rect = card.getBoundingClientRect();
    const parent = card.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset?.x ?? (parentRect ? rect.left - parentRect.left : rect.left),
      baseY: offset?.y ?? (parentRect ? rect.top - parentRect.top : rect.top),
      moved: false,
    };
    setIsDragging(true);
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.hypot(dx, dy) > 4) s.moved = true;
    if (s.moved) setOffset({ x: s.baseX + dx, y: s.baseY + dy });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s) { setIsDragging(false); return; }
    const card = e.currentTarget as HTMLElement;
    try { card.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const moved = s.moved;
    dragState.current = null;
    setIsDragging(false);
    if (!moved) onOpen();
  }, [onOpen]);

  const style: React.CSSProperties = {
    ...(offset ? { left: offset.x, top: offset.y, right: 'auto', bottom: 'auto' } : {}),
    cursor: isDragging ? 'grabbing' : 'pointer',
  };

  const tone = status?.tone ?? 'idle';
  return (
    <button
      type="button"
      className={`sc-agent-reopen is-orb${isDragging ? ' is-dragging' : ''}${reviewOrbClass(reviewReturned)}`}
      data-tone={tone}
      data-review-return={reviewReturned ? '1' : '0'}
      aria-label="打开 Bingo Agent"
      title={reviewReturned ? 'Bingo · 评审已回 · 点开，按住可拖' : status ? `Bingo · ${status.text} · 点开，按住可拖` : 'Bingo · 点开，按住可拖'}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragState.current = null; setIsDragging(false); }}
    >
      <img src={mascotOf(agent, mode)} alt="" width={40} height={40} draggable={false}/>
      {status && <span className={`sc-agent-reopen-dot is-${status.tone}${reviewReturned ? ' is-returned' : ''}`} aria-hidden="true"/>}
    </button>
  );
}

export function AgentCanvasOverlay(): JSX.Element | null {
  const agent = useAgent();
  const { activeFloor, collidingIds, view, exitWalkthrough } = useRoomEditor();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
    if (typeof document.documentElement.requestFullscreen !== 'function') return;
    void document.documentElement.requestFullscreen().catch(() => {});
  }, []);
  // 全屏是走动借来的：走出第一人称时一起还回去，不留一个找不到出口的全屏页面。
  useEffect(() => {
    if (view.walkthroughMode || !fullscreen) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [view.walkthroughMode, fullscreen]);
  const overlapNames = useMemo(() => Array.from(new Set(activeFloor.items.filter(item => collidingIds.has(item.id)).map(item => item.name))), [activeFloor.items, collidingIds]);
  // 漫游预览（只改视图，不写入场景）：退出时 use-walkthrough 会把相机放回进入前的位置。
  if (view.walkthroughMode && !view.view2D) return <div className="ap-canvas-layer"><div className="ap-walk-controls">
    <button id="walk-fullscreen" type="button" className="ap-canvas-pill" aria-pressed={fullscreen} title={fullscreen ? '退出全屏' : '全屏'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={14} aria-hidden="true"/> : <Maximize2 size={14} aria-hidden="true"/>}{fullscreen ? '退出全屏' : '全屏'}</button>
    <button id="walk-exit" type="button" className="ap-canvas-pill" onClick={exitWalkthrough}>
      退出漫游 <span className="ap-walk-esc">· Esc</span>
    </button>
  </div></div>;
  if (agent.callbacks.workbenchMode !== 'layout') return null;
  const s = agent.state;
  return <div className="ap-canvas-layer" aria-live="polite">
    {s === 'dragHover' && <div id="drop-zone"><div className="ap-drop-card"><FileImage size={24} aria-hidden="true"/><strong>松手铺成底图</strong><small>图片 · 20 MB 以内</small></div></div>}
    {agent.baseName && s !== 'dragHover' && <div id="base-chip" className="ap-canvas-chip">底图 · {agent.baseName} · 仅作参照</div>}
    {s === 'generating' && <div id="gen-note" className="ap-canvas-pill is-top"><Loader2 size={16} className="cr-spin" aria-hidden="true"/> 正在准备布置预览</div>}
    {s === 'generateFailed' && <div id="gen-note" className="ap-canvas-pill is-top is-warn">! 这次没出成，场地和设置都还在</div>}
    {s === 'planProposed' && agent.proposal && agent.proposal.overlapNames.length > 0 && <div id="overlap-note" className="ap-canvas-pill is-top is-warn" role="status">⚠ 这版里 {agent.proposal.overlapCount} 件挤了或压墙：{agent.proposal.overlapNames.slice(0, 4).join('、')}{agent.proposal.overlapNames.length > 4 ? ' 等' : ''}</div>}
    {(s === 'planReady' || s === 'planEdited') && overlapNames.length > 0 && <div id="overlap-note" className="ap-canvas-pill is-top is-warn" role="status">⚠ 重叠或超出场地：{overlapNames.slice(0, 4).join('、')}{overlapNames.length > 4 ? ' 等' : ''}</div>}
  </div>;
}
