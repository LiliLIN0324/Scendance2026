'use client';

/**
 * 右栏对话优先的 Agent 面板（#agent-panel）+ 画布上的状态层。
 * 一句话开场：没有表单、没有起步卡——用户敲一句话，客户端解析（人数/场地/面积/类型/时段）铺进预填卡。
 * 出方案：已连接云项目时走现有 AI 生成；否则由 lib/agent-proposal 用现有本地物料组
 * （furniture-sets / surprise）在内存里算一份候选，再按步推给画布做预览。
 * 硬钉（对话四步 ②）：建议 → 画布预览（绿框 = 新位，虚线 = 原位）→「确认布置」/「撤回」。
 * 确认前一个字节都不写场景，所以自动存档与撤销栈看不到提案；确认才一次 applyLayout，撤销一步能整体退回。
 * 第 1 步「读场地」先把确认过的尺度立成可布置壳体（四面外墙 + 主入口 + 层高，见 lib/venue-shell）。
 * 底图只收图片（复用 layout.floorPlanImage）：图纸只当参照，长宽要么说一句「12×9」、要么说「按图纸估」，
 * 未确认前不把米数说成事实（docs/AI-NATIVE-FOR-EXECUTORS.md 对话四步 ①）。
 * 生成入口只有一个：对话。尺寸表单与「让晴光出方案」那颗大绿钮按 2026-10-26 夜截图钉砍掉了，
 * 卡片退回只读回显，画布上唯一的绿钮是「确认布置」。
 */
import { ArrowUp, Check, FileImage, Loader2, Map as MapIcon, Maximize2, Minimize2, Paperclip, RotateCw, SquareDashed, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { resolveBriefTurn } from '../../../lib/agent-resolver';
import { useRoomEditor } from '../contexts';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { proposeAddition, proposePlan, raiseVenue, replaceVenueWithShell, type AdditionProposal, type PlanProposal, type VenuePlan } from '../lib/agent-proposal';
import { BLANK_VENUE, createBlankVenue } from '../lib/blank-venue';
import { createVenueFromPick, polygonBboxMeters, type AmapPoint } from '../lib/amap-venue';
import { AmapVenuePicker } from './amap-venue-picker';
import { initialBriefMemory, memoryExtraction, type BriefMemory, type LayoutMode } from '../lib/brief-agent';
import { INITIAL_BRIEF } from '../lib/creative-brief';
import { readImageAsDataUrl } from '../lib/file-io';
import { proposeReviewFix, reviewLayout, type ReviewIssue, type ReviewSkip } from '../lib/layout-review';
import { sameLayoutContent } from '../lib/persistence';
import { capturePlanForVenue, type CapturePlan } from '../lib/site-capture';
import { isStructuralMarker, materialCount, venueArea } from '../lib/structural-layout';
import { venueBriefLine } from '../lib/venue-brief-line';
import {
  describeExtraction, classifyFile, fileSizeLabel, formatArea, GEN_STEPS, HEADCOUNT_MAX, MATERIAL_REQUEST_HINT, NON_IMAGE_MESSAGE,
  checkDim, isClientReviewCommand, isCopyDraftCommand, isDemoBackend, isEstimateCommand, isExportCommand, isGenericMaterialRequest, isGenerateCommand,
  isMaterialListCommand, isReviewCommand, isStopCommand, isVenueSizeOnly, isZoneCommand, parseBriefSentence, parseMaterialRequest, pendingPlanOf,
  scaleOriginOf, suggestDimsFromArea, suggestDimsFromImageRatio,
  type AgentState, type BriefExtraction, type MaterialRequest, type PendingPlan, type VenueIO,
} from '../lib/workbench-agent';
import { proposalDifferences } from '../three/proposal-preview';
import { useStudioAgent } from './creative-studio';
import { SiteCaptureCard } from './site-capture-card';
import type { SceneV2 } from '../../../../supabase/functions/_shared/domain';
import type { RoomLayout } from '../lib/types';
import type { ScaleOrigin } from '../lib/venue-shell';
import type { WorkbenchMode } from '../lib/workbench-mode';
import './agent-panel.css';

const MASCOT_DIR = '/assets/assistant/qingguang-3d';
const STEP_DELAY_MS = 420;
/** 云提案有自己的失效条件（基线/需求/编辑权/租约）。确认按钮按住时说的那句，卡片和按钮共用一条。 */
const CLOUD_STALE = '场地、需求或编辑权在这期间变了，这版先别确认，重新出一版。';
/** 本地验收开关：`?agentFail=1` 让出方案这一步故意失败一次，好核对「发现问题」那一态。 */
const forceFail = () => process.env.NODE_ENV !== 'production' && typeof window !== 'undefined'
  && new URL(window.location.href).searchParams.get('agentFail') === '1';

type FileIssue = { kind: 'nonImage' | 'unsupported' | 'tooLarge' | 'readFailed'; name: string; size: number };
type Bubble = {
  id: string; role: 'user' | 'agent'; text: string; meta?: string; warn?: string; amber?: boolean;
  /** 清单/文案这种多行回话：不做两行截断，保留换行。 */
  long?: boolean;
  /** 气泡里的一句话动作：只给「拖了图纸、还差一步就能出方案」这种当场要点的下一步，不当第二套入口。 */
  action?: { label: string; run(): void };
};
/** 这一版要按哪组尺度摆：origin 记下米数是谁定的，只有人说过的才敢当事实念出来。 */
type Scale = { length: number; width: number; origin: ScaleOrigin };

/**
 * 待确认的那一版布置。本地候选和云端 AI 提案在右栏共用同一张卡、同一颗绿钮：
 * 卡片只认这几个数，谁来提案都得先预览、由人点「确认布置」才落盘。
 */
interface ProposalView extends PendingPlan {
  source: 'local' | 'cloud';
  /** 本地提案里 Agent 没动的锁定件数。 */
  keptLocked: number;
  /** 放不进新场地、没被采纳的件数。 */
  dropped: number;
  /** 这一版按多少人摆的；加物料这类提案没有人数，就不写。 */
  guests?: number | null;
  /** 实际摆出的座位数（餐桌一组 4 座 + 散椅）。 */
  seats?: number;
  /** 这版已经按「加座」重排过：仍不够就直接报场地最多能坐多少。 */
  seatPriority?: boolean;
  /** 确认按钮点不动的原因；null = 可以确认。 */
  blocked: string | null;
  /** 这版是体检改法：只挪位置，不新增不删除，卡片和气泡都换一套说法。 */
  review?: boolean;
  /** 体检里锁着或找不到落点、没动的物料名。 */
  skipped?: string[];
}

/** 本地候选那份读数直接搬到卡片上（生成器已经算好了件数与重叠）。 */
function viewOfLocalPlan(plan: PlanProposal): ProposalView {
  return {
    added: plan.added, removing: plan.removing, changed: plan.moved ?? 0, lockedTouched: 0,
    overlapCount: plan.overlapCount, overlapNames: plan.overlapNames,
    source: 'local', keptLocked: plan.keptLocked, dropped: plan.dropped, blocked: plan.blocked,
    guests: plan.guests ?? null, seats: plan.seats ?? 0, seatPriority: !!plan.seatPriority,
    review: plan.kind === 'review', skipped: plan.skipped ?? [],
  };
}

/** 卡片与气泡共用的那句话：新摆几件、动了几件已有的、要撤几件旧的。 */
function planLines(view: ProposalView): string[] {
  const lines: string[] = [];
  if (view.review) {
    if (view.changed) lines.push(`蓝框是挪到的新位置 ${view.changed} 件（琥珀线框是原位）`);
  } else {
    if (view.added) lines.push(`绿框是新摆的 ${view.added} 件`);
    if (view.changed) lines.push(`蓝框是挪动过的 ${view.changed} 件`);
  }
  if (view.removing) lines.push(`红框是要撤掉的 ${view.removing} 件`);
  if (view.keptLocked) lines.push(`锁定 ${view.keptLocked} 件我没动`);
  if (view.dropped) lines.push(`${view.dropped} 件放不下，没采纳`);
  if (view.skipped?.length) lines.push(`${view.skipped.length} 件没动：${view.skipped.slice(0, 4).join('、')}${view.skipped.length > 4 ? ' 等' : ''}`);
  // 人数是这一版的条件：摆得下就说摆了几座，摆不下就直说多少人得站着，不拿「已按 80 人布置」糊过去。
  // 已经按「加座」重排过还差人，就报场地最多能坐多少，不再暗示再点一次就能补齐。
  if (view.guests && view.guests > 0) {
    const seats = view.seats ?? 0;
    lines.push(seats >= view.guests
      ? `按 ${view.guests} 人摆了 ${seats} 座`
      : view.seatPriority
        ? `这版最多摆 ${seats} 座，还差 ${view.guests - seats} 位；可以换更大的场地，或按站立留空`
        : `只摆得下 ${seats} 座，其余 ${view.guests - seats} 位按站立留空`);
  }
  return lines;
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
  onFit(): void;
  /** 活动简报（完善需求） */
  onOpenBrief?(): void;
  /** 图纸尺寸面板 */
  onOpenReference?(): void;
}

interface AgentValue {
  callbacks: LayoutAgentCallbacks;
  state: AgentState; venueIO: VenueIO; setVenueIO(value: VenueIO): void;

  baseName: string | null; issue: FileIssue | null; dragging: boolean;
  /** 对话已收集字段的只读回显（截图钉 2026-10-26 夜：表单不再当第二套生成入口）。 */
  recap: { event: string | null; guests: string | null; dims: string; note: string | null };
  /** 画布上已经有一个立起来的场地（墙/门/尺寸都是场地真相）：第 ① 步就算过了。 */
  venueUp: boolean;
  progress: number; failed: boolean; overlapCount: number; bubbles: Bubble[];
  /** 只给「这次没出成」那张卡用：重跑上一句，不另开一个生成入口。 */
  retry(): void; stop(): void; resume(): void; regenerate(label?: string): void;
  /** 还没确认的那版布置；null = 没有待确认的提案。只在预览已落稳（proposed）时给出。 */
  proposal: ProposalView | null; confirmProposal(): void; withdrawProposal(): void;
  /** 左栏简报的空地文字链：不用先开物料库，一键立 12×8 空壳。 */
  startBlankVenue(): void;
  /** 左轨常驻的地图入口：场地立起来也进得来，返回 null = 场地已换成圈画这块，否则是挡路的原因。 */
  mapPickerOpen: boolean;
  startMapVenuePicker(): void;
  closeMapVenuePicker(): void;
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
  exportPreview: boolean; previewExport(): void; confirmExport(): void; dismissExport(): void;
  acceptFile(file: File): void; retryFile(): void; pickFile(): void;
  send(text: string): void; rainOn: boolean; previewRain(): void; walkthrough(): void;
}

const AgentContext = createContext<AgentValue | null>(null);
export function useAgent(): AgentValue { const value = useContext(AgentContext); if (!value) throw new Error('Agent panel unavailable'); return value; }

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const wait = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });

export function LayoutAgentProvider({ callbacks, onVenueIOChange, onPreview, onApply, children }: { callbacks: LayoutAgentCallbacks; onVenueIOChange?(value: VenueIO): void; onPreview(candidate: RoomLayout | null): void; onApply(next: RoomLayout): void; children: ReactNode }): JSX.Element {
  const { layout, activeFloor, activeFloorIndex, actions, view, setView, collidingIds } = useRoomEditor();
  const studio = useStudioAgent();
  // 确认/撤回都是异步云调用，回调里要读最新那一帧的预览状态，不能在闭包里快照。
  const studioRef = useRef(studio); studioRef.current = studio;
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
  // 异步播报里要读最新那句的人数/活动名，不能读 setBrief 之前那一帧的闭包。
  const briefRef = useRef(brief); briefRef.current = brief;
  // 对话记忆（brief-agent）：人数/尺寸/形态跨句累积，解析失配不再退回开场白。
  const memoryRef = useRef<BriefMemory>(initialBriefMemory());
  const [phase, setPhase] = useState<'idle' | 'generating' | 'paused' | 'failed' | 'proposed' | 'ready' | 'edited'>('idle');
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  // T-UI §4-5：导出预览卡只活在这里；确认前不触发任何下载。
  const [exportPreview, setExportPreview] = useState(false);
  // 提案只活在这里：layout 一个字节都不动，所以自动存档、撤销栈、别人的选中态都不受影响。
  const proposal = useRef<PlanProposal | null>(null);
  const proposalBase = useRef<RoomLayout | null>(null);
  const shownSteps = useRef(0);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const lastFile = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const runToken = useRef(0);
  const seed = useRef(1);
  const colliding = useRef(collidingIds); colliding.current = collidingIds;
  const live = useRef(layout); live.current = layout;
  const floorIndexRef = useRef(activeFloorIndex); floorIndexRef.current = activeFloorIndex;
  const dragDepth = useRef(0);

  const lengthCheck = checkDim(lengthText, '长度');
  const widthCheck = checkDim(widthText, '宽度');
  const dimsInvalid = (!lengthCheck.ok && !lengthCheck.empty) || (!widthCheck.ok && !widthCheck.empty);
  const hasBase = baseName !== null;

  const say = useCallback((bubble: Omit<Bubble, 'id'>) => setBubbles(items => [...items.slice(-30), { id: uid(), ...bubble }]), []);

  /** 对话记忆 → 右栏回放与生成条件共用的那份真相（人数/活动名/布置形态）。 */
  function syncMemory(memory: BriefMemory): void {
    const next = { event: memory.event, guests: memory.headcount, layoutMode: memory.layoutMode };
    briefRef.current = next;
    setBrief(next);
  }

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
      ...(extraction.event ? { event: extraction.event } : {}),
      ...(inRange && guests !== null ? { guests } : {}),
    }));
    return guests !== null && !inRange ? `人数超出左栏范围（1–${HEADCOUNT_MAX}），这个数先留在右栏，左边没改。` : null;
  }

  /** 画布当前这一层的物料，按名字汇总：清单、文案都读这一份，不另存一份物料表。 */
  function floorRows(from: RoomLayout = live.current): { rows: Array<{ name: string; count: number }>; total: number; locked: number } {
    const index = Math.min(activeFloorIndex, Math.max(0, from.floors.length - 1));
    const items = from.floors[index]?.items ?? [];
    const map = new Map<string, number>();
    let locked = 0;
    for (const item of items) {
      if (isStructuralMarker(item)) continue;
      // 现有家具库的默认名是英文：对话里只换掉这两个默认名，人改过的名字原样念。
      const name = item.name === 'Dining Chair' ? '椅子' : item.name === 'Dining Table' ? '桌子' : item.name;
      map.set(name, (map.get(name) ?? 0) + 1);
      if (item.locked) locked += 1;
    }
    const rows = [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    return { rows, total: rows.reduce((sum, row) => sum + row.count, 0), locked };
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
    const event = briefRef.current.event ?? studioRef.current?.brief.event ?? '这场活动';
    const guests = briefRef.current.guests ?? studioRef.current?.brief.guests ?? null;
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
    if (phaseRef.current === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：等它出来，或先说「停一下」，我再体检。' }); return; }
    if (proposal.current || studioRef.current?.preview) { say({ role: 'agent', amber: true, text: '还有一版没确认：先点「确认布置」或「撤回」，我再按落盘后的画布体检。' }); return; }
    const report = reviewLayout(live.current, floorIndexRef.current);
    if (report.checked === 0) {
      say({ role: 'agent', long: true, text: '这一层还没有物料可看。先说一句「出方案」摆一版，或者说「加两把椅子」，我再体检。' });
      return;
    }
    const notes = report.notes.length ? `\n${report.notes.join('\n')}` : '';
    if (report.clean) {
      say({ role: 'agent', long: true, text: `看完了 ${report.checked} 件：没有互相挤、压墙柱、出界或拉不开的地方。这是几何体检，不是合规审查。${notes}` });
      return;
    }
    say({ role: 'agent', long: true, text: `我按画布几何看了一遍 ${report.checked} 件，找到 ${report.issues.length} 条：\n只报挤、压墙/柱、出界、挡门前留空和座椅拉不开，不是合规审查。${notes}` });
    const actionable = report.issues.filter(issue => !!issue.fix);
    for (const issue of actionable.slice(0, 3)) {
      say({ role: 'agent', text: `${issue.title}。${issue.detail}`, action: { label: `按这条改：${issue.fix!.label}`, run: () => applyReviewFix(issue) } });
    }
    const rest = actionable.length - Math.min(3, actionable.length);
    if (rest > 0) say({ role: 'agent', amber: true, text: `还有 ${rest} 条没展开：先把上面这几条改了，再说一句「看看哪里有问题」，我接着看。` });
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
    const floor = result.layout.floors[Math.min(index, result.layout.floors.length - 1)];
    const byId = new Map((floor?.items ?? []).map(item => [item.id, item] as const));
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
    proposal.current = plan; proposalBase.current = base;
    // 画布本来就是改之前的样子，省掉基线那一帧，直接看挪完的结果。
    shownSteps.current = 1;
    lastSource.current = 'local';
    const rest = result.remaining.length ? `（改完还剩 ${result.remaining.length} 条要处理）` : '';
    void presentProposal(++runToken.current, `按这条改：${fresh.fix.label}${rest}。`);
  }

  /**
   * 「加两把椅子」：只把点名的那几件放进空位，仍然只出候选、不写画布。
   * 已经有一版本地预览时，就接在这一版上继续加，不再让人先确认一遍。
   */
  function addMaterials(request: MaterialRequest): void {
    if (phase === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：等它出来，或先说「停一下」，我再加物料。' }); return; }
    if (proposal.current === null && studioRef.current?.preview) {
      say({ role: 'agent', amber: true, text: '云端这一版还没确认：先点「确认布置」或「撤回」，我再往上加。' });
      return;
    }
    const pending = proposal.current;
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
    if (!pending) proposalBase.current = live.current;
    proposal.current = plan;
    // 画布本来就是「加之前」的样子：省掉基线那一帧，直接看加上之后的结果。
    shownSteps.current = 1;
    const lead = placed < request.count
      ? `按你说的加 ${request.count} 件${request.name}，只放得下 ${placed} 件：`
      : pending ? `在这版上又加了${request.name}：` : `按你说的加了${request.name}：`;
    void presentProposal(++runToken.current, lead);
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
  function scaleFrom(extraction: BriefExtraction): Scale {
    const origin = scaleOriginOf(extraction, scaleOrigin);
    if (origin === 'stated' && extraction.lengthM !== null && extraction.widthM !== null) return { length: extraction.lengthM, width: extraction.widthM, origin };
    if (origin === 'area' && extraction.areaM2 !== null) return { ...suggestDimsFromArea(extraction.areaM2), origin };
    return readScale();
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
    const plan = pendingPlanOf(
      proposalDifferences(preview.base, preview.layout).map(change => ({
        kind: change.kind,
        locked: change.after?.item.locked ?? change.before?.item.locked ?? false,
      })),
      preview.proposal.warnings,
      id => byId.get(id)?.name ?? '物件',
    );
    const current = studioRef.current;
    return {
      ...plan, source: 'cloud', keptLocked: 0, dropped: 0,
      blocked: current?.expired ? '这版已经过期了，重新出一版再看。'
        : current?.stale ? CLOUD_STALE
        : plan.lockedTouched ? `这版动了 ${plan.lockedTouched} 件锁着的物料：我不改锁着的东西，先解锁或换一版。`
        : null,
    };
  }, []);
  const cloudProposal = useMemo(() => cloudViewOf(studio?.preview ?? null), [cloudViewOf, studio?.preview, studio?.stale, studio?.expired]);
  const activeProposal: ProposalView | null = proposal.current ? viewOfLocalPlan(proposal.current) : cloudProposal;

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
      say({ role: 'user', text: file.name, meta: '图片 · 1 页' });
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
      if (file && phaseRef.current !== 'generating') void acceptFile(file);
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [callbacks.workbenchMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const phaseRef = useRef(phase); phaseRef.current = phase;

  // 提案算的是「从这一帧场景出发」的候选：人手动改过物料或场地，旧候选就不再代表现状，作废。
  const pendingPhase = phase === 'proposed' || phase === 'paused';
  useEffect(() => {
    if (!pendingPhase) return;
    if (!proposal.current || !proposalBase.current || live.current === proposalBase.current) return;
    invalidateProposal('画布在这期间被改过了');
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
  function shellNote(scene: SceneV2, cleared: number): string {
    const venue = scene.venue;
    const notes = [`${formatArea(venue.width)} × ${formatArea(venue.depth)} m`];
    notes.push(venue.site?.indoorOutdoor === 'outdoor'
      ? '户外场地，这一版先不砌墙也不开门'
      : '室内壳子，四面外墙、正面留了一个主入口，门位标的是待确认');
    notes.push(venue.heightSource === 'default' ? `层高没听你说，先按默认 ${formatArea(venue.height)} m` : `层高 ${formatArea(venue.height)} m`);
    if (venue.site?.scale?.confidence === 'low') notes.push('尺寸是我沿用画布当前的空地，不对就说一句「12×9」这样告诉我');
    if (cleared) notes.push(`画布上原来 ${cleared} 件物料放不下这个新壳体，我先撤了`);
    return `场地立起来了：${notes.join('，')}。`;
  }

  /** 模板是固定 GLB 外壳：改尺寸时明说已经离开模板，别让人以为只是把体育馆拉长了。 */
  function presetShellNote(venue: VenuePlan): string {
    const size = `${formatArea(venue.scene.venue.width)} × ${formatArea(venue.scene.venue.depth)} m`;
    const dropped = venue.cleared ? `，另有 ${venue.cleared} 件自有物料放不下先撤了` : '';
    return `已离开模板：模板物件已撤，自有物料能留的都留了，按新尺寸 ${size} 立了矩形壳${dropped}。`;
  }

  /** 纯改尺寸只动壳：一句短的，不拉着人再确认一遍布置。 */
  function sizeOnlyNote(venue: VenuePlan, leavingPreset: boolean): string {
    if (leavingPreset) return presetShellNote(venue);
    const size = `${formatArea(venue.scene.venue.width)} × ${formatArea(venue.scene.venue.depth)} m`;
    const dropped = venue.cleared ? `，${venue.cleared} 件物料放不下先撤了` : '';
    return `场地改成 ${size}${dropped}。`;
  }

  /** 预览收回：画布退回确认前的样子，提案本身留着，还能接着摆。 */
  function hidePreview(): void { onPreview(null); }

  function dropProposal(): void {
    hidePreview();
    proposal.current = null; proposalBase.current = null; shownSteps.current = 0;
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
    const intro = lead ?? (plan.kind === 'review' ? '这版改法：' : '先出一版可拖的初稿：');
    setPhase('generating');
    for (let step = shownSteps.current; step < plan.layouts.length; step++) {
      onPreview(plan.layouts[step]!);
      setProgress(step + 1);
      shownSteps.current = step + 1;
      await wait(step === plan.layouts.length - 1 ? 120 : STEP_DELAY_MS);
      if (token !== runToken.current) return;
    }
    setPhase('proposed');
    const planView = viewOfLocalPlan(plan);
    const notes = planLines(planView);
    const tail = planView.review ? '还没落盘：点「确认布置」才挪，撤回就回原位。' : '还没落盘，点确认才写进画布。';
    say({ role: 'agent', amber: !!planView.blocked, text: planView.blocked
      ? `${planView.blocked}先出一版给你看着改：${notes.join('，')}。确认按钮暂时点不动，改好场地或解锁再出一版。`
      : `${intro}${notes.join('，')}。${tail}` });
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
  function resizeVenueOnly(scale: Scale, indoorOutdoor: VenueIO = venueIO): void {
    if (phase === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：先停一下，再改场地尺寸。' }); return; }
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
      revertScaleToCanvas();
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这个尺度我立不起来，说一句「12×9」这样告诉我新的长宽。' });
      return;
    }
    if (!venue) {
      revertScaleToCanvas();
      say({ role: 'agent', amber: true, text: '这个场地是导入或生成的复杂结构，不能只改外框；要换尺寸得先重新立一块矩形空地。' });
      return;
    }
    // 落盘走同一个确认回调（撤销/存快照都在里面），但只改外框不该把人从 2D 拽回 3D。
    const was2D = view.view2D;
    try { onApply(venue.layout); }
    catch (error) {
      revertScaleToCanvas();
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这个尺度落不下来，先挪一下物料再改。' });
      return;
    }
    if (was2D) setView(current => ({ ...current, view2D: true }));
    say({ role: 'agent', text: sizeOnlyNote(venue, !!before.scenePreset) });
  }

  /** 左栏简报的「空白场地」文字链：和模板轨首卡同一块 12×8 空壳，不用先开物料库。 */
  function startBlankVenue(): void {
    if (phase === 'generating') { say({ role: 'agent', amber: true, text: '还在出这一版：先停一下，再换空地。' }); return; }
    runToken.current++;
    if (proposal.current) dropProposal();
    discardCloudPreview();
    setPhase('idle'); setProgress(0);
    const was2D = view.view2D;
    try {
      onApply(createBlankVenue(live.current));
      if (was2D) setView(current => ({ ...current, view2D: true }));
      say({ role: 'agent', text: `空白场地立好了：${BLANK_VENUE.width} × ${BLANK_VENUE.depth} m，要调尺寸就说「改成 15×10」。` });
    } catch (error) {
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '空白场地没立起来，再试一次。' });
    }
  }

  /** 出方案 = 先立 T-01 的场地真相，再在立好的壳体上算一份候选。确认前 objects 不落盘。 */
  async function runLocal(token: number, variant: number, scale: Scale, seatPriority = false): Promise<void> {
    const before = live.current;
    const input = { base: before, floorIndex: activeFloorIndex, widthM: scale.length, depthM: scale.width, indoorOutdoor: venueIO, scaleOrigin: scale.origin };
    // 模板是固定 GLB 外壳，拉伸它只会看起来「什么都没变」：尺寸一变就卸模板、按新尺寸立矩形空壳。
    const resized = Math.abs(before.width - scale.length) > 1e-6 || Math.abs(before.height - scale.width) > 1e-6;
    const leavingPreset = resized && !!before.scenePreset;
    let venue: VenuePlan | null;
    try { venue = (resized ? replaceVenueWithShell(input) : null) ?? raiseVenue(input); }
    catch (error) {
      revertScaleToCanvas();
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这个尺度我立不起来，说一句「12×9」这样告诉我新的长宽。' });
      setPhase('failed'); return;
    }
    if (venue) {
      // 场地是 T-01 已经确认过的真相：改的是墙体尺寸，不是物料，所以先落它，预览才对得上墙。
      // 落盘走 provider 的 onApply：提交撤销历史、存快照都在里面，直接 applyLayout 会绕过撤销。
      try { onApply(venue.layout); }
      catch (error) {
        revertScaleToCanvas();
        say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这个尺度落不下来，先挪一下物料再改。' });
        setPhase('failed'); return;
      }
      say({ role: 'agent', text: leavingPreset ? presetShellNote(venue) : shellNote(venue.scene, venue.cleared) });
      await wait(STEP_DELAY_MS); if (token !== runToken.current) return;
    } else {
      // 预设/云端场景不重搭壳体，但这次的尺度就是布置边界：先把长宽对齐再算候选，
      // 否则按新尺度摆的桌椅会被旧边界判成放不下。等一帧再读 live，基线才包含这次的对齐。
      const current = live.current;
      if (Math.abs(current.width - scale.length) > 1e-6 || Math.abs(current.height - scale.width) > 1e-6) {
        try { onApply({ ...current, width: scale.length, height: scale.width }); }
        catch (error) {
          revertScaleToCanvas();
          say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这个尺度落不下来，先挪一下物料再改。' });
          setPhase('failed'); return;
        }
        await wait(STEP_DELAY_MS); if (token !== runToken.current) return;
      }
    }
    let plan: PlanProposal;
    try { plan = proposePlan({ base: live.current, floorIndex: activeFloorIndex, widthM: scale.length, depthM: scale.width, variant, guests: briefRef.current.guests, seatPriority, layoutMode: briefRef.current.layoutMode }); }
    catch (error) {
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这个尺度我摆不出来，说一句「12×9」这样告诉我新的长宽。' });
      setPhase('failed'); return;
    }
    proposal.current = plan; proposalBase.current = live.current; shownSteps.current = 0;
    await presentProposal(token);
  }

  /** 确认才写 objects：本地一次 applyLayout，进撤销栈，撤销一步能整体退回来。 */
  function confirmProposal(): void {
    if (callbacks.workbenchMode !== 'layout') {
      say({ role: 'agent', text: '现在不改布置。回左轨「布置」再确认这一版。' });
      return;
    }
    const plan = proposal.current;
    if (!plan) { confirmCloud(); return; }
    if (plan.blocked) { say({ role: 'agent', amber: true, text: plan.blocked }); return; }
    if (proposalBase.current && live.current !== proposalBase.current) { invalidateProposal('场景在这期间改过了'); return; }
    try { onApply(plan.layouts[plan.layouts.length - 1]!); }
    catch (error) {
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '这版放不下，先挪一下场地或物料再重出一版。' });
      return;
    }
    const added = plan.added;
    const final = plan.layouts[plan.layouts.length - 1];
    const finalFloor = final?.floors[Math.min(activeFloorIndex, final.floors.length - 1)];
    const total = finalFloor ? finalFloor.items.filter(item => !isStructuralMarker(item)).length : added;
    const review = plan.kind === 'review';
    const moved = plan.moved ?? 0;
    const skipped = plan.skipped?.length ?? 0;
    dropProposal();
    setPhase('ready'); setProgress(GEN_STEPS.length);
    say({ role: 'agent', text: review
      ? `确认了：${moved} 件换了位置，其他没动${skipped ? `；还有 ${skipped} 件没动（锁着或没找到落点）` : ''}。不想要就撤销一步，整体退回原位。`
      : `写进画布了：这一版一共 ${total} 件物料，都能直接拖；不想要就撤销一步，整体退回来。` });
    callbacks.onFit();
  }

  /**
   * 云端那一版的确认也只走这颗绿钮。`applyPreview` 成功会把预览清空、失败留下预览和一句原因，
   * 两者都要等它自己那一帧渲染完才读得到，所以这里只按下开关，结果交给下面的 effect 照实播报。
   */
  function confirmCloud(): void {
    const current = studioRef.current;
    if (!current?.preview) { say({ role: 'agent', amber: true, text: '这版已经不在预览里了，重新出一版再确认。' }); return; }
    if (current.stale || current.expired) { say({ role: 'agent', amber: true, text: CLOUD_STALE }); return; }
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
    if (current.preview) {
      say({ role: 'agent', amber: true, text: current.notice ? `没写进画布：${current.notice}` : '这版没写进画布，画布还是你确认前的样子。改一下场地或重新出一版。' });
      return;
    }
    setPhase('ready'); setProgress(GEN_STEPS.length);
    say({ role: 'agent', amber: !!current.notice, text: `写进画布了，物料都能直接拖；不想要就撤销一步，整体退回来。${current.notice ? ` ${current.notice}。` : ''}` });
    callbacks.onFit();
  }, [studio?.preview, studio?.busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // 深工具（活动需求表）走出的云预览也要落到这张卡上，否则画布有预览、右栏没有唯一的确认。
  useEffect(() => {
    const preview = studio?.preview ?? null;
    if (!preview) { announcedPreview.current = null; return; }
    if (phase === 'generating' || phase === 'paused') return;
    if (proposal.current) return;
    adoptCloudProposal();
  }, [studio?.preview, studio?.stale, studio?.expired, studio?.busy, studio?.recoverable, phase]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const preview = studioRef.current?.preview ?? null;
    const view = cloudViewOf(preview);
    if (!view) return false;
    if (announcedPreview.current === preview && phaseRef.current === 'proposed') return true;
    announcedPreview.current = preview;
    lastSource.current = 'cloud';
    setProgress(GEN_STEPS.length); setPhase('proposed');
    say({ role: 'agent', amber: !!view.blocked, text: view.blocked
      ? `云端给了一版：${planLines(view).join('，')}。${view.blocked}`
      : `云端给了一版：${planLines(view).join('，')}。画布上是预览，还没落盘，点「确认布置」才写进画布。` });
    return true;
  }

  /** 把需求原话说给云端，并要它只回一份待确认的提案（requirePreview：确认前 objects 不落盘）。 */
  async function cloudRun(note: string, scale: Scale): Promise<void> {
    const current = studioRef.current;
    if (!current) return;
    const event = briefRef.current.event ?? current.brief.event ?? '这场活动';
    const guests = briefRef.current.guests ?? current.brief.guests;
    const size = `${venueIO === 'indoor' ? '室内' : '户外'} ${formatArea(scale.length * scale.width)} ㎡`;
    const mode = briefRef.current.layoutMode === 'desk-chair' ? ' · 一人一套课桌椅' : '';
    await current.generate(`${note ? `${note}：` : ''}${event}${guests ? ` · ${guests} 人` : ''} · ${size}${mode}，请出布置方案`, { requirePreview: true });
  }

  /** 出方案：连着云项目就让云端真 AI 算这一版，否则本地算候选。两条都停在「这版还在预览」。 */
  async function startGeneration(token: number, variant: number, note: string, scale: Scale, seatPriority = false): Promise<void> {
    const timeout = window.setTimeout(() => { if (token === runToken.current && phaseRef.current === 'generating') { runToken.current++; setPhase('failed'); } }, 60_000);
    try {
      if (forceFail()) throw new Error('forced');
      if (studioRef.current?.connection === '项目已连接') {
        lastSource.current = 'cloud'; setProgress(1);
        await cloudRun(note, scale);
        if (token === runToken.current && !adoptCloudProposal()) setPhase('failed');
        return;
      }
      lastSource.current = 'local';
      await runLocal(token, variant, scale, seatPriority);
    }
    catch { if (token === runToken.current) setPhase('failed'); }
    finally { window.clearTimeout(timeout); }
  }

  /** 生成只有一次触发：对话。这里是被认可后真正跑那一趟的唯一入口，画布上只出预览。 */
  function runGeneration(label: string | null, variant: number, note: string, scale: Scale, seatPriority = false): void {
    const token = ++runToken.current;
    if (label) say({ role: 'user', text: label });
    setIssue(null); dropProposal(); discardCloudPreview(); setExportPreview(false); setPhase('generating'); setProgress(0);
    void startGeneration(token, variant, note, scale, seatPriority);
  }

  /** 「这次没出成」那张卡上的重试：拿现在的读数再跑一遍，不另算一个入口。 */
  function retry(): void { runGeneration('重试', seed.current, '', readScale()); }
  /** 停一下：只收预览，画布退回确认前状态；提案留着，「接着摆」能续上。 */
  function stop(): void {
    if (phase !== 'generating') return;
    runToken.current++;
    const current = studioRef.current;
    if (lastSource.current === 'cloud' && current?.busy) {
      void current.cancelRun();
      setPhase('idle'); setProgress(0);
      say({ role: 'agent', text: '停了，云端任务取消，画布没动。要再出一版就说一句。' });
      return;
    }
    const local = proposal.current !== null;
    if (local) hidePreview();
    setPhase('paused');
    say({ role: 'agent', text: local ? '先停在这儿了，预览收回、画布没动。要接着看就点「接着摆」。' : '先停在这儿了，画布没动。' });
  }
  function resume(): void {
    if (phase !== 'paused') return;
    if (proposal.current) { void presentProposal(++runToken.current).catch(() => setPhase('failed')); return; }
    regenerate('接着摆');
  }
  function regenerate(label = '换一版'): void {
    seed.current += 1;
    runGeneration(label, seed.current, label === '换一版' ? '换一版不同的布局' : '', readScale());
  }
  /** 座位不够时的一点击改法：同一份需求按座位优先重排，仍然只出预览，确认前不落盘。 */
  function addSeats(): void {
    runGeneration('加座，再排一版', seed.current, '', readScale(), true);
  }

  /** T-UI §4-5：导出/交接意图先落预览卡，确认后才在本机直接生成；不跳执行页。 */
  /** 生成中、云端忙、恢复中、预览过期或基线变了：最后一帧没稳，不亮任何确认。 */
  function previewUnsettled(): boolean {
    const current = studioRef.current;
    if (phaseRef.current === 'generating' || phaseRef.current === 'paused') return true;
    if (current?.busy || current?.recoverable) return true;
    return !!(current?.preview && (current.stale || current.expired));
  }

  function proposeExport(): void {
    if (previewUnsettled()) {
      say({ role: 'agent', amber: true, text: '这一版还没稳，确认先不亮。等预览停住再说导出。' });
      return;
    }
    setExportPreview(true);
    say({ role: 'agent', text: '完整活动交接包含需求、物料、制作和点验，只在这台机器上生成。' });
  }

  function confirmExport(): void {
    setExportPreview(false);
    const studio = studioRef.current;
    if (!studio?.exportActivity) {
      say({ role: 'agent', amber: true, text: '导出入口还没就绪，稍后再试。' });
      return;
    }
    say({ role: 'agent', text: '好，我在本机生成完整活动交接。' });
    void studio.exportActivity().then(() => {
      say({ role: 'agent', text: '交接文件已下载，可离线打开与打印；只在这台机器上生成，由你交给搭建方。' });
    }).catch(error => {
      say({ role: 'agent', amber: true, text: error instanceof Error ? error.message : '导出没成，资料都还在，再试一次。' });
    });
  }

  function dismissExport(): void {
    setExportPreview(false);
    say({ role: 'agent', text: '好，先不导出。要导的时候说一声就行。' });
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim(); if (!trimmed) return;
    // 「停一下」是命令，不是需求：正在摆就停手，摆好了还没确认就撤回，别把它当成一句话记进简报。
    if (isStopCommand(trimmed) && (phase === 'generating' || phase === 'proposed' || phase === 'paused')) {
      say({ role: 'user', text: trimmed });
      if (phase === 'generating') stop(); else withdrawProposal();
      return;
    }
    say({ role: 'user', text: trimmed });
    if (callbacks.workbenchMode !== 'layout') {
      if (isClientReviewCommand(trimmed)) {
        callbacks.onOpenReview();
        say({ role: 'agent', text: '评审页在左边开了：离线 HTML 或云端只读链接，都由你发。' });
        return;
      }
      if (isExportCommand(trimmed)) { proposeExport(); return; }
      if (isMaterialListCommand(trimmed)) { replyMaterialList(); return; }
      say({ role: 'agent', text: '这里只看方案，不改布置。要挪物料，回左轨「布置」。' });
      return;
    }
    // 「按图纸估」= 说完了就往下走：估完尺寸直接出预览，不再让人补一句「出方案」。
    if (isEstimateCommand(trimmed)) {
      // 「300 平米，按图纸估」是一句话里的两件事：这句的面积要先记进记忆，估算才不会退回画布上的旧尺寸。
      const statedArea = parseBriefSentence(trimmed).areaM2;
      if (statedArea !== null) memoryRef.current = { ...memoryRef.current, areaM2: statedArea };
      estimateAndGenerate();
      return;
    }
    // 左栏那几件事先改走对话：加物料、出清单、写文案、换区，不再开第二套表单页。
    const request = parseMaterialRequest(trimmed);
    if (request) { addMaterials(request); return; }
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
    const command = isGenerateCommand(trimmed);
    // 话锋一变，上一版预览就不再代表这次的要求：先收掉，别让两张卡同屏打架。
    if (phase === 'proposed' || phase === 'paused') { dropProposal(); discardCloudPreview(); setPhase('idle'); setProgress(0); }
    // 对话核心：真模型（scene-api /brief/extract，key 在 Supabase secrets）优先提槽位，
    // 失败/未配置自动回退规则版；记忆合并、防复读、出方案闸门都在 brief-agent 状态机里。
    const turn = await resolveBriefTurn(trimmed, memoryRef.current, {
      venueUp, scaleTyped: lengthCheck.ok && widthCheck.ok, hasBase, command,
    }, studioRef.current?.controller ?? null);
    memoryRef.current = turn.memory;
    const extraction = turn.extraction;
    const merged = memoryExtraction(turn.memory);
    // 人数 / 类型 / 室内外 / 长宽先写进左栏简报，再决定出不出预览。云端忙也不能把这句漏掉。
    applyExtraction(extraction);
    syncMemory(turn.memory);
    const briefNote = syncStudioBrief(merged);
    const suffix = briefNote ? ` ${briefNote}` : '';
    const scale = scaleFrom(merged);
    const summary = describeExtraction(merged, scale);
    const carried = extraction.headcount === null && turn.memory.headcount !== null ? ` · 沿用 ${turn.memory.headcount} 人` : '';
    // 只说「改成 15×10」= 只动场地壳：不排布置、不出预览卡、不亮确认绿钮。
    // 例外：这是在补答追问的尺寸时，报完尺寸就该直接出方案。
    if (!command && !turn.filledScaleAsk && isVenueSizeOnly(extraction)) {
      resizeVenueOnly(scaleFrom(extraction), extraction.venueIO ?? turn.memory.venueIO ?? venueIO);
      return;
    }
    if (turn.kind !== 'generate') {
      say({ role: 'agent', text: turn.text });
      return;
    }
    const cloud = studioRef.current;
    if (cloud?.connection === '项目已连接') {
      // 连着云就只走云预览。忙或恢复中若退回本地生成，会在云端还没稳时亮一颗确认。
      if (cloud.busy || cloud.recoverable) {
        say({ role: 'agent', amber: true, text: `记下了：${summary}${carried}。云端还在处理上一版，确认先不亮。${suffix}` });
        return;
      }
      if (briefNote) say({ role: 'agent', text: briefNote });
      const token = ++runToken.current;
      setExportPreview(false);
      void cloud.generate(command === 'again' ? '换一版不同的布局' : trimmed, { requirePreview: true }).then(() => {
        if (token !== runToken.current) return;
        if (!adoptCloudProposal()) setPhase(current => (current === 'ready' ? 'edited' : current));
      });
      return;
    }
    say({ role: 'agent', text: turn.filledScaleAsk
      ? `记下了：${summary}${carried}。先出一版：画布上是预览，点「确认布置」才写进画布。${suffix}`
      : `按这些先出一版：${summary}${carried}。画布上是预览，点「确认布置」才写进画布。${suffix}` });
    const variant = command === 'again' ? (seed.current += 1, seed.current) : seed.current;
    runGeneration(null, variant, command === 'again' ? '换一版不同的布局' : '', scale);
  }

  // 提案态的重叠算在候选上；落盘之后才算画布上的（编辑器那份 collidingIds 这时候还是旧的）。
  const overlapCount = phase === 'proposed' ? activeProposal?.overlapCount ?? 0
    : phase === 'ready' || phase === 'edited' || phase === 'paused' ? activeFloor.items.filter(item => collidingIds.has(item.id)).length : 0;

  // 回显只读：填过/说过用说的；没说过就报画布当前的米数——角标一直报真实尺寸，
  // 简报不能还写「尺寸还没定」，两处对不上会让人以为场地没立起来。
  // 面积折算与图纸估算是推出来的，后缀必须跟着走，不能静态数字装成场地真相。
  const stated = lengthCheck.ok && widthCheck.ok ? `${formatArea(lengthCheck.value)} × ${formatArea(widthCheck.value)} m` : null;
  // 没保存过的表单默认值（品牌快闪 / 24 人）不是对话意图，不能冒充简报；改过一项就是她填的，左栏动、右栏跟着回显。
  const formBrief = studio && (studio.hasSavedBrief || studio.brief.event !== INITIAL_BRIEF.event || studio.brief.guests !== INITIAL_BRIEF.guests) ? studio.brief : null;
  const guests = brief.guests ?? formBrief?.guests ?? null;
  const recap = {
    event: brief.event ?? formBrief?.event ?? null,
    guests: guests ? `${guests} 人` : null,
    dims: `${venueIO === 'indoor' ? '室内' : '户外'} · ${stated
      ? `${stated}${scaleOrigin === 'area' ? ' 折算' : scaleOrigin === 'plan' ? ' 估的' : ''}`
      : `${formatArea(layout.width)} × ${formatArea(layout.height)} m`}`,
    note: hasBase && scaleOrigin === 'plan' ? '图纸只当参照，这个数是我估的' : null,
  };

  const value: AgentValue = {
    callbacks, state, venueIO, baseName, issue, dragging, recap, venueUp,
    setVenueIO: next => { setVenueIO(next); onVenueIOChange?.(next); if (next === 'indoor' && view.weather === 'rain') setView(current => ({ ...current, weather: 'clear' })); },
    progress, failed: phase === 'failed', overlapCount, bubbles, retry, stop, resume, regenerate,
    // 生成中与暂停在逐帧预览里：这一版还没长完，不给出可确认的卡片。
    proposal: phase === 'proposed' ? activeProposal : null,
    confirmProposal, withdrawProposal, cloudBusy: !!studio?.busy, recovering: !!studio?.recoverable,
    cloudStale: !!(studio?.preview && (studio.stale || studio.expired)), addSeats, startBlankVenue,
    mapPickerOpen, startMapVenuePicker: () => { setMapPickerOpen(value => !value); }, closeMapVenuePicker: () => setMapPickerOpen(false),
    applyMapVenuePick: pick => {
      if (phase === 'generating') { const reason = '还在出这一版：先停一下，再圈场地。'; say({ role: 'agent', amber: true, text: reason }); return reason; }
      runToken.current++;
      if (proposal.current) dropProposal();
      discardCloudPreview();
      setPhase('idle'); setProgress(0);
      const was2D = view.view2D;
      try {
        const { layout, cleared } = createVenueFromPick(live.current, pick);
        onApply(layout);
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
        const satNote = pick.satelliteGround
          ? '；已开卫星贴地参考底图（仅观感，不可作重建素材）'
          : '';
        say({ role: 'agent', text: `户外场地立好了：${pick.name} · 真实范围 ${Math.round(dims.width)} × ${Math.round(dims.depth)} m（外接矩形报米）${polyNote}${clamped ? '，布置壳取其中一块规划区（等比缩轮廓）' : ''}，${dropped}${satNote}。历史宴会厅环境预览正在挂到画布背景（只读复用 World 样例，不新开额度）；浮层收起后就能看见。采集单还在——再点「地图」可导出或上传现场素材做本场重建。` });
        return null;
      } catch (error) {
        const reason = error instanceof Error ? error.message : '地图场地没立起来，再试一次。';
        say({ role: 'agent', amber: true, text: reason });
        return reason;
      }
    },
    exportPreview, previewExport: proposeExport, confirmExport, dismissExport,
    acceptFile: file => { void acceptFile(file); }, retryFile: () => { if (lastFile.current) void acceptFile(lastFile.current); }, pickFile: () => fileInput.current?.click(),
    send, rainOn: view.weather === 'rain',
    previewRain: () => setView(current => ({ ...current, weather: 'rain', view2D: false })),
    walkthrough: () => setView(current => ({ ...current, walkthroughMode: true, view2D: false, measurementMode: false, drawWallMode: false })),
  };
  return <AgentContext.Provider value={value}>
    {children}
    <input ref={fileInput} type="file" hidden aria-hidden="true" tabIndex={-1} accept="image/png,image/jpeg,image/webp,.pdf,.dxf,.dwg" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void acceptFile(file); }}/>
  </AgentContext.Provider>;
}

/* ───────────────────────── 右栏 ───────────────────────── */

/** 抬头状态点只许两种说法：做好了 / 发现问题。等你确认、正在出方案由头像与卡片自己说话，不重复一遍。 */
function headerStatus(agent: AgentValue, mode: WorkbenchMode): { text: '做好了' | '发现问题'; tone: 'ok' | 'warn' } | null {
  if (mode !== 'layout') return { text: '做好了', tone: 'ok' };
  const s = agent.state;
  if (s === 'generateFailed') return { text: '发现问题', tone: 'warn' };
  if (s === 'planProposed') return agent.proposal?.blocked || (agent.proposal?.review && agent.proposal.overlapCount > 0)
    ? { text: '发现问题', tone: 'warn' } : null;
  if (s === 'planReady' || s === 'planEdited') {
    return agent.overlapCount > 0 ? { text: '发现问题', tone: 'warn' } : { text: '做好了', tone: 'ok' };
  }
  return null;
}

/**
 * 晴光头像按状态切独立切图（`qingguang-3d-40-{ask|done|issue}`）：
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
  if (s === 'generatePaused') return `${MASCOT_DIR}-40-ask.png`;
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
 * 评审·执行走左轨，模板·物料走底栏；这里不放输入框、不放生成按钮、不摆说明书。
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
        {!known && <button type="button" title="先给一块空地，尺寸回头在对话里说" onClick={agent.startBlankVenue}><SquareDashed size={16} aria-hidden="true"/><span>空白场地 · {BLANK_VENUE.width} × {BLANK_VENUE.depth} m</span></button>}
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
 */
export function MapRailButton(): JSX.Element {
  const agent = useAgent();
  return <nav className="sc-rail-tool-group" aria-label="地图选址">
    <button type="button" className={`sc-rail-tool${agent.mapPickerOpen ? ' is-active' : ''}`} aria-pressed={agent.mapPickerOpen} aria-label="地图选址"
      data-tip="地图" title={agent.venueUp ? '重新圈一块会替换现在的场地' : '搜地点 → 在卫星图上圈出边界 → 生成户外场地'} onClick={agent.startMapVenuePicker}><MapIcon size={24} aria-hidden="true"/></button>
  </nav>;
}

/**
 * 盖住画布的地图浮层：圈边界要看得清地块，左栏那条窄缝里一个像素就是一米多。
 * 场地已经立起来时同样进这里重圈——替换走 raiseVenue 那条老规矩，放得下的物料留着，放不下才撤并报数。
 */
export function MapVenueOverlay({ onReconUpload, onHangDemoEnvironment }: {
  /** 采集单拍完的素材要交给 Aholo 重建；重建入口可达时才传，按钮不会指向打不开的面板。 */
  onReconUpload?: ((preset: { name: string; hint: string }) => void) | undefined;
  /** D0：立壳成功后挂上历史 World .spz 背景；传入则自动收起浮层让画布可见。 */
  onHangDemoEnvironment?: (() => void) | undefined;
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
      // D0：立壳即挂历史 splat，并收起浮层露出画布；采集单状态仍留着，再开地图还能看见。
      if (!reason) {
        // 开了卫星贴地时先露出地面参考；样例 splat 可随后在环境预览手动挂。
        if (onHangDemoEnvironment && !pick.satelliteGround) onHangDemoEnvironment();
        agent.closeMapVenuePicker();
      }
    }} />
    {capture && <SiteCaptureCard plan={capture.plan} polygon={capture.polygon} name={capture.name} location={capture.location} onUpload={upload}/>}
  </div>;
}

function Bubbles({ agent }: { agent: AgentValue }): JSX.Element {
  return <>{agent.bubbles.map(bubble => bubble.role === 'user'
    ? <div key={bubble.id} className={`ap-user${bubble.meta || bubble.warn ? ' is-file' : ''}`}>{(bubble.meta || bubble.warn) && <FileImage size={16} aria-hidden="true"/>}<div><strong>{bubble.text}</strong>{bubble.meta && <small>{bubble.meta}</small>}{bubble.warn && <small className="ap-warn"><span aria-hidden="true">!</span>{bubble.warn}</small>}</div></div>
    : <div key={bubble.id} className="ap-turn">
      <p className={`ap-agent${bubble.amber ? ' is-amber' : ''}${bubble.long ? ' is-long' : ''}`}>{bubble.text}</p>
      {bubble.action && <button type="button" className="ap-bubble-action" onClick={bubble.action.run}>{bubble.action.label}</button>}
    </div>)}</>;
}

function GenProgress({ agent, paused }: { agent: AgentValue; paused?: boolean }): JSX.Element {
  const { layout } = useRoomEditor();
  const n = Math.max(1, agent.progress);
  return <div className="ap-card" id="gen-progress">
    <ol className="ap-steps">{GEN_STEPS.map((step, index) => {
      const done = agent.progress > index + 1;
      const current = !paused && index + 1 === n;
      return <li key={step} className={done ? 'is-done' : current ? 'is-current' : ''}>{done ? <Check size={12} aria-hidden="true"/> : current ? <Loader2 size={12} className="cr-spin" aria-hidden="true"/> : <span className="ap-dot" aria-hidden="true"/>}<span>{step}</span>{index === 0 && done && <small>{formatArea(layout.width)} × {formatArea(layout.height)} m</small>}</li>;
    })}</ol>
    <p id="cta-hint">{paused
      ? <>停在第 {n} 步 · <button type="button" className="ap-link" onClick={agent.resume}>接着摆</button> · <button type="button" className="ap-link" onClick={agent.withdrawProposal}>不要了</button></>
      : <>正在{GEN_STEPS[n - 1]} · <button type="button" className="ap-link" onClick={agent.stop}>停一下</button></>}</p>
  </div>;
}

/** 预览态：主钮「确认布置」，撤回与换一版走文字链，一屏只留一个绿钮。 */
function ProposalCard({ agent }: { agent: AgentValue }): JSX.Element | null {
  const { layout } = useRoomEditor();
  const plan = agent.proposal;
  if (!plan) return null;
  const names = plan.overlapNames.slice(0, 3).join('、');
  const review = !!plan.review;
  const guests = plan.guests && plan.guests > 0 ? plan.guests : 0;
  const seats = plan.seats ?? 0;
  const short = guests > 0 && seats < guests;
    // 云端还在写、或上一版还在恢复：最后一帧没稳，不亮确认。blocked / stale 同样不亮。
    const hold = agent.cloudBusy || agent.recovering;
  return <div className="ap-card ap-plan" id="plan-proposal">
    <strong>{review ? '改法预览' : '这版还在预览'}</strong>
    <p>{formatArea(venueArea(layout))} ㎡ · {review
      ? `只挪位置，其他没动 · 挪了 ${plan.changed} 件`
      : <>新摆 {plan.added} 件{plan.changed ? ` · 挪动 ${plan.changed} 件` : ''}{plan.removing ? ` · 要撤 ${plan.removing} 件旧的` : ''}</>}</p>
    {guests > 0 && <p className="ap-seats" id="plan-seats">{short ? `座位 ${seats} / ${guests} · 还差 ${guests - seats}` : `按 ${guests} 人摆了 ${seats} 座`}</p>}
    {short && !plan.seatPriority && <p className="ap-small ap-seat-fix"><button type="button" className="ap-link" onClick={agent.addSeats}>加座，再排一版</button></p>}
    {short && plan.seatPriority && <p className="ap-small" id="plan-seat-cap">场地最多摆得下 {seats} 座；要再多人，得换更大的场地或按站立留空。</p>}
    {plan.overlapCount > 0 && <p className="ap-warn-line"><span aria-hidden="true">!</span>{review ? '改完还剩 ' : ''}{plan.overlapCount} 件挤在一起或压到墙：{names}{plan.overlapNames.length > 3 ? ' 等' : ''}。</p>}
    {plan.keptLocked > 0 && <p className="ap-small">锁定 {plan.keptLocked} 件我没动。</p>}
    {review && !!plan.skipped?.length && <p className="ap-small">没动 {plan.skipped.length} 件：{plan.skipped.slice(0, 3).join('、')}{plan.skipped.length > 3 ? ' 等' : ''}（锁着或没找到稳妥落点）。</p>}
    {plan.blocked && <p className="ap-warn-line"><span aria-hidden="true">!</span>{plan.blocked}</p>}
    {hold
      ? <p className="ap-small" id="plan-busy" role="status">{agent.recovering && !agent.cloudBusy ? '上一版还在恢复，确认先不亮。' : '正在整理这一版…'}</p>
      : <>
          {!plan.blocked && !agent.exportPreview && <button id="step-cta" type="button" className="btn-primary" onClick={agent.confirmProposal}>确认布置</button>}
          <p id="cta-hint"><button type="button" className="ap-link" onClick={agent.withdrawProposal}>撤回</button>{!review && <> · <button type="button" className="ap-link" onClick={() => agent.regenerate()}>换一版</button></>}</p>
        </>}
  </div>;
}

export function AgentPanel({ onClose }: { onClose?(): void } = {}): JSX.Element {
  const agent = useAgent();
  const { layout, activeFloor } = useRoomEditor();
  const mode = agent.callbacks.workbenchMode;
  const [draft, setDraft] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const status = headerStatus(agent, mode);
  const demo = isDemoBackend();
  const items = materialCount(activeFloor.items);
  useEffect(() => { feed.current?.scrollTo?.({ top: feed.current.scrollHeight }); }, [agent.bubbles.length, agent.state, mode]);
  const generating = agent.state === 'generating';
  const proposed = agent.state === 'planProposed';
  const paused = agent.state === 'generatePaused';
  const planShown = agent.state === 'planReady' || agent.state === 'planEdited';
  const preStates = !generating && !proposed && !paused && !planShown && agent.state !== 'generateFailed';
  // 回看不编数字：人没说人数就不写「0 人」。读数只算一次，回显卡和落盘那行共用。
  const recap = [agent.recap.event, agent.recap.guests, agent.recap.dims].filter(Boolean).join(' · ');

  return <aside id="agent-panel" className="sc-agent-panel" data-state={mode === 'layout' ? agent.state : mode} data-venue-io={agent.venueIO} aria-label="Agent">
    <header className="ap-head">
      <span className="mascot-slot" title="晴光在线">
        <img src={mascotOf(agent, mode)} alt="晴光" width={64} height={64} draggable={false}/>
        <span className="ap-online-dot" aria-label="在线" role="status"/>
      </span>
      <strong>Agent</strong>
      {status && <span id="agent-state" className={`ap-status is-${status.tone}`}><span className="ap-status-dot" aria-hidden="true"/>{status.text}</span>}
      {/* T-UI：隐藏 n/4 向导进度条，不制造「交付 4/4」的表单感；阶段只留在浮窗小字里。 */}
      {/* 收起面板一步直达：✕ 直接 onClose，收起后画布右上留重开浮卡。 */}
      {onClose && <button type="button" className="ap-close" aria-label="关闭 Agent" title="关闭 Agent" onClick={onClose}><X size={20} aria-hidden="true"/></button>}
    </header>
    <div className="ap-feed" ref={feed} aria-live="polite">
      {demo && <p className="ap-demo-note" role="note">演示环境 · 方案由本机规则生成，未连接真实 AI 模型</p>}
      {mode === 'layout' && planShown && <p className="ap-recap recap-done"><Check size={16} aria-hidden="true"/>{recap}</p>}
      {mode === 'review' && <><p className="ap-divider">评审 · {layout.name || '未命名活动'}</p><p className="ap-agent">{formatArea(venueArea(layout))} ㎡ · {items} 件物料</p></>}
      {mode === 'delivery' && <p className="ap-divider">执行 · 本机内部资料 · {layout.name || '未命名活动'}</p>}
      {/* 对话记录三种模式共用：评审/执行里说过的话也得看得见，不然输入框就成了摆设。 */}
      <Bubbles agent={agent}/>
      {mode === 'layout' && <>
        {preStates && agent.issue && <div className="ap-chips">{agent.issue.kind === 'readFailed' ? <><button type="button" className="chip is-on" onClick={agent.retryFile}>重试</button><button type="button" className="chip" onClick={agent.pickFile}>换个文件</button></> : <button type="button" className="chip is-on" onClick={agent.pickFile}>重新选文件</button>}</div>}
        {(generating || paused) && <GenProgress agent={agent} paused={paused}/>}
        {agent.state === 'generateFailed' && <div id="inline-error" className="ap-inline-error" role="alert">
          <p><span aria-hidden="true">!</span>这次没出成，场地和设置都还在。可能是网络断了，重试就好。</p>
          <p><button type="button" className="ap-link" onClick={agent.retry}><RotateCw size={16} aria-hidden="true"/>重试</button> · <button type="button" className="ap-link" onClick={() => { const input = document.getElementById('ap-input'); input?.focus(); }}>改一句再说</button></p>
        </div>}
        {proposed && <ProposalCard agent={agent}/>}
        {planShown && <>
          <div className="ap-card ap-plan" id="plan-summary">
            <strong>这一版布置</strong>
            <p>{formatArea(venueArea(layout))} ㎡ · {items} 件物料</p>
            {agent.overlapCount > 0 ? <p className="ap-warn-line"><span aria-hidden="true">!</span>{agent.overlapCount} 件物料重叠或超出场地，画布上已用黄色标出。</p> : <p className="ap-ok-line">没有重叠，也没超出场地。</p>}
            <div className="ap-chips">
              <button type="button" className="chip" onClick={() => agent.regenerate()}>换一版</button>
              <button type="button" className="chip" onClick={agent.callbacks.onOpenMaterials}>我来调</button>
              <button type="button" className="chip btn-outline" onClick={agent.walkthrough}>走一遍给客户看</button>
            </div>
          </div>
        </>}
      </>}
      {mode === 'review' && <div className="ap-card">
        <div className="ap-chips">
          <button type="button" className="chip btn-outline" onClick={agent.callbacks.onOpenReview}>打开客户评审</button>
          <button type="button" className="chip btn-outline" onClick={agent.walkthrough}>走一遍给客户看</button>
          {agent.venueIO === 'outdoor' && <button type="button" className={`chip${agent.rainOn ? ' is-on' : ''}`} onClick={agent.previewRain}>看看下雨天</button>}
        </div>
      </div>}
      {mode === 'delivery' && <div className="ap-card">
        <p className="ap-small">{items} 件物料 · {formatArea(venueArea(layout))} ㎡</p>
        <div className="ap-chips">
          <button type="button" className="chip btn-outline" onClick={agent.previewExport}>导出交接</button>
          <button type="button" className="chip btn-outline" onClick={agent.callbacks.onOpenDelivery}>打开执行资料</button>
        </div>
      </div>}
      {agent.exportPreview && <div className="ap-card" id="export-preview">
        <strong>导出完整活动交接</strong>
        <p className="ap-small">活动需求、物料工作单、制作计划、数量点验 · 本机生成</p>
        {generating || paused || agent.cloudBusy || agent.recovering || agent.cloudStale
          ? <p className="ap-small" role="status">这一版还没稳，确认先不亮。</p>
          : <button type="button" className="btn-primary" onClick={agent.confirmExport}>确认导出</button>}
        <p className="ap-small"><button type="button" className="ap-link" onClick={agent.dismissExport}>先不了</button></p>
      </div>}
    </div>
    <form id="composer" className="ap-composer" onSubmit={event => { event.preventDefault(); void agent.send(draft); setDraft(''); }}>
      <label className="sr-only" htmlFor="ap-input">告诉 Agent 要改的</label>
      <textarea id="ap-input" ref={inputRef} rows={2} value={draft} maxLength={600} placeholder={generating ? '说「停一下」我就先停' : mode === 'review' ? '说一句，比如「准备客户评审」' : mode === 'delivery' ? '说一句，比如「导出给搭建方」' : '说一句，比如「80 人发布会，室内 12×9」'} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void agent.send(draft); setDraft(''); } }}/>
      <div className="ap-composer-bar">
        <button type="button" className="ap-attach" aria-label="附图纸 / 现场照片" title="附图纸 / 现场照片" onClick={agent.pickFile} disabled={mode !== 'layout' || generating}><Paperclip size={20} aria-hidden="true"/></button>
        <button type="submit" className="ap-send" aria-label="发送" disabled={!draft.trim()}><ArrowUp size={20}/></button>
      </div>
    </form>
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
  const mode = agent.callbacks.workbenchMode;
  const status = headerStatus(agent, mode);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);

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
      className={`sc-agent-reopen is-orb${isDragging ? ' is-dragging' : ''}`}
      data-tone={tone}
      aria-label="打开晴光 Agent"
      title={status ? `晴光 · ${status.text} · 点开，按住可拖` : '晴光 · 点开，按住可拖'}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragState.current = null; setIsDragging(false); }}
    >
      <img src={mascotOf(agent, mode)} alt="" width={40} height={40} draggable={false}/>
      {status && <span className={`sc-agent-reopen-dot is-${status.tone}`} aria-hidden="true"/>}
    </button>
  );
}

export function AgentCanvasOverlay(): JSX.Element | null {
  const agent = useAgent();
  const { activeFloor, collidingIds } = useRoomEditor();
  const { view, setView } = useRoomEditor();
  const overlapNames = useMemo(() => Array.from(new Set(activeFloor.items.filter(item => collidingIds.has(item.id)).map(item => item.name))), [activeFloor.items, collidingIds]);
  // 漫游预览（只改视图，不写入场景）：退出时 use-walkthrough 会把相机放回进入前的位置。
  if (view.walkthroughMode && !view.view2D) return <div className="ap-canvas-layer"><button id="walk-exit" type="button" className="ap-canvas-pill is-top" onClick={() => setView(current => ({ ...current, walkthroughMode: false }))}>退出漫游 · Esc</button></div>;
  if (agent.callbacks.workbenchMode !== 'layout') return null;
  const s = agent.state;
  return <div className="ap-canvas-layer" aria-live="polite">
    {s === 'dragHover' && <div id="drop-zone"><div className="ap-drop-card"><FileImage size={24} aria-hidden="true"/><strong>松手铺成底图</strong><small>图片 · 20 MB 以内</small></div></div>}
    {agent.baseName && s !== 'dragHover' && <div id="base-chip" className="ap-canvas-chip">底图 · {agent.baseName} · 仅作参照</div>}
    {s === 'generating' && <div id="gen-note" className="ap-canvas-pill is-top"><Loader2 size={16} className="cr-spin" aria-hidden="true"/> 正在{GEN_STEPS[Math.max(0, agent.progress - 1)]}</div>}
    {s === 'generateFailed' && <div id="gen-note" className="ap-canvas-pill is-top is-warn">! 这次没出成，场地和设置都还在</div>}
    {s === 'planProposed' && agent.proposal && agent.proposal.overlapNames.length > 0 && <div id="overlap-note" className="ap-canvas-pill is-top is-warn" role="status">⚠ 这版里 {agent.proposal.overlapCount} 件挤了或压墙：{agent.proposal.overlapNames.slice(0, 4).join('、')}{agent.proposal.overlapNames.length > 4 ? ' 等' : ''}</div>}
    {(s === 'planReady' || s === 'planEdited') && overlapNames.length > 0 && <div id="overlap-note" className="ap-canvas-pill is-top is-warn" role="status">⚠ 重叠或超出场地：{overlapNames.slice(0, 4).join('、')}{overlapNames.length > 4 ? ' 等' : ''}</div>}
  </div>;
}
