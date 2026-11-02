// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BingoAvatarFlight } from './bingo-avatar-flight';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function box(left: number, top: number, size: number): DOMRect {
  return {
    left,
    top,
    width: size,
    height: size,
    right: left + size,
    bottom: top + size,
    x: left,
    y: top,
    toJSON() { return {}; },
  } as DOMRect;
}

describe('BingoAvatarFlight', () => {
  it('stays unmounted until the panel open state changes and both avatars have a box', () => {
    const railRef = createRef<HTMLButtonElement>();
    const headerAvatarRef = createRef<HTMLSpanElement>();
    const view = render(
      <BingoAvatarFlight open={false} form="door" railRef={railRef} headerAvatarRef={headerAvatarRef} />,
    );
    expect(document.querySelector('.sc-bingo-avatar-flight')).toBeNull();
    view.rerender(<BingoAvatarFlight open form="door" railRef={railRef} headerAvatarRef={headerAvatarRef} />);
    expect(document.querySelector('.sc-bingo-avatar-flight')).toBeNull();
  });

  it('portals the same door avatar from the rail to the header slot', () => {
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this instanceof HTMLImageElement) return box(12, 24, 28);
      if (this instanceof HTMLSpanElement) return box(80, 40, 32);
      return box(0, 0, 0);
    });
    const railRef = createRef<HTMLButtonElement>();
    const headerAvatarRef = createRef<HTMLSpanElement>();
    const view = render(
      <>
        <button ref={railRef} type="button"><img alt="" /></button>
        <span ref={headerAvatarRef} />
        <BingoAvatarFlight open={false} form="door" railRef={railRef} headerAvatarRef={headerAvatarRef} />
      </>,
    );
    view.rerender(
      <>
        <button ref={railRef} type="button"><img alt="" /></button>
        <span ref={headerAvatarRef} />
        <BingoAvatarFlight open form="door" railRef={railRef} headerAvatarRef={headerAvatarRef} />
      </>,
    );
    const flight = document.querySelector<HTMLElement>('.sc-bingo-avatar-flight');
    expect(flight?.querySelector('img')?.getAttribute('src')).toBe('/assets/rail/door.png');
    expect(flight?.querySelectorAll('.sc-rail-eye')).toHaveLength(2);
    expect(flight?.style.left).toBe('12px');
    expect(flight?.style.top).toBe('24px');
  });
});
