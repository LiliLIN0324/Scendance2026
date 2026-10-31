'use client';

import { useEffect, useRef, useState } from 'react';
import { placeComposer, REVIEW_PIN_TEXT_MAX, type ReviewPinStatus } from '../lib/review-pins';
import './review-pin-layer.css';

export interface ReviewPinMark {
  id: string;
  n: number;
  status: ReviewPinStatus;
  x: number;
  y: number;
  z: number;
}

/** 画布上的小钉和一句短输入。不另开主区壳。 */
export function ReviewPinLayer({
  pins,
  activeId,
  draft,
  draftLabel,
  toScreen,
  controlsRef,
  cameraReady,
  onFocus,
  onCommit,
  onCancel,
}: {
  pins: readonly ReviewPinMark[];
  activeId: string | null;
  draft: { x: number; y: number; z: number } | null;
  draftLabel: string;
  toScreen(point: { x: number; y: number; z: number }): { x: number; y: number } | null;
  controlsRef: React.RefObject<{ addEventListener(type: 'change', listener: () => void): void; removeEventListener(type: 'change', listener: () => void): void } | null>;
  cameraReady: boolean;
  onFocus(id: string): void;
  onCommit(text: string): void;
  onCancel(): void;
}): JSX.Element | null {
  const [placed, setPlaced] = useState<{ id: string; n: number; status: ReviewPinStatus; x: number; y: number }[]>([]);
  const [composer, setComposer] = useState<{ left: number; top: number } | null>(null);
  const [text, setText] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setText(''); }, [draft?.x, draft?.y, draft?.z, draftLabel]);

  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host || !cameraReady && pins.length === 0 && !draft) return undefined;
    const update = () => {
      const next = pins.flatMap(pin => {
        const point = toScreen(pin);
        return point ? [{ id: pin.id, n: pin.n, status: pin.status, x: point.x, y: point.y }] : [];
      });
      setPlaced(next);
      if (!draft) { setComposer(null); return; }
      const point = toScreen(draft);
      if (!point) { setComposer(null); return; }
      setComposer(placeComposer(point, { width: host.clientWidth, height: host.clientHeight }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    const controls = controlsRef.current;
    controls?.addEventListener('change', update);
    return () => {
      observer.disconnect();
      controls?.removeEventListener('change', update);
    };
  }, [pins, draft, toScreen, controlsRef, cameraReady]);

  if (pins.length === 0 && !draft) return null;
  return <div className="sc-review-pins" ref={rootRef}>
    {placed.map(pin => <button
      key={pin.id}
      type="button"
      className={activeId === pin.id ? 'is-on' : ''}
      data-status={pin.status}
      style={{ left: pin.x, top: pin.y }}
      aria-label={`议题 ${pin.n}`}
      onClick={() => onFocus(pin.id)}
    >{pin.n}</button>)}
    {draft && composer && <form className="sc-review-composer" style={composer} onSubmit={event => { event.preventDefault(); onCommit(text); }}>
      <p>{draftLabel}</p>
      <input aria-label="议题" maxLength={REVIEW_PIN_TEXT_MAX} placeholder="写一句意见" value={text} autoFocus onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}/>
      <div>
        <button type="submit" disabled={!text.trim()}>钉上</button>
        <button type="button" onClick={onCancel}>取消</button>
      </div>
    </form>}
  </div>;
}
