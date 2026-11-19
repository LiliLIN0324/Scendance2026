/**
 * 户外三张确认卡：场地候选 / 流线提案 / 区域提案。
 *
 * 三张本来就只接渲染数据与回调（无 AgentValue 依赖），搬出只为缩小面板改动重叠；
 * 卡内不发起任何写入，确认动作由面板经 callback 交回。
 */
import { useState } from 'react';
import { Check, Square, X } from '@/components/solid-icons';
import type { PlaceSuggestion } from '../lib/place-search';
import type { ZoneEventProposal } from '../lib/zone-event-proposal';

/** V-1b 场地回显确认卡：候选来自双源检索。
 *  2026-11-15 用户拍板：chat 卡只给前三个候选、只留标题（不再堆全量地址溢出面板）；
 *  完整候选带门牌地址、按 1/2/3… 编号排在地图左上角搜索框的下拉里，逐个点开看。
 *  2026-11-19 用户指令：点选不再立刻确认——先在右侧地图预览（钉点+飞过去，不写方案），
 *  1/2/3 可随意切换，点「就定这个场地」才走 V-1c 锚定链（立壳、铺底图、框边界）。 */
export function VenueConfirmCard({ state, onPick, onPreview, onDismiss, onManual }: {
  state: { query: string; candidates: PlaceSuggestion[]; loading: boolean; picking: string | null };
  onPick: (place: PlaceSuggestion) => void;
  /** 点选只做地图预览；不传则维持旧行为（点选即确认）。 */
  onPreview?: (place: PlaceSuggestion) => void;
  onDismiss: () => void;
  /** 没有候选时的地图兜底：打开地图圈画，不让用户卡在「没搜到」。 */
  onManual?: (() => void) | undefined;
}): JSX.Element {
  const topThree = state.candidates.slice(0, 3);
  const [browsing, setBrowsing] = useState<string | null>(null);
  const browsed = topThree.find((place) => place.name === browsing) ?? null;
  return <section className="ap-card ap-venue-card" aria-label="场地确认">
    <p className="ap-lead-title">我理解为「{state.query}」，设为场地？</p>
    <p className="ap-lead-body">点一个标题，右侧地图先预览它的位置；1/2/3 可随意切换，看好再确认。确认后我会立壳、铺底图并把边界框出来。其余候选带门牌地址，按 1/2/3… 编号排在地图左上角的搜索下拉里。</p>
    {state.loading && <p className="ap-agent-line" role="status">正在找「{state.query}」的候选场地…</p>}
    {!state.loading && state.candidates.length === 0 && <>
      <p className="ap-agent-line">没搜到匹配「{state.query}」的场地。当前方案没有改动：已确认的场地、边界和分区都原样保留。</p>
      <p className="ap-agent-line">下一步可以：① 换关键词或加上城市名再说一次；② 在地图上手动圈画；③ 先按当前场地往下做，之后再来换。</p>
      {onManual && <button type="button" className="btn-outline" onClick={onManual}>
        在地图上手动圈画
      </button>}
    </>}
    {state.picking && <p role="status">正在查找真实边界（最多约 85 秒）；超时将转为手画，不会编造边界。</p>}
    {topThree.length > 0 && <div className="ap-option-pick">
      {topThree.map((place, index) => (
        <button
          key={place.id}
          type="button"
          className={`ap-option-row${browsing === place.name ? ' is-picked' : ''}`}
          disabled={state.picking !== null}
          aria-pressed={browsing === place.name}
          onClick={() => {
            if (browsing !== place.name) {
              setBrowsing(place.name);
              onPreview?.(place);
            }
          }}
        >
          <span className="ap-venue-option-text">
            <span className="ap-venue-option-name">{index + 1}. {place.name}</span>
          </span>
          {browsing === place.name && state.picking === null && <span className="ap-option-row-mark">地图预览中</span>}
          {state.picking === place.name && <span className="ap-option-row-mark">确认中…</span>}
        </button>
      ))}
    </div>}
    {browsed && !state.picking && (
      <button type="button" className="btn-primary" onClick={() => onPick(browsed)}>
        就定这个场地（{browsed.name}）
      </button>
    )}
    {!state.loading && state.candidates.length > 0 && (
      <button type="button" className="chip" onClick={onDismiss}>都不合适，按条件再找</button>
    )}
  </section>;
}

/** V-2d 流线提案确认卡：虚线预览在画布上，应用才 commitPlan（整批可撤销）。
 *  2026-11-19 用户指令：三个决定横排、图标+短词（应用/放弃/取消任务），不再三行全句；
 *  说明压成一段，「一句话改」的提示撤掉——输入框本来就在下面。 */
export function RouteConfirmCard({ summary, routes, busy, onConfirm, onDismiss, onCancelTask }: {
  summary: { pedestrian: number; vehicle: number; service: number; entrances: number };
  routes: number;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  /** 第三档（对标谷地工坊「取消任务」）：不是拒绝这版，是把整个户外任务停掉；不传就不出。 */
  onCancelTask?: (() => void) | undefined;
}): JSX.Element {
  return <section className="ap-card ap-venue-card" aria-label="流线提案确认">
    <p className="ap-lead-title">这版流线要应用吗？</p>
    <p className="ap-lead-body">草拟 {routes} 条（人行 {summary.pedestrian} · 车行 {summary.vehicle} · 后勤 {summary.service}）+ {summary.entrances} 个出入口；虚线是预览，应用后变实线，Ctrl+Z 可整批撤销。</p>
    <div className="ap-confirm-choices" role="group" aria-label="流线提案决定">
      <button type="button" className="ap-confirm-choice is-primary" disabled={busy} onClick={onConfirm}>
        <Check size={14} aria-hidden="true" />
        应用
        {busy && <span className="ap-option-row-mark">应用中…</span>}
      </button>
      <button type="button" className="ap-confirm-choice" disabled={busy} onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
        放弃
      </button>
      {onCancelTask && <button type="button" className="ap-confirm-choice" disabled={busy} onClick={onCancelTask}>
        <Square size={12} aria-hidden="true" />
        取消任务
      </button>}
    </div>
  </section>;
}

/** V-3 区域提案确认卡：虚线分区+物料幽灵在画布，应用才 commitPlan（整批可撤销）。
 *  2026-11-19 用户指令：与 24 卡同款——三个决定横排、图标+短词；说明压成一段。 */
export function ZoneConfirmCard({ proposal, busy, onConfirm, onDismiss, onCancelTask }: {
  proposal: ZoneEventProposal;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onCancelTask?: (() => void) | undefined;
}): JSX.Element {
  return <section className="ap-card ap-venue-card" aria-label="区域提案确认">
    <p className="ap-lead-title">这版分区要应用吗？</p>
    <p className="ap-lead-body">草拟 {proposal.summary.zones} 个区域 + {proposal.summary.facilities} 件物料（签到→观众→舞台按入场朝向分带）；虚线框是预览，应用后变实线，Ctrl+Z 可整批撤销。</p>
    {proposal.summary.warnings?.map(warning => <p className="ap-lead-body" key={warning}>{warning}</p>)}
    <div className="ap-confirm-choices" role="group" aria-label="区域提案决定">
      <button type="button" className="ap-confirm-choice is-primary" disabled={busy} onClick={onConfirm}>
        <Check size={14} aria-hidden="true" />
        应用
        {busy && <span className="ap-option-row-mark">应用中…</span>}
      </button>
      <button type="button" className="ap-confirm-choice" disabled={busy} onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
        放弃
      </button>
      {onCancelTask && <button type="button" className="ap-confirm-choice" disabled={busy} onClick={onCancelTask}>
        <Square size={12} aria-hidden="true" />
        取消任务
      </button>}
    </div>
  </section>;
}