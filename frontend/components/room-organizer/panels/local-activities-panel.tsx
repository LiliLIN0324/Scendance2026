'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { archiveLocalActivity, createLocalActivityBackup, listLocalActivities, readLocalActivity,
  type LocalActivityList, type NewLocalActivityMode } from '@/lib/local-activities';
import { parseLocalProjectBackupJson } from '@/lib/local-project-backup';
import { MAX_NAME_LENGTH } from '../lib/schema';
import type { LocalProjectBackupActions } from './creative-studio';
import type { RoomLayout } from '../lib/types';
import './local-activities-panel.css';

export interface LocalActivitiesPanelProps {
  layout: RoomLayout;
  actions: LocalProjectBackupActions;
  disabled?: boolean;
  onComplete?: (() => void) | undefined;
}
type Working = 'prepare' | 'archive' | 'read' | 'restore';
interface Token { id: number; epoch: number; scope: string; permissionEpoch: number }

export function LocalActivitiesPanel({ layout, actions, disabled = false, onComplete }: LocalActivitiesPanelProps): JSX.Element {
  const [name, setName] = useState(''), [mode, setMode] = useState<NewLocalActivityMode>('empty');
  const [activities, setActivities] = useState<LocalActivityList>({ activities: [], unreadableProjectIds: [] });
  const [listLoading, setListLoading] = useState(false), [listError, setListError] = useState('');
  const [working, setWorking] = useState<Working | null>(null), [error, setError] = useState('');
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const mounted = useRef(true), listRequest = useRef(0), pending = useRef(false);
  const operation = useRef({ id: 0, stage: null as Working | null, scope: '', target: '' });
  const baseline = useRef({ layout, scope: layout.id ?? '', disabled, epoch: 0, permissionEpoch: 0 });
  if (baseline.current.layout !== layout || baseline.current.scope !== (layout.id ?? '') || baseline.current.disabled !== disabled) {
    baseline.current = { layout, scope: layout.id ?? '', disabled, epoch: baseline.current.epoch + 1,
      permissionEpoch: baseline.current.permissionEpoch + (baseline.current.disabled !== disabled ? 1 : 0) };
  }
  const epoch = baseline.current.epoch;
  const refresh = useCallback(async (): Promise<void> => {
    const request = ++listRequest.current;
    setListLoading(true); setListError('');
    try {
      const next = await listLocalActivities();
      if (mounted.current && request === listRequest.current) setActivities(next);
    } catch (caught) {
      if (mounted.current && request === listRequest.current) setListError(caught instanceof Error ? caught.message : '活动列表未能读取，请重试。原归档已保留。');
    } finally {
      if (mounted.current && request === listRequest.current) setListLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);
  useEffect(() => {
    if (operation.current.stage === 'restore') return;
    const interrupted = operation.current.stage !== null;
    const sameScope = operation.current.scope === baseline.current.scope;
    operation.current = { id: operation.current.id + 1, stage: null, scope: '', target: '' };
    pending.current = false; setWorking(null);
    setError(interrupted && sameScope ? '当前场景已变化，操作已停止。请重新核对后再试，输入已保留。' : '');
    setNotice(current => current?.scope === baseline.current.scope ? current : null);
  }, [epoch]);

  const identityMissing = !layout.id?.trim();
  const busy = !!working || actions.backupPending;
  const locked = disabled || identityMissing || busy;
  function begin(): Token | null {
    if (disabled || identityMissing || actions.backupPending || pending.current) return null;
    const token = { id: operation.current.id + 1, epoch: baseline.current.epoch, scope: baseline.current.scope,
      permissionEpoch: baseline.current.permissionEpoch };
    operation.current = { id: token.id, stage: 'prepare', scope: token.scope, target: '' };
    pending.current = true; setWorking('prepare'); setError(''); setNotice(null);
    return token;
  }
  function active(token: Token): boolean {
    return mounted.current && operation.current.id === token.id;
  }
  function assertCurrent(token: Token): void {
    if (!active(token) || baseline.current.epoch !== token.epoch || baseline.current.disabled || baseline.current.scope !== token.scope) {
      throw new Error('当前活动或场景已变化，未继续切换。输入及原活动已保留，请重新核对。');
    }
  }
  function stage(token: Token, value: Working): void {
    assertCurrent(token); operation.current.stage = value; setWorking(value);
  }
  async function switchActivity(targetId?: string): Promise<void> {
    if (!targetId && !name.trim()) { if (!locked) setError('请填写新活动名称。'); return; }
    const token = begin(); if (!token) return;
    const nextName = name, nextMode = mode;
    try {
      const text = await actions.prepareBackup();
      stage(token, 'archive');
      const archived = await archiveLocalActivity(text, token.scope, () => assertCurrent(token));
      assertCurrent(token); void refresh();
      let candidate;
      if (targetId) {
        stage(token, 'read');
        candidate = await readLocalActivity(targetId);
      } else {
        const backup = createLocalActivityBackup(archived.layout, nextName, nextMode);
        candidate = parseLocalProjectBackupJson(JSON.stringify(backup));
      }
      assertCurrent(token);
      const targetScope = candidate.layout.id;
      if (!targetScope?.trim()) throw new Error('待打开活动缺少有效编号，当前活动未改变。');
      stage(token, 'restore'); operation.current.target = targetScope;
      await actions.restoreBackup(candidate);
      // Provider restore may itself replace the baseline; only its intended activity may receive completion.
      if (active(token) && !baseline.current.disabled && baseline.current.permissionEpoch === token.permissionEpoch &&
          (baseline.current.epoch === token.epoch || baseline.current.scope === targetScope)) {
        setNotice({ scope: targetScope, text: `已打开「${candidate.layout.name}」，原活动已归档到本机。` });
        setError(''); if (!targetId) setName(''); onComplete?.();
      }
    } catch (caught) {
      if (active(token) && !baseline.current.disabled && baseline.current.permissionEpoch === token.permissionEpoch &&
          (baseline.current.scope === token.scope || baseline.current.scope === operation.current.target)) {
        setError(caught instanceof Error ? caught.message : '活动未切换，请重试。输入及原活动已保留。');
      }
    } finally {
      if (active(token)) {
        operation.current.stage = null; pending.current = false; setWorking(null);
      }
    }
  }
  function create(event: FormEvent): void { event.preventDefault(); void switchActivity(); }

  return <section className="sc-local-activities" aria-label="本机活动">
    <p className="sc-note">新建或打开前，先将当前完整活动归档到本机。照片附件和模型文件仍需另行保留。</p>
    <p className="sc-local-activities-current">当前活动 <strong>{layout.name || '未命名活动'}</strong></p>
    {identityMissing && <p className="sc-handoff-error" role="alert">请先保存有明确编号的当前活动，再新建或打开其他活动。</p>}
    <form aria-label="新建本机活动" onSubmit={create}>
      <fieldset disabled={locked}>
        <label className="sc-field">新活动名称<input value={name} maxLength={MAX_NAME_LENGTH} placeholder="输入活动名称" onChange={event => { if (!locked && !pending.current) setName(event.currentTarget.value); }}/></label>
        <div className="sc-local-activities-modes">
          <label><input type="radio" name="new-local-activity-mode" value="empty" checked={mode === 'empty'} onChange={() => { if (!locked && !pending.current) setMode('empty'); }}/>空场地（10×8米示例）</label>
          <label><input type="radio" name="new-local-activity-mode" value="reuse-layout" checked={mode === 'reuse-layout'} onChange={() => { if (!locked && !pending.current) setMode('reuse-layout'); }}/>沿用当前布置</label>
        </div>
        <p className="sc-note">新活动不带入原需求、任务、制作计划、工作单、备注、方案历史、底图附件或点验账册。空场地尺寸之后可按实际修改。</p>
        <button type="submit" className="sc-button">新建活动</button>
      </fieldset>
    </form>
    <div className="sc-local-activities-heading"><h3>已归档的本机活动</h3><button type="button" className="sc-button" disabled={disabled || busy || listLoading} onClick={() => void refresh()}>刷新活动列表</button></div>
    {listLoading && <p className="sc-note" role="status">正在读取活动列表…</p>}
    {listError && <p className="sc-handoff-error" role="alert">{listError}</p>}
    {activities.unreadableProjectIds.length > 0 && <p className="sc-handoff-error" role="alert">有{activities.unreadableProjectIds.length}份本机活动无法读取，原资料已保留。请先核对备份。</p>}
    {!listLoading && !activities.activities.length && !listError && <p className="sc-note">尚无本机归档活动。</p>}
    <ul className="sc-local-activities-list">{activities.activities.map(activity => <li key={activity.projectId}>
      <div><strong>{activity.name}</strong><span>{activity.itemCount} 个物件 · {new Date(activity.archivedAt).toLocaleString('zh-CN')}{activity.projectId === layout.id ? ' · 当前活动' : ''}</span></div>
      <button type="button" className="sc-button" disabled={locked} aria-label={`打开活动「${activity.name}」`} onClick={() => void switchActivity(activity.projectId)}>打开</button>
    </li>)}</ul>
    {working && <p className="sc-note" role="status">{working === 'prepare' ? '正在准备当前活动…' : working === 'archive' ? '正在归档并核对当前活动…' : working === 'read' ? '正在读取待打开活动…' : '正在打开并核实保存…'}</p>}
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && notice.scope === layout.id && <p className="sc-note" role="status">{notice.text}</p>}
  </section>;
}
