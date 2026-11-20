'use client';

import { useEffect, useState } from 'react';
import { Crown, Loader2 } from '@/components/solid-icons';
import {
  cloudCaseOutdoorPlan,
  listCloudCases,
  readCloudCase,
  type CloudCasePublic,
  type CloudCaseRead,
  type CloudCaseSessionContract,
} from '../lib/cloud-cases';
import { CaseThumb } from './case-thumb';

/**
 * 云端案例目录（任务 C，2026-11-20）——空间面板「国内案例」段下的云端部分。
 *
 * 口径：
 *  - 数据只来自后端公开目录（GET /cloud/cases，经 backendSession 能力探测）；
 *    方法未接通/请求失败时如实显示「不可用/失败」，不用本机数据冒充云端目录。
 *  - 静态国内案例继续由既有授权内容承担，不因云端目录存在而下线（过渡期双轨）。
 *  - 卡片两件事：「查看」= 只读 2D 预览（公开 manifest 画的缩略，不进画布、不改任何状态）；
 *    「使用此案例」= 另存独立个人副本，走 onUseCase 由宿主面板接住（与经典案例同一条切换链）。
 */

export type CloudCatalogState =
  | { phase: 'unavailable'; message: string }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'empty' }
  | { phase: 'ready'; cases: CloudCasePublic[] };

/** 目录首次加载与重试共用；结果收敛成明确状态，不静默吞错。 */
export async function loadCloudCatalog(
  session: CloudCaseSessionContract | null,
): Promise<CloudCatalogState> {
  if (!session) return { phase: 'unavailable', message: '云端案例目录需要服务端支持，当前这套后端还没有接通。' };
  const result = await listCloudCases(session);
  if (!result.ok) {
    if (result.error.code === 'unavailable') return { phase: 'unavailable', message: result.error.message };
    return { phase: 'error', message: result.error.message };
  }
  if (result.value.length === 0) return { phase: 'empty' };
  return { phase: 'ready', cases: result.value };
}

/**
 * 目录主体。session 为 null（工作台还没传 controller）时显示不可用说明，
 * 不再静默隐藏——「看不见」和「确实没有」必须分得开。
 */
export function CloudCaseCatalog({ session, onUseCase, useLabel = '使用此案例' }: {
  session: CloudCaseSessionContract | null;
  /** 另存独立副本。宿主负责 ensureCloudCaseCopyRecord + 换项目；目录组件不直接动画布。 */
  onUseCase(stableId: string): void;
  /** 卡片动作文案；宿主可按语境改（如「另存并打开」）。 */
  useLabel?: string;
}): JSX.Element {
  const [state, setState] = useState<CloudCatalogState>(
    session ? { phase: 'loading' } : { phase: 'unavailable', message: '云端案例目录需要服务端支持，当前这套后端还没有接通。' },
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(session != null);
  // 目录很小，挂载时拉一次；重试按钮换 key 重取，session 从无到有（接线完成）也重取。
  useEffect(() => {
    if (!session) {
      setState({ phase: 'unavailable', message: '云端案例目录需要服务端支持，当前这套后端还没有接通。' });
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    void loadCloudCatalog(session).then(next => {
      if (!live) return;
      setState(next);
      setLoading(false);
    });
    return () => { live = false; };
  }, [session, reloadKey]);

  const [viewing, setViewing] = useState<{ id: string; loading: boolean; payload: CloudCaseRead | null; message: string } | null>(null);

  const toggleView = (item: CloudCasePublic): void => {
    if (viewing?.id === item.id) { setViewing(null); return; }
    setViewing({ id: item.id, loading: true, payload: null, message: '' });
    void readCloudCase(session, item.id).then(result => {
      if (!result.ok) {
        setViewing({ id: item.id, loading: false, payload: null, message: result.error.message });
        return;
      }
      setViewing({ id: item.id, loading: false, payload: result.value, message: '' });
    });
  };

  return <div className="sc-cloud-cases" data-testid="cloud-case-catalog">
    <p className="sc-cloud-cases-head" aria-label="云端案例目录">
      <Crown size={13} aria-hidden="true" />
      <span>云端案例目录</span>
      {loading && <Loader2 className="cr-spin" size={12} aria-hidden="true" />}
      {!loading && state.phase === 'error' &&
        <button type="button" className="sc-button" onClick={() => setReloadKey(value => value + 1)}>重试</button>}
    </p>
    {state.phase === 'unavailable' && <p className="sc-note" role="status" data-testid="cloud-cases-unavailable">{state.message}</p>}
    {state.phase === 'error' && <p className="sc-note" role="alert" data-testid="cloud-cases-error">{state.message}</p>}
    {state.phase === 'empty' && <p className="sc-note" role="status" data-testid="cloud-cases-empty">云端还没有已发布的案例。</p>}
    {state.phase === 'ready' && <ul className="sc-space-samples sc-space-cases sc-cloud-case-list" aria-label="云端已发布案例">
      {state.cases.map(item => <li key={item.id}>
        <button type="button" className="sc-space-sample" aria-expanded={viewing?.id === item.id}
          title={`${item.title} · 查看只读预览`}
          aria-label={`查看云端案例 ${item.title}`}
          onClick={() => toggleView(item)}>
          <span className="sc-cloud-case-shot" aria-hidden="true">
            {viewing?.id === item.id && viewing.payload
              ? <CaseThumb plan={cloudCaseThumbPlan(viewing.payload)} />
              : <CaseThumb className="sc-case-thumb is-empty" plan={EMPTY_PLAN} />}
          </span>
          <strong>{item.title}</strong>
          <span className="sc-cloud-case-meta">{metaLine(item)}</span>
        </button>
        <div className="sc-scan-card-actions">
          <button type="button" className="sc-button" data-testid={`cloud-case-use-${item.id}`}
            aria-label={`${useLabel} ${item.title}`} onClick={() => onUseCase(item.id)}>{useLabel}</button>
        </div>
        {viewing?.id === item.id && <div className="sc-cloud-case-view" role="status">
          {viewing.loading && <p className="sc-note"><Loader2 className="cr-spin" size={12} aria-hidden="true" /> 正在读取案例内容…</p>}
          {!viewing.loading && viewing.message && <p className="sc-note" role="alert">{viewing.message}</p>}
          {!viewing.loading && viewing.payload && <CloudCasePreview payload={viewing.payload} />}
        </div>}
      </li>)}
    </ul>}
  </div>;
}

/** 只读预览：manifest 里的户外规划画成 2D 缩略；没有有效户外数据时如实说明。 */
function CloudCasePreview({ payload }: { payload: CloudCaseRead }): JSX.Element {
  const plan = cloudCaseOutdoorPlan(payload);
  const publishedAt = payload.case.publishedAt ? `发布于 ${new Date(payload.case.publishedAt).toLocaleDateString('zh-CN')}` : '';
  return <div className="sc-cloud-case-preview">
    {plan.ok
      ? <>
          <CaseThumb plan={plan.plan} className="sc-case-thumb is-preview"/>
          <p className="sc-note">只读预览为 2D 示意（公众版本 v{payload.revision}{publishedAt ? ` · ${publishedAt}` : ''}）；要编辑请「使用此案例」另存独立副本，官方更新不会覆盖你的副本。</p>
        </>
      : <p className="sc-note" role="alert">{plan.message}</p>}
  </div>;
}

function cloudCaseThumbPlan(payload: CloudCaseRead) {
  const plan = cloudCaseOutdoorPlan(payload);
  // 卡片缩略只画有效规划；无效数据已经被 cloudCaseOutdoorPlan 拦下，这里兜一个空底。
  return plan.ok ? plan.plan : EMPTY_PLAN;
}

function metaLine(item: CloudCasePublic): string {
  const parts = [item.category, `公众版本 v${item.revision}`];
  if (item.publishedAt) parts.push(new Date(item.publishedAt).toLocaleDateString('zh-CN'));
  return parts.filter(Boolean).join(' · ');
}

/** 目录卡未取详情时的占位底（空规划缩成一块安静底色，不发请求、不假充内容）。 */
const EMPTY_PLAN = {
  schemaVersion: 1 as const,
  boundary: [],
  zones: [],
  facilities: [],
  routes: [],
  nodes: [],
  workers: [],
};
