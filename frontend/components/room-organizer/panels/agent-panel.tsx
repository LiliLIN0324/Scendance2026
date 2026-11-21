'use client';

import { AGENT_DOCUMENT_ACCEPT, extractAgentDocument, isAgentDocument, readAgentDocuments, rememberAgentDocuments, type AgentDocument } from '../lib/agent-documents';
import { AgentDocumentSources } from '../components/agent-document-sources';
import { AgentResearchSources } from '../components/agent-research-sources';
import { readVenueResearch, type VenueResearch } from '../lib/venue-research';
import { proposeAutomaticVenueRange } from '../lib/agent-venue-range';

import { validateCandidateApply } from '../lib/candidate-apply-validation';
import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { agentErrorView } from '@/lib/agent-error-view';
import type {PendingCandidateAccess} from '../lib/pending-candidate-registry';
import { gateAction, supervisionLevelInfo } from '../lib/agent-supervision';
import { getAgentSupervision, useAgentSupervision } from '../lib/agent-supervision-store';
import { layoutActionRisk, lockedLayoutChange } from '../lib/agent-action-risk';
import { addDesign } from '../lib/scene-layers';
import { AgentSupervisionPicker } from './agent-supervision-picker';

/**
 * 右栏对话优先的 Agent 面板（#agent-panel）+ 画布上的状态层。
 * 一句话开场：敲一句，或在对话里挑活动/场地/人数；客户端解析后铺进预填卡。
 * 出方案：已连接云项目时走现有 AI 生成；否则由 lib/agent-proposal 用现有本地物料组
 * （furniture-sets / surprise）在内存里算一份候选，再按步推给画布做预览。
 * 先计算并校验候选，再按监督设置自动应用或等待一次结果确认；写入仍复用 applyLayout 和撤销栈。
 * 自动覆盖前保留原方案；锁定件、活动身份、楼层、需求与版本守卫不受监督档位影响。
 * 第 1 步「读场地」先把确认过的尺度立成可布置壳体（四面外墙 + 主入口 + 层高，见 lib/venue-shell）。
 * 底图只收图片（复用 layout.floorPlanImage）：图纸只当参照，长宽要么说一句「12×9」、要么说「按图纸估」，
 * 未确认前不把米数说成事实（docs/AI-NATIVE-FOR-EXECUTORS.md 对话四步 ①）。
 * 布置方案的入口只有对话。尺寸表单与「让Bingo出方案」那颗大绿钮按 2026-10-26 夜截图钉砍掉了，
 * 卡片退回只读回显，画布上唯一的绿钮是「确认布置」。
 * 物件与场景生成不在这里：物料生成属于物料对话，场景属于空间栏，Bingo 只谈布置与方案。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AgentTaskExamples } from '@/components/agent-task-examples';
import { ArrowUp, Check, ChevronDown, Clock, Download, FileImage, HelpCircle, Loader2, Lock, Map as MapIcon, Maximize2, MessageCirclePlus, Minimize2, RotateCw, Sparkles, Square, TriangleAlert, X } from '@/components/solid-icons';
import { modelEnabled, resolveBriefTurn } from '../../../lib/agent-resolver';
import { conversationProjectId, conversationTurnKey, recordConversationTurn, type ConversationTraceTransport } from '../lib/conversation-recorder';
import { turnHadServerCall } from '@/lib/conversation-turn-activity';
import { incompleteUpdateForOutcome, resolvedTurnOutcome, samePersistedHeadcount, sofaOnlyUnhandled } from '../lib/agent-turn-outcome';
import { chipsAfterLayoutPreview, composeProcessStrip, type ProcessFailure } from '../lib/turn-process';
import { toolTraceRows } from '../lib/tool-trace';
import { isGeneralActivityQuestion, isPureGreeting } from '../lib/general-activity-question';
import { chatUserHistory } from '../lib/chat-user-history';
import { Bubbles, ToolCallTrace, type Bubble } from './agent-bubbles';
import { ProposalCard, type ProposalDecision } from './agent-proposal-card';
import { RouteConfirmCard, VenueConfirmCard, ZoneConfirmCard } from './agent-confirm-cards';
// 决策留痕：确认卡上点「批准 / 放弃」都记一行，运行卡里读得到（对标谷地工坊的「你拒绝了」）。
import { recordAgentDecision } from './agent-decision-log';
import { CandidateInventoryPanel } from './candidate-inventory-panel';
import { checkCandidateInventory, type CandidateInventory } from '../lib/candidate-inventory';
import { focusPlaceSearch } from '../lib/focus-place-search';
import {captureOriginalPreservation,isStandalonePreservationInstruction,preservationIntent,reviewOriginalPreservation} from '../lib/original-preservation';
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
import { useRoomEditor } from '../contexts';
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
import { resolveCommonCapability } from '../lib/agent-common-capabilities';
import { matchVenueCommand } from '../lib/venue-intent';
import { searchPlaces, type PlaceSuggestion } from '../lib/place-search';
import { fetchPlaceShape, peekCachedPlaceShape } from '../lib/place-area';
import { fetchPlaceShapeHints, hintedOutlineNames, buildPlaceSearchOptions } from '../lib/place-search-options';
import { normalizeOutlineName } from '../lib/place-shape-quality';
import { isPersistablePlaceShape } from '../lib/place-shape-quality';
import { trueFootprintBoundary } from '../lib/outdoor-venue-sync';
import { fetchRoadNetwork } from '../lib/road-network';
import { buildRouteProposal, matchRouteCommand, roadFetchPlanForBoundary, type RouteProposal } from '../lib/route-proposal';
import { OutdoorTaskCard, type OutdoorTaskProgress } from '../components/outdoor-task-card';
import { useOutdoorAgentWorkflow, explicitProposalApproval } from '../hooks/use-outdoor-agent-workflow';
import { OutdoorThoughtRecord, OutdoorWorkflowCard } from '../components/outdoor-workflow-card';
import type { OutdoorAgentBridge, OutdoorBrief } from '../lib/outdoor-agent-contract';
import { parseOutdoorEventTurn } from '../lib/outdoor-event-turn';
import { isHeadcountOnlyMessage } from '../lib/outdoor-headcount-adjustment';
import { matchesLocalOutdoorCommand } from '../lib/outdoor-local-commands';
import { outdoorEventIssue, isShorelineEvent, supportedOutdoorEvent, confirmedOutdoorEntrances, outdoorEventSiteSummary, outdoorEventTemplatesSummary } from '../lib/outdoor-event-logic';
import { buildZoneEventProposal, matchZoneCommand, type ZoneEventProposal } from '../lib/zone-event-proposal';
import { buildSubEntranceProposal, matchSubEntranceCommand } from '../lib/sub-entrance';
import type { PlanAnnotation, PlanFacility, PlanLevel, PlanMeasurement, PlanWorker, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { ActivitiesGalleryMount } from './activities-gallery-mount';
import { AmapVenuePicker } from './amap-venue-picker';
import { VenuePicker } from './venue-picker';
import { cloudBriefMessage, cloudSeatingAllocation, cloudSeatingSpecs, initialBriefMemory, memoryExtraction, splitConfirmationLead, type BriefMemory, type LayoutMode } from '../lib/brief-agent';
import { type PlanDiagnostic } from '../lib/diagnostics';
import { checkEntranceBlocks } from '../lib/entrance-block-check';
import { readImageAsDataUrl, readVisionImageAsDataUrl } from '../lib/file-io';
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
  checkDim, CIRCLE_SEATING_NOTE, isClientReviewCommand, isCopyDraftCommand, isEstimateCommand, isExportCommand, isGenericMaterialRequest, isGenerateCommand,
  isMaterialListCommand, isReviewCommand, isStopCommand, isVenueSizeOnly, isZoneCommand, layoutGenerateCommand, lightPlanRail, mentionsUnsupportedSeating, normalizeOralSize, parseBriefSentence, parseMaterialRequest, parseRevisionRequest, parseSafeDirectionalMove, parseSafeRotation, parseSafeRecolor, pendingPlanOf,
  prepareAholoAsk, suggestDimsFromArea, suggestDimsFromImageRatio, workingScale,
  type AgentState, type BriefExtraction, type MaterialRequest, type PendingPlan, type RevisionRequest, type VenueIO,
} from '../lib/workbench-agent';
import { proposalDifferences } from '../three/proposal-preview';
import {describeExistingChanges,type ExistingChangeDescription} from '../lib/proposal-existing-changes';
import { proposalChangeItems, proposalChangeSummary, proposalZoneCount, type ProposalChangeItem, type ProposalChangeSummary } from '../lib/proposal-change-groups';
import { isUnchangedProposal, useStudioAgent, type UnchangedRunResult } from './creative-studio';
import { aholoChatStep } from '../lib/cloud-tool-connection';
import { layoutChatHint, revisionRefusalText } from '../lib/layout-feedback';
import { isLux3dLocalProxy } from '../lib/aholo-assets';
import { stageMaterialGenerate } from '../lib/material-generate';
import { isCompositeDesignBrief, looksLikeDesignInstruction, PLACE_FIRST_BOUNCE, placeStillPending } from '../lib/place-first';
import { clearPendingBrief, readPendingBrief, shouldResumeBrief, writePendingBrief } from '../lib/pending-brief';
import { describeModelFailure } from '../lib/turn-failure-diag';
import { absorbLayeredInstruction, layeredBounceText } from '../lib/outdoor-layered-task';
import { loginBlockedPlaceholder } from '../lib/outdoor-login-copy';
import { ApplyOnce, applyTicketKey } from '../lib/outdoor-apply-once';
import { BingoAuditCard } from './bingo-audit-card';
import { failOpenLocalStep, finishLocalLayoutRun, formatDurationClock, notePriorLayoutTool, pushAgentSteerNote, pushLocalLayoutStep, removeAgentSteerNote, requestAgentStop, resetAgentRun } from './agent-chat-store';
import { subscribeComposerPrefill } from './composer-prefill-bus';
import { AgentRunPanel, useAgentRun } from './agent-run-panel';
import { PlanHome, isPlanHome } from './plan-flow';
import { SiteCaptureCard } from './site-capture-card';
import { StyleBundlePanel } from './style-bundle-panel';
import { CapabilitySuggestionCards } from './capability-suggestion-cards';
import { AGENT_INPUT_SUGGESTIONS, BANQUET_INPUT_SUGGESTIONS, PLACE_INPUT_SUGGESTIONS, SuggestionGhost, useSuggestion } from './typed-suggestion';
import { OutdoorStageSuggestion } from './outdoor-stage-suggestion';
import { buildStyleBundleItems, matchStyleBundleCommand, saveStyleRun, STYLE_RUNS_KEY, type StyleBundle } from '../lib/style-bundles';
import { EDITOR_ITEM_LIMIT } from '../lib/item-limits';
import {
  readSessionBubbles,
  writeSessionBubbles,
  type StoredAssistantBubble,
} from '../lib/assistant-session-bodies';
import { ASSISTANT_SESSION_DEFAULT_TITLE, assistantSessionTitleFromText } from '../lib/assistant-sessions';
import {
  assistantSessionExists,
  subscribeActiveAssistantSession, getActiveAssistantSessionId,
  getAssistantSessionBodies,
  replaceAssistantSessionBodies,
  useAssistantSessions, scopedAssistantStorage,
} from '../hooks/use-assistant-sessions';
import { SessionHistoryOverlay, markSessionSeen, sessionUnreadSince, type SessionStatus } from './session-history-panel';
import { RailAvatar, type RailForm } from './rail-avatar';
import type { RoomLayout } from '../lib/types';
import type { ScaleOrigin } from '../lib/venue-shell';
import type { WorkbenchMode } from '../lib/workbench-mode';
import './agent-panel.css';

const MASCOT_DIR = '/assets/assistant/qingguang-3d';

const STEP_DELAY_MS = 420;
/** 云提案有自己的失效条件（基线/需求/编辑权/租约）。确认按钮按住时说的那句，卡片和按钮共用一条。 */
const CLOUD_STALE = '场地或编辑权变了，这版先别确认。';
/** 本地验收开关：`?agentFail=1` 让出方案这一步故意失败一次，好核对「发现问题」那一态。 */
const forceFail = () => process.env.NODE_ENV !== 'production' && typeof window !== 'undefined'
  && new URL(window.location.href).searchParams.get('agentFail') === '1';

type FileIssue = { kind: 'nonImage' | 'unsupported' | 'tooLarge' | 'readFailed'; name: string; size: number };
/** 气泡类型与渲染层一起抽到 ./agent-bubbles；这里只保留对外导出，避免外部引用断裂。 */
export type { Bubble };

/** 落盘时丢掉 action（函数不可序列化）；翻回话只回放文字与附图。 */
function toStoredBubbles(bubbles: readonly Bubble[]): StoredAssistantBubble[] {
  // zoneApply 是闭包，落盘时丢掉；翻回话文字还在，按钮不重现。
  return bubbles.map(({ id, role, text, meta, warn, amber, long, image, modelConversation, outdoorQuestion, materialQueries, alert }) => {
    return {
      id, role, text,
      ...(meta !== undefined ? { meta } : {}),
      ...(warn !== undefined ? { warn } : {}),
      ...(amber ? { amber: true } : {}),
      ...(long ? { long: true } : {}),
      ...(image !== undefined ? { image } : {}),
      ...(role === 'agent' && modelConversation === true ? { modelConversation: true } : {}),
      ...(role === 'agent' && outdoorQuestion ? { outdoorQuestion: true as const } : {}),
      ...(role === 'agent' && materialQueries?.length ? { materialQueries } : {}),
      ...(role === 'agent' && alert?.stamp ? { alertStamp: alert.stamp, ...(alert.tone ? { alertTone: alert.tone } : {}) } : {}),
    } satisfies StoredAssistantBubble;
  });
}

function fromStoredBubbles(rows: readonly StoredAssistantBubble[]): Bubble[] {
  return rows.map(row => {
    const { alertStamp, alertTone, ...rest } = row;
    return {
      ...rest,
      ...(alertStamp ? { alert: { stamp: alertStamp, ...(alertTone ? { tone: alertTone } : {}) } } : {}),
    };
  });
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
export interface ProposalView extends PendingPlan {
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
  const allocationNote=allocation?.status==='one_per_desk'?'每人一桌。'
    :allocation?.status==='shared_desk'?`每桌 ${allocation.peoplePerDesk} 人。`
    :'每桌人数未定。';
  if (memory.allGuestsSeated !== true) {
    if (!deskSelected) return { blocked: null, warning: null };
    if (memory.allGuestsSeated === false) return { blocked: null, warning: `已说明不要求人人入座。${allocationNote}` };
    if (!Number.isSafeInteger(memory.headcount) || !memory.headcount || memory.headcount < 1) return { blocked: null, warning: `人数尚未确认。${allocationNote}` };
    const seats=countSingleSeats(layout,floorIndex),target=memory.headcountMode === 'must' ? `${memory.headcount} 人` : `约 ${memory.headcount} 人`;
    if (seats === null) return { blocked: null, warning: `按 ${target} 课桌椅先排不了，场地信息不全。${allocationNote}` };
    const remaining=seats < memory.headcount ? `是否满足 ${target} 的座席需求还没核对。` : '单人椅数量已达到规划人数。';
    return { blocked: null, warning: `按 ${target} 规划课桌椅，当前仅识别到 ${seats} 把单人椅。${remaining}其他家具和课桌没有算在内。${allocationNote}` };
  }
  if (!Number.isSafeInteger(memory.headcount) || !memory.headcount || memory.headcount < 1)
    return { blocked: '已要求所有人入座，请先确认人数。', warning: null };
  const check = checkRequiredSeats(layout, floorIndex, memory.headcount, true);
  return { blocked: check.status === 'unknown' ? check.message : null,
    warning: check.status === 'quantity_met' ? `${check.message ?? ''}${memory.headcountMode !== 'must' ? '人数可能变化，活动前再核一次。' : ''}${deskSelected?allocationNote:''}` : null };
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
  if (recovery.outcome === 'committed') return `云端已提交第 ${recovery.revision} 版，本机没确认应用成功，先留着草稿。`;
  if (recovery.outcome === 'cleanup_failed') return '本机记录没清掉，先对一下版本。';
  return '云端结果不明，没有重复提交。';
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
  ].filter(Boolean).join('。');
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
  /** 2026-11-15 用户拍板：桥接态撤回预览在对话流留决策徽章（谷地工坊「已批准/已放弃」同款）。 */
  sayDecisionBadge(decision: 'approved' | 'rejected' | 'cancelled', text: string): void;
  inspectOutdoorFacility(id: string): void;
  /** M5：确认后写入人员布点（bridge applyWorkers，commitPlan 可撤销）；未接上或空提案回 false。 */
  applyOutdoorWorkers(workers: PlanWorker[]): boolean;
  /** M5：确认后写入测量；未接上或空提案回 false。 */
  applyOutdoorMeasurements(measurements: PlanMeasurement[]): boolean;
  /** M5：确认后写入标注；未接上或空提案回 false。 */
  applyOutdoorAnnotations(annotations: PlanAnnotation[]): boolean;
  /** M5：读当前楼层列表；未接上回空数组。 */
  getOutdoorLevels(): PlanLevel[];
  /** M5：切到指定楼层；不存在或未接上回 false。 */
  setOutdoorLevel(levelId: string): boolean;
  /** M5：单条设施新增；id 已存在或未接上回 false。 */
  addOutdoorFacility(facility: PlanFacility): boolean;
  /** M5：单条设施删除；不存在或未接上回 false。 */
  removeOutdoorFacility(id: string): boolean;
  /** M5：单条设施属性改；不存在或未接上回 false。 */
  updateOutdoorFacility(id: string, patch: Partial<Pick<PlanFacility, 'name'|'notes'|'rotationDeg'|'color'|'opacity'|'strokeStyle'|'modelOverride'|'vendorName'|'vendorZone'|'inDate'|'inTime'|'outDate'|'outTime'|'electricKw'>> & { size?: { width: number; depth: number } }): boolean;
  manualOutdoorVenueApplied(anchor: NonNullable<SitePlanData['anchor']>): void;
  manualOutdoorVenueCanceled(): void;
  sessionScope: string;
  isSessionCurrent(): boolean;
  historyReviewRequired: boolean;
  reviewDialogueHistory(): void;
  acceptFreshSession(id:string):void;
  /** 2026-11-14 用户指令：原位编辑最近一条用户消息并按新话重新走理解管线。 */
  resendEditedLast(text:string):void;
  retainedOtherSessionProposal:boolean;
  withdrawRetainedOtherSessionProposal():void;
  unresolvedDialogue: readonly string[];
  /** 2026-11-14 用户指令：历史列表按会话标红点——任一条对话未完结（含本页内其他会话的）即算错误。 */
  hasUnresolvedDialogue(id: string): boolean;
  withdrawUnresolvedDialogue(text:string): void;
  withdrawAllUnresolved(): void;
  briefBusy: boolean;
  toolPending: boolean;
  processFailed: ProcessFailure | null;
  assertSessionWrite: () => void;
  sessionSaveFailed: boolean;
  understanding: boolean; isUnderstanding(text?:string): boolean; cancelUnderstanding(): void;
  /** 流式问答正在生成的可见草稿；只在生成过程中非空。 */
  streamPreview: string | null;
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
  modelFailure: {text:string;retry:()=>void;diag:string;hint:string} | null; dismissModelFailure(): void;
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
  /** 2026-11-19 用户指令：候选点选只做地图预览（钉点+飞过去，不写方案），确认才走锚定链。 */
  previewVenueCandidate(place: PlaceSuggestion): void;
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
  outdoorWorkflow: ReturnType<typeof useOutdoorAgentWorkflow>;
  outdoorBridgeReady:boolean;
  searchOutdoorVenue(query:string):void;
  registerRouteBridge(bridge: OutdoorAgentBridge | null):void;
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
  acceptFile(file: File): void; retryFile(): void; pickFile(accept?: string): void;
  /** 选进来、还没发出去的图纸/照片：挂在输入框上，点发送才读进场地。 */
  /** 2026-11-19 试点：支持最多 10 张现场截图（压缩后随理解请求发给 deepseek-flash 多模态）。 */
  pendingFiles: Array<{ name: string; url: string }>;
  documents: AgentDocument[];
  venueResearch: VenueResearch | null;
  removePendingImage(index: number): void;
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
/** 测试种子：往输入框草稿里放一段未发送文本；正常路径只有 composer 自己会写这张表。 */
export function seedVolatileComposerDraftForTests(scope:string,sessionId:string|null,text:string):void{volatileComposerDrafts.set(JSON.stringify([scope,sessionId]),text);}
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
  // 本机命令轮的留痕锚点：进入模型链路前清空，避免把模型回复重复记一遍。
  const localTurnRef = useRef<{turnKey:string;sessionId:string;turnIndex:number;userText:string;startedAt:number}|null>(null);
  const assistantSessions = useAssistantSessions(requireSessionWrite, sessionScope);
  const confirmVenueSourceRef = useRef(confirmVenueSource); confirmVenueSourceRef.current = confirmVenueSource;
  const sourceAuthorityRequired = useRef(!!confirmVenueSource); if (confirmVenueSource) sourceAuthorityRequired.current = true;
  const sessionScopeIsCurrent = () => {
    try { if (sessionCurrentRef.current && !sessionCurrentRef.current()) return false; } catch { return false; }
    if (sessionScope === 'legacy') return true;
    // M3a：会话身份由壳体 isSessionCurrent（projectId 源）把关，不再回读室内 layout.id。
    return true;
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
  type OutdoorTaskKind = 'venue' | 'route' | 'zone' | 'model' | 'simulation' | 'workflow';
  const outdoorEpochRef = useRef(0);
  const outdoorKindRef = useRef<OutdoorTaskKind | null>(null);
  const routeTicketRef = useRef<{ epoch: number; proposal: RouteProposal } | null>(null);
  const zoneTicketRef = useRef<{ epoch: number; proposal: ZoneEventProposal } | null>(null);
  // 同一版预览只允许落一次：双击「应用」或浏览器重放同一击时，第二次直接 return。
  const zoneApplyOnceRef = useRef(new ApplyOnce());
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
    setOutdoorTask(current => current ? { ...current, state: 'stopped', action: '已停止，已应用的规划没变。' } : null);
  }
  useEffect(() => () => { outdoorEpochRef.current += 1; outdoorRequestRef.current?.abort(); venuePickSeq.current += 1; }, []);
  useEffect(() => { stopOutdoorTask(); setOutdoorTask(null); }, [sessionScope]);
  const [routeProposal, setRouteProposal] = useState<RouteProposal | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const routeBridgeRef = useRef<OutdoorAgentBridge | null>(null);
  const [outdoorBridgeReady,setOutdoorBridgeReady]=useState(false);
  // V-3：区域提案（预览态）——虚线分区+物料幽灵，确认才写入（可撤销）。
  const [zoneProposal, setZoneProposal] = useState<ZoneEventProposal | null>(null);
  const [zoneBusy, setZoneBusy] = useState(false);
  // V-4b：流动模拟开关（动画在 canvas 内 ticker，这里只管开/关与回话）。
  const [flowSimActive, setFlowSimActive] = useState(false);
  const [progress, setProgress] = useState(0);
  // T-UI §4-5：导出预览卡只活在这里；确认前不触发任何下载。
  const [exportPreview, setExportPreview] = useState(false);
  const outdoorExportRef=useRef<{base:string;scope:string;session:string|null;projectId:string;epoch:number;brief:OutdoorBrief;requirements:string[]}|null>(null);
  useEffect(()=>{outdoorExportRef.current=null;setExportPreview(false);},[sessionScope]);

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
  const automaticConfirmation = useRef(false);
  const automaticConfirm = useRef<() => void>(() => {});
  automaticConfirm.current = () => {
    automaticConfirmation.current = true;
    try { confirmProposal(); } finally { automaticConfirmation.current = false; }
  };
  const proposalFloor = useRef<FloorSessionToken|null>(null);
  const floorSession=useFloorSessionTracker(layoutStore);
  function captureFloor(index:number):FloorSessionToken|null {const token=floorSession.capture();return token?.floorIndex===index&&floorSession.isCurrent(token)?token:null;}
  function floorStillCurrent(value:FloorSessionToken|null):boolean {return floorSession.isCurrent(value);}
  function checkProposalFloor():boolean {if(floorStillCurrent(proposalFloor.current))return true;say({role:'agent',amber:true,text:'楼层换了，这版只能回原楼层用。'});return false;}
  const styleProposal = useRef<{ key: string; memoryRevision: number; draftRevision: number; floorIndex: number; sessionId: string | null } | null>(null);
  const shownSteps = useRef(0);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  // 2026-11-19：首条用户消息落盘后自动命名；默认「新会话」只在真正空白时存在。
  useEffect(() => {
    const id = assistantSessions.activeId;
    if (!id || assistantSessions.activeSession?.title !== ASSISTANT_SESSION_DEFAULT_TITLE) return;
    const firstUser = bubbles.find(item => item.role === 'user' && typeof item.text === 'string' && item.text.trim());
    if (!firstUser) return;
    assistantSessions.renameSession(id, assistantSessionTitleFromText(firstUser.text));
  }, [assistantSessions.activeId, assistantSessions.activeSession?.title, assistantSessions.renameSession, bubbles]);
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
  // 流式问答的可见草稿：边生成边上屏，完成后清掉，正式气泡接上。
  const [streamPreview,setStreamPreview]=useState<string|null>(null);
  const [toolPending,setToolPending]=useState(false);
  const [processFailed,setProcessFailed]=useState<ProcessFailure|null>(null);
  const layoutAttempt=useRef(false);
  const cloudAttempt=useRef(false);
  const previewUtterance=useRef<string|null>(null);
  const [cancelledInput,setCancelledInput]=useState<{id:number;text:string}|null>(null);
  const [retryUncertain,setRetryUncertain]=useState<string|null>(null);
  // 模型瞬态失败的可重试提示卡：文案 + 重试回调。
  const [modelFailure,setModelFailure]=useState<{text:string;retry:()=>void;diag:string;hint:string}|null>(null);
  const dialogueTurnStartRef=useRef(onDialogueTurnStart);dialogueTurnStartRef.current=onDialogueTurnStart;
  const dialogueIncompleteRef=useRef(onDialogueIncompleteChange);dialogueIncompleteRef.current=onDialogueIncompleteChange;
  const incompleteDialogueTurns=useRef(new Map<string,Set<string>>());
  const [unresolvedDialogue,setUnresolvedDialogue]=useState<readonly string[]>([]);
  const [,setReviewedHistorySession]=useState<string|null>(null);
  const reviewedHistorySessionRef=useRef<string|null>(null);
  const setReviewedHistory=(id:string|null)=>{reviewedHistorySessionRef.current=id;setReviewedHistorySession(id);};
  const freshSessionProof=useRef<string|null>(null);
  // 2026-11-14 用户指令：原位编辑最近一条用户消息——文本已在原位替换，send 的回显按此标记抑制一次。
  const resendEchoSkipRef=useRef<string|null>(null);
  const isHistoryReviewRequired=()=>!!onDialogueHistoryReview && (!boundSessionId.current||getActiveAssistantSessionId(sessionScope)!==boundSessionId.current||reviewedHistorySessionRef.current!==boundSessionId.current);
  const historyReviewRequired=isHistoryReviewRequired();
  function acceptFreshSession(id:string):void {
    if(sessionScopeIsCurrent()&&getActiveAssistantSessionId(sessionScope)===id&&!sessionMemories.current.has(id))freshSessionProof.current=id;
  }
  function reviewDialogueHistory():void {
    const id=boundSessionId.current;
    if(!id||!sessionScopeIsCurrent()||getActiveAssistantSessionId(sessionScope)!==id||(incompleteDialogueTurns.current.get(id)?.size??0)>0)return;
    if(studioRef.current?.recoverable||studioRef.current?.applyRecovery||studioRef.current?.reviewingApplyRecovery){say({role:'agent',amber:true,text:'先查清原任务，再重新开始。'});return;}
    if(briefRequest.current||generationWait.current||generationQueuedRef.current||studioRef.current?.busy){say({role:'agent',amber:true,text:'原任务还在跑，先等它结束。'});return;}
    if(studioRef.current&&!studioRef.current.discardPreviewForHistoryReview()){say({role:'agent',amber:true,text:'原任务还没核对清楚，旧记录留着。'});return;}
    runToken.current++;briefTurnSequence.current++;pendingCandidates?.invalidate();dropProposal();
    if(!onDialogueHistoryReview?.(id)){say({role:'agent',amber:true,text:'活动正在切换，稍后再核对。'});return;}
    setReviewedHistory(id);phaseRef.current='idle';setPhase('idle');setProgress(0);
    // 2026-11-14 用户指令：核对成功不再出声（自动核对后这句话每次切会话都会弹，是噪音）。
  }
  /** 2026-11-14 用户指令：最近一条用户消息原位编辑——替换气泡文本后按新话重走理解管线；
      send 的原话回显由 resendEchoSkipRef 抑制，不产生第二条重复气泡。 */
  function resendEditedLast(text: string): void {
    const id = boundSessionId.current;
    const trimmed = text.trim();
    if (!id || !trimmed || !sessionScopeIsCurrent()) return;
    if (briefRequest.current || generationWait.current || generationQueuedRef.current || studioRef.current?.busy || outdoorWorkflow.busy) { say({ role: 'agent', amber: true, text: '任务还在跑，等它结束再改。' }); return; }
    const last = [...bubblesRef.current].reverse().find(b => b.role === 'user');
    if (!last) return;
    if (last.text.trim() === trimmed) return;
    resendEchoSkipRef.current = trimmed;
    const next = bubblesRef.current.map(b => (b.id === last.id ? { ...b, text: trimmed } : b));
    bubblesRef.current = next;
    setBubbles(next);
    persistBubbles(id, next);
    void send(trimmed).finally(() => { if (resendEchoSkipRef.current === trimmed) resendEchoSkipRef.current = null; });
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
    say({role:'agent',text:'撤回了这条要求，其他要求还在。'});
  };
  const withdrawAllUnresolved=()=>{
    const id=boundSessionId.current;
    if(!id||!sessionScopeIsCurrent()||getActiveAssistantSessionId(sessionScope)!==id)return;
    const items=[...(incompleteDialogueTurns.current.get(id)??[])];
    for(const text of items)updateDialogueIncomplete(id,text,false);
    if(items.length)say({role:'agent',text:'撤回了这些要求，其他要求还在。'});
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
    say({role:'agent',amber:true,text:'已停止等待，这条没写入。可能还在计费。'});
  }
  useEffect(() => () => { briefTurnSequence.current++; runToken.current++; generationWait.current?.cancel();briefRequest.current?.controller.abort();researchRequest.current?.abort(); resetAgentRun(); }, []);
  const briefFallbackNotified = useRef(false);
  const touchActiveSessionRef = useRef(assistantSessions.touchActiveSession);
  touchActiveSessionRef.current = assistantSessions.touchActiveSession;
  const lastFile = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  /** 选进来、还没发出去的图纸/照片：先摆在输入框里，等一句需求再一起发。 */
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; url: string }>>([]);
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
    // 2026-11-14 原位编辑重发：这句话已在原位替换，回显按标记抑制一次，避免两条重复气泡。
    if (bubble.role === 'user' && resendEchoSkipRef.current && bubble.text.trim() === resendEchoSkipRef.current) {
      resendEchoSkipRef.current = null;
      return;
    }
    // S4 A 档：副作用从 setBubbles updater 体内剥出到 say 函数体，避免渲染期双跑落盘/emit。
    const text = foldConflictBubble(bubble.text);
    // 只有这一轮确实没打后端时才补记：后端调用过的轮次由服务端自己落库，避免重复。
    const localTurn = localTurnRef.current;
    if (localTurn && bubble.role === 'agent' && text.trim() && !turnHadServerCall(localTurn.startedAt)) {
      recordConversationTurn(studioRef.current?.controller as unknown as ConversationTraceTransport | undefined, {
        turnKey: localTurn.turnKey, sessionId: localTurn.sessionId, turnIndex: localTurn.turnIndex,
        surface: 'local_command', userText: localTurn.userText, assistantText: text,
        outcome: 'local_only', latencyMs: Date.now() - localTurn.startedAt,
      });
    }
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

  function searchOutdoorVenue(query:string){outdoorWorkflow.cancel();const epoch=beginOutdoorTask('venue');setVenuePick({epoch,query,candidates:[],loading:true,picking:null});setOutdoorTask({intent:`搜索“${query}”`,state:'working',action:'检索真实场地候选。未修改活动范围',steps:[]});}
  const outdoorWorkflow=useOutdoorAgentWorkflow({scope:sessionScope,bridge:()=>routeBridgeRef.current,controller:()=>studioRef.current?.controller??null,provider:()=>studioRef.current?.activeProvider,model:()=>studioRef.current?.activeModel??null,begin:()=>beginOutdoorTask('workflow'),current:epoch=>currentOutdoorTask(epoch,'workflow'),status:setOutdoorTask,say:(text,clarification)=>say({role:'agent',text,...(clarification?{modelConversation:true,outdoorQuestion:true as const}:{})}),search:searchOutdoorVenue,simulate:active=>{if(active){if(!routeBridgeRef.current?.getPlan()?.routes.length)return false;startFlowSim();}else stopFlowSim();return true;}});

  useEffect(()=>subscribeActiveAssistantSession(sessionScope,(nextId)=>{
    if(onDialogueHistoryReview&&nextId!==boundSessionId.current){setReviewedHistory(null);freshSessionProof.current=null;}
    pendingCandidates?.invalidate();
    briefTurnSequence.current++;runToken.current++;
    researchRequest.current?.abort();
    if (nextId !== boundSessionId.current) { outdoorWorkflow.cancel();stopOutdoorTask(); setOutdoorTask(null); }
    if(nextId!==boundSessionId.current&&proposal.current){hidePreview();phaseRef.current='idle';setPhase('idle');setProgress(0);}
    if(generationWait.current||localDraftOwner.current){suppressCancelledCloudPreview.current=true;generationWait.current?.cancel();dropProposal();phaseRef.current='idle';setPhase('idle');setProgress(0);}
  }),[sessionScope,pendingCandidates]);
  useEffect(()=>{
    const controller=studioRef.current?.controller;
    if(!controller?.getSnapshot||!controller.subscribe)return;
    let actor=controller.getSnapshot().user?.id??null;
    return controller.subscribe(()=>{
      const next=controller.getSnapshot().user?.id??null;if(next===actor)return;actor=next;outdoorWorkflow.authChanged(next);stopOutdoorTask();
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
    if (id && !saved) say({ role: 'agent', amber: true, text: '本机存不下，输入还留在页面上。' });
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
    if(briefRequest.current){updateDialogueIncomplete(prevId,briefRequest.current.text,true);uncertainInputs.current.add(briefRequest.current.text);briefRequest.current.controller.abort();say({role:'agent',amber:true,text:'已停止等待，服务商可能还在计费。'});}
    setCancelledInput(null);setRetryUncertain(null);
    briefFallbackNotified.current = false;
    if (prevId && assistantSessionExists(prevId, sessionScope)) persistBubbles(prevId, bubblesRef.current);
    if (prevId && assistantSessionExists(prevId, sessionScope)) sessionMemories.current.set(prevId, {...memoryRef.current,pendingGeneration:undefined});
    boundSessionId.current = nextId;
    setUnresolvedDialogue(nextId?[...(incompleteDialogueTurns.current.get(nextId)??[])]:[]);
    const nextMemory = (nextId && (sessionMemories.current.get(nextId) ?? readBriefMemory(nextId, scopedAssistantStorage(sessionScope)))) || initialBriefMemory();
    memoryRef.current = nextMemory;
    onBriefMemoryChange?.(nextMemory,nextId);
    // 2026-11-14 用户指令：点开会话即自动核对，「待核对」卡不再出现。
    // 原本只有新会话走这条路；现在所有会话绑定都自动核对。安全性不变：
    // discardPreviewForHistoryReview 只在旧运行结果「已知且已完成」时才放弃，
    // 未知/进行中的任务会拒绝——那种罕见场合仍回退到手动「按当前记录重新开始」卡。
    if(nextId){
      if((!studioRef.current||studioRef.current.discardPreviewForHistoryReview())&&onDialogueHistoryReview?.(nextId))setReviewedHistory(nextId);
    }
    freshSessionProof.current=null;
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
      say({ role: 'agent', long: true, text: '说一句「出方案」我先摆一版，或「加两把椅子」直接加。' });
      return;
    }
    const area = confirmedArea();
    const text = [
      `物料清单 · ${area === null ? '' : `${formatArea(area)} ㎡ · `}${pendingPlan ? '预览版 · ' : ''}${total} 件`,
      ...rows.map(row => `· ${row.name} ×${row.count}`),
      ...(locked ? [`锁定的 ${locked} 件也在上面。`] : []),
      ...(pendingPlan ? ['这版还在预览，清单按预览版算。点「确认布置」才写进画布。'] : []),
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
      `（草稿只在对话里${pendingPlan ? '，按预览版物料写' : ''}。没写进活动资料。要改哪句直接说。）`,
    ].join('\n');
    say({ role: 'agent', long: true, text, action: { label: '复制草稿', run: () => copyText(text, '草稿复制好了。') } });
  }

  /** 「换区」：画布没有分区这一层，也没有可点的换区入口；先说清楚，再给现在做得到的下一步。 */
  function replyZone(): void {
    say({ role: 'agent', long: true, text: '整块场地，换布局说「换一版」。' });
  }

  /**
   * 「看看哪里有问题」：只读画布几何，报挤/压墙柱/出界/挡门前留空/拉不开。
   * 这不是合规审查——没有消防、疏散、无障碍这些依据，也不下那种结论。
   */
  function reviewNow(): void {
    if (phaseRef.current === 'generating') { say({ role: 'agent', review: true, amber: true, text: '还在出这一版，等它出来再体检。' }); return; }
    if (proposal.current || studioRef.current?.preview) { say({ role: 'agent', review: true, amber: true, text: '先确认或撤回这一版，再体检。' }); return; }
    const report = reviewLayout(live.current, floorIndexRef.current);
    if (report.checked === 0) {
      say({ role: 'agent', review: true, long: true, text: '这层还没有物料。' });
      return;
    }
    const notes = report.notes.length ? `\n${report.notes.join('\n')}` : '';
    if (report.clean) {
      say({ role: 'agent', review: true, long: true, text: `检查了 ${report.checked} 件：挤、压墙、出界、挡门前留空这几项没发现问题。只看了已建模的物件，没建模的先加进来再查。${notes}` });
      return;
    }
    say({ role: 'agent', review: true, long: true, text: `我按画布几何看了一遍 ${report.checked} 件，找到 ${report.issues.length} 条：\n只查挤、压墙/柱、出界、挡门前留空和座椅拉不开这几项。${notes}` });
    const actionable = report.issues.filter(issue => !!issue.fix);
    for (const issue of actionable.slice(0, 3)) {
      say({ role: 'agent', review: true, text: `${issue.title}。${issue.detail}`, action: { label: `按这条改：${issue.fix!.label}`, run: () => applyReviewFix(issue) } });
    }
    const rest = actionable.length - Math.min(3, actionable.length);
    if (rest > 0) say({ role: 'agent', review: true, amber: true, text: `还有 ${rest} 条没展开。先改上面几条，再问我一次。` });
  }

  /** S2-2：审校台「发送钉评链接」。生成 /review/#layout= 链接并由气泡回链，甲方钉评与回执沿既有 share-pins/review-return 回到审校台。 */
  const reviewLinkPending=useRef(false);
  async function issueReviewLink(): Promise<void> {
    if(reviewLinkPending.current)return;
    if (proposal.current || studioRef.current?.preview) { say({ role: 'agent', amber: true, text: '先确认或撤回这一版，再生成链接。' }); return; }
    const floor=floorSession.capture(),start=layoutStore.getState();
    if(!sessionScopeIsCurrent()||!floorSession.isCurrent(floor)){say({role:'agent',review:true,amber:true,text:'活动和楼层在切换，稍后再生成链接。'});return;}
    let baseline:RoomLayout;try{baseline=structuredClone(start.layout);}catch{say({role:'agent',review:true,amber:true,text:'当前方案无法完整核对，未准备链接。'});return;}
    const stillCurrent=()=>{try{const now=layoutStore.getState();return sessionScopeIsCurrent()&&floorSession.isCurrent(floor)&&now.revision===start.revision&&sameRecoveryFormValue(now.layout,baseline);}catch{return false;}};
    reviewLinkPending.current=true;
    try {
      const result=await callbacks.onIssueReviewLink?.()??null;
      if(!sessionScopeIsCurrent())return;
      if(!result){say({role:'agent',review:true,amber:true,text:'链接没生成，也没复制。'});return;}
      if(typeof result==='string'||typeof result.url!=='string'||!result.url.trim()||!stillCurrent()||typeof result.isCurrent!=='function'||!result.isCurrent()){
        say({role:'agent',review:true,amber:true,text:'活动和方案变了，链接没复制。'});return;
      }
      say({ role: 'agent', review: true, text: '已打开分享面板，在「送评审方」生成链接。钉评会自动回到 Bingo。' });
    } catch { if(sessionScopeIsCurrent())say({role:'agent',review:true,amber:true,text:'结果查不到，链接没复制。'}); }
    finally{reviewLinkPending.current=false;}
  }

  /**
   * 点一条改法：按现在这一帧重新体检，仍然成立才算候选；只铺预览，不写画布。
   * 算不出来、或者锁着没动，都如实说，不硬挪。
   */
  function applyReviewFix(issue: ReviewIssue): void {
    if (phaseRef.current === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版，等它出来再改。' }); return; }
    if (proposal.current || studioRef.current?.preview) { say({ role: 'agent', amber: true, text: '先确认或撤回这一版，再试下一条。' }); return; }
    const base = live.current;
    const index = floorIndexRef.current;
    const floor=captureFloor(index);if(!floor){say({role:'agent',amber:true,text:'当前楼层已变化，请重新核对。'});return;}
    const freshReport = reviewLayout(base, index);
    const fresh = freshReport.issues.find(candidate => candidate.id === issue.id)
      ?? freshReport.issues.find(candidate => candidate.kind === issue.kind && candidate.itemIds.some(id => issue.itemIds.includes(id)));
    if (!fresh || !fresh.fix) { say({ role: 'agent', amber: true, text: '画布刚变过，这条不成立了。' }); return; }
    const result = proposeReviewFix(base, index, fresh);
    if (!result) { say({ role: 'agent', amber: true, text: '这条不好挪，先自己拖一下。' }); return; }
    if (result.moved === 0) {
      const why = skipCopy(result.skipped);
      const locked = result.skipped.some(skip => skip.reason === 'locked');
      say({ role: 'agent', amber: true, long: true, text: `这条没改成：${why || '附近找不到不压墙、不碰别的物料的落点'}。${locked ? '先解锁再试，或自己拖。' : '自己拖，或腾点空间再试。'}` });
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
    if(routeBridgeRef.current?.applyPlan){setStylePickerOpen(false);outdoorExportRef.current=null;setExportPreview(false);void outdoorWorkflow.previewStyle(bundle);return;}

    if (phase === 'generating') {
      say({ role: 'agent', amber: true, text: '还在出这一版，等它出来再配。' });
      return;
    }
    if (proposal.current || studioRef.current?.preview) {
      say({ role: 'agent', amber: true, text: '先确认或撤回这一版，再配一套。' });
      return;
    }
    const base = live.current;
    const floorIndex = floorIndexRef.current;
    const floorToken=captureFloor(floorIndex);if(!floorToken){say({role:'agent',amber:true,text:'当前楼层已变化，请重新核对。'});return;}
    const floor = base.floors[floorIndex];
    if (!floor) { say({ role: 'agent', amber: true, text: '当前楼层不可用，本次没有修改画布。' }); return; }
    const built = buildStyleBundleItems(bundle, { width: base.width, depth: base.height });
    if (!built.ok) { say({ role: 'agent', amber: true, text: built.message }); return; }
    if (materialCount(floor.items) + built.items.length > EDITOR_ITEM_LIMIT) {
      say({ role: 'agent', amber: true, text: '超过物料数量上限，画布没改。' }); return;
    }
    const candidate: RoomLayout = { ...base, floors: base.floors.map((item, index) => index === floorIndex ? { ...item, items: [...item.items, ...built.items] } : item) };
    if (!canApplyLayoutGeometry(base, candidate)) { say({ role: 'agent', amber: true, text: '和场地或现有物料冲突，画布没改。' }); return; }
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
    trackGeneration(presentProposal(++runToken.current, `「${bundle.name}」的候选：新增 ${built.items.length} 件，原有物件保留。`));
  }

  /**
   * 「加两把椅子」：只把点名的那几件放进空位，仍然只出候选、不写画布。
   * 已经有一版本地预览时，就接在这一版上继续加，不再让人先确认一遍。
   */
  function addMaterials(request: MaterialRequest): void {
    if (phaseRef.current === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版，等它出来再加。' }); return; }
    if (proposal.current === null && studioRef.current?.preview) {
      say({ role: 'agent', amber: true, text: '先确认或撤回这一版，再加物料。' });
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
      say({ role: 'agent', amber: true, text: `画布上没有能放下${request.name}的空位（${request.count} 件都没放下）。先收几件，或换一版留空地。` });
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
    if (phaseRef.current === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版，等它出来再改。' }); return; }
    if (proposal.current === null && studioRef.current?.preview) {
      say({ role: 'agent', amber: true, text: '先确认或撤回这一版，再改。' });
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
      if (!matches) { say({role:'agent',amber:true,text:'这个距离画布做不到，画布没改。'}); return; }
    }
    if (request.ops.length === 1 && request.ops[0]?.kind === 'rotate' && plan.applied) {
      const finalFloor=plan.layouts.at(-1)?.floors[activeFloorIndex], beforeFloor=base.floors[activeFloorIndex];
      const radians=request.ops[0].deltaDeg*Math.PI/180;
      const matches=beforeFloor?.items.some(before=>{const after=finalFloor?.items.find(item=>item.id===before.id);
        return after && Math.abs((after.rotation??0)-(before.rotation??0)-radians)<1e-9;});
      if(!matches){say({role:'agent',amber:true,text:'这个角度画布做不到，画布没改。'});return;}
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
    const miss = plan.conflicts.length ? `。${plan.conflicts.length} 处没落：${plan.conflicts.map(conflict => conflict.message).join('、')}` : '';
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
    return layout.backendSceneV2 !== undefined || layout.backendVenue !== undefined || (floor?.interiorWalls?.length ?? 0) > 0;
  }

  function scaleFrom(extraction: BriefExtraction): Scale & { fromVenue: boolean } {
    return workingScale(extraction, { width: live.current.width, height: live.current.height, venueUp: venueIsUp() }, scaleOrigin);
  }

  /** 「按图纸估」：底图只当参照，折出来的长宽是估的，说完就按它出预览，说错了再讲一句新的。 */
  function estimateFromPlan(): Scale | null {
    const pixels = planPixels.current;
    if (!pixels) { say({ role: 'agent', amber: true, text: '还没图纸，说一下「12×9」就行。' }); return null; }
    // 人说过面积就用说的折，画布当前大小只在谁都没说过时兜底——否则「300 平米」白说了一场。
    const stated = memoryRef.current.areaM2;
    const dims = suggestDimsFromImageRatio(pixels.width, pixels.height, stated ?? live.current.width * live.current.height);
    setLengthRaw(String(dims.length)); setWidthRaw(String(dims.width)); setDimsTouched(true);
    setScaleOrigin('plan');
    say({ role: 'agent', text: `${stated !== null ? `按图纸比例和你说的 ${formatArea(stated)} ㎡` : '按图纸比例'}估的 ${formatArea(dims.length)} × ${formatArea(dims.width)} m，先按它出一版。不对就再说长宽。` });
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
        say({role:'agent',amber:true,text:'调研超时了，底图没铺。'});
        return;
      }
      const place = result.value;
      if (!place) {
        say({ role: 'agent', amber: true, text: `没查到「${query}」。换个更准的地名再试，或点「地图选址」手动圈一块。` });
        return;
      }
      if (!mapCurrent()) {
        say({role:'agent',amber:true,text:'场地变了，这次调研结果没用上。'});
        return;
      }
      const area = createResearchArea(place);
      // 落盘走专用路径，从 store 现取布局；不覆盖查询期间新选择的底图或锚点。
      try {
        requireSessionWrite();
        if (!current()) return;
        if (!mapCurrent()) {
          say({role:'agent',amber:true,text:'场地变了，这次调研结果没用上。'});
          return;
        }
        onApplyResearchArea(area);
      } catch { say({role:'agent',amber:true,text:'没有编辑权，底图写不进去。'}); return; }
      setView(current => ({ ...current, view2D: false }));
      say({
        role: 'agent',
        image: area.imageUrl,
        meta: '参考底图 · 不可作重建素材',
        text: `调研底图铺好了：${area.name}${area.address ? `（${area.address}）` : ''}。中心 ${area.center.lng.toFixed(5)}, ${area.center.lat.toFixed(5)}，半径 ${area.radiusM} m、约 ${area.widthM}×${area.depthM} m。3D 地面上那张图和这里贴的是同一张，可以直接在上面定点圈场地。`,
      });
    } catch {
      if (current()) say({role:'agent',amber:true,text:'调研暂时用不了，底图没铺。'});
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
    setOutdoorTask({ intent: `在「${place.name}」做设计`, state: 'working', action: '查询地图轮廓与草地，自动提出活动范围', steps: ['理解场地名', '候选地点已确认'] });
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
    if (!currentOutdoorTask(epoch, 'venue') || controller.signal.aborted || pickSeq !== venuePickSeq.current) return;
    const bridge = routeBridgeRef.current;
    if (pickBase !== JSON.stringify(bridge?.getPlan())) { setVenuePick(null); setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '查询期间规划变了，场地没换。', steps: [] }); return; }
    const anchor = { lng: place.lng, lat: place.lat, crs: 'gcj-02' as const, source: 'lookup' as const };
    const boundary = polygon ? trueFootprintBoundary(polygon.map(([lng, lat]) => ({ lng, lat })), anchor) : null;
    setVenuePick(null);
    if (!bridge) {
      setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '请先打开当前户外规划，未更改场地', steps: [] });
      say({ role: 'agent', amber: true, text: '先打开「户外规划」，场地没改。' });
      return;
    }
    if (bridge.applyPlan && bridge.getPlan()) {
      setOutdoorTask({ intent: `在「${place.name}」做设计`, state: 'working', action: '识别草地候选。缺少真实范围时提出标注假设的概念草案', steps: ['地点已确认'] });
      let range;
      try {
        range = await proposeAutomaticVenueRange({ plan: bridge.getPlan()!, anchor, name: place.name, footprint: boundary, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted || !currentOutdoorTask(epoch, 'venue')) return;
        setOutdoorTask({ intent: '自动场地范围', state: 'blocked', action: error instanceof Error ? error.message : '这次没圈出范围，原方案还在。', steps: [] });
        return;
      }
      if (!currentOutdoorTask(epoch, 'venue') || controller.signal.aborted || pickSeq !== venuePickSeq.current) return;
      if (pickBase !== JSON.stringify(bridge.getPlan())) {
        setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '方案变了，旧范围没用上。', steps: [] }); return;
      }
      // 2026-11-21 用户拍板「候选点选直接落地」：候选是用户刚选的，锚定写入不再单独立核对卡
      // （严格档仍由监督档拦下核对）。超界淘汰等提醒由 offer 直接落地路径写进设计过程。
      outdoorWorkflow.offerBoundary(anchor, range.boundary, place.name, range.basis, undefined, true);
      // 2026-11-20 用户拍板：范围来源不用念给用户，只留下一步能做什么。
      say({ role: 'agent', text: '直接说「长40米宽30米」这类，我来更新范围。' });
      return;
    }
    if (!boundary) {
      if (!bridge.beginVenueBoundary(anchor)) { setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '已有规划不能直接更换地理锚点，请先新建户外活动。当前内容保持不变', steps: [] }); return; }
      manualVenueAnchorRef.current = anchor;
      setOutdoorTask({ intent: `在「${place.name}」做设计`, state: 'blocked', action: '请在地图手画并闭合边界。未写入新场地', steps: ['候选地点已确认', '自动轮廓未命中，启用手画'] });
      say({ role: 'agent', text: '没找到现成边界，地图移到候选地点。沿用地圈一圈，闭合就生效。' });
      return;
    }
    if (bridge.applyVenue(anchor, boundary)) {
      setOutdoorTask({ intent: `在「${place.name}」做设计`, state: 'done', action: '真实边界与锚点已写入，2D/3D 同步', steps: ['地点已确认', '取得真实边界', '应用场地'], prompts: ['排一下流线'] });
      say({ role: 'agent', text: `已在户外规划设为「${place.name}」，边界来源：${source === 'osm' ? 'OSM 占地轮廓' : '行政区选区'}。2D/3D 共用这份规划，可撤销。` });
    } else setOutdoorTask({ intent: '确认场地', state: 'blocked', action: '已有规划不能直接换锚点。先新建户外活动。', steps: [] });

  }

  // V-2c：流线提案生成——读当前户外 plan（锚点/边界由 overlay 桥供给），路网 bbox 取边界最大跨度+余量。
  async function proposeRoutePlan(): Promise<void> {
    const epoch = beginOutdoorTask('route');
    const plan = routeBridgeRef.current?.getPlan() ?? null;
    if (!plan?.anchor || plan.boundary.length < 3) {
      say({ role: 'agent', amber: true, text: '还没有场地，先说「在XX做设计」。' });
      return;
    }
    const controller = new AbortController();
    outdoorRequestRef.current?.abort(); outdoorRequestRef.current = controller;
    const base = JSON.stringify(plan);
    setZoneProposal(null); setRouteProposal(null);
    setOutdoorTask({ intent: '根据真实道路安排流线和出入口', state: 'working', action: '读取场地周边路网', steps: ['读取当前用地红线'] });
    setRouteBusy(true);
    try {
      // 2026-11-14 测试修正：路网 bbox 按边界真实地理位置取（边界可离锚点很远），不再锚点居中。
      const { center, spanM } = roadFetchPlanForBoundary(plan.boundary, plan.anchor);
      say({ role: 'agent', text: '正在读路网，排流线和出入口…' });
      const { roads } = await fetchRoadNetwork(center, spanM, { signal: controller.signal });
      if (!currentOutdoorTask(epoch, 'route') || controller.signal.aborted || outdoorRequestRef.current !== controller) return;
      if (JSON.stringify(routeBridgeRef.current?.getPlan()) !== base) {
        setOutdoorTask({ intent: '安排流线和出入口', state: 'blocked', action: '场地变了，旧结果作废。', steps: [], prompts: ['排一下流线'] });
        return;
      }
      const proposal = buildRouteProposal({
        boundary: plan.boundary,
        anchor: { lng: plan.anchor.lng, lat: plan.anchor.lat },
        roads,
      });
      if (!proposal) {
        setOutdoorTask({ intent: '安排流线和出入口', state: 'blocked', action: '没有可用路网，未编造道路。稍后重试或手画', steps: ['读取当前用地红线'] });
        say({ role: 'agent', amber: true, text: '路网暂时拿不到，稍后再排一次。' });
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
      say({ role: 'agent', amber: true, text: '路网服务暂时不可用，没生成提案。' });
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
      setOutdoorTask({ intent: '安排流线和出入口', state: 'blocked', action: '场地变了，旧提案作废。', steps: [], prompts: ['排一下流线'] });
      return;
    }
    const ok = routeBridgeRef.current?.applyRoutes(proposal.routes, proposal.nodes) ?? false;
    if (ok) { routeTicketRef.current = null; routeProposalBaseRef.current = null; setRouteProposal(null); setOutdoorTask({ intent: '安排流线和出入口', state: 'done', action: '已应用，可整批撤销', steps: ['虚线预览', '用户确认', '写入正式流线与入口'], prompts: ['45 人讲座', '80 人市集'] }); }
    if (ok) say({ role: 'agent', decision: 'approved', text: `已应用 ${proposal.routes.length} 条流线和 ${proposal.nodes.length} 个出入口——虚线变实线了，Ctrl+Z 可整批撤销。` });
    else say({ role: 'agent', amber: true, text: '先打开户外规划，提案留着。' });
  }

  function dismissRouteProposal(): void {
    const ticket = routeTicketRef.current;
    if (!ticket || ticket.proposal !== routeProposal || !currentOutdoorTask(ticket.epoch, 'route')) return;
    beginOutdoorTask(null);
    setOutdoorTask(current => current ? { ...current, state: 'stopped', action: '已放弃预览，未写入' } : null);
    say({ role: 'agent', decision: 'rejected', text: '这版流线不要了，虚线撤掉。' });
  }

  // V-3：区域→事件→物料提案——brief 里的活动名/人数进配比，出入口决定入场朝向。
  function proposeZonePlan(): void {
    const epoch = beginOutdoorTask('zone');
    const plan = routeBridgeRef.current?.getPlan() ?? null;
    if (!plan?.anchor || plan.boundary.length < 3) {
      say({ role: 'agent', amber: true, text: '还没有场地，先说「在XX做设计」。' });
      return;
    }
    setRouteProposal(null); setZoneProposal(null);
    setZoneBusy(true);
    try {
      const memory = memoryRef.current;
      const issue = outdoorEventIssue(memory.event ?? null, memory.headcount ?? null);
      if (issue) { setOutdoorTask({ intent: '按活动需求分区与放置物料', state: 'blocked', action: issue, steps: ['读取当前场地'], prompts: ['45 人讲座', '80 人市集', '钓鱼比赛'] }); say({ role: 'agent', amber: true, text: issue }); return; }
      // 2026-11-17 用户拍板「活动类型限制太死板」：这个入口只产讲座/市集几何模板；
      // 未知/沿岸类型不再拦死也不再误报「未找到候选」——如实指向能走通的那条路。
      if (!supportedOutdoorEvent(memory.event ?? null)) {
        const event = memory.event ?? null;
        const redirect = isShorelineEvent(event)
          ? '沿岸类的沿真实水岸线排。说一句「就沿着水岸线」，我出钓位预览。'
          : `「${event ?? '这个活动'}」这版没有现成排布模板（${outdoorEventTemplatesSummary()}）。直接说分区和物料，我按需求排。`;
        setOutdoorTask({ intent: `${memory.headcount ?? ''} 人${event ?? '活动'}`, state: 'blocked', action: redirect, steps: ['核对活动类型'], prompts: isShorelineEvent(event) ? ['就沿着水岸线'] : ['室外展览区加 20 个摊位'] });
        say({ role: 'agent', amber: true, text: redirect });
        return;
      }
      if (!confirmedOutdoorEntrances(plan.nodes, plan.boundary).length) { setOutdoorTask({ intent: '按活动需求安排区域', state: 'blocked', action: plan.nodes.length ? '这个节点不在边界上，先放好入口再试。' : '先确认真实场地入口，才能安排签到、观众方向与接驳', steps: ['记录活动类型与人数'], prompts: [`按当前场地重新安排${memory.headcount ?? ''}人${memory.event ?? '活动'}`, '排一下流线'] }); return; }
      const siteSummary = outdoorEventSiteSummary({ boundary: plan.boundary, nodes: plan.nodes, existingFacilities: plan.facilities, existingRoutes: plan.routes });
      const proposal = buildZoneEventProposal({
        boundary: plan.boundary,
        nodes: plan.nodes,
        brief: { event: memory.event ?? null, guests: memory.headcount ?? null },
        existingFacilities: plan.facilities,
        existingRoutes: plan.routes,
      });
      if (!proposal) {
        setOutdoorTask({ intent: `${memory.headcount ?? ''} 人${memory.event ?? '活动'}`, state: 'blocked', action: `未找到同时满足占地、完整3m通道与入口连通的候选。${siteSummary} 可修改画布后按当前场地重试。未写入布局。`, steps: ['核对活动类型与人数', '检查占地、通道与交通冲突'], prompts: [`按当前场地重新安排${memory.headcount ?? ''}人${memory.event ?? '活动'}`] });
        say({ role: 'agent', amber: true, text: `当前真实边界内尚未找到避让设施/车流后勤并连通入口的候选，不等于断言场地绝对放不下。${siteSummary} 本次未生成布局。修改边界或流线后可直接补充说明，或点按当前场地重试。不会硬塞固定模板。` });
        return;
      }
      if (!currentOutdoorTask(epoch, 'zone')) return;
      zoneProposalBaseRef.current = JSON.stringify(plan);
      zoneTicketRef.current = { epoch, proposal };
      setZoneProposal(proposal);
      setOutdoorTask({ intent: `${memory.headcount ?? ''} 人${memory.event ?? '活动'}`, state: 'confirm', action: '区域、物料与人行通道预览就绪，确认才写入', steps: ['核对活动类型与人数', '检查真实边界与交通冲突', '排布物料并留出通道'] });
      say({ role: 'agent', text: `分区草案好了：${proposal.summary.zones} 个区域（${proposal.zones.some(z => z.semantic === 'stage') ? '签到→观众→舞台' : '签到→市集通道→摊位'}）+ ${proposal.summary.facilities} 件物料。画布上的虚线框是预览——点「应用」才写入，可整批撤销。` });
    } catch {
      say({ role: 'agent', amber: true, text: '分区没生成，稍后再试。' });
    } finally {
      setZoneBusy(false);
    }
  }

  function confirmZoneProposal(): void {
    const proposal = zoneProposal;
    const ticket = zoneTicketRef.current;
    if (!proposal || !ticket || ticket.proposal !== proposal || !currentOutdoorTask(ticket.epoch, 'zone')) return;
    if (zoneProposalBaseRef.current !== JSON.stringify(routeBridgeRef.current?.getPlan())) {
      setZoneProposal(null); setOutdoorTask({ intent: '活动分区与物料', state: 'blocked', action: '场地变了，旧提案作废。', steps: [] }); return;
    }
    // 双击/重放只写一次：同一个 epoch + 基准版本已经有票就不再写。
    if (!zoneApplyOnceRef.current.take(applyTicketKey(String(ticket.epoch), zoneProposalBaseRef.current))) return;
    const ok = routeBridgeRef.current?.applyZoneProposal(proposal.zones, proposal.facilities, proposal.routes, proposal.nodes) ?? false;
    if (ok) { zoneTicketRef.current = null; zoneProposalBaseRef.current = null; setZoneProposal(null); setOutdoorTask({ intent: '活动分区与物料', state: 'done', action: '已应用。选设施可切模型/生成/上传。选区域可编辑事件', steps: ['区域物料预览', '用户确认', '写入同一份户外规划'], focusFacilityId: (proposal.facilities.find(f => f.name.includes('舞台')) ?? proposal.facilities[0])?.id, prompts: ['补子出入口', '开始模拟'] }); }
    if (ok) say({ role: 'agent', decision: 'approved', text: `已应用 ${proposal.summary.zones} 个区域和 ${proposal.summary.facilities} 件物料，虚线变实线了。要改分区事件，选中分区再改。` });
    else say({ role: 'agent', amber: true, text: '先打开户外规划，提案留着。' });
  }

  function dismissZoneProposal(): void {
    const ticket = zoneTicketRef.current;
    if (!ticket || ticket.proposal !== zoneProposal || !currentOutdoorTask(ticket.epoch, 'zone')) return;
    beginOutdoorTask(null);
    setOutdoorTask(current => current ? { ...current, state: 'stopped', action: '已放弃预览，未写入' } : null);
    say({ role: 'agent', decision: 'rejected', text: '这版分区不要了，虚线撤掉。' });
  }

  // V-4a：子出入口提案——给每个分区接驳最近的主流线（复用 routeProposal 确认卡与 applyRoutes）。
  function proposeSubEntrances(): void {
    const epoch = beginOutdoorTask('route');
    const plan = routeBridgeRef.current?.getPlan() ?? null;
    if (!plan) {
      say({ role: 'agent', amber: true, text: '先打开户外规划，再补子出入口。' });
      return;
    }
    if (plan.zones.length === 0 || plan.routes.length === 0) {
      say({ role: 'agent', amber: true, text: '先有分区的流线，才能补子出入口。' });
      return;
    }
    const proposal = buildSubEntranceProposal(plan);
    if (!proposal) {
      say({ role: 'agent', amber: true, text: '流线离分区太远，接不上。' });
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
      say({ role: 'agent', text: '模拟在跑，小点就是人流。' });
      return;
    }
    beginOutdoorTask('simulation');
    const plan = routeBridgeRef.current?.getPlan() ?? null;
    if (!plan || plan.routes.length === 0) {
      say({ role: 'agent', amber: true, text: '先排流线并应用，再模拟。' });
      return;
    }
    setRouteProposal(null); setZoneProposal(null);
    setFlowSimActive(true);
    setOutdoorTask({ intent: '查看流动示意', state: 'working', stopLabel: '停止模拟', action: '流动示意已开启，只看走向。', steps: ['读取已应用流线', '启动真实画布动画'] });
    say({ role: 'agent', text: `流动模拟开始了：${plan.routes.length} 条流线上的小点就是人流，线越深越密。这只是预览，不写入方案。` });
  }

  function stopFlowSim(): void {
    if (!flowSimActive) return;
    beginOutdoorTask(null);
    setOutdoorTask({ intent: '查看流动示意', state: 'stopped', action: '动画已停止，规划数据未改动', steps: ['停止画布动画'], prompts: ['开始模拟'] });
    say({ role: 'agent', text: '流动模拟停了。要再看就说「开始模拟」。' });
  }

  /** 场地圈画应用（原 value 内联体，V-1c 提为具名函数：chat 锚定链与地图选址共用同一落壳路径）。 */
  function applyVenuePick(pick: { name: string; location: string; polygon: AmapPoint[]; satelliteGround?: boolean; satelliteGroundImage?: string }): string | null {
    if (phase === 'generating') { const reason = '还在出这一版，先停一下。'; say({ role: 'agent', amber: true, text: reason }); return reason; }
    const was2D = view.view2D;
    try {
      const base = layoutStore.getState().layout;
      if (base.floors.length !== 1) throw new Error('当前方案有多个楼层，圈场地会丢失已有内容。请保留原方案并先核对。');
      const { layout, cleared } = createVenueFromPick(base, pick);
      const preservation = validateCandidateApply(base, layout, activeFloorIndex);
      if (!preservation.ok) throw new Error(preservation.reason);
      for (const floor of base.floors) for (const item of floor.items) {
        const candidate = layout.floors.find(value => value.id === floor.id)?.items.find(value => value.id === item.id);
        if (!candidate || !sameRecoveryFormValue(item, candidate)) throw new Error(`圈场地会改变或移除「${item.name}」，本次未应用。请先保留原方案并核对。`);
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
      // 2026-11-16 用户定稿：选址即换场——新锚点 + 新用地红线推进户外规划，
      // 旧草稿由 applyVenue 按「换锚点=新场地」删掉（同锚点重画边界则保留内容）。
      // 第一人称漫游的围栏读的就是这份 boundary，接上以后直接站在新场地上。
      const sitePoint = layout.sceneAnchor ?? layout.mapLngLat ?? null;
      const siteBoundary = sitePoint
        ? trueFootprintBoundary(pick.polygon, { lng: sitePoint.lng, lat: sitePoint.lat })
        : null;
      if (sitePoint && siteBoundary) {
        routeBridgeRef.current?.applyVenue?.(
          { lng: sitePoint.lng, lat: sitePoint.lat, crs: 'gcj-02', source: 'picker' },
          siteBoundary,
        );
      }
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
        ? '。已铺上平湖秋月这一片的卫星底图，蓝线标出活动范围'
        : pick.satelliteGround ? '。已开启卫星参考底图'
        : '';
      say({ role: 'agent', text: `户外场地已生成：${pick.name} · 真实范围 ${Math.round(dims.width)} × ${Math.round(dims.depth)} m（外接矩形报米）${polyNote}${clamped ? '，布置壳取其中一块规划区（等比缩轮廓）' : ''}，${dropped}${satNote}。下一步去「空间」看实景，或重新选址。` });
      return null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : '地图场地没立起来，再试一次。';
      say({ role: 'agent', amber: true, text: reason });
      return reason;
    }
  }

  // 画布上有墙体/场地真相 = 第 ① 步已经过了；撤回或作废不会把它拆掉，进度和尺寸读数都靠它。
  // 模板场馆也是立起来的场地：角标和简报要能报出它的米数。
  const venueUp = layout.backendSceneV2 !== undefined || layout.backendVenue !== undefined || (activeFloor.interiorWalls?.length ?? 0) > 0;

  // 空壳自带固定长宽：立壳或被尺寸改写后，把读数同步成场地的真实米数，
  // 否则角标报了米数、卡片还空着，人一说话又按旧读数算。
  const venueDimsStamp = useRef('');
  const lengthValue = lengthCheck.ok ? lengthCheck.value : null;
  const widthValue = widthCheck.ok ? widthCheck.value : null;
  useEffect(() => {
    const stamp = layout.backendSceneV2 ? `shell:${layout.width}x${layout.height}` : '';
    if (!stamp || stamp === venueDimsStamp.current) return;
    venueDimsStamp.current = stamp;
    const matches = lengthValue !== null && widthValue !== null
      && Math.abs(lengthValue - layout.width) < 1e-6 && Math.abs(widthValue - layout.height) < 1e-6;
    if (!matches) { setLengthRaw(String(layout.width)); setWidthRaw(String(layout.height)); setScaleOrigin('typed'); }
    setDimsTouched(true);
  }, [layout.backendSceneV2, layout.width, layout.height, lengthValue, widthValue]);

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
      : comparisonOnly ? '这版未改变场景，仅供对照。可选择其他方案或重新生成。'
      : plan.lockedTouched ? `这版动了 ${plan.lockedTouched} 件锁着的物料，先解锁再改。`
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
      if(!bound&&value)say({role:'agent',amber:true,text:'物料数量没对上，重新核对再确认。'});
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
        say({ role: 'agent', text: '底图只是参照，读不出真实尺寸。',
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
    if (isAgentDocument(file)) {
      if (file.size > 20 * 1024 * 1024) { say({ role: 'agent', amber: true, text: '文档超过 20 MB，请拆分后上传。' }); return; }
      setPendingFiles(list => list.length >= MAX_PENDING_IMAGES ? list : [...list, { file, url: '' }]);
      return;
    }
    const verdict = classifyFile(file);
    if (verdict !== 'image') { await acceptFile(file); return; }
    try {
      // 现场截图要随理解请求上云：长边压到 1024、JPEG，10 张仍落在请求体预算内。
      const url = await readVisionImageAsDataUrl(file);
      setIssue(null);
      setPendingFiles(list => list.length >= MAX_PENDING_IMAGES ? list : [...list, { file, url }]);
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
      say({ role: 'agent', text: '画布改过了，这张卡先收起。' });
    }
  }, [layout, planShownPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 第 1 步的壳体播报：尺寸、墙与门、层高来源，一句一句照实说。 */
  /** 纯改尺寸只动壳：一句短的，不拉着人再确认一遍布置。 */
  function sizeOnlyNote(venue: VenuePlan): string {
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
        say({role:'agent',amber:true,text:'连接变了，预览收回，画布没改。'});return;
      }
      if(!checkProposalFloor()){failOpenLocalStep('这版没出成');setPhase('proposed');return;}
      onPreview(plan.layouts[step]!);
      setProgress(step + 1);
      shownSteps.current = step + 1;
      await wait(step === plan.layouts.length - 1 ? 120 : STEP_DELAY_MS);
      if (token !== runToken.current || !sessionScopeIsCurrent()) return;
      if(localDraftOwner.current&&!localDraftAllowed(localDraftOwner.current.owner,localDraftOwner.current)){
        dropProposal();failOpenLocalStep('这版没出成');phaseRef.current='failed';setPhase('failed');
        say({role:'agent',amber:true,text:'连接变了，预览收回，画布没改。'});return;
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
    const base=proposalBase.current, final=plan.layouts.at(-1);
    const automatic=!!(base&&final&&!plan.blocked&&!plan.overlapCount&&!gateAction(getAgentSupervision(),layoutActionRisk(base,final)).required);
    if(automatic){
      setTimeout(()=>{if(token===runToken.current&&proposal.current===plan&&sessionScopeIsCurrent())automaticConfirm.current();},0);
    }
    if (plan.receipt === 'banquet') return;
    const planView = viewOfLocalPlan(plan, proposalBase.current ?? undefined);
    const tail = automatic ? '将按当前执行权限核对并应用，可撤销。' : planView.review ? '还没落盘。点「确认布置」才挪。' : '还没落盘，点确认才写进画布。';
    const hint = layoutChatHint(plan);
    say({ role: 'agent', amber: !!planView.blocked || !!hint, text: planView.blocked
      ? `这版先改着，还不能确认。${hint ? hint : ''}`
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
    if (phase === 'generating') { rejectResize('还在出这一版，先停一下。'); return; }
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
      venue = (before.backendSceneV2 ? replaceVenueWithShell(input) : null) ?? raiseVenue(input);
    } catch (error) {
      rejectResize(error instanceof Error ? error.message : '这个尺度我立不起来，说一句「12×9」这样告诉我新的长宽。');
      return;
    }
    if (!venue) {
      rejectResize('这个场地是导入或生成的复杂结构，不能只改外框。要换尺寸得先重新立一块矩形空地。');
      return;
    }
    if(hasInvalidRetainedZones(venue.layout)){rejectResize('区域超出新场地，先调整区域。');return;}
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
    say({ role: 'agent', text: sizeOnlyNote(venue) });
  }

  /** 左栏简报的「空白场地」文字链：和模板轨首卡同一块 12×8 空壳，不用先开物料库。 */
  function startBlankVenue(): void {
    if (phase === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：先停一下，再换空地。' }); return; }
    const before = live.current;
    const materialCount = before.floors.reduce((count, floor) => count + floor.items.filter(item => !isStructuralMarker(item)).length, 0);
    const zoneCount = before.floors.reduce((count, floor) => count + (floor.zones?.length ?? 0), 0);
    const recordedVenue = !!(before.venueScan || before.floorPlanImage || before.researchArea || before.sceneAnchor ||
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
    if(!owner||!localDraftAllowed(owner)) { say({role:'agent',amber:true,text:'先断开云端才能出本地草案。'});setPhase('failed');return; }
    const annotations=readLocalDraftAnnotations();
    if(!annotations){say({role:'agent',amber:true,text:'路线或区域读不全，草案没生成。'});setPhase('failed');return;}
    const initial=owner.getSnapshot(),authority={owner,actor:initial.user?.id??null,sessionId:initial.sessionId??null,apiUrl:owner.config?.apiUrl??null,version:owner.localDraftAuthorityVersion(),annotationRevision:annotations.revision,annotationSignature:annotations.signature,annotationReader:annotations.reader,routeReader:annotations.routeReader,routeSignature:annotations.routeSignature};
    if(memoryRef.current.layoutModeConfirmed!==true||memoryRef.current.layoutMode!=='desk-chair'||!memoryRef.current.headcount){say({role:'agent',amber:true,text:'先说人数和课桌椅布置，再生成草案。'});setPhase('failed');return;}
    const allocation=memoryRef.current.localSeatingAllocation;
    if(allocation?.status==='shared_desk'&&allocation.peoplePerDesk!==2){
      say({role:'agent',amber:true,text:`已记下每桌 ${allocation.peoplePerDesk} 人。本地工具不支持这种组团，没有生成。`});setPhase('failed');return;
    }
    if(allocation?.status==='unknown'){
      say({role:'agent',amber:true,text:'每桌坐几人？没说清就没生成。'});setPhase('failed');return;
    }
    if(memoryRef.current.zoneNeeds.stage===true||memoryRef.current.zoneNeeds.checkin===true||memoryRef.current.zoneNeeds.rest===true||memoryRef.current.mobilityRequirement?.decision==='needed'){
      say({role:'agent',amber:true,text:'这些要求放不下，先调整需求。'});setPhase('failed');return;
    }
    if(Math.abs(base.width-scale.length)>1e-6||Math.abs(base.height-scale.width)>1e-6){say({role:'agent',amber:true,text:'草案不改场地，先核对尺寸。'});setPhase('failed');return;}
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
      say({role:'agent',amber:true,text:`${missing.length?`${missing.join('、')}尚未明确，请带单位重新说明。`:''}${waiting.length?`${waiting.join('、')}只当作线索，还没选进这版方案。${choose}`:''}本次没有按默认规格生成。`});setPhase('failed');return;
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
        say({role:'agent',amber:true,text:`本地草案暂未生成：${reason}，场景未改。${shared?`需求 ${result.requested} 人、${requestedTables} 桌，已排 0 人、0 桌，尚缺 ${result.shortfall} 人；`:''}${result.unknown.join('、')}没有值。`});setPhase('failed');return;
      }
      if(token!==runToken.current||!localDraftAllowed(owner,authority)||!floorStillCurrent(floorToken)||!sameLayoutContent(base,live.current)){
        say({role:'agent',amber:true,text:'活动或场景变了，草案没应用。'});setPhase('failed');return;
      }
      const overlaps=countOverlaps(result.layout,activeFloorIndex);
      const markedDoor=!!base.entrance&&base.entrance.door!==false||!!base.backendVenue?.entrances.length||
        !!base.backendSceneV2?.venue.entrances.length||!!base.backendSceneV2?.structure.openings.some(opening=>opening.kind==='door')||
        base.floors.some(floor=>floor.items.some(item=>item.type==='door'||!!item.venueEntranceId));
      const routeReview=assessLocalDraftRoutes(base,result.layout,annotations,activeFloorIndex);
      const limitations=[annotations.hasUnmodelled?'当前版本尚未将已有路线、区域或阶段纳入组团计算，暂只能预览。':null,localDraftRouteBlock(routeReview)].filter((item,index,items):item is string=>!!item&&items.indexOf(item)===index);
      const routeNotices=annotations.routes.length?[
        '这次只核对手绘路线中心线和模型的占地范围。路线净宽、门和无障碍的实测值补进来后一起算。',
        ...(routeReview.existing.length?[`原场景已有 ${routeReview.existing.length} 处路线与模型包围占地相交，不归因于本次新增。还没量。`]:[]),
        ...(routeReview.contacts.length?['路线与模型包围占地边缘接触，实际净宽还没量。']:[]),
      ]:[];
      const doorNotice=markedDoor||annotations.hasDoor?'这次没算门洞和入口，补进图后一起算。':null;
      const dimensionLine=(name:string,size:{width:number;depth:number;height:number},facts:SeatingItemFacts|undefined)=>`${name} ${(['width','depth','height'] as const).map(axis=>`${size[axis]}（${facts?.[axis]?.status==='reported'?'用户提供':'假设'}）`).join(' × ')} 米`;
      const localDraftDetails=[shared?`本机草案：需求 ${result.requested} 人、${requestedTables} 桌。本次排了 ${result.placed} 人、${placedTables} 桌、${result.placed} 把椅子，尚缺 ${result.shortfall} 人。还没同步云端。`:`本机草案：本次排了 ${result.placed} / ${result.requested} 套，尚缺 ${result.shortfall} 套。未同步云端，也未确认本机持久化。`,
        shared?'每桌 2 人。':allocation?.status==='one_per_desk'?'每人一桌。':'每人一桌是这次试排的假设，随时可改。',
        `示意尺寸：${dimensionLine(shared?'双人桌':'单人桌',desk.value,saved?.desk)}。${dimensionLine('椅子',chair.value,saved?.chair)}。`,
        `示意间距：桌椅 0.1 米、${shared?'椅间 0.1 米、':''}列间 0.3 米、排间 0.5 米、距边 0.3 米。这是我取的默认值，要改就说数字。`,
        ...(shared&&result.shortfall?[`${result.limitReason==='object_limit'?'已触及本机场景物件数量上限':result.limitReason==='scan_limit'?'本次搜索达到计算上限':'本次排布未找到更多位置'}，这一版就到这儿。要更多位置就腾地方或换分区。`]:[]),
        `${result.unknown.join('、')}没有值。`,...(doorNotice?[doorNotice]:[]),...routeNotices,...limitations];
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
    const resized = Math.abs(before.width - scale.length) > 1e-6 || Math.abs(before.height - scale.width) > 1e-6;
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
      say({ role: 'agent', amber: true, text: '这块场地只能重建，先确认尺寸。' });
      setPhase('failed'); return;
    }
    if(venue && hasInvalidRetainedZones(venue.layout)){revertScaleToCanvas();failOpenLocalStep('这版没出成');say({role:'agent',amber:true,text:'区域超出新场地，先调整再生成。'});setPhase('failed');return;}
    const candidateBase = venue?.layout ?? before;
    if (venue) {
      say({ role: 'agent', text: '场地按这个尺寸准备好了。确认后才写入。' });
      await wait(STEP_DELAY_MS); if (token !== runToken.current || !sessionScopeIsCurrent()) return;
      if (!floorStillCurrent(floorToken)) {failOpenLocalStep('这版没出成');say({role:'agent',amber:true,text:'楼层在准备期间已变化，请重新生成。'});setPhase('failed');return;}
      if (!sameLayoutContent(before, live.current)) {
        failOpenLocalStep('这版没出成');
        say({ role: 'agent', amber: true, text: '场景刚变过，这版没应用。' });
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
    if (!final) { failOpenLocalStep('这版没出成'); setPhase('failed'); say({ role: 'agent', amber: true, text: '没生成方案，场景没动。' }); return; }
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
    if(isHistoryReviewRequired()){say({role:'agent',amber:true,text:'先核对需求重新生成，再确认。'});return;}
    const sessionId=boundSessionId.current;
    if(proposal.current&&proposalSessionRef.current!==sessionId){say({role:'agent',amber:true,text:'这版来自别的会话，得重新生成。'});return;}
    if(sessionId&&(incompleteDialogueTurns.current.get(sessionId)?.size??0)>0){
      say({role:'agent',amber:true,text:'还有要求没处理，先逐项核对。'});return;
    }
    if(generationQueuedRef.current>0||generationWait.current||briefRequest.current||pendingModelInputs.current.size>0){
      say({role:'agent',amber:true,text:'还在处理，等完成再确认。'});return;
    }
    if(localDraftOwner.current&&!localDraftAnnotationsCurrent(localDraftOwner.current)){
      say({role:'agent',amber:true,text:'路线或区域变了，草案没应用。'});return;
    }
    if(localDraftOwner.current && !localDraftAllowed(localDraftOwner.current.owner,localDraftOwner.current)){
      say({role:'agent',amber:true,text:'连接变了，草案没应用。'});return;
    }
    if (sessionScope !== 'legacy' && (!isVenueScaleCurrent(memoryRef.current,layoutStore.getState().layout) || !sourceScaleBound(memoryRef.current) || !factScaleBound(memoryRef.current))) { say({role:'agent',amber:true,text:'场地变了，尺寸得重新说。'}); return; }
    if (!sessionScopeIsCurrent()) { say({role:'agent',amber:true,text:'活动已切换，请在当前活动重新核对方案。'}); return; }
    if (callbacks.workbenchMode !== 'layout') {
      say({ role: 'agent', text: '先不改布置，回布置对话再说。' });
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
    const lockedChange=lockedLayoutChange(currentLayout,final);
    if(lockedChange){say({role:'agent',amber:true,text:lockedChange});return;}
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
      say({role:'agent',amber:true,text:'连接变了，草案没应用。'});return;
    }
    if(localDraftOwner.current){
      const annotations=readLocalDraftAnnotations();
      if(!annotations){say({role:'agent',amber:true,text:'路线资料无法核对，本地草案未应用。'});return;}
      const routeBlock=localDraftRouteBlock(assessLocalDraftRoutes(currentLayout,final,annotations,currentState.activeFloorIndex));
      if(routeBlock){say({role:'agent',amber:true,text:routeBlock});return;}
    }
    const risk=layoutActionRisk(currentLayout,final);
    if(automaticConfirmation.current&&gateAction(getAgentSupervision(),risk).required)return;
    pushLocalLayoutStep('confirm', 'running');
    try { onApply(automaticConfirmation.current&&risk.kind==='destructive'?addDesign(currentLayout,final):final, { expectedBase, preserveProvenance: true, expectedFloor:floor }); }
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
      : localExploration ? `已写入本机画布：这一版一共 ${total} 件物料，可撤销。门和路线的实测值补进图后再算。`
      : `写进画布了：这一版一共 ${total} 件物料，可以直接拖。不想要就撤销。` });
    if (styleHistoryFailed) say({ role: 'agent', amber: true, text: '布置已应用，但风格历史未能保存。' });
    callbacks.onFit();
  }

  /**
   * 云端那一版的确认也只走这颗绿钮。`applyPreview` 成功会把预览清空、失败留下预览和一句原因，
   * 两者都要等它自己那一帧渲染完才读得到，所以这里只按下开关，结果交给下面的 effect 照实播报。
   */
  function confirmCloud(): void {
    const current = studioRef.current;
    if (!current?.preview) { say({ role: 'agent', amber: true, text: '这版预览已撤，重新出一版。' }); return; }
    if (confirmPending.current) { say({role:'agent',text:'这版正在确认，请稍候。不会重复提交。'}); return; }
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
    say({ role: 'agent', amber: !!current.notice, text: `写进画布了，可以直接拖。${current.notice ? ` ${current.notice}。` : ''}` });
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
      ? '预览收回，物件还在原位。'
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
      : '这版还是预览，点「确认布置」才写入。' });
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
      say({role:'agent',amber:true,text:'面积没核对上，再说一次面积。'});return false;
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
      if(token===runToken.current){runToken.current++;setPhase('failed');if(lastSource.current==='cloud')void studioRef.current?.cancelRun();say({role:'agent',amber:true,text:'等太久了，画布没动。可能还在处理。'});}
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
      say({ role: 'agent', text: '已请求停止，画布没动。可能还在计费。' });
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
    if (phaseRef.current === 'generating' || phaseRef.current === 'paused' || outdoorWorkflow.busy || outdoorTask?.state === 'working') return true;
    if (current?.busy || current?.recoverable) return true;
    return !!(current?.preview && (current.stale || current.expired));
  }

  /** Export reads the applied layout; a visible candidate is a different version. */
  function pendingCandidateBlocksExport(): boolean {
    return proposal.current !== null || !!studioRef.current?.preview || !!outdoorWorkflow.proposal;
  }

  function refusePendingCandidateExport(): boolean {
    if (!pendingCandidateBlocksExport()) return false;
    setExportPreview(false);
    say({ role: 'agent', amber: true, text: '先确认或撤回预览，再导出。' });
    return true;
  }

  function proposeExport(): void {
    if (refusePendingCandidateExport()) return;
    if (previewUnsettled()) {
      say({ role: 'agent', amber: true, text: '还在生成，先别确认。' });
      return;
    }
    const bridge=routeBridgeRef.current;
    if(bridge?.applyPlan){
      const plan=bridge.getPlan();if(!plan){say({role:'agent',amber:true,text:'当前活动规划尚未载入，不能导出旧场景。'});return;}
      outdoorExportRef.current={base:JSON.stringify(plan),scope:sessionScope,session:boundSessionId.current,projectId:bridge.projectId?.()??sessionScope,epoch:outdoorEpochRef.current,brief:structuredClone(outdoorWorkflow.state.brief),requirements:bubblesRef.current.filter(b=>b.role==='user').map(b=>b.text)};
      setExportPreview(true);say({role:'agent',text:'导出户外规划草案，只下载到本机。'});return;
    }
    outdoorExportRef.current=null;
    setExportPreview(true);
    say({ role: 'agent', text: '导出执行资料草案，不含这次对话的需求。' });
  }

  function confirmExport(): void {
    const snapshot=outdoorExportRef.current,bridge=routeBridgeRef.current;
    if(snapshot||bridge?.applyPlan){
      if(!snapshot||!bridge?.applyPlan||!sessionScopeIsCurrent()||snapshot.scope!==sessionScope||snapshot.session!==boundSessionId.current||snapshot.epoch!==outdoorEpochRef.current||snapshot.projectId!==(bridge.projectId?.()??sessionScope)||snapshot.base!==JSON.stringify(bridge.getPlan())){
        outdoorExportRef.current=null;setExportPreview(false);say({role:'agent',amber:true,text:'规划变了，重新预览再导出。'});return;
      }
      if(refusePendingCandidateExport()||previewUnsettled())return;
      if(!bridge.exportPlanDraft){say({role:'agent',amber:true,text:'户外草案还没接通导出。'});return;}
      try{
        const ok=bridge.exportPlanDraft(snapshot.base,{brief:snapshot.brief,requirements:snapshot.requirements});
        if(!ok){outdoorExportRef.current=null;setExportPreview(false);say({role:'agent',amber:true,text:'规划变了，重新预览再导出。'});return;}
        outdoorExportRef.current=null;setExportPreview(false);say({role:'agent',text:'已下载到本机，没有外发。'});
      }catch{say({role:'agent',amber:true,text:'下载没完成，检查浏览器权限再试。'});}
      return;
    }
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
      say({ role: 'agent', amber: true, text: '还有要求没处理，交接文件没生成。' });
      return;
    }
    say({ role: 'agent', text: '好，我在本机生成执行资料草案。' });
    void studio.exportActivity().then(() => {
      say({ role: 'agent', text: '已下载执行资料，可离线打开。' });
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
      setExportPreview(false);say({role:'agent',text:'物料清单已下载，还没定稿。'});
    }).catch(error=>{if(sessionScopeIsCurrent())say({role:'agent',amber:true,text:error instanceof Error?error.message:'物料草案未导出，请核对当前项目后重试。'});});
  }

  function dismissExport(): void {
    outdoorExportRef.current=null;
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
    // 留痕锚点：入口已保证 session 绑定就绪；本句用户气泡已入列，轮次号从气泡数减一（0 基）。
    const questionProjectId=conversationProjectId(routeBridgeRef.current?.projectId?.());
    const trace={ turnKey: conversationTurnKey(), sessionId: session,
      turnIndex: Math.max(0, bubblesRef.current.filter(item=>item.role==='user').length-1),
      ...(questionProjectId?{projectId:questionProjectId}:{}) };
    pendingModelInputs.current.add(text);
    let release!:()=>void;
    briefTurnTail.current=new Promise<void>(resolve=>{release=resolve;});
    const current=()=>!request.controller.signal.aborted&&sessionScopeIsCurrent()&&boundSessionId.current===session&&getActiveAssistantSessionId(sessionScope)===session&&briefTurnSequence.current===sequence;
    try {
      await prior;await waitForGeneration();if(!current())return;
      briefRequest.current=request;setUnderstanding(true);
      const cancelled=new Promise<never>((_,reject)=>request.controller.signal.addEventListener('abort',()=>reject(new DOMException('已停止等待','AbortError')),{once:true}));
      const provider=studioRef.current?.activeProvider;
      const selectedModel=provider&&provider!=='default'?studioRef.current?.activeModel??null:null;
      // 流式优先：可见内容边到边上屏。旧后端没有该路由时，assistantChatStream 内部退回一次性请求。
      const streamFn=typeof controller.assistantChatStream==='function'?controller.assistantChatStream.bind(controller):null;
      const streamed=streamFn
        ? streamFn(text,history,request.controller.signal,(delta)=>setStreamPreview(prev=>(prev??'')+delta),provider&&provider!=='default'?provider:undefined,selectedModel,undefined,undefined,trace)
        : controller.assistantChat(text,history,request.controller.signal,undefined,provider&&provider!=='default'?provider:undefined,selectedModel,undefined,undefined,trace);
      const result=await Promise.race([streamed,cancelled]);
      if(!current())return;
      if(result.status==='ok')say({role:'agent',text:result.answer,modelConversation:true});
      else {
        const retryable = result.status==='timeout'||result.status==='provider_error';
        if(retryable)uncertainInputs.current.add(text);
        const status=result.status;
        const view=agentErrorView(status);
        // 失败轮也留人话：同 turnKey 补写 assistantText，服务端 upsert 只补不覆盖结局。
        recordConversationTurn(studioRef.current?.controller as unknown as ConversationTraceTransport | undefined, {
          turnKey: trace.turnKey, sessionId: trace.sessionId, turnIndex: trace.turnIndex,
          ...(trace.projectId?{projectId:trace.projectId}:{}),
          surface:'assistant', userText:text, assistantText:view.message, outcome:'failed',
        });
        // 按既定口径：所有错误卡都保留「重试云端理解 / 改一句再说」；重试是手动重发同一句，不会自动换到其它模型。
        const retry = () => { if (!briefRequest.current) void send(text, true); };
        const alert = { stamp: view.stamp, tone: view.tone, retry };
        say({role:'agent',amber:true,text:view.message,alert});
      }
    } catch {
      if(current()){uncertainInputs.current.add(text);
        // 网络层失败：后端多半没写上（或写了 failed 不带文案）；不带 errorCode，让服务端已有的分类保留。
        recordConversationTurn(studioRef.current?.controller as unknown as ConversationTraceTransport | undefined, {
          turnKey: trace.turnKey, sessionId: trace.sessionId, turnIndex: trace.turnIndex,
          ...(trace.projectId?{projectId:trace.projectId}:{}),
          surface:'assistant', userText:text, assistantText:'问答没完成，可能还在计费。', outcome:'failed',
        });
        say({role:'agent',amber:true,text:'问答没完成，可能还在计费。',alert:{stamp:'智能理解',tone:'warn',retry:()=>{if(!briefRequest.current)void send(text,true);}}});}
    } finally {pendingModelInputs.current.delete(text);if(briefRequest.current===request){briefRequest.current=null;setUnderstanding(false);}setStreamPreview(null);release();}
  }

  // 2026-11-16：地点定完、范围确认后，把退回时存下的那句接回来跑一次。
  // 先清槽再发，保证同一句只消费一次；已按 boundary 去重，避免重渲染重复触发。
  const resumedBriefRef = useRef<string | null>(null);
  useEffect(() => {
    const boundary = outdoorWorkflow.state.confirmedBoundary;
    const pending = readPendingBrief(outdoorWorkflow.state.scope);
    if (!shouldResumeBrief({ pending, boundary, lastBoundary: resumedBriefRef.current })) return;
    if (!pending) return;
    resumedBriefRef.current = boundary;
    clearPendingBrief(outdoorWorkflow.state.scope);
    say({ role: 'agent', text: '地点和范围定了，接着你刚才那句继续。' });
    void sendCore(pending.text);
  }, [outdoorWorkflow.state.confirmedBoundary, outdoorWorkflow.state.scope]);

  async function sendCore(text: string, allowUncertainRetry=false, queued=false, queuedAttachment?:{file:File;url:string}|null, queuedHistory?:Array<{role:'user'|'assistant';text:string}>): Promise<void> {
    if (pendingModelInputs.current.has(text.trim())) return;
    if (!allowUncertainRetry && uncertainInputs.current.has(text.trim())) {setRetryUncertain(text.trim());return;}
    if (!sessionScopeIsCurrent()) { say({role:'agent',amber:true,text:'活动已切换，请在当前活动重新发送。'}); return; }
    // 图纸/照片先在输入框里等：这一句发出去时才算读过、才铺底图；纯发文件也算一步。
    const staged = queued ? [] : pendingFiles;
    const attachment = queued ? queuedAttachment??null : staged[0]??null;
    if (attachment) setPendingFiles([]);
    const trimmed = text.trim();
    if (!trimmed && !attachment) return;
    // 先占一个留痕锚点：本机命令直接答完时由 say 补记；进入模型链路前把锚点清空。
    // 2026-11-21 修正：绑定 effect 与发送之间有窗口，此前全部落到 unknown 占位（留痕实证）；
    // 会话 id 兜底读会话当前活跃 id，轮次号用本会话已入列的用户气泡数（此刻本句还没入列），
    // projectId 只在活动已挂云项目时带上（本地活动没有云端 id，不得编造）。
    const traceProjectId = conversationProjectId(routeBridgeRef.current?.projectId?.());
    const turnTrace = trimmed ? {
      turnKey: conversationTurnKey(),
      sessionId: boundSessionId.current ?? getActiveAssistantSessionId(sessionScope) ?? 'unknown',
      turnIndex: bubblesRef.current.filter(item => item.role === 'user').length,
      ...(traceProjectId ? { projectId: traceProjectId } : {}),
      userText: trimmed, startedAt: Date.now(),
    } : null;
    localTurnRef.current = turnTrace;
    // 2026-11-16 用户口径：地图优先。地点没定就发布置/动线/分区，本地退回选址，
    // 不发起模型调用——否则会先等十几秒再报登录，把人挡在第一步。选址句不受此限。
    // 2026-11-16 实测补充：像「在植物园周边做两日市集，签到放进摊区」这种地名 + 设计
    // 的复合句，不能被 matchVenueCommand 整句吃掉。保留整句：设计部分存成待办，
    // 地名交给选址流程定位，范围确认后由待恢复槽接回。
    if(!queued&&!attachment&&(outdoorWorkflow.viewerKnownAnonymous || (typeof navigator !== 'undefined' && !navigator.onLine))
      &&looksLikeDesignInstruction(trimmed)&&!matchResearchCommand(trimmed)
      && placeStillPending({ hasOutdoorPlan: Boolean(routeBridgeRef.current?.applyPlan), stage: outdoorWorkflow.state.stage, venueUp, rangeConfirmed: outdoorWorkflow.scopeConfirmed() })){
      writePendingBrief(outdoorWorkflow.state.scope, trimmed, outdoorWorkflow.state.stage);
      if(!isCompositeDesignBrief(trimmed, matchVenueCommand(trimmed))){
        // 退回不是终点：把"还差什么"和"下一步就一件事"直接说在气泡里，
        // 下一步由待办模型给出（选地点/圈范围/登录），不在这里另写一套判断。
        const layered = absorbLayeredInstruction({ text: trimmed, stage: outdoorWorkflow.state.stage });
        say({role:'user',text:trimmed});
        say({role:'agent',text: layered ? layeredBounceText(layered, PLACE_FIRST_BOUNCE) : `${PLACE_FIRST_BOUNCE} 下一步：在地图上选地点。`});
        return;
      }
    }
    // A registered common capability is not an outdoor geometry/model intent. Unknown/mixed
    // input stays intact for the same domain Agent; never fall through to legacy layout generators.
    if(exportPreview&&(outdoorExportRef.current||routeBridgeRef.current?.applyPlan)){
      if(!queued&&!attachment&&(explicitProposalApproval(trimmed)||/^(?:请)?确认导出[。!！]?$/u.test(trimmed))){say({role:'user',text:trimmed});confirmExport();return;}
      outdoorExportRef.current=null;setExportPreview(false);
    }
    if(!queued&&!attachment&&routeBridgeRef.current?.applyPlan){
      const common=resolveCommonCapability(trimmed,window.localStorage);
      if(common.handled){
        say({role:'user',text:trimmed});
        if(common.id==='export'){setStylePickerOpen(false);proposeExport();return;}
        if(common.selection==='open'){outdoorWorkflow.cancel();setStylePickerOpen(true);say({role:'agent',text:'先选色板预览，户外只给现有设施上色。'});}
        else placeStyleBundleNow(common.selection);
        return;
      }
    }
    // The single visible outdoor workbench dispatches through the contextual domain workflow.
    // Legacy layout/keyword planners remain only for legacy integrations without the atomic plan bridge.
    if(!queued&&callbacks.workbenchMode==='layout'&&routeBridgeRef.current?.applyPlan){
      // 保留留痕锚点：这条路径可能由本地规则作答（例如场地没匹配上），不发请求也要能补记。
      // 真的调了模型的轮次由 noteServerCall 打标，say 里不会再重复记。
      const [previousRequest, previousReply] = chatUserHistory(bubblesRef.current.slice(-2), trimmed);
      const clarification = previousRequest?.role === 'user' && previousReply?.role === 'assistant'
        ? { request: previousRequest.text, question: previousReply.text }
        : undefined;
      if(attachment){
        // 全部待发图（最多 10 张）一起送；超预算的按顺序留下，并如实说几张没带。
        const sessionId = boundSessionId.current;
        const documentScope = `${sessionScope}:${sessionId ?? 'local'}`;
        const batch = staged.length ? staged : [attachment];
        const documentFiles = batch.filter(item => isAgentDocument(item.file));
        let documents = readAgentDocuments(documentScope);
        if (documentFiles.length) {
          say({ role: 'agent', text: `正在读取 ${documentFiles.map(item => item.file.name).join('、')}，提取可引用的文字与表格。` });
          try {
            const extracted = await Promise.all(documentFiles.map(item => extractAgentDocument(item.file)));
            if (!sessionScopeIsCurrent() || boundSessionId.current !== sessionId) return;
            documents = rememberAgentDocuments(documentScope, extracted);
            say({ role: 'agent', text: `已读取 ${extracted.map(doc => `${doc.name}（${doc.sections.length} 段）`).join('、')}。资料已保存在当前对话，可展开“已读资料”查看原文。` });
          } catch (error) {
            if (!sessionScopeIsCurrent() || boundSessionId.current !== sessionId) return;
            setPendingFiles(batch);
            say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '文档读取未完成，附件保留，请重试。' });
            return;
          }
        }
        const { images, skipped } = visionImagesWithinBudget(batch.filter(item => !isAgentDocument(item.file)).map(item=>item.url));
        say({role:'user',text:trimmed||`📎 ${batch.map(item => item.file.name).join('、')}`});
        if (skipped>0) say({role:'agent',amber:true,text:`有 ${skipped} 张图超出本次请求的体积上限，只带了 ${images.length} 张。其余没有上传，可减少张数后重发。`});
        // 纯发图也给一句默认理解指令（边缘 schema 要求 message 非空）；图片随 outdoor_v1 请求发给 deepseek-flash。
        await outdoorWorkflow.handle(trimmed||'请阅读我上传的资料，概括其中的场地、分区或宾客要求并引用来源。先指出需要澄清的地方', clarification, images, documents);
        return;
      }
      say({role:'user',text:trimmed});
      // 2026-11-19 正式站实测：同一句「在杭州湖滨银泰in77做200人发布会…」
      // 模型有时判 search、有时判 ask，地点入口就时有时无。复合句里地点已写明时，
      // 先在本地确定性地发起候选检索；设计部分照旧存进待恢复槽，范围确认后接回。
      const localVenueName = matchVenueCommand(trimmed);
      const canReplaceVenuePick = !venuePick
        || (!venuePick.loading && !venuePick.picking && venuePick.candidates.length === 0);
      if (canReplaceVenuePick && localVenueName && localVenueName !== 'ask'
        && placeStillPending({ hasOutdoorPlan: Boolean(routeBridgeRef.current?.applyPlan), stage: outdoorWorkflow.state.stage, venueUp, rangeConfirmed: outdoorWorkflow.scopeConfirmed() })) {
        if (isCompositeDesignBrief(trimmed, localVenueName)) {
          writePendingBrief(outdoorWorkflow.state.scope, trimmed, outdoorWorkflow.state.stage);
        }
        const epoch = beginOutdoorTask('venue');
        setOutdoorTask({ intent: `在「${localVenueName}」做设计`, state: 'working', action: '检索场地候选', steps: ['理解场地名'] });
        setVenuePick({ epoch, query: localVenueName, candidates: [], loading: true, picking: null });
        say({ role: 'agent', text: `我理解为「${localVenueName}」，先找一下这个场地——下面点一个候选确认是真实场地，我再把它设为活动场地。` });
        return;
      }
      if(outdoorWorkflow.clarify(trimmed))return;
      // 一个入口：登录且在线时，排流线也交给域 Agent，由模型决定用哪些工具；
      // 本地确定性路线规划只在未登录或断网时兜底（viewerKnownAnonymous / navigator.onLine）。
      // 这样同一句话不会时而秒回、时而反问。
      const localOnly = outdoorWorkflow.viewerKnownAnonymous || (typeof navigator!=='undefined' && !navigator.onLine);
      if (matchRouteCommand(trimmed, true) && localOnly) {
        if (outdoorWorkflow.scopeConfirmed()) await outdoorWorkflow.action('main-routes');
        else await proposeRoutePlan();
        return;
      }
      // 2026-11-18 M4 离线切片：「帮我分区」「200 人市集，签到靠近入口，留出通道」这类句子的
      // 意图识别与分区/物料/流线生成本来就是本地确定性规则（与上方排流线同口径，见
      // lib/outdoor-local-commands）。已确认未登录时不再落登录卡，直接出预览；已登录仍走
      // 同 Agent 模型路径，不偷跑旧模板（见 outdoor contextual workflow 生产用例）。
      if (outdoorWorkflow.viewerKnownAnonymous && routeBridgeRef.current?.getPlan()
          && matchesLocalOutdoorCommand(trimmed, memoryRef.current.event ?? null)) {
        const localEventTurn = parseOutdoorEventTurn(trimmed, memoryRef.current.event ?? null, outdoorKindRef.current === 'zone' && outdoorTask?.state === 'blocked');
        if (localEventTurn) saveMemory({ ...memoryRef.current,
          ...(localEventTurn.event ? { event: localEventTurn.event } : {}),
          ...(localEventTurn.headcount != null ? { headcount: localEventTurn.headcount } : {}) });
        else {
          const statedLocal = parseBriefSentence(trimmed);
          saveMemory({ ...memoryRef.current, ...(statedLocal.event ? { event: statedLocal.event } : {}), ...(statedLocal.headcount ? { headcount: statedLocal.headcount } : {}) });
        }
        await proposeZonePlan();
        return;
      }
      if(venuePick&&!venuePick.loading&&!venuePick.picking){
        const ordinal=trimmed.match(/(?:第|选|用|就)([一二三四五12345])(?:个|项)?/u)?.[1];
        const index=ordinal?('一二三四五'.includes(ordinal)?'一二三四五'.indexOf(ordinal):Number(ordinal)-1):-1;
        const named=venuePick.candidates.filter(place=>trimmed.includes(place.name));
        const chosen=index>=0?venuePick.candidates[index]:named.length===1?named[0]:undefined;
        if(chosen){await handleVenuePick(chosen);return;}
        if(isAffirmativeIntent(trimmed)){if(venuePick.candidates.length===1)await handleVenuePick(venuePick.candidates[0]!);else say({role:'agent',text:'有多个地点，说名称或第几个。'});return;}
      }
      // 契约 trace 是 strictObject：只传 turnKey/sessionId/turnIndex/projectId，多余键会被整包拒收。
      await outdoorWorkflow.handle(trimmed,clarification,undefined,readAgentDocuments(`${sessionScope}:${boundSessionId.current ?? 'local'}`),turnTrace?{turnKey:turnTrace.turnKey,sessionId:turnTrace.sessionId,turnIndex:turnTrace.turnIndex,...(turnTrace.projectId?{projectId:turnTrace.projectId}:{})}:undefined);return;
    }
    if (!attachment && isExplicitProposalConfirmation(trimmed)) {
      if(!queued)say({role:'user',text:trimmed});
      if(queued||briefRequest.current||pendingModelInputs.current.size>0||generationWait.current){
        say({role:'agent',amber:true,text:'还有请求在处理，等它结束再确认。'});return;
      }
      const memory=memoryRef.current;
      if(memory.pendingBasicFacts?.length||memory.pendingActivityNeeds.length||memory.unresolvedActivityNeeds.length||memory.layoutModeUnresolved||memory.mobilityNeedsClarification||memory.mobilityRequirement?.decision==='unknown'){
        say({role:'agent',amber:true,text:'还有需求待确认，请先核对后再确认布置。'});return;
      }
      if(phaseRef.current!=='proposed'||(!proposal.current&&!studioRef.current?.preview)){
        say({role:'agent',amber:true,text:'现在没有可确认的预览。'});return;
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
    if(isPureGreeting(trimmed)){say({role:'agent',text:'你好，说说需求就行。'});return;}
    const keepOriginals=preservationIntent(trimmed);
    if(keepOriginals){
      if(keepOriginals.keepAll){
        const requirement=captureOriginalPreservation(layoutStore.getState().layout,trimmed,keepOriginals.keepPositions);
        if(!requirement){say({role:'agent',amber:true,text:'活动还没核对，先保存并重说要求。'});return;}
        saveMemory({...memoryRef.current,originalPreservation:requirement});syncMemory(memoryRef.current);
        say({role:'agent',text:keepOriginals.keepPositions?'已记下，原有物件位置不动。':'已记下，原有物件不删。'});
      }else{
        const {originalPreservation:_removed,...rest}=memoryRef.current;
        saveMemory(rest);syncMemory(memoryRef.current);
        say({role:'agent',text:'保留要求已取消，物件不会删。'});
      }
      if(isStandalonePreservationInstruction(trimmed))return;
    }
    const unifiedConversation=process.env.NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED==='1';
    const turnHistory=queued?(queuedHistory??[]):chatUserHistory(bubblesRef.current.slice(0,-1),trimmed);
    if(!unifiedConversation && process.env.NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED==='1' && !attachment && isGeneralActivityQuestion(trimmed)) {await answerGeneralQuestion(trimmed);return;}
    const mixedUtility=hasMixedUtilityCommand(trimmed);
    if(mixedUtility)updateDialogueIncomplete(boundSessionId.current,trimmed,true);
    if (callbacks.workbenchMode !== 'layout') {
      if(mixedUtility){say({role:'agent',amber:true,text:'这句里有几项要求，先回活动对话。'});return;}
      if (isClientReviewCommand(trimmed)) {
        callbacks.onOpenReview();
        say({ role: 'agent', text: '评审页在左边打开，链接由你发。' });
        return;
      }
      if (isExportCommand(trimmed)) { proposeExport(); return; }
      if (isMaterialListCommand(trimmed)) { replyMaterialList(); return; }
      say({ role: 'agent', text: '这里只看方案，改布置要回对话。' });
      return;
    }
    if(mixedUtility)say({role:'agent',amber:true,text:'我先理解这条需求。'});
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
        else say({ role: 'agent', text: '说名称或第几个，别认错场地。' });
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
        else say({ role: 'agent', amber: true, text: '这条区域建议过期了，再说一次。' });
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
      say({ role: 'agent', amber: true, text: '想在哪做？说个场地名。' });
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
    const outdoorEventTurn = routeBridgeRef.current?.getPlan() ? parseOutdoorEventTurn(trimmed, memoryRef.current.event ?? null, outdoorKindRef.current === 'zone' && outdoorTask?.state === 'blocked') : null;
    // 2026-11-19：「人数改为 150 人，保持现有分区」里的「分区」不是要重新分区。
    // 只改人数时放回主理解链，否则会在这里被区域提案吞掉，模型和落盘都到不了。
    const headcountOnly = isHeadcountOnlyMessage(trimmed);
    if ((matchZoneCommand(trimmed) || outdoorEventTurn) && !headcountOnly) {
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
      localTurnRef.current=null;
      beginOutdoorTask('model');
      const facilities = routeBridgeRef.current.getPlan()!.facilities;
      const target = facilities.find(f => trimmed.includes(f.name))
        ?? facilities.find(f => /舞台|讲台/u.test(trimmed) && /舞台|讲台/u.test(f.name))
        ?? (facilities.length === 1 ? facilities[0] : undefined);
      if (target && routeBridgeRef.current.inspectFacility?.(target.id)) {
        setOutdoorTask({ intent: trimmed, state: 'ready', action: `已选中「${target.name}」，在属性卡查看候选、生成或上传。不会自动收费`, steps: ['确认当前户外设施'], focusFacilityId: target.id });
      } else setOutdoorTask({ intent: trimmed, state: 'blocked', action: '请先在画布选中目标设施，或告诉我它的名称。不会另起生成任务', steps: [] });
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
        if (routeBridgeRef.current?.getPlan()) { setOutdoorTask({ intent: trimmed, state: 'blocked', action: '请先选中户外设施，在同一属性卡查看候选、生成或上传。本次未另起收费任务', steps: [] }); return; }
        stageMaterialGenerate({ kind: aholo.title === '图片物件' ? 'image' : 'text', prompt: aholo.prompt });
        callbacks.onOpenMaterials();
        // 2026-11-19 审计 a1：生成结果不会回到对话里，任务号在「我的生成」。
        // 先说清楚，免得用户在对话里等一个永远不会出现的回填。
        say({ role: 'agent', text: `${step.text}提交后任务号在「我的生成」里，这里不会自动回填。` });
        return;
      }
      say({ role: 'agent', text: step.text });
      return;
    }
    // 按对象改（挪舞台/加灯/删除）走增量命令；普通「加两把椅子」仍走下面的物料请求。
    const mentionsRecolor=/(?:换成|改成|变成|换为|改为|涂成|刷成)[^，。；,;]{1,16}色|(?:涂成|刷成)/.test(trimmed.replace(/\s+/g,''));
    const safeRecolor=mentionsRecolor?parseSafeRecolor(trimmed):null;
    if(mentionsRecolor&&!safeRecolor){markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'说清物件和颜色，画布没改。'});return;}
    const mentionsRotation=/(?:旋转|转动|顺时针|逆时针|(?:把|将).{1,20}转\d)/.test(trimmed.replace(/\s+/g,''));
    const safeRotation=mentionsRotation?parseSafeRotation(trimmed):null;
    if(mentionsRotation&&!safeRotation){markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'说清物件和角度，画布没改。'});return;}
    const directionalMove = /(?:往|向|朝)(?:东|西|南|北|左|右|前|后)(?:边|侧|方)?(?:挪|移动|平移|移|搬)|(?:挪|移动|平移|移|搬)(?:到|至)?(?:东|西|南|北|左|右|前|后)/.test(trimmed.replace(/\s+/g,''));
    const safeMove = directionalMove ? parseSafeDirectionalMove(trimmed) : null;
    if (directionalMove && !safeMove && hasMixedActivityRequirements(trimmed)) {
      markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'改动和需求请分开发，这次都没执行。'}); return;
    }
    if (directionalMove && !safeMove) {
      markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'说清物件和距离，画布没改。'}); return;
    }
    const revision = safeMove ? {ops:[safeMove],bands:[]} : safeRotation ? {ops:[safeRotation],bands:[]} : safeRecolor ? {ops:[safeRecolor],bands:[]} : parseRevisionRequest(trimmed);
    if (/(?:放大|缩小|缩放|变大|变小)/.test(trimmed)) {
      const scale = revision?.ops.length === 1 && revision.ops[0]?.kind === 'scale' ? revision.ops[0] : null;
      if (!scale || /(?:不要|不用|别|勿|暂不|暂时|不确定|可能|也许|是否|待定|看情况|[?？，,；;])/.test(trimmed) ||
        (/缩小|变小/.test(trimmed) && scale.factor >= 1) || (/放大|变大/.test(trimmed) && scale.factor <= 1)) {
        markUnresolvedModification(trimmed);say({role:'agent',amber:true,text:'说清物件和倍数，画布没改。'}); return;
      }
    }
    const request = parseMaterialRequest(trimmed);
    const count = explicitAdditionCount(trimmed);
    const additionLimit = revision?.ops.some(op => op.kind === 'add') ? 20 : 50;
    if ((revision || request) && count !== null && (!Number.isSafeInteger(count) || count < 1 || count > additionLimit)) {
      markUnresolvedModification(trimmed);say({ role: 'agent', amber: true, text: `你要求添加 ${count} 件，单次支持 1 至 ${additionLimit} 件。请调整数量后重试，本次没有修改画布。` }); return;
    }
    if ((revision || request) && needsMaterialCommandClarification(trimmed, !!revision, !!request)) {
      markUnresolvedModification(trimmed);say({ role: 'agent', amber: true, text: '说要加什么，画布没改。' }); return;
    }
    if (revision) {
      if (hasMixedActivityRequirements(trimmed)) { markUnresolvedModification(trimmed);say({ role: 'agent', amber: true, text: '改动和需求请分开发，这次都没执行。' }); return; }
      reviseMaterials(revision); return;
    }
    if (request) {
      if (hasMixedActivityRequirements(trimmed)) { markUnresolvedModification(trimmed);say({ role: 'agent', amber: true, text: '改动和需求请分开发，这次都没执行。' }); return; }
      addMaterials(request); return;
    }
    const styleCmd = matchStyleBundleCommand(trimmed, window.localStorage);
    if (styleCmd === 'open') {
      setStylePickerOpen(true);
      say({ role: 'agent', text: '奶油、深木或清透，挑一套。' });
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
      say({ role: 'agent', text: '评审页在左边打开，链接由你发。' });
      return;
    }
    // 导出/交接：先出预览卡，不直接下载（T-UI §4-5）。
    if (isExportCommand(trimmed)) { proposeExport(); return; }
    }
    // 从这里开始交给模型链路：后端会按同一 turnKey 写库，本机兜底不再重复记。
    localTurnRef.current = null;
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
      const provider=studioRef.current?.activeProvider;
      const selectedModel=provider&&provider!=='default'?studioRef.current?.activeModel??null:null;
      turn = await resolveBriefTurn(trimmed, resolverMemory, {
        venueUp, scaleTyped: lengthCheck.ok && widthCheck.ok, hasBase, command,
      }, studioRef.current?.controller ?? null, activeRequest.controller.signal, unifiedConversation ? {history:turnHistory} : undefined, provider&&provider!=='default'?provider:undefined, selectedModel, turnTrace ? {turnKey:turnTrace.turnKey,sessionId:turnTrace.sessionId,turnIndex:turnTrace.turnIndex,...(turnTrace.projectId?{projectId:turnTrace.projectId}:{})} : undefined);
      if(turn.modelNotice?.includes('可能仍会计费'))uncertainInputs.current.add(trimmed);
      if(briefRequest.current===activeRequest){briefRequest.current=null;setUnderstanding(false);}
    } catch (error) { setProcessFailed('understanding'); releaseTurn(); if(activeRequest.controller.signal.aborted)return;throw error; }
    if (!sessionScopeIsCurrent() || boundSessionId.current !== turnSessionId || briefTurnSequence.current !== turnSequence) { releaseTurn(); return; }
    // 模型没参与或没接住时，用户看到的是本地/兜底回复：按同一 turnKey 补上可见答复。
    if (turnTrace && turn.resolution !== 'model') {
      recordConversationTurn(studioRef.current?.controller as unknown as ConversationTraceTransport | undefined, {
        turnKey: turnTrace.turnKey, sessionId: turnTrace.sessionId, turnIndex: turnTrace.turnIndex,
        surface: 'brief', userText: turnTrace.userText,
        ...(turn.text ? { assistantText: turn.text } : {}),
        outcome: turn.resolution === 'local_command' || turn.resolution === 'confirmation' ? 'local_only' : 'answered',
        latencyMs: Date.now() - turnTrace.startedAt,
      });
    }
    const outcome=resolvedTurnOutcome(turn,previousMemory,mixedUtility,trimmed);
    if(outcome.kind==='failed')setProcessFailed('understanding');
    const incompleteUpdate=incompleteUpdateForOutcome(outcome);
    const unhandledRequirement=turn.unhandled?.some(item=>(item.kind==='action'||item.kind==='other')&&!!item.evidence&&trimmed.includes(item.evidence))??false;
    if(incompleteUpdate==='mark')updateDialogueIncomplete(turnSessionId,trimmed,true,unhandledRequirement);
    if(unifiedConversation&&unhandledRequirement&&(phaseRef.current==='proposed'||phaseRef.current==='paused')){
      dropProposal();discardCloudPreview();phaseRef.current='idle';setPhase('idle');setProgress(0);
      say({role:'agent',amber:true,text:'这项没执行，预览收回了。'});
    }
    if(turn.readOnlyReply){
      // 模型已作答的纯提问不再挂「尚未执行」黄条：回答本身就是处理结果；
      // 只有夹带动作/其他未执行项时才提醒。
      const allQuestionsAnswered=!!turn.text&&!!turn.unhandled?.length&&turn.unhandled.every(item=>item.kind==='question');
      if(turn.unhandled?.length&&!allQuestionsAnswered&&!sofaOnlyUnhandled(turn,trimmed))say({role:'agent',amber:true,text:`以下内容尚未执行或仍需核对：${turn.unhandled.map(item=>`「${item.evidence}」`).join('、')}。`});
      say({role:'agent',text:turn.text,modelConversation:true,...(turn.materialQueries?.length?{materialQueries:turn.materialQueries}:{})});releaseTurn();return;
    }
    if (sessionScope !== 'legacy' && (turnVenueBasis !== venueScaleBasis(layoutStore.getState().layout) || !venueFacts.isCurrent(turnVenueFact))) {
      say({role:'agent',amber:true,text:'场地变了，再说一次尺寸。'});releaseTurn();return;
    }
    const scaleRestated = (turn.extraction.lengthM !== null && turn.extraction.widthM !== null) || turn.extraction.areaM2 !== null;
    const scalePending = turn.memory.pendingBasicFacts?.some(fact=>fact.key==='lengthM'||fact.key==='widthM'||fact.key==='areaM2');
    let sourceProof: {scope:string;digest:string}|undefined;
    if(sessionScope !== 'legacy' && scaleRestated && !scalePending && sourceAuthorityRequired.current && !confirmVenueSourceRef.current){
      say({role:'agent',amber:true,text:'场地来源没核对上，需求没改。'});releaseTurn();return;
    }
    if(sessionScope !== 'legacy' && scaleRestated && !scalePending && confirmVenueSourceRef.current){
      const sourceRevision=zoneDraftRevisionRef.current, authority=confirmVenueSourceRef.current, rawSourceScope=layoutStore.getState().layout.id;
      if(!rawSourceScope){say({role:'agent',amber:true,text:'先保存活动，再说尺寸。'});releaseTurn();return;}
      let sourceTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const observed=await Promise.race([authority(rawSourceScope),new Promise<never>((_,reject)=>{sourceTimeout=setTimeout(()=>reject(new Error('来源核对超时')),12000);})]);
        if (!sessionScopeIsCurrent() || boundSessionId.current !== turnSessionId || briefTurnSequence.current !== turnSequence ||
            turnVenueBasis !== venueScaleBasis(layoutStore.getState().layout) || !venueFacts.isCurrent(turnVenueFact) || layoutStore.getState().layout.id !== rawSourceScope || sourceRevision !== zoneDraftRevisionRef.current || authority !== confirmVenueSourceRef.current) { releaseTurn(); return; }
        if(observed.status!=='observed' || observed.scope!==rawSourceScope || !/^[0-9a-f]{64}$/i.test(observed.digest)) {
          say({role:'agent',amber:true,text:'场地来源没核对上，需求没改。'});releaseTurn();return;
        }
        sourceProof={scope:observed.scope,digest:observed.digest};
      } catch {
        if(sessionScopeIsCurrent() && boundSessionId.current===turnSessionId && briefTurnSequence.current===turnSequence)
          say({role:'agent',amber:true,text:'场地来源没核对上，需求没改。'});
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
      // 失败卡带一个可抄的编号：同一编号跟着重试走，事后能按它对账（M1a）。
      const view = describeModelFailure(turn.modelNotice);
      setModelFailure({ text: view.text, hint: view.hint, diag: view.diag, retry: () => { if (!briefRequest.current) void send(retryText); } });
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
    if(sofaAsk&&turn.kind==='generate'){say({role:'agent',text:'沙发排不了，选圆桌或课桌椅。'});return;}
    if(turn.unhandled?.length&&!sofaAsk){say({role:'agent',amber:true,text:`以下内容尚未执行或仍需核对：${turn.unhandled.map(item=>`「${item.evidence}」`).join('、')}。`});if(turn.kind==='generate')return;}
    if(mixedUtility){say({role:'agent',text:turn.text||'活动需求已记录，请核对。其他操作尚未执行。',...(turn.usesModelText?{modelConversation:true}:{}),...(turn.usesModelText&&turn.materialQueries?.length?{materialQueries:turn.materialQueries}:turn.usesModelText&&mentionedNewMaterial?{action:{label:'查看物料库',run:callbacks.onOpenMaterials}}:{})});return;}
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
                    say({ role: 'agent', amber: true, text: '场地变了，这条建议过期了。' });
                    return;
                  }
                  const zones = extractProposedZoneTypes(turn.text).filter((zone) => (zone !== 'checkin' && zone !== 'rest') || memoryRef.current.zoneNeeds[zone] !== false);
                  const labels = onApplyZoneRects?.(zones) ?? null;
                  if (labels) { proposalConsumed = true; say({ role: 'agent', text: `已经在 2D 上圈好${labels}，去画布看一眼？` }); }
                  else say({ role: 'agent', amber: true, text: '没圈出区域，重新生成一次。' });
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
        say({ role: 'agent', amber: true, text: '云端还在处理，先别确认。' });
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
    if(text.trim()||(queued?queuedAttachment:pendingFiles[0])){
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
    sessionScope, isSessionCurrent: sessionScopeIsCurrent, historyReviewRequired,reviewDialogueHistory,acceptFreshSession,resendEditedLast,retainedOtherSessionProposal:!!proposal.current&&proposalSessionRef.current!==boundSessionId.current,withdrawRetainedOtherSessionProposal:()=>{if(proposal.current&&proposalSessionRef.current!==boundSessionId.current){dropProposal();setPhase('idle');say({role:'agent',text:'已撤回其他会话中未确认的旧方案。'});}},unresolvedDialogue,hasUnresolvedDialogue:(id:string)=>(incompleteDialogueTurns.current.get(id)?.size??0)>0,withdrawUnresolvedDialogue,withdrawAllUnresolved,briefBusy,toolPending,processFailed,understanding, generationQueued, isUnderstanding:(text)=>text===undefined ? briefRequest.current!==null : pendingModelInputs.current.has(text.trim()),
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
    startStylePicker: () => { if(routeBridgeRef.current?.applyPlan)outdoorWorkflow.cancel();setStylePickerOpen(true); setMapPickerOpen(false); setVenuePickerOpen(false); },
    closeStylePicker: () => setStylePickerOpen(false),
    placeStyleBundle: placeStyleBundleNow,
    applyMapVenuePick: applyVenuePick,
    venuePick,
    handleVenuePick: place => { void handleVenuePick(place); },
    previewVenueCandidate: place => { routeBridgeRef.current?.previewVenuePoint?.(place); },
    dismissVenuePick: stopOutdoorTask,
    outdoorTask,
    manualOutdoorVenueApplied: anchor => {
      if(routeBridgeRef.current?.applyPlan){manualVenueAnchorRef.current=undefined;outdoorWorkflow.manualApplied();return;}
      const pending = manualVenueAnchorRef.current;
      if (!pending || pending.lng !== anchor.lng || pending.lat !== anchor.lat) return;
      manualVenueAnchorRef.current = undefined;
      setOutdoorTask({ intent: '手动确认真实场地', state: 'done', action: '手画边界已闭合并写入同一份规划。2D/3D 同步，可撤销', steps: ['地点已确认', '手画闭合并通过边界校验', '提交锚点与边界'], prompts: ['排一下流线'] });
    },
    manualOutdoorVenueCanceled: () => {
      manualVenueAnchorRef.current = undefined;
      if(routeBridgeRef.current?.applyPlan){outdoorWorkflow.manualCanceled();return;}
      setOutdoorTask({ intent: '确认场地', state: 'ready', action: '已取消这次画线。未写入活动范围。', steps: [] });
    },
    inspectOutdoorFacility: id => { if (!routeBridgeRef.current?.inspectFacility?.(id)) setOutdoorTask(current => current ? { ...current, state: 'blocked', action: '该设施已不在当前户外方案，请重新选择画布中的设施', focusFacilityId: undefined } : null); },
    applyOutdoorWorkers: workers => routeBridgeRef.current?.applyWorkers?.(workers) ?? false,
    sayDecisionBadge: (decision, text) => { say({ role: 'agent', decision, text }); },
    applyOutdoorMeasurements: measurements => routeBridgeRef.current?.applyMeasurements?.(measurements) ?? false,
    applyOutdoorAnnotations: annotations => routeBridgeRef.current?.applyAnnotations?.(annotations) ?? false,
    getOutdoorLevels: () => routeBridgeRef.current?.getLevels?.() ?? [],
    setOutdoorLevel: levelId => routeBridgeRef.current?.setActiveLevel?.(levelId) ?? false,
    addOutdoorFacility: facility => routeBridgeRef.current?.addFacility?.(facility) ?? false,
    removeOutdoorFacility: id => routeBridgeRef.current?.removeFacility?.(id) ?? false,
    updateOutdoorFacility: (id, patch) => routeBridgeRef.current?.updateFacility?.(id, patch) ?? false,
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
    outdoorWorkflow,outdoorBridgeReady,searchOutdoorVenue,
    registerRouteBridge: bridge => { const before=Boolean(routeBridgeRef.current?.applyPlan);routeBridgeRef.current = bridge;const after=Boolean(bridge?.applyPlan);if(before!==after)setOutdoorBridgeReady(after);outdoorWorkflow.reconcileCanvasStage(); },
    exportPreview, previewExport: proposeExport, confirmExport, confirmCloudMaterialDraft, dismissExport, reviewNow, issueReviewLink,
    acceptFile: file => { void acceptFile(file); }, retryFile: () => { if (lastFile.current) void acceptFile(lastFile.current); },
    // 浮窗里「图片 / 文件」各自限定 accept；不传时回到全量白名单（老入口行为不变）。
    pickFile: (accept?: string) => { const input = fileInput.current; if (!input) return; input.accept = accept ?? DEFAULT_FILE_ACCEPT; input.click(); },
    venueResearch: readVenueResearch(`${sessionScope}:${boundSessionId.current ?? 'local'}`),
    documents: readAgentDocuments(`${sessionScope}:${boundSessionId.current ?? 'local'}`),
    pendingFiles: pendingFiles.map(({ file, url }) => ({ name: file.name, url })),
    removePendingImage: index => setPendingFiles(list => list.filter((_, i) => i !== index)),
    send, say, rainOn: view.weather === 'rain', streamPreview,
    previewRain: () => setView(current => ({ ...current, weather: 'rain', view2D: false })),
    walkthrough: () => {
      setView(current => ({ ...current, walkthroughMode: true, view2D: false, measurementMode: false, drawWallMode: false }));
      requestWalkPointerLock();
    },
  };
  return <AgentContext.Provider value={value}>
    {children}
    <input ref={fileInput} type="file" hidden aria-hidden="true" tabIndex={-1} accept={DEFAULT_FILE_ACCEPT} multiple onChange={event => {
      const picks=Array.from(event.target.files??[]); event.target.value = '';
      const images=picks.filter(file=>classifyFile(file)==='image');
      const room=Math.max(0, MAX_PENDING_IMAGES-pendingFiles.length);
      if(images.length>room) say({role:'agent',amber:true,text:`现场截图最多 ${MAX_PENDING_IMAGES} 张，这次多选的 ${images.length-room} 个没有加进来。`});
      // 非图片仍走原来的图纸/文件入口，不吃图片的名额。
      for(const file of picks.filter(file=>classifyFile(file)!=='image')){ if (phaseRef.current !== 'generating') void stageFile(file); }
      for(const file of images.slice(0, room)){ if (phaseRef.current !== 'generating') void stageFile(file); }
    }}/>
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
      data-tip="地图" title={agent.venueUp ? '重新圈一块会替换现在的场地' : '圈场地：搜地点 → 卫星图圈边界'} onClick={agent.startMapVenuePicker}><MapIcon size={24} aria-hidden="true"/></button>
  </nav>;
}

const CAPABILITY_PANEL_OPEN_KEY = 'sc.ap-capabilities-open';

/**
 * 输入框上方只有一格建议：收起是例句行，展开在同一格换成两张能力卡（不另留折叠行）。
 * 展开的选择记在本机，之后保持常驻；首帧与 SSR 一致，读本机选择放在渲染后。
 */
function AgentSuggestionSlot({ open, onToggle, showExample, onPickExample, onPrefill, placeFirst }: {
  open: boolean;
  onToggle(): void;
  /** 收起态只有例句行，且只在空会话/空闲时出现。 */
  showExample: boolean;
  onPickExample(sentence: string): void;
  onPrefill(text: string): void;
  /** 地图优先：地点未定时，例句与能力卡都只给选址入口。 */
  placeFirst: boolean;
}): JSX.Element | null {
  if (!open && !showExample) return null;
  return (
    <div id="ap-capabilities" className={`ap-suggestion-slot${open ? ' is-open' : ''}`}>
      {open ? <>
        <div id="ap-capability-cards" className="ap-suggestion-cards">
          <CapabilitySuggestionCards onPrefill={onPrefill} placeFirst={placeFirst}/>
        </div>
        <button type="button" className="ap-suggestion-toggle" aria-expanded="true" aria-controls="ap-capability-cards"
          aria-label="收起你可以做什么" title="收起能力卡" onClick={onToggle}>
          <ChevronDown size={14} aria-hidden="true" className="ap-suggestion-chevron is-open"/>
        </button>
      </> : <AgentTaskExamples onPick={onPickExample} onExpand={onToggle}/>}
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
  // 项目面板的「新方案」从这里接管：cancelable 事件被 preventDefault 表示工作台有场地入口。
  useEffect(() => {
    const start = (event: Event) => { event.preventDefault(); agent.startVenuePicker(); };
    window.addEventListener('scendance:start-new-project', start);
    return () => window.removeEventListener('scendance:start-new-project', start);
  }, [agent]);
  // /projects 管理页的「新建项目」用 ?new=1 回到画布并直接开场地选择。
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    agent.startVenuePicker();
  }, [agent]);
  if (!agent.venuePickerOpen) return null;
  return <div className="sc-venue-overlay" ref={panel} role="dialog" aria-modal="true" aria-label="换场地 / 新建" tabIndex={-1}>
    <div className="sc-map-head">
      <strong>换场地 / 新建</strong>
      <span className="sc-note">空白选址先进 2D 规划，再画边界。</span>
      <button type="button" className="sc-button" aria-label="关闭" data-tip="关闭" title="关闭" onClick={agent.closeVenuePicker}><X size={16} aria-hidden="true"/></button>
    </div>
    <VenuePicker onClose={agent.closeVenuePicker} />
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

/** 决策留痕类型随提案卡搬到 ./agent-proposal-card；面板 useState 经此导入。 */
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

/**
 * 加号（上传图片/资料）：和麦克风同一套**线性**图标。
 * 原来这里是一颗实心 Material ⓘ（灰圆盘），跟旁边的线条图标不是一个语言。
 */
function PlusLineIcon({ size = 16, 'aria-hidden': ariaHidden }: { size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/** 加号浮窗里的两项：图片 / 文件，仍是同一套线条。 */
function ImageLineIcon({ size = 16, 'aria-hidden': ariaHidden }: { size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17.5 9.8 12l4.2 4.2 2.6-2.4L20 17.6" />
    </svg>
  );
}

function FileLineIcon({ size = 16, 'aria-hidden': ariaHidden }: { size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
      <path d="M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.5V8h4.5" />
    </svg>
  );
}

/** 附件白名单：图片 + 图纸/PDF。加号浮窗会按「图片 / 文件」临时收窄，取消选择后回到这份全量。 */
const DEFAULT_FILE_ACCEPT = `image/png,image/jpeg,image/webp,${AGENT_DOCUMENT_ACCEPT},.dxf,.dwg`;

/** 现场截图一次最多 10 张：与边缘 images schema 的上限一致，前端不多收。 */
const MAX_PENDING_IMAGES = 10;
/** 10 张图按 data URL 长度合计的预算（边缘总闸 4M 字符，这里留 100K 余量）。 */
const VISION_PAYLOAD_BUDGET = 3_900_000;

/** 只送预算内的图：超出部分按顺序留在输入框，不静默丢弃（调用方负责如实说明张数）。 */
function visionImagesWithinBudget(urls: string[]): { images: string[]; skipped: number } {
  const images: string[] = []; let total = 0; let skipped = 0;
  for (const url of urls) {
    if (!url.startsWith('data:image/')) continue;
    if (total + url.length > VISION_PAYLOAD_BUDGET) { skipped++; continue; }
    total += url.length; images.push(url);
  }
  return { images, skipped };
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

/** 状态头小计时器（对标谷地工坊「施工中 0:XX」）：1s 心跳自走，卸载即停。 */
function HeadRunClock({ startedAt }: { startedAt: number }): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="ap-head-clock">{formatDurationClock(Date.now() - startedAt)}</span>;
}

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
  // 请求级模型槽位：可选项来自服务端 capabilities；状态在 StudioContext 内会话内存共享。
  // 2026-11-14 用户指令：槽位列表并进 composer 的「智能」菜单；底部独立槽位栏拆除。
  const providerSlots = studio?.chatProviders?.providers ?? null;
  const activeProviderId = studio?.activeProvider ?? 'default';
  const activeProviderSlot = providerSlots?.find(p => p.id === activeProviderId) ?? null;
  const activeModelId = studio?.activeModel ?? null;
  const activeModelOption = activeProviderSlot?.models?.find(option => option.model === activeModelId) ?? null;
  const summaryLabel = activeModelOption ? `${activeProviderSlot?.label ?? ''} · ${activeModelOption.label}` : (activeProviderSlot?.label ?? '默认');
  // 模型槽位浮层：堆栈矮卡里面板自身 overflow:hidden 会裁掉上弹菜单，因此挂到 body 层定位。
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const providerAnchorRef = useRef<HTMLButtonElement>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const assistantSessions = useAssistantSessions(agent.assertSessionWrite, agent.sessionScope);
  const [showHistory, setShowHistory] = useState(false);
  // 空间卡与物料卡：第一次点到才挂，之后常驻、只切显隐。既不在打开面板时就预取，
  // 也不会「切去空间再切回物料」时整块重建（那会让缩略图全部回到 ◇ 等加载）。
  const visitedLanes = useRef<Set<AgentId>>(new Set([activeAgent]));
  visitedLanes.current.add(activeAgent);
  // 「你可以做什么」的展开状态提到面板这一层：展开时顶掉上方的例句行，两处建议不并排。
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  // 渲染后再读本机选择：首帧与 SSR 一致，避免水合不一致。
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CAPABILITY_PANEL_OPEN_KEY) === '1') setCapabilitiesOpen(true);
    } catch { /* 读不到就保持收起 */ }
  }, []);
  const toggleCapabilities = () => {
    const next = !capabilitiesOpen;
    setCapabilitiesOpen(next);
    try { window.localStorage.setItem(CAPABILITY_PANEL_OPEN_KEY, next ? '1' : '0'); } catch { /* 存不住就只在本会话生效 */ }
  };
  // 候选卡决策留痕：只在本机这一轮内存里，刷新/换会话即清，不写后端。
  const [proposalDecision, setProposalDecision] = useState<ProposalDecision | null>(null);
  const { layout, activeFloor, actions: layoutActions } = useRoomEditor();
  const mode = agent.callbacks.workbenchMode;
  const draftKey=JSON.stringify([agent.sessionScope,assistantSessions.activeId]);
  const [draftState,setDraftState]=useState(()=>({key:draftKey,value:volatileComposerDrafts.get(draftKey)??''}));
  /* 动作行上的两枚浮窗（模型位 / 加号）共用一个「当前打开的是谁」，同时只开一个。
     模型位「智能」菜单里列服务端下发的真实模型槽位（2026-11-14 用户指令）。 */
  const [openMenu,setOpenMenu]=useState<'model'|'add'|null>(null);
  const menuRowRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    if(!openMenu) return;
    const onDown=(event:PointerEvent)=>{ if(!menuRowRef.current?.contains(event.target as Node)) setOpenMenu(null); };
    const onKey=(event:KeyboardEvent)=>{ if(event.key==='Escape') setOpenMenu(null); };
    document.addEventListener('pointerdown',onDown,true);
    document.addEventListener('keydown',onKey);
    return ()=>{ document.removeEventListener('pointerdown',onDown,true); document.removeEventListener('keydown',onKey); };
  },[openMenu]);
  // 浮层定位：默认向上贴着锚点；上方空间不足或向下更宽裕时改为向下。关闭时不占用定位。
  const providerMenuStyle = useMemo<CSSProperties>(() => {
    if (!providerMenuOpen) return {};
    const anchor = providerAnchorRef.current?.getBoundingClientRect();
    if (!anchor || (anchor.width === 0 && anchor.height === 0)) return {};
    const menuW = 266; const gap = 6; const estH = 232;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - menuW - 8));
    const above = anchor.top - gap >= estH || anchor.bottom + estH > window.innerHeight - 8;
    return {
      position: 'fixed',
      left,
      width: menuW,
      ...(above ? { bottom: window.innerHeight - anchor.top + gap } : { top: anchor.bottom + gap }),
    };
  }, [providerMenuOpen]);
  // 点击浮层外部 / Esc / 滚动或缩放时收起。
  useEffect(() => {
    if (!providerMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (providerAnchorRef.current?.contains(target) || providerMenuRef.current?.contains(target))) return;
      setProviderMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setProviderMenuOpen(false); };
    const onDismiss = () => setProviderMenuOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  }, [providerMenuOpen]);
  const draft=draftState.key===draftKey ? draftState.value : volatileComposerDrafts.get(draftKey)??'';
// 2026-11-21 docs/50 I1-lite：户外任务运行中的排队发送（PetitMaker「为下一步添加备注」同款体验）。
const [outdoorSendQueue, setOutdoorSendQueue] = useState<string[]>([]);
const outdoorSendQueueRef = useRef<string[]>([]);
outdoorSendQueueRef.current = outdoorSendQueue;
  const setDraft=(value:string)=>{ if(value)volatileComposerDrafts.set(draftKey,value);else volatileComposerDrafts.delete(draftKey);setDraftState({key:draftKey,value}); };
  // 2026-11-14 用户指令：历史整层接管对话区时，输入框里直接回车 = 在当前项目开一个新会话，
  // 并把这句话发进新会话（对齐 VS Code chat）。openSession 的绑定在 provider effect 里完成，
  // 同一次事件里 send 仍会落到旧会话——所以先记账，等 canForward 为真（绑定完成）再补发。
  const pendingFreshSendRef = useRef<{ text: string } | null>(null);
  const submitComposer = (): void => {
    // 2026-11-18：登录卡只拦模型类需求；白名单内的确定性本地命令照发（与 composerEnabled 同口径）。
    // composer 作用域拿不到原始 memory，priorEvent 传 null：锁定态下要求句子自带活动类型+人数。
    if (loginBlocked && !matchesLocalOutdoorCommand(draft.trim(), null)) return;
    if (!agent.isSessionCurrent() || agent.isUnderstanding(draft)) return;
    // 云端布局运行中：Enter 不是新指令，是「为下一步添加备注」——塞进运行账本，
    // 由工作线程在下一轮思考前取走（creative-studio deliverSteerNotes）。可撤回。
  if (runState.scope === 'layout' && runState.isRunning) {
    if (!draft.trim()) return;
    pushAgentSteerNote(draft);
    setDraft('');
    inputRef.current?.focus();
    return;
  }
  // 2026-11-21 docs/50 I1-lite（PetitMaker 同款）：户外任务运行中回车不是新指令也不是吞掉，
  // 是排队——任务结束后自动按顺序发出。此前 busy 中发送会并发第二个 job 把前一个 abort 掉。
  if (agent.outdoorWorkflow.busy) {
    if (!draft.trim()) return;
    setOutdoorSendQueue((queue) => [...queue, draft]);
    setDraft('');
    inputRef.current?.focus();
    return;
  }
    if (draft.trim() && showHistory) {
      const created = assistantSessions.openSession();
      if (created?.verifiedFresh) agent.acceptFreshSession(created.id);
      setShowHistory(false);
      pendingFreshSendRef.current = { text: draft };
      setDraft('');
      inputRef.current?.focus();
      return;
    }
    void agent.send(draft);
    setDraft('');
  };
  useEffect(() => {
    const pending = pendingFreshSendRef.current;
    if (!pending) return;
    if (!agent.canForward(pending.text)) {
      // 活动已切换等异常：放弃补发，避免把话发进不可核对的会话。
      if (!agent.isSessionCurrent()) pendingFreshSendRef.current = null;
      return;
    }
  pendingFreshSendRef.current = null;
  void agent.send(pending.text);
}, [agent]);
// 2026-11-21 docs/50 I1-lite：户外任务结束后自动按序发出排队指令（600ms 轮询，任务不忙才发）。
useEffect(() => {
  if (!outdoorSendQueue.length) return undefined;
  const timer = setInterval(() => {
    if (agent.outdoorWorkflow.busy || agent.understanding || loginBlocked || !agent.isSessionCurrent()) return;
    const first = outdoorSendQueueRef.current[0];
    if (!first) return;
    outdoorSendQueueRef.current = outdoorSendQueueRef.current.slice(1);
    setOutdoorSendQueue(outdoorSendQueueRef.current);
    void agent.send(first);
  }, 600);
  return () => clearInterval(timer);
}, [outdoorSendQueue.length, agent]);
  // 2026-11-14 用户指令：历史列表四态——已读(无点)/错误(红点)/未读(蓝点)/进行中(绿点)。
  // 未读=本机 seen 时间戳晚于会话最后更新；切走的会话补记 seen，避免自己刚看过的内容亮蓝。
  const resolveSessionStatus = (session: { id: string; updatedAt: number }): SessionStatus => {
    if (session.id === assistantSessions.activeId) {
      if (agent.state === 'generating' || agent.briefBusy || agent.understanding || agent.generationQueued > 0) return 'active';
      if (agent.failed) return 'error';
      return 'idle';
    }
    if (agent.hasUnresolvedDialogue(session.id)) return 'error';
    if (sessionUnreadSince(session.id, session.updatedAt)) return 'unread';
    return 'idle';
  };
  const lastActiveForSeenRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastActiveForSeenRef.current;
    lastActiveForSeenRef.current = assistantSessions.activeId;
    if (prev && prev !== assistantSessions.activeId) markSessionSeen(prev);
  }, [assistantSessions.activeId]);
  const restoredCancellation=useRef<number|null>(null);
  useEffect(()=>{const cancelled=agent.cancelledInput;if(!cancelled||restoredCancellation.current===cancelled.id)return;restoredCancellation.current=cancelled.id;if(!draft.trim())setDraft(cancelled.text);},[agent.cancelledInput]);
  // 语音转文字：点一下开始拾音、再点停止；识别稿并入现有 draft，不覆盖已有内容。
  // 2026-11-21 修正：interimResults 开着时每个中间态都会触发 onresult，此前逐条 append
  // 会把草稿拼成「我 我想 我想举…」的全量中间态（对话留痕实证）；改为拾音起步时记下
  // 基稿，之后每次用「基稿 + 当前识别稿（final + 未定稿）」整体替换。
  const speechBaseRef = useRef('');
  const toggleMic = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (recognitionRef.current) { recognitionRef.current.stop(); return; }
    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    speechBaseRef.current = volatileComposerDrafts.get(draftKey) ?? '';
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = 0; i < event.results.length; i++) {
        const alt = event.results[i][0];
        if (!alt?.transcript) continue;
        if (event.results[i].isFinal) finalText += alt.transcript;
        else interimText += alt.transcript;
      }
      const spoken = `${finalText.trim()}${finalText.trim() && interimText.trim() ? ' ' : ''}${interimText.trim()}`.trim();
      const base = speechBaseRef.current.trim();
      if (!spoken && !base) return;
      setDraft(spoken ? (base ? `${base} ${spoken}` : spoken) : base);
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
  /** 对话流挂载重试计数：feed 晚于本 effect 挂载（conversation 后切过来）时触发重连观察器。 */
  const [feedPinnedTick, setFeedPinnedTick] = useState(0);
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
  // 第 8 批：真实运行账本（云端 AgentRun 写进来的真步骤/真轮数）。
  const runState = useAgentRun();
  // 「还原到本轮开始」：云端布局开跑瞬间快照整盘 RoomLayout，收尾卡一键写回。
  // 还原本身走 applyLayout → 会进编辑器撤销栈，Ctrl+Z 能撤掉这次还原，不另设栈。
  const runStartLayoutRef = useRef<RoomLayout | null>(null);
  const cloudRunWasRunningRef = useRef(false);
  const cloudRunRunning = runState.scope === 'layout' && runState.isRunning;
  useEffect(() => {
    const was = cloudRunWasRunningRef.current;
    cloudRunWasRunningRef.current = cloudRunRunning;
    if (!was && cloudRunRunning) runStartLayoutRef.current = layout;
  }, [cloudRunRunning, layout]);
  const items = materialCount(activeFloor.items);
  // 空会话要让人先看见顶上那句指路，别一进来就滚到底。
  useEffect(() => {
    if (agent.bubbles.length === 0 && mode === 'layout') return;
    feed.current?.scrollTo?.({ top: feed.current.scrollHeight });
  }, [agent.bubbles.length, agent.state, mode]);
  // 2026-11-18 用户实测：分屏拖比例、卡片展开、步骤追加之后，对话区停在旧位置，要从头翻。
  // 会话永远锚定最新消息：容器或内容高度一变就钉回底部（气泡变化那条 effect 之外的兜底）。
  // feed 只在 conversation 态挂载，这里用 ref 是否挂上做门，不必引 conversation 本身。
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    const attach = () => {
      const el = feed.current;
      if (!el) return false;
      const pin = () => { el.scrollTo?.({ top: el.scrollHeight }); };
      pin();
      const resize = new ResizeObserver(pin);
      resize.observe(el);
      for (const child of Array.from(el.children)) resize.observe(child);
      // 子节点增删（卡片/气泡挂载卸载）后重新跟踪新的内容元素。
      const mutation = new MutationObserver(() => {
        resize.disconnect();
        resize.observe(el);
        for (const child of Array.from(el.children)) resize.observe(child);
      });
      mutation.observe(el, { childList: true });
      ro = resize;
      mo = mutation;
      return true;
    };
    if (!attach()) {
      // 挂载早于 feed 渲染（conversation 还没切过来）：下一帧再试一次。
      const raf = requestAnimationFrame(() => { if (!attach()) setFeedPinnedTick(value => value + 1); });
      return () => cancelAnimationFrame(raf);
    }
    return () => { ro?.disconnect(); mo?.disconnect(); };
  }, [mode, feedPinnedTick]);
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
  const traceRows = runState.scope === 'layout' && runState.eventLog.length > 0
    ? []
    : toolTraceRows({ isRunning: runState.isRunning, events: runState.eventLog, steps: runState.stepLog });
  // T1-c：ToolCallTrace 是唯一的「当前执行状态」；它出现时卡内阶段图注让位，
  // 任务卡的 working/done/stopped 也收进默认收起的「任务过程」，只保留可操作子卡与停止钮。
  const traceActive = mode === 'layout' && Boolean(processText || agent.streamPreview || traceRows.some(row => row.status === 'running'));
  const outdoorTaskHistorical = Boolean(traceActive && agent.outdoorTask && ['working', 'done', 'stopped'].includes(agent.outdoorTask.state));
  // 每格只说它自己那一层的事：活动、Bingo、空间、物料共用同一份配置。
  // 地图优先：地址没定就只给选址句，不给无地点的设计句；定完地点再回到活动/布置句。
  const placePending = placeStillPending({ hasOutdoorPlan: agent.outdoorBridgeReady, stage: agent.outdoorWorkflow.state.stage, venueUp: agent.venueUp });
  // 登录卡已经说明原因时，输入框不再收消息：避免发出去被吞、卡片停在「正在处理」。
  // 2026-11-18 M4 离线切片：白名单内的确定性本地命令（分区/活动句/流线，零模型零云端写入）
  // 不再被登录门锁死——未登录也能发、也能出预览；非白名单句子仍保持锁定。
  const loginBlocked = agent.outdoorWorkflow.loginRequired && !agent.outdoorWorkflow.loginSatisfied;
  const loginLocalCommand = loginBlocked && matchesLocalOutdoorCommand(draft.trim(), null);
  const composerEnabled = !loginBlocked || loginLocalCommand;
  const suggestion = useSuggestion(placePending ? PLACE_INPUT_SUGGESTIONS : activeAgent === 'door' && agent.banquetChat ? BANQUET_INPUT_SUGGESTIONS : AGENT_INPUT_SUGGESTIONS[activeAgent]);
  // 2026-11-20 用户：执行权限是常驻设置，不是一行裸文字——折行标题要自己说出当前档位。
  const supervisionLevel = useAgentSupervision();
  // 引导层与 placeholder 只能出现一个，否则两层灰字会叠在一起。
  // 待确认 / 暂停 / 圈选态让位给状态专属 placeholder，不再打例句。
  const proposed = agent.state === 'planProposed';
  const paused = agent.state === 'generatePaused';
  const planShown = agent.state === 'planReady' || agent.state === 'planEdited';
  const ghostVisible = !agent.outdoorBridgeReady && !loginBlocked && mode === 'layout' && !draft.trim() && !generating && !proposed && !paused && !agent.mapPickerOpen;
  // 输入框 placeholder 随状态五套切换；review/delivery/banquet 既有分支保留在后。
  const composerPlaceholder = loginBlocked && !loginLocalCommand ? loginBlockedPlaceholder({ rangeConfirmed: agent.outdoorWorkflow.scopeConfirmed() })
    : agent.outdoorBridgeReady ? (agent.outdoorWorkflow.pendingPlan?'可以批准计划，或补充新的要求':agent.outdoorWorkflow.proposal?'可直接确认、补充要求或修改这版预览':agent.outdoorWorkflow.busy?'为下一步添加备注（当前任务结束后自动发送）':agent.outdoorWorkflow.state.stage==='place'?'例如：先找杭州 IN77，核对可用范围':agent.outdoorWorkflow.state.stage==='objects'?'告诉我各区所需设施与数量，也可先查我的物料库':agent.outdoorWorkflow.state.stage==='people'?'例如：展览区 2 名保安，表演区 3 名工作人员':agent.outdoorWorkflow.state.stage==='refine-3d'?'选中或说出设施：调整、换模型、原位上传/生成':'继续说明当前分区、入口/通道的实际情况或变更要求') : agent.mapPickerOpen
    ? '请在地图上圈选范围'
    : placePending ? '先说地点：城市、场馆或地址'
    : generating ? '为下一步添加备注'
    : proposed ? '或用文字回答'
    : paused ? '补充说明后继续'
    : planShown ? '说一句想调整的，比如「舞台往左挪两米」'
    : mode === 'review' ? '说一句，比如「准备客户评审」'
    : mode === 'delivery' ? '说一句，比如「导出给搭建方」'
    : agent.banquetChat ? '说一句，比如「加座，再排一版」'
    : '说一句，比如「45 人讲座，入口在东侧」';
  // 发送键双态：空且无附件 → 麦克风；有字（或带附件）→ 箭头。理解中禁用，既有闸门不动。
  const hasDraft = draft.trim().length > 0;
  const canSend = composerEnabled && !agent.isUnderstanding(draft) && (hasDraft || agent.pendingFiles.length>0);
  const showMic = !hasDraft && !agent.pendingFiles.length;
  const preStates = !generating && !proposed && !paused && !planShown && agent.state !== 'generateFailed';
  // 回看不编数字：人没说人数就不写「0 人」。读数只算一次，回显卡和落盘那行共用。
  const recap = [agent.recap.event, agent.recap.guests, agent.recap.dims].filter(Boolean).join(' · ');
  const sessionTitle = assistantSessions.activeSession?.title ?? ASSISTANT_SESSION_DEFAULT_TITLE;
  const meta = AGENT_META[activeAgent];
  const bingo = activeAgent === 'bingo';
  // 内部 id 仍是 'door'：这里用语义别名，S4 再做标识符级重命名。
  const activity = activeAgent === 'door';
  const showOutdoorSuggestion = activity && mode === 'layout' && agent.outdoorBridgeReady && !showHistory
    && !placePending
    && !draft.trim() && !agent.pendingFiles.length && !agent.venuePick && !agent.mapPickerOpen
    && !agent.outdoorWorkflow.busy && !agent.outdoorWorkflow.proposal && !agent.outdoorWorkflow.pendingPlan && !agent.outdoorWorkflow.loginRequired
    && !['working', 'confirm', 'ask', 'blocked'].includes(agent.outdoorTask?.state ?? '');
  /** 活动与 Bingo 共用同一场对话的气泡与底部；布置生成 chrome 只在活动脸出现。 */
  const conversation = bingo || activity;
  const waitingOutdoorReply = !bingo && agent.outdoorTask?.state === 'ask' && agent.bubbles.at(-1)?.outdoorQuestion === true;
  // 2026-11-17 用户：Bingo 底部那张「当前任务·搜索目标地点」是错误地加了素材图，整块收掉。
  // 活动脸的引导卡照旧；Bingo 只留审校统计与气泡，不再带任务缩略图。
  const outdoorWorkflowCard = !bingo && agent.outdoorBridgeReady && (!agent.venuePick || waitingOutdoorReply || agent.outdoorWorkflow.pendingPlan) && (
    <OutdoorWorkflowCard flow={agent.outdoorWorkflow} replyPending={waitingOutdoorReply} showCaption={!traceActive} onSearchPlace={focusPlaceSearch} onAdjustPlan={() => inputRef.current?.focus()} onCancelPreview={() => {
      agent.outdoorWorkflow.cancel();
      agent.sayDecisionBadge('rejected', '已撤回这版预览，画布保持原样。已确认的部分保留。');
    }}/>
  );
  const showPlanHome = activity && mode === 'layout' && !agent.outdoorBridgeReady
    && isPlanHome(agent.state, layout, agent.proposal !== null);
  // 例句行占的就是输入框上方那一格；能力卡展开时同一格换成卡片，不再另占一行。
  const showTaskExamples = activity && mode === 'layout' && !showHistory && preStates
    && !agent.bubbles.some(bubble => !bubble.review)
    && !agent.briefBusy && !agent.understanding && !agent.generationQueued
    && !cloudRunRunning && !agent.cloudBusy && !agent.recovering && !studio?.applyRecovery
    && !agent.outdoorTask && !agent.outdoorWorkflow.busy && !agent.outdoorWorkflow.proposal
    && !agent.proposal && !agent.pendingFiles.length && !agent.issue && !agent.venuePick && !agent.mapPickerOpen;
  const pickTaskExample = (sentence: string): void => {
    setDraft(sentence);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // 状态头三件套：色调 + 图标 + 短文案；拿不到明确阶段就回退现有头部样式，不硬造状态。
  const headStatus: { tone: 'ask' | 'think' | 'run' | 'paused' | 'stopped'; label: string; icon: ReactNode } | null = (() => {
    if (mode !== 'layout' || !activity) return null;
    if (agent.outdoorWorkflow.pendingPlan) return { tone: 'ask', label: '等你批准', icon: <HelpCircle size={15} aria-hidden="true" /> };
    if (agent.outdoorTask?.state === 'ask' && !agent.outdoorWorkflow.busy) return { tone: 'ask', label: '待你回复', icon: <HelpCircle size={15} aria-hidden="true" /> };
    const s = agent.state;
    if (s === 'planProposed') return { tone: 'ask', label: '等你确认', icon: <HelpCircle size={15} aria-hidden="true" /> };
    if (agent.understanding || agent.briefBusy || agent.outdoorWorkflow.awaitingThought) return { tone: 'think', label: '正在思考', icon: <Sparkles size={15} aria-hidden="true" /> };
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
        {/* 2026-11-17 用户：面板标题旁的形体图标一律拿下——**只留第一格「活动（门）」那颗**。
            Bingo / 空间 / 物料 用 display:none 的零尺寸锚点占位，头像飞行测不到盒会自动不跑。 */}
        {activeAgent === 'door' ? (
          <span ref={headerAvatarRef} className={`ap-session-avatar-slot${headerAvatarVisible ? ' is-visible' : ''}`}>
            <RailAvatar key={activeAgent} form={meta.form} size={36} />
          </span>
        ) : (
          <span
            ref={headerAvatarRef}
            className="ap-session-avatar-slot"
            data-visible={headerAvatarVisible ? 'true' : 'false'}
            aria-hidden="true"
            style={{ display: 'none' }}
          />
        )}
        <h1 className="ap-session-title" title={activity ? sessionTitle : meta.name}>{activity ? sessionTitle : meta.name}</h1>
        {headStatus && <span className={`ap-head-status ap-head-status--${headStatus.tone}`} role="status">
          {headStatus.icon}<span>{headStatus.label}</span>
          {headStatus.tone === 'run' && runState.isRunning && runState.startedAt > 0 && <HeadRunClock startedAt={runState.startedAt} />}
        </span>}
      </div>
      <div className="ap-session-actions">
        {/* 2026-11-19 用户：「这里也可以删掉了？很奇怪」——空间 Agent 抬头那颗回形针「场地资料」弹层
            （新建/换场地 + 图纸与照片）已删除。换场地的入口留在项目「新方案」/ /projects 的「新建项目」/
            scendance:start-new-project 事件；图纸与照片仍在工作室分类页签里。 */}
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
      {activity && <SessionHistoryOverlay open={showHistory} scope={agent.sessionScope} headingKind={studio?.controller?.getSnapshot?.().project ? '项目' : '活动'} assertWrite={agent.assertSessionWrite} onClose={() => setShowHistory(false)} resolveStatus={resolveSessionStatus} onSelect={id => { markSessionSeen(id); /* 正文由 LayoutAgentProvider 跟 activeId 切换 */ }} />}
    {conversation ? <div className="ap-feed" ref={feed} aria-live="polite">
      {/* S1.1 活动开场画廊：仅活动脸 layout 模式挂载，Bingo/空间/物料脸不进。 */}
      {activity && mode === 'layout' && <ActivitiesGalleryMount/>}
      {showPlanHome && (
        <PlanHome
          draft={draft}
          onGenerate={sentence => { if (!agent.isSessionCurrent()) return; setDraft(''); void agent.send(sentence); }}
        />
      )}
      {activity && mode === 'layout' && planShown && <p className="ap-recap recap-done"><Check size={16} aria-hidden="true"/>{recap}</p>}
      {/* T3 封堵：review/delivery 旧模式门已由 demoteLegacyMode 收编，评审只走分享链接，旧 review/delivery 槽与话术随刀删除。 */}
      {/* T2：Bingo 脸只回放审校气泡（体检回执/钉评指路），不再共享活动脸的布置生成对话。 */}
      <Bubbles bubbles={agent.bubbles} sessionKey={`${agent.sessionScope}:${getActiveAssistantSessionId(agent.sessionScope)??''}`} reviewOnly={bingo} beforeLatestQuestion={waitingOutdoorReply ? outdoorWorkflowCard : undefined} onPickOption={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }} onOpenMaterials={() => agent.callbacks.onOpenMaterials()} {...(bingo ? {} : { onResendMessage: (text: string) => agent.resendEditedLast(text) })}/>
      {/* 运行中排队备注上屏（对标谷地工坊）：写了还没送达的备注挂「下一步」标签，可撤回；
          送达后由运行条「已送达 N 条」接手，这里只显示未送达的。 */}
      {activity && runState.isRunning && runState.scope === 'layout' && runState.steerNotes.length > 0 && (
        <div className="ap-steer-queue" role="list" aria-label="待送达备注">
          {runState.steerNotes.map((note, index) => (
            <div key={`${index}-${note}`} role="listitem" className="ap-steer-note">
              <span className="ap-steer-note-tag">下一步</span>
              <span className="ap-steer-note-text">{note}</span>
              <button type="button" className="ap-steer-note-undo" aria-label={`撤回备注：${note}`} onClick={() => removeAgentSteerNote(index)}>撤回</button>
            </div>
          ))}
        </div>
      )}
      {!waitingOutdoorReply && outdoorWorkflowCard}
      {!outdoorWorkflowCard && !bingo && agent.outdoorBridgeReady && agent.venuePick && <OutdoorThoughtRecord thought={agent.outdoorWorkflow.thought} request={agent.outdoorWorkflow.thoughtRequest} elapsedMs={agent.outdoorWorkflow.thoughtMs} />}
      {/* V-2d 流线提案确认卡（桥接模式）：旧任务卡只在非桥接态渲染，桥接态给一张独立确认卡。 */}
      {agent.outdoorBridgeReady && !agent.venuePick && agent.routeProposal && <RouteConfirmCard
        summary={agent.routeProposal.summary}
        routes={agent.routeProposal.routes.length}
        busy={agent.routeBusy}
        onConfirm={() => { recordAgentDecision({ kind: 'approved', label: '流线提案' }); agent.confirmRouteProposal(); }}
        onDismiss={() => { recordAgentDecision({ kind: 'rejected', label: '流线提案' }); agent.dismissRouteProposal(); }}
        onCancelTask={() => agent.stopOutdoorTask()}
      />}
      {agent.outdoorTask && (!agent.outdoorBridgeReady||agent.venuePick) && <OutdoorTaskCard task={agent.outdoorTask} historical={outdoorTaskHistorical}
        canStop={Boolean(agent.venuePick?.loading || agent.venuePick?.picking || agent.routeBusy || agent.flowSimActive)}
        onInspectFacility={agent.inspectOutdoorFacility} onStop={agent.stopOutdoorTask} onPrefill={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}>
      {agent.venuePick && <VenueConfirmCard
        state={agent.venuePick}
        onPick={place => agent.handleVenuePick(place)}
        onPreview={place => agent.previewVenueCandidate(place)}
        onManual={() => agent.startMapVenuePicker()}
        onDismiss={() => { recordAgentDecision({ kind: 'rejected', label: '场地候选' }); agent.dismissVenuePick(); }}
      />}
      {/* V-2d 流线提案确认卡：虚线预览在画布，应用才写入（可撤销）。 */}
      {!agent.venuePick && agent.routeProposal && <RouteConfirmCard
        summary={agent.routeProposal.summary}
        routes={agent.routeProposal.routes.length}
        busy={agent.routeBusy}
        onConfirm={() => { recordAgentDecision({ kind: 'approved', label: '流线提案' }); agent.confirmRouteProposal(); }}
        onDismiss={() => { recordAgentDecision({ kind: 'rejected', label: '流线提案' }); agent.dismissRouteProposal(); }}
        onCancelTask={() => agent.stopOutdoorTask()}
      />}
      {/* V-3 区域提案确认卡：虚线分区+物料幽灵在画布，应用才写入（可撤销）。 */}
      {!agent.venuePick && !agent.routeProposal && agent.zoneProposal && <ZoneConfirmCard
        proposal={agent.zoneProposal}
        busy={agent.zoneBusy}
        onConfirm={() => { recordAgentDecision({ kind: 'approved', label: '分区提案' }); agent.confirmZoneProposal(); }}
        onDismiss={() => { recordAgentDecision({ kind: 'rejected', label: '分区提案' }); agent.dismissZoneProposal(); }}
        onCancelTask={() => agent.stopOutdoorTask()}
      />}
      </OutdoorTaskCard>}
      {activity && mode === 'layout' && <ToolCallTrace line={processText} draft={agent.streamPreview} rows={traceRows} understanding={agent.understanding} onStop={agent.cancelUnderstanding}/>}
      {/* 云端真跑时由 AgentRunPanel 接管：真步骤时间线 + 停止确认行 + 过往任务归档；
          processText 状态条保留在 ToolCallTrace，避免两份「执行过程」列表。
          onRestoreStart：收尾卡「还原到本轮开始」——开跑瞬间的整盘快照一键写回。 */}
      {activity && mode === 'layout' && <AgentRunPanel scope="layout" controls steerInputId="ap-input" onRestoreStart={runStartLayoutRef.current ? () => { const snapshot = runStartLayoutRef.current; if (!snapshot) return false; layoutActions.applyLayout(snapshot); return true; } : undefined}/>}
      {/* 2026-11-19 体检：历史待核对与旧方案两张拦截卡合进一张「开始前要先处理」，
          每行保留自己的 region 名（测试与读屏锚点不变），同屏时不再像两张待办。 */}
      {activity && (agent.historyReviewRequired || agent.retainedOtherSessionProposal) && <section className="ap-card ap-status-card ap-blocked-card" aria-label="开始前要先处理">
        <span className="ap-blocked-stamp"><Lock size={12} aria-hidden="true"/>开始前要先处理</span>
        {agent.historyReviewRequired && <section className="ap-intercept-row" aria-label="历史需求待核对">
          <p className="ap-blocked-note">当前记录还未核对。</p>
          <button type="button" className="btn-primary" disabled={agent.unresolvedDialogue.length>0 || agent.understanding || agent.generationQueued>0} onClick={agent.reviewDialogueHistory}>按当前记录重新开始</button>
        </section>}
        {agent.retainedOtherSessionProposal && <section className="ap-intercept-row" aria-label="其他会话的旧方案">
          <p className="ap-blocked-note">别的会话有没确认的方案，先撤回。</p>
          <div className="ap-blocked-actions">
            <button type="button" className="chip" onClick={agent.withdrawRetainedOtherSessionProposal}>撤回其他会话旧方案</button>
          </div>
        </section>}
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
      {bingo && <BingoAuditCard
        scopeKey={agent.sessionScope}
        isCurrent={agent.isSessionCurrent}
        reviewActions={{
          onRecheck: () => agent.reviewNow(),
          onSendReview: () => { void agent.issueReviewLink(); },
        }}
      />}
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
        {preStates && agent.issue && <div className="ap-chips">{agent.issue.kind === 'readFailed' ? <><button type="button" className="chip is-on" onClick={agent.retryFile}>重试</button><button type="button" className="chip" onClick={() => agent.pickFile()}>换个文件</button></> : <button type="button" className="chip is-on" onClick={() => agent.pickFile()}>重新选文件</button>}</div>}
        {/* 第 8 批：云端真跑时用真实步骤时间线（真实进度句 + 真实模型轮数 + 真实耗时），
            没有真实运行（本机规则模式）才回退到那套写死的步骤条。
            2026-11-19 用户指令：生成中/已暂停卡砍掉——输入框下方已有暂停/播放钮，点播放直接续，
            卡上的「停一下/接着摆/不要了」成了重复入口。 */}
        {agent.state === 'generateFailed' && <section id="inline-error" className="ap-card ap-error-card" role="alert">
          <span className="ap-error-stamp"><TriangleAlert size={12} aria-hidden="true"/>未完成</span>
          <p className="ap-error-summary">这次没完成，画布没动。</p>
          <div className="ap-error-actions">
            <button type="button" className="chip" onClick={agent.retry}><RotateCw size={14} aria-hidden="true"/>重试</button>
            <button type="button" className="chip btn-outline" onClick={() => { const input = document.getElementById('ap-input'); input?.focus(); }}>改一句再说</button>
          </div>
        </section>}
        {agent.modelFailure && <section className="ap-card ap-error-card" role="alert">
          <span className="ap-error-stamp"><TriangleAlert size={12} aria-hidden="true"/>智能理解</span>
          <p className="ap-error-summary">{agent.modelFailure.text}</p>
          <p className="ap-error-hint">{agent.modelFailure.hint}</p>
          <p className="ap-error-diag" style={{userSelect:'all'}}>{agent.modelFailure.diag}</p>
          <div className="ap-error-actions">
            <button type="button" className="chip" onClick={() => { const retry = agent.modelFailure?.retry; agent.dismissModelFailure(); retry?.(); }}><RotateCw size={14} aria-hidden="true"/>重试云端理解</button>
            <button type="button" className="chip btn-outline" onClick={() => { agent.dismissModelFailure(); document.getElementById('ap-input')?.focus(); }}>改一句再说</button>
          </div>
        </section>}
        {proposed && <ProposalCard
          plan={agent.proposal}
          cloudBusy={agent.cloudBusy}
          recovering={agent.recovering}
          inventoryBlocked={agent.inventoryBlocked}
          inventoryInvalid={agent.inventoryInvalid}
          exportPreview={agent.exportPreview}
          inventoryWorkspace={agent.inventoryWorkspace}
          onAddSeats={agent.addSeats}
          onConfirm={agent.confirmProposal}
          onWithdraw={agent.withdrawProposal}
          onRegenerate={agent.regenerate}
          onApprove={() => setProposalDecision('approved')}
          onReject={() => setProposalDecision('rejected')}
          onPrefill={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}
        />}
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
            {agent.overlapCount > 0 ? <p className="ap-warn-line"><span aria-hidden="true">!</span>{agent.overlapCount} 件物料重叠或超出场地，画布上已用黄色标出。</p> : <p className="ap-ok-line">没发现物料重叠，场地还要核对。</p>}
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
        <p className="ap-blocked-note">{agent.outdoorBridgeReady?'只是候选，还没发送。':'包含手工需求和物料单。'}</p>
        {agent.proposal || !!studio?.preview || !!agent.outdoorWorkflow.proposal
          ? <p className="ap-blocked-note" role="status">先确认或撤回预览，再导出。</p>
          : generating || paused || agent.outdoorWorkflow.busy || agent.cloudBusy || agent.recovering || agent.cloudStale || !!studio?.applyRecovery
          ? <p className="ap-blocked-note" role="status">这一版还在生成，先别确认。</p>
          : !agent.outdoorBridgeReady && studio?.cloudMaterialDraftAvailable ? <p className="ap-blocked-note">云项目暂不支持此执行资料草案，可先导出下方物料草案。</p>
          : <button type="button" className="btn-primary" onClick={agent.confirmExport}>确认导出</button>}
        {!agent.outdoorBridgeReady && studio?.cloudMaterialDraftAvailable && !agent.proposal && !studio.preview && !generating && !paused && !agent.cloudBusy && !agent.recovering && !agent.cloudStale && !studio.applyRecovery && <>
          <button type="button" className="chip" onClick={agent.confirmCloudMaterialDraft}>导出当前场景物料清单草案</button>
        </>}
        <div className="ap-error-actions">
          <button type="button" className="chip btn-outline" onClick={agent.dismissExport}>先不了</button>
        </div>
      </div>}
    </div>
    : <>
      {visitedLanes.current.has('space') && <div className="ap-agent-surface is-space" hidden={activeAgent !== 'space'}>{spaceSlot}</div>}
      {visitedLanes.current.has('material') && <div className="ap-agent-surface is-material" hidden={activeAgent !== 'material'}>{materialSlot}</div>}
    </>}
    {activeAgent === 'bingo' && bingoSlot}
    {!conversation && chatSlot}
    </div>
    {/* T2：输入条、风格套与能力提示只属于活动脸；Bingo 脸纯审校台，无输入框。 */}
    {activity && <>
        {/* 活动脸统管活动级选址与布置风格套；Bingo 不再保留布置生成入口。 */}
        {mode === 'layout' && activity && agent.stylePickerOpen && (
          <StyleBundlePanel
            paletteOnly={agent.outdoorBridgeReady}
            disabled={generating||agent.outdoorWorkflow.busy}
            onClose={agent.closeStylePicker}
            onPick={bundle => agent.placeStyleBundle(bundle)}
          />
        )}
        {mode === 'layout' && activity && <AgentSuggestionSlot open={capabilitiesOpen} onToggle={toggleCapabilities} placeFirst={placePending} showExample={showTaskExamples && !draft.trim() && placePending} onPickExample={pickTaskExample} onPrefill={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}/>}
        <AgentResearchSources research={agent.venueResearch}/>
        <AgentDocumentSources documents={agent.documents}/>
        <form id="composer" className="ap-composer ap-composer-panel" onSubmit={event => { event.preventDefault(); submitComposer(); }}>
        {/* 2026-11-20 用户：这行原来贴在面板左缘、无折叠标记、和输入区不在一条竖线上。现在它挂在输入区自己的一块，
            右对齐成一颗设置胶囊（标题带当前档位），展开是向上开的浮层，不把输入框顶下去。 */}
        {activity && mode === 'layout' && <details className="ap-supervision-fold">
          <summary>
            执行权限 · {supervisionLevelInfo(supervisionLevel).label}
            <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <AgentSupervisionPicker />
        </details>}
        {showOutdoorSuggestion && <OutdoorStageSuggestion key={agent.outdoorWorkflow.state.stage} stage={agent.outdoorWorkflow.state.stage} onPick={pickTaskExample} />}
        <label className="sr-only" htmlFor="ap-input">告诉 Agent 要改的</label>
        <div className="ap-composer-field ap-panel-field">
        {/* 2026-11-19 用户指令：有图时附件条向上展开——它占正常流，贴在打字区上方，
            输入卡随附件往上长、删空自动收回，不再绝对定位压住占位句。 */}
        {agent.pendingFiles.length>0 && <div className="ap-file-chips" role="list" aria-label="待发附件">
          {agent.pendingFiles.map((item, index) => <div key={item.url.slice(-24)+String(index)} role="listitem" className="sc-chat-file ap-file-chip">
            {item.url ? <img className="sc-chat-file-thumb" src={item.url} alt=""/> : <span aria-hidden="true">文档</span>}
            <span className="sc-chat-file-name">{item.name}</span>
            <button type="button" className="sc-chat-file-remove" aria-label={`移除附件 ${index+1}`} onClick={() => agent.removePendingImage(index)}><X size={14} aria-hidden="true"/></button>
          </div>)}
        </div>}
        {/* 引导句是绝对定位的整句打字机：有附件时收掉，免得和上方的附件条叠在一起。 */}
        {ghostVisible && !agent.pendingFiles.length && <SuggestionGhost className="ap-ghost" full={suggestion.full} shown={suggestion.shown} onPick={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}/>}
        <textarea id="ap-input" data-tour="chat-input" ref={inputRef} rows={2} value={draft} maxLength={600} disabled={!composerEnabled} placeholder={ghostVisible ? '' : composerPlaceholder} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Tab' && !agent.outdoorBridgeReady && mode === 'layout' && !draft.trim()) { event.preventDefault(); setDraft(suggestion.full); return; }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitComposer(); }
        }}/>
        {/* 2026-11-21 docs/50 I6：PetitMaker 同款常驻诚实声明——agent 可能出错也可能改坏设计，重要改动会先问。 */}
        <p className="ap-field-note ap-honesty-note">我会出错，也可能破坏你的设计。重要改动会先问你。</p>
        {outdoorSendQueue.length>0&&<p role="status" className="ap-field-note">已排队 {outdoorSendQueue.length} 条，当前任务结束后自动发送。</p>}
        {agent.generationQueued>0&&<p role="status" className="ap-field-note">排队 {agent.generationQueued} 条，按顺序处理中。</p>}
        {agent.retryUncertain && <div role="alert" className="ap-field-alert"><p>上次结果未知，可能还在计费。再发可能重复收费。</p><button type="button" onClick={agent.confirmUncertainRetry}>确认再次发送</button><button type="button" onClick={agent.dismissUncertainRetry}>暂不发送</button></div>}
        {agent.sessionSaveFailed && <p role="status" className="ap-field-note">本机没存上，内容还在页面上。</p>}
        <div className="ap-panel-row" ref={menuRowRef}>
          {/* 加号：先开浮窗，再从浮窗里选「图片」或「文件」——分开 accept，选完照旧进同一条 stageFile 链路。 */}
          <div className="ap-add-picker">
            <button type="button" className="ap-panel-add" aria-haspopup="menu" aria-expanded={openMenu === 'add'} aria-label="添加文件" data-tour="chat-attach" title="添加文件" onClick={() => setOpenMenu(open => open === 'add' ? null : 'add')}>
              <PlusLineIcon size={16} aria-hidden="true"/>
            </button>
            {openMenu === 'add' && <div className="ap-add-menu" role="menu" aria-label="添加文件">
              <button type="button" role="menuitem" className="ap-add-item" onClick={() => { setOpenMenu(null); agent.pickFile('image/png,image/jpeg,image/webp'); }}>
                <ImageLineIcon size={16} aria-hidden="true"/><span>图片</span>
              </button>
              <button type="button" role="menuitem" className="ap-add-item" onClick={() => { setOpenMenu(null); agent.pickFile(`${AGENT_DOCUMENT_ACCEPT},.dxf,.dwg`); }}>
                <FileLineIcon size={16} aria-hidden="true"/><span>文件</span>
              </button>
            </div>}
          </div>
          <div className="ap-panel-actions">
            {/* 模型位「智能」：菜单列服务端下发的真实模型槽位（chat/capabilities），
                点选即切换对话/摘要/Agent 工具循环的 provider（请求级切换）。
                2026-11-14 用户指令：原底部独立槽位栏并进这里，不再单摆。 */}
            <div className={`ap-provider${providerMenuOpen ? ' is-open' : ''}`}>
              <button
                ref={providerAnchorRef}
                type="button"
                className="ap-provider-summary"
                aria-expanded={providerMenuOpen}
                aria-haspopup="menu"
                aria-label="模型选择"
                data-tour="chat-model"
                onClick={() => setProviderMenuOpen(open => !open)}
              >
                <span className="ap-supervise-dot" aria-hidden="true"/>
                <span className="ap-provider-summary-label">{summaryLabel}</span>
              </button>
              {providerSlots && createPortal(
                <div
                  ref={providerMenuRef}
                  className={`ap-provider-menu${providerMenuOpen ? ' is-open' : ''}`}
                  role="radiogroup"
                  aria-label="模型选择"
                  style={providerMenuStyle}
                >
                  {providerSlots.map(slot => {
                    const activeProvider = activeProviderId === slot.id;
                    const disabled = !slot.configured || !!studio?.busy;
                    const models = slot.models ?? [];
                    if (!models.length) {
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          role="radio"
                          aria-checked={activeProvider}
                          disabled={disabled}
                          onClick={() => {
                            studio?.setActiveProvider(slot.id);
                            studio?.setActiveModel(null);
                            setProviderMenuOpen(false);
                          }}
                        >
                          <span className="ap-provider-label">{slot.label}{!slot.agentTools && <small>仅对话/摘要</small>}</span>
                          <span className="ap-provider-model">{slot.configured ? slot.model : '未配置'}</span>
                        </button>
                      );
                    }
                    return (
                      <div key={slot.id} className="ap-provider-group">
                        <div className="ap-provider-group-label">{slot.label}{!slot.agentTools && <small>仅对话/摘要</small>}</div>
                        {models.map(option => {
                          const active = activeProvider && (activeModelId === option.model || (option.default && activeModelId === null));
                          return (
                            <button
                              key={option.model}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              disabled={disabled}
                              onClick={() => {
                                studio?.setActiveProvider(slot.id);
                                studio?.setActiveModel(option.default ? null : option.model);
                                setProviderMenuOpen(false);
                              }}
                            >
                              <span className="ap-provider-label">{option.label}</span>
                              <span className="ap-provider-model">{option.default ? '默认' : option.model}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>,
                document.body,
              )}
            </div>
            {/* 户外任务进行中：发送位变成中止钮，请求的取消入口从任务卡挪到这里。 */}
            {agent.outdoorWorkflow.busy || agent.outdoorWorkflow.simulating ? (
              <button
                type="button"
                className="ap-send ap-panel-send is-stop"
                aria-label="中止当前请求"
                data-tour="chat-send"
                onClick={() => agent.outdoorWorkflow.cancel()}
              >
                <Square size={18} aria-hidden="true"/>
              </button>
            ) : showMic ? (
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
        </div>
        </div>
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
