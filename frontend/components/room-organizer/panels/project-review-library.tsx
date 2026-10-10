'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MAX_PROJECT_REVIEW_FILES, MAX_PROJECT_REVIEW_FILE_BYTES, MAX_PROJECT_REVIEW_LIBRARY_BYTES,
  readProjectReviewLibrary, removeProjectReviewFile, saveProjectReviewDraft, saveProjectReviewFile,
  type ProjectReviewLibrary, type SavedReviewFile,
} from '@/lib/project-review-library';
import { registerSourceFlush } from '@/lib/source-storage';
import { downloadTextFile } from '../lib/plan-export/download';
import type { ProjectReviewSnapshot, ProjectReviewSource } from '@/lib/project-review';
import './project-review-panel.css';

type DraftText = { summary: string; pending: string };
export interface ProjectReviewLibraryPanelProps {
  identityKey: string; scope: string; draft: DraftText; onLoadDraft(value: DraftText): void;
  file: { snapshot: ProjectReviewSnapshot; html: string } | null;
  getSource(): ProjectReviewSource; disabled: boolean;
}
type Work = 'read' | 'draft-save' | 'draft-load' | 'file-save' | 'download' | 'remove';
type Token = { id: number; epoch: number; key: string; scope: string };
const sameText = (a: DraftText, b: DraftText) => a.summary === b.summary && a.pending === b.pending;
const sameSource = (a: ProjectReviewSource, b: ProjectReviewSource) => a.scope === b.scope && a.revision === b.revision;
const sameFile = (a: SavedReviewFile, b: Omit<SavedReviewFile, 'savedAt'>) => a.id === b.id && a.title === b.title &&
  a.generatedAt === b.generatedAt && sameSource(a.source, b.source) && a.html === b.html;
const time = (value: string) => new Date(value).toLocaleString();

/** History stays independent of the live review and all its publication permissions. */
export function ProjectReviewLibraryPanel(props: ProjectReviewLibraryPanelProps): JSX.Element {
  const latest = useRef(props); latest.current = props;
  const identity = useRef({ key: props.identityKey, scope: props.scope, epoch: 0 });
  if (identity.current.key !== props.identityKey || identity.current.scope !== props.scope) {
    identity.current = { key: props.identityKey, scope: props.scope, epoch: identity.current.epoch + 1 };
  }
  const { epoch } = identity.current;
  const baseline = useRef({ epoch, text: { ...props.draft } });
  if (baseline.current.epoch !== epoch) baseline.current = { epoch, text: { ...props.draft } };
  const draftRevision = useRef<{ epoch: number; revision: string | null } | null>(null);
  const mounted = useRef(true);
  const operation = useRef({ id: 0, epoch: -1, kind: null as Work | null });
  const [loaded, setLoaded] = useState<{ epoch: number; data: ProjectReviewLibrary } | null>(null);
  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [working, setWorking] = useState<{ epoch: number; kind: Work } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    operation.current = { id: operation.current.id + 1, epoch: -1, kind: null };
  }; }, []);

  function current(token: Token): boolean {
    return mounted.current && operation.current.id === token.id && identity.current.epoch === token.epoch &&
      latest.current.identityKey === token.key && latest.current.scope === token.scope;
  }
  function checked(data: ProjectReviewLibrary, scope: string): ProjectReviewLibrary {
    if (data.files.some(file => file.source.scope !== scope)) throw new Error('File belongs to another activity');
    // The storage reader validates each static HTML file before returning it.
    return data;
  }
  async function run(kind: Work, message: string, action: (token: Token) => Promise<void>): Promise<void> {
    if (operation.current.epoch === epoch && operation.current.kind) return;
    const token = { id: operation.current.id + 1, epoch, key: props.identityKey, scope: props.scope };
    operation.current = { id: token.id, epoch, kind }; setWorking({ epoch, kind }); setError(''); setNotice('');
    try { await action(token); }
    catch { if (current(token)) { setError(message); if (kind === 'read') setReadState('error'); } }
    finally { if (current(token)) { operation.current.kind = null; setWorking(null); } }
  }
  function read(): Promise<void> {
    setReadState('loading');
    return run('read', '本机评审资料未能读取或不属于当前活动，请重试。原资料不会被覆盖。', async token => {
      const data = checked(await readProjectReviewLibrary(token.key), token.scope);
      if (!current(token)) return;
      draftRevision.current = { epoch: token.epoch, revision: data.draft?.revision ?? null };
      setLoaded({ epoch: token.epoch, data }); setReadState('ready');
      setSelectedId(id => data.files.some(file => file.id === id) ? id : null);
    });
  }
  useEffect(() => {
    setLoaded(null); setSelectedId(null); setError(''); setNotice(''); void read();
    // Only identity changes or explicit reload may adopt a new draft CAS revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]); // A→B→A must invalidate the first A read too.
  useEffect(() => registerSourceFlush(props.scope, async () => {
    if (identity.current.epoch !== epoch) return;
    if (!sameText(latest.current.draft, baseline.current.text)) throw new Error('评审说明有未保存修改，请先保存或放弃修改');
    if (operation.current.epoch === epoch && operation.current.kind === 'draft-save') throw new Error('评审说明正在保存，请等待完成后重试');
  }), [props.scope, epoch]);

  const data = loaded?.epoch === epoch ? loaded.data : null;
  const ready = !!data && readState === 'ready';
  const busy = working?.epoch === epoch ? working.kind : null;
  const blocked = props.disabled || !!busy || !ready;
  const dirty = !sameText(props.draft, baseline.current.text);
  const selected = data?.files.find(file => file.id === selectedId);

  function saveDraft(): void {
    if (blocked || !data || draftRevision.current?.epoch !== epoch) return;
    const submitted = { ...props.draft }, expectedRevision = draftRevision.current.revision;
    void run('draft-save', '说明草稿未能核实保存，请重新读取本机资料后重试。当前输入已保留。', async token => {
      const draft = await saveProjectReviewDraft(token.key, submitted, expectedRevision);
      if (!current(token)) return;
      const fresh = checked(await readProjectReviewLibrary(token.key), token.scope);
      if (!current(token)) return;
      if (!fresh.draft || fresh.draft.revision !== draft.revision || !sameText(fresh.draft, submitted)) throw new Error('Saved draft no longer matches');
      draftRevision.current = { epoch: token.epoch, revision: draft.revision };
      setLoaded({ epoch: token.epoch, data: fresh });
      baseline.current = { epoch: token.epoch, text: submitted };
      setNotice(sameText(latest.current.draft, submitted) ? '说明草稿已保存到本机。' : '已保存本次提交的说明；当前输入仍有未保存修改。');
    });
  }
  function loadDraft(): void {
    if (blocked || !data?.draft) return;
    void run('draft-load', '说明草稿未能载入，当前输入已保留。请重新读取后重试。', async token => {
      const fresh = checked(await readProjectReviewLibrary(token.key), token.scope);
      if (!current(token) || latest.current.disabled) return;
      if (!fresh.draft) throw new Error('Draft no longer exists');
      const text = { summary: fresh.draft.summary, pending: fresh.draft.pending }, input = latest.current.draft;
      if (!sameText(input, text) && (input.summary.trim() || input.pending.trim()) &&
        !window.confirm('载入会替换当前两段说明，并重置所有公开选项。继续吗？')) return;
      draftRevision.current = { epoch: token.epoch, revision: fresh.draft.revision };
      setLoaded({ epoch: token.epoch, data: fresh });
      baseline.current = { epoch: token.epoch, text };
      latest.current.onLoadDraft(text); setNotice('已载入本机说明，请重新选择本次允许公开的内容。');
    });
  }
  function saveFile(): void {
    if (blocked || !props.file || props.file.snapshot.images.some(image => image.approvedForCustomer !== true)) return;
    const file = props.file;
    const input = { id: file.snapshot.snapshot.id, title: file.snapshot.current.layout.name,
      generatedAt: file.snapshot.snapshot.generatedAt, source: { ...file.snapshot.source }, html: file.html };
    void run('file-save', '当前评审文件未能核实保存。请重新读取本机资料或重新准备评审文件。', async token => {
      const verify = () => {
        if (!current(token) || latest.current.file !== file || latest.current.file.html !== input.html ||
          input.source.scope !== token.scope || !sameSource(latest.current.file.snapshot.source, input.source) ||
          latest.current.file.snapshot.snapshot.id !== input.id || !sameSource(latest.current.getSource(), input.source)) throw new Error('Review is no longer current');
      };
      verify();
      const saved = await saveProjectReviewFile(token.key, input);
      verify();
      if (!sameFile(saved, input)) throw new Error('Saved file no longer matches');
      const fresh = checked(await readProjectReviewLibrary(token.key), token.scope);
      verify();
      const restored = fresh.files.find(value => value.id === input.id);
      if (!restored || !sameFile(restored, input)) throw new Error('Saved file was not read back');
      setLoaded(previous => previous?.epoch === token.epoch ? { epoch: token.epoch, data: { ...previous.data, files: fresh.files } } : previous);
      setNotice('当前评审文件已保存为本机冻结副本。');
    });
  }
  function download(file: SavedReviewFile): void {
    if (blocked) return;
    void run('download', '这份本机文件未能核实，请重新读取后再下载。', async token => {
      const fresh = checked(await readProjectReviewLibrary(token.key), token.scope);
      if (!current(token)) return;
      const target = fresh.files.find(value => value.id === file.id);
      if (!target || !sameFile(target, file)) throw new Error('Stored file changed');
      const id = target.id.replace(/[^a-z0-9_-]/gi, '').slice(0, 80) || '本机';
      downloadTextFile(`幕景_评审_${id}.html`, 'text/html;charset=utf-8', target.html);
      setNotice('已发起冻结文件下载，请确认文件已保存。');
    });
  }
  function remove(): void {
    if (blocked || !selected || !window.confirm('删除这份评审文件的本机副本？已下载到电脑的文件会保留。')) return;
    const id = selected.id;
    void run('remove', '删除结果未能核实，原列表与预览仍保留。请重新读取后核对。', async token => {
      const next = checked(await removeProjectReviewFile(token.key, id), token.scope);
      if (!current(token)) return;
      setLoaded(previous => previous?.epoch === token.epoch ? { epoch: token.epoch, data: { ...previous.data, files: next.files } } : previous);
      setSelectedId(null); setNotice('所选本机副本已删除。');
    });
  }

  return <section className="sc-project-review" aria-label="本机评审资料">
    <h3>本机评审资料</h3>
    <p className="sc-note">说明草稿只保存两段文字。载入会替换当前说明并重置公开选项，不载入历史画面或公开许可。</p>
    <p className="sc-note">本机说明和历史文件不会随场景与活动备份迁移；历史文件可单独下载带走。</p>
    <p className="sc-note">最多保留 {MAX_PROJECT_REVIEW_FILES} 份文件，每份 {MAX_PROJECT_REVIEW_FILE_BYTES / 1024 / 1024} MiB、合计 {MAX_PROJECT_REVIEW_LIBRARY_BYTES / 1024 / 1024} MiB。满后请先删除不再需要的本机副本。</p>
    <p className="sc-note">{dirty ? '当前说明有未保存修改。' : '当前说明没有未保存修改。'}{data?.draft ? ` 本机草稿保存于 ${time(data.draft.savedAt)}。` : ready ? ' 尚无本机说明草稿。' : ''}</p>
    <div className="sc-project-review-actions">
      <button type="button" className="sc-button" disabled={blocked} onClick={saveDraft}>保存说明草稿</button>
      <button type="button" className="sc-button" disabled={blocked || !data?.draft} onClick={loadDraft}>载入已保存说明</button>
      {dirty && <button type="button" className="sc-button" disabled={props.disabled || !!busy} onClick={() => {
        props.onLoadDraft({ ...baseline.current.text }); setError(''); setNotice('已放弃本次说明修改，并重置公开选项。');
      }}>放弃说明修改</button>}
      <button type="button" className="sc-button" disabled={blocked || !props.file || props.file.snapshot.images.some(image => image.approvedForCustomer !== true)} onClick={saveFile}>保存当前评审文件</button>
      <button type="button" className="sc-button" disabled={props.disabled || !!busy} onClick={() => void read()}>{readState === 'error' ? '重试读取本机资料' : '重新读取本机资料'}</button>
    </div>
    {busy && <p className="sc-note" role="status">{busy === 'read' ? '正在读取本机评审资料…' : '正在处理本机评审资料…'}</p>}
    {data && <details><summary>本机评审文件（{data.files.length}）</summary>
      {!data.files.length && <p className="sc-note">尚无本机评审文件。</p>}
      <ul>{data.files.map(file => <li key={file.id}><strong>{file.title}</strong><span> · 原生成时间 {time(file.generatedAt)}</span>
        <div className="sc-project-review-actions"><button type="button" className="sc-button" disabled={blocked} onClick={() => { setSelectedId(file.id); setError(''); setNotice(''); }}>查看</button>
          <button type="button" className="sc-button" disabled={blocked} onClick={() => download(file)}>下载</button></div>
      </li>)}</ul>
      {selected && <div><strong>{selected.title}</strong><p className="sc-note">原生成时间 {time(selected.generatedAt)} · 冻结文件，未与当前内容自动比对</p>
        <iframe className="sc-project-review-preview" srcDoc={selected.html} sandbox="" title="本机评审文件预览"/>
        <button type="button" className="sc-button" disabled={blocked} onClick={remove}>删除本机副本</button>
      </div>}
    </details>}
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </section>;
}
