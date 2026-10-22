'use client';

/**
 * v2.4 布置第 1–3 步 · 右栏对话优先的 Agent 面板（#agent-panel）+ 画布上的状态层。
 * 全部是页面本地状态：室内/户外开关、底图状态、长宽输入都不进 schema。
 * 出方案：已连接云项目时走现有 AI 生成；否则用现有本地物料组（furniture-sets / surprise）分 5 步真实摆放，
 * 不新增算法。底图只收图片（复用 layout.floorPlanImage），不识别、不显示任何米数。
 */
import { ArrowUp, Check, FileImage, Loader2, PanelRightClose, Paperclip, RotateCw } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRoomEditor } from '../contexts';
import { EVENT_CATALOG } from '../lib/constants';
import { readImageAsDataUrl } from '../lib/file-io';
import { buildFurnitureSet, FURNITURE_SETS, setFitsRoom } from '../lib/furniture-sets';
import { materialCount, venueArea } from '../lib/structural-layout';
import { surpriseLayout } from '../lib/surprise';
import type { FurnitureItem } from '../lib/types';
import type { WorkbenchMode } from '../lib/workbench-mode';
import {
  NON_IMAGE_MESSAGE, canGenerate, checkDim, classifyFile, DEFAULT_ANSWERS, EVENT_TYPES, fileSizeLabel, formatArea, GEN_STEPS, HEADCOUNTS,
  isStopCommand, sanitizeDimInput, type AgentAnswers, type AgentState, type DimCheck, type VenueIO,
} from '../lib/workbench-agent';
import { useStudioAgent } from './creative-studio';
import './agent-panel.css';

const MASCOT_SRC = '/assets/assistant/qingguang-3d-24@2x.png';
const STEP_DELAY_MS = 420;

type FileIssue = { kind: 'nonImage' | 'unsupported' | 'tooLarge' | 'readFailed'; name: string; size: number };
type Bubble = { id: string; role: 'user' | 'agent'; text: string; meta?: string; warn?: string; amber?: boolean };

export interface LayoutAgentCallbacks {
  workbenchMode: WorkbenchMode;
  onOpenMaterials(): void;
  onSelectMode(mode: WorkbenchMode): void;
  onOpenReview(): void;
  onOpenDelivery(): void;
  onFit(): void;
}

interface AgentValue {
  callbacks: LayoutAgentCallbacks;
  state: AgentState; venueIO: VenueIO; setVenueIO(value: VenueIO): void;
  answers: AgentAnswers; setAnswers(value: AgentAnswers): void;
  baseName: string | null; issue: FileIssue | null; dragging: boolean;
  lengthText: string; widthText: string; setLengthText(value: string): void; setWidthText(value: string): void;
  lengthCheck: DimCheck; widthCheck: DimCheck; showDimErrors: boolean; touchDims(): void;
  progress: number; failed: boolean; overlapCount: number; bubbles: Bubble[];
  ctaEnabled: boolean; generate(): void; stop(): void; regenerate(label?: string): void; editSettings(): void;
  acceptFile(file: File): void; retryFile(): void; pickFile(): void;
  send(text: string): void; rainOn: boolean; previewRain(): void; walkthrough(): void;
}

const AgentContext = createContext<AgentValue | null>(null);
function useAgent(): AgentValue { const value = useContext(AgentContext); if (!value) throw new Error('Agent panel unavailable'); return value; }

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const wait = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
const withId = (item: FurnitureItem): FurnitureItem => ({ ...item, id: uid() });

export function LayoutAgentProvider({ callbacks, onVenueIOChange, children }: { callbacks: LayoutAgentCallbacks; onVenueIOChange?(value: VenueIO): void; children: ReactNode }): JSX.Element {
  const { layout, activeFloor, actions, view, setView, collidingIds } = useRoomEditor();
  const studio = useStudioAgent();
  const [venueIO, setVenueIO] = useState<VenueIO>('indoor');
  const [answers, setAnswers] = useState<AgentAnswers>(DEFAULT_ANSWERS);
  const [baseName, setBaseName] = useState<string | null>(null);
  const [issue, setIssue] = useState<FileIssue | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lengthText, setLengthRaw] = useState('');
  const [widthText, setWidthRaw] = useState('');
  const [dimsTouched, setDimsTouched] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'generating' | 'paused' | 'failed' | 'ready' | 'edited'>('idle');
  const [progress, setProgress] = useState(0);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const lastFile = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const runToken = useRef(0);
  const seed = useRef(1);
  const colliding = useRef(collidingIds); colliding.current = collidingIds;
  const live = useRef(layout); live.current = layout;
  const dragDepth = useRef(0);
  const touchTimer = useRef<number | null>(null);

  const lengthCheck = checkDim(lengthText, '长度');
  const widthCheck = checkDim(widthText, '宽度');
  const dimsInvalid = (!lengthCheck.ok && !lengthCheck.empty) || (!widthCheck.ok && !widthCheck.empty);
  const hasBase = baseName !== null;

  const say = useCallback((bubble: Omit<Bubble, 'id'>) => setBubbles(items => [...items.slice(-30), { id: uid(), ...bubble }]), []);

  // 长宽合法后同步到场地尺寸（layout.width / height 是已有字段）。
  useEffect(() => {
    if (!lengthCheck.ok || !widthCheck.ok) return;
    const current = live.current;
    if (Math.abs(current.width - lengthCheck.value) < 1e-6 && Math.abs(current.height - widthCheck.value) < 1e-6) return;
    actions.applyLayout({ ...current, width: lengthCheck.value, height: widthCheck.value });
  }, [lengthCheck.ok, widthCheck.ok, lengthCheck.ok ? lengthCheck.value : 0, widthCheck.ok ? widthCheck.value : 0, actions]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLengthText = (value: string) => { setLengthRaw(sanitizeDimInput(value)); scheduleTouch(); };
  const setWidthText = (value: string) => { setWidthRaw(sanitizeDimInput(value)); scheduleTouch(); };
  function scheduleTouch(): void {
    if (touchTimer.current) window.clearTimeout(touchTimer.current);
    touchTimer.current = window.setTimeout(() => setDimsTouched(true), 400);
  }
  useEffect(() => () => { if (touchTimer.current) window.clearTimeout(touchTimer.current); runToken.current++; }, []);

  const state: AgentState = dragging ? 'dragHover'
    : phase === 'generating' ? 'generating' : phase === 'paused' ? 'generatePaused' : phase === 'failed' ? 'generateFailed'
    : phase === 'edited' ? 'planEdited' : phase === 'ready' ? 'planReady'
    : hasBase && dimsTouched && dimsInvalid ? 'dimsInvalid'
    : issue ? (issue.kind === 'nonImage' ? 'nonImageRejected' : issue.kind === 'tooLarge' ? 'fileTooLarge' : issue.kind === 'readFailed' ? 'fileReadFailed' : 'fileUnsupported')
    : hasBase ? (lengthCheck.ok && widthCheck.ok ? 'baseReady' : 'baseNoDims') : 'empty';

  const ctaEnabled = canGenerate(state, hasBase, lengthCheck, widthCheck) && !(phase === 'generating');

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
      await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth > 0 ? resolve() : reject(new Error('empty')); image.onerror = () => reject(new Error('decode')); image.src = url; });
      actions.setFloorPlan(url);
      setView(current => ({ ...current, showReferenceImage: true, referenceImageOpacity: 0.6 }));
      setIssue(null); setBaseName(file.name);
      say({ role: 'user', text: file.name, meta: '图片 · 1 页' });
      say({ role: 'agent', text: '图纸已铺成底图，照着填一下长宽就行。' });
      queueMicrotask(() => document.getElementById('in-length')?.focus());
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

  async function runLocal(token: number, variant: number): Promise<void> {
    const alive = () => token === runToken.current;
    const width = live.current.width, depth = live.current.height;
    // 1 读场地：清空现有物料，按当前长宽出空房间
    actions.clearItems(); setProgress(1); await wait(STEP_DELAY_MS); if (!alive()) return;
    // 2 定舞台位置：背景板贴后墙居中（现有物料库条目）
    const backdrop = EVENT_CATALOG.find(entry => entry.materialId === 'backdrop');
    if (backdrop) actions.addItems([{ ...backdrop, id: uid(), position: { x: 0, z: -depth / 2 + backdrop.depth / 2 + 0.4 }, rotation: 0 } as FurnitureItem]);
    setProgress(2); await wait(STEP_DELAY_MS); if (!alive()) return;
    // 3 摆桌椅：现有 dining 物料组，按面积放 1–4 组（固定槽位）
    const dining = FURNITURE_SETS.find(set => set.key === 'dining');
    if (dining && setFitsRoom(dining, width, depth)) {
      const slots = [{ x: -width / 4, z: depth / 8 }, { x: width / 4, z: depth / 8 }, { x: -width / 4, z: depth / 8 + 2.6 }, { x: width / 4, z: depth / 8 + 2.6 }];
      const count = Math.max(1, Math.min(4, Math.floor((width * depth) / 30)));
      const shift = (variant % 2 === 0 ? 0 : 0.6);
      const sets = slots.slice(0, count).flatMap(center => buildFurnitureSet(dining, { center: { x: center.x, z: center.z - shift }, roomWidth: width, roomDepth: depth }).map(withId));
      actions.addItems(sets);
    }
    setProgress(3); await wait(STEP_DELAY_MS); if (!alive()) return;
    // 4 放绿植：现有 surprise 生成器里的装饰，只取植物
    const plants = surpriseLayout({ roomWidth: width, roomDepth: depth, seed: 1000 + variant }).filter(item => item.id.includes('decor') && (item.type === 'plant' || item.type === 'flowerpot')).map(withId);
    if (plants.length) actions.addItems(plants);
    setProgress(4); await wait(STEP_DELAY_MS); if (!alive()) return;
    // 5 检查重叠：读编辑器现有的碰撞结果
    setProgress(5); await wait(80); if (!alive()) return;
    setPhase('ready'); callbacks.onFit();
  }

  function generate(): void {
    if (!ctaEnabled) return;
    const token = ++runToken.current;
    say({ role: 'user', text: phase === 'failed' ? '重试' : '就按这个出方案' });
    setIssue(null); setPhase('generating'); setProgress(0);
    const forceFail = process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('agentFail') === '1';
    const cloudReady = studio?.connection === '项目已连接';
    const run = forceFail ? wait(STEP_DELAY_MS).then(() => { throw new Error('forced'); })
      : cloudReady && studio ? (setProgress(1), studio.generate(`${answers.event} · ${answers.headcount} 人 · ${venueIO === 'indoor' ? '室内' : '户外'} ${formatArea(live.current.width * live.current.height)} ㎡，请出布置方案`).then(() => { if (token === runToken.current) { setProgress(5); setPhase('ready'); } }))
      : runLocal(token, seed.current);
    const timeout = window.setTimeout(() => { if (token === runToken.current && phaseRef.current === 'generating') { runToken.current++; setPhase('failed'); } }, 60_000);
    run.catch(() => { if (token === runToken.current) setPhase('failed'); }).finally(() => window.clearTimeout(timeout));
  }
  function stop(): void { if (phase !== 'generating') return; runToken.current++; setPhase('paused'); say({ role: 'agent', text: '先停在这儿了，已摆好的留着。' }); }
  function regenerate(label = '换一版'): void {
    seed.current += 1;
    const token = ++runToken.current;
    setPhase('generating'); setProgress(0); say({ role: 'user', text: label });
    runLocal(token, seed.current).catch(() => { if (token === runToken.current) setPhase('failed'); });
  }
  function editSettings(): void { runToken.current++; setPhase('idle'); setProgress(0); }

  function send(text: string): void {
    const trimmed = text.trim(); if (!trimmed) return;
    if (phase === 'generating' && isStopCommand(trimmed)) { say({ role: 'user', text: trimmed }); stop(); return; }
    say({ role: 'user', text: trimmed });
    if (studio?.connection === '项目已连接' && !studio.busy) { void studio.generate(trimmed).then(() => setPhase(current => current === 'ready' ? 'edited' : current)); return; }
    say({ role: 'agent', text: '一句话改要先登录并连上云项目；现在可以点「我来调」直接拖。' });
  }

  const overlapCount = phase === 'ready' || phase === 'edited' || phase === 'paused' ? activeFloor.items.filter(item => collidingIds.has(item.id)).length : 0;

  const value: AgentValue = {
    callbacks, state, venueIO, answers, setAnswers, baseName, issue, dragging,
    setVenueIO: next => { setVenueIO(next); onVenueIOChange?.(next); if (next === 'indoor' && view.weather === 'rain') setView(current => ({ ...current, weather: 'clear' })); },
    lengthText, widthText, setLengthText, setWidthText, lengthCheck, widthCheck,
    showDimErrors: dimsTouched, touchDims: () => setDimsTouched(true),
    progress, failed: phase === 'failed', overlapCount, bubbles, ctaEnabled, generate, stop, regenerate, editSettings,
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

const STAGES = ['说清活动', '出方案', '调整', '给甲方看', '交给搭建'] as const;

function headerStatus(agent: AgentValue, mode: WorkbenchMode): { text: string; tone: 'idle' | 'busy' | 'ok' | 'warn' } {
  if (mode !== 'layout') return { text: '做好了', tone: 'ok' };
  if (agent.state === 'generating') return { text: `出方案中 ${Math.max(1, agent.progress)}/5`, tone: 'busy' };
  if (agent.state === 'generateFailed') return { text: '没出成', tone: 'warn' };
  if ((agent.state === 'planReady' || agent.state === 'planEdited') && agent.overlapCount > 0) return { text: '发现问题', tone: 'warn' };
  if (agent.state === 'planReady' || agent.state === 'planEdited') return { text: '做好了', tone: 'ok' };
  return { text: '等你确认', tone: 'idle' };
}

function Choice<T extends string | number>({ label, value, options, format, onChange }: { label: string; value: T; options: readonly T[]; format(value: T): string; onChange(value: T): void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return <div className="ap-field">
    <span className="ap-field-label">{label}</span>
    <button type="button" className="ap-field-value" aria-expanded={open} aria-label={`${label}：${format(value)}，点击修改`} onClick={() => setOpen(current => !current)}>{format(value)}<span aria-hidden="true" className="ap-pen">✎</span></button>
    {open && <div className="ap-choices" role="group" aria-label={label}>{options.map(option => <button type="button" key={String(option)} className={`chip${option === value ? ' is-on' : ''}`} aria-pressed={option === value} onClick={() => { onChange(option); setOpen(false); }}>{format(option)}</button>)}</div>}
  </div>;
}

function DimInput({ id, label, text, check, focused, show, onChange, onBlur }: { id: string; label: string; text: string; check: DimCheck; focused: boolean; show: boolean; onChange(value: string): void; onBlur(): void }): JSX.Element {
  const invalid = show && !check.ok && !check.empty;
  return <label className="ap-dim">{label}<input id={id} inputMode="decimal" autoComplete="off" value={text} aria-invalid={invalid ? 'true' : 'false'} aria-describedby={invalid && focused ? `${id}-err` : undefined} className={invalid ? 'is-invalid' : ''} onChange={event => onChange(event.target.value)} onBlur={onBlur}/>m</label>;
}

function SummaryCard({ agent }: { agent: AgentValue }): JSX.Element {
  const { layout } = useRoomEditor();
  const [focus, setFocus] = useState<'length' | 'width'>('length');
  const base = agent.baseName !== null;
  const err = (() => {
    if (!base || !agent.showDimErrors) return null;
    const order = focus === 'length' ? [agent.lengthCheck, agent.widthCheck] : [agent.widthCheck, agent.lengthCheck];
    const ids = focus === 'length' ? ['in-length', 'in-width'] : ['in-width', 'in-length'];
    for (let index = 0; index < order.length; index++) { const check = order[index]!; if (!check.ok && !check.empty) return { message: check.message, id: ids[index]! }; }
    return null;
  })();
  const area = layout.width * layout.height;
  return <div className="ap-card" id="summary-card">
    <div className="ap-row">
      <Choice label="活动类型" value={agent.answers.event} options={EVENT_TYPES} format={value => value} onChange={value => agent.setAnswers({ ...agent.answers, event: value })}/>
      <Choice label="人数" value={agent.answers.headcount} options={HEADCOUNTS} format={value => `${value} 人`} onChange={value => agent.setAnswers({ ...agent.answers, headcount: value })}/>
    </div>
    <div className="ap-venue">
      <div className="ap-venue-head">
        <span className="ap-field-label">场地{base && <> · <span>按图纸填</span></>}</span>
        <div id="pf-io" className="ap-io" role="radiogroup" aria-label="室内或户外">
          {(['indoor', 'outdoor'] as const).map(io => <button key={io} type="button" role="radio" aria-checked={agent.venueIO === io} className={agent.venueIO === io ? 'is-on' : ''} onClick={() => agent.setVenueIO(io)}>{io === 'indoor' ? '室内' : '户外'}</button>)}
        </div>
      </div>
      {base ? <div className="ap-dims">
        <span onFocus={() => setFocus('length')}><DimInput id="in-length" label="长" text={agent.lengthText} check={agent.lengthCheck} focused={err?.id === 'in-length'} show={agent.showDimErrors} onChange={agent.setLengthText} onBlur={agent.touchDims}/></span>
        <span className="ap-times" aria-hidden="true">×</span>
        <span onFocus={() => setFocus('width')}><DimInput id="in-width" label="宽" text={agent.widthText} check={agent.widthCheck} focused={err?.id === 'in-width'} show={agent.showDimErrors} onChange={agent.setWidthText} onBlur={agent.touchDims}/></span>
      </div> : <div className="ap-area-row">
        <span className="ap-field-value is-static">{formatArea(area)} ㎡</span>
        <button type="button" className="ap-link" onClick={agent.pickFile}>按图纸填长宽</button>
      </div>}
      {err && <p className="ap-dim-error" id={`${err.id}-err`} role="alert"><span aria-hidden="true">!</span>{err.message}</p>}
    </div>
    <button id="step-cta" type="button" className="btn-primary" aria-disabled={agent.ctaEnabled ? 'false' : 'true'} onClick={() => { if (agent.ctaEnabled) agent.generate(); }}>让 Agent 整理需求</button>
    {base && !err && <p id="cta-hint" className={agent.lengthCheck.ok && agent.widthCheck.ok ? 'is-ok' : ''}>{agent.lengthCheck.ok && agent.widthCheck.ok ? `✓ ${agent.lengthCheck.value} × ${agent.widthCheck.value} m · ${formatArea(agent.lengthCheck.value * agent.widthCheck.value)} ㎡` : '填好长宽就能出'}</p>}
  </div>;
}

function Bubbles({ agent }: { agent: AgentValue }): JSX.Element {
  return <>{agent.bubbles.map(bubble => bubble.role === 'user'
    ? <div key={bubble.id} className={`ap-user${bubble.meta || bubble.warn ? ' is-file' : ''}`}>{(bubble.meta || bubble.warn) && <FileImage size={15} aria-hidden="true"/>}<div><strong>{bubble.text}</strong>{bubble.meta && <small>{bubble.meta}</small>}{bubble.warn && <small className="ap-warn"><span aria-hidden="true">!</span>{bubble.warn}</small>}</div></div>
    : <p key={bubble.id} className={`ap-agent${bubble.amber ? ' is-amber' : ''}`}>{bubble.text}</p>)}</>;
}

function GenProgress({ agent }: { agent: AgentValue }): JSX.Element {
  const { layout } = useRoomEditor();
  const n = Math.max(1, agent.progress);
  return <div className="ap-card" id="gen-progress">
    <ol className="ap-steps">{GEN_STEPS.map((step, index) => {
      const done = agent.progress > index + 1 || (agent.progress === 5 && index === 4 && agent.state !== 'generating');
      const current = agent.state === 'generating' && index + 1 === n;
      return <li key={step} className={done ? 'is-done' : current ? 'is-current' : ''}>{done ? <Check size={12} aria-hidden="true"/> : current ? <Loader2 size={12} className="cr-spin" aria-hidden="true"/> : <span className="ap-dot" aria-hidden="true"/>}<span>{step}</span>{index === 0 && done && <small>{formatArea(layout.width)} × {formatArea(layout.height)} m</small>}</li>;
    })}</ol>
    {agent.state === 'generating' && <>
      <button id="step-cta" type="button" className="btn-primary" aria-disabled="true"><Loader2 size={14} className="cr-spin" aria-hidden="true"/> 正在出方案 {n}/5</button>
      <p id="cta-hint"><button type="button" className="ap-link" onClick={agent.stop}>停一下</button> · 已摆好的会留着</p>
    </>}
  </div>;
}

export function AgentPanel({ onClose }: { onClose?(): void } = {}): JSX.Element {
  const agent = useAgent();
  const studio = useStudioAgent();
  const { layout, activeFloor, view } = useRoomEditor();
  const mode = agent.callbacks.workbenchMode;
  // S12：漫游退出后补一句（评审步）。
  const [walkDone, setWalkDone] = useState(false);
  const wasWalking = useRef(false);
  useEffect(() => { if (wasWalking.current && !view.walkthroughMode && mode === 'review') setWalkDone(true); wasWalking.current = view.walkthroughMode; }, [view.walkthroughMode, mode]);
  const [draft, setDraft] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const status = headerStatus(agent, mode);
  const stage = mode === 'review' ? 4 : mode === 'delivery' ? 5 : agent.state === 'generating' || agent.state === 'generateFailed' ? 2 : agent.state === 'planReady' || agent.state === 'planEdited' || agent.state === 'generatePaused' ? 3 : 1;
  const items = materialCount(activeFloor.items);
  useEffect(() => { feed.current?.scrollTo?.({ top: feed.current.scrollHeight }); }, [agent.bubbles.length, agent.state, mode]);
  const generating = agent.state === 'generating';
  const planShown = agent.state === 'planReady' || agent.state === 'planEdited' || agent.state === 'generatePaused';
  const signedIn = !!studio?.controller.getSnapshot().user;
  const recap = `${agent.answers.event} · ${agent.answers.headcount} 人 · ${agent.venueIO === 'indoor' ? '室内' : '户外'} ${formatArea(layout.width * layout.height)} ㎡`;
  const preStates = !generating && !planShown && agent.state !== 'generateFailed';

  return <aside id="agent-panel" className="sc-agent-panel" data-state={mode === 'layout' ? agent.state : mode} data-venue-io={agent.venueIO} aria-label="Agent">
    <header className="ap-head">
      <span className="mascot-slot"><img src={MASCOT_SRC} alt="晴光" width={24} height={24} draggable={false}/></span>
      <strong>Agent</strong>
      <span id="agent-state" className={`ap-status is-${status.tone}`}>{status.tone === 'busy' ? '⟳' : status.tone === 'ok' ? '✓' : status.tone === 'warn' ? '⚠' : '●'} {status.text}</span>
      <span className="ap-stage" aria-label={`第 ${stage} 步，共 5 步`}><small>{stage}/5</small> {STAGES[stage - 1]}<span className="ap-stage-bar" aria-hidden="true">{STAGES.map((label, index) => <i key={label} className={index < stage ? 'is-on' : ''}/>)}</span></span>
      {onClose && <button type="button" className="ap-close" aria-label="收起 Agent" title="收起 Agent" onClick={onClose}><PanelRightClose size={16} aria-hidden="true"/></button>}
    </header>
    <div className="ap-intro">
      <div className="ap-intro-head"><strong>一句话开始策划</strong><span className={`ap-badge${studio?.hasSavedBrief ? ' is-done' : ''}`}>{studio?.hasSavedBrief ? '需求已填写' : '尚未填写'}</span></div>
      <p className="ap-intro-hint">人数与现场条件待确认，示例布置仅供规划参考。</p>
    </div>
    <div className="ap-feed" ref={feed} aria-live="polite">
      {mode === 'layout' && <>
        <p className="ap-divider">新项目 · {layout.name || '未命名活动'}</p>
        {(agent.baseName === null || !preStates) && <p className="ap-agent">我先按常见情况填好了，不对直接点改。</p>}
        {!preStates && <p className="ap-recap recap-done"><Check size={12} aria-hidden="true"/>{recap}</p>}
        <Bubbles agent={agent}/>
        {preStates && <SummaryCard agent={agent}/>}
        {preStates && <div className="ap-starts">
          <p className="ap-starts-title">没有想法？从这里开始！</p>
          <div className="ap-starts-grid">
            <button type="button" onClick={() => inputRef.current?.focus()}><span>描述活动需求</span></button>
            <button type="button" onClick={agent.pickFile}><span>上传现场资料</span></button>
            <button type="button" onClick={agent.callbacks.onOpenDelivery}><span>整理物料交接</span></button>
          </div>
        </div>}
        {preStates && agent.baseName === null && agent.bubbles.length === 0 && <p className="ap-small">有图纸就拖进来，我铺成底图。</p>}
        {agent.venueIO === 'outdoor' && preStates && <div id="ambience-nudge" className="ap-nudge"><p>户外场地，可以先看看下雨天的样子。</p><button type="button" className={`chip${agent.rainOn ? ' is-on' : ''}`} aria-pressed={agent.rainOn} onClick={agent.previewRain}>看看下雨天</button></div>}
        {preStates && agent.issue && <div className="ap-chips">{agent.issue.kind === 'readFailed' ? <><button type="button" className="chip is-on" onClick={agent.retryFile}>重试</button><button type="button" className="chip" onClick={agent.pickFile}>换个文件</button></> : <button type="button" className="chip is-on" onClick={agent.pickFile}>重新选文件</button>}</div>}
        {generating && <><p className="ap-agent">正在{GEN_STEPS[Math.max(0, agent.progress - 1)]}，摆好一件画布上出一件。</p><GenProgress agent={agent}/></>}
        {agent.state === 'generateFailed' && <div id="inline-error" className="ap-inline-error" role="alert">
          <p><span aria-hidden="true">!</span>这次没摆出来，可能是网络断了。设置都还在，重试就好。</p>
          <button id="step-cta" type="button" className="btn-primary" onClick={agent.generate}><RotateCw size={14} aria-hidden="true"/> 重试</button>
          <button type="button" className="ap-link" onClick={agent.editSettings}>改一下设置再出</button>
        </div>}
        {planShown && <>
          <div className="ap-card ap-plan" id="plan-summary">
            <strong>方案摆好了</strong>
            <p>{formatArea(venueArea(layout))} ㎡ · {items} 件物料</p>
            {agent.overlapCount > 0 ? <p className="ap-warn-line"><span aria-hidden="true">!</span>{agent.overlapCount} 件物料重叠或超出场地，画布上已用黄色标出。</p> : <p className="ap-ok-line">没有重叠，也没超出场地。</p>}
            <div className="ap-chips">
              {agent.state === 'generatePaused' && <button type="button" className="chip is-on" onClick={() => agent.regenerate('接着摆')}>接着摆</button>}
              <button type="button" className="chip" onClick={() => agent.regenerate()}>换一版</button>
              <button type="button" className="chip" onClick={agent.callbacks.onOpenMaterials}>我来调</button>
              <button type="button" className="chip btn-outline" onClick={agent.walkthrough}>走一遍给客户看</button>
              {agent.venueIO === 'outdoor' && <button type="button" className={`chip${agent.rainOn ? ' is-on' : ''}`} onClick={agent.previewRain}>看看下雨天</button>}
            </div>
            <button id="step-cta" type="button" className="btn-primary" onClick={() => agent.callbacks.onSelectMode('review')}>下一步：给甲方看</button>
          </div>
        </>}
      </>}
      {mode === 'review' && <>
        <p className="ap-divider">评审 · {layout.name || '未命名活动'}</p>
        <p className="ap-agent">方案 {formatArea(venueArea(layout))} ㎡ · {items} 件物料。发个链接给甲方看。</p>
        <div className="ap-card">
          <button id="step-cta" type="button" className="btn-primary" aria-disabled={signedIn ? 'false' : 'true'} onClick={() => { if (signedIn) agent.callbacks.onOpenReview(); }}>生成评审链接</button>
          {walkDone && <p className="ap-agent">走完了，要给甲方发链接吗？</p>}
          {!signedIn && <p id="cta-hint" className="ap-why">评审链接要存到云端：先点右上角头像登录并同步，就能生成。</p>}
          <div className="ap-chips"><button type="button" className="chip btn-outline" onClick={agent.walkthrough}>走一遍给客户看</button>{agent.venueIO === 'outdoor' && <button type="button" className={`chip${agent.rainOn ? ' is-on' : ''}`} onClick={agent.previewRain}>看看下雨天</button>}</div>
        </div>
      </>}
      {mode === 'delivery' && <>
        <p className="ap-divider">执行 · {layout.name || '未命名活动'}</p>
        <p className="ap-agent">物料清单只看不改；要改回「布置」里调。导出都合在一个按钮里。</p>
        <div className="ap-card">
          <p className="ap-small">{items} 件物料 · {formatArea(venueArea(layout))} ㎡</p>
          <button id="step-cta" type="button" className="btn-primary" onClick={agent.callbacks.onOpenDelivery}>导出给搭建方</button>
        </div>
      </>}
    </div>
    <form id="composer" className="ap-composer" onSubmit={event => { event.preventDefault(); agent.send(draft); setDraft(''); }}>
      <label className="sr-only" htmlFor="ap-input">告诉 Agent 要改的</label>
      <textarea id="ap-input" ref={inputRef} rows={2} value={draft} maxLength={600} placeholder={generating ? '说「停一下」我就先停' : '@活动需求 我需要组织一场xxx的活动'} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); agent.send(draft); setDraft(''); } }}/>
      <div className="ap-composer-bar">
        <button type="button" className="ap-attach" onClick={agent.pickFile} disabled={mode !== 'layout' || generating}><Paperclip size={13} aria-hidden="true"/>附图纸 / 现场照片</button>
        <button type="submit" className="ap-send" aria-label="发送" disabled={!draft.trim()}><ArrowUp size={16}/></button>
      </div>
    </form>
  </aside>;
}

/* ───────────────────────── 画布状态层 ───────────────────────── */

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
    {s === 'dragHover' && <div id="drop-zone"><div className="ap-drop-card"><FileImage size={20} aria-hidden="true"/><strong>松手铺成底图</strong><small>图片 · 20 MB 以内</small></div></div>}
    {agent.baseName && s !== 'dragHover' && <div id="base-chip" className="ap-canvas-chip">底图 · {agent.baseName} · 仅作参照</div>}
    {(s === 'empty' || s === 'nonImageRejected' || s === 'fileUnsupported' || s === 'fileTooLarge' || s === 'fileReadFailed') && !agent.baseName && <button id="empty-state" type="button" className="ap-canvas-pill" onClick={() => document.getElementById('step-cta')?.focus()}>Agent 已先填好，确认就出方案 →</button>}
    {s === 'generating' && <div id="gen-note" className="ap-canvas-pill is-top"><Loader2 size={12} className="cr-spin" aria-hidden="true"/> 正在{GEN_STEPS[Math.max(0, agent.progress - 1)]} · {Math.max(1, agent.progress)}/5</div>}
    {s === 'generateFailed' && <div id="gen-note" className="ap-canvas-pill is-top is-warn">! 这次没出成，场地和设置都还在</div>}
    {(s === 'planReady' || s === 'planEdited' || s === 'generatePaused') && overlapNames.length > 0 && <div id="overlap-note" className="ap-canvas-pill is-top is-warn" role="status">⚠ 重叠或超出场地：{overlapNames.slice(0, 4).join('、')}{overlapNames.length > 4 ? ' 等' : ''}</div>}
  </div>;
}
