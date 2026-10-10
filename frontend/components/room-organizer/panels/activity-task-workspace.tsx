'use client';

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityTaskReadbackError, beginActivityTaskRequest, closeActivityTaskAcceptance, finishActivityTaskRequest,
  readActivityTaskRequest, stageActivityTaskAcceptance, storeActivityTaskRun,
  type ActivityTaskRequestIdentity, type ActivityTaskRequestMarker,
} from '@/lib/activity-task-proposal-storage';
import { acceptActivityTaskSuggestions, buildActivityTaskContext, type ActivityTaskContext, type ActivityTaskSelection } from '@/lib/activity-task-suggestions';
import { SceneApiError, useBackendSession, type BackendSession } from '@/lib/backend-session';
import { geometryProjectId, isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { materialCheckinStorageKey, readMaterialCheckins } from '@/lib/material-checkin-storage';
import { flushSourceScope, registerSourceFlush, subscribeSourceRecordChanges } from '@/lib/source-storage';
import { activityTaskContextSchema, type ActivityTaskRun } from '../../../../supabase/functions/_shared/activity-task-contract';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { layoutStore } from '../hooks/use-layout-store';
import { STORAGE_KEY } from '../lib/constants';
import { parseStoredLayout } from '../lib/schema';
import { ActivityTaskSuggestionView } from './activity-task-suggestion-view';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { MaterialCheckinState } from '../hooks/use-material-checkins';
import type { CreativeBrief } from '../lib/creative-brief';
import type { RoomLayout } from '../lib/types';

export interface ActivityTaskPanelContext {
  layout: RoomLayout;
  disabled: boolean;
  checkins?: MaterialCheckinState | undefined;
  briefState?: { brief: CreativeBrief; ready: boolean; error: string | null; hasSavedBrief: boolean } | null | undefined;
}
interface Props extends ActivityTaskPanelContext {
  controller: BackendSession;
  isActive: boolean;
  ensurePersistentIdentity(): void;
  persistVerifiedLayout(expected: RoomLayout, next: RoomLayout, guard: () => void): Promise<RoomLayout>;
  onCommitOperations(operations: EventOperations): void;
}
const emptySelection = (): ActivityTaskSelection => ({ briefText: '', taskIds: [], objectIds: [] });
function readableError(cause: unknown): string {
  if (cause instanceof SceneApiError && ['UNAUTHENTICATED', 'SESSION_CHANGED', 'LEASE_LOST', 'REVISION_CONFLICT'].includes(cause.code)) {
    return '登录或活动连接已变化，请回到原账号和活动核对原请求。';
  }
  if (cause instanceof SyntaxError || cause instanceof SceneApiError) return '本次响应尚未确认，原请求已保留。请查询原结果，已有建议不会重新准备。';
  if (cause instanceof Error && cause.name === 'ZodError') return '资料格式未通过核对，请检查选定内容。原请求未重新发送。';
  if (cause instanceof Error && /[\u3400-\u9fff]/.test(cause.message)) return cause.message;
  return '本次操作未确认，输入已保留。请核对原记录后继续。';
}

/** One current request, a reviewed disclosure and the original local task list; no generation or save queue. */
export function ActivityTaskWorkspace(props: Props): JSX.Element {
  const cloud = useBackendSession(props.controller), latest = useRef(props); latest.current = props;
  const [, refresh] = useReducer(value => value + 1, 0);
  const [selection, setSelection] = useState<ActivityTaskSelection>(emptySelection);
  const [instruction, setInstruction] = useState('');
  const [context, setContext] = useState<ActivityTaskContext | null>(null);
  const [marker, setMarker] = useState<ActivityTaskRequestMarker | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [storageUnconfirmed, setStorageUnconfirmed] = useState(false);
  const inputs = useRef({ selection, instruction, marker }); inputs.current = { selection, instruction, marker };
  const mounted = useRef(false), action = useRef(0), working = useRef(false), skipOwnFlush = useRef(false);
  const invalidateActiveJob = useCallback(() => { ++action.current; }, []);
  const sourceEpoch = useRef(0), inputEpoch = useRef(0), previousLayout = useRef(layoutStore.getState().layout);
  const sourceStamp = useRef<{ requestId: string; epoch: number; scope: number } | null>(null);
  const replacement = useRef<string | undefined>(undefined);
  const previewStamp = useRef<{ source: number; input: number; scope: number } | null>(null);
  const sampleIdentity = () => {
    const own = latest.current, state = own.controller.getSnapshot(), current = layoutStore.getState().layout;
    const remote = geometryProjectId(own.controller, current.id);
    return { controller: own.controller, apiUrl: own.controller.config.apiUrl, userId: state.user?.id ?? null,
      activityId: current.id ?? null, remote, active: own.isActive, local: isLocalActivityWorkspace(own.controller),
      generation: state.lease?.generation ?? null, sessionId: state.lease?.sessionId ?? null, revision: state.revision };
  };
  const scope = useRef({ value: sampleIdentity(), epoch: 0, identityEpoch: 0 });
  const sample = () => {
    const value = sampleIdentity(), before = scope.current.value;
    const { controller: owner, ...fields } = value, { controller: previous, ...beforeFields } = before;
    if (owner !== previous || canonical(fields) !== canonical(beforeFields)) {
      const changedIdentity = owner !== previous || value.apiUrl !== before.apiUrl || value.userId !== before.userId ||
        value.activityId !== before.activityId || value.remote !== before.remote || value.active !== before.active || value.local !== before.local;
      scope.current = { value, epoch: scope.current.epoch + 1, identityEpoch: scope.current.identityEpoch + (changedIdentity ? 1 : 0) };
    }
    return scope.current;
  };
  const sampleRef = useRef(sample); sampleRef.current = sample;
  const ownScope = sample();
  const identity: ActivityTaskRequestIdentity | null = ownScope.value.userId && ownScope.value.activityId && ownScope.value.remote && ownScope.value.local
    ? { apiUrl: ownScope.value.apiUrl, userId: ownScope.value.userId, activityId: ownScope.value.activityId, remoteProjectId: ownScope.value.remote } : null;
  const identityKey = identity ? canonical(identity) : '';
  const editingKey = canonical({ apiUrl: ownScope.value.apiUrl, userId: ownScope.value.userId, activityId: ownScope.value.activityId });
  const observedSourceEpoch = sourceEpoch.current;

  useLayoutEffect(() => {
    ++inputEpoch.current; setSelection(emptySelection()); setInstruction(''); setContext(null); setApproved(false);
    previewStamp.current = null; replacement.current = undefined;
  }, [editingKey, props.controller]);

  useLayoutEffect(() => {
    mounted.current = true;
    const observe = () => {
      const previous = scope.current.epoch;
      const current = layoutStore.getState().layout;
      if (current !== previousLayout.current) { previousLayout.current = current; ++sourceEpoch.current; }
      if (sampleRef.current().epoch !== previous || current !== latest.current.layout) refresh();
    };
    const offLayout = layoutStore.subscribe(observe), offSession = props.controller.subscribe(observe);
    return () => { mounted.current = false; offLayout(); offSession(); invalidateActiveJob(); };
  }, [props.controller, invalidateActiveJob]);
  useEffect(() => props.layout.id ? subscribeSourceRecordChanges(materialCheckinStorageKey(props.layout.id), () => {
    ++sourceEpoch.current; refresh();
  }) : undefined, [props.layout.id]);

  function ticket(withSource = true, job?: number) {
    const captured = sampleRef.current().epoch, source = sourceEpoch.current, input = inputEpoch.current;
    const layout = layoutStore.getState().layout, ledger = latest.current.checkins?.ledger;
    return () => {
      const current = sampleRef.current();
      if (!mounted.current || !current.value.active || !current.value.local || current.epoch !== captured || job !== undefined && action.current !== job) {
        throw new Error('活动、账号或场景连接已变化，本次结果未写入。');
      }
      if (withSource && latest.current.disabled) throw new Error('当前活动正在处理其他操作，请稍后核对原请求。');
      if (withSource && (sourceEpoch.current !== source || inputEpoch.current !== input || layoutStore.getState().layout !== layout || latest.current.checkins?.ledger !== ledger)) {
        throw new Error('活动资料已变化，请保留原请求并重新核对。');
      }
    };
  }
  async function currentInput(chosen: ActivityTaskSelection, guard: () => void) {
    guard();
    const layout = layoutStore.getState().layout;
    if (latest.current.checkins && (!latest.current.checkins.ready || latest.current.checkins.error)) throw new Error('点验资料尚未完整读取，请先核对后准备建议。');
    const checkins = layout.id ? await readMaterialCheckins(layout.id) : undefined; guard();
    if (latest.current.checkins && canonical(checkins) !== canonical(latest.current.checkins.ledger)) throw new Error('点验资料已有变化，请重新读取后准备建议。');
    return { layout, selection: chosen, ...(checkins === undefined ? {} : { checkins }), dataKind: layout.eventOperations?.dataKind ?? 'unspecified' as const };
  }
  async function captureContext(chosen: ActivityTaskSelection, guard: () => void) {
    const raw = await buildActivityTaskContext(await currentInput(chosen, guard)); guard();
    return { source: raw.source, summary: activityTaskContextSchema.parse(raw.summary) };
  }
  async function flush(guard: () => void) {
    const id = layoutStore.getState().layout.id;
    if (!id) throw new Error('请先保存本机活动编号。');
    skipOwnFlush.current = true;
    try { await flushSourceScope(id); guard(); } finally { skipOwnFlush.current = false; }
  }
  useEffect(() => registerSourceFlush(props.layout.id ?? '', async () => {
    if (!skipOwnFlush.current && (working.current || inputs.current.marker?.state === 'saving' || storageUnconfirmed)) {
      throw new Error('任务建议尚在处理或待核保存，请先查询、取消或核对原保存结果。');
    }
  }), [props.layout.id, storageUnconfirmed]);
  useEffect(() => {
    setReady(false); setMarker(null); setContext(null); setApproved(false); setSelected([]); setStorageUnconfirmed(false); setError(null);
    sourceStamp.current = null; previewStamp.current = null;
    if (!identity) { setReady(true); return; }
    const guard = ticket(false); let active = true;
    void readActivityTaskRequest(identity, guard).then(value => {
      guard(); if (!active) return;
      setMarker(value ?? null);
      if (value) {
        setSelection(value.selection); setInstruction(value.instruction); setContext(value.context);
        setSelected(value.pending?.receipt.acceptedTaskIds ?? []);
        sourceStamp.current = { requestId: value.requestId, epoch: sourceEpoch.current, scope: sampleRef.current().identityEpoch };
      }
      setReady(true);
    }).catch(cause => { if (active) { setError(readableError(cause)); setReady(true); setStorageUnconfirmed(true); } });
    return () => { active = false; };
    // A lease renewal does not replace the stored identity or the user's disclosure draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, props.controller]);
  useEffect(() => {
    if (!marker && previewStamp.current && (previewStamp.current.source !== sourceEpoch.current || previewStamp.current.scope !== ownScope.epoch)) {
      previewStamp.current = null; setContext(null); setApproved(false);
    }
  }, [marker, ownScope.epoch, observedSourceEpoch]);
  useEffect(() => {
    if (!marker || marker.state === 'closed') { setStale(false); return; }
    setStale(true);
    if (sourceStamp.current?.requestId === marker.requestId && (sourceStamp.current.epoch !== sourceEpoch.current || sourceStamp.current.scope !== ownScope.identityEpoch)) return;
    const guard = ticket(); let active = true;
    void captureContext(marker.selection, guard).then(value => { guard(); if (active) setStale(value.source.fingerprint !== marker.context.source.fingerprint); }).catch(() => {});
    return () => { active = false; };
    // Native source subscriptions and immutable layout props drive revalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker, props.layout, props.checkins?.ledger, props.checkins?.ready, ownScope.epoch, observedSourceEpoch]);

  async function perform(work: (guard: () => void, job: number) => Promise<void>, allowCancel = false) {
    if (working.current && !allowCancel) return;
    const job = ++action.current; working.current = true; setBusy(true); setError(null); setNotice(null);
    const guard = ticket(true, job);
    try { await work(guard, job); }
    catch (cause) { if (mounted.current && action.current === job) {
      setError(readableError(cause));
      if (cause instanceof ActivityTaskReadbackError) setStorageUnconfirmed(true);
    } }
    finally { if (action.current === job) { working.current = false; if (mounted.current) setBusy(false); } }
  }
  function availabilityNow(): string | null {
    const own = latest.current, state = own.controller.getSnapshot(), id = layoutStore.getState().layout.id;
    const remote = geometryProjectId(own.controller, id);
    if (!own.isActive || own.disabled || !isLocalActivityWorkspace(own.controller)) return '当前活动暂不能处理任务建议。';
    if (!state.user) return '先登录，再在图纸或物料区明确准备当前活动的场景连接。';
    if (!remote) return '先在图纸或物料区明确准备当前活动的场景连接。';
    const expires = Date.parse(state.lease?.expiresAt ?? '');
    if (state.writeBlocked || !state.lease || state.lease.projectId !== remote || !Number.isFinite(expires) || expires <= Date.now()) return '当前场景没有有效编辑权，请在账户中核对连接。';
    return null;
  }
  const availability = availabilityNow();
  useEffect(() => {
    const until = Date.parse(cloud.lease?.expiresAt ?? '');
    if (!Number.isFinite(until) || until <= Date.now()) return;
    const timer = window.setTimeout(refresh, Math.min(until - Date.now() + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [cloud.lease?.expiresAt]);

  async function adoptRun(value: ActivityTaskRun, current: ActivityTaskRequestMarker, guard: () => void) {
    const live = await captureContext(current.selection, guard); guard();
    if (live.source.fingerprint !== current.context.source.fingerprint || sourceStamp.current?.requestId === current.requestId &&
      (sourceStamp.current.epoch !== sourceEpoch.current || sourceStamp.current.scope !== sampleRef.current().identityEpoch)) {
      throw new Error('活动资料或连接已变化；原结果可继续查询，本页不会确认旧建议。');
    }
    const stored = await storeActivityTaskRun(current.identity, current.requestId, value, '任务建议 · 人工待核', guard); guard();
    setMarker(stored); setContext(stored.context); setStorageUnconfirmed(false);
    sourceStamp.current = { requestId: stored.requestId, epoch: sourceEpoch.current, scope: sampleRef.current().identityEpoch };
    setNotice(stored.state === 'prepared' ? '建议已保留，勾选后保存为待办任务。' : '原请求状态已读取，尚未保存活动任务。');
  }
  async function verifyAndClose(current: ActivityTaskRequestMarker, guard: () => void, job: number, mayWrite: boolean) {
    if (!current.pending) throw new Error('没有待核的原保存结果。');
    await flush(guard); guard();
    const expected = layoutStore.getState().layout;
    const added = new Set(current.pending.receipt.acceptedTaskIds.map(id => id.toLowerCase()));
    const before = { ...current.pending.operations, tasks: current.pending.operations.tasks.filter(task => !added.has(task.id.toLowerCase())) };
    const matchesBefore = expected.eventOperations === undefined
      ? before.tasks.length === 0 && before.dataKind === current.context.source.dataKind
      : canonical(expected.eventOperations) === canonical(before);
    if (!matchesBefore && canonical(expected.eventOperations) !== canonical(current.pending.operations)) {
      throw new Error('原任务已有新变化，未覆盖当前任务。请保留原保存记录并人工核对。');
    }
    let next = { ...expected, eventOperations: current.pending.operations };
    if (!mayWrite) {
      const raw = window.localStorage.getItem(STORAGE_KEY), stored = raw ? parseStoredLayout(JSON.parse(raw)) : null; guard();
      if (!stored || stored.id !== current.identity.activityId || canonical(stored.eventOperations) !== canonical(current.pending.operations)) {
        throw new Error('原任务尚未完整读回确认。未重复写入；处理保存问题后可明确重试原保存。');
      }
      next = { ...stored, eventOperations: current.pending.operations };
    } else if (matchesBefore) {
      const live = await captureContext(current.selection, guard); guard();
      if (live.source.fingerprint !== current.context.source.fingerprint) throw new Error('原建议的活动资料已变化，未重写旧任务。');
    }
    const saved = await latest.current.persistVerifiedLayout(expected, next, guard); guard();
    if (!saved.eventOperations || saved.id !== current.identity.activityId) throw new Error('原任务保存仍未确认。');
    if (canonical(expected.eventOperations) !== canonical(saved.eventOperations)) latest.current.onCommitOperations(saved.eventOperations);
    const afterCommit = ticket(true, job); afterCommit();
    const closed = await closeActivityTaskAcceptance(current.identity, current.requestId, { activityId: saved.id, operations: saved.eventOperations }, afterCommit);
    afterCommit(); setMarker(closed); setStorageUnconfirmed(false); setStale(false); setNotice('勾选任务已保存并读回核对，可在原任务表继续补负责人和时间。');
  }
  return <ActivityTaskSuggestionView layout={props.layout} selection={selection} instruction={instruction}
    {...(props.briefState?.ready && props.briefState.hasSavedBrief && !props.briefState.error ? { availableBriefText: props.briefState.brief.description } : {})}
    onSelection={value => { ++inputEpoch.current; setSelection(value); setContext(null); setApproved(false); }}
    onInstruction={value => { ++inputEpoch.current; setInstruction(value); setContext(null); setApproved(false); }}
    context={context} proposal={marker?.proposal ?? null} selectedSuggestionIds={selected} onSelectedSuggestionIds={setSelected}
    approvedDisclosure={approved} onApprovedDisclosure={setApproved} busy={busy || !ready} availabilityReason={availability}
    stale={stale || !!marker && marker.state !== 'closed' && (canonical(selection) !== canonical(marker.selection) || instruction !== marker.instruction)}
    phase={marker?.state ?? (storageUnconfirmed ? 'requested' : 'selection')} error={error} notice={notice}
    onPreview={() => void perform(async guard => { latest.current.ensurePersistentIdentity(); await flush(guard);
      const value = await captureContext(inputs.current.selection, guard); guard(); setContext(value); setApproved(false);
      previewStamp.current = { source: sourceEpoch.current, input: inputEpoch.current, scope: sampleRef.current().epoch };
    })}
    onSend={() => void perform(async guard => {
      const unavailable = availabilityNow();
      if (unavailable || !identity || !context || !approved) throw new Error(unavailable || '请先查看并确认待发送内容。');
      if (!previewStamp.current || previewStamp.current.source !== sourceEpoch.current || previewStamp.current.input !== inputEpoch.current || previewStamp.current.scope !== sampleRef.current().epoch) throw new Error('待发送内容已变化，请重新查看摘要。');
      await flush(guard); const live = await captureContext(selection, guard); guard();
      if (canonical(live) !== canonical(context)) throw new Error('待发送摘要已变化，请重新核对。');
      const stored = await beginActivityTaskRequest({ identity, requestId: crypto.randomUUID(), instruction, selection, context: live }, guard,
        replacement.current ? { replaceRequestId: replacement.current } : undefined); guard(); replacement.current = undefined;
      setMarker(stored); sourceStamp.current = { requestId: stored.requestId, epoch: sourceEpoch.current, scope: sampleRef.current().identityEpoch };
      setApproved(false); setNotice('原请求编号已保留；响应未知时只查询此请求。');
      const value = await props.controller.startActivityTaskRun({ requestId: stored.requestId, instruction: stored.instruction, activityContext: activityTaskContextSchema.parse(stored.context.summary) });
      guard(); await adoptRun(value, stored, guard);
    })}
    onRecover={() => void perform(async guard => {
      if (!identity) throw new Error('请回到原账号和活动的场景连接，再查询原请求。');
      const current = await readActivityTaskRequest(identity, guard); guard();
      if (!current) throw new Error('没有已登记的原请求，尚未发送新请求。');
      setMarker(current); setStorageUnconfirmed(false);
      if (current.state === 'closed' || current.state === 'saving' || current.state === 'cancelled') return;
      const value = await props.controller.getActivityTaskRunByRequest(current.requestId); guard(); await adoptRun(value, current, guard);
    })}
    onCancel={() => void perform(async guard => {
      if (!identity) throw new Error('请回到原账号和活动再取消。');
      const current = await readActivityTaskRequest(identity, guard); guard();
      if (!current || current.state === 'closed' || current.state === 'saving') throw new Error('本批已保存或待核保存，不能用取消回滚。');
      const cancelled = await finishActivityTaskRequest(identity, current.requestId, 'cancelled', guard); guard(); setMarker(cancelled);
      setStorageUnconfirmed(false); setNotice('本页已取消接纳此批建议，原请求编号保留。');
      try { const value = current.run ?? await props.controller.getActivityTaskRunByRequest(current.requestId); guard(); await props.controller.cancelActivityTaskRun(value.id); guard(); }
      catch (cause) { guard(); setNotice('本页已取消接纳；后台取消尚未核对，未重新发送请求。'); }
    }, true)}
    onAccept={() => void perform(async (guard, job) => {
      const unavailable = availabilityNow();
      if (unavailable || !marker?.proposal || stale || !selected.length || sourceStamp.current?.epoch !== sourceEpoch.current || sourceStamp.current.scope !== sampleRef.current().identityEpoch) {
        throw new Error(unavailable || '请勾选仍有效的任务建议，资料和连接变化后须重新核对。');
      }
      const authorized = () => { guard(); const problem = availabilityNow(); if (problem) throw new Error(problem); };
      await flush(authorized);
      if (!marker.run) throw new Error('没有原运行记录，请先查询原请求。');
      const original = await props.controller.getActivityTaskRun(marker.run.id); authorized();
      if (original.state !== 'complete' || original.id.toLowerCase() !== marker.run.id.toLowerCase() || original.projectId.toLowerCase() !== marker.identity.remoteProjectId.toLowerCase() ||
        original.requestId.toLowerCase() !== marker.requestId.toLowerCase() || original.activityId !== marker.identity.activityId || original.contextHash !== marker.contextHash ||
        canonical(original.activityResult) !== canonical(marker.run.activityResult)) {
        throw new Error('原请求已取消或结果已变化，原建议保留，尚未保存任务。');
      }
      const accepted = await acceptActivityTaskSuggestions(await currentInput(marker.selection, authorized), marker.proposal, selected, marker.receipt ?? undefined); authorized();
      if (accepted.status === 'closed') return;
      const pending = await stageActivityTaskAcceptance(marker.identity, marker.requestId, accepted, authorized); authorized(); setMarker(pending);
      await verifyAndClose(pending, authorized, job, true);
    })}
    onVerifySave={() => void perform(async (guard, job) => {
      if (!identity) throw new Error('请回到原账号和活动再核对。');
      const current = await readActivityTaskRequest(identity, guard); guard(); if (!current) throw new Error('没有原保存记录。');
      setMarker(current); if (current.state === 'closed') { setStorageUnconfirmed(false); return; }
      await verifyAndClose(current, guard, job, false);
    })}
    onRetrySave={() => void perform(async (guard, job) => {
      if (!identity) throw new Error('请回到原账号和活动再重试原保存。');
      const current = await readActivityTaskRequest(identity, guard); guard(); if (!current) throw new Error('没有原保存记录。');
      setMarker(current); if (current.state === 'closed') { setStorageUnconfirmed(false); return; }
      await verifyAndClose(current, guard, job, true);
    })}
    onNewRequest={() => { if (working.current || marker?.state === 'saving' || marker?.state === 'requested') return;
      replacement.current = marker?.requestId;
      ++inputEpoch.current; setMarker(null); setContext(null); setSelection(emptySelection()); setInstruction(''); setSelected([]); setApproved(false); setError(null); setNotice(null);
      previewStamp.current = null;
    }}/>
}
