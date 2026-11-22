'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ruler, UserRound } from '@/components/solid-icons';
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
} from '../../../../supabase/functions/_shared/plan-editor';
import { isValidTimeZone } from '../../../lib/event-profile';
import type { PlanQuote } from '../../../../supabase/functions/_shared/site-plan';
import type { DisplayUnit, RoomLayout } from '../lib/types';

export interface SettingsPreferences {
  lengthUnit: DisplayUnit;
  showMeasurements: boolean;
  lengthPrecisionM?: LengthPrecisionM;
  snapToGrid?: boolean;
  snapToWall?: boolean;
  snapToItems?: boolean;
}

/** 设置里只剩「个人」和「本方案」两页：团队在账户弹窗是一级分区（team-section.tsx），不再是设置的页签。 */
export type SettingsPane = 'personal' | 'plan';

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

/** 货币清单：本方案报价抬头与团队默认（team-section）共用同一份，避免两处各写各的。 */
export const CURRENCY_OPTIONS: { value: CurrencyCode; label: string }[] = [
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
  studioSettings,
  paneRequest,
  onOpenShortcuts,
}: {
  preferences: SettingsPreferences;
  onPreferenceChange: (patch: Partial<SettingsPreferences>) => void;
  preferenceStatus: string;
  layout?: RoomLayout;
  onPlanSettingsChange?: (next: PlanEditorSettings | undefined) => void;
  siteQuote?: PlanQuote | undefined;
  /** 团队默认值只用来标来源徽标和占位符；团队默认的编辑在 team-section.tsx。 */
  studioSettings: StudioSettings | null;
  paneRequest?: { serial: number; pane: SettingsPane };
  onOpenShortcuts?: () => void;
}): JSX.Element {
  const hasPlan = !!layout && !!onPlanSettingsChange;
  const [pane, setPane] = useState<SettingsPane>(paneRequest?.pane ?? 'personal');
  const seenPane = useRef(paneRequest?.serial ?? 0);
  useEffect(() => {
    if (!paneRequest || paneRequest.serial === seenPane.current) return;
    seenPane.current = paneRequest.serial;
    setPane(paneRequest.pane);
  }, [paneRequest]);
  const plan = sanitizePlanEditor(layout?.planSettings) ?? {};
  const precision = preferences.lengthPrecisionM ?? 0.01;

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
  /** 报价抬头里标志超 60KB 等写不进去的回执，挂在报价抬头组下面。 */
  const [quoteMessage, setQuoteMessage] = useState('');

  const navButton = (id: SettingsPane, label: string, icon: ReactNode) => (
    <button type="button" aria-pressed={pane === id} onClick={() => setPane(id)}>{icon}{label}</button>
  );

  return (
    <div className="sc-settings-shell">
      <nav className="sc-settings-nav" aria-label="设置分区">
        {navButton('personal', '个人', <UserRound size={15} aria-hidden="true" />)}
        {navButton('plan', '本方案', <Ruler size={15} aria-hidden="true" />)}
      </nav>

      {pane === 'personal' ? (
        <div className="sc-settings-main">
          <div className="sc-settings-main-head">
            <h2 id="sc-settings-title">个人</h2>
            <p>{preferenceStatus}</p>
          </div>
          <div className="sc-settings-prefs">
            <p className="sc-settings-kicker">读数与标注</p>
            <div className="sc-settings-group">
              <Row title="显示单位" source={preferences.lengthUnit === 'm' ? 'builtin' : 'personal'} detail="标注、画布和导出用同一读数。方案数据仍按米存储。">
                <div className="sc-unit-seg" role="group" aria-label="显示单位">
                  <button type="button" aria-pressed={preferences.lengthUnit === 'm'} onClick={() => onPreferenceChange({ lengthUnit: 'm' })}>米</button>
                  <button type="button" aria-pressed={preferences.lengthUnit === 'ft'} onClick={() => onPreferenceChange({ lengthUnit: 'ft' })}>英尺</button>
                </div>
              </Row>
              <Row title="尺寸标注" source={preferences.showMeasurements ? 'builtin' : 'personal'} detail="在画布上显示场地与物件的尺寸读数。">
                <label className="sc-switch">
                  <input aria-label="尺寸标注" type="checkbox" checked={preferences.showMeasurements} onChange={event => onPreferenceChange({ showMeasurements: event.target.checked })} />
                  <i />
                </label>
              </Row>
              <Row title="读数精度" source={precision === 0.01 ? 'builtin' : 'personal'} detail="先圆到这个步长再显示，可随时改。" action={precision === 0.01 ? null : <button type="button" className="sc-settings-outline" onClick={() => onPreferenceChange({ lengthPrecisionM: 0.01 })}>恢复默认</button>}>
                <div className="sc-unit-seg" role="group" aria-label="读数精度">
                  {LENGTH_PRECISIONS_M.map(step => (
                    <button key={step} type="button" aria-pressed={precision === step} onClick={() => onPreferenceChange({ lengthPrecisionM: step })}>{step} m</button>
                  ))}
                </div>
              </Row>
            </div>
            <p className="sc-settings-kicker">吸附</p>
            <div className="sc-settings-group">
              <Row title="网格吸附" source={preferences.snapToGrid ? 'personal' : 'builtin'} detail="建筑点布局时，只对准这一层。">
                <label className="sc-switch"><input aria-label="网格吸附" type="checkbox" checked={!!preferences.snapToGrid} onChange={event => onPreferenceChange({ snapToGrid: event.target.checked })} /><i /></label>
              </Row>
              <Row title="墙吸附" source={preferences.snapToWall ? 'personal' : 'builtin'} detail="靠近墙时贴齐，和 G 无关。">
                <label className="sc-switch"><input aria-label="墙吸附" type="checkbox" checked={!!preferences.snapToWall} onChange={event => onPreferenceChange({ snapToWall: event.target.checked })} /><i /></label>
              </Row>
              <Row title="物件吸附" source={preferences.snapToItems ? 'personal' : 'builtin'} detail="靠近其他物件时对齐，和 G 无关。">
                <label className="sc-switch"><input aria-label="物件吸附" type="checkbox" checked={!!preferences.snapToItems} onChange={event => onPreferenceChange({ snapToItems: event.target.checked })} /><i /></label>
              </Row>
            </div>
            <p className="sc-settings-kicker">快捷键</p>
            <div className="sc-settings-group">
              <Row title="键盘快捷键" detail="按 ? 或 Shift + / 打开只读速查。户外先显示户外分组。">
                <button type="button" className="sc-settings-outline" onClick={onOpenShortcuts}>查看速查</button>
              </Row>
            </div>
          </div>
        </div>
      ) : null}

      {pane === 'plan' ? (
        <div className="sc-settings-main">
          <div className="sc-settings-main-head">
            <h2 id="sc-settings-title">本方案</h2>
            <p>只影响这一份方案，会跟着方案保存。内部仍按米存储。</p>
          </div>
          {!hasPlan ? <p className="sc-account-footnote">打开一份方案后，可以改这一份的单位、网格、时区和通道。</p> : null}
          {hasPlan ? <>
          <p className="sc-settings-kicker">显示与网格</p>
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
          <p className="sc-settings-kicker">时区</p>
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
          <p className="sc-settings-kicker">通道与摊位</p>
          <div className="sc-settings-group">
            <NumberRow title="通道净宽" source={plan.aisleClearM !== undefined ? 'plan' : 'builtin'} detail="米。句子里写了「留 N 米通道」时，以句子为准。" value={plan.aisleClearM ?? DEFAULT_AISLE_CLEAR_M} min={0.6} max={12} step={0.1} onChange={value => patchPlan({ aisleClearM: value })} onReset={plan.aisleClearM !== undefined ? () => clearPlan('aisleClearM') : undefined} />
            <NumberRow title="摊位间距" source={plan.boothSpacingM !== undefined ? 'plan' : 'builtin'} detail="米。沿通道方向，相邻摊位之间的空隙。" value={plan.boothSpacingM ?? DEFAULT_BOOTH_SPACING_M} min={0} max={5} step={0.1} onChange={value => patchPlan({ boothSpacingM: value })} onReset={plan.boothSpacingM !== undefined ? () => clearPlan('boothSpacingM') : undefined} />
          </div>
          <p className="sc-settings-kicker">报价抬头</p>
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
                  setQuoteMessage('标志需要小于 60KB。');
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
          {quoteMessage ? <p className="sc-account-error" role="alert">{quoteMessage}</p> : null}
          </> : null}
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
