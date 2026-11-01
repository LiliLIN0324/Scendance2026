'use client';

import { ArrowUp, Cloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DIRECT_BASE, isLux3dLocalProxy, type AholoDirectKind } from '../lib/aholo-assets';
import { CREDIT_CONFIRM_LABEL } from '../lib/site-recon-mock';
import { ComposerPlus } from './composer-plus';
import { KIND_ICONS } from './kind-icons';
import { SuggestionGhost, useSuggestion } from './typed-suggestion';
import type { CatalogItem } from '../lib/types';
import type { ReactNode } from 'react';

/** 空输入时打出来的那句。Tab 填的是整句，不是打到一半的字。 */
export const GENERATE_SUGGESTIONS = ['一张白色圆桌，极简', '浅木色签到台', '两把圈椅，配一张长桌'] as const;
const WORLD_SUGGESTIONS = ['温暖的木质咖啡馆，午后', '竹林边的小舞台', '白墙展厅，一排展台'] as const;
export type GenerateKind = 'text' | 'world';

const TERMINAL = new Set([3, 4, 6]);
const HISTORY_KEY = 'scendance:aholo-history';

function isAbort(failure: unknown): boolean {
  return failure instanceof DOMException && failure.name === 'AbortError';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  init?.signal?.addEventListener('abort', onAbort, { once: true });
  if (init?.signal?.aborted) controller.abort();
  const timeout = window.setTimeout(onAbort, 35000);
  try {
    const response = await fetch(`${DIRECT_BASE}${path}`, { ...init, signal: controller.signal });
    const body = await response.json() as T & { error?: string };
    if (!response.ok || !body || body.error) throw new Error(body?.error ?? `HTTP ${response.status}`);
    return body;
  } catch (failure) {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (controller.signal.aborted) throw new Error('请求超时，还没确认是否受理。先别再点生成。');
    if (failure instanceof TypeError) throw new Error('连不上本机代理。先运行 node tools/aholo/lux3d-dev-proxy.mjs');
    throw failure;
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', onAbort);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function glbOf(outputs: string[]): string | undefined {
  return outputs.find(url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.pathname.toLowerCase().endsWith('.glb');
    } catch { return false; }
  });
}

function rememberHistory(entry: { kind: GenerateKind; taskid: string; prompt: string; startedAt: number; status: number; label: string }) {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[];
    const items = Array.isArray(raw) ? raw : [];
    const next = { at: Date.now(), ...entry };
    const rest = items.filter(item => {
      const row = item as { kind?: string; taskid?: string };
      return !(row.kind === entry.kind && row.taskid === entry.taskid);
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify([next, ...rest].slice(0, 30)));
  } catch { /* 存不下历史不影响这一次。 */ }
}

export function LaneSwitch({ prop, onChange }: { prop: boolean; onChange(next: boolean): void }): JSX.Element {
  return <div className="ap-lane" role="group" aria-label="底部输入">
    <button type="button" aria-pressed={!prop} onClick={() => onChange(false)}>布置</button>
    <button type="button" className="is-generate" aria-pressed={prop} aria-label="切换到生成物件" onClick={() => onChange(true)}>生成</button>
  </div>;
}

/**
 * 晴光栏底部的物件生成条，贴着对话，不进布置提案。
 * 思考强度不放：文生没有质量档，扣额度确认已经挡住误点。
 */
export function MaterialGenerateDock({ onBackToChat, onPlace, onOpenAholo, onOpenCloud, forceProxy, seed }: {
  onBackToChat(): void;
  onPlace?: ((item: CatalogItem) => boolean) | undefined;
  /** 物料生成 / 场地生成：打开观感面板并落在对应那组标签上。 */
  onOpenAholo?: ((kind: AholoDirectKind) => void) | undefined;
  onOpenCloud?: (() => void) | undefined;
  /** 测试里强制走本机代理判断；正式界面不传，跟 isLux3dLocalProxy 走。 */
  forceProxy?: boolean;
  /** 晴光准备好的一句。只填进输入框，不提交。 */
  seed?: { kind: GenerateKind; prompt: string; nonce: number } | null;
}): JSX.Element {
  const localProxy = forceProxy ?? isLux3dLocalProxy();
  const [mode, setMode] = useState<GenerateKind>('text');
  const { full, shown } = useSuggestion(mode === 'world' ? WORLD_SUGGESTIONS : GENERATE_SUGGESTIONS);
  const [prompt, setPrompt] = useState('');
  const [creditConfirmed, setCreditConfirmed] = useState(false);
  /** 扣额度这一步改成按提交那一下再问：勾选不常驻，也不占输入框下的一排。 */
  const [confirming, setConfirming] = useState(false);
  /** 「+」选过物料/场地之后，按钮图标跟着换成对应那颗；没选过仍是「+」。 */
  const [pickedKind, setPickedKind] = useState<GenerateKind | null>(null);
  const [online, setOnline] = useState<boolean | null>(localProxy ? null : false);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const [echo, setEcho] = useState('');
  const [openTask, setOpenTask] = useState('');
  const [result, setResult] = useState<{ url: string; taskid: string; name: string } | null>(null);
  const [placing, setPlacing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const run = useRef(0);
  const lock = useRef(false);
  const openTaskRef = useRef('');
  const mounted = useRef(true);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!seed) return;
    if (openTaskRef.current || lock.current) {
      setNote('上一单还在，这句先不覆盖，也不会再提交。');
      return;
    }
    setMode(seed.kind);
    setPickedKind(seed.kind);
    setPrompt(seed.prompt);
    setCreditConfirmed(false);
    setConfirming(false);
    inputRef.current?.focus();
  }, [seed]);
  useEffect(() => () => { mounted.current = false; run.current += 1; abortRef.current?.abort(); }, []);
  useEffect(() => {
    if (!localProxy) return;
    const controller = new AbortController();
    void request<{ keyConfigured?: boolean }>('/health', { signal: controller.signal }).then(body => {
      if (!controller.signal.aborted && mounted.current) setOnline(Boolean(body.keyConfigured));
    }).catch(() => {
      if (!controller.signal.aborted && mounted.current) setOnline(false);
    });
    return () => controller.abort();
  }, [localProxy]);
  useEffect(() => { if (!prompt.trim()) setConfirming(false); }, [prompt]);

  function rememberTask(taskid: string) {
    openTaskRef.current = taskid;
    setOpenTask(taskid);
  }

  function clearTask() {
    openTaskRef.current = '';
    setOpenTask('');
  }

  function stop() {
    const accepted = Boolean(openTaskRef.current);
    run.current += 1;
    abortRef.current?.abort();
    lock.current = false;
    setRunning(false);
    setConfirming(false);
    if (!accepted) setCreditConfirmed(false);
    setNote(accepted ? '已停止查询。任务已受理，不会再提交一次。' : '已停下。还没确认是否受理，先别再点生成。');
  }

  async function poll(kind: GenerateKind, taskid: string, name: string, signal: AbortSignal, runId: number) {
    const started = Date.now();
    const query = kind === 'world' ? `/world?worldId=${encodeURIComponent(taskid)}` : `/task?taskid=${encodeURIComponent(taskid)}`;
    while (run.current === runId && !signal.aborted) {
      const body = await request<{ status: number; statusLabel?: string; outputs?: string[] }>(query, { signal });
      if (!mounted.current || run.current !== runId) return;
      const outputs = Array.isArray(body.outputs) ? body.outputs.filter((item): item is string => typeof item === 'string') : [];
      rememberHistory({ kind, taskid, prompt: name, startedAt: started, status: body.status, label: body.statusLabel ?? '' });
      if (TERMINAL.has(body.status)) {
        setRunning(false);
        clearTask();
        if (body.status === 3) {
          const url = kind === 'text' ? glbOf(outputs) : undefined;
          setResult(url ? { url, taskid, name } : null);
          setPrompt('');
          setNote(kind === 'world'
            ? '场景好了。到「空间 · 环境预览」取回，这里不再提交。'
            : url ? '生成好了，可以放进场景。' : '生成完成，但没有模型文件。');
        } else {
          setNote(body.status === 4 ? '生成失败。再点会再扣一次。' : '生成已取消，没有再提交。');
        }
        return;
      }
      if (Date.now() - started >= 20 * 60 * 1000) {
        setRunning(false);
        setNote('查询满 20 分钟，已暂停。任务可能还在，不会再提交。');
        return;
      }
      if (mounted.current) setNote('生成中…');
      await sleep(5000, signal);
    }
  }

  async function runSubmit(kind: GenerateKind, text: string) {
    if (lock.current || openTaskRef.current) return;
    lock.current = true;
    const runId = ++run.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const started = Date.now();
    setRunning(true);
    setConfirming(false);
    setResult(null);
    setEcho(text);
    setNote('正在提交…');
    let accepted = false;
    try {
      const payload = kind === 'world' ? { name: text.slice(0, 40), prompt: text } : { prompt: text };
      const body = await request<{ taskid: string | number }>(kind === 'world' ? '/world' : '/text-to-3d', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!mounted.current || run.current !== runId) return;
      const taskid = String(body.taskid ?? '');
      const idOk = kind === 'world' ? /^[A-Za-z0-9_-]{1,128}$/ : /^\d+$/;
      if (!idOk.test(taskid)) throw new Error('接口没返回有效任务号。');
      accepted = true;
      setCreditConfirmed(false);
      rememberTask(taskid);
      rememberHistory({ kind, taskid, prompt: text, startedAt: started, status: 0, label: '已提交' });
      await poll(kind, taskid, text, controller.signal, runId);
    } catch (failure) {
      if (!mounted.current || run.current !== runId) return;
      if (isAbort(failure)) {
        setNote(accepted ? '已停止查询。任务已受理，不会再提交一次。' : '已停下。还没确认是否受理，先别再点生成。');
        if (!accepted) setCreditConfirmed(false);
      } else {
        if (!accepted) setCreditConfirmed(false);
        setNote(failure instanceof Error ? failure.message : '提交没成功，没有确认扣费。');
      }
    } finally {
      if (run.current === runId) {
        lock.current = false;
        if (mounted.current) setRunning(false);
      }
    }
  }

  function modeChanged(next: GenerateKind) {
    setMode(next);
    setConfirming(false);
  }

  function localProxyNote(): string {
    return online === null
      ? '正在确认本机代理，还没提交。'
      : localProxy
        ? '本机代理还不能生成，不会提交，也不会扣额度。'
        : '本机代理没开，不会提交，也不会扣额度。';
  }

  /** 第一下按提交：先把扣额度说清楚，不直接打接口。 */
  function go() {
    if (running) { stop(); return; }
    if (openTaskRef.current) return;
    if (!prompt.trim()) return;
    if (!creditConfirmed) { setConfirming(true); return; }
    submitConfirmed();
  }

  /** 二次确认之后才真提交；同一单确认过就不再问第二次。 */
  function submitConfirmed() {
    if (running || openTaskRef.current || lock.current) return;
    if (online !== true) {
      setNote(localProxyNote());
      return;
    }
    setCreditConfirmed(true);
    setConfirming(false);
    void runSubmit(mode, prompt.trim());
  }

  async function place() {
    if (!result || !onPlace || placing) return;
    setPlacing(true);
    try {
      const { loadAholoCatalogItem } = await import('../lib/aholo-model-placement');
      const item = await loadAholoCatalogItem({ url: result.url, name: result.name, taskid: result.taskid });
      if (!mounted.current) return;
      setNote(onPlace(item) ? '已放进场景。' : '点一下场地，把它放下。');
    } catch (failure) {
      if (mounted.current) setNote(failure instanceof Error ? failure.message : '没能放进场景。');
    } finally {
      if (mounted.current) setPlacing(false);
    }
  }

  async function resume() {
    if (!openTask || running || lock.current) return;
    lock.current = true;
    const runId = ++run.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      await poll(mode, openTask, echo || prompt.trim() || '物件', controller.signal, runId);
    } catch (failure) {
      if (mounted.current && run.current === runId && !isAbort(failure)) {
        setNote(failure instanceof Error ? failure.message : '查询中断，没有再提交。');
      }
    } finally {
      if (run.current === runId) {
        lock.current = false;
        if (mounted.current) setRunning(false);
      }
    }
  }

  const held = Boolean(openTask) && !running;
  const disabled = running ? false : !prompt.trim() || held;
  const label = running ? '停止生成' : held ? '生成进行中' : mode === 'world' ? '生成场景' : '生成物件';
  /** 没有记录、也没有要确认的事时，输入框下面什么都不长。 */
  const hasThread = Boolean(echo || note || result || held);
  const expanded = hasThread || confirming;
  /** 出物料和出场地是两条能力，不挂页脚细链接，跟「布置」一样在输入框上方给一片「你可以做什么」。 */
  const offers: { id: string; label: string; title: string; icon: ReactNode; run(): void }[] = [];
  if (onOpenAholo) {
    offers.push({ id: 'materials', label: '物料生成', title: '文字建模、图片建模：出可摆放的物件与材质', icon: <KIND_ICONS.text size={14} aria-hidden="true"/>, run: () => { setPickedKind('text'); onOpenAholo('text'); } });
    offers.push({ id: 'venue', label: '场地生成', title: '场景生成、场地重建：出可漫游的 3DGS 场地', icon: <KIND_ICONS.world size={14} aria-hidden="true"/>, run: () => { setPickedKind('world'); onOpenAholo('world'); } });
  }
  if (!localProxy && onOpenCloud) offers.push({ id: 'cloud', label: '云端备用', title: '本机代理不在时走云端生成', icon: <Cloud size={14} aria-hidden="true"/>, run: onOpenCloud });

  return <div className="sc-gen-dock" data-lane="generate" data-online={online === true ? 'yes' : online === false ? 'no' : 'wait'}>
    {offers.length > 0 && <div className="ap-capabilities sc-gen-capabilities">
      <p className="ap-capability-label">你可以做什么</p>
      <div className="ap-capability-chips" role="group" aria-label="你可以做什么">
        {offers.map(offer => <button key={offer.id} type="button" className="chip ap-capability-chip" title={offer.title} onClick={offer.run}>
          {offer.icon}<span>{offer.label}</span>
        </button>)}
      </div>
    </div>}
    <div className={`sc-gen-fold${expanded ? ' is-open' : ''}`}>
      <div className="sc-gen-fold-inner">
        {hasThread && <div className="sc-gen-thread" role="log" aria-label="生成记录">
          {echo && <div className="ap-user"><strong>{echo}</strong></div>}
          {note && <p className="ap-agent">{note}</p>}
          {result && onPlace && <button type="button" className="ap-bubble-action" disabled={placing} onClick={() => void place()}>{placing ? '正在取回…' : '放进场景'}</button>}
          {held && <button type="button" className="sc-gen-resume" onClick={() => void resume()}>继续查询</button>}
        </div>}
        {confirming && <div className="sc-gen-confirm" role="group" aria-label="扣额度确认">
          <p className="sc-gen-confirm-text">{CREDIT_CONFIRM_LABEL}。确认后才会提交，提交一次扣一次。</p>
          <div className="sc-gen-confirm-row">
            <button type="button" className="sc-gen-resume" onClick={() => setConfirming(false)}>取消</button>
            <button type="button" className="sc-gen-confirm-go" onClick={submitConfirmed}>确认提交</button>
          </div>
        </div>}
      </div>
    </div>
    <form id="prop-composer" className="ap-composer is-generate" onSubmit={event => { event.preventDefault(); go(); }}>
      <label className="sr-only" htmlFor="prop-input">{mode === 'world' ? '场景描述' : '物件描述'}</label>
      <div className="sc-gen-field">
        {!prompt && <SuggestionGhost className="sc-gen-ghost" full={full} shown={shown}/>}
        <textarea id="prop-input" ref={inputRef} rows={2} maxLength={200} value={prompt} disabled={running || held}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Tab' && !prompt.trim()) { event.preventDefault(); setPrompt(full); return; }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (confirming) submitConfirmed(); else go(); }
            if (event.key === 'Escape' && confirming) { event.preventDefault(); setConfirming(false); }
          }} />
      </div>
      <div className="ap-composer-bar">
        <div className="ap-composer-left">
          <ComposerPlus label="生成种类" icon={pickedKind === 'text' ? <KIND_ICONS.text size={16} aria-hidden="true" /> : pickedKind === 'world' ? <KIND_ICONS.world size={16} aria-hidden="true" /> : undefined} items={[
            { id: 'object', label: '物料', hint: '文字或图片，出可摆放的物件', active: pickedKind === 'text', icon: <KIND_ICONS.text size={16} aria-hidden="true" />, run: () => { setPickedKind('text'); modeChanged('text'); } },
            { id: 'scene', label: '场地', hint: '一句场景描述，出可漫游的 3DGS', active: pickedKind === 'world', icon: <KIND_ICONS.world size={16} aria-hidden="true" />, run: () => { setPickedKind('world'); modeChanged('world'); } },
          ]} />
        </div>
        <LaneSwitch prop onChange={next => { if (!next) onBackToChat(); }} />
        <button type="button" className="sc-gen-go" aria-label={label} disabled={disabled} onClick={go}>
          {running ? <span className="sc-gen-stop" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
        </button>
      </div>
    </form>
  </div>;
}
