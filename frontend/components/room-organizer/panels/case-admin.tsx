'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from '@/components/solid-icons';
import {
  fetchCloudCapabilities,
  listCloudCaseDrafts,
  listCloudCaseVersions,
  publishCloudCase,
  restoreCloudCase,
  suggestCloudCaseStableId,
  unpublishCloudCase,
  upsertCloudCase,
  type CloudCapabilities,
  type CloudCaseOpError,
  type CloudCaseDraft,
  type CloudCaseVersion,
  type CloudCaseSessionContract,
} from '../lib/cloud-cases';
import { ensurePublishedArchiveNow } from '../lib/complete-archive';
import { publishGateSnapshot } from '../lib/project-manifest';
import type { CloudArchiveAsset } from '../../../../supabase/functions/_shared/cloud-storage-contract';
import type { BackendSession } from '@/lib/backend-session';
import './case-admin.css';

/**
 * 案例运营页（任务 C，2026-11-20）——分享卡「案例」页签的内容。
 *
 * 管理员在当前项目上维护官方案例：保存草稿 → 发布/更新公众版本 → 历史/恢复 → 下架。
 * 权限以 getCloudCapabilities 的服务端回答为准（每次发布都由服务端复核，撤权即时生效）；
 * 未接通/未授权都如实说明，不做本机模拟。发布失败只报错，不动既有入口：
 * 公众继续看到上一个完整版本，本卡的发布链接也不清空。
 */

/** 发布/保存动作时的项目与版本，以动作那一刻的服务端快照为准，不用渲染时的陈旧值。 */
function currentProjectRef(controller: BackendSession | null, layoutId?: string | null): { projectId: string | null; revision: number | null } {
  try {
    const snapshot = controller?.getSnapshot?.();
    if (!snapshot) return { projectId: layoutId ?? null, revision: null };
    const projectId = snapshot.project?.id ?? layoutId ?? null;
    const revision = Number.isFinite(snapshot.revision) ? snapshot.revision : null;
    return { projectId, revision };
  } catch {
    return { projectId: layoutId ?? null, revision: null };
  }
}

/** 封面候选：从项目发布清单的已归档照片/图纸里选（服务端只认 published 依赖里的封面资产）。 */
interface CoverCandidate {
  assetId: string;
  label: string;
}

/** 浏览器里能当封面渲染的资产种类；模型/扫描不是图片，列出来只会得到一张裂图。 */
const COVER_KIND_LABELS: Record<string, string> = { photo: '照片', floorplan: '图纸' };

async function loadCoverCandidates(controller: BackendSession | null, studioId: string | null | undefined): Promise<{ candidates: CoverCandidate[]; note: string }> {
  const gate = await publishGateSnapshot();
  const manifest = gate.manifest;
  if (!manifest) return { candidates: [], note: '完整归档状态未就绪；先在「归档」页补齐依赖，才能从已归档的照片/图纸里选封面。' };
  const dependencyIds = [...new Set(manifest.dependencies.map(dep => dep.assetId))];
  if (dependencyIds.length === 0) return { candidates: [], note: '这个项目还没有已归档的依赖；先把要当封面的照片/图纸归档，再回来选。' };
  const listArchiveAssets = (controller as Partial<BackendSession> | null)?.listArchiveAssets;
  if (typeof listArchiveAssets !== 'function') return { candidates: [], note: '这套后端没有归档清单接口，暂不能按名字选封面。' };
  let assets: CloudArchiveAsset[];
  try {
    assets = await listArchiveAssets.call(controller, studioId ?? undefined);
  } catch (error) {
    return { candidates: [], note: `归档资产清单没有读到：${error instanceof Error ? error.message : '请求失败'}` };
  }
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const candidates: CoverCandidate[] = [];
  for (const assetId of dependencyIds) {
    const asset = byId.get(assetId);
    const kindLabel = asset ? COVER_KIND_LABELS[asset.kind] : null;
    if (!asset || !kindLabel) continue;
    candidates.push({ assetId, label: `${asset.name}（${kindLabel}）` });
  }
  if (candidates.length === 0) return { candidates: [], note: '已归档依赖里还没有照片或图纸；先把要当封面的照片/图纸归档，再回来选。' };
  return { candidates, note: '' };
}

export function CaseAdminSection({ session, controller, layoutId, layoutName }: {
  session: CloudCaseSessionContract | null;
  /** 后端会话：动作时现读快照拿项目 id 与已保存版本（CAS 的 expectedRevision）。 */
  controller: BackendSession | null;
  /** 当前活动 id；快照还没绑定项目时作为稳定 ID 推导与关联判断的回退。 */
  layoutId?: string | null;
  layoutName: string;
}): JSX.Element {
  const [caps, setCaps] = useState<{ loading: boolean; value: CloudCapabilities | null; error: CloudCaseOpError | null }>(
    { loading: !!session, value: null, error: null });
  const [capsRetry, setCapsRetry] = useState(0);
  const [drafts, setDrafts] = useState<{ loading: boolean; rows: CloudCaseDraft[]; error: string }>({ loading: false, rows: [], error: '' });
  const [draftsEpoch, setDraftsEpoch] = useState(0);
  const [stableId, setStableId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [provenance, setProvenance] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [coverAssetId, setCoverAssetId] = useState('');
  const [cover, setCover] = useState<{ candidates: CoverCandidate[]; note: string }>({ candidates: [], note: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<{ id: string; rows: CloudCaseVersion[]; loading: boolean; error: string }>(
    { id: '', rows: [], loading: false, error: '' });

  // 能力探测：session 变化或用户点重试时重新问服务端。
  useEffect(() => {
    if (!session) {
      setCaps({ loading: false, value: null, error: null });
      return undefined;
    }
    let live = true;
    setCaps(current => ({ loading: true, value: current.value, error: null }));
    void fetchCloudCapabilities(session).then(result => {
      if (!live) return;
      if (result.ok) setCaps({ loading: false, value: result.value, error: null });
      else setCaps({ loading: false, value: null, error: result.error });
    });
    return () => { live = false; };
  }, [session, capsRetry]);

  const admin = caps.value?.superAdmin === true;

  // 管理员才拉草稿；列表供「当前项目已关联案例」判断与行内操作。
  useEffect(() => {
    if (!session || !admin) return undefined;
    let live = true;
    setDrafts(current => ({ loading: true, rows: current.rows, error: '' }));
    void listCloudCaseDrafts(session).then(result => {
      if (!live) return;
      if (result.ok) setDrafts({ loading: false, rows: result.value, error: '' });
      else setDrafts({ loading: false, rows: [], error: result.error.message });
    });
    return () => { live = false; };
  }, [session, admin, draftsEpoch]);

  // 当前项目已关联的草稿 → 表单按它预填（维护既有案例）；否则按项目推导稳定 ID 起步。
  const projectNow = currentProjectRef(controller, layoutId);
  const linked = drafts.rows.find(row => row.projectId === projectNow.projectId) ?? null;
  const formDraft = linked ?? (stableId ? drafts.rows.find(row => row.id === stableId) ?? null : null);
  useEffect(() => {
    setStableId(linked?.id ?? suggestCloudCaseStableId(projectNow.projectId));
    setTitle(linked?.title ?? layoutName);
    setCategory(linked?.category ?? '');
    setDescription(linked?.description ?? '');
    setProvenance(linked?.provenance ?? '');
    setSortOrder(String(linked?.sortOrder ?? 0));
    setCoverAssetId(linked?.coverAssetId ?? '');
    // 只在关联对象/项目变化时重填，不跟用户输入打架；字段值随 linked.id 变化整体换。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked?.id, projectNow.projectId, layoutName]);

  // 封面候选（C09 补齐）：管理员 + 云项目就绪后，从发布闸门的清单里取已归档照片/图纸。
  // 清单就是服务端发布快照的数据源，所以这里选到的封面一定能通过服务端的 published 依赖校验。
  useEffect(() => {
    if (!session || !admin) return undefined;
    let live = true;
    void loadCoverCandidates(controller, caps.value?.officialStudioId ?? null).then(next => {
      if (!live) return;
      setCover(next);
    });
    return () => { live = false; };
  }, [session, admin, controller, draftsEpoch, projectNow.projectId, caps.value?.officialStudioId]);

  const run = (action: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    void action().finally(() => setBusy(false));
  };

  const refreshDrafts = async (): Promise<void> => { setDraftsEpoch(value => value + 1); };

  const saveDraft = (): void => run(async () => {
    if (!session) return;
    const { projectId, revision } = currentProjectRef(controller, layoutId);
    if (!projectId) { setNotice('这份方案还没挂到云项目上，保存后再试。'); return; }
    if (revision == null) { setNotice('还有改动没保存，保存后再试。'); return; }
    const id = stableId.trim();
    if (!id) { setNotice('请先填写稳定案例 ID。'); return; }
    if (!title.trim()) { setNotice('请先填写案例标题。'); return; }
    if (!provenance.trim()) { setNotice('请先填写来源/授权说明（案例的出处与授权口径）。'); return; }
    const sort = Number(sortOrder);
    // 案例草稿由服务端从完整清单整份复制，而发布快照只认 published 依赖：
    // 保存草稿前先把清单按 published 口径落库（幂等 CAS，不改 projects.revision）。
    // 私有完整归档（云面板静默保存）的 private 口径不受影响，只在这里按发布需要切换。
    if (!controller) { setNotice('这套后端没有接通完整归档，草稿没有保存。'); return; }
    const ensured = await ensurePublishedArchiveNow(controller);
    if (!ensured.ok) { setNotice(`完整归档没有就绪，草稿没有保存：${ensured.error}`); return; }
    const result = await upsertCloudCase(session, id, {
      expectedVersion: formDraft?.id === id ? formDraft.version : 0,
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      coverAssetId: formDraft?.id === id ? (coverAssetId.trim() || null) : null,
      sortOrder: Number.isFinite(sort) ? sort : 0,
      projectId,
      provenance: provenance.trim(),
    });
    if (!result.ok) { setNotice(`草稿没有保存：${result.error.message}`); return; }
    await refreshDrafts();
    setNotice(`案例「${result.value.title}」草稿已保存（第 ${result.value.version} 版草稿）。公众看到的版本没变。`);
  });

  const publish = (): void => run(async () => {
    if (!session || !formDraft) return;
    const { revision } = currentProjectRef(controller, layoutId);
    if (revision == null || !Number.isFinite(revision)) { setNotice('还有改动没保存，保存后再发布。'); return; }
    const result = await publishCloudCase(session, formDraft.id, {
      expectedVersion: formDraft.version,
      expectedRevision: revision,
    });
    if (!result.ok) {
      // 发布失败保留原入口：不清发布链接、不改公众版本，只把原因说清楚。
      setNotice(`发布没有成功，案例入口仍是上一个版本：${result.error.message}`);
      return;
    }
    await refreshDrafts();
    setNotice(`已发布公众版本 v${result.value.revision ?? ''}。案例入口现在指向这一版。`);
  });

  const unpublish = (draft: CloudCaseDraft): void => run(async () => {
    if (!session) return;
    const result = await unpublishCloudCase(session, draft.id, draft.version);
    if (!result.ok) { setNotice(`下架没有成功：${result.error.message}`); return; }
    await refreshDrafts();
    setNotice(`案例「${draft.title}」已下架：目录与稳定入口同时失效；已发出的固定交付不受影响。`);
  });

  const openHistory = (draft: CloudCaseDraft): void => {
    if (!session) return;
    if (history.id === draft.id) { setHistory({ id: '', rows: [], loading: false, error: '' }); return; }
    setHistory({ id: draft.id, rows: [], loading: true, error: '' });
    void listCloudCaseVersions(session, draft.id).then(result => {
      if (result.ok) setHistory({ id: draft.id, rows: result.value, loading: false, error: '' });
      else setHistory({ id: draft.id, rows: [], loading: false, error: result.error.message });
    });
  };

  const restore = (draft: CloudCaseDraft, publicationId: string): void => run(async () => {
    if (!session) return;
    const result = await restoreCloudCase(session, draft.id, { expectedVersion: draft.version, publicationId });
    if (!result.ok) { setNotice(`恢复没有成功：${result.error.message}`); return; }
    await refreshDrafts();
    setNotice(`已恢复历史版本，案例入口指向 v${result.value.revision ?? ''}。旧发布记录未被改写。`);
  });

  // 未接通：明确说明，不渲染管理表单。
  if (!session) {
    return <div className="sc-case-admin" data-testid="case-admin">
      <p className="sc-share-desc">云端案例管理在这套后端上还没有接通。</p>
      <p className="sc-share-desc">案例发布需要服务端的完整项目归档与不可变版本支持，接通后这里会出现草稿、发布、历史与下架。</p>
    </div>;
  }
  if (caps.loading) {
    return <div className="sc-case-admin" data-testid="case-admin" role="status">
      <p className="sc-share-desc"><Loader2 className="cr-spin" size={13} aria-hidden="true" /> 正在向服务端确认案例管理权限…</p>
    </div>;
  }
  if (caps.error) {
    return <div className="sc-case-admin" data-testid="case-admin">
      <p className="sc-share-desc" role="alert">案例管理权限没有确认：{caps.error.message}</p>
      {caps.error.hint && <p className="sc-share-desc" data-testid="case-admin-error-hint">{caps.error.hint}</p>}
      <button type="button" className="sc-share-renew" onClick={() => setCapsRetry(value => value + 1)}>重试</button>
    </div>;
  }
  if (!admin) {
    return <div className="sc-case-admin" data-testid="case-admin">
      <p className="sc-share-desc">案例管理仅平台管理员可用。当前账号不是平台管理员；角色以服务端判定为准。</p>
    </div>;
  }

  const revisionReady = projectNow.revision != null && Number.isFinite(projectNow.revision);
  const canSave = !!projectNow.projectId && revisionReady && !!stableId.trim() && !!title.trim();
  const canPublish = canSave && !!formDraft && formDraft.projectId === projectNow.projectId;

  return <div className="sc-case-admin" data-testid="case-admin">
    <p className="sc-share-desc">把当前项目维护成官方案例：保存草稿不影响公众，显式发布才切换案例入口。</p>
    {!projectNow.projectId && <p className="sc-share-desc" role="status">这份方案还没挂到云项目上；保存到云端项目后才能发布为案例。</p>}
    {!revisionReady && <p className="sc-share-desc" role="status">还有改动没保存；保存成功后才能发布。</p>}
    {drafts.error && <p className="sc-share-desc" role="alert">案例草稿列表没有读到：{drafts.error}</p>}
    <div className="sc-case-admin-form">
      <label className="sc-case-admin-field">
        <span>稳定案例 ID</span>
        <input value={stableId} aria-label="稳定案例 ID"
          onChange={event => setStableId(event.currentTarget.value)} placeholder="如 cn-yuquan-chrysanthemum"/>
      </label>
      <label className="sc-case-admin-field">
        <span>标题</span>
        <input value={title} aria-label="案例标题"
          onChange={event => setTitle(event.currentTarget.value)} placeholder={layoutName || '案例标题'}/>
      </label>
      <label className="sc-case-admin-field">
        <span>分类</span>
        <input value={category} aria-label="案例分类"
          onChange={event => setCategory(event.currentTarget.value)} placeholder="如 花卉展"/>
      </label>
      <label className="sc-case-admin-field">
        <span>封面（可选，取自已归档的照片/图纸）</span>
        <select value={coverAssetId} aria-label="案例封面" data-testid="case-cover"
          onChange={event => setCoverAssetId(event.currentTarget.value)}>
          <option value="">不设封面</option>
          {cover.candidates.map(candidate =>
            <option key={candidate.assetId} value={candidate.assetId}>{candidate.label}</option>)}
        </select>
      </label>
      {cover.candidates.length === 0 && cover.note && <p className="sc-share-desc" role="status" data-testid="case-cover-note">{cover.note}</p>}
      <label className="sc-case-admin-field">
        <span>说明</span>
        <textarea value={description} aria-label="案例说明"
          onChange={event => setDescription(event.currentTarget.value)} placeholder="给浏览者的一句话说明"/>
      </label>
      <label className="sc-case-admin-field">
        <span>来源/授权说明（必填）</span>
        <textarea value={provenance} aria-label="案例来源与授权说明"
          onChange={event => setProvenance(event.currentTarget.value)} placeholder="案例出处与素材授权口径；不会公开只有内部学习授权的参考素材"/>
      </label>
      <label className="sc-case-admin-field">
        <span>排序权重</span>
        <input value={sortOrder} aria-label="案例排序权重" inputMode="numeric"
          onChange={event => setSortOrder(event.currentTarget.value)}/>
      </label>
    </div>
    <div className="sc-case-admin-actions">
      <button type="button" className="sc-share-renew" data-testid="case-save-draft"
        disabled={busy || !projectNow.projectId || !revisionReady} onClick={saveDraft}>保存草稿</button>
      <button type="button" className="sc-share-cta" data-tone="green" data-testid="case-publish"
        disabled={busy || !canPublish} onClick={publish}
        title={formDraft ? `发布/更新「${formDraft.title}」为公众版本` : '先保存草稿，再发布公众版本'}>
        {busy ? '正在处理…' : formDraft ? '发布当前保存版本' : '发布（先保存草稿）'}
      </button>
    </div>
    {notice && <p className="sc-share-note" role="status" data-testid="case-admin-notice">{notice}</p>}
    {linked && <p className="sc-share-desc">当前项目关联案例「{linked.title}」（{linked.id}）：
      {linked.revision != null ? `公众版本 v${linked.revision}` : '尚未发布公众版本'}
      {linked.publishedAt ? ` · 发布于 ${new Date(linked.publishedAt).toLocaleDateString('zh-CN')}` : ''}。</p>}
    {drafts.rows.length > 0 && <ul className="sc-case-admin-drafts" aria-label="案例草稿">
      {drafts.rows.map(draft => <li key={draft.id} className="sc-case-admin-draft" data-testid={`case-draft-${draft.id}`}>
        <div className="sc-case-admin-draft-line">
          <strong>{draft.title}</strong>
          <span>{draft.id} · {draft.revision != null ? `公众 v${draft.revision}` : draft.status === 'unpublished' ? '已下架' : '未发布'}</span>
        </div>
        <div className="sc-case-admin-draft-actions">
          {draft.projectId === projectNow.projectId &&
            <button type="button" className="sc-share-key" data-tone="paper" disabled={busy}
              aria-label={`发布更新 ${draft.title}`} onClick={() => { setStableId(draft.id); publish(); }}>发布更新</button>}
          <button type="button" className="sc-share-key" data-tone="paper" disabled={busy}
            aria-expanded={history.id === draft.id} aria-label={`查看历史版本 ${draft.title}`}
            onClick={() => openHistory(draft)}>历史</button>
          {draft.revision != null &&
            <button type="button" className="sc-share-key" data-tone="paper" disabled={busy}
              aria-label={`下架 ${draft.title}`} onClick={() => unpublish(draft)}>下架</button>}
        </div>
        {history.id === draft.id && <div className="sc-case-admin-history" role="status">
          {history.loading && <p className="sc-share-desc"><Loader2 className="cr-spin" size={12} aria-hidden="true"/> 正在读取历史版本…</p>}
          {!history.loading && history.error && <p className="sc-share-desc" role="alert">{history.error}</p>}
          {!history.loading && !history.error && history.rows.length === 0 && <p className="sc-share-desc">这个案例还没有发布历史。</p>}
          {!history.loading && history.rows.map(version => <div key={version.publicationId} className="sc-case-admin-version">
            <span>v{version.revision}{version.createdAt ? ` · ${new Date(version.createdAt).toLocaleString('zh-CN')}` : ''}</span>
            <button type="button" className="sc-share-key" data-tone="paper" disabled={busy}
              aria-label={`恢复案例 ${draft.title} 到 v${version.revision}`}
              onClick={() => restore(draft, version.publicationId)}>恢复此版本</button>
          </div>)}
        </div>}
      </li>)}
    </ul>}
  </div>;
}
