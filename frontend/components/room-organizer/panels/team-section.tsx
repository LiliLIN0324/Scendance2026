'use client';

import { useState } from 'react';
import type { CurrencyCode, StudioSettings, StudioSettingsPatch } from '../../../../supabase/functions/_shared/plan-editor';
import type { BackendSession } from '@/lib/backend-session';
import { AccountTeamPanel } from './account-team-panel';
import { CURRENCY_OPTIONS } from './settings-page';

/**
 * 账户弹窗的一级「团队」分区（2026-11-22 用户拍板，按 11-18 对标结论「不把成员管理搬进设置页」落）：
 * 成员名单 + 团队默认 + 删除团队，三块都在这里；设置里只留个人与本方案。
 * 报价抬头拆成两半：本方案覆盖行在设置的「本方案」页，团队默认行在这里——
 * 同一块抬头此前两种作用域混在一页，来源徽标和输入框谁覆盖谁都看不清。
 */
export function TeamSection({
  controller,
  studioId,
  studioName,
  owner,
  signedIn,
  studioSettings,
  studioStatus,
  studioError,
  onSaveStudioSettings,
  onStudioRenamed,
  onDeleteStudio,
}: {
  controller: BackendSession;
  /** 左栏当前选中的团队：成员名单与默认跟着这个上下文走，不再自己按项目/记忆猜。 */
  studioId: string;
  studioName?: string;
  owner: boolean;
  signedIn: boolean;
  studioSettings: StudioSettings | null;
  studioStatus: 'idle' | 'loading' | 'ready' | 'error' | 'signed-out';
  studioError?: string;
  onSaveStudioSettings?: (patch: StudioSettingsPatch) => Promise<void>;
  onStudioRenamed?(studioId: string, name: string): void;
  onDeleteStudio?: () => void;
}): JSX.Element {
  const [teamDraft, setTeamDraft] = useState<StudioSettingsPatch>({});
  const [teamMessage, setTeamMessage] = useState('');

  const saveTeam = async (patch: StudioSettingsPatch) => {
    if (!onSaveStudioSettings) return;
    setTeamMessage('');
    try {
      await onSaveStudioSettings(patch);
      setTeamDraft({});
      setTeamMessage('已写入团队默认。已有方案不追溯。');
    } catch (error) {
      setTeamMessage(error instanceof Error ? error.message : '团队默认没有写上。');
    }
  };

  const removeTeam = () => {
    if (!onDeleteStudio) return;
    if (!window.confirm(`删除团队「${studioName ?? ''}」？\n\n· 团队里还有项目时会拦下，先把项目移入「最近删除」\n· 删除后成员立即失去访问权，需要重新邀请`)) return;
    onDeleteStudio();
  };

  const defaultsVisible = signedIn && !!studioId;

  return <div className="sc-settings-main">
    <div className="sc-settings-main-head">
      <h2 id="sc-team-title">团队</h2>
    </div>
    <AccountTeamPanel controller={controller} studioId={studioId} {...(onStudioRenamed ? { onStudioRenamed } : {})} />
    <p className="sc-settings-kicker">团队默认 · 只影响之后新建</p>
    {!signedIn ? <p className="sc-account-footnote">登录后才能读写团队默认。</p> : null}
    {studioStatus === 'loading' ? <p className="sc-account-footnote">正在读取团队默认…</p> : null}
    {studioStatus === 'error' ? <p className="sc-account-error" role="alert">{studioError || '团队默认没有读到。画布不受影响。'}</p> : null}
    {signedIn && !owner && studioStatus === 'ready' ? <p className="sc-account-footnote">你能查看团队默认。只有负责人能修改。</p> : null}
    {defaultsVisible ? <div className="sc-settings-group">
      <label className="sc-settings-row">
        <span className="sc-settings-row-main"><strong>团队公司名</strong><small>{studioSettings?.companyName || '未设置'}</small></span>
        <input aria-label="团队公司名" disabled={!owner} value={teamDraft.companyName ?? studioSettings?.companyName ?? ''} onChange={event => setTeamDraft(current => ({ ...current, companyName: event.target.value }))} />
      </label>
      <label className="sc-settings-row">
        <span className="sc-settings-row-main"><strong>团队报价人</strong><small>{studioSettings?.quoteContact || '未设置'}</small></span>
        <input aria-label="团队报价人" disabled={!owner} value={teamDraft.quoteContact ?? studioSettings?.quoteContact ?? ''} onChange={event => setTeamDraft(current => ({ ...current, quoteContact: event.target.value }))} />
      </label>
      <label className="sc-settings-row">
        <span className="sc-settings-row-main"><strong>团队货币</strong><small>{studioSettings?.currency || '未设置，报价单按人民币'}</small></span>
        <select aria-label="团队货币" disabled={!owner} value={teamDraft.currency ?? studioSettings?.currency ?? ''} onChange={event => setTeamDraft(current => ({ ...current, currency: (event.target.value || null) as CurrencyCode | null }))}>
          <option value="">不指定</option>
          {CURRENCY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="sc-settings-row">
        <span className="sc-settings-row-main"><strong>团队标志</strong><small>{studioSettings?.logoUrl ? '已有' : '未设置'}</small></span>
        <input aria-label="团队标志" type="file" accept="image/png,image/jpeg,image/webp" disabled={!owner} onChange={event => {
          const file = event.target.files?.[0];
          if (!file || file.size > 60_000) {
            if (file) setTeamMessage('标志需要小于 60KB。');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const url = typeof reader.result === 'string' ? reader.result : '';
            if (url) setTeamDraft(current => ({ ...current, logoUrl: url }));
          };
          reader.readAsDataURL(file);
        }} />
      </label>
      <label className="sc-settings-row">
        <span className="sc-settings-row-main"><strong>新方案单位</strong><small>{studioSettings?.defaultUnit === 'ft' ? '英尺' : studioSettings?.defaultUnit === 'm' ? '米' : '不指定，跟随个人'}</small></span>
        <select aria-label="新方案单位" disabled={!owner} value={teamDraft.defaultUnit ?? studioSettings?.defaultUnit ?? ''} onChange={event => setTeamDraft(current => ({ ...current, defaultUnit: (event.target.value || null) as 'm' | 'ft' | null }))}>
          <option value="">不指定</option>
          <option value="m">米</option>
          <option value="ft">英尺</option>
        </select>
      </label>
      <label className="sc-settings-row">
        <span className="sc-settings-row-main"><strong>新方案通道净宽</strong><small>{studioSettings?.defaultAisleClearM !== undefined ? `${studioSettings.defaultAisleClearM} m` : '不指定，用 2.4 m'}</small></span>
        <input aria-label="新方案通道净宽" disabled={!owner} type="number" min={0.6} max={12} step={0.1} value={teamDraft.defaultAisleClearM ?? studioSettings?.defaultAisleClearM ?? ''} placeholder="米" onChange={event => setTeamDraft(current => ({ ...current, defaultAisleClearM: event.target.value === '' ? null : Number(event.target.value) }))} />
      </label>
      <label className="sc-settings-row">
        <span className="sc-settings-row-main"><strong>新方案摊位间距</strong><small>{studioSettings?.defaultBoothSpacingM !== undefined ? `${studioSettings.defaultBoothSpacingM} m` : '不指定，用 0.6 m'}</small></span>
        <input aria-label="新方案摊位间距" disabled={!owner} type="number" min={0} max={5} step={0.1} value={teamDraft.defaultBoothSpacingM ?? studioSettings?.defaultBoothSpacingM ?? ''} placeholder="米" onChange={event => setTeamDraft(current => ({ ...current, defaultBoothSpacingM: event.target.value === '' ? null : Number(event.target.value) }))} />
      </label>
      <div className="sc-settings-row">
        <div className="sc-settings-row-main"><strong>保存团队默认</strong><small>{teamMessage || '只影响之后的新报价和新方案。'}</small></div>
        <button type="button" className="sc-settings-outline" disabled={!owner || studioStatus === 'loading'} onClick={() => { void saveTeam(teamDraft); }}>保存</button>
      </div>
    </div> : null}
    {owner && onDeleteStudio ? <div className="sc-settings-group sc-team-danger">
      <div className="sc-settings-row">
        <div className="sc-settings-row-main"><strong>删除团队</strong><small>团队里的项目要先移入「最近删除」，删除后成员立即失去访问权。</small></div>
        <button type="button" className="sc-settings-outline" aria-label={`删除团队${studioName ?? ''}`} onClick={removeTeam}>删除团队</button>
      </div>
    </div> : null}
  </div>;
}
