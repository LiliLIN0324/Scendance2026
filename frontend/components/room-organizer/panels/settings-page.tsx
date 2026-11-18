'use client';

import { useState, type ReactNode } from 'react';
import {
  DEFAULT_AISLE_CLEAR_M,
  DEFAULT_ANGLE_SNAP_DEG,
  DEFAULT_BOOTH_SPACING_M,
  DEFAULT_GRID_SIZE_M,
  DEFAULT_LENGTH_SNAP_M,
  DEFAULT_NUDGE_STEP_M,
  DEFAULT_PLAN_TIME_ZONE,
  LENGTH_PRECISIONS_M,
  resolveSetting,
  sanitizePlanEditor,
  type CurrencyCode,
  type LengthPrecisionM,
  type PlanEditorQuote,
  type PlanEditorSettings,
  type SettingSource,
  type StudioSettings,
  type StudioSettingsPatch,
} from '../../../../supabase/functions/_shared/plan-editor';
import { isValidTimeZone } from '../../../lib/event-profile';
import { ShortcutReference } from './shortcut-reference';
import type { DisplayUnit, RoomLayout } from '../lib/types';
import type { PlanQuote } from '../../../../supabase/functions/_shared/site-plan';

export interface SettingsPreferences {
  lengthUnit: DisplayUnit;
  showMeasurements: boolean;
  lengthPrecisionM?: LengthPrecisionM;
  snapToGrid?: boolean;
  snapToWall?: boolean;
  snapToItems?: boolean;
}

export type SettingsPane = 'personal' | 'shortcuts' | 'plan-display' | 'plan-time' | 'plan-aisle' | 'team';

const SOURCE_LABEL: Record<SettingSource, string> = {
  plan: '本方案',
  personal: '个人',
  team: '团队',
  builtin: '默认',
};

const TIME_ZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'Pacific/Kiritimati',
  'UTC',
];

const CURRENCY_OPTIONS: { value: CurrencyCode; label: string }[] = [
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '欧元 EUR' },
  { value: 'GBP', label: '英镑 GBP' },
  { value: 'JPY', label: '日元 JPY' },
];

function SourceBadge({ source }: { source: SettingSource }) {
  return <span className={`sc-setting-source is-${source}`}>{SOURCE_LABEL[source]}</span>;
}

function Row({
  title,
  detail,
  source,
  children,
  action,
}: {
  title: string;
  detail: string;
  source?: SettingSource;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sc-settings-row">
      <div className="sc-settings-row-main">
        <strong>{title}{source ? <> <SourceBadge source={source} /></> : null}</strong>
        <small>{detail}</small>
      </div>
      <div className="sc-settings-row-actions">
        {children}
        {action}
      </div>
    </div>
  );
}

export function SettingsPage({
  preferences,
  onPreferenceChange,
  preferenceStatus,
  layout,
  onPlanSettingsChange,
  siteQuote,
  signedIn,
  studioRole,
  studioSettings,
  studioStatus,
  studioError,
  onSaveStudioSettings,
  onOpenTeam,
}: {
  preferences: SettingsPreferences;
  onPreferenceChange: (patch: Partial<SettingsPreferences>) => void;
  preferenceStatus: string;
  layout?: RoomLayout;
  onPlanSettingsChange?: (next: PlanEditorSettings | undefined) => void;
  siteQuote?: PlanQuote | undefined;
  signedIn: boolean;
  studioRole?: 'owner' | 'editor' | null;
  studioSettings: StudioSettings | null;
  studioStatus: 'idle' | 'loading' | 'ready' | 'error' | 'signed-out';
  studioError?: string;
  onSaveStudioSettings?: (patch: StudioSettingsPatch) => Promise<void>;
  onOpenTeam?: () => void;
}): JSX.Element {
  const hasPlan = !!layout && !!onPlanSettingsChange;
  const [pane, setPane] = useState<SettingsPane>('personal');
  const [teamDraft, setTeamDraft] = useState<StudioSettingsPatch>({});
  const [teamMessage, setTeamMessage] = useState('');
  const plan = sanitizePlanEditor(layout?.planSettings) ?? {};
  const precision = preferences.lengthPrecisionM ?? 0.01;
  const owner = studioRole === 'owner';

  const writePlan = (next: PlanEditorSettings | undefined) => {
    onPlanSettingsChange?.(next && Object.keys(next).length > 0 ? next : undefined);
  };
  const patchPlan = (patch: Partial<PlanEditorSettings>) => {
    writePlan(sanitizePlanEditor({ ...plan, ...patch }));
  };
  const clearPlan = (...keys: (keyof PlanEditorSettings)[]) => {
    const next: PlanEditorSettings = { ...plan };
    for (const key of keys) delete next[key];
    writePlan(sanitizePlanEditor(next));
  };

  const quoteBase = (): PlanEditorQuote => {
    const base: PlanEditorQuote = { ...(plan.quote ?? {}) };
    if (plan.quoteTouched) return base;
    if (!base.contact && siteQuote?.preparedBy) base.contact = siteQuote.preparedBy;
    if (!base.companyName && siteQuote?.companyName) base.companyName = siteQuote.companyName;
    if (!base.currency && siteQuote?.currency) base.currency = siteQuote.currency;
    if (!base.logoUrl && siteQuote?.logoUrl) base.logoUrl = siteQuote.logoUrl;
    return base;
  };
  const writeQuote = (patch: Partial<PlanEditorQuote>, clear: (keyof PlanEditorQuote)[] = []) => {
    const quote = quoteBase();
    for (const key of clear) delete quote[key];
    Object.assign(quote, patch);
    const next: PlanEditorSettings = { ...plan, quoteTouched: true };
    const cleaned = sanitizePlanEditor({ ...next, quote });
    writePlan(cleaned ? { ...cleaned, quoteTouched: true } : { quoteTouched: true });
  };

  const planCompany = plan.quote?.companyName ?? (!plan.quoteTouched ? siteQuote?.companyName : undefined);
  const planContact = plan.quote?.contact ?? (!plan.quoteTouched ? siteQuote?.preparedBy : undefined);
  const planCurrency = plan.quote?.currency ?? (!plan.quoteTouched ? siteQuote?.currency : undefined);
  const planLogo = plan.quote?.logoUrl ?? (!plan.quoteTouched ? siteQuote?.logoUrl : undefined);
  const company = resolveSetting(planCompany, studioSettings?.companyName, '', 'team');
  const contact = resolveSetting(planContact, studioSettings?.quoteContact, '', 'team');
  const currency = resolveSetting(planCurrency, studioSettings?.currency, 'CNY' as CurrencyCode, 'team');
  const logo = resolveSetting(planLogo, studioSettings?.logoUrl, '', 'team');

  const timeZoneValue = plan.timeZone && isValidTimeZone(plan.timeZone) ? plan.timeZone : undefined;
  const timeZone = resolveSetting(timeZoneValue, undefined, DEFAULT_PLAN_TIME_ZONE, 'personal');
  const zones = TIME_ZONES.includes(timeZone.value) ? TIME_ZONES : [timeZone.value, ...TIME_ZONES];

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

  const navButton = (id: SettingsPane, label: string) => (
    <button type="button" role="tab" aria-selected={pane === id} aria-pressed={pane === id} onClick={() => setPane(id)}>{label}</button>
  );

  return (
    <div className="sc-account-prefs">
      <nav className="sc-account-prefs-nav" aria-label="设置分区" role="tablist">
        <p className="sc-settings-scope">个人</p>
        {navButton('personal', '偏好')}
        {navButton('shortcuts', '快捷键')}
        {hasPlan ? (
          <>
            <p className="sc-settings-scope">本方案</p>
            {navButton('plan-display', '显示与网格')}
            {navButton('plan-time', '时区')}
            {navButton('plan-aisle', '通道与摊位')}
          </>
        ) : null}
        <p className="sc-settings-scope">团队</p>
        {navButton('team', '报价抬头与新项目默认')}
        <button type="button" className="sc-settings-linkout" onClick={onOpenTeam}>团队与权限 ↗</button>
      </nav>

      {pane === 'personal' ? (
        <div className="sc-account-prefs-main" role="tabpanel">
          <div className="sc-account-prefs-head">
            <h3>个人偏好</h3>
            <p>跟账号走，换一份方案还在。{preferenceStatus}</p>
          </div>
          <div className="sc-settings-prefs">
            <div className="sc-settings-group">
              <Row title="显示单位" source={preferences.lengthUnit === 'm' ? 'builtin' : 'personal'} detail="标注、属性面板和清单的读数。场景数据仍按米存储。">
                <div className="sc-unit-seg" role="group" aria-label="显示单位">
                  <button type="button" aria-pressed={preferences.lengthUnit === 'm'} onClick={() => onPreferenceChange({ lengthUnit: 'm' })}>米 · m</button>
                  <button type="button" aria-pressed={preferences.lengthUnit === 'ft'} onClick={() => onPreferenceChange({ lengthUnit: 'ft' })}>英尺 · ft</button>
                </div>
              </Row>
              <Row title="尺寸标注" source={preferences.showMeasurements ? 'builtin' : 'personal'} detail="在画布上显示场地与物件的尺寸读数。">
                <label className="sc-switch">
                  <input aria-label="尺寸标注" type="checkbox" checked={preferences.showMeasurements} onChange={event => onPreferenceChange({ showMeasurements: event.target.checked })} />
                  <i />
                </label>
              </Row>
              <Row title="读数精度" source={precision === 0.01 ? 'builtin' : 'personal'} detail="先按这个米制步长取整，再换成当前单位。切英尺只改读数。" action={precision === 0.01 ? null : <button type="button" className="sc-settings-outline" onClick={() => onPreferenceChange({ lengthPrecisionM: 0.01 })}>恢复默认</button>}>
                <div className="sc-unit-seg" role="group" aria-label="读数精度">
                  {LENGTH_PRECISIONS_M.map(step => (
                    <button key={step} type="button" aria-pressed={precision === step} onClick={() => onPreferenceChange({ lengthPrecisionM: step })}>{step} m</button>
                  ))}
                </div>
              </Row>
            </div>
            <div className="sc-settings-group">
              <Row title="网格吸附" source={preferences.snapToGrid ? 'personal' : 'builtin'} detail="建造画布。G 只切换这一项。">
                <label className="sc-switch"><input aria-label="网格吸附" type="checkbox" checked={!!preferences.snapToGrid} onChange={event => onPreferenceChange({ snapToGrid: event.target.checked })} /><i /></label>
              </Row>
              <Row title="墙吸附" source={preferences.snapToWall ? 'personal' : 'builtin'} detail="靠近墙时贴齐。和 G 无关。">
                <label className="sc-switch"><input aria-label="墙吸附" type="checkbox" checked={!!preferences.snapToWall} onChange={event => onPreferenceChange({ snapToWall: event.target.checked })} /><i /></label>
              </Row>
              <Row title="物件吸附" source={preferences.snapToItems ? 'personal' : 'builtin'} detail="靠近其他物件时对齐。和 G 无关。">
                <label className="sc-switch"><input aria-label="物件吸附" type="checkbox" checked={!!preferences.snapToItems} onChange={event => onPreferenceChange({ snapToItems: event.target.checked })} /><i /></label>
              </Row>
            </div>
          </div>
        </div>
      ) : null}

      {pane === 'shortcuts' ? (
        <div className="sc-account-prefs-main" role="tabpanel">
          <div className="sc-account-prefs-head">
            <h3>快捷键</h3>
            <p>按模式列出当前绑定。这里只读，不改键位。画布上按 ? 看当前模式。</p>
          </div>
          <ShortcutReference />
        </div>
      ) : null}

      {pane === 'plan-display' && hasPlan ? (
        <div className="sc-account-prefs-main" role="tabpanel">
          <div className="sc-account-prefs-head">
            <h3>显示与网格</h3>
            <p>只影响这一份方案，会跟着方案保存。内部仍按米存储。</p>
          </div>
          <div className="sc-settings-group">
            <Row
              title="显示单位"
              source={plan.displayUnit ? 'plan' : 'personal'}
              detail={plan.displayUnit ? `本方案使用${plan.displayUnit === 'ft' ? '英尺' : '米'}。` : `跟随个人（${preferences.lengthUnit === 'ft' ? '英尺' : '米'}）。`}
              action={plan.displayUnit ? <button type="button" className="sc-settings-outline" onClick={() => clearPlan('displayUnit')}>跟随个人</button> : null}
            >
              <div className="sc-unit-seg" role="group" aria-label="本方案显示单位">
                <button type="button" aria-pressed={!plan.displayUnit} onClick={() => clearPlan('displayUnit')}>跟随个人</button>
                <button type="button" aria-pressed={plan.displayUnit === 'm'} onClick={() => patchPlan({ displayUnit: 'm' })}>米</button>
                <button type="button" aria-pressed={plan.displayUnit === 'ft'} onClick={() => patchPlan({ displayUnit: 'ft' })}>英尺</button>
              </div>
            </Row>
            <NumberRow title="网格间距" source={plan.gridSizeM !== undefined ? 'plan' : 'builtin'} detail="2D / 3D 网格和平面图导出用同一间距。" value={plan.gridSizeM ?? DEFAULT_GRID_SIZE_M} min={0.05} max={5} step={0.05} onChange={value => patchPlan({ gridSizeM: value })} onReset={plan.gridSizeM !== undefined ? () => clearPlan('gridSizeM') : undefined} />
            <NumberRow title="长度吸附" source={plan.lengthSnapM !== undefined ? 'plan' : 'builtin'} detail="建造画布的网格吸附步长，以及放大后的场地落位。" value={plan.lengthSnapM ?? DEFAULT_LENGTH_SNAP_M} min={0.01} max={5} step={0.01} onChange={value => patchPlan({ lengthSnapM: value })} onReset={plan.lengthSnapM !== undefined ? () => clearPlan('lengthSnapM') : undefined} />
            <NumberRow title="角度吸附" source={plan.angleSnapDeg !== undefined ? 'plan' : 'builtin'} detail="Shift+R，以及场地里待放置物件的 R。" value={plan.angleSnapDeg ?? DEFAULT_ANGLE_SNAP_DEG} min={1} max={90} step={1} suffix="°" onChange={value => patchPlan({ angleSnapDeg: value })} onReset={plan.angleSnapDeg !== undefined ? () => clearPlan('angleSnapDeg') : undefined} />
            <NumberRow title="微移步长" source={plan.nudgeStepM !== undefined ? 'plan' : 'builtin'} detail="方向键每次移动的米数。按住 Shift 为 10 倍。" value={plan.nudgeStepM ?? DEFAULT_NUDGE_STEP_M} min={0.001} max={1} step={0.01} onChange={value => patchPlan({ nudgeStepM: value })} onReset={plan.nudgeStepM !== undefined ? () => clearPlan('nudgeStepM') : undefined} />
          </div>
        </div>
      ) : null}

      {pane === 'plan-time' && hasPlan ? (
        <div className="sc-account-prefs-main" role="tabpanel">
          <div className="sc-account-prefs-head">
            <h3>时区</h3>
            <p>当天执行包的文件名和「生成于」用这个时区，不再写死上海，也不按 UTC 截日期。</p>
          </div>
          <div className="sc-settings-group">
            <Row title="方案时区" source={timeZone.source === 'plan' ? 'plan' : 'builtin'} detail="非法时区会回到 Asia/Shanghai。" action={plan.timeZone ? <button type="button" className="sc-settings-outline" onClick={() => clearPlan('timeZone')}>恢复默认</button> : null}>
              <select aria-label="方案时区" value={timeZone.value} onChange={event => {
                if (event.target.value === DEFAULT_PLAN_TIME_ZONE) clearPlan('timeZone');
                else patchPlan({ timeZone: event.target.value });
              }}>
                {zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </Row>
          </div>
        </div>
      ) : null}

      {pane === 'plan-aisle' && hasPlan ? (
        <div className="sc-account-prefs-main" role="tabpanel">
          <div className="sc-account-prefs-head">
            <h3>通道与摊位</h3>
            <p>一句话布置摊位带时，句子没写通道就用这个净宽；沿通道的摊位间距用这个值。预览和落库是同一套数。</p>
          </div>
          <div className="sc-settings-group">
            <NumberRow title="通道净宽" source={plan.aisleClearM !== undefined ? 'plan' : 'builtin'} detail="米。句子里写了「留 N 米通道」时，以句子为准。" value={plan.aisleClearM ?? DEFAULT_AISLE_CLEAR_M} min={0.6} max={12} step={0.1} onChange={value => patchPlan({ aisleClearM: value })} onReset={plan.aisleClearM !== undefined ? () => clearPlan('aisleClearM') : undefined} />
            <NumberRow title="摊位间距" source={plan.boothSpacingM !== undefined ? 'plan' : 'builtin'} detail="米。沿通道方向，相邻摊位之间的空隙。" value={plan.boothSpacingM ?? DEFAULT_BOOTH_SPACING_M} min={0} max={5} step={0.1} onChange={value => patchPlan({ boothSpacingM: value })} onReset={plan.boothSpacingM !== undefined ? () => clearPlan('boothSpacingM') : undefined} />
          </div>
        </div>
      ) : null}

      {pane === 'team' ? (
        <div className="sc-account-prefs-main" role="tabpanel">
          <div className="sc-account-prefs-head">
            <h3>报价抬头与新项目默认</h3>
            <p>抬头给新报价单；本方案仍可覆盖。单位、通道和摊位间距只在之后新建方案时写入，不改已经打开的方案。</p>
          </div>
          {!signedIn ? <p className="sc-account-footnote">登录后才能读写团队默认。个人偏好仍留在本机。</p> : null}
          {studioStatus === 'loading' ? <p className="sc-account-footnote">正在读取团队默认…</p> : null}
          {studioStatus === 'error' ? <p className="sc-account-error" role="alert">{studioError || '团队默认没有读到。画布不受影响。'}</p> : null}
          {signedIn && studioRole && studioRole !== 'owner' ? <p className="sc-account-footnote">你能查看团队默认。只有负责人能修改。</p> : null}
          <div className="sc-settings-group">
            <Row title="公司名" source={company.source} detail={company.value ? company.value : '还没有公司名。'} action={company.source === 'plan' ? <button type="button" className="sc-settings-outline" onClick={() => writeQuote({}, ['companyName'])}>跟随团队</button> : null}>
              <input aria-label="本方案公司名" value={plan.quote?.companyName ?? ''} placeholder={studioSettings?.companyName || '本方案覆盖'} onChange={event => {
                const value = event.target.value.trim();
                if (value) writeQuote({ companyName: value });
                else writeQuote({}, ['companyName']);
              }} />
            </Row>
            <Row title="报价人" source={contact.source} detail={contact.value ? contact.value : '还没有报价人。'} action={contact.source === 'plan' ? <button type="button" className="sc-settings-outline" onClick={() => writeQuote({}, ['contact'])}>跟随团队</button> : null}>
              <input aria-label="本方案报价人" value={plan.quote?.contact ?? ''} placeholder={studioSettings?.quoteContact || '本方案覆盖'} onChange={event => {
                const value = event.target.value.trim();
                if (value) writeQuote({ contact: value });
                else writeQuote({}, ['contact']);
              }} />
            </Row>
            <Row title="货币" source={currency.source} detail="新报价单和这份方案的金额符号。" action={plan.quote?.currency ? <button type="button" className="sc-settings-outline" onClick={() => writeQuote({}, ['currency'])}>跟随团队</button> : null}>
              <select aria-label="本方案货币" value={plan.quote?.currency ?? ''} onChange={event => {
                const value = event.target.value as CurrencyCode | '';
                if (value) writeQuote({ currency: value });
                else writeQuote({}, ['currency']);
              }}>
                <option value="">跟随团队{studioSettings?.currency ? `（${studioSettings.currency}）` : ''}</option>
                {CURRENCY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Row>
            <Row title="标志" source={logo.source} detail={logo.value ? '已有标志，会印在报价单上。' : '还没有标志。'} action={plan.quote?.logoUrl ? <button type="button" className="sc-settings-outline" onClick={() => writeQuote({}, ['logoUrl'])}>跟随团队</button> : null}>
              <input aria-label="本方案标志" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 60_000) {
                  setTeamMessage('标志需要小于 60KB。');
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const url = typeof reader.result === 'string' ? reader.result : '';
                  if (url.startsWith('data:image/')) writeQuote({ logoUrl: url });
                };
                reader.readAsDataURL(file);
              }} />
            </Row>
          </div>
          <div className="sc-settings-group">
            <p className="sc-settings-scope">团队默认 · 只影响之后新建</p>
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NumberRow({
  title,
  detail,
  source,
  value,
  min,
  max,
  step,
  suffix = 'm',
  onChange,
  onReset,
}: {
  title: string;
  detail: string;
  source: SettingSource;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
  onReset?: (() => void) | undefined;
}) {
  return (
    <Row title={title} detail={detail} source={source} action={onReset ? <button type="button" className="sc-settings-outline" onClick={onReset}>恢复默认</button> : null}>
      <input
        aria-label={title}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(3))}
        onChange={event => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      <span>{suffix}</span>
    </Row>
  );
}
