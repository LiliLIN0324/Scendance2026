'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { RAIL_EYES, type RailForm } from './rail-avatar';
import './bingo-avatar-flight.css';

const FLIGHT_MS = 260;

type FlightFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function rectOf(el: Element | null | undefined): FlightFrame | null {
  if (!el) return null;
  const box = el.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

/** Bingo 的门洞头像在左轨与对话顶栏之间飞入/飞出（FLIP 固定层）。 */
export function BingoAvatarFlight({
  open,
  form,
  railRef,
  headerAvatarRef,
}: {
  open: boolean;
  form: RailForm;
  railRef: RefObject<HTMLElement | null>;
  headerAvatarRef: RefObject<HTMLElement | null>;
}): JSX.Element | null {
  const [frame, setFrame] = useState<FlightFrame | null>(null);
  const [target, setTarget] = useState<FlightFrame | null>(null);
  const [visible, setVisible] = useState(false);
  const prevOpen = useRef(open);

  useLayoutEffect(() => {
    const wasOpen = prevOpen.current;
    prevOpen.current = open;
    if (wasOpen === open) return;

    const railImg = railRef.current?.querySelector('img');
    const head = headerAvatarRef.current;
    const from = open ? rectOf(railImg) : rectOf(head);
    const to = open ? rectOf(head) : rectOf(railImg);
    if (!from || !to) {
      setFrame(null);
      setTarget(null);
      setVisible(false);
      return;
    }

    setFrame(from);
    setTarget(to);
    setVisible(false);
    const start = requestAnimationFrame(() => setVisible(true));
    const done = window.setTimeout(() => {
      setFrame(null);
      setTarget(null);
      setVisible(false);
    }, FLIGHT_MS + 32);
    return () => {
      cancelAnimationFrame(start);
      window.clearTimeout(done);
    };
  }, [open, railRef, headerAvatarRef]);

  if (!frame || !target || typeof document === 'undefined') return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: visible ? target.left : frame.left,
    top: visible ? target.top : frame.top,
    width: visible ? target.width : frame.width,
    height: visible ? target.height : frame.height,
    margin: 0,
    padding: 0,
    border: 0,
    zIndex: 40,
    pointerEvents: 'none',
    transition: `left ${FLIGHT_MS}ms var(--ease-spec, ease), top ${FLIGHT_MS}ms var(--ease-spec, ease), width ${FLIGHT_MS}ms var(--ease-spec, ease), height ${FLIGHT_MS}ms var(--ease-spec, ease)`,
  };

  return createPortal(
    <span className="sc-bingo-avatar-flight" style={style} aria-hidden="true">
      <img src={`/assets/rail/${form}.png`} alt="" draggable={false} />
      <span className="sc-rail-avatar-face">
        {RAIL_EYES[form].map(([x, y], index) => (
          <i key={index} className={`sc-rail-eye is-${index === 0 ? 'left' : 'right'}`} style={{ left: `${x}%`, top: `${y}%` }} />
        ))}
      </span>
    </span>,
    document.body,
  );
}
