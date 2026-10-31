'use client';

import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DIRECT_BASE, isLux3dLocalProxy } from '../lib/aholo-assets';
import { CREDIT_CONFIRM_LABEL } from '../lib/site-recon-mock';
import type { CatalogItem } from '../lib/types';

/** 空输入时打出来的那句。Tab 填的是整句，不是打到一半的字。 */
export const GENERATE_SUGGESTIONS = ['一张白色圆桌，极简', '浅木色签到台', '两把圈椅，配一张长桌'] as const;
const WORLD_SUGGESTIONS = ['温暖的木质咖啡馆，午后', '竹林边的小舞台', '白墙展厅，一排展台'] as const;
export type GenerateKind = 'text' | 'world';

const TERMINAL = new Set([3, 4, 6]);
const HISTORY_KEY = 'scendance:aholo-history';

function prefersStill(): boolean {
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches !== false;
}

function useSuggestion(list: readonly string[]): { full: string; shown: string } {
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(() => (prefersStill() ? list[0]!.length : 0));
  const key = list.join('|');
  useEffect(() => { setIndex(0); setCount(prefersStill() ? (list[0]?.length ?? 0) : 0); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prefersStill()) return;
    const full = list[index] ?? list[0] ?? '';
    if (count < full.length) {
      const timer = window.setTimeout(() => setCount(value => value + 1), 72);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setIndex(value => (value + 1) % list.length);
      setCount(0);
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [list, index, count]);
  const full = list[index] ?? list[0] ?? '';
  return { full, shown: prefersStill() ? full : full.slice(0, count) };
}

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
export function MaterialGenerateDock({ onBackToChat, onPlace, onOpenFallback, onOpenCloud, forceProxy, seed }: {
  onBackToChat(): void;
  onPlace?: ((item: CatalogItem) => boolean) | undefined;
  onOpenFallback?: (() => void) | undefined;
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
  const [needCredit, setNeedCredit] = useState(false);
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
    setPrompt(seed.prompt);
    setCreditConfirmed(false);
    setNeedCredit(false);
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

  function go() {
    if (running) { stop(); return; }
    if (openTaskRef.current) return;
    const text = prompt.trim();
    if (!text) return;
    if (!creditConfirmed) { setNeedCredit(true); return; }
    if (online !== true) {
      setNote(online === null
        ? '正在确认本机代理，还没提交。'
        : localProxy
          ? '本机代理还不能生成，不会提交，也不会扣额度。'
          : '本机代理没开，不会提交，也不会扣额度。');
      return;
    }
    setNeedCredit(false);
    void runSubmit(mode, text);
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
  const label = running ? '停止生成' : held ? '生成进行中' : '生成物件';

  return <div className="sc-gen-dock" data-lane="generate" data-online={online === true ? 'yes' : online === false ? 'no' : 'wait'}>
    <div className="sc-gen-thread" role="log" aria-label="生成记录">
      {!echo && !note && <p className="sc-gen-empty">{mode === 'world' ? '说一个场景，生成 3D。' : '说一件物件，生成 3D。'}</p>}
      {echo && <div className="ap-user"><strong>{echo}</strong></div>}
      {note && <p className="ap-agent">{note}</p>}
      {result && onPlace && <button type="button" className="ap-bubble-action" disabled={placing} onClick={() => void place()}>{placing ? '正在取回…' : '放进场景'}</button>}
      {held && <button type="button" className="sc-gen-resume" onClick={() => void resume()}>继续查询</button>}
    </div>
    <form id="prop-composer" className="ap-composer is-generate" onSubmit={event => { event.preventDefault(); go(); }}>
      <label className="sr-only" htmlFor="prop-input">物件描述</label>
      <div className="sc-gen-field">
        {!prompt && <span className="sc-gen-ghost" aria-hidden="true" data-suggestion={full}>{shown}</span>}
        <textarea id="prop-input" ref={inputRef} rows={2} maxLength={200} value={prompt} disabled={running || held}
          aria-describedby="prop-tab-hint"
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Tab' && !prompt.trim()) { event.preventDefault(); setPrompt(full); return; }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); go(); }
          }} />
      </div>
      <div className="ap-composer-bar">
        <div className="sc-gen-meta">
          {!prompt.trim() && <span className="sc-gen-tab" id="prop-tab-hint">按 Tab 填入</span>}
          <label className="sc-gen-credit">
            <input type="checkbox" checked={creditConfirmed} disabled={running || held}
              aria-invalid={needCredit && !creditConfirmed}
              aria-label={CREDIT_CONFIRM_LABEL}
              onChange={event => { setCreditConfirmed(event.target.checked); if (event.target.checked) setNeedCredit(false); }} />
            <span aria-hidden="true">确认扣额度</span>
          </label>
        </div>
        <div className="ap-lane" role="group" aria-label="生成种类">
          <button type="button" aria-pressed={mode === 'text'} disabled={running || held} onClick={() => setMode('text')}>物件</button>
          <button type="button" aria-pressed={mode === 'world'} disabled={running || held} onClick={() => setMode('world')}>场景</button>
        </div>
        <LaneSwitch prop onChange={next => { if (!next) onBackToChat(); }} />
        <button type="button" className="sc-gen-go" aria-label={label} disabled={disabled} onClick={go}>
          {running ? <span className="sc-gen-stop" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
        </button>
      </div>
      {needCredit && !creditConfirmed && <p className="sc-gen-warn" role="status">先勾选确认扣额度，才会提交。</p>}
      <p className="sc-gen-foot">
        {!localProxy && onOpenCloud && <button type="button" className="sc-gen-resume" onClick={onOpenCloud}>云端备用</button>}
        {onOpenFallback && <button type="button" className="sc-gen-resume" title="图片和重建在观感里。重建默认干跑，这里不提交。" onClick={onOpenFallback}>图片和重建</button>}
      </p>
    </form>
  </div>;
}
