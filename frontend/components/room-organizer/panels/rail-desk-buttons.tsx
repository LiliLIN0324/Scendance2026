import { LandPlot, MapPin } from 'lucide-react';

/** 左轨第二颗：Bingo。打开自己的评审面板，不进晴光对话。 */
export function BingoRailButton({ open, onOpen }: { open: boolean; onOpen(): void }): JSX.Element {
  return (
    <button
      type="button"
      className={`sc-rail-tool sc-rail-bingo${open ? ' is-active' : ''}`}
      aria-pressed={open}
      aria-label="Bingo"
      data-tip="Bingo"
      title="Bingo · 评审"
      onClick={onOpen}
    >
      <MapPin size={22} aria-hidden="true" />
    </button>
  );
}

/** 左轨第三颗：场地库。模板和收藏场馆，不进晴光，也不进 Bingo。 */
export function VenueRailButton({ open, onOpen }: { open: boolean; onOpen(): void }): JSX.Element {
  return (
    <button
      type="button"
      className={`sc-rail-tool sc-rail-venue${open ? ' is-active' : ''}`}
      aria-pressed={open}
      aria-label="场地"
      data-tip="场地"
      title="场地库"
      onClick={onOpen}
    >
      <LandPlot size={22} aria-hidden="true" />
    </button>
  );
}
