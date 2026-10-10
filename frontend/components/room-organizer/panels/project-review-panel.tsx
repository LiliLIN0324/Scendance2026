'use client';

import { useEffect, useRef, useState } from 'react';
import {
  attachProjectReviewImages, projectReviewHtml, projectReviewIsStale, validateProjectReviewCaptures,
  type ProjectReviewCapture, type ProjectReviewSnapshot, type ProjectReviewSource,
} from '@/lib/project-review';
import {
  prepareProjectReview, ProjectReviewChangedError,
  type PreparedProjectReview, type ProjectReviewPanelActions, type ProjectReviewSettings,
} from '@/lib/project-review-workflow';
import { downloadTextFile } from '../lib/plan-export/download';
import { ProjectReviewLibraryPanel } from './project-review-library';
import './project-review-panel.css';

export interface ProjectReviewPanelProps {
  storageIdentity?: string;
  source: ProjectReviewSource;
  actions: ProjectReviewPanelActions;
  disabled?: boolean;
  inputLocked?: boolean;
}

const initialSettings = (): ProjectReviewSettings => ({
  disclosure: { brief: false, design: false }, summary: '', pending: '', includeImage: false, includeReference: false,
});
const sameSource = (a: ProjectReviewSource | null, b: ProjectReviewSource) => !!a && a.scope === b.scope && a.revision === b.revision;
type CheckedCapture = { image: ProjectReviewCapture; approved: boolean };
type ReviewFile = { snapshot: ProjectReviewSnapshot; html: string };
type Work = 'prepare' | 'capture' | null;

/** One review draft only. The editor owns source reads and canvas capture. */
export function ProjectReviewPanel({ source, actions, disabled = false, inputLocked = false, storageIdentity }: ProjectReviewPanelProps): JSX.Element {
  const [settings, setSettings] = useState(initialSettings);
  const [prepared, setPrepared] = useState<PreparedProjectReview | null>(null);
  const [captures, setCaptures] = useState<CheckedCapture[]>([]);
  const [file, setFile] = useState<ReviewFile | null>(null);
  const [working, setWorking] = useState<Work>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const latestActions = useRef(actions);
  latestActions.current = actions;
  const operation = useRef({ id: 0, kind: null as Work });
  const baseline = useRef({ source: { ...source }, disabled, storageIdentity, epoch: 0 });
  const previousScope = useRef(source.scope);
  const previousIdentity = useRef(storageIdentity);
  const inputLock = useRef(inputLocked); inputLock.current = inputLocked;
  if (!sameSource(baseline.current.source, source) || baseline.current.disabled !== disabled || baseline.current.storageIdentity !== storageIdentity) {
    baseline.current = { source: { ...source }, disabled, storageIdentity, epoch: baseline.current.epoch + 1 };
    operation.current = { id: operation.current.id + 1, kind: null };
  }
  const epoch = baseline.current.epoch;

  function readSource(): ProjectReviewSource | null {
    try {
      const value = latestActions.current.getSource();
      return typeof value?.scope === 'string' && typeof value?.revision === 'string'
        ? { scope: value.scope, revision: value.revision } : null;
    } catch { return null; }
  }
  const liveSource = readSource();
  const sourceMatches = sameSource(liveSource, source);
  const identityMatches = previousIdentity.current === storageIdentity;
  const usable = !!prepared && !disabled && identityMatches && !stale && sourceMatches && sameSource(prepared.snapshot.source, source);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current = { id: operation.current.id + 1, kind: null }; };
  }, []);
  useEffect(() => {
    setWorking(null); setPrepared(null); setCaptures([]); setFile(null); setError(''); setNotice('');
    setStale(previous => previous || !!prepared || working !== null);
    if (previousScope.current !== source.scope || previousIdentity.current !== storageIdentity) {
      setSettings(initialSettings()); previousScope.current = source.scope; previousIdentity.current = storageIdentity;
    }
    // Source/disabled changes cancel outstanding work; its eventual result cannot repopulate this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  useEffect(() => {
    if (sourceMatches) return;
    operation.current = { id: operation.current.id + 1, kind: null };
    setWorking(null); setPrepared(null); setCaptures([]); setFile(null); setStale(true); setNotice(''); setError('');
    // A mismatch observed during rendering permanently invalidates the old review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSource?.scope, liveSource?.revision, source.scope, source.revision]);

  function invalidate(): void {
    operation.current = { id: operation.current.id + 1, kind: null };
    setStale(previous => previous || !!prepared || working !== null);
    setWorking(null); setPrepared(null); setCaptures([]); setFile(null); setError(''); setNotice('');
  }
  function canChange(): boolean {
    return !inputLock.current && !baseline.current.disabled && previousScope.current === baseline.current.source.scope &&
      previousIdentity.current === baseline.current.storageIdentity;
  }
  function change(next: ProjectReviewSettings): void { if (!canChange()) return; invalidate(); setSettings(next); }
  function expire(): void {
    invalidate(); setStale(true);
    setError(readSource() ? '当前内容已变化，请重新生成评审包。' : '暂时无法读取当前内容，请稍后重试。');
  }
  function begin(kind: Exclude<Work, null>) {
    const next = { id: operation.current.id + 1, kind };
    operation.current = next; setWorking(kind); setError(''); setNotice('');
    return { id: next.id, epoch: baseline.current.epoch, source: { ...baseline.current.source } };
  }
  function alive(token: { id: number; epoch: number }): boolean {
    return mounted.current && operation.current.id === token.id && baseline.current.epoch === token.epoch && !baseline.current.disabled;
  }
  function currentSource(expected: ProjectReviewSource): ProjectReviewSource {
    const current = readSource();
    if (!current || baseline.current.disabled || !sameSource(current, baseline.current.source) || !sameSource(current, expected)) {
      throw new ProjectReviewChangedError();
    }
    return current;
  }
  function makeFile(snapshot: ProjectReviewSnapshot, images: CheckedCapture[]): ReviewFile {
    const current = currentSource(snapshot.source);
    if (images.some(image => !image.approved)) throw new Error('Image approval required');
    const finalSnapshot = images.length ? attachProjectReviewImages(snapshot,
      images.map(({ image }) => ({ ...image, approvedForCustomer: true })), current) : snapshot;
    const html = projectReviewHtml(finalSnapshot);
    currentSource(snapshot.source);
    return { snapshot: finalSnapshot, html };
  }
  async function generate(): Promise<void> {
    if (!canChange() || operation.current.kind) return;
    try { currentSource(source); } catch { expire(); return; }
    const token = begin('prepare');
    setStale(false); setPrepared(null); setCaptures([]); setFile(null);
    try {
      const guardedActions: ProjectReviewPanelActions = {
        getSource: () => { if (!alive(token)) throw new ProjectReviewChangedError(); return currentSource(token.source); },
        prepare: () => latestActions.current.prepare(),
        capture: (snapshot, options) => {
          if (!alive(token)) throw new ProjectReviewChangedError();
          const provider = latestActions.current;
          if (!provider.capture) return Promise.reject(new Error('Capture unavailable'));
          return provider.capture(snapshot, options);
        },
      };
      const next = await prepareProjectReview(guardedActions, settings);
      if (!alive(token)) return;
      currentSource(token.source);
      setPrepared(next);
      if (next.capture.state === 'ready') setCaptures([{ image: next.capture.image, approved: false }]);
      else if (next.capture.state === 'omitted') setFile(makeFile(next.snapshot, []));
    } catch (caught) {
      if (!alive(token)) return;
      if (caught instanceof ProjectReviewChangedError) expire();
      else setError('评审包未能生成，请稍后重试。');
    } finally {
      if (alive(token)) { operation.current.kind = null; setWorking(null); }
    }
  }
  async function addCapture(): Promise<void> {
    if (!canChange() || !usable || !prepared || operation.current.kind || captures.length >= 6) return;
    try { currentSource(prepared.snapshot.source); } catch { expire(); return; }
    const token = begin('capture');
    try {
      const provider = latestActions.current;
      if (!provider.capture) throw new Error('Capture unavailable');
      const captured = await provider.capture(prepared.snapshot, { includeReference: settings.includeReference });
      if (!alive(token)) return;
      currentSource(token.source);
      const images = validateProjectReviewCaptures(prepared.snapshot, [...captures.map(capture => capture.image), captured]);
      const image = images[images.length - 1];
      setPrepared({ snapshot: prepared.snapshot, capture: { state: 'ready', image } });
      setCaptures(images.map((image, index) => ({ image, approved: captures[index]?.approved ?? false }))); setFile(null);
    } catch (caught) {
      if (!alive(token)) return;
      if (caught instanceof ProjectReviewChangedError || !sameSource(readSource(), token.source)) expire();
      else setError('补充画面未完成，原评审内容已保留。请稍后重试。');
    } finally {
      if (alive(token)) { operation.current.kind = null; setWorking(null); }
    }
  }
  function approve(index: number, approved: boolean): void {
    if (!canChange() || !usable || !prepared || operation.current.kind) return;
    try {
      currentSource(prepared.snapshot.source);
      const next = captures.map((capture, i) => i === index ? { ...capture, approved } : capture);
      setCaptures(next); setFile(null); setError(''); setNotice('');
      if (next.every(capture => capture.approved)) setFile(makeFile(prepared.snapshot, next));
    } catch (caught) {
      if (caught instanceof ProjectReviewChangedError) expire();
      else setError('画面尚不能放入评审文件，请重新生成或改为无图评审。');
    }
  }
  function withoutImages(): void {
    if (!canChange() || !usable || !prepared || operation.current.kind) return;
    try {
      const nextFile = makeFile(prepared.snapshot, []);
      setPrepared({ snapshot: prepared.snapshot, capture: { state: 'omitted' } });
      setCaptures([]); setFile(nextFile); setSettings({ ...settings, includeImage: false }); setError(''); setNotice('已改为无图评审。');
    } catch { expire(); }
  }
  function cancel(): void {
    const kind = operation.current.kind;
    operation.current = { id: operation.current.id + 1, kind: null }; setWorking(null); setError('');
    if (kind === 'prepare') { setPrepared(null); setCaptures([]); setFile(null); }
    setNotice(kind === 'capture' ? '已取消补充画面。' : '已取消本次准备。');
  }
  function download(): void {
    if (!usable || !prepared || !file || operation.current.kind || captures.some(capture => !capture.approved)) return;
    try {
      const current = currentSource(file.snapshot.source);
      if (projectReviewIsStale(file.snapshot, current)) throw new ProjectReviewChangedError();
      const safeId = file.snapshot.snapshot.id.replace(/[^a-z0-9_-]/gi, '').slice(0, 80) || '本次';
      downloadTextFile(`幕景_评审_${safeId}.html`, 'text/html;charset=utf-8', file.html);
      setError(''); setNotice('已发起下载，请确认文件已保存。');
    } catch (caught) {
      if (caught instanceof ProjectReviewChangedError) expire();
      else setError('下载未能发起，请重试。');
    }
  }
  const ready = usable && !!file && prepared?.capture.state !== 'failed' && captures.every(capture => capture.approved);
  const message = !liveSource ? '暂时无法读取当前内容，请稍后重试。'
    : !sourceMatches ? '当前内容已变化，请重新生成评审包。' : error;

  return <section className="sc-project-review" aria-label="客户评审包">
    <h3>客户评审包</h3>
    <p className="sc-note">准备一份可预览、下载和打印的方案文件。选择本次允许公开的内容。</p>
    {storageIdentity && <details className="sc-review-library-entry"><summary>本机草稿与文件</summary>
      <ProjectReviewLibraryPanel key={storageIdentity} identityKey={storageIdentity} scope={source.scope}
        draft={identityMatches?{summary:settings.summary,pending:settings.pending}:{summary:'',pending:''}} onLoadDraft={draft=>change({...initialSettings(),...draft})}
        file={ready?file:null} getSource={actions.getSource} disabled={disabled||inputLocked||!identityMatches||working!==null||!sourceMatches}/>
    </details>}
    <fieldset className="sc-project-review-fields" disabled={disabled||inputLocked||!identityMatches}>
      <legend>本次文件内容</legend>
      <label className="sc-project-review-option"><input type="checkbox" checked={settings.disclosure.brief}
        onChange={event => change({ ...settings, disclosure: { ...settings.disclosure, brief: event.target.checked } })}/>包含当前活动需求</label>
      <label className="sc-project-review-option"><input type="checkbox" checked={settings.disclosure.design}
        onChange={event => change({ ...settings, disclosure: { ...settings.disclosure, design: event.target.checked } })}/>包含当前设计说明</label>
      <label className="sc-field">简短方案说明（选填）<textarea maxLength={1000} rows={3} value={settings.summary}
        onChange={event => change({ ...settings, summary: event.target.value.slice(0, 1000) })}/></label>
      <label className="sc-field">待确认项（选填）<textarea maxLength={1000} rows={3} value={settings.pending}
        onChange={event => change({ ...settings, pending: event.target.value.slice(0, 1000) })}/></label>
      <p className="sc-note">以上手写内容仅用于本次评审，请使用客户能直接阅读的文字。</p>
      <label className="sc-project-review-option"><input type="checkbox" checked={settings.includeImage}
        onChange={event => change({ ...settings, includeImage: event.target.checked })}/>包含当前画面</label>
      <label className="sc-project-review-option"><input type="checkbox" checked={settings.includeReference}
        onChange={event => change({ ...settings, includeReference: event.target.checked })}/>允许在评审画面中包含当前参考底图</label>
      <p className="sc-note">参考底图可能进入画面，捕获后仍需逐张核对。</p>
    </fieldset>
    <div className="sc-project-review-actions">
      <button type="button" className="sc-button" disabled={disabled || inputLocked || !identityMatches || working !== null || !sourceMatches}
        onClick={() => void generate()}>{working === 'prepare' ? '正在准备评审包…' : '生成评审包'}</button>
      {working && <button type="button" className="sc-button" disabled={disabled} onClick={cancel}>{working === 'capture' ? '取消补充画面' : '取消本次准备'}</button>}
    </div>
    {stale && !message && <p className="sc-project-review-warning" role="status">评审内容已过期，请重新生成。</p>}
    {usable && prepared && <div className="sc-project-review-result">
      {prepared.capture.state === 'failed' && <p className="sc-project-review-warning" role="alert">{prepared.capture.message??'画面未能捕获，评审文件尚未生成。'} 请重试，或明确改为无图评审。</p>}
      {captures.map((capture, index) => <figure className="sc-project-review-image" key={index}>
        <img src={capture.image.dataUrl} alt={`待核对的评审画面 ${index + 1}`}/>
        <figcaption>画面 {index + 1} · {capture.approved ? '已核对' : '待核对'}</figcaption>
        <label className="sc-project-review-option"><input type="checkbox" checked={capture.approved} disabled={disabled || inputLocked || working !== null}
          onChange={event => approve(index, event.target.checked)}/>我已核对这张画面，可以放入评审文件</label>
      </figure>)}
      {!!captures.length && !ready && <p className="sc-note">逐张核对并勾选后，才会生成包含这些画面的评审文件。</p>}
      <div className="sc-project-review-actions">
        <button type="button" className="sc-button" disabled={disabled || inputLocked || working !== null || captures.length >= 6}
          onClick={() => void addCapture()}>{working === 'capture' ? '正在补充画面…' : '补充当前画面'}</button>
        {(prepared.capture.state === 'failed' || captures.length > 0) && <button type="button" className="sc-button" disabled={disabled || inputLocked || working !== null}
          onClick={withoutImages}>改为无图评审</button>}
      </div>
      <p className="sc-note">同一份评审最多包含 6 张画面。切换视角后可补充当前画面。</p>
      {ready && file && <><iframe className="sc-project-review-preview" srcDoc={file.html} sandbox="" title="客户评审预览"/>
        <button type="button" className="sc-button" disabled={working !== null} onClick={download}>下载评审文件（HTML）</button></>}
    </div>}
    {message && <p className="sc-handoff-error" role="alert">{message}</p>}
    {notice && !disabled && <p className="sc-note" role="status">{notice}</p>}
  </section>;
}
