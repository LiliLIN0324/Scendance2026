'use client';

/**
 * 左轨三态只换左栏这张卡。主区 3D 和右轨不换皮。
 * 布置改场景，评审只读并钉意见，执行导出清单。
 */
import { useRoomEditor } from '../contexts';
import { countOpenPins, pinSubject, pinsForFilter, type ReviewPin, type ReviewPinFilter } from '../lib/review-pins';
import { useAgent } from './agent-panel';
import { materialRows } from './plan-flow';
import './mode-shell.css';

/** 有到场物料算齐，一场空的算缺。真点验下一刀再接。 */
export function dossierStatus(itemCount: number): '齐' | '缺' {
  return itemCount > 0 ? '齐' : '缺';
}

/** 左栏瘦成未解决钉的滤镜。钉本身在画布上。 */
export function ReviewIssuesCard({
  pins,
  items,
  filter,
  activeId,
  onFilter,
  onFocus,
  onResolve,
  onReturn,
  onConfirm,
}: {
  pins: readonly ReviewPin[];
  items: readonly { id: string; name: string }[];
  filter: ReviewPinFilter;
  activeId: string | null;
  onFilter(filter: ReviewPinFilter): void;
  onFocus(id: string): void;
  onResolve(id: string): void;
  onReturn(id: string): void;
  onConfirm(): void;
}): JSX.Element {
  const openCount = countOpenPins(pins);
  const visible = pinsForFilter(pins, filter);
  const numbers = new Map(pins.map((pin, index) => [pin.id, index + 1]));
  return <section className="sc-mode-card" role="region" aria-label="议题">
    <header>
      <strong>议题</strong>
      <span>{openCount === 0 ? '没有未解决的' : `${openCount} 条未解决`}</span>
    </header>
    <div className="sc-issue-filters" role="group" aria-label="议题筛选">
      <button type="button" aria-pressed={filter === 'open'} onClick={() => onFilter('open')}>未解决</button>
      <button type="button" aria-pressed={filter === 'resolved'} onClick={() => onFilter('resolved')}>已解决</button>
    </div>
    {visible.length === 0
      ? <p className="sc-mode-shell-empty">{filter === 'open' ? '点物件或地面，钉一条意见' : '还没有标成已解决的'}</p>
      : <ul className="sc-issue-list">
          {visible.map(pin => {
            const on = activeId === pin.id;
            return <li key={pin.id} className={on ? 'is-on' : ''}>
              <button type="button" className="sc-issue-go" aria-pressed={on} onClick={() => onFocus(pin.id)}>
                <b aria-hidden="true">{numbers.get(pin.id)}</b>
                <span>
                  <strong>{pin.text}</strong>
                  <small>{pinSubject(pin.itemId, items)}</small>
                </span>
              </button>
              {pin.status === 'open' && <div className="sc-issue-acts">
                <button type="button" onClick={() => onResolve(pin.id)}>标记已解决</button>
                <button type="button" onClick={() => onReturn(pin.id)}>退回布置</button>
              </div>}
            </li>;
          })}
        </ul>}
    <button type="button" className="sc-issue-confirm" onClick={onConfirm}>确认可进执行</button>
    {openCount > 0 && <p className="sc-issue-note">还有未解决的钉。确认后它们还留在议题里。</p>}
  </section>;
}

export function DeliveryChecklistShell({ items, onExport, reviewCleared = false }: {
  items: readonly { name: string }[];
  onExport(): void;
  reviewCleared?: boolean;
}): JSX.Element {
  const rows = materialRows(items);
  const status = dossierStatus(rows.length);
  return <section className="sc-mode-card" role="region" aria-label="执行清单">
    <header>
      <strong>到场清单</strong>
      <span role="status">资料状态 · {status}</span>
      <button type="button" onClick={onExport}>导出</button>
    </header>
    {reviewCleared && <p className="sc-issue-note">评审已确认，可以导出。</p>}
    <ul>
      {rows.length === 0
        ? <li><span>还没有到场物料</span><b data-status="缺">缺</b></li>
        : rows.map(row => <li key={row.name}><span>{row.name}</span><span>{row.count} 件</span><b data-status="齐">齐</b></li>)}
    </ul>
  </section>;
}

/** 布置左卡：活动、人数、米数。不放「从哪来」。 */
export function LayoutVenueCard({ event, guests, dims }: {
  event: string | null;
  guests: string | null;
  dims: string;
}): JSX.Element {
  return <section className="sc-mode-card" role="region" aria-label="布置">
    <header>
      <strong>场地</strong>
      <span>活动 · 人数 · 米数</span>
    </header>
    <dl>
      <div><dt>活动</dt><dd>{event || '还没说'}</dd></div>
      <div><dt>人数</dt><dd>{guests || '还没说'}</dd></div>
      <div><dt>米数</dt><dd>{dims}</dd></div>
    </dl>
  </section>;
}

/** 挂在左栏：同一张卡位，三态只换里面的字。 */
export function WorkbenchModeCard({
  pins,
  pinFilter,
  activePinId,
  reviewCleared,
  onPinFilter,
  onFocusPin,
  onResolvePin,
  onReturnPin,
  onConfirmDelivery,
  onExport,
}: {
  pins: readonly ReviewPin[];
  pinFilter: ReviewPinFilter;
  activePinId: string | null;
  reviewCleared: boolean;
  onPinFilter(filter: ReviewPinFilter): void;
  onFocusPin(id: string): void;
  onResolvePin(id: string): void;
  onReturnPin(id: string): void;
  onConfirmDelivery(): void;
  onExport(): void;
}): JSX.Element {
  const agent = useAgent();
  const { activeFloor } = useRoomEditor();
  if (agent.callbacks.workbenchMode === 'review') {
    return <ReviewIssuesCard
      pins={pins}
      items={activeFloor.items}
      filter={pinFilter}
      activeId={activePinId}
      onFilter={onPinFilter}
      onFocus={onFocusPin}
      onResolve={onResolvePin}
      onReturn={onReturnPin}
      onConfirm={onConfirmDelivery}
    />;
  }
  if (agent.callbacks.workbenchMode === 'delivery') return <DeliveryChecklistShell items={activeFloor.items} reviewCleared={reviewCleared} onExport={() => { agent.previewExport(); onExport(); }} />;
  return <LayoutVenueCard event={agent.recap.event} guests={agent.recap.guests} dims={agent.recap.dims} />;
}
