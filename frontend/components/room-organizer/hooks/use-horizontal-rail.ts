'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, Ref } from 'react';

/**
 * One-row horizontal rails: a vertical wheel becomes a sideways scroll and the
 * arrow keys step through the row, so a short drawer never needs a second,
 * hidden vertical scrollbar. The rail publishes `data-overflow`, which CSS turns
 * into an edge fade instead of drawing a scrollbar over the card captions.
 */
function overflowOf(rail: HTMLElement): 'none' | 'more' | 'start' | 'both' {
  const max = rail.scrollWidth - rail.clientWidth;
  if (max <= 1) return 'none';
  if (rail.scrollLeft <= 1) return 'more';
  if (rail.scrollLeft >= max - 1) return 'start';
  return 'both';
}

export function useHorizontalRail<T extends HTMLElement = HTMLDivElement>(): { setRef: Ref<T>; onKeyDown(event: KeyboardEvent<T>): void } {
  const node = useRef<T | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const setRef = useCallback((next: T | null) => {
    detach.current?.();
    detach.current = null;
    node.current = next;
    if (!next) return;
    const rail = next;
    rail.dataset.overflow = overflowOf(rail);
    const onScroll = () => { rail.dataset.overflow = overflowOf(rail); };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= 0) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1;
      const offset = Math.max(0, Math.min(max, rail.scrollLeft + event.deltaY * unit));
      if (offset === rail.scrollLeft) return;
      // Non-passive so the canvas behind the drawer does not take the gesture.
      event.preventDefault();
      rail.scrollLeft = offset;
    };
    rail.addEventListener('scroll', onScroll, { passive: true });
    rail.addEventListener('wheel', onWheel, { passive: false });
    detach.current = () => {
      rail.removeEventListener('scroll', onScroll);
      rail.removeEventListener('wheel', onWheel);
    };
  }, []);
  useEffect(() => () => detach.current?.(), []);
  // Growing the row (more tiles, a wider drawer) never fires scroll, so re-check each render.
  useEffect(() => {
    const rail = node.current;
    if (rail) rail.dataset.overflow = overflowOf(rail);
  });
  const onKeyDown = useCallback((event: KeyboardEvent<T>) => {
    if (event.target !== event.currentTarget) return;
    const rail = node.current;
    if (!rail) return;
    const page = rail.clientWidth * 0.8;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); rail.scrollLeft += event.key === 'PageDown' ? page : 120; }
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); rail.scrollLeft -= event.key === 'PageUp' ? page : 120; }
    else if (event.key === 'Home') { event.preventDefault(); rail.scrollLeft = 0; }
    else if (event.key === 'End') { event.preventDefault(); rail.scrollLeft = rail.scrollWidth; }
  }, []);
  return { setRef, onKeyDown };
}
