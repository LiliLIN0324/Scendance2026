'use client';

import { useMemo, useRef, useState } from 'react';
import { layoutToSvg } from '../room-organizer/lib/plan-export/svg';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../room-organizer/lib/types';
import {
  createPlanSheetMap,
  hitPlacedItem,
  pinPercent,
  sheetPixelFromWorld,
  worldFromSheetPixel,
  type PlanSheetMap,
} from './review-share-plan-map';
import { placeComposer, REVIEW_PIN_TEXT_MAX } from '../room-organizer/lib/review-pins';
import type { ReviewSharePin } from './review-share-pins';
import '../room-organizer/panels/review-pin-layer.css';

function svgSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function pinSubject(itemId: string | null, items: readonly FurnitureItem[]): string {
  if (!itemId) return '地面';
  return items.find(item => item.id === itemId)?.name ?? '物件';
}

export function ReviewSharePlanStage({
  layout,
  floor,
  pins,
  activeId,
  author,
  onAuthor,
  onAddPin,
}: {
  layout: RoomLayout;
  floor: FloorLayout;
  pins: readonly ReviewSharePin[];
  activeId: string | null;
  author: string;
  onAuthor(value: string): void;
  onAddPin(input: { itemId: string | null; x: number; z: number; text: string }): void;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ itemId: string | null; x: number; z: number } | null>(null);
  const [text, setText] = useState('');
  const [formError, setFormError] = useState('');
  const map = useMemo(() => createPlanSheetMap(layout, floor), [layout, floor]);
  const svg = useMemo(() => layoutToSvg(layout, floor), [layout, floor]);

  const onSheetClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return;
    const img = rootRef.current?.querySelector('img');
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const sheetX = ((event.clientX - rect.left) / rect.width) * map.sheetWidth;
    const sheetY = ((event.clientY - rect.top) / rect.height) * map.sheetHeight;
    const world = worldFromSheetPixel(map, sheetX, sheetY);
    const hit = hitPlacedItem(floor.items, world.x, world.z);
    setDraft({ itemId: hit?.id ?? null, x: world.x, z: world.z });
    setText('');
    setFormError('');
  };

  const commit = () => {
    if (!draft) return;
    if (!author.trim()) {
      setFormError('先填写称呼，再钉上意见。');
      return;
    }
    if (!text.trim()) {
      setFormError('写一句再钉上。');
      return;
    }
    onAddPin({ ...draft, text });
    setDraft(null);
    setText('');
    setFormError('');
  };

  return (
    <div className="rsp-sheet-stage">
      <p className="rsp-pin-hint" role="status">点平面或物件落钉评论</p>
      <label className="rsp-pin-author">
        <span>称呼</span>
        <input
          value={author}
          maxLength={24}
          placeholder="甲方称呼"
          onChange={event => onAuthor(event.target.value)}
        />
      </label>
      <div
        ref={rootRef}
        className="rsp-sheet-interactive"
        style={{ aspectRatio: `${map.sheetWidth} / ${map.sheetHeight}` }}
        onClick={onSheetClick}
        role="presentation"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgSrc(svg)} alt={`${layout.name}，${floor.name}平面预览`} draggable={false} />
        <div className="sc-review-pins rsp-share-pins" aria-hidden={pins.length === 0 && !draft}>
          {pins.map((pin, index) => {
            const pos = pinPercent(map, pin.x, pin.z);
            return (
              <button
                key={pin.id}
                type="button"
                className={activeId === pin.id ? 'is-on' : ''}
                style={{ left: pos.left, top: pos.top }}
                aria-label={`钉 ${index + 1}：${pin.text}`}
              >
                {index + 1}
              </button>
            );
          })}
          {draft && (
            <PinComposer
              map={map}
              draft={draft}
              items={floor.items}
              hostRef={rootRef}
              text={text}
              formError={formError}
              onText={setText}
              onCommit={commit}
              onCancel={() => setDraft(null)}
            />
          )}
        </div>
      </div>
      {formError && !draft && <p className="rsp-form-error" role="alert">{formError}</p>}
    </div>
  );
}

function PinComposer({
  map,
  draft,
  items,
  hostRef,
  text,
  formError,
  onText,
  onCommit,
  onCancel,
}: {
  map: PlanSheetMap;
  draft: { itemId: string | null; x: number; z: number };
  items: readonly FurnitureItem[];
  hostRef: React.RefObject<HTMLDivElement | null>;
  text: string;
  formError: string;
  onText(value: string): void;
  onCommit(): void;
  onCancel(): void;
}) {
  const sheetPoint = sheetPixelFromWorld(map, draft.x, draft.z);
  const host = hostRef.current;
  const bounds = host
    ? { width: host.clientWidth, height: host.clientHeight }
    : { width: 320, height: 240 };
  const anchor = {
    x: (sheetPoint.x / map.sheetWidth) * bounds.width,
    y: (sheetPoint.y / map.sheetHeight) * bounds.height,
  };
  const composer = placeComposer(anchor, bounds);

  return (
    <form
      className="sc-review-composer rsp-share-composer"
      style={composer}
      onSubmit={event => {
        event.preventDefault();
        onCommit();
      }}
    >
      <p>{draft.itemId ? `钉在「${pinSubject(draft.itemId, items)}」` : '钉在地面'}</p>
      <input
        aria-label="议题"
        maxLength={REVIEW_PIN_TEXT_MAX}
        placeholder="写一句意见"
        value={text}
        autoFocus
        onChange={event => onText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div>
        <button type="submit" disabled={!text.trim()}>钉上</button>
        <button type="button" onClick={onCancel}>取消</button>
      </div>
      {formError && <p className="rsp-form-error" role="alert">{formError}</p>}
    </form>
  );
}
