'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DIRECT_BASE, isLux3dLocalProxy } from '../lib/aholo-assets';
import { CLOUD_E2E_WORLD_SCENE_ID, DEMO_WORLD_SCENE_ID, listShippedAssets } from '../lib/shipped-assets';
import {
  isMockReconTask,
  makeMockReconTaskId,
  mockReconSuccessDetail,
  RECON_MATERIAL_BAN,
  VENUE_PACKAGE_MISSING,
  MOCK_HANG_DONE_NOTE,
  CREDIT_CONFIRM_LABEL,
  VENUE_PACKAGE_HUNG,
} from '../lib/site-recon-mock';
import { AholoGuideCard } from './aholo-guide-card';
import { loadAholoCatalogItem, loadStoredAholoCatalogItem } from '../lib/aholo-model-placement';
import type { CatalogItem } from '../lib/types';

const POLL_MS = 5000;
const CAPABILITIES = {
  text: { label: '文字（备用）', path: '/text-to-3d', storage: 'scendance:lux3d-direct', id: /^\d+$/ },
  image: { label: '图片建模', path: '/image-to-3d', storage: 'scendance:aholo-image', id: /^\d+$/ },
  world: { label: '场景生成', path: '/world', storage: 'scendance:aholo-world', id: /^[a-zA-Z0-9_-]{1,128}$/ },
  recon: { label: '场地重建', path: '/world-recon', storage: 'scendance:aholo-recon', id: /^[a-zA-Z0-9_-]{1,128}$/ },
};
type Kind = keyof typeof CAPABILITIES;
type TaskDetail = { status: number; statusLabel: string; outputs: string[]; progress?: number; panoUrl?: string };
type SavedTask = { taskid?: string; prompt: string; startedAt: number };
const TERMINAL = [3, 4, 6];
const STAGES: Record<number, { title: string; text: string }> = {
  0: { title: '排队中', text: 'Aholo 已接收任务，正在初始化或等待执行。' },
  1: { title: '生成中', text: 'Aholo 正在生成，完成后会显示产物。' },
  3: { title: '生成完成', text: '生成已完成，可查看下方结果。' },
  4: { title: '生成失败', text: 'Aholo 返回任务失败，已停止查询。' },
  6: { title: '已取消', text: 'Aholo 返回任务已取消，已停止查询。' },
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init?.signal?.addEventListener('abort', abort, { once: true });
  if (init?.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 35000);
  try {
    const response = await fetch(`${DIRECT_BASE}${path}`, { ...init, signal: controller.signal });
    const body = await response.json() as T & { error?: string };
    if (!response.ok || !body || body.error) throw new Error(body?.error ?? `HTTP ${response.status}`);
    return body;
  } catch (failure) {
    if (controller.signal.aborted) throw new Error('请求超时或已中断，尚未确认最新状态。');
    if (failure instanceof TypeError) throw new Error('连不上本机代理，先运行：node tools/aholo/lux3d-dev-proxy.mjs');
    throw failure;
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', abort);
  }
}

function readSaved(key: string, kind: Kind, pending = false): SavedTask | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as SavedTask | null;
    return saved && typeof saved.prompt === 'string' && Number.isFinite(saved.startedAt) && saved.startedAt > 0
      && (pending || (typeof saved.taskid === 'string' && CAPABILITIES[kind].id.test(saved.taskid))) ? saved : null;
  } catch { return null; }
}

function remember(key: string, value: SavedTask | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* 浏览器禁用存储时仍保留内存中的任务号。 */ }
}

function safeResultUrl(value: string | undefined) {
  if (!value) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

/** 带材质的 GLB 才是能摆进布置场景的物件；签名链接先过安全校验。 */
function glbOutputOf(outputs: string[]): string | undefined {
  return outputs.filter(safeResultUrl).find(url => new URL(url).pathname.toLowerCase().endsWith('.glb'));
}

/** 环境预览优先单包 SPZ；没有才退回 PLY。LOD 元数据不是场景本体，但它是唯一带真实尺度的文件。 */
function splatOutputOf(outputs: string[]): string | undefined {
  const safe = outputs.filter(safeResultUrl);
  return safe.find(url => new URL(url).pathname.toLowerCase().endsWith('.spz')) ??
    safe.find(url => new URL(url).pathname.toLowerCase().endsWith('.ply'));
}

/** lod-meta（json）只用来读 forwardBox 真实尺度，高斯优先时场地跟它对齐。 */
function metaOutputOf(outputs: string[]): string | undefined {
  return outputs.filter(safeResultUrl).find(url => new URL(url).pathname.toLowerCase().endsWith('.json'));
}

const HISTORY_KEY = 'scendance:aholo-history';
const HISTORY_MAX = 30;
type HistoryEntry = { kind: Kind; taskid: string; prompt: string; startedAt: number; status: number; label: string; at: number };

function isHistoryEntry(value: unknown): value is HistoryEntry {
  const entry = value as HistoryEntry;
  return Boolean(entry) && CAPABILITIES[entry.kind] && typeof entry.taskid === 'string'
    && CAPABILITIES[entry.kind].id.test(entry.taskid) && typeof entry.prompt === 'string'
    && Number.isFinite(entry.startedAt) && Number.isFinite(entry.status) && Number.isFinite(entry.at);
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isHistoryEntry).slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}

// 只存元数据：签名链接会过期、图片体积大，都不进本地存储，要看产物就回查原任务。
function appendHistory(entry: HistoryEntry) {
  try {
    const items = readHistory();
    const previous = items.find(item => item.kind === entry.kind && item.taskid === entry.taskid);
    // 任务号是列表里唯一的凭据已被去掉，描述就是这一行的名字，轮询不能把它刷成空的。
    const next = previous?.prompt && !entry.prompt ? { ...entry, prompt: previous.prompt } : entry;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(
      [next, ...items.filter(item => !(item.kind === entry.kind && item.taskid === entry.taskid))].slice(0, HISTORY_MAX)));
  } catch { /* 浏览器禁用存储时只丢历史，不影响当前任务。 */ }
}

function ResultLinks({ detail, world }: { detail: TaskDetail; world: boolean }) {
  const outputs = detail.outputs.filter(safeResultUrl);
  const panorama = world && safeResultUrl(detail.panoUrl) ? detail.panoUrl : undefined;
  function label(url: string) {
    const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
    return ({ glb: 'GLB 模型', zip: 'ZIP（含 PBR，签名 2 小时过期）', ply: 'PLY 场景', spz: 'SPZ 场景', json: 'LOD 元数据' })[extension ?? ''] ?? '结果文件';
  }
  return <>
    {panorama && <a className="sc-aholo-panorama" href={panorama} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={panorama} alt="World 场景全景图" referrerPolicy="no-referrer" />
      <span>打开全景原图</span>
    </a>}
    {outputs.length > 0 && <ul className="sc-lux-direct-results">{outputs.map(url => <li key={url}>
      <a href={url} target="_blank" rel="noreferrer">{label(url)}</a>
    </li>)}</ul>}
    {!outputs.length && !panorama && <p className="sc-warning">Aholo 返回成功，但没有提供下载链接。</p>}
    {world && <p className="sc-note">3DGS 场景取回后按真实尺度铺成 3D 背景（场地跟高斯对齐），只作环境预览，不参与碰撞。</p>}
  </>;
}

function DirectTaskPanel({ kind, online, resume, reconPreset, mockRecon, onMockRecon, creditConfirmed, onCreditConfirmed, onHangMockScene, onHistory, unresolved, onPlace, onPreviewScene }: {
  kind: Kind; online: boolean | null; onHistory: () => void;
  resume: { kind: Kind; taskid: string; prompt: string; startedAt: number } | null;
  /** 地图采集单带过来的这块地：名字填进场景名称，应拍数量贴在素材选择框下面。 */
  reconPreset: { name: string; hint: string } | null;
  /** 场地重建默认干跑：不打代理、不扣额度；关掉才走真 /world-recon。 */
  mockRecon: boolean;
  onMockRecon: (value: boolean) => void;
  /** 真调扣额度确认闸：关干跑后须勾选才允许提交。 */
  creditConfirmed: boolean;
  onCreditConfirmed: (value: boolean) => void;
  /** 干跑成功后挂环境预览：等同 D0 hangDemo（历史 shipped .spz）。 */
  onHangMockScene?: (() => void) | undefined;
  unresolved: HistoryEntry | undefined;
  onPlace?: ((item: CatalogItem) => boolean) | undefined;
  onPreviewScene?: ((source: { url: string; name?: string; taskid?: string }) => Promise<void>) | undefined;
}) {
  const config = CAPABILITIES[kind];
  const taskKey = `${config.storage}-task`;
  const pendingKey = `${config.storage}-pending`;
  const world = kind === 'world' || kind === 'recon';
  const [reconFiles, setReconFiles] = useState<File[]>([]);
  const [reconQuality, setReconQuality] = useState('normal');
  const isVideoClip = (file: File) => /\.(mp4|mov|insv)$/i.test(file.name);
  const reconValid = reconFiles.length > 0 && (reconFiles.some(isVideoClip) || reconFiles.length >= 20);
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('Scendance 场景测试');
  const [image, setImage] = useState('');
  const [readingImage, setReadingImage] = useState(false);
  const [imageError, setImageError] = useState('');
  const [presetHint, setPresetHint] = useState('');
  const [taskid, setTaskid] = useState('');
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(0);
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeNote, setPlaceNote] = useState('');
  const [placeError, setPlaceError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewNote, setPreviewNote] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [mockHangNote, setMockHangNote] = useState('');
  const [retry, setRetry] = useState(0);
  const mounted = useRef(false);
  const submitLock = useRef(false);
  const placeLock = useRef(false);
  const previewLock = useRef(false);
  // 重新提交会让在途的摆放结果作废，否则会把它放进下一个任务。
  const placeGeneration = useRef(0);
  const imageReader = useRef<FileReader | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const live = useRef({ prompt, startedAt });
  useEffect(() => { live.current = { prompt, startedAt }; });
  const record = useCallback((entry: { taskid: string; status: number; label: string }) => {
    appendHistory({ kind, at: Date.now(), prompt: live.current.prompt.trim(), startedAt: live.current.startedAt, ...entry });
    onHistory();
  }, [kind, onHistory]);

  useEffect(() => {
    mounted.current = true;
    const saved = readSaved(pendingKey, kind, true) ?? readSaved(taskKey, kind);
    if (saved) {
      setPrompt(saved.prompt); setStartedAt(saved.startedAt);
      setTaskid(saved.taskid ?? ''); setUncertain(!saved.taskid);
    }
    return () => { mounted.current = false; imageReader.current?.abort(); };
  }, [kind, pendingKey, taskKey]);

  const resumed = useRef<typeof resume>(null);
  useEffect(() => {
    if (!resume || resume.kind !== kind || resumed.current === resume) return;
    resumed.current = resume;
    remember(taskKey, { taskid: resume.taskid, prompt: resume.prompt, startedAt: resume.startedAt });
    remember(pendingKey, null);
    placeGeneration.current += 1;
    setPrompt(resume.prompt); setDetail(null); setError(''); setUncertain(false);
    setPlacing(false); setPlaceNote(''); setPlaceError('');
    setPreviewing(false); setPreviewNote(''); setPreviewError('');
    setStartedAt(resume.startedAt); setTaskid(resume.taskid); setRetry(value => value + 1);
  }, [resume, kind, taskKey, pendingKey]);

  // 从地图采集单跳过来：这块地的名字填进场景名称，应拍数量跟着素材选择框提示。同一份预设只应用一次。
  const appliedPreset = useRef<typeof reconPreset>(null);
  useEffect(() => {
    if (kind !== 'recon' || !reconPreset || appliedPreset.current === reconPreset) return;
    appliedPreset.current = reconPreset;
    setName(reconPreset.name.slice(0, 100));
    setPresetHint(reconPreset.hint);
  }, [kind, reconPreset]);

  const terminal = detail !== null && TERMINAL.includes(detail.status);
  const busy = submitting || uncertain || Boolean(taskid && !terminal);
  const validInput = kind === 'image' ? Boolean(image) && !readingImage
    : kind === 'recon' ? Boolean(name.trim()) && reconValid
    : Boolean(prompt.trim()) && (!world || Boolean(name.trim()));
  useEffect(() => {
    if (!startedAt || terminal) return;
    const update = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt, terminal]);

  useEffect(() => {
    if (!taskid) return;
    // 干跑任务没有公网产物，不查代理。
    if (isMockReconTask(taskid)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const pollingStartedAt = Date.now();
    setError('');
    async function poll() {
      setChecking(true);
      try {
        const query = world ? `/world?worldId=${encodeURIComponent(taskid)}` : `/task?taskid=${encodeURIComponent(taskid)}`;
        const body = await request<TaskDetail>(query, { signal: controller.signal });
        if (cancelled) return;
        setDetail(body); setLastCheckedAt(Date.now());
        record({ taskid, status: body.status, label: body.statusLabel });
        if (!TERMINAL.includes(body.status)) {
          if (Date.now() - pollingStartedAt >= 20 * 60 * 1000) setError('自动查询已满 20 分钟，已暂停；任务可能仍在运行。');
          else timer = setTimeout(() => void poll(), POLL_MS);
        }
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      } finally { if (!cancelled) setChecking(false); }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [taskid, retry, world, record]);

  function selectImage(file: File | undefined) {
    imageReader.current?.abort();
    setImage(''); setImageError(''); setPrompt(''); setReadingImage(false);
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      setImageError('请选择不超过 5 MB 的 PNG 或 JPEG 图片。');
      return;
    }
    const reader = new FileReader();
    imageReader.current = reader;
    setReadingImage(true);
    reader.onload = () => {
      if (!mounted.current || imageReader.current !== reader) return;
      setImage(String(reader.result)); setPrompt(file.name); setReadingImage(false);
    };
    reader.onerror = () => {
      if (!mounted.current || imageReader.current !== reader) return;
      setImageError('图片读取失败，请重新选择。'); setReadingImage(false);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    const text = prompt.trim();
    const dryRun = kind === 'recon' && mockRecon;
    if (!validInput || submitLock.current || busy || (!dryRun && online !== true)) return;
    if (!dryRun && !creditConfirmed) return;
    submitLock.current = true;
    placeGeneration.current += 1;
    const start = Date.now();
    setError(''); setDetail(null); setTaskid(''); setLastCheckedAt(0);
    setPlacing(false); setPlaceNote(''); setPlaceError('');
    setPreviewing(false); setPreviewNote(''); setPreviewError(''); setMockHangNote('');
    setStartedAt(start); setElapsedSec(0); setSubmitting(true);
    remember(pendingKey, { prompt: text, startedAt: start });
    remember(taskKey, null);
    try {
      let taskidResponse: { taskid: string | number };
      if (dryRun) {
        // D1 干跑：只走「选文件 → 完成 → 挂预览」形状，不打 /recon-upload /world-recon。
        const id = makeMockReconTaskId(start);
        const done = mockReconSuccessDetail();
        remember(taskKey, { taskid: id, prompt: text || name.trim() || '场地重建干跑', startedAt: start });
        remember(pendingKey, null);
        appendHistory({ kind, taskid: id, prompt: text || name.trim() || '场地重建干跑', startedAt: start, status: done.status, label: done.statusLabel, at: start });
        onHistory();
        if (mounted.current) {
          setUncertain(false);
          setTaskid(id);
          setDetail(done);
        }
        return;
      }
      if (kind === 'recon') {
        // 素材经本机代理上传 OUS 换公网地址，再创建重建任务；返回的 worldId 走同一套轮询与预览。
        const resources = [];
        for (const file of reconFiles) {
          const uploaded = await request<{ url: string }>(`/recon-upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
          resources.push({ url: uploaded.url, type: isVideoClip(file) ? (/\.insv$/i.test(file.name) ? 'insv' : 'video') : 'image' });
        }
        taskidResponse = await request<{ taskid: string | number }>('/world-recon', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() || '场地重建', resources, scene: 'space', taskQuality: reconQuality }),
        });
      } else {
        const payload = kind === 'image' ? { img: image } : world ? { name: name.trim(), prompt: text } : { prompt: text };
        taskidResponse = await request<{ taskid: string | number }>(config.path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      }
      const { taskid: id } = taskidResponse;
      if ((typeof id !== 'string' && typeof id !== 'number') || !config.id.test(String(id))) throw new Error('接口未返回有效任务号。');
      // 先保存迟到的任务号，重开页面只查询、不重复付费。
      remember(taskKey, { taskid: String(id), prompt: text, startedAt: start });
      remember(pendingKey, null);
      appendHistory({ kind, taskid: String(id), prompt: text, startedAt: start, status: 0, label: '已提交', at: start });
      onHistory();
      if (mounted.current) { setUncertain(false); setTaskid(String(id)); }
    } catch (failure) {
      if (mounted.current) {
        setUncertain(true);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      submitLock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  /** 落盘 → 实测尺寸 → 交给布置场景摆放；同一任务号重复点只复用已存的本机文件。 */
  async function place(url: string) {
    if (!onPlace || !taskid || placeLock.current) return;
    placeLock.current = true;
    const generation = placeGeneration.current;
    const description = prompt.trim();
    setPlacing(true); setPlaceNote(''); setPlaceError('');
    try {
      const item = await loadAholoCatalogItem({ url, name: description, taskid });
      if (!mounted.current || placeGeneration.current !== generation) return;
      setPlaceNote(onPlace(item) ? '已放进场景，可直接拖动。' : '请点击场地中的其他位置放下它。');
    } catch (failure) {
      if (mounted.current && placeGeneration.current === generation) {
        setPlaceError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      placeLock.current = false;
      if (mounted.current) setPlacing(false);
    }
  }

  /** 场景包先落盘再预览：那条签名链接不进渲染管线，重启后还能从「环境预览」再打开。lod-meta 一并带去换真实尺度。 */
  async function previewScene(url: string) {
    if (!onPreviewScene || !taskid || previewLock.current) return;
    previewLock.current = true;
    setPreviewing(true); setPreviewNote(''); setPreviewError('');
    try {
      const metaUrl = world ? metaOutputOf(detail?.outputs ?? []) : undefined;
      await onPreviewScene({ url, name: (world ? name : prompt).trim() || prompt.trim(), taskid, ...(metaUrl ? { metaUrl } : {}) });
      if (mounted.current) {
        setPreviewNote(kind === 'recon' ? VENUE_PACKAGE_HUNG : '已铺成 3D 背景，画布上可随时退出。');
      }
    } catch (failure) {
      if (mounted.current) setPreviewError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      previewLock.current = false;
      if (mounted.current) setPreviewing(false);
    }
  }

  const glbOutput = onPlace && !world && detail?.status === 3 ? glbOutputOf(detail.outputs) : undefined;
  const splatOutput = onPreviewScene && world && detail?.status === 3 ? splatOutputOf(detail.outputs) : undefined;
  const stage = submitting
    ? { title: '正在提交', text: '正在向 Aholo 申请任务号，请勿重复提交。' }
    : uncertain
      ? { title: '提交结果待确认', text: '这次没有取回任务号，无法确认这一条；请求可能已受理，请勿重复生成。Aholo 侧不列任务号，稍后可在用量页核对额度。' }
      : error && taskid
        ? { title: '查询已暂停', text: `查询中断不代表生成失败。${detail ? `上次确认：${STAGES[detail.status]?.title ?? detail.statusLabel}。` : ''}继续查询只查看原任务，不会再次扣生成额度。` }
        : detail ? STAGES[detail.status] ?? { title: '状态待确认', text: `Aholo 返回状态 ${detail.statusLabel}，正在继续查询。` }
          : { title: '已提交', text: '已取得任务号，正在查询 Aholo 当前状态。' };
  const progress = world && typeof detail?.progress === 'number' && Number.isFinite(detail.progress) && detail.progress >= 0 && detail.progress <= 1 ? detail.progress : undefined;
  const prefix = `aholo-${kind}`;

  return <div className="sc-aholo-task">
    <p className="sc-note">{kind === 'recon' ? 'World · 视频/照片重建真实场地 3DGS' : world ? 'World · 文字生成 3DGS 场景' : kind === 'image' ? 'Lux3D · 图片生成带材质物件' : 'Lux3D · 文字生成带材质物件'}</p>
    <AholoGuideCard world={world} recon={kind === 'recon'} />
    {world && <>
      <label className="sc-field" htmlFor={`${prefix}-name`}>场景名称</label>
      <input id={`${prefix}-name`} type="text" maxLength={100} value={name} disabled={busy || (kind === 'recon' ? (!mockRecon && online !== true) : online !== true)} onChange={event => setName(event.target.value)} />
    </>}
    {kind === 'recon' && <>
      <p className="sc-note" role="status">{mockRecon
        ? '本场包状态：仍缺本场包（干跑只挂宴会厅样例作观感演示）。'
        : creditConfirmed
          ? '本场包状态：待真调上传 → 成功后可挂本场 .spz 替换样例。'
          : '本场包状态：仍缺本场包；关干跑后须勾选扣额度确认闸再真调。'}</p>
      <p className="sc-note"><label>
        <input type="checkbox" checked={mockRecon} disabled={busy} onChange={event => {
          const next = event.target.checked;
          onMockRecon(next);
          if (next) onCreditConfirmed(false);
        }} />
        {' '}干跑模拟（不扣额度）
      </label></p>
      {!mockRecon && <p className="sc-warning" role="status">已关掉干跑：提交会走本机代理真调，消耗 Aholo 额度。</p>}
      {!mockRecon && <p className="sc-note"><label>
        <input type="checkbox" checked={creditConfirmed} disabled={busy || online !== true}
          onChange={event => onCreditConfirmed(event.target.checked)} />
        {' '}{CREDIT_CONFIRM_LABEL}
      </label></p>}
      <label className="sc-field" htmlFor={`${prefix}-recon-files`}>场地素材</label>
      <input id={`${prefix}-recon-files`} type="file" multiple
        accept="video/mp4,video/quicktime,.insv,image/jpeg,image/png,image/webp" disabled={busy || (!mockRecon && online !== true)}
        onChange={event => { setReconFiles([...event.target.files ?? []]); event.target.value = ''; }} />
      <p className="sc-note">Insta360 全景或普通视频一段即可；用照片则至少 20 张、绕场地一圈多角度。{mockRecon ? '干跑只校验选文件形状，不上传。' : '素材经本机代理上传至 Aholo。'}</p>
      <p className="sc-warning" role="note">{RECON_MATERIAL_BAN}</p>
      {presetHint && <p className="sc-note">这块地的采集单：{presetHint}。按单子拍完再拖进来，重建出来的尺度才对得上圈画的范围。</p>}
      {reconFiles.length > 0 && <p className="sc-note">已选 {reconFiles.length} 个文件{reconFiles.some(file => file.size > 5 * 1024 * 1024) ? '（含较大文件，上传可能需要几分钟）' : ''}</p>}
      <label className="sc-field" htmlFor={`${prefix}-quality`}>重建质量</label>
      <select id={`${prefix}-quality`} value={reconQuality} disabled={busy || mockRecon || online !== true} onChange={event => setReconQuality(event.target.value)}>
        <option value="normal">标准（推荐）</option>
        <option value="high">专业（更慢更精细）</option>
        <option value="low">极速预览</option>
      </select>
    </>}
    {kind === 'image' ? <>
      <label className="sc-field" htmlFor={`${prefix}-image`}>参考图片</label>
      <input ref={imageInput} id={`${prefix}-image`} type="file" accept="image/png,image/jpeg" disabled={busy || online !== true}
        onChange={event => selectImage(event.target.files?.[0])} />
      <p className="sc-note">PNG / JPEG，最大 5 MB。提交后图片会发送给 Aholo。</p>
      {readingImage && <p className="sc-note">正在读取图片…</p>}
      {image && <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sc-aholo-image" src={image} alt="建模参考图片预览" />
        <button type="button" className="sc-button" disabled={busy} onClick={() => { selectImage(undefined); if (imageInput.current) imageInput.current.value = ''; }}>移除图片</button>
      </>}
      {prompt && <p className="sc-note">图片：{prompt}</p>}
      {imageError && <p className="sc-warning" role="alert">{imageError}</p>}
    </> : kind !== 'recon' && <>
      <label className="sc-field" htmlFor={`${prefix}-prompt`}>{world ? '场景描述' : '物件描述'}</label>
      <textarea id={`${prefix}-prompt`} maxLength={world ? 2000 : 200} rows={3} value={prompt} disabled={busy || online !== true}
        placeholder={world ? '例：温暖的木质咖啡馆，大窗户，午后阳光' : '例：一张白色圆桌，极简风格'} onChange={event => setPrompt(event.target.value)} />
    </>}
    {kind !== 'recon' && <p className="sc-note"><label>
      <input type="checkbox" checked={creditConfirmed} disabled={busy || online !== true}
        onChange={event => onCreditConfirmed(event.target.checked)} />
      {' '}{CREDIT_CONFIRM_LABEL}
    </label></p>}
    <button type="button" className="sc-button sc-full" disabled={busy || (!(kind === 'recon' && mockRecon) && online !== true) || !validInput || (!(kind === 'recon' && mockRecon) && !creditConfirmed)} onClick={() => void submit()}>
      {submitting ? '提交中…' : uncertain ? '等待确认原任务' : taskid && !terminal ? '正在跟踪任务…'
        : kind === 'recon' && mockRecon ? '干跑重建（不扣额度）'
        : !(kind === 'recon' && mockRecon) && !creditConfirmed ? '先勾选扣额度确认闸'
        : kind === 'recon' ? '上传并开始重建（消耗额度）'
        : '直连生成（消耗额度）'}
    </button>
    {unresolved && !taskid && !uncertain && <p className="sc-warning">本机还有一个未确认完成的{config.label}（{new Date(unresolved.at).toLocaleString('zh-CN', { hour12: false })}），再点生成会另起一个任务、再扣一次额度；先在历史记录里查看它的结果。</p>}
    {(submitting || taskid || uncertain) && <>
      <div role="status" aria-live="polite" aria-atomic="true"><strong>{stage.title}</strong><p className="sc-note">{stage.text}</p></div>
      {!terminal && <p className="sc-note">已等 {elapsedSec}s</p>}
      {progress !== undefined && <div className="sc-aholo-progress"><progress aria-label="Aholo 场景进度" max={1} value={progress} /><span>{Math.round(progress * 100)}%</span></div>}
      {taskid && !terminal && !error && <p className="sc-note">
        {checking ? '正在查询最新状态…' : '每 5 秒自动查询一次。'}
        {lastCheckedAt > 0 && ` 最近更新 ${new Date(lastCheckedAt).toLocaleTimeString('zh-CN', { hour12: false })}。`}
        {progress === undefined && 'Aholo 未提供百分比进度。'}
      </p>}
    </>}
    {error && <p className="sc-warning" role="alert">{error}</p>}
    {taskid && error && <button type="button" className="sc-button sc-full" disabled={checking}
      onClick={() => setRetry(value => value + 1)}>继续查询（不重复生成）</button>}
    {detail?.status === 3 && <ResultLinks detail={detail} world={world} />}
    {glbOutput && <button type="button" className="sc-button sc-full" disabled={placing}
      onClick={() => void place(glbOutput)}>{placing ? '正在取回模型…' : '放进 3D 场景'}</button>}
    {placeNote && <p className="sc-note">{placeNote}</p>}
    {placeError && <p className="sc-warning" role="alert">{placeError}</p>}
    {splatOutput && <button type="button" className="sc-button sc-full" disabled={previewing}
      onClick={() => void previewScene(splatOutput)}>{previewing ? '正在取回场景…' : kind === 'recon' ? '挂本场环境预览（替换样例）' : '在 3D 场景预览'}</button>}
    {kind === 'recon' && detail?.status === 3 && isMockReconTask(taskid) && onHangMockScene && <button type="button" className="sc-button sc-full"
      onClick={() => { onHangMockScene(); setMockHangNote(MOCK_HANG_DONE_NOTE); }}>挂样例环境预览（仍缺本场包）</button>}
    {kind === 'recon' && detail?.status === 3 && isMockReconTask(taskid) && <p className="sc-warning" role="status">{VENUE_PACKAGE_MISSING}</p>}
    {previewNote && <p className="sc-note">{previewNote}</p>}
    {mockHangNote && <p className="sc-note">{mockHangNote}</p>}
    {previewError && <p className="sc-warning" role="alert">{previewError}</p>}
  </div>;
}

export function Lux3dDirectTest({ onPlace, onPreviewScene, onHangMockScene, onPreviewShippedScene, onOpenCloudModels, reconPreset }: {
  onPlace?: ((item: CatalogItem) => boolean) | undefined;
  onPreviewScene?: ((source: { url: string; name?: string; taskid?: string; metaUrl?: string }) => Promise<void>) | undefined;
  /** 干跑重建成功后挂环境：等同 D0 hangDemoEnvironment。 */
  onHangMockScene?: (() => void) | undefined;
  /** 线上挂已发布 SPZ 观感层（不打本机代理）。 */
  onPreviewShippedScene?: ((assetId: string) => void) | undefined;
  /** 线上真生成走云：打开活动资料「物料工具」里的 Lux3D。 */
  onOpenCloudModels?: (() => void) | undefined;
  /** 地图采集单「去上传现场素材」带过来的一块地：直接切到场地重建并填好名字。 */
  reconPreset?: { name: string; hint: string } | null;
}) {
  const [kind, setKind] = useState<Kind>('text');
  const [visited, setVisited] = useState<Kind[]>(['text']);
  /** 默认干跑，避免误点真调扣额度；联调真 Aholo 时再关掉。 */
  const [mockRecon, setMockRecon] = useState(true);
  /** 真调扣额度确认闸：关干跑后须勾选；重新打开干跑时清零。 */
  const [creditConfirmed, setCreditConfirmed] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [history, setHistory] = useState(readHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resume, setResume] = useState<{ kind: Kind; taskid: string; prompt: string; startedAt: number } | null>(null);
  const onHistory = useCallback(() => setHistory(readHistory()), []);
  const localProxy = isLux3dLocalProxy();
  const [placingShipped, setPlacingShipped] = useState<string | null>(null);
  const [shippedError, setShippedError] = useState('');
  useEffect(() => {
    if (!localProxy) {
      setOnline(false);
      setConnectionError('');
      return;
    }
    const controller = new AbortController();
    void request<{ keyConfigured: boolean }>('/health', { signal: controller.signal }).then(body => {
      if (controller.signal.aborted) return;
      setOnline(body.keyConfigured);
      setConnectionError(body.keyConfigured ? '' : '本机代理未配置 LUX3D_API_KEY，暂时不能生成。');
    }).catch(failure => {
      if (!controller.signal.aborted) { setOnline(false); setConnectionError(String(failure.message)); }
    });
    return () => controller.abort();
  }, [localProxy]);
  async function placeShipped(assetId: string) {
    if (!onPlace || placingShipped) return;
    setPlacingShipped(assetId); setShippedError('');
    try {
      const item = await loadStoredAholoCatalogItem(assetId);
      if (!onPlace(item)) setShippedError('未能放入场地，请稍后重试。');
    } catch (failure) {
      setShippedError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPlacingShipped(null);
    }
  }
  function select(next: Kind) {
    setKind(next); setVisited(previous => previous.includes(next) ? previous : [...previous, next]);
  }
  // 采集单把这块地送来时人已经在左栏，不用再点一次「场地重建」标签。
  const openedPreset = useRef<typeof reconPreset>(null);
  useEffect(() => {
    if (!reconPreset || openedPreset.current === reconPreset) return;
    openedPreset.current = reconPreset;
    setKind('recon');
    setVisited(previous => previous.includes('recon') ? previous : [...previous, 'recon']);
  }, [reconPreset]);
  function openHistoryTask(item: HistoryEntry) {
    select(item.kind);
    setResume({ kind: item.kind, taskid: item.taskid, prompt: item.prompt, startedAt: item.startedAt });
  }
  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* 存储被禁用时列表保持原样。 */ }
    onHistory();
  }
  const kinds = Object.keys(CAPABILITIES) as Kind[];
  return <div className="sc-lux-direct">
    <div className="sc-section-heading"><div><h2>备用 · 观感与图片</h2><p>主路径是左侧晴光「Aholo 生成」（Lux3D 文生/图生）。这里留图片建模、场景观感与场地重建；文字建模仅作本机联调兜底。</p></div>
      <button type="button" className="sc-button" aria-expanded={historyOpen} aria-controls="aholo-history"
        onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? '收起历史' : `历史记录（${history.length}）`}</button>
    </div>
    <p className="sc-aholo-path" role="note">主路径：地图圈画 → 采集单 → 场地重建 → 环境预览。高德只定场与出采集单；卫星不可作重建素材。</p>
    {!localProxy && <div className="sc-aholo-cloud-surface" role="region" aria-label="线上观感入口">
      <p className="sc-note">线上不走本机代理。可直接挂已发布观感层；真生成物件请用云端 Lux3D（活动资料 · 物料工具）。场地重建仍可干跑挂样例。</p>
      <div className="sc-aholo-cloud-actions">
        <button type="button" className="sc-button" onClick={() => onPreviewShippedScene?.(CLOUD_E2E_WORLD_SCENE_ID)}>挂云E2E宴会厅观感</button>
        <button type="button" className="sc-button" onClick={() => { if (onPreviewShippedScene) onPreviewShippedScene(DEMO_WORLD_SCENE_ID); else onHangMockScene?.(); }}>挂样例环境预览</button>
        {onOpenCloudModels && <button type="button" className="sc-button" onClick={onOpenCloudModels}>打开云端 Aholo 物料</button>}
      </div>
      <div className="sc-aholo-cloud-actions" role="group" aria-label="已发布物件">
        {listShippedAssets('glb').map(asset => (
          <button key={asset.assetId} type="button" className="sc-button" disabled={placingShipped !== null}
            onClick={() => void placeShipped(asset.assetId)}>
            {placingShipped === asset.assetId ? '摆放中…' : `摆放·${asset.name}`}
          </button>
        ))}
      </div>
      {shippedError && <p className="sc-warning" role="alert">{shippedError}</p>}
    </div>}
    {reconPreset && <p className="sc-note sc-aholo-from-capture" role="status">来自采集单「{reconPreset.name}」· {reconPreset.hint}。已切到「场地重建」，可直接选现场素材。</p>}
    {connectionError && <p className="sc-warning" role="alert">{connectionError}</p>}
    <div className="sc-aholo-history" id="aholo-history" hidden={!historyOpen}>
      {history.length === 0 ? <p className="sc-note">本机还没有生成记录。发起一次生成后会出现在这里。</p> : <>
        <div className="sc-aholo-history-head"><strong>本机记录 {history.length} 条</strong>
          <button type="button" className="sc-button" onClick={clearHistory}>清空</button>
        </div>
        <ul>{history.map(item => <li key={`${item.kind}-${item.taskid}`}>
          <div><strong>{CAPABILITIES[item.kind].label}</strong><span>{item.prompt || '（无描述）'}</span>
            <span className="sc-note">{STAGES[item.status]?.title ?? item.label} · {new Date(item.at).toLocaleString('zh-CN', { hour12: false })}</span></div>
          <button type="button" className="sc-button" onClick={() => openHistoryTask(item)}>查看</button>
        </li>)}</ul>
      </>}
    </div>
    {historyOpen && history.length > 0 && <p className="sc-note">记录只存描述与状态；产物链接会过期，点「查看」回 Aholo 取最新结果。</p>}
    <div className="sc-aholo-tabs" role="tablist" aria-label="场地观感与物料方式">{kinds.map((key, index) => <button
      key={key} id={`aholo-tab-${key}`} type="button" role="tab" aria-selected={kind === key} aria-controls={`aholo-panel-${key}`}
      tabIndex={kind === key ? 0 : -1} onClick={() => select(key)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? kinds[(index + 1) % kinds.length] : event.key === 'ArrowLeft' ? kinds[(index + kinds.length - 1) % kinds.length] : event.key === 'Home' ? kinds[0] : event.key === 'End' ? kinds[kinds.length - 1] : undefined;
        if (next) { event.preventDefault(); select(next); document.getElementById(`aholo-tab-${next}`)?.focus(); }
      }}>{CAPABILITIES[key].label}</button>)}</div>
    {kinds.map(key => <section key={key} id={`aholo-panel-${key}`} role="tabpanel" aria-labelledby={`aholo-tab-${key}`} hidden={kind !== key}>
      {visited.includes(key) && <DirectTaskPanel kind={key} online={online} resume={resume} reconPreset={reconPreset ?? null} mockRecon={mockRecon} onMockRecon={setMockRecon} creditConfirmed={creditConfirmed} onCreditConfirmed={setCreditConfirmed} onHangMockScene={onHangMockScene} onHistory={onHistory} onPlace={onPlace} onPreviewScene={onPreviewScene}
        unresolved={history.find(item => item.kind === key && !TERMINAL.includes(item.status))} />}
    </section>)}
  </div>;
}
