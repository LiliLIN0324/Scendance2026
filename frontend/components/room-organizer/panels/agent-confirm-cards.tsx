/**
 * 户外三张确认卡：场地候选 / 流线提案 / 区域提案。
 *
 * 三张本来就只接渲染数据与回调（无 AgentValue 依赖），搬出只为缩小面板改动重叠；
 * 卡内不发起任何写入，确认动作由面板经 callback 交回。
 */
import type { PlaceSuggestion } from '../lib/place-search';
import type { ZoneEventProposal } from '../lib/zone-event-proposal';

/** V-1b 场地回显确认卡：候选来自双源检索；点选=确认真实场地并走 V-1c 锚定链。
 *  2026-11-15 用户拍板：chat 卡只给前三个候选、只留标题（不再堆全量地址溢出面板）；
 *  完整候选带门牌地址、按 1/2/3… 编号排在地图左上角搜索框的下拉里，逐个点开看。 */
export function VenueConfirmCard({ state, onPick, onDismiss }: {
  state: { query: string; candidates: PlaceSuggestion[]; loading: boolean; picking: string | null };
  onPick: (place: PlaceSuggestion) => void;
  onDismiss: () => void;
}): JSX.Element {
  const topThree = state.candidates.slice(0, 3);
  return <section className="ap-card ap-venue-card" aria-label="场地确认">
    <p className="ap-lead-title">我理解为「{state.query}」，设为场地？</p>
    <p className="ap-lead-body">点一个标题确认是真实场地；确认后我会立壳、铺底图并把边界框出来。其余候选带门牌地址，按 1/2/3… 编号排在地图左上角的搜索下拉里。</p>
    {state.loading && <p className="ap-agent-line" role="status">正在找「{state.query}」的候选场地…</p>}
    {!state.loading && state.candidates.length === 0 && <p className="ap-agent-line">没搜到候选场地。换个说法再说一句，或点右栏「地图选址」手动圈。</p>}
    {state.picking && <p role="status">正在查找真实边界（最多约 85 秒）；超时将转为手画，不会编造边界。</p>}
    {topThree.length > 0 && <div className="ap-option-pick">
      {topThree.map((place, index) => (
        <button
          key={place.id}
          type="button"
          className="ap-option-row"
          disabled={state.picking !== null}
          onClick={() => onPick(place)}
        >
          <span className="ap-venue-option-text">
            <span className="ap-venue-option-name">{index + 1}. {place.name}</span>
          </span>
          {state.picking === place.name && <span className="ap-option-row-mark">确认中…</span>}
        </button>
      ))}
    </div>}
    {!state.loading && state.candidates.length > 0 && (
      <button type="button" className="chip" onClick={onDismiss}>都不是，换个说法</button>
    )}
  </section>;
}

/** V-2d 流线提案确认卡：虚线预览在画布上，应用才 commitPlan（整批可撤销）。 */
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
    <p className="ap-lead-body">草拟 {routes} 条（人行 {summary.pedestrian} · 车行 {summary.vehicle} · 后勤 {summary.service}）+ {summary.entrances} 个出入口。画布上的虚线是预览——应用后变实线，Ctrl+Z 可整批撤销。</p>
    <div className="ap-option-pick">
      <button type="button" className="ap-option-row" disabled={busy} onClick={onConfirm}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">应用这版流线</span></span>
        {busy && <span className="ap-option-row-mark">应用中…</span>}
      </button>
      <button type="button" className="ap-option-row" disabled={busy} onClick={onDismiss}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">放弃这版</span></span>
      </button>
      {onCancelTask && <button type="button" className="ap-option-row" disabled={busy} onClick={onCancelTask}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">取消整个任务</span></span>
      </button>}
    </div>
    <p className="ap-lead-body">也可以不出卡直接回答：在下面输入框用一句话说想改哪里（如「入口再宽一点」）。</p>
  </section>;
}

/** V-3 区域提案确认卡：虚线分区+物料幽灵在画布，应用才 commitPlan（整批可撤销）。 */
export function ZoneConfirmCard({ proposal, busy, onConfirm, onDismiss, onCancelTask }: {
  proposal: ZoneEventProposal;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onCancelTask?: (() => void) | undefined;
}): JSX.Element {
  return <section className="ap-card ap-venue-card" aria-label="区域提案确认">
    <p className="ap-lead-title">这版分区要应用吗？</p>
    <p className="ap-lead-body">草拟 {proposal.summary.zones} 个区域 + {proposal.summary.facilities} 件物料（签到→观众→舞台按入场朝向分带）。画布上的虚线框是预览——应用后变实线，Ctrl+Z 可整批撤销。</p>
    {proposal.summary.warnings?.map(warning => <p className="ap-lead-body" key={warning}>{warning}</p>)}
    <div className="ap-option-pick">
      <button type="button" className="ap-option-row" disabled={busy} onClick={onConfirm}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">应用这版分区</span></span>
        {busy && <span className="ap-option-row-mark">应用中…</span>}
      </button>
      <button type="button" className="ap-option-row" disabled={busy} onClick={onDismiss}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">放弃这版</span></span>
      </button>
      {onCancelTask && <button type="button" className="ap-option-row" disabled={busy} onClick={onCancelTask}>
        <span className="ap-venue-option-text"><span className="ap-venue-option-name">取消整个任务</span></span>
      </button>}
    </div>
    <p className="ap-lead-body">也可以不出卡直接回答：在下面输入框用一句话说想改哪里（如「签到区挪到东侧」）。</p>
  </section>;
}